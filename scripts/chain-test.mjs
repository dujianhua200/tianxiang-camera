/* 存证测试：暗水印嵌入/读取 + 哈希链追加/校验
 * 运行：node scripts/chain-test.mjs   （需先 npm install）
 * 编译 src/lib/provenance.ts 为 CommonJS 后，用内存 localStorage mock 验证：
 *  1. 暗水印嵌入→读取往返，载荷一致
 *  2. 无暗水印的 JPEG 读取返回 null
 *  3. 非 JPEG 嵌入原样返回
 *  4. 像素被篡改 → sha256 变化（链能发现）
 *  5. 链：追加3条全部 ok；改一条 hash 报 tampered；照片缺失报 missing；prev 断裂 chainOk=false
 *  6. dataURL 往返
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'txc-'));
writeFileSync(join(dir, 'shim.d.ts'), 'declare var window: any;\n');
execSync(
  `npx tsc src/lib/provenance.ts "${join(dir, 'shim.d.ts')}" --outDir "${dir}" --module commonjs --target es2020 --lib es2020,dom --skipLibCheck`,
  { stdio: 'pipe' }
);

/* 内存 localStorage mock */
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: (k) => store.delete(k),
};

const p = createRequire(join(dir, 'x.js'))(join(dir, 'provenance.js'));

/* 合成最小 JPEG：SOI + APP0 + DQT + SOF0 + SOS + 熵数据 + EOI */
function fakeJpeg() {
  const seg = (marker, bodyLen) => {
    const s = new Uint8Array(2 + 2 + bodyLen);
    s[0] = 0xff;
    s[1] = marker;
    s[2] = ((bodyLen + 2) >> 8) & 0xff;
    s[3] = (bodyLen + 2) & 0xff;
    return s;
  };
  const parts = [
    new Uint8Array([0xff, 0xd8]),
    seg(0xe0, 14), // APP0 JFIF
    seg(0xdb, 65), // DQT
    seg(0xc0, 17), // SOF0
    new Uint8Array([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), // SOS
    new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55]),
    new Uint8Array([0xff, 0xd9]),
  ];
  const total = parts.reduce((a, x) => a + x.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const x of parts) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass++;
    console.log('  ✓', name);
  } else {
    fail++;
    console.log('  ✗', name);
  }
};

const run = async () => {
  const jpg = fakeJpeg();
  const payload = {
    v: 1,
    id: 123,
    ts: 1728280000000,
    lat: 32.170357,
    lng: 114.051486,
    project: '市政道路改造工程',
    note: '路基压实度检测',
    prev: 'GENESIS',
  };

  /* 1. 嵌入→读取往返 */
  const sealed = p.embedTxwm(jpg, payload);
  ok('嵌入后仍是 JPEG', sealed[0] === 0xff && sealed[1] === 0xd8);
  const back = p.readTxwm(sealed);
  ok(
    '读取载荷一致',
    !!back &&
      back.id === 123 &&
      back.lat === 32.170357 &&
      back.lng === 114.051486 &&
      back.project === '市政道路改造工程' &&
      back.prev === 'GENESIS'
  );

  /* 2. 无暗水印 */
  ok('无暗水印返回 null', p.readTxwm(jpg) === null);

  /* 3. 非 JPEG */
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  ok('非 JPEG 原样返回', p.embedTxwm(png, payload) === png);
  ok('非 JPEG 读取 null', p.readTxwm(png) === null);

  /* 4. 篡改检测 */
  const h1 = await p.sha256Hex(sealed);
  const evil = sealed.slice();
  evil[evil.length - 3] ^= 0x01;
  const h2 = await p.sha256Hex(evil);
  ok('sha256 长度 64', h1.length === 64);
  ok('篡改后 hash 变化', h1 !== h2);

  /* 5. 哈希链 */
  const mk = (id, prev) => ({ id, hash: 'h' + id, prev, ts: id, fileName: `p${id}.jpg` });
  p.appendChain(mk(1, 'GENESIS'));
  p.appendChain(mk(2, 'h1'));
  p.appendChain(mk(3, 'h2'));
  const chain = p.readChain();
  ok('链长 3', chain.length === 3);
  ok('tip 是最后一条', p.chainTip().id === 3);

  /* verify 需要真实 hash：用 sealPhoto 走完整流程 */
  store.clear();
  const urlOf = (bytes) => p.bytesToDataUrl(bytes);
  const s1 = await p.sealPhoto(urlOf(fakeJpeg()), { ...payload, id: 11, fileName: 'a.jpg' });
  const s2 = await p.sealPhoto(urlOf(fakeJpeg()), { ...payload, id: 22, fileName: 'b.jpg' });
  ok('第二条 prev 指向第一条 hash', s2.prev === s1.hash);
  let rep = await p.verifyChain([
    { id: 11, dataUrl: s1.dataUrl },
    { id: 22, dataUrl: s2.dataUrl },
  ]);
  ok('链自洽', rep.chainOk);
  ok('两张都 ok', rep.entries.every((e) => e.status === 'ok'));

  /* 篡改第二张 */
  const evilBytes = p.dataUrlToBytes(s2.dataUrl);
  evilBytes[evilBytes.length - 4] ^= 0x02;
  rep = await p.verifyChain([
    { id: 11, dataUrl: s1.dataUrl },
    { id: 22, dataUrl: p.bytesToDataUrl(evilBytes) },
  ]);
  ok('篡改被检出', rep.entries.find((e) => e.entry.id === 22).status === 'tampered');
  ok('链自洽不受照片篡改影响', rep.chainOk);

  /* 照片缺失 */
  rep = await p.verifyChain([{ id: 11, dataUrl: s1.dataUrl }]);
  ok('缺失照片报 missing', rep.entries.find((e) => e.entry.id === 22).status === 'missing');

  /* 账本断裂 */
  store.clear();
  p.appendChain(mk(1, 'GENESIS'));
  p.appendChain(mk(2, 'WRONG'));
  rep = await p.verifyChain([]);
  ok('prev 断裂被检出', !rep.chainOk && rep.brokenAt === 1);

  /* 6. dataURL 往返 */
  const rt = p.dataUrlToBytes(p.bytesToDataUrl(sealed));
  ok('dataURL 往返字节一致', rt.length === sealed.length && rt.every((b, i) => b === sealed[i]));

  console.log(`\n${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
