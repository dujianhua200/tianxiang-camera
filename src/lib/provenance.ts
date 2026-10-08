/* 照片存证：JPEG 暗水印（TXWM 段）+ 本地哈希链
 *
 * 背景：canvas.toDataURL 会剥离全部元数据（无 EXIF），且拍摄后 JPEG
 * 再做像素级 LSB 暗水印会被 0.92 质量重压缩抹掉。因此暗水印做在
 * JPEG 二进制层：SOI 之后插入自定义 APP15 段（0xEF），魔数 "TXWM1\0"
 * + UTF-8 JSON 载荷。肉眼不可见；整文件复制/上传/改名都保留；
 * 任何转码、重压缩、裁剪会丢失该段（与 EXIF 同理），此时以哈希链为准。
 *
 * 哈希链：每拍一张，取"暗水印嵌入后"的整文件 sha256，追加到
 * localStorage 账本：{ id, hash, prev, ts, fileName }，prev 指向上
 * 一条的 hash（链头为 'GENESIS'）。校验时重算本机现存照片的 hash
 * 并逐条核对 prev 链接，任一环节断裂即报。
 *
 * 本模块零 DOM 依赖（仅用 crypto.subtle / atob / TextEncoder），可被
 * node 直接编译测试，见 scripts/chain-test.mjs。
 */

export interface TxwmPayload {
  v: 1;
  /** 照片 id，与 Shot.id 一致 */
  id: number;
  /** 拍摄时间戳（ms） */
  ts: number;
  /** WGS-84 原始坐标 */
  lat: number;
  lng: number;
  project: string;
  note: string;
  /** 上一张照片的 sha256，链头为 'GENESIS' */
  prev: string;
  device?: string;
}

export interface ChainEntry {
  id: number;
  /** 暗水印嵌入后整文件的 sha256（hex） */
  hash: string;
  prev: string;
  ts: number;
  fileName: string;
}

export type PhotoStatus = 'ok' | 'tampered' | 'missing';

export interface VerifyReport {
  entries: { entry: ChainEntry; status: PhotoStatus }[];
  /** 账本自洽：每条 prev == 上一条 hash */
  chainOk: boolean;
  /** 首次断裂的账本下标，完整时为 null */
  brokenAt: number | null;
  checkedAt: number;
}

const CHAIN_KEY = 'tx.chain.v1';
const GENESIS = 'GENESIS';
const MAGIC = 'TXWM1\0';
const APP15 = 0xef;

const te = new TextEncoder();
const td = new TextDecoder();

function magicBytes(): Uint8Array {
  return te.encode(MAGIC);
}

/* ---------- base64 ---------- */

export function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToDataUrl(bytes: Uint8Array, mime = 'image/jpeg'): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

/* ---------- sha256 ---------- */

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ---------- JPEG 段扫描 ---------- */

/** 是否 JPEG（SOI 开头） */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * 嵌入暗水印：SOI 后插入 APP15 段。
 * 段结构：FF EF | len(2B, 含自身) | "TXWM1\0"(6B) | JSON(utf8)
 * 非 JPEG 原样返回。
 */
export function embedTxwm(jpeg: Uint8Array, payload: TxwmPayload): Uint8Array {
  if (!isJpeg(jpeg)) return jpeg;
  const body = te.encode(JSON.stringify(payload));
  const magic = magicBytes();
  const segLen = 2 + magic.length + body.length;
  if (segLen > 0xffff) throw new Error('暗水印载荷过大');
  const seg = new Uint8Array(2 + segLen);
  seg[0] = 0xff;
  seg[1] = APP15;
  seg[2] = (segLen >> 8) & 0xff;
  seg[3] = segLen & 0xff;
  seg.set(magic, 4);
  seg.set(body, 4 + magic.length);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(seg, 2);
  out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}

