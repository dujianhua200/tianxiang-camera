/* 地理服务：逆地理编码 / 地点搜索，时间格式化 */

import { toDatum, type Datum } from './coords';

export interface PlaceResult {
  name: string;
  display: string;
  lat: number;
  lng: number;
  datum?: Datum;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const BIGDATA = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const AMAP = 'https://restapi.amap.com/v3';
const AMAP_KEY_LS = 'geocam.amap.key';
/**
 * 高德 Web 服务 Key 不再硬编码进源码（公开发布会被刷量）。
 * 获取方式（任选其一）：
 *  1) App「水印编辑 → 地点」里填入自己的 Key（存本机 localStorage）；
 *  2) 构建时注入环境变量 VITE_AMAP_KEY。
 * 为空时自动回退免费逆地理服务（BigDataCloud → Nominatim）。
 */
const AMAP_KEY_BUILTIN: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_AMAP_KEY || '';

/** 高德 Web 服务 Key（内置，地址解析默认到街道+POI 级） */
export function getAmapKey(): string {
  try {
    return localStorage.getItem(AMAP_KEY_LS) || AMAP_KEY_BUILTIN;
  } catch {
    return AMAP_KEY_BUILTIN;
  }
}

export function setAmapKey(k: string) {
  try {
    if (k) localStorage.setItem(AMAP_KEY_LS, k);
    else localStorage.removeItem(AMAP_KEY_LS);
  } catch {
    /* 存储不可用时忽略 */
  }
}

/** fetch 超时 + 外部取消合并 */
function timed(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(t);
    ctrl.abort();
  });
  return ctrl.signal;
}

function cnAddress(addr: Record<string, string | undefined>): string {
  const parts = [
    addr.state || addr.province,
    addr.city || addr.town || addr.county,
    addr.district || addr.suburb || addr.city_district,
    addr.road || addr.street,
    addr.house_number || addr.building || addr.amenity,
  ].filter(Boolean) as string[];
  const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
  return uniq.join('');
}

const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/** 高德精确逆地理：省市区 + 街道乡镇 + 最近 POI/商圈/门牌（元道/今日相机同款粒度） */
async function amapRegeo(
  latWgs: number,
  lngWgs: number,
  key: string,
  signal?: AbortSignal
): Promise<string | null> {
  const g = toDatum(latWgs, lngWgs, 'wgs84', 'gcj02'); // 高德使用 GCJ-02
  const res = await fetch(
    `${AMAP}/geocode/regeo?location=${g.lng.toFixed(6)},${g.lat.toFixed(6)}` +
      `&extensions=all&radius=1000&key=${encodeURIComponent(key)}`,
    { signal: timed(signal, 8000) }
  );
  if (!res.ok) return null;
  const j = await res.json();
  if (j.status !== '1' || !j.regeocode) return null;
  const rc = j.regeocode as Record<string, unknown>;
  const ac = (rc.addressComponent || {}) as Record<string, unknown>;
  const parts = [str(ac.province), str(ac.city), str(ac.district), str(ac.township)].filter(
    Boolean
  );
  const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
  let detail = '';
  const pois = rc.pois;
  const bas = rc.businessAreas;
  if (Array.isArray(pois) && pois.length) detail = str((pois[0] as Record<string, unknown>).name);
  if (!detail && Array.isArray(bas) && bas.length)
    detail = str((bas[0] as Record<string, unknown>).name);
  if (!detail) {
    const sn = ac.streetNumber;
    if (sn && typeof sn === 'object') {
      const st = str((sn as Record<string, unknown>).street);
      const nu = str((sn as Record<string, unknown>).number);
      if (st) detail = st + (nu && nu !== '[]' ? ` ${nu}号`.replace('号号', '号') : '');
    }
  }
  const head = uniq.join('');
  const out = head && detail ? `${head}·${detail}` : head || detail;
  return out || str(rc.formatted_address) || null;
}

/** 地址简洁度：完整 / 简洁（区·POI）/ 极简（POI 或街道） */
export type AddrMode = 'full' | 'short' | 'min';

export function simplifyAddress(raw: string, mode: AddrMode): string {
  if (!raw || mode === 'full') return raw;
  // 去掉省级、市级前缀（直辖市的「X市」也算市级）
  let s = raw;
  s = s.replace(/^(.+?(?:省|自治区))(?=市|区|县)/, '');
  s = s.replace(/^(.+?市)(?=[\u4e00-\u9fa5]{1,6}(?:区|县|旗))/, '');
  const cut = s.indexOf('·');
  const head = cut >= 0 ? s.slice(0, cut) : s;
  const poi = cut >= 0 ? s.slice(cut + 1) : '';
  if (mode === 'min') {
    if (poi) return poi.length > 12 ? poi.slice(0, 12) + '…' : poi;
    const town = head.replace(/^.*?(?:区|县|旗)/, '');
    return (town || head).length > 10 ? (town || head).slice(0, 10) + '…' : town || head;
  }
  // short
  if (poi) {
    const dist = (head.match(/^(.*?(?:区|县|市|旗))/) || [''])[0];
    const p = poi.length > 12 ? poi.slice(0, 12) + '…' : poi;
    return dist ? `${dist}·${p}` : p;
  }
  return head.length > 16 ? head.slice(0, 16) + '…' : head;
}

