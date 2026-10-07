/* 照片合成：画面帧 + 矢量水印绘制（8 套样式，与 WatermarkCard 视觉对应） */
import type { WatermarkTemplate } from './templates';
import { tplRowValue, tplFieldOn, getTemplate, getActiveTemplateId } from './templates';

export interface WMFields {
  date: boolean;
  addr: boolean;
  lng: boolean;
  lat: boolean;
  alt: boolean;
  weather: boolean;
  project: boolean;
  note: boolean;
}

export type WMStyle = 'card' | 'hero' | 'strip' | 'stamp' | 'site' | 'today' | 'todayWork' | 'tpl';

export interface WatermarkData {
  timeStr: string;
  dateStr: string;
  weekdayStr: string;
  address: string;
  latStr: string;
  lngStr: string;
  altLine: string;
  weather: string;
  project: string;
  note: string;
  sourceLabel: string;
  /* 七星台账模板专用 */
  siteTime: string; // 2026.09.10 22:41
  siteLng: string; // 114.051486°E
  siteLat: string; // 32.170357°N
}

/* Lucide 风格图标（24 网格） */
type IconName = 'pin' | 'nav' | 'mountain' | 'case' | 'note' | 'therm';

function iconPath(name: IconName): Path2D {
  let p: Path2D;
  switch (name) {
    case 'pin':
      p = new Path2D('M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z');
      p.moveTo(15, 10);
      p.arc(12, 10, 3, 0, Math.PI * 2);
      return p;
    case 'nav':
      return new Path2D('M3 11l19-9-9 19-2-8-8-2Z');
    case 'mountain':
      return new Path2D('m8 3 4 8 5-5 5 15H2L8 3z');
    case 'case':
      p = new Path2D('M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16');
      p.rect(2, 6, 20, 14);
      return p;
    case 'note':
      p = new Path2D('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z');
      p.moveTo(14, 2);
      p.lineTo(14, 6);
      p.lineTo(18, 6);
      p.moveTo(8, 13);
      p.lineTo(16, 13);
      p.moveTo(8, 17);
      p.lineTo(13, 17);
      return p;
    case 'therm':
      return new Path2D('M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z');
  }
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  x: number,
  y: number,
  size: number,
  color: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.stroke(iconPath(name));
  ctx.restore();
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const lines: string[] = [];
  let cur = '';
  let idx = 0;
  while (idx < text.length) {
    const ch = text[idx];
    if (cur && ctx.measureText(cur + ch).width > maxW) {
      lines.push(cur);
      cur = '';
      if (lines.length === maxLines) break;
    } else {
      cur += ch;
      idx++;
    }
  }
  if (lines.length < maxLines && cur) {
    lines.push(cur);
    idx = text.length;
  }
  if (idx < text.length && lines.length > 0) {
    lines[lines.length - 1] = ellipsize(ctx, lines[lines.length - 1] + text.slice(idx), maxW);
  }
  return lines;
}

function shadowOn(ctx: CanvasRenderingContext2D, S: number) {
  ctx.shadowColor = 'rgba(0,0,0,0.62)';
  ctx.shadowBlur = 2.6 * S;
  ctx.shadowOffsetY = 1.1 * S;
}

