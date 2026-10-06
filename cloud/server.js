/* 天象云台账 v2 · Node 18+，唯一依赖 exceljs（嵌图导出用）
 * 能力：设备注册审批、管理会话、台账 CRUD、地图点位、CSV / 嵌图 Excel 导出
 * 数据：DATA_DIR/ledger.jsonl + devices.jsonl + photos/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '9800', 10);
const TOKEN = process.env.TOKEN || 'tianxiang2026';        // 兼容旧的访问令牌（网页直链/查询）
const INVITE = process.env.INVITE_CODE || 'tx888';   // 设备注册邀请码（App 填）
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'admin888'; // 管理后台密码
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const PHOTOS = path.join(DATA, 'photos');
const LEDGER = path.join(DATA, 'ledger.jsonl');
const DEVICES = path.join(DATA, 'devices.jsonl');
fs.mkdirSync(PHOTOS, { recursive: true });
if (!fs.existsSync(LEDGER)) fs.writeFileSync(LEDGER, '');
if (!fs.existsSync(DEVICES)) fs.writeFileSync(DEVICES, '');

/* 管理会话：token -> 过期时间（12h） */
const sessions = new Map();
function newSession() {
  const t = crypto.randomBytes(12).toString('hex');
  sessions.set(t, Date.now() + 12 * 3600 * 1000);
  return t;
}
function isAdmin(t) {
  const exp = sessions.get(t);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(t); return false; }
  return true;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-token,x-admin');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new Error('too-large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function loadJsonl(f) {
  try {
    return fs
      .readFileSync(f, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}
function saveJsonl(f, rows) {
  fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}
const num = (s) => {
  const m = String(s || '').match(/(-?\d+(?:\.\d+)?)\D*([NSEW])/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (m[2] === 'S' || m[2] === 'W') v = -v;
  return v;
};

const COLS = [
  ['fileName', '文件名'], ['project', '工程名称'], ['note', '施工内容'],
  ['time', '拍摄时间'], ['lat', '纬度'], ['lng', '经度'], ['alt', '海拔'],
  ['addr', '地址'], ['weather', '天气'], ['style', '水印样式'],
  ['deviceName', '拍摄设备'], ['uploadedAt', '上传时间'], ['url', '照片'],
];

function filtered(q, rows) {
  rows = rows || loadJsonl(LEDGER);
  if (q.project) rows = rows.filter((r) => (r.project || '') === q.project);
  if (q.device) rows = rows.filter((r) => r.deviceId === q.device);
  if (q.day) rows = rows.filter((r) => (r.time || '').startsWith(q.day));
  if (q.from) rows = rows.filter((r) => (r.time || '') >= q.from);
  if (q.to) rows = rows.filter((r) => (r.time || '').slice(0, 10) <= q.to);
  if (q.kw) {
    const kw = q.kw.toLowerCase();
    rows = rows.filter((r) =>
      [r.note, r.addr, r.project, r.fileName, r.deviceName].some((s) => (s || '').toLowerCase().includes(kw)));
  }
  return rows.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
}
const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** 从 JPEG 字节读原始宽高（SOF 标记），失败按 9:16 竖图估 */
function jpegDims(buf) {
  try {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  } catch { /* fallthrough */ }
  return { w: 1080, h: 1920 };
}

const IMG_BOX = { w: 100, h: 140 };   // 照片格内最大显示框（px）
const PHOTO_COL_PX = 117;             // 照片列宽 16 字符 ≈ 16*7+5 px
const ROW_H_PT = 112;                 // 数据行高（pt）≈ 149px，略大于 140 图框

async function exportXlsx(rows, res) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('台账');
  ws.columns = COLS.map((c) => ({
    header: c[1], key: c[0], width: c[0] === 'url' ? 16 : 22,
  }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FF17181A' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD028' } };
  const rowHpx = ROW_H_PT / 0.75;
  for (const r of rows.slice(0, 2000)) {
    const values = Object.fromEntries(
      COLS.map((c) => [c[0], c[0] === 'url' ? '' : r[c[0]]])
    );
    const row = ws.addRow(values);
    row.height = ROW_H_PT;
    try {
      const f = path.join(DATA, r.url || '');
      if (r.url && fs.existsSync(f)) {
        const buf = fs.readFileSync(f);
        const { w, h } = jpegDims(buf);
        const sc = Math.min(IMG_BOX.w / w, IMG_BOX.h / h);
        const dw = Math.max(20, Math.round(w * sc));
        const dh = Math.max(20, Math.round(h * sc));
        // 单元格内居中：exceljs native 锚点，偏移单位 EMU（1px = 9525 EMU）
        const id = wb.addImage({ buffer: buf, extension: 'jpg' });
        ws.addImage(id, {
          tl: {
            nativeCol: 12,
            nativeColOff: Math.round(((PHOTO_COL_PX - dw) / 2) * 9525),
            nativeRow: row.number - 1,
            nativeRowOff: Math.round(((rowHpx - dh) / 2) * 9525),
          },
          ext: { width: dw, height: dh },
          editAs: 'oneCell',
        });
      }
    } catch { /* 单张失败不阻断 */ }
  }
  res.writeHead(200, {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('天象云台账-含照片.xlsx'),
  });
  await wb.xlsx.write(res);
  res.end();
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = Object.fromEntries(u.searchParams);
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const token = req.headers['x-token'] || q.token || '';
  const admin = req.headers['x-admin'] || q.admin || '';
  const viewer = token === TOKEN || isAdmin(admin);

  /* 静态页 */
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    fs.readFile(path.join(__dirname, 'web', 'index.html'), (e, buf) => {
      if (e) { res.writeHead(500); res.end('no web'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
    return;
  }
  /* 照片文件 */
  if (req.method === 'GET' && u.pathname.startsWith('/photos/')) {
    const f = path.join(PHOTOS, path.basename(u.pathname));
    if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' });
    fs.createReadStream(f).pipe(res);
    return;
  }

  /* 管理登录 */
  if (req.method === 'POST' && u.pathname === '/api/admin/login') {
    readBody(req, 1024 * 1024).then((b) => {
      let pw = '';
      try { pw = JSON.parse(b.toString('utf-8')).password || ''; } catch { /* */ }
      if (pw === ADMIN_PW) json(res, 200, { ok: true, admin: newSession() });
      else json(res, 401, { ok: false, err: 'bad-password' });
    }).catch(() => json(res, 400, { ok: false }));
    return;
  }

  /* 上传（设备审批制） */
  if (req.method === 'POST' && u.pathname === '/api/upload') {
    readBody(req, 48 * 1024 * 1024).then(async (buf) => {
      let j;
      try { j = JSON.parse(buf.toString('utf-8')); } catch { json(res, 400, { ok: false, err: 'bad-json' }); return; }
      const meta = j.meta || {};
      const devId = String(meta.deviceId || 'unknown');
      const devices = loadJsonl(DEVICES);
      let dev = devices.find((d) => d.id === devId);
      if (!dev) {
        if (String(j.token || '') !== INVITE) { json(res, 401, { ok: false, err: 'bad-invite' }); return; }
        dev = {
          id: devId, name: meta.deviceName || devId,
          status: 'pending', createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
          lastSeen: '', count: 0,
        };
        devices.push(dev);
        saveJsonl(DEVICES, devices);
        json(res, 403, { ok: false, err: 'pending-approval' });
        return;
      }
      if (dev.status === 'pending') { json(res, 403, { ok: false, err: 'pending-approval' }); return; }
      if (dev.status === 'blocked') { json(res, 403, { ok: false, err: 'blocked' }); return; }
      if (!j.image) { json(res, 400, { ok: false, err: 'missing-fields' }); return; }
      let img;
      try { img = Buffer.from(String(j.image).replace(/^data:image\/\w+;base64,/, ''), 'base64'); }
      catch { json(res, 400, { ok: false, err: 'bad-base64' }); return; }
      if (img.length < 100) { json(res, 400, { ok: false, err: 'empty-image' }); return; }
      const id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      const fname = id + '.jpg';
      fs.writeFileSync(path.join(PHOTOS, fname), img);
      const row = Object.assign({}, meta, {
        id, deviceId: devId, url: '/photos/' + fname, size: img.length,
        latNum: num(meta.lat), lngNum: num(meta.lng),
        uploadedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      });
      fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n');
      dev.lastSeen = row.uploadedAt;
      dev.count = (dev.count || 0) + 1;
      saveJsonl(DEVICES, devices);
      json(res, 200, { ok: true, id, url: row.url });
    }).catch(() => json(res, 413, { ok: false, err: 'too-large' }));
    return;
  }

  /* 连通性探测：公开，不带数据 */
  if (req.method === 'GET' && u.pathname === '/api/ping') {
    json(res, 200, { ok: true, app: 'tianxiang-ledger', v: 2, ts: Date.now() });
    return;
  }

  /* ---- 以下查询类接口：旧 token 或管理会话均可 ---- */
  if (!viewer) { json(res, 401, { ok: false, err: 'bad-token' }); return; }

  if (req.method === 'GET' && u.pathname === '/api/list') {
    const rows = filtered(q);
    const limit = q.limit ? parseInt(q.limit, 10) : 0;
    json(res, 200, { ok: true, total: rows.length, rows: limit ? rows.slice(0, limit) : rows });
    return;
  }
  if (req.method === 'GET' && u.pathname === '/api/stats') {
    const rows = filtered(q);
    const byDay = {};
    const byProject = {};
    for (const r of rows) {
      const d = (r.time || '').slice(0, 10);
      if (d) byDay[d] = (byDay[d] || 0) + 1;
      if (r.project) byProject[r.project] = (byProject[r.project] || 0) + 1;
    }
    /* 台账时间是北京时间：today 按 Asia/Shanghai 取日期（UTC 会早 8 小时翻天） */
    const todayStr = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '.');
    const devices = loadJsonl(DEVICES);
    json(res, 200, {
      ok: true, total: rows.length,
      today: byDay[todayStr] || 0,
      days: Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30),
      projects: byProject,
      pending: devices.filter((d) => d.status === 'pending').length,
      active: devices.filter((d) => d.status === 'ok').length,
    });
    return;
  }
  if (req.method === 'GET' && u.pathname === '/api/projects') {
    const set = {};
    for (const r of loadJsonl(LEDGER)) if (r.project) set[r.project] = (set[r.project] || 0) + 1;
    json(res, 200, { ok: true, projects: set });
    return;
  }
  if (req.method === 'GET' && u.pathname === '/api/export.csv') {
    const rows = filtered(q);
    const lines = [COLS.map((c) => c[1]).join(',')];
    for (const r of rows) lines.push(COLS.map((c) => csvCell(r[c[0]])).join(','));
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('天象云台账.csv'),
    });
    res.end('\ufeff' + lines.join('\r\n'));
    return;
  }
  if (req.method === 'GET' && u.pathname === '/api/export.xlsx') {
    exportXlsx(filtered(q), res).catch((e) => json(res, 500, { ok: false, err: String(e.message || e) }));
    return;
  }
  if (req.method === 'DELETE' && u.pathname === '/api/delete') {
    /* 删除是破坏性操作：只读 TOKEN 不可删，必须管理会话 */
    if (!isAdmin(admin)) { json(res, 401, { ok: false, err: 'need-admin' }); return; }
    const rows = loadJsonl(LEDGER);
    const hit = rows.find((r) => r.id === (q.id || ''));
    if (!hit) { json(res, 404, { ok: false, err: 'not-found' }); return; }
    try {
      const f = path.join(DATA, hit.url || '');
      if (hit.url && fs.existsSync(f)) fs.unlinkSync(f);
    } catch { /* ignore */ }
    saveJsonl(LEDGER, rows.filter((r) => r.id !== hit.id));
    json(res, 200, { ok: true });
    return;
  }

  /* ---- 管理接口：仅管理会话 ---- */
  if (u.pathname.startsWith('/api/admin/')) {
    if (!isAdmin(admin)) { json(res, 401, { ok: false, err: 'need-admin' }); return; }
    if (u.pathname === '/api/admin/devices') {
      json(res, 200, { ok: true, devices: loadJsonl(DEVICES) });
      return;
    }
    if (u.pathname === '/api/admin/set') {
      const id = q.id || '';
      const status = ['ok', 'pending', 'blocked'].includes(q.status) ? q.status : '';
      if (!status) { json(res, 400, { ok: false }); return; }
      const devices = loadJsonl(DEVICES);
      const d = devices.find((x) => x.id === id);
      if (!d) { json(res, 404, { ok: false, err: 'no-device' }); return; }
      d.status = status;
      saveJsonl(DEVICES, devices);
      json(res, 200, { ok: true });
      return;
    }
    if (u.pathname === '/api/admin/del-device') {
      saveJsonl(DEVICES, loadJsonl(DEVICES).filter((d) => d.id !== q.id));
      json(res, 200, { ok: true });
      return;
    }
    json(res, 404, { ok: false });
    return;
  }

  json(res, 404, { ok: false, err: 'no-route' });
});

function onUp() {
  console.log(`天象云台账 v2 listening on :${PORT} (IPv6 双栈)  data=${DATA}`);
  console.log(`管理后台密码=${ADMIN_PW === 'admin888' ? 'admin888（请尽快在 compose 里修改！）' : '（已自定义）'}  邀请码=${INVITE === 'tx888' ? 'tx888（可修改）' : '（已自定义）'}`);
}
/* 优先 IPv6 双栈监听（v4 连接以 ::ffff: 形式进入），无 IPv6 环境自动回退 */
server.once('error', (e) => {
  console.log('IPv6 监听失败，回退 IPv4：' + e.message);
  server.listen(PORT, '0.0.0.0', onUp);
});
server.listen(PORT, '::', onUp);
