import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  X,
  Search,
  MapPinned,
  LocateFixed,
  Satellite,
  Map as MapIcon,
  Globe,
  Loader2,
  Copy,
  Check,
} from 'lucide-react';
import {
  GeoPoint,
  Datum,
  CoordFormat,
  CoordSystem,
  toDatum,
  formatLatLng,
  FORMAT_LABELS,
} from '../lib/coords';
import { searchPlaces, PlaceResult } from '../lib/geo';

interface Props {
  open: boolean;
  onClose: () => void;
  position: GeoPoint | null;
  source: 'gps' | 'map';
  gpsFix: boolean;
  lastGps: { lat: number; lng: number } | null;
  format: CoordFormat;
  system: CoordSystem;
  onPick: (lat: number, lng: number, datum: Datum) => void;
  onUseGPS: () => void;
  onToast: (msg: string) => void;
}

type LayerKey = 'street' | 'satellite' | 'osm';

const pinIcon = L.divIcon({
  className: 'geo-pin-wrap',
  html: `<div class="geo-pin"><div class="geo-pin-pulse"></div><div class="geo-pin-head"><span></span></div><div class="geo-pin-shadow"></div></div>`,
  iconSize: [36, 48],
  iconAnchor: [18, 44],
});

export default function MapPanel(p: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const tileRef = useRef<L.Layer | null>(null);
  const [layer, setLayer] = useState<LayerKey>('street');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const onPickRef = useRef(p.onPick);
  onPickRef.current = p.onPick;

  /* ---------- 初始化地图 ---------- */
  useEffect(() => {
    if (!p.open || !containerRef.current || mapRef.current) return;

    const gcj = p.position
      ? toDatum(p.position.lat, p.position.lng, p.position.datum, 'gcj02')
      : { lat: 39.9087, lng: 116.3975 };

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([gcj.lat, gcj.lng], 16);
    map.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'topright' }).addTo(map);
    mapRef.current = map;

    const marker = L.marker([gcj.lat, gcj.lng], { icon: pinIcon, draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const ll = marker.getLatLng();
      onPickRef.current(ll.lat, ll.lng, 'gcj02');
    });
    markerRef.current = marker;

    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onPickRef.current(e.latlng.lat, e.latlng.lng, 'gcj02');
    });

    addTile(layer);
    setTimeout(() => map.invalidateSize(), 120);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      tileRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open]);

  function makeTile(key: LayerKey): L.Layer {
    const sub = ['1', '2', '3', '4'];
    if (key === 'street')
      return L.tileLayer(
        'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        { maxZoom: 19, subdomains: sub, attribution: '© 高德地图' }
      );
    if (key === 'satellite')
      return L.layerGroup([
        L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {
          maxZoom: 19,
          subdomains: sub,
          attribution: '© 高德地图',
        }),
        L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', {
          maxZoom: 19,
          subdomains: sub,
        }),
      ]);
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    });
  }

  function addTile(key: LayerKey) {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const t = makeTile(key);
    t.addTo(map);
    tileRef.current = t;
  }

  /* 图层切换 */
  useEffect(() => {
    if (mapRef.current) addTile(layer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer]);

  /* 外部位置变化 -> 同步 marker（如 GPS 更新 / 搜索落点回流） */
  const posKey = p.position ? `${p.position.lat.toFixed(7)},${p.position.lng.toFixed(7)},${p.position.datum}` : '';
  useEffect(() => {
    if (!mapRef.current || !p.position) return;
    const g = toDatum(p.position.lat, p.position.lng, p.position.datum, 'gcj02');
    markerRef.current?.setLatLng([g.lat, g.lng]);
    if (p.source === 'gps' && p.position.accuracy) {
      if (circleRef.current) {
        circleRef.current.setLatLng([g.lat, g.lng]).setRadius(p.position.accuracy);
      } else {
        circleRef.current = L.circle([g.lat, g.lng], {
          radius: p.position.accuracy,
          weight: 1,
          color: '#FFD028',
          fillColor: '#FFD028',
          fillOpacity: 0.12,
          opacity: 0.6,
        }).addTo(mapRef.current);
      }
    } else if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey, p.source]);

  /* ---------- 坐标文本解析（支持十进制 / N-E 字母 / 度分秒） ---------- */
  const parseOne = (t: string): number | null => {
    const m = t
      .toUpperCase()
      .match(
        /^([NSWE])?\s*(-?\d+(?:\.\d+)?)(?:°|["″](?!\d))?\s*(?:(\d+(?:\.\d+)?)['′])?\s*(?:(\d+(?:\.\d+)?)["″])?\s*([NSWE])?$/
      );
    if (!m) return null;
    let v = Math.abs(parseFloat(m[2]));
    if (m[3]) v += parseFloat(m[3]) / 60;
    if (m[4]) v += parseFloat(m[4]) / 3600;
    const hemi = m[1] || m[5] || '';
    if (hemi === 'S' || hemi === 'W') v = -v;
    if (!hemi && m[2].startsWith('-')) v = -v;
    return v;
  };

  /** 返回 {lat,lng} 或 null */
  const parseCoordInput = (q: string): { lat: number; lng: number } | null => {
    const s = q
      .replace(/[,，;；]+/g, ' ')
      // 「N 31.2」→「N31.2」；但「27.9"N 116°」这种引号后置半球字母的分隔要保留
      .replace(/(?<![\"″])(^|\s)([NSEW])\s+(?=[\d°\-])/gi, '$1$2')
      .trim();
    const tokens = s.split(/\s+/).filter(Boolean);
    const parsed = tokens.map(parseOne);
    if (parsed.some((p) => p === null)) return null;
    const nums = parsed as number[];
    const hasHemi = /[NS]/i.test(s) && /[EW]/i.test(s);
    if (nums.length === 2) {
      const [a, b] = nums;
      if (hasHemi || Math.abs(a) <= 90) {
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lng: b };
        if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lng: a };
      }
      return null;
    }
    if (nums.length === 4) {
      // 度分 格式：latDeg latMin lngDeg lngMin
      const lat = Math.abs(nums[0]) + Math.abs(nums[1]) / 60;
      const lng = Math.abs(nums[2]) + Math.abs(nums[3]) / 60;
      if (lat <= 90 && lng <= 180) return { lat: nums[0] < 0 ? -lat : lat, lng: nums[2] < 0 ? -lng : lng };
    }
    if (nums.length === 6) {
      // 度分秒 格式
      const lat = Math.abs(nums[0]) + Math.abs(nums[1]) / 60 + Math.abs(nums[2]) / 3600;
      const lng = Math.abs(nums[3]) + Math.abs(nums[4]) / 60 + Math.abs(nums[5]) / 3600;
      if (lat <= 90 && lng <= 180) return { lat: nums[0] < 0 ? -lat : lat, lng: nums[3] < 0 ? -lng : lng };
    }
    return null;
  };

  const coordHit = parseCoordInput(query);
  const [coordDatum, setCoordDatum] = useState<'wgs84' | 'gcj02'>('wgs84');

  /* ---------- 搜索 ---------- */
  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    /* 坐标直达：不发网络请求 */
    const hit = parseCoordInput(q);
    if (hit) {
      setResults([]);
      const g = toDatum(hit.lat, hit.lng, coordDatum, 'gcj02');
      mapRef.current?.flyTo([g.lat, g.lng], 17, { duration: 0.8 });
      markerRef.current?.setLatLng([g.lat, g.lng]);
      p.onPick(hit.lat, hit.lng, coordDatum);
      p.onToast(
        `已定位 ${Math.abs(hit.lat).toFixed(6)}°${hit.lat >= 0 ? 'N' : 'S'} ${Math.abs(hit.lng).toFixed(6)}°${hit.lng >= 0 ? 'E' : 'W'}（${coordDatum === 'wgs84' ? 'WGS-84' : 'GCJ-02'}）`
      );
      return;
    }
    setSearching(true);
    try {
      const r = await searchPlaces(q);
      setResults(r);
      if (r.length === 0) p.onToast('未找到相关地点');
    } catch {
      setResults([]);
      p.onToast('搜索失败，请检查网络');
    }
    setSearching(false);
  };

  const pickResult = (r: PlaceResult) => {
    // 结果自带坐标系（高德 GCJ-02 / Nominatim WGS-84），地图统一 GCJ-02 显示
    const datum = r.datum ?? 'wgs84';
    const g = toDatum(r.lat, r.lng, datum, 'gcj02');
    mapRef.current?.flyTo([g.lat, g.lng], 17, { duration: 0.8 });
    markerRef.current?.setLatLng([g.lat, g.lng]);
    setResults([]);
    setQuery(r.name);
    p.onPick(r.lat, r.lng, datum);
  };

  const useGPS = () => {
    if (!p.lastGps) {
      p.onToast('暂无 GPS 信号');
      return;
    }
    p.onUseGPS();
    const g = toDatum(p.lastGps.lat, p.lastGps.lng, 'wgs84', 'gcj02');
    mapRef.current?.flyTo([g.lat, g.lng], 17, { duration: 0.8 });
  };

  /* ---------- 坐标读数 ---------- */
  const disp = p.position ? toDatum(p.position.lat, p.position.lng, p.position.datum, p.system) : null;
  const coordStr = disp ? formatLatLng(disp.lat, disp.lng, p.format) : null;

  const copyCoords = () => {
    if (!coordStr) return;
    navigator.clipboard
      ?.writeText(`${coordStr.latStr}, ${coordStr.lngStr}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        p.onToast('坐标已复制');
      })
      .catch(() => {});
  };

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;

  return (
    <motion.div
      initial={isDesktop ? { x: 460, opacity: 0 } : { y: '100%' }}
      animate={isDesktop ? { x: 0, opacity: 1 } : { y: 0 }}
      exit={isDesktop ? { x: 460, opacity: 0 } : { y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 260 }}
      className="fixed inset-x-0 bottom-0 z-40 flex h-[78dvh] flex-col overflow-hidden rounded-t-3xl border-t border-white/15 bg-[#0b0e11] shadow-2xl md:inset-x-auto md:bottom-3 md:right-3 md:top-3 md:h-auto md:w-[412px] md:rounded-2xl md:border"
    >
      {/* 头部 */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFD028]/15">
          <MapPinned size={18} className="text-[#FFD028]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-white">地图定点</div>
          <div className="truncate text-[11px] text-white/45">
            点击或拖动地图 · 相机经纬度实时同步
          </div>
        </div>
        <button
          onClick={p.onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X size={17} />
        </button>
      </div>

      {/* 搜索 */}
      <div className="relative px-4 pt-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3">
          {searching ? (
            <Loader2 size={15} className="animate-spin text-white/40" />
          ) : (
            <Search size={15} className="text-white/40" />
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="搜索地点，或粘贴经纬度 39.904,116.407"
            className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
          />
          <button
            onClick={doSearch}
            className="rounded-md bg-[#FFD028] px-2.5 py-1 text-[11.5px] font-semibold text-black transition hover:brightness-110"
          >
            {coordHit ? '定位' : '搜索'}
          </button>
        </div>
        {coordHit && (
          <div className="mt-1.5 flex items-center justify-between rounded-lg border border-[#FFD028]/25 bg-[#FFD028]/[0.06] px-2.5 py-1.5">
            <span className="font-mono text-[11px] text-[#FFD028]">
              识别为坐标：{Math.abs(coordHit.lat).toFixed(6)}°{coordHit.lat >= 0 ? 'N' : 'S'}{' '}
              {Math.abs(coordHit.lng).toFixed(6)}°{coordHit.lng >= 0 ? 'E' : 'W'}
            </span>
            <div className="flex overflow-hidden rounded-md border border-white/15 text-[10.5px]">
              <button
                onClick={() => setCoordDatum('wgs84')}
                className={`px-2 py-0.5 ${coordDatum === 'wgs84' ? 'bg-[#FFD028] font-semibold text-black' : 'text-white/60'}`}
              >
                WGS-84
              </button>
              <button
                onClick={() => setCoordDatum('gcj02')}
                className={`px-2 py-0.5 ${coordDatum === 'gcj02' ? 'bg-[#FFD028] font-semibold text-black' : 'text-white/60'}`}
              >
                GCJ-02
              </button>
            </div>
          </div>
        )}
        {results.length > 0 && (
          <div className="absolute inset-x-4 top-full z-30 mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[#12161a] shadow-2xl">
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => pickResult(r)}
                className="block w-full border-b border-white/5 px-3.5 py-2.5 text-left transition last:border-0 hover:bg-white/5"
              >
                <div className="text-[12.5px] font-medium text-white">{r.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-white/40">{r.display}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 地图 */}
      <div className="relative m-4 mb-3 min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10">
        <div ref={containerRef} className="geo-map absolute inset-0 z-0" />
        {/* 图层 */}
        <div className="absolute left-2.5 top-2.5 z-10 flex overflow-hidden rounded-lg border border-white/10 bg-black/60 backdrop-blur-sm">
          {(
            [
              ['street', MapIcon, '标准'],
              ['satellite', Satellite, '卫星'],
              ['osm', Globe, 'OSM'],
            ] as [LayerKey, typeof MapIcon, string][]
          ).map(([k, Icon, label]) => (
            <button
              key={k}
              onClick={() => setLayer(k)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] transition ${
                layer === k ? 'bg-[#FFD028] font-semibold text-black' : 'text-white/70 hover:bg-white/10'
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>
        {/* 定位 */}
        <button
          onClick={useGPS}
          title="回到 GPS 实时定位"
          className={`absolute bottom-3 right-2.5 z-10 flex h-10 w-10 items-center justify-center rounded-full border shadow-lg backdrop-blur-sm transition ${
            p.source === 'gps'
              ? 'border-[#FFD028]/60 bg-[#FFD028] text-black'
              : 'border-white/15 bg-black/60 text-white/80 hover:bg-white/15'
          }`}
        >
          <LocateFixed size={17} />
        </button>
      </div>

      {/* 底部坐标卡 */}
      <div className="border-t border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-[10.5px] tracking-wider text-white/40">
            当前定位坐标 · {FORMAT_LABELS[p.format]} · {p.system === 'wgs84' ? 'WGS-84' : 'GCJ-02'}
          </div>
          <button
            onClick={copyCoords}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            复制
          </button>
        </div>
        {coordStr ? (
          <div className="mt-1 font-mono text-[13px] font-medium leading-relaxed text-[#FFD028]">
            <div>{coordStr.latStr}</div>
            <div>{coordStr.lngStr}</div>
          </div>
        ) : (
          <div className="mt-1 text-[12px] text-white/40">尚未定位</div>
        )}
        <button
          onClick={() => {
            p.onToast('位置已同步到相机水印');
            p.onClose();
          }}
          className="mt-3 w-full rounded-xl bg-[#FFD028] py-2.5 text-[13px] font-bold text-black transition hover:brightness-110 active:scale-[0.99]"
        >
          完成 · 该位置已写入相机
        </button>
      </div>
    </motion.div>
  );
}
