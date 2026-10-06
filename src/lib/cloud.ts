/* 家云同步：配置持久化 + 上传（走壳 httpPost 桥，绕开 CORS/明文限制）+ 失败排队补传 */

export interface CloudCfg {
  url: string;
  lan: string;
  token: string;
  on: boolean;
}

export interface CloudMeta {
  fileName: string;
  project: string;
  note: string;
  time: string;
  lat: string;
  lng: string;
  alt: string;
  addr: string;
  weather: string;
  style: string;
  device: string;
  deviceId: string;
  deviceName: string;
}

const K_URL = 'geocam.cloud.url';
const K_LAN = 'geocam.cloud.lan';
const K_TOKEN = 'geocam.cloud.token';
const K_ON = 'geocam.cloud.on';
const K_QUEUE = 'geocam.cloud.queue';
const K_DEV = 'geocam.device.id';
const K_LASTOK = 'geocam.cloud.lastOk';

interface Endpoint {
  base: string;
  ms: number; // 连接超时
  tag: 'lan' | 'wan';
}

/** 线路候选：内网永远优先（1.5s 短超时，不通立即切外网），外网 6s */
function endpoints(cfg: CloudCfg): Endpoint[] {
  const list: Endpoint[] = [];
  if (cfg.lan) list.push({ base: cfg.lan, ms: 1500, tag: 'lan' });
  if (cfg.url) list.push({ base: cfg.url, ms: 6000, tag: 'wan' });
  return list;
}

function markOk(tag: 'lan' | 'wan') {
  try {
    localStorage.setItem(K_LASTOK, tag);
  } catch {
    /* ignore */
  }
}

/** 连接级错误（可换线路重试）vs 服务器业务错误（换线路无意义）。
 *  注意：bad-invite 是业务错误——内网/外网用同一个邀请码，重试只是白白多等一次。 */
function isConnErr(r: string): boolean {
  return (
    !!r &&
    !r.startsWith('http-') &&
    r !== 'ok' &&
    !r.includes('pending') &&
    !r.includes('blocked') &&
    !r.includes('bad-invite')
  );
}

/** 本机设备身份：首次生成后固定，服务端按它做注册审批 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(K_DEV);
    if (!id) {
      id =
        'tx-' +
        Array.from(crypto.getRandomValues(new Uint8Array(5)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      localStorage.setItem(K_DEV, id);
    }
    return id;
  } catch {
    return 'tx-unknown';
  }
}

export function deviceName(id: string): string {
  return '天象七星-' + id.slice(-4).toUpperCase();
}

/** 上传返回语义化：ok / pending / blocked / bad-response（被代理拦截）/ 其他错误串 */
export function parseUploadRet(ret: string): string {
  if (!ret) return '上传失败';
  if (ret.startsWith('ok')) {
    // 必须拿到台账服务自己的 JSON 才算成功；HTML = 被 FN Connect 等中继拦截
    return ret.includes('"ok":true') ? 'ok' : 'bad-response';
  }
  if (ret.includes('pending-approval')) return 'pending';
  if (ret.includes('"blocked"') || ret.includes('blocked')) return 'blocked';
  if (ret.includes('bad-invite')) return 'bad-invite';
  return ret.slice(0, 60);
}

export function getCloudCfg(): CloudCfg {
  try {
    return {
      url: (localStorage.getItem(K_URL) || '').replace(/\/+$/, ''),
      lan: (localStorage.getItem(K_LAN) || '').replace(/\/+$/, ''),
      token: localStorage.getItem(K_TOKEN) || '',
      on: localStorage.getItem(K_ON) === '1',
    };
  } catch {
    return { url: '', lan: '', token: '', on: false };
  }
}

export function setCloudCfg(c: CloudCfg) {
  try {
    localStorage.setItem(K_URL, c.url.trim().replace(/\/+$/, ''));
    localStorage.setItem(K_LAN, (c.lan || '').trim().replace(/\/+$/, ''));
    localStorage.setItem(K_TOKEN, c.token.trim());
    localStorage.setItem(K_ON, c.on ? '1' : '0');
  } catch {
    /* 存储不可用忽略 */
  }
}

