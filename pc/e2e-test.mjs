/* 无头 Chrome 功能链路测试：加载页面→注入图片→高德地址→历史天气→canvas 合成 */
const BASE = 'http://127.0.0.1:8899/天象七星批量水印.html';
const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
let page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (method, params) =>
  new Promise((res, rej) => {
    const mid = ++id;
    pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
};
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable', {});
await send('Page.enable', {});
await send('Page.navigate', { url: BASE });
await new Promise((r) => setTimeout(r, 3000));

const expr = `(async () => {
  // 1. 造一行：拉一张真实 jpg 进 rows
  const blob = await (await fetch('/test.jpg')).blob();
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; url && (img.src = url); });
  rows.push({ file: new File([blob], '测试照片.jpg'), url, img, name: '测试照片.jpg',
    time: new Date('2026-09-10T22:41:00'), lat: '32.170357', lng: '114.051485',
    addr: '', weather: '', note: '基站立杆', status: 'wait' });
  render();
  // 2. 高德地址
  const addr = await amapRegeo(32.170357, 114.051485);
  // 3. 历史天气（2026-09-10 信阳）
  const wx = await weatherFor(32.170357, 114.051485, new Date('2026-09-10T22:41:00'));
  // 4. 合成
  rows[0].addr = addr; rows[0].weather = wx;
  const out = await composeOne(rows[0]);
  const buf = new Uint8Array(await out.arrayBuffer());
  return JSON.stringify({
    addr, wx,
    outKB: Math.round(buf.length / 1024),
    jpeg: buf[0] === 0xff && buf[1] === 0xd8,
    zipOK: typeof makeZip === 'function',
  });
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log('RESULT:', r.result?.value ?? JSON.stringify(r).slice(0, 300));
ws.close();
process.exit(0);
