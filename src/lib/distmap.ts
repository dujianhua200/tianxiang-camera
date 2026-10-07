/* 施工影像分布图：轨迹 + 照片点位 → 竣工资料用示意图（PNG）。
 * 纯 canvas 手绘，不依赖底图瓦片，离线可用；比例尺按真实米数计算。
 */
import { TrackPoint, haversineM, trackDistanceM } from './track';

export interface DistPhoto {
  lat: number;
  lng: number;
  time: string; // 显示用，如 '10:22'
}

export interface DistMapMeta {
  project: string;
  date: string; // 2026.10.07
  photographer: string;
}

const W = 2000;
const H = 1500;
const TITLE_H = 210;
const MAP_PAD = 60;

const SANS = `'PingFang SC','Microsoft YaHei',system-ui,sans-serif`;

function niceScale(metersPer100px: number): { label: string; px: number } {
  // 选一个好看的比例尺长度（m），使其像素宽落在 120–260 之间
  const target = metersPer100px * 1.9;
  const pow = 10 ** Math.floor(Math.log10(target));
  for (const m of [1, 2, 5, 10]) {
    const v = m * pow;
    const px = (v / metersPer100px) * 100;
    if (px >= 120 && px <= 280) return { label: v >= 1000 ? `${v / 1000}km` : `${v}m`, px };
  }
  const v = 5 * pow;
  return { label: v >= 1000 ? `${v / 1000}km` : `${v}m`, px: (v / metersPer100px) * 100 };
}

