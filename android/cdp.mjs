// CDP 走查工具：node cdp.mjs eval '<js expr>'   |   node cdp.mjs click <x> <y>
const [cmd, ...rest] = process.argv.slice(2);
const targets = await (await fetch('http://localhost:9222/json')).json();
const page = targets.find(t => t.type === 'page' && !JSON.parse(t.description || '{}').empty);
if (!page) { console.error('no visible page target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
function send(method, params) {
  return new Promise((res, rej) => {
    const mid = ++id;
    pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id); pend.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
};
await new Promise(r => ws.onopen = r);

if (cmd === 'eval') {
  const expr = rest.join(' ');
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value ?? r, null, 2));
} else if (cmd === 'click') {
  const [x, y] = rest.map(Number);
  // 可信输入事件：按下+抬起，赋予用户激活（data:URL 下载必需）
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  console.log('clicked', x, y);
} else if (cmd === 'drageval') {
  // 先点击页面中心确保有用户激活，再执行表达式
  const expr = rest.slice(2).join(' ');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rest[0], y: rest[1], button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rest[0], y: rest[1], button: 'left', clickCount: 1, buttons: 0 });
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value ?? r, null, 2));
} else if (cmd === 'log') {
  await send('Runtime.enable');
  const entries = await send('Log.enable').then(() => new Promise(r => {
    const out = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Log.entryAdded') out.push(m.params.entry);
    };
    setTimeout(() => r(out), 2500);
  }));
  console.log(JSON.stringify(entries.slice(-15), null, 2));
}
ws.close();
process.exit(0);
