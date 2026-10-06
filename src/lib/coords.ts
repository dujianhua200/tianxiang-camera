/* 经纬度格式化 + 坐标系转换 (WGS-84 / GCJ-02) */

export type CoordFormat = 'dd' | 'ddm' | 'dms';
export type CoordSystem = 'wgs84' | 'gcj02';
export type Datum = 'wgs84' | 'gcj02';

export interface GeoPoint {
  lat: number;
  lng: number;
  datum: Datum;
  altitude?: number | null;
  accuracy?: number | null;
}

/* ---------- 格式化 ---------- */

function pad(n: number, w: number) {
  return n.toString().padStart(w, '0');
}

export function toDD(value: number, isLat: boolean): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${hemi} ${Math.abs(value).toFixed(6)}°`;
}

export function toDDM(value: number, isLat: boolean): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const degStr = isLat ? pad(deg, 2) : pad(deg, 3);
  return `${hemi} ${degStr}° ${min.toFixed(4)}′`;
}

export function toDMS(value: number, isLat: boolean): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minF = (abs - deg) * 60;
  const min = Math.floor(minF);
  const sec = (minF - min) * 60;
  const degStr = isLat ? pad(deg, 2) : pad(deg, 3);
  return `${hemi} ${degStr}° ${pad(min, 2)}′ ${sec.toFixed(1)}″`;
}

export function formatCoord(value: number, isLat: boolean, fmt: CoordFormat): string {
  if (fmt === 'dd') return toDD(value, isLat);
  if (fmt === 'ddm') return toDDM(value, isLat);
  return toDMS(value, isLat);
}

export function formatLatLng(lat: number, lng: number, fmt: CoordFormat) {
  return { latStr: formatCoord(lat, true, fmt), lngStr: formatCoord(lng, false, fmt) };
}

export const FORMAT_LABELS: Record<CoordFormat, string> = {
  dd: '十进制 DD',
  ddm: '度分 DDM',
  dms: '度分秒 DMS',
};

/* ---------- WGS-84 <-> GCJ-02 ---------- */

const PI = Math.PI;
const AXIS = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lat: number, lng: number) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function tLat(x: number, y: number) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320.0 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function tLng(x: number, y: number) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

export function wgs84ToGcj02(lat: number, lng: number): { lat: number; lng: number } {
  if (outOfChina(lat, lng)) return { lat, lng };
  let dLat = tLat(lng - 105.0, lat - 35.0);
  let dLng = tLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((AXIS * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

export function gcj02ToWgs84(lat: number, lng: number): { lat: number; lng: number } {
  if (outOfChina(lat, lng)) return { lat, lng };
  let wLat = lat;
  let wLng = lng;
  for (let i = 0; i < 3; i++) {
    const g = wgs84ToGcj02(wLat, wLng);
    wLat -= g.lat - lat;
    wLng -= g.lng - lng;
  }
  return { lat: wLat, lng: wLng };
}

/** 将某 datum 的点转换到目标坐标系 */
export function toDatum(lat: number, lng: number, from: Datum, to: Datum) {
  if (from === to) return { lat, lng };
  return from === 'wgs84' ? wgs84ToGcj02(lat, lng) : gcj02ToWgs84(lat, lng);
}