export function buildDistMap(meta: DistMapMeta, track: TrackPoint[], photos: DistPhoto[]): string {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';

  /* 底 */
  ctx.fillStyle = '#F4F6F8';
  ctx.fillRect(0, 0, W, H);

  /* 标题栏 */
  ctx.fillStyle = '#14161A';
  ctx.fillRect(0, 0, W, TITLE_H);
  ctx.fillStyle = '#FFD028';
  ctx.fillRect(0, 0, 14, TITLE_H);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 64px ${SANS}`;
  ctx.fillText('施工影像分布图', 56, 92);
  ctx.font = `400 30px ${SANS}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const distKm = (trackDistanceM(track) / 1000).toFixed(2);
  const sub = `${meta.project || '未命名工程'}　　${meta.date}　　照片 ${photos.length} 张　　轨迹 ${distKm} km${meta.photographer ? `　　拍摄：${meta.photographer}` : ''}`;
  ctx.fillText(sub.slice(0, 60), 56, 152);

  /* 地图区 */
  const mx = MAP_PAD;
  const my = TITLE_H + 30;
  const mw = W - MAP_PAD * 2;
  const mh = H - my - MAP_PAD;
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = 'rgba(20,22,26,0.14)';
  ctx.lineWidth = 2;
  roundRect(ctx, mx, my, mw, mh, 18);
  ctx.fill();
  ctx.stroke();

  const pts = [
    ...track.map((p) => ({ lat: p.lat, lng: p.lng })),
    ...photos.map((p) => ({ lat: p.lat, lng: p.lng })),
  ];
  ctx.save();
  roundRect(ctx, mx, my, mw, mh, 18);
  ctx.clip();

  if (pts.length === 0) {
    ctx.fillStyle = 'rgba(20,22,26,0.4)';
    ctx.font = `400 36px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('本日暂无轨迹与照片点位数据', mx + mw / 2, my + mh / 2);
    ctx.textAlign = 'left';
    ctx.restore();
    return cv.toDataURL('image/png');
  }

  /* 投影：等距圆柱， padding 12% */
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  pts.forEach((p) => {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  });
  if (maxLat - minLat < 1e-6) { maxLat += 0.0005; minLat -= 0.0005; }
  if (maxLng - minLng < 1e-6) { maxLng += 0.0005; minLng -= 0.0005; }
  const lat0 = (minLat + maxLat) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const padLat = (maxLat - minLat) * 0.12;
  const padLng = (maxLng - minLng) * 0.12;
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
  const X = (lng: number) => mx + ((lng - minLng) * kx) / ((maxLng - minLng) * kx) * mw;
  const Y = (lat: number) => my + mh - ((lat - minLat) / (maxLat - minLat)) * mh;

  /* 网格 */
  ctx.strokeStyle = 'rgba(20,22,26,0.06)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const gx = mx + (mw / 8) * i;
    ctx.beginPath(); ctx.moveTo(gx, my); ctx.lineTo(gx, my + mh); ctx.stroke();
    const gy = my + (mh / 6) * i;
    if (i < 6) { ctx.beginPath(); ctx.moveTo(mx, gy); ctx.lineTo(mx + mw, gy); ctx.stroke(); }
  }

  /* 轨迹 */
  if (track.length > 1) {
    ctx.strokeStyle = '#EAB308';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    track.forEach((p, i) => {
      const x = X(p.lng), y = Y(p.lat);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // 起终点
    const s = track[0], e = track[track.length - 1];
    dot(ctx, X(s.lng), Y(s.lat), 12, '#16A34A', 'S');
    dot(ctx, X(e.lng), Y(e.lat), 12, '#DC2626', 'E');
  }

  /* 照片点位（按时间编号） */
  const sorted = [...photos].sort((a, b) => a.time.localeCompare(b.time));
  sorted.forEach((p, i) => {
    const x = X(p.lng), y = Y(p.lat);
    const n = String(i + 1);
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fillStyle = '#DC2626';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${n.length > 2 ? 20 : 24}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(n, x, y + 8);
    ctx.textAlign = 'left';
  });
  ctx.restore();

  /* 图例 */
  const lx = mx + 28, ly = my + mh - 108;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = 'rgba(20,22,26,0.12)';
  roundRect(ctx, lx - 16, ly - 34, 330, 92, 12);
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#EAB308'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 60, ly); ctx.stroke();
  ctx.fillStyle = '#17181A'; ctx.font = `400 26px ${SANS}`;
  ctx.fillText('巡检轨迹', lx + 74, ly + 9);
  dot(ctx, lx + 30, ly + 44, 13, '#DC2626', '');
  ctx.fillStyle = '#17181A';
  ctx.fillText('照片点位（按时间编号）', lx + 74, ly + 53);

  /* 指北针 */
  const nx = mx + mw - 70, ny = my + 78;
  ctx.fillStyle = '#17181A';
  ctx.beginPath();
  ctx.moveTo(nx, ny - 34); ctx.lineTo(nx - 14, ny + 12); ctx.lineTo(nx + 14, ny + 12);
  ctx.closePath(); ctx.fill();
  ctx.font = `700 28px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('N', nx, ny + 44);
  ctx.textAlign = 'left';

  /* 比例尺（真实米数） */
  const metersPerPx = haversineM(lat0, minLng, lat0, minLng + (maxLng - minLng) / mw) ;
  const sc = niceScale(metersPerPx * 100);
  const sx = mx + 28, sy = my + 34;
  ctx.strokeStyle = '#17181A'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sc.px, sy); ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(sx, sy - 8); ctx.lineTo(sx, sy + 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sx + sc.px, sy - 8); ctx.lineTo(sx + sc.px, sy + 8); ctx.stroke();
  ctx.fillStyle = '#17181A'; ctx.font = `400 24px ${SANS}`;
  ctx.fillText(sc.label, sx + sc.px + 12, sy + 8);

  /* 落款 */
  ctx.fillStyle = 'rgba(20,22,26,0.45)';
  ctx.font = `400 22px ${SANS}`;
  ctx.fillText('天象七星工程相机 · 自动生成', mx, H - 22);

  return cv.toDataURL('image/png');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, label: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (label) {
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${r}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + r / 2.5);
    ctx.textAlign = 'left';
  }
}