/** 上传一张：imageBase64 为纯 base64（无 data: 前缀）。返回 'ok' 或错误描述 */
export function cloudUpload(cfg: CloudCfg, meta: CloudMeta, imageBase64: string): string {
  if (!cfg.url) return '未配置服务器';
  const bridge = window.AndroidBridge;
  if (!bridge?.httpPost) return '无上传通道';
  const target =
    cfg.url + '/api/upload?token=' + encodeURIComponent(cfg.token);
  try {
    // 必须对象方式调用：解构成裸函数会被 WebView 判定 non-injected object
    const ret = bridge.httpPost(target, JSON.stringify({ token: cfg.token, meta, image: imageBase64 }));
    return parseUploadRet(ret);
  } catch (e) {
    return '上传异常';
  }
}

/** 大图通道：只传相册 uri，照片字节由原生读取后上传（绕开 JS→Java 桥消息上限） */
export function cloudUploadFile(cfg: CloudCfg, meta: CloudMeta, uri: string): string {
  if (!cfg.url) return '未配置服务器';
  const bridge = window.AndroidBridge;
  if (!bridge?.httpPostFile) return '无上传通道';
  try {
    const ret = bridge.httpPostFile(
      cfg.url + '/api/upload?token=' + encodeURIComponent(cfg.token),
      cfg.token,
      JSON.stringify(meta),
      uri
    );
    const parsed = parseUploadRet(ret);
    if (parsed !== 'ok') {
      try {
        localStorage.setItem('geocam.cloud.lasterr', String(ret || '上传失败').slice(0, 300));
      } catch {
        /* ignore */
      }
    }
    return parsed;
  } catch (e) {
    try {
      localStorage.setItem('geocam.cloud.lasterr', 'EX:' + String((e as Error)?.message ?? e));
    } catch {
      /* ignore */
    }
    return '上传异常';
  }
}

/** 连通性测试（GET /api/ping）：必须收到台账服务的 JSON 响应才算通 */
export function cloudPing(cfg: CloudCfg): string {
  if (!cfg.url) return '未配置服务器';
  const bridge = window.AndroidBridge;
  if (!bridge?.httpGet) return '无上传通道';
  try {
    const ret = bridge.httpGet(cfg.url + '/api/ping?token=' + encodeURIComponent(cfg.token));
    if (!ret) return '连接失败';
    if (ret.startsWith('ok')) {
      return ret.includes('"ok":true') ? 'ok' : '被中继/代理拦截（非台账服务响应）';
    }
    return ret.slice(0, 60);
  } catch {
    return '连接异常';
  }
}

/* ---------- 异步通道（后台线程上传，UI 零阻塞） ---------- */

type Done = (r: string) => void;
let cbSeq = 0;
const cbMap = new Map<number, Done>();

function regCb(done: Done): string {
  const id = ++cbSeq;
  cbMap.set(id, done);
  return `window.__txAsyncDone(${id},%RET%)`;
}

declare global {
  interface Window {
    __txAsyncDone?: (id: number, ret: string) => void;
  }
}
window.__txAsyncDone = (id: number, ret: string) => {
  const d = cbMap.get(id);
  cbMap.delete(id);
  if (d) d(parseUploadRet(String(ret)));
};

/** 异步上传：多线路择优（内网快、外网兜底），连接级失败自动换线；返回 false 表示无桥 */
export function cloudUploadAsync(cfg: CloudCfg, meta: CloudMeta, imageBase64: string, done: Done): boolean {
  const bridge = window.AndroidBridge;
  const eps = endpoints(cfg);
  if (!eps.length || !bridge?.httpPostAsync) return false;
  const body = JSON.stringify({ token: cfg.token, meta, image: imageBase64 });
  let idx = 0;
  const next = () => {
    if (idx >= eps.length) return; // done 已在最后一次回调
    const ep = eps[idx++];
    try {
      bridge.httpPostAsync!(
        ep.base + '/api/upload?token=' + encodeURIComponent(cfg.token),
        body,
        regCb((r) => {
          if (r === 'ok') {
            markOk(ep.tag);
            done('ok');
          } else if (isConnErr(r) && idx < eps.length) {
            next(); // 本条线路不通，立即换下一条
          } else {
            done(r);
          }
        }),
        ep.ms
      );
    } catch {
      if (idx < eps.length) next();
      else done('上传异常');
    }
  };
  next();
  return true;
}