function shadowOff(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

const MONO = '"JetBrains Mono","Noto Sans Mono",ui-monospace,monospace';
const SANS = '"Noto Sans SC",system-ui,sans-serif';

export interface ComposeInput {
  video: HTMLVideoElement | null;
  image: HTMLImageElement | null;
  mirrored: boolean;
  wmPos: 'bottom' | 'top';
  wmStyle: WMStyle;
  data: WatermarkData;
  fields: WMFields;
  /** 水印缩放（0.6–1.5，默认 1）与整体透明度（0.4–1，默认 1） */
  wmScale?: number;
  wmAlpha?: number;
}

interface InfoRow {
  icon: IconName;
  lines: string[];
  mono?: boolean;
}

/** 通用信息行（地址/经纬度/海拔/工程/备注），按开关过滤 */
function buildRows(
  d: WatermarkData,
  f: WMFields,
  addrLines: string[]
): InfoRow[] {
  const rows: InfoRow[] = [];
  if (addrLines.length) rows.push({ icon: 'pin', lines: addrLines });
  const coordLines: string[] = [];
  if (f.lat) coordLines.push(d.latStr);
  if (f.lng) coordLines.push(d.lngStr);
  if (coordLines.length) rows.push({ icon: 'nav', lines: coordLines, mono: true });
  if (f.alt && d.altLine) rows.push({ icon: 'mountain', lines: [d.altLine] });
  if (f.project && d.project) rows.push({ icon: 'case', lines: [d.project] });
  if (f.note && d.note) rows.push({ icon: 'note', lines: [d.note] });
  return rows;
}

/* ================= 样式 1：工程卡片（默认） ================= */
function drawCardStyle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: ComposeInput
) {
  const { data: d, fields: f } = input;
  const sc = input.wmScale || 1; // 水印大小滑杆
  const m = Math.round(Math.min(W, H) * 0.032);
  const portrait = H > W;
  const cardW = Math.min(Math.round((portrait ? W - m * 2 : Math.min(W - m * 2, Math.round(Math.min(W * 0.56, H * 0.95)))) * sc), W - m * 2);
  const S = (cardW / 100);
  const pad = 4 * S;
  const tx = m + pad + 3.4 * S;
  const contentW = m + cardW - pad - tx;

  const fTime = `700 ${9.2 * S}px ${MONO}`;
  const fSub = `500 ${3.4 * S}px ${SANS}`;
  const fRow = `500 ${3.45 * S}px ${SANS}`;
  const fRowMono = `500 ${3.3 * S}px ${MONO}`;

  ctx.font = fRow;
  let addrLines: string[] = [];
  if (f.addr && d.address) addrLines = wrapText(ctx, d.address, contentW - 6.4 * S, 2);

  let totalH = pad * 2;
  totalH += 11.8 * S;
  const dateRowH = 4.4 * S;
  if (f.date || (f.weather && d.weather)) totalH += dateRowH;
  const rows = buildRows(d, f, addrLines);

  const hasRows = rows.length > 0;
  if (hasRows) totalH += 3.2 * S + 1 + 2.4 * S;
  for (const r of rows) totalH += r.lines.length * 4.7 * S + 1.6 * S;

  const x = m;
  const y = input.wmPos === 'bottom' ? H - m - totalH : m;

  ctx.save();
  rr(ctx, x, y, cardW, totalH, 3.4 * S);
  ctx.fillStyle = 'rgba(8,10,13,0.60)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, W * 0.0007);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();

  const grad = ctx.createLinearGradient(0, y, 0, y + totalH);
  grad.addColorStop(0, '#FFD028');
  grad.addColorStop(1, '#FF7A00');
  rr(ctx, x + pad, y + pad, 1.25 * S, totalH - pad * 2, 999);
  ctx.fillStyle = grad;
  ctx.fill();

  let cy = y + pad + 0.4 * S;

  ctx.font = fTime;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(d.timeStr, tx, cy + 8.6 * S);

  cy += 11.8 * S;

  if (f.date || (f.weather && d.weather)) {
    ctx.font = fSub;
    ctx.fillStyle = 'rgba(232,236,240,0.85)';
    if (f.date) ctx.fillText(`${d.dateStr} ${d.weekdayStr}`, tx, cy + dateRowH - 1.1 * S);
    if (f.weather && d.weather) {
      const wt = ellipsize(ctx, d.weather, contentW * 0.42);
      const wtw = ctx.measureText(wt).width;
      const wx = x + cardW - pad - wtw - 4.6 * S;
      drawIcon(ctx, 'therm', wx, cy + (dateRowH - 3.4 * S) / 2, 3.4 * S, '#FFD028');
      ctx.fillStyle = 'rgba(232,236,240,0.85)';
      ctx.fillText(wt, wx + 4.6 * S, cy + dateRowH - 1.1 * S);
    }
    cy += dateRowH;
  }

  if (hasRows) {
    cy += 3.2 * S;
    ctx.beginPath();
    ctx.moveTo(x + pad, cy);
    ctx.lineTo(x + cardW - pad, cy);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, W * 0.0005);
    ctx.setLineDash([2.2 * S, 2.2 * S]);
    ctx.stroke();
    ctx.setLineDash([]);
    cy += 2.4 * S;
  }

  const iconX = tx;
  const textX = tx + 6.4 * S;
  for (const r of rows) {
    ctx.font = r.mono ? fRowMono : fRow;
    const firstBase = cy + 3.7 * S;
    drawIcon(ctx, r.icon, iconX, firstBase - 3 * S, 3.7 * S, '#FFD028');
    r.lines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.96)' : 'rgba(230,234,238,0.9)';
      ctx.fillText(
        r.mono ? line : ellipsize(ctx, line, contentW - 6.4 * S),
        textX,
        cy + 3.7 * S + i * 4.7 * S
      );
    });
    cy += r.lines.length * 4.7 * S + 1.6 * S;
  }

  ctx.restore();
}