/** 遍历 JPEG 各段，返回首个 TXWM 载荷；无则 null */
export function readTxwm(jpeg: Uint8Array): TxwmPayload | null {
  if (!isJpeg(jpeg)) return null;
  const magic = magicBytes();
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) break;
    const marker = jpeg[i + 1];
    if (marker === 0xda) break; // SOS：后为熵编码数据
    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // 无长度段
      continue;
    }
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (len < 2 || i + 2 + len > jpeg.length) break;
    if (marker === APP15) {
      let match = true;
      for (let k = 0; k < magic.length; k++) {
        if (jpeg[i + 4 + k] !== magic[k]) {
          match = false;
          break;
        }
      }
      if (match) {
        try {
          const json = td.decode(jpeg.subarray(i + 4 + magic.length, i + 2 + len));
          const p = JSON.parse(json) as TxwmPayload;
          if (p && p.v === 1 && typeof p.id === 'number') return p;
        } catch {
          /* 载荷损坏按无水印处理 */
        }
        return null;
      }
    }
    i += 2 + len;
  }
  return null;
}

/* ---------- 哈希链账本 ---------- */

function lsGet(): ChainEntry[] {
  try {
    const raw = localStorage.getItem(CHAIN_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ChainEntry[];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e) => e && typeof e.id === 'number' && typeof e.hash === 'string' && typeof e.prev === 'string'
    );
  } catch {
    return [];
  }
}

function lsSet(arr: ChainEntry[]): void {
  try {
    localStorage.setItem(CHAIN_KEY, JSON.stringify(arr));
  } catch {
    /* 配额不足时静默丢弃：账本条目极小，正常不会发生 */
  }
}

export function readChain(): ChainEntry[] {
  return lsGet();
}

export function chainTip(): ChainEntry | null {
  const arr = lsGet();
  return arr.length ? arr[arr.length - 1] : null;
}

export function appendChain(entry: ChainEntry): ChainEntry[] {
  const arr = lsGet();
  arr.push(entry);
  lsSet(arr);
  return arr;
}

/* ---------- 封存（一拍即做） ---------- */

export interface SealMeta {
  id: number;
  ts: number;
  lat: number;
  lng: number;
  project: string;
  note: string;
  fileName: string;
  device?: string;
}

export interface SealResult {
  /** 暗水印嵌入后的 dataURL：相册落盘 / state / 下载都用这一份 */
  dataUrl: string;
  hash: string;
  prev: string;
}

/**
 * 拍后封存：嵌入暗水印 → 算整文件 sha256 → 追加哈希链。
 * 任一步失败抛异常，调用方自行决定是否拦截拍照（建议不拦截）。
 */
export async function sealPhoto(dataUrl: string, meta: SealMeta): Promise<SealResult> {
  const prev = chainTip()?.hash ?? GENESIS;
  const payload: TxwmPayload = {
    v: 1,
    id: meta.id,
    ts: meta.ts,
    lat: meta.lat,
    lng: meta.lng,
    project: meta.project,
    note: meta.note,
    prev,
    device: meta.device,
  };
  const sealed = embedTxwm(dataUrlToBytes(dataUrl), payload);
  const hash = await sha256Hex(sealed);
  appendChain({ id: meta.id, hash, prev, ts: meta.ts, fileName: meta.fileName });
  return { dataUrl: bytesToDataUrl(sealed), hash, prev };
}

/* ---------- 校验 ---------- */

/**
 * 校验账本：
 * 1) 链自洽：逐条 prev 是否等于上一条 hash；
 * 2) 照片一致：本机现存照片重算 sha256 是否等于账本记录。
 * 已删/不在本机的照片记为 missing，不判篡改。
 */
export async function verifyChain(
  photos: { id: number; dataUrl: string }[]
): Promise<VerifyReport> {
  const ledger = lsGet();
  let chainOk = true;
  let brokenAt: number | null = null;
  for (let i = 0; i < ledger.length; i++) {
    const want = i === 0 ? GENESIS : ledger[i - 1].hash;
    if (ledger[i].prev !== want) {
      chainOk = false;
      brokenAt = i;
      break;
    }
  }
  const byId = new Map(photos.map((p) => [p.id, p.dataUrl]));
  const entries: VerifyReport['entries'] = [];
  for (const e of ledger) {
    const url = byId.get(e.id);
    if (!url) {
      entries.push({ entry: e, status: 'missing' });
      continue;
    }
    let status: PhotoStatus = 'tampered';
    try {
      const hash = await sha256Hex(dataUrlToBytes(url));
      status = hash === e.hash ? 'ok' : 'tampered';
    } catch {
      status = 'tampered';
    }
    entries.push({ entry: e, status });
  }
  return { entries, chainOk, brokenAt, checkedAt: Date.now() };
}