/** 异步测连（同样多线路） */
export function cloudPingAsync(cfg: CloudCfg, done: Done): boolean {
  const bridge = window.AndroidBridge;
  const eps = endpoints(cfg);
  if (!eps.length || !bridge?.httpGetAsync) return false;
  let idx = 0;
  const next = () => {
    if (idx >= eps.length) return;
    const ep = eps[idx++];
    try {
      bridge.httpGetAsync!(
        ep.base + '/api/ping?token=' + encodeURIComponent(cfg.token),
        regCb((r) => {
          if (r === 'ok') {
            markOk(ep.tag);
            done('ok');
          } else if (isConnErr(r) && idx < eps.length) {
            next();
          } else {
            done(r === 'ok' ? 'ok' : r);
          }
        }),
        ep.ms
      );
    } catch {
      if (idx < eps.length) next();
      else done('连接异常');
    }
  };
  next();
  return true;
}

/** 异步补传队列：逐张后台传；成功才出队，失败保留——中途杀进程不丢照片 */
export function flushQueueAsync(cfg: CloudCfg, done?: (n: number, fails: string[]) => void) {
  const q = readQueue();
  if (!cfg.on || !(cfg.url || cfg.lan) || !q.length) {
    done?.(0, []);
    return;
  }
  let n = 0;
  const fails: string[] = [];
  const rest: QueueItem[] = [];
  const step = (i: number) => {
    if (i >= q.length) {
      /* 全部走完才写回：只保留失败项 */
      try {
        if (rest.length) localStorage.setItem(K_QUEUE, JSON.stringify(rest));
        else localStorage.removeItem(K_QUEUE);
      } catch {
        /* ignore */
      }
      done?.(n, fails);
      return;
    }
    const it = q[i];
    const finish = (r: string) => {
      if (r === 'ok') n++;
      else {
        fails.push(r);
        rest.push(it);
      }
      setTimeout(() => step(i + 1), 150);
    };
    if (it.uri) {
      finish(cloudUploadFile(cfg, it.meta, it.uri)); // 旧格式队列项走文件通道（少见）
    } else if (it.image) {
      if (!cloudUploadAsync(cfg, it.meta, it.image, finish)) {
        finish('no-async');
      }
    } else {
      finish('no-payload');
    }
  };
  step(0);
}

/* ---------- 离线补传队列（最多 5 张，防 localStorage 撑爆） ---------- */

interface QueueItem {
  meta: CloudMeta;
  image?: string;
  uri?: string;
}

export function readQueue(): QueueItem[] {
  try {
    const q = JSON.parse(localStorage.getItem(K_QUEUE) || '[]');
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

export function enqueue(item: QueueItem) {
  try {
    const q = readQueue();
    q.push(item);
    while (q.length > 5) q.shift(); // 只保最近 5 张
    localStorage.setItem(K_QUEUE, JSON.stringify(q));
  } catch {
    /* 超配额丢弃最旧策略已尽力 */
  }
}

/** 补传队列，返回成功张数 */
export function flushQueue(cfg: CloudCfg): number {
  if (!cfg.on || !cfg.url) return 0;
  const q = readQueue();
  if (!q.length) return 0;
  const rest: QueueItem[] = [];
  let n = 0;
  for (const it of q) {
    const r = it.uri
      ? cloudUploadFile(cfg, it.meta, it.uri)
      : it.image
        ? cloudUpload(cfg, it.meta, it.image)
        : 'no-payload';
    if (r === 'ok') n++;
    else rest.push(it);
  }
  try {
    if (rest.length) localStorage.setItem(K_QUEUE, JSON.stringify(rest));
    else localStorage.removeItem(K_QUEUE);
  } catch {
    /* ignore */
  }
  return n;
}