/* ================= 样式 2：今日大抬头（仿今日相机） ================= */
function drawHeroStyle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: ComposeInput
) {
  const { data: d, fields: f } = input;
  const sc = input.wmScale || 1; // 水印大小滑杆
  const m = Math.round(Math.min(W, H) * 0.032);
  const portrait = H > W;
  const cardW = Math.min(Math.round((portrait ? W - m * 2 : Math.min(W - m * 2, Math.round(Math.min(W * 0.56, H * 0.95)))) * sc), W - m * 2);
  const S = (cardW / 100);

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  /* ---- 顶部大时间 ---- */
  shadowOn(ctx, S);
  ctx.font = `700 ${15 * S}px ${MONO}`;
  ctx.fillStyle = '#FFFFFF';
  const timeY = m + 13.6 * S;
  ctx.fillText(d.timeStr, m, timeY);

  /* ---- 日期 · 星期 · 天气 ---- */
  const sub: string[] = [];
  if (f.date) sub.push(`${d.dateStr} ${d.weekdayStr}`);
  if (f.weather && d.weather) sub.push(d.weather);
  if (sub.length) {
    ctx.font = `500 ${4.4 * S}px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(sub.join('  ·  '), m, timeY + 6.6 * S);
  }
  shadowOff(ctx);

  /* ---- 底部信息行（无卡片，直接压字） ---- */
  ctx.font = `500 ${4.2 * S}px ${SANS}`;
  const maxTextW = W - m * 2 - 6.6 * S;
  let addrLines: string[] = [];
  if (f.addr && d.address) addrLines = wrapText(ctx, d.address, maxTextW, 2);
  const rows = buildRows(d, f, addrLines);
  const lineH = 5.4 * S;
  const rowGap = 1.9 * S;
  let rowsH = 0;
  for (const r of rows) rowsH += r.lines.length * lineH + rowGap;

  let cy = H - m - rowsH;
  for (const r of rows) {
    ctx.font = r.mono ? `500 ${4 * S}px ${MONO}` : `500 ${4.2 * S}px ${SANS}`;
    shadowOn(ctx, S);
    r.lines.forEach((line, i) => {
      const base = cy + 4.1 * S + i * lineH;
      if (i === 0) drawIcon(ctx, r.icon, m, base - 3.6 * S, 4.2 * S, '#FFD028');
      ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.9)';
      ctx.fillText(r.mono ? line : ellipsize(ctx, line, maxTextW), m + 6.6 * S, base);
    });
    shadowOff(ctx);
    cy += r.lines.length * lineH + rowGap;
  }

  ctx.restore();
}

/* ================= 样式 3：信息底栏（通栏） ================= */
function drawStripStyle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: ComposeInput
) {
  const { data: d, fields: f } = input;
  const sc = input.wmScale || 1; // 水印大小滑杆
  const portrait = H > W;
  const S = ((portrait ? W : Math.min(W * 0.56, H * 0.95)) / 100) * sc; // 通栏只缩放字号
  const m = 4.5 * S;
  const pad = 4.2 * S;

  /* 右侧行（宽度 = 总宽 - 左列实占 - 间隙，保证不相交） */
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  /* 左列先定尺寸：时间超 46% 宽则逐级缩字号 */
  const maxLeftW = W * 0.46;
  let tFs = 9.4 * S;
  ctx.font = `700 ${tFs}px ${MONO}`;
  let timeW = ctx.measureText(d.timeStr).width;
  while (timeW > maxLeftW && tFs > 4.2 * S) {
    tFs -= 0.5 * S;
    ctx.font = `700 ${tFs}px ${MONO}`;
    timeW = ctx.measureText(d.timeStr).width;
  }
  const leftW = Math.max(timeW, 26 * S);
  const rightMaxW = Math.max(W * 0.3, W - m * 3 - leftW - 6.5 * S);

  ctx.font = `500 ${3.5 * S}px ${SANS}`;
  const rRows: { icon: IconName; text: string; mono?: boolean }[] = [];
  if (f.addr && d.address)
    rRows.push({ icon: 'pin', text: ellipsize(ctx, d.address, rightMaxW) });
  if (f.lat)
    rRows.push({ icon: 'nav', text: ellipsize(ctx, d.latStr, rightMaxW), mono: true });
  if (f.lng)
    rRows.push({ icon: 'nav', text: ellipsize(ctx, d.lngStr, rightMaxW), mono: true });
  if (f.alt && d.altLine) rRows.push({ icon: 'mountain', text: ellipsize(ctx, d.altLine, rightMaxW) });
  if (f.project && d.project)
    rRows.push({ icon: 'case', text: ellipsize(ctx, d.project, rightMaxW) });
  if (f.note && d.note) rRows.push({ icon: 'note', text: ellipsize(ctx, d.note, rightMaxW) });

  const leftH = pad * 2 + tFs + 1.8 * S + 3.6 * S;
  const rightH = pad * 2 + rRows.length * 4.9 * S;
  const barH = Math.max(leftH, rRows.length ? rightH : leftH);
  const y = H - barH;

  /* 底栏背景 */
  const grad = ctx.createLinearGradient(0, y, 0, H);
  grad.addColorStop(0, 'rgba(8,10,13,0.42)');
  grad.addColorStop(0.35, 'rgba(8,10,13,0.68)');
  grad.addColorStop(1, 'rgba(8,10,13,0.80)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, y, W, barH);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(W, y);
  ctx.strokeStyle = 'rgba(255,208,40,0.45)';
  ctx.lineWidth = Math.max(1, W * 0.0009);
  ctx.stroke();

  /* 左列：时间 + 日期天气（截断到左列宽） */
  ctx.font = `700 ${tFs}px ${MONO}`;
  ctx.fillStyle = '#FFFFFF';
  const tBase = y + pad + tFs * 0.88;
  ctx.fillText(d.timeStr, m, tBase);
  const sub: string[] = [];
  if (f.date) sub.push(`${d.dateStr} ${d.weekdayStr}`);
  if (f.weather && d.weather) sub.push(d.weather);
  if (sub.length) {
    ctx.font = `500 ${3.6 * S}px ${SANS}`;
    ctx.fillStyle = 'rgba(232,236,240,0.85)';
    ctx.fillText(ellipsize(ctx, sub.join(' · '), leftW), m, tBase + 5.4 * S);
  }

  /* 右列：右对齐信息行 */
  const rowH = 4.9 * S;
  const blockH = rRows.length * rowH;
  let cy = y + (barH - blockH) / 2;
  for (const r of rRows) {
    ctx.font = r.mono ? `500 ${3.4 * S}px ${MONO}` : `500 ${3.5 * S}px ${SANS}`;
    const tw = ctx.measureText(r.text).width;
    const textX = W - m - tw;
    const base = cy + 3.6 * S;
    drawIcon(ctx, r.icon, textX - 5.6 * S, base - 3.3 * S, 3.9 * S, '#FFD028');
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(r.text, textX, base);
    cy += rowH;
  }

  ctx.restore();
}

/* ================= 样式 4：打卡印章 ================= */
function drawStampStyle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: ComposeInput
) {
  const { data: d, fields: f } = input;
  const sc = input.wmScale || 1; // 水印大小滑杆
  const m = Math.round(Math.min(W, H) * 0.032);
  const portrait = H > W;
  const cw = Math.min(Math.min(W - m * 2, portrait ? W * 0.86 : W * 0.5) * sc, W - m * 2);
  const S = (cw / 100);
  const pad = 5 * S;
  const tx = m + pad;
  const contentW = m + cw - pad - tx;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 ${3.8 * S}px ${SANS}`;
  let addrLines: string[] = [];
  if (f.addr && d.address) addrLines = wrapText(ctx, d.address, contentW - 6.2 * S, 2);
  const rows = buildRows(d, f, addrLines);

  const headH = 12.6 * S;
  const dateH = (f.date || (f.weather && d.weather) ? 4.8 : 0) * S;
  const rowsH = rows.length ? 3 * S + rows.reduce((a, r) => a + r.lines.length * 4.9 * S + 1.5 * S, 0) : 0;
  const totalH = pad * 2 + headH + dateH + rowsH;
  const y = input.wmPos === 'bottom' ? H - m - totalH : m;

  /* 双层描边印章框 */
  rr(ctx, m, y, cw, totalH, 2.4 * S);
  ctx.fillStyle = 'rgba(8,10,13,0.52)';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, W * 0.0016);
  ctx.strokeStyle = 'rgba(255,208,40,0.9)';
  ctx.stroke();
  rr(ctx, m + 2 * S, y + 2 * S, cw - 4 * S, totalH - 4 * S, 1.8 * S);
  ctx.lineWidth = Math.max(1, W * 0.0006);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.stroke();

  let cy = y + pad;

  /* 头部：时间 + 天气 */
  ctx.font = `700 ${9.8 * S}px ${MONO}`;
  ctx.fillStyle = '#FFD028';
  ctx.fillText(d.timeStr, tx, cy + 9 * S);
  if (f.weather && d.weather) {
    ctx.font = `500 ${3.6 * S}px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const wt = ellipsize(ctx, d.weather, contentW * 0.4);
    ctx.fillText(wt, m + cw - pad - ctx.measureText(wt).width, cy + 8.4 * S);
  }
  cy += headH;

  /* 日期行 */
  if (f.date) {
    ctx.font = `500 ${3.7 * S}px ${SANS}`;
    ctx.fillStyle = 'rgba(232,236,240,0.88)';
    ctx.fillText(`${d.dateStr} ${d.weekdayStr}`, tx, cy + 3.6 * S);
    cy += dateH;
  }

  /* 信息行 */
  if (rows.length) {
    cy += 3 * S;
    for (const r of rows) {
      ctx.font = r.mono ? `500 ${3.6 * S}px ${MONO}` : `500 ${3.8 * S}px ${SANS}`;
      const firstBase = cy + 4 * S;
      drawIcon(ctx, r.icon, tx, firstBase - 3.2 * S, 3.9 * S, '#FFD028');
      r.lines.forEach((line, i) => {
        ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.96)' : 'rgba(230,234,238,0.9)';
        ctx.fillText(
          r.mono ? line : ellipsize(ctx, line, contentW - 6.2 * S),
          tx + 6.2 * S,
          cy + 4 * S + i * 4.9 * S
        );
      });
      cy += r.lines.length * 4.9 * S + 1.5 * S;
    }
  }

  ctx.restore();
}

/* ================= 样式 5：七星台账（仿元道/今日工程模板） ================= */
function drawSiteStyle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: ComposeInput
) {
  const { data: d, fields: f } = input;
  const sc = input.wmScale || 1; // 水印大小滑杆
  const portrait = H > W;
  const m = Math.round(W * 0.031);
  const cardW = Math.min(Math.round(W * (portrait ? 0.6 : 0.42) * sc), W - m * 2); // 左下小卡，非通栏
  const S = (cardW / 100);
  const pad = 4.5 * S;
  const headH = 11.6 * S;
  const fLab = `600 ${5.4 * S}px ${SANS}`;
  const fVal = `500 ${5.4 * S}px ${SANS}`;

  /* 行集合：标签 + 值 */
  const rows: { label: string; value: string }[] = [];
  if (f.addr && d.address) rows.push({ label: '地　　点：', value: d.address });
  if (f.lng) rows.push({ label: '经　　度：', value: d.siteLng });
  if (f.lat) rows.push({ label: '纬　　度：', value: d.siteLat });
  if (f.date) rows.push({ label: '拍 摄 时 间：', value: d.siteTime });
  if (f.weather && d.weather) rows.push({ label: '天\u3000\u3000气：', value: d.weather });
  if (f.project && d.project) rows.push({ label: '工\u3000\u3000程：', value: d.project });

  const showHead = !!f.note; // 施工内容开关：全模板统一由 fields.note 控制

  /* 行布局：长值自动换行，续行与值首字对齐（参照今日相机） */
  const lineH = 6.9 * S;
  const rowPad = 5.3 * S;
  const layout = rows.map((r) => {
    ctx.font = fLab;
    const lw = ctx.measureText(r.label).width;
    ctx.font = fVal;
    const lines = wrapText(ctx, r.value, cardW - lw - pad * 2, 4);
    return { label: r.label, lw, lines, h: lines.length * lineH + rowPad };
  });
  const totalH = (showHead ? headH : 0) + layout.reduce((a, r) => a + r.h, 0) + 2 * S;
  const x = m;
  const y = input.wmPos === 'bottom' ? H - m - totalH : m;

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  /* 半透明卡片底（透出画面） */
  rr(ctx, x, y, cardW, totalH, 2.2 * S);
  ctx.fillStyle = 'rgba(240,242,244,0.72)';
  ctx.fill();

  if (showHead) {
    /* 黄色头部：施工内容（同样半透明） */
    ctx.save();
    rr(ctx, x, y, cardW, totalH, 2.2 * S);
    ctx.clip();
    ctx.fillStyle = 'rgba(247,212,0,0.88)';
    ctx.fillRect(x, y, cardW, headH);
    ctx.restore();

    const content = d.note || d.project || '请选择选项';
    ctx.font = `700 ${5.6 * S}px ${SANS}`;
    ctx.fillStyle = 'rgba(23,24,26,0.95)';
    const lab = '施 工 内 容：';
    ctx.fillText(lab, x + pad, y + headH / 2 + 2 * S);
    const labW = ctx.measureText(lab).width;
    ctx.font = `600 ${5.4 * S}px ${SANS}`;
    const valTxt = ellipsize(ctx, content, cardW - labW - pad * 2 - 3 * S);
    const valW = ctx.measureText(valTxt).width;
    ctx.fillStyle = 'rgba(61,61,61,0.95)';
    ctx.fillText(valTxt, x + pad + labW, y + headH / 2 + 1.9 * S);
    /* 值下划线 */
    ctx.beginPath();
    ctx.moveTo(x + pad + labW, y + headH / 2 + 3.9 * S);
    ctx.lineTo(x + pad + labW + valW, y + headH / 2 + 3.9 * S);
    ctx.strokeStyle = 'rgba(60,60,60,0.65)';
    ctx.lineWidth = Math.max(1, W * 0.0005);
    ctx.stroke();
  }

  /* 标签行 */
  let cy = y + (showHead ? headH : 0);
  layout.forEach((r, i) => {
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(x + pad, cy);
      ctx.lineTo(x + cardW - pad, cy);
      ctx.strokeStyle = 'rgba(23,24,26,0.08)';
      ctx.lineWidth = Math.max(1, W * 0.0004);
      ctx.stroke();
    }
    const base0 = cy + rowPad / 2 + 5.1 * S;
    ctx.font = fLab;
    ctx.fillStyle = 'rgba(23,24,26,0.95)';
    ctx.fillText(r.label, x + pad, base0);
    ctx.font = fVal;
    ctx.fillStyle = 'rgba(38,40,43,0.95)';
    r.lines.forEach((ln, j) => {
      ctx.fillText(ln, x + pad + r.lw, base0 + j * lineH);
    });
    cy += r.h;
  });

  ctx.restore();
}

/* ================= 样式 6：今日工程（复刻今日相机工程水印） =================
 * 对照今日相机实拍：左下黄头卡片，施工内容黄条 + 地点/经度/纬度/拍摄时间/天气，
 * 每项独立开关，无防伪码。 */
function drawTodayStyle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: ComposeInput
) {
  const { data: d, fields: f } = input;
  const sc = input.wmScale || 1; // 水印大小滑杆
  const portrait = H > W;
  const m = Math.round(W * 0.031);
  const cardW = Math.min(Math.round(W * (portrait ? 0.62 : 0.44) * sc), W - m * 2);
  const S = (cardW / 100);
  const pad = 4.5 * S;
  const headH = 10.8 * S;
  const fLab = `600 ${5.4 * S}px ${SANS}`;
  const fVal = `500 ${5.4 * S}px ${SANS}`;

  const rows: { label: string; value: string }[] = [];
  if (f.addr && d.address) rows.push({ label: '地　　点：', value: d.address });
  if (f.lng) rows.push({ label: '经　　度：', value: d.siteLng });
  if (f.lat) rows.push({ label: '纬　　度：', value: d.siteLat });
  if (f.date) rows.push({ label: '拍 摄 时 间：', value: d.siteTime });
  if (f.weather && d.weather) rows.push({ label: '天　　气：', value: d.weather });

  const showHead = !!f.note;

  const lineH = 6.9 * S;
  const rowPad = 5.3 * S;
  const layout = rows.map((r) => {
    ctx.font = fLab;
    const lw = ctx.measureText(r.label).width;
    ctx.font = fVal;
    const lines = wrapText(ctx, r.value, cardW - lw - pad * 2, 4);
    return { label: r.label, lw, lines, h: lines.length * lineH + rowPad };
  });
  const totalH = (showHead ? headH : 0) + layout.reduce((a, r) => a + r.h, 0) + 2 * S;
  const x = m;
  const y = input.wmPos === 'bottom' ? H - m - totalH : m;

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  rr(ctx, x, y, cardW, totalH, 2.2 * S);
  ctx.fillStyle = 'rgba(242,244,246,0.88)';
  ctx.fill();

  if (showHead) {
    ctx.save();
    rr(ctx, x, y, cardW, totalH, 2.2 * S);
    ctx.clip();
    ctx.fillStyle = '#F7D400';
    ctx.fillRect(x, y, cardW, headH);
    ctx.restore();

    const hasNote = !!d.note;
    const content = d.note || '请选择选项';
    ctx.font = `700 ${5.6 * S}px ${SANS}`;
    ctx.fillStyle = 'rgba(23,24,26,0.95)';
    const lab = '施 工 内 容：';
    ctx.fillText(lab, x + pad, y + headH / 2 + 2 * S);
    const labW = ctx.measureText(lab).width;
    ctx.font = `600 ${5.4 * S}px ${SANS}`;
    const valTxt = ellipsize(ctx, content, cardW - labW - pad * 2 - 3 * S);
    const valW = ctx.measureText(valTxt).width;
    /* 有内容深灰；无内容时"请选择选项"为橄榄黄——与今日相机一致 */
    ctx.fillStyle = hasNote ? 'rgba(61,61,61,0.95)' : 'rgba(138,122,0,0.95)';
    ctx.fillText(valTxt, x + pad + labW, y + headH / 2 + 1.9 * S);
    ctx.beginPath();
    ctx.moveTo(x + pad + labW, y + headH / 2 + 3.9 * S);
    ctx.lineTo(x + pad + labW + valW, y + headH / 2 + 3.9 * S);
    ctx.strokeStyle = hasNote ? 'rgba(60,60,60,0.65)' : 'rgba(138,122,0,0.6)';
    ctx.lineWidth = Math.max(1, W * 0.0005);
    ctx.stroke();
  }

  let cy = y + (showHead ? headH : 0);
  layout.forEach((r, i) => {
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(x + pad, cy);
      ctx.lineTo(x + cardW - pad, cy);
      ctx.strokeStyle = 'rgba(23,24,26,0.08)';
      ctx.lineWidth = Math.max(1, W * 0.0004);
      ctx.stroke();
    }
    const base0 = cy + rowPad / 2 + 5.1 * S;
    ctx.font = fLab;
    ctx.fillStyle = 'rgba(23,24,26,0.95)';
    ctx.fillText(r.label, x + pad, base0);
    ctx.font = fVal;
    ctx.fillStyle = 'rgba(38,40,43,0.95)';
    r.lines.forEach((ln, j) => {
      ctx.fillText(ln, x + pad + r.lw, base0 + j * lineH);
    });
    cy += r.h;
  });

  ctx.restore();
}

/* ================= 样式 7：今日工作（仿今日相机白卡工作水印） ================= */
function drawTodayWorkStyle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: ComposeInput
) {
  const { data: d, fields: f } = input;
  const sc = input.wmScale || 1; // 水印大小滑杆
  const m = Math.round(Math.min(W, H) * 0.032);
  const portrait = H > W;
  const cardW = Math.min((portrait ? W - m * 2 : Math.min(W - m * 2, Math.round(W * 0.62))) * sc, W - m * 2);
  const S = (cardW / 100);
  const pad = 4.5 * S;

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  const fTime = `700 ${10 * S}px ${MONO}`;
  const fSub = `500 ${3.4 * S}px ${SANS}`;
  const fLab = `500 ${3.2 * S}px ${SANS}`;
  const fVal = `500 ${3.6 * S}px ${SANS}`;

  ctx.font = fVal;
  const rows: { label: string; value: string }[] = [];
  if (f.addr && d.address) rows.push({ label: '地点', value: d.address });
  if (f.lat || f.lng)
    rows.push({
      label: '经纬度',
      value: [f.lat ? d.latStr : '', f.lng ? d.lngStr : ''].filter(Boolean).join(' '),
    });
  if (f.alt && d.altLine) rows.push({ label: '海拔', value: d.altLine });
  if (f.project && d.project) rows.push({ label: '工程', value: d.project });
  if (f.note && d.note) rows.push({ label: '备注', value: d.note });

  const lineH = 5.4 * S;
  const rowGap = 2.2 * S;
  const layout = rows.map((r) => {
    ctx.font = fLab;
    const lw = ctx.measureText(r.label).width + 3 * S;
    ctx.font = fVal;
    const lines = wrapText(ctx, r.value, cardW - pad * 2 - lw, 3);
    return { label: r.label, lw, lines, h: lines.length * lineH + rowGap };
  });

  const headH = 11.5 * S + (f.date ? 5 * S : 0);
  const rowsH = layout.length ? 3.7 * S + layout.reduce((a, r) => a + r.h, 0) : 0;
  const totalH = pad * 2 + headH + rowsH;
  const x = m;
  const y = input.wmPos === 'bottom' ? H - m - totalH : m;

  rr(ctx, x, y, cardW, totalH, 2.4 * S);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();

  let cy = y + pad;
  ctx.font = fTime;
  ctx.fillStyle = '#17181a';
  ctx.fillText(d.timeStr, x + pad, cy + 9.2 * S);
  if (f.weather && d.weather) {
    ctx.font = fSub;
    ctx.fillStyle = 'rgba(90,96,102,0.95)';
    const wt = ellipsize(ctx, d.weather, cardW * 0.35);
    ctx.fillText(wt, x + cardW - pad - ctx.measureText(wt).width, cy + 8.6 * S);
  }
  cy += 11.5 * S;
  if (f.date) {
    ctx.font = fSub;
    ctx.fillStyle = 'rgba(90,96,102,0.95)';
    ctx.fillText(`${d.dateStr} ${d.weekdayStr}`, x + pad, cy + 3.4 * S);
    cy += 5 * S;
  }
  if (layout.length) {
    cy += 1.2 * S;
    ctx.beginPath();
    ctx.moveTo(x + pad, cy);
    ctx.lineTo(x + cardW - pad, cy);
    ctx.strokeStyle = 'rgba(23,24,26,0.1)';
    ctx.lineWidth = Math.max(1, W * 0.0004);
    ctx.stroke();
    cy += 2.5 * S;
    for (const r of layout) {
      const base0 = cy + 4 * S;
      ctx.font = fLab;
      ctx.fillStyle = 'rgba(130,136,142,0.95)';
      ctx.fillText(r.label, x + pad, base0);
      ctx.font = fVal;
      ctx.fillStyle = 'rgba(23,24,26,0.95)';
      r.lines.forEach((ln, j) => {
        ctx.fillText(ln, x + pad + r.lw, base0 + j * lineH);
      });
      cy += r.h;
    }
  }

  ctx.restore();
}

/* ================= 样式 8：自定义模板（JSON 模板驱动的卡片） ================= */
function drawTemplateCard(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: ComposeInput
) {
  const { data: d, fields: f } = input;
  const sc = input.wmScale || 1;
  const tpl: WatermarkTemplate = getTemplate(getActiveTemplateId());
  const portrait = H > W;
  const m = Math.round(W * 0.031);
  const rawW = W * ((portrait ? tpl.card.widthPct : tpl.card.widthPct * 0.72) / 100) * sc;
  const cardW = Math.max(120, Math.min(Math.round(rawW), W - m * 2));
  const S = cardW / 100;
  const pad = tpl.card.padding * S;
  const fLab = `${tpl.fonts.label.weight} ${tpl.fonts.label.size * S}px ${SANS}`;
  const fVal = `${tpl.fonts.value.weight} ${tpl.fonts.value.size * S}px ${SANS}`;

  /* 头部 */
  let headH = 0;
  let headValue = '';
  let headIsPlaceholder = false;
  const hd = tpl.header;
  if (hd && tplFieldOn(hd.field, f)) {
    headH = (tpl.fonts.headerSize + 5.2) * S;
    const v = hd.field === 'note' ? d.note : d.project;
    headIsPlaceholder = !v;
    headValue = v || hd.placeholder;
  }

  const rows = tpl.rows
    .filter((r) => tplFieldOn(r.field, f))
    .map((r) => ({ label: r.label, value: tplRowValue(r.field, d) }))
    .filter((r) => r.value) as { label: string; value: string }[];

  const lineH = (tpl.fonts.value.size + 1.5) * S;
  const rowPad = 5.3 * S;
  const layout = rows.map((r) => {
    ctx.font = fLab;
    const lw = ctx.measureText(r.label).width;
    ctx.font = fVal;
    const lines = wrapText(ctx, r.value, cardW - lw - pad * 2, 4);
    return { label: r.label, lw, lines, h: lines.length * lineH + rowPad };
  });
  const totalH = headH + layout.reduce((a, r) => a + r.h, 0) + 2 * S;
  const x = m;
  const y = input.wmPos === 'bottom' ? H - m - totalH : m;

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  rr(ctx, x, y, cardW, totalH, tpl.card.radius * S);
  ctx.fillStyle = tpl.card.bg;
  ctx.fill();

  if (hd && headH > 0) {
    ctx.save();
    rr(ctx, x, y, cardW, totalH, tpl.card.radius * S);
    ctx.clip();
    ctx.fillStyle = hd.bg;
    ctx.fillRect(x, y, cardW, headH);
    ctx.restore();
    ctx.font = `700 ${tpl.fonts.headerSize * S}px ${SANS}`;
    ctx.fillStyle = hd.labelColor;
    ctx.fillText(hd.label, x + pad, y + headH / 2 + (tpl.fonts.headerSize * S) / 2.8);
    const labW = ctx.measureText(hd.label).width;
    ctx.font = `600 ${tpl.fonts.value.size * S}px ${SANS}`;
    const valTxt = ellipsize(ctx, headValue, cardW - labW - pad * 2 - 3 * S);
    ctx.fillStyle = headIsPlaceholder ? hd.placeholderColor : hd.valueColor;
    ctx.fillText(valTxt, x + pad + labW, y + headH / 2 + (tpl.fonts.value.size * S) / 2.8);
    if (hd.label) {
      const valW = ctx.measureText(valTxt).width;
      ctx.save();
      ctx.globalAlpha *= 0.65;
      ctx.beginPath();
      ctx.moveTo(x + pad + labW, y + headH / 2 + (tpl.fonts.headerSize * S) / 2.8 + 1.6 * S);
      ctx.lineTo(x + pad + labW + valW, y + headH / 2 + (tpl.fonts.headerSize * S) / 2.8 + 1.6 * S);
      ctx.strokeStyle = headIsPlaceholder ? hd.placeholderColor : hd.valueColor;
      ctx.lineWidth = Math.max(1, W * 0.0005);
      ctx.stroke();
      ctx.restore();
    }
  }

  let cy = y + headH;
  layout.forEach((r, i) => {
    if (i > 0 && tpl.divider !== 'none') {
      ctx.beginPath();
      ctx.moveTo(x + pad, cy);
      ctx.lineTo(x + cardW - pad, cy);
      ctx.strokeStyle = tpl.divider;
      ctx.lineWidth = Math.max(1, W * 0.0004);
      ctx.stroke();
    }
    const base0 = cy + rowPad / 2 + tpl.fonts.label.size * S * 0.95;
    ctx.font = fLab;
    ctx.fillStyle = tpl.fonts.label.color;
    ctx.fillText(r.label, x + pad, base0);
    ctx.font = fVal;
    ctx.fillStyle = tpl.fonts.value.color;
    r.lines.forEach((ln, j) => {
      ctx.fillText(ln, x + pad + r.lw, base0 + j * lineH);
    });
    cy += r.h;
  });

  ctx.restore();
}

export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: ComposeInput
) {
  const alpha = input.wmAlpha ?? 1;
  const run = () => {
    switch (input.wmStyle) {
      case 'hero':
        return drawHeroStyle(ctx, W, H, input);
      case 'strip':
        return drawStripStyle(ctx, W, H, input);
      case 'stamp':
        return drawStampStyle(ctx, W, H, input);
      case 'site':
        return drawSiteStyle(ctx, W, H, input);
      case 'today':
        return drawTodayStyle(ctx, W, H, input);
      case 'todayWork':
        return drawTodayWorkStyle(ctx, W, H, input);
      case 'tpl':
        return drawTemplateCard(ctx, W, H, input);
      default:
        return drawCardStyle(ctx, W, H, input);
    }
  };
  if (alpha >= 1) return run();
  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, alpha));
  try {
    return run();
  } finally {
    ctx.restore();
  }
}

export async function composePhoto(input: ComposeInput): Promise<string> {
  try {
    await Promise.all([
      document.fonts.load(`700 32px "JetBrains Mono"`),
      document.fonts.load(`500 32px "Noto Sans SC"`),
    ]);
  } catch {
    /* 字体未就绪时使用回退字体 */
  }

  const videoOk =
    input.video && input.video.readyState >= 2 && input.video.videoWidth > 0 ? input.video : null;
  const media: HTMLVideoElement | HTMLImageElement | null = videoOk || input.image;
  if (!media) throw new Error('无可用画面');
  const W = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const H = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (!W || !H) throw new Error('画面未就绪');

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');

  ctx.save();
  if (media instanceof HTMLVideoElement && input.mirrored) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(media, 0, 0, W, H);
  ctx.restore();

  drawWatermark(ctx, W, H, input);
  return canvas.toDataURL('image/jpeg', 0.92);
}
