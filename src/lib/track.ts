/* 轨迹记录：GPS 点按天存 localStorage，供"施工影像分布图"使用。
 * 节流：至少间隔 30s 且移动 20m 才记一点；每天上限 3000 点。
 */
export interface TrackPoint {
  t: number;
  lat: number;
  lng: number;
}

const KEY = (day: string) => `txtrack.${day}`;
const MIN_DT = 30 * 1000;
const MIN_DIST_M = 20;
const MAX_POINTS = 3000;

export function dayStr(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLng = (bLng - aLng) * r;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function getTrack(day: string): TrackPoint[] {
  try {
    const raw = localStorage.getItem(KEY(day));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function logTrackPoint(lat: number, lng: number): void {
  if (!isFinite(lat) || !isFinite(lng)) return;
  const day = dayStr();
  const pts = getTrack(day);
  const now = Date.now();
  const last = pts[pts.length - 1];
  if (last) {
    if (now - last.t < MIN_DT) return;
    if (haversineM(last.lat, last.lng, lat, lng) < MIN_DIST_M) return;
  }
  pts.push({ t: now, lat, lng });
  while (pts.length > MAX_POINTS) pts.shift();
  try {
    localStorage.setItem(KEY(day), JSON.stringify(pts));
  } catch {
    /* 配额满：丢弃最旧一半再试 */
    try {
      localStorage.setItem(KEY(day), JSON.stringify(pts.slice(pts.length / 2)));
    } catch {
      /* ignore */
    }
  }
}

export function trackDistanceM(pts: TrackPoint[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversineM(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  return d;
}

/** "32.170357°N" / "114.051486°E" → 十进制度数，解析失败返回 null */
export function parseCoordLabel(s: string): number | null {
  const m = String(s || '').match(/(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const h = m[2].toUpperCase();
  if (h === 'S' || h === 'W') v = -v;
  return v;
}

/* ---------- 每日拍摄计数（顶栏"今日 N 张"） ---------- */
const SHOT_KEY = (day: string) => `tx.shots.${day}`;

export function getShotCount(day: string = dayStr()): number {
  try {
    return parseInt(localStorage.getItem(SHOT_KEY(day)) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

export function incShotCount(day: string = dayStr()): number {
  const n = getShotCount(day) + 1;
  try {
    localStorage.setItem(SHOT_KEY(day), String(n));
  } catch {
    /* ignore */
  }
  return n;
}