/** 解析优先级：高德（有 Key，街道+POI 级）→ BigDataCloud → Nominatim；都失败返回 null */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<string | null> {
  const key = getAmapKey();
  if (key) {
    try {
      const s = await amapRegeo(lat, lng, key, signal);
      if (s) return s;
    } catch {
      /* Key 无效/网络失败，回退免费服务 */
    }
    if (signal?.aborted) return null;
  }
  try {
    const res = await fetch(
      `${BIGDATA}?latitude=${lat}&longitude=${lng}&localityLanguage=zh-Hans`,
      { signal: timed(signal, 8000) }
    );
    if (res.ok) {
      const j = await res.json();
      const parts = [
        j.principalSubdivision,
        j.city,
        j.locality,
        j.subDistrict,
        j.street,
        j.streetNumber,
      ].filter((s: unknown): s is string => typeof s === 'string' && !!s);
      const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
      if (uniq.length) return uniq.join('');
      if (typeof j.localityAddress === 'string' && j.localityAddress) return j.localityAddress;
    }
  } catch {
    /* 继续尝试 Nominatim */
  }
  if (signal?.aborted) return null;
  try {
    const res = await fetch(
      `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=zh-CN&zoom=18`,
      { signal: timed(signal, 8000) }
    );
    if (!res.ok) return null;
    const j = await res.json();
    if (j.address) {
      const s = cnAddress(j.address as Record<string, string>);
      if (s) return s;
    }
    return (j.display_name as string)?.split(',').slice(0, 4).join('') || null;
  } catch {
    return null;
  }
}

/* ---------- 天气（Open-Meteo 免费源，无需 Key） ---------- */

const WMO: Record<number, string> = {
  0: '晴', 1: '多云', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小雨', 53: '小雨', 55: '小雨', 56: '冻雨', 57: '冻雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪',
  80: '阵雨', 81: '阵雨', 82: '强阵雨', 85: '阵雪', 86: '阵雪',
  95: '雷阵雨', 96: '雷阵雨', 99: '雷阵雨',
};

export async function fetchWeather(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
        `&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`,
      { signal: timed(signal, 8000) }
    );
    if (!res.ok) return null;
    const j = await res.json();
    const c = j.current;
    if (!c || typeof c.temperature_2m !== 'number') return null;
    const w = WMO[c.weather_code as number] || '未知';
    const t = Math.round(c.temperature_2m);
    return `${w} ${t}°C`;
  } catch {
    return null;
  }
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const key = getAmapKey();
  if (key) {
    try {
      const res = await fetch(
        `${AMAP}/place/text?keywords=${encodeURIComponent(q)}&offset=6&page=1&extensions=base&sortrule=weight&key=${encodeURIComponent(key)}`,
        { signal: timed(signal, 8000) }
      );
      if (res.ok) {
        const j = await res.json();
        if (j.status === '1' && Array.isArray(j.pois)) {
          const out: PlaceResult[] = (j.pois as Array<Record<string, unknown>>)
            .map((r: Record<string, unknown>) => {
              const [lng, lat] = str(r.location).split(',').map(Number);
              const disp = [str(r.pname), str(r.cityname), str(r.adname), str(r.address)]
                .filter(Boolean)
                .filter((p, i, a) => a.indexOf(p) === i)
                .join(' ');
              return { name: str(r.name), display: disp, lat, lng, datum: 'gcj02' as Datum };
            })
            .filter((r) => isFinite(r.lat) && isFinite(r.lng));
          if (out.length) return out;
        }
      }
    } catch {
      /* 回退 Nominatim */
    }
    if (signal?.aborted) return [];
  }
  const res = await fetch(
    `${NOMINATIM}/search?format=jsonv2&q=${encodeURIComponent(q)}&accept-language=zh-CN&limit=6`,
    { signal: timed(signal, 8000) }
  );
  if (!res.ok) return [];
  const j = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return j.map((r) => {
    const segs = r.display_name.split(', ');
    return {
      name: segs[0],
      display: segs.slice(0, 4).join(', '),
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      datum: 'wgs84' as Datum,
    };
  });
}

/* ---------- 时间 ---------- */

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function fmtTime(d: Date) {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtDate(d: Date) {
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function fmtWeekday(d: Date) {
  return `星期${WEEKDAYS[d.getDay()]}`;
}

export function fmtFileTime(d: Date) {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** datetime-local 输入值 */
export function toLocalInput(d: Date) {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
