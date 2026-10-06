import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Crosshair,
  LayoutGrid,
  SlidersHorizontal,
  SwitchCamera,
  MapPinned,
  Images,
  Loader2,
  VideoOff,
  Satellite,
  ImagePlus,
} from 'lucide-react';
import WatermarkCard from './components/WatermarkCard';
import MapPanel from './components/MapPanel';
import EditPanel, { Settings } from './components/EditPanel';
import CaptureModal, { Shot } from './components/CaptureModal';
import { composePhoto, antiCode, WatermarkData } from './lib/capture';
import { parseExifTime, parseExifGps } from './lib/exif';
import { NOTE_PRESETS } from './lib/presets';
import { GeoPoint, Datum, toDatum, formatLatLng } from './lib/coords';
import {
  reverseGeocode,
  fetchWeather,
  fmtTime,
  fmtDate,
  fmtWeekday,
  fmtFileTime,
  toLocalInput,
  getAmapKey,
  setAmapKey,
  simplifyAddress,
} from './lib/geo';
import {
  getCloudCfg,
  setCloudCfg,
  cloudUpload,
  cloudUploadAsync,
  enqueue,
  flushQueueAsync,
  getDeviceId,
  deviceName as devName,
  type CloudMeta,
} from './lib/cloud';

declare global {
  interface Window {
    /** Android 壳桥：savePhoto 存相册返回 ok|contentUri；openPhoto 跳系统相册；httpPost/httpGet 家云同步通道 */
    AndroidBridge?: {
      savePhoto: (base64: string, fileName: string) => string;
      openPhoto?: (uri: string) => string;
      httpPost?: (url: string, jsonBody: string) => string;
      httpPostFile?: (url: string, token: string, metaJson: string, uri: string) => string;
      httpGet?: (url: string) => string;
      httpPostAsync?: (url: string, jsonBody: string, cbTemplate: string, connectMs: number) => string;
      httpGetAsync?: (url: string, cbTemplate: string, connectMs: number) => string;
    };
  }
}

const STYLE_LABELS: Record<string, string> = {
  card: '工程卡片', hero: '今日大抬头', strip: '信息底栏', stamp: '打卡印章', site: '七星台账',
};

const CLOUD0 = getCloudCfg();

const DEFAULT_SETTINGS: Settings = {
  timeMode: 'live',
  customTime: toLocalInput(new Date()),
  format: 'dd',
  system: 'wgs84',
  locationOverride: '',
  weather: '晴 26°C',
  project: '市政道路改造工程 · 三标段',
  note: '路基压实度检测 K2+350',
  altOverride: '',
  amapKey: getAmapKey(),
  addrMode: 'short',
  autoWeather: true,
  cloudOn: CLOUD0.on,
  cloudUrl: CLOUD0.url,
  cloudLan: CLOUD0.lan,
  cloudToken: CLOUD0.token,
  fields: { date: true, addr: true, coords: true, alt: true, weather: true, project: true, note: true },
  wmStyle: 'card',
  wmPos: 'bottom',
  grid: true,
};

type CamStatus = 'loading' | 'live' | 'fallback';

export default function App() {
  /* ---------- 基础状态 ---------- */
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const patch = (p: Partial<Settings>) => {
    if (p.amapKey !== undefined) setAmapKey(p.amapKey.trim());
    if (p.weather !== undefined) weatherTouchedRef.current = true;
    if (p.cloudUrl !== undefined || p.cloudToken !== undefined || p.cloudOn !== undefined || p.cloudLan !== undefined) {
      const cur = getCloudCfg();
      setCloudCfg({
        url: p.cloudUrl !== undefined ? p.cloudUrl.trim() : cur.url,
        lan: p.cloudLan !== undefined ? p.cloudLan.trim() : cur.lan,
        token: p.cloudToken !== undefined ? p.cloudToken.trim() : cur.token,
        on: p.cloudOn !== undefined ? p.cloudOn : cur.on,
      });
    }
    setSettings((s) => ({ ...s, ...p }));
  };

  const [pos, setPos] = useState<GeoPoint>({ lat: 39.90872, lng: 116.39749, datum: 'gcj02' });
  const [source, setSource] = useState<'gps' | 'map'>('map');
  const [lastGps, setLastGps] = useState<GeoPoint | null>(null);
  const [gpsFix, setGpsFix] = useState(false);
  const followRef = useRef(true); // 首次 GPS 定位后自动切换到实时模式

  const [autoAddress, setAutoAddress] = useState('');
  const [now, setNow] = useState(() => new Date());

  const [camStatus, setCamStatus] = useState<CamStatus>('loading');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgReady, setImgReady] = useState(false);

  const [mapOpen, setMapOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [notePick, setNotePick] = useState(false);
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [activeShot, setActiveShot] = useState<Shot | null>(null);
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = (msg: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), msg });
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  /* ---------- 时钟 ---------- */
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const effDate = useMemo(() => {
    if (settings.timeMode === 'custom' && settings.customTime) {
      const d = new Date(settings.customTime);
      if (!isNaN(+d)) return d;
    }
    return now;
  }, [settings.timeMode, settings.customTime, now]);

  /* ---------- 摄像头 ---------- */
  const [camNonce, setCamNonce] = useState(0);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setCamStatus('loading');
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCamStatus('live');
      } catch {
        if (!cancelled) setCamStatus('fallback');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing, camNonce]);

  /* 后台回前台自愈：系统可能回收相机导致画面冻结，检测轨道失效/时间停滞则重新取流 */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const v = videoRef.current;
      if (!v) return;
      const track = v.srcObject ? (v.srcObject as MediaStream).getVideoTracks()[0] : null;
      if (!track || track.readyState !== 'live') {
        setCamNonce((n) => n + 1);
        return;
      }
      v.play().catch(() => {});
      const t0 = v.currentTime;
      setTimeout(() => {
        const vv = videoRef.current;
        if (vv && Math.abs(vv.currentTime - t0) < 0.01) setCamNonce((n) => n + 1);
      }, 600);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /* ---------- GPS ---------- */
  const gpsErrToastRef = useRef(false);
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const g = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          alt: p.coords.altitude,
          acc: p.coords.accuracy,
        };
        setLastGps({ lat: g.lat, lng: g.lng, datum: 'wgs84', altitude: g.alt, accuracy: g.acc });
        setGpsFix(true);
        if (followRef.current) {
          setSource('gps');
          setPos({ lat: g.lat, lng: g.lng, datum: 'wgs84', altitude: g.alt, accuracy: g.acc });
        } else {
          setPos((old) => ({ ...old, altitude: old.altitude ?? g.alt }));
        }
      },
      () => {
        if (!gpsErrToastRef.current) {
          gpsErrToastRef.current = true;
          showToast('无法获取定位，请检查系统定位服务是否开启');
        }
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 逆地理编码 ---------- */
  /* 量化到 1e-4（约 11m）：GPS 抖动不触发重解析；已有地址在解析期间保留不闪回 */
  const posKey = `${pos.lat.toFixed(4)},${pos.lng.toFixed(4)},${pos.datum},${settings.amapKey}`;
  useEffect(() => {
    const w = toDatum(pos.lat, pos.lng, pos.datum, 'wgs84');
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const a = await reverseGeocode(w.lat, w.lng, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setAutoAddress(a ?? '地址解析失败 · 可在编辑中手填地点');
    }, 600);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey]);

  /* ---------- 自动天气（今日/元道同款体验：无需手填） ---------- */
  const weatherTouchedRef = useRef(false);
  const weatherKey = `${pos.lat.toFixed(2)},${pos.lng.toFixed(2)}`;
  useEffect(() => {
    if (!settings.autoWeather || weatherTouchedRef.current) return;
    const w = toDatum(pos.lat, pos.lng, pos.datum, 'wgs84');
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const s = await fetchWeather(w.lat, w.lng, ctrl.signal);
      if (ctrl.signal.aborted || !s) return;
      if (!weatherTouchedRef.current) {
        setSettings((old) => (old.autoWeather && !weatherTouchedRef.current ? { ...old, weather: s } : old));
      }
    }, 900);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherKey, settings.autoWeather]);

  /* ---------- 水印数据 ---------- */
  /* atPos：相册导入时可传入照片 EXIF 自带 GPS（不用当前定位，保证台账位置真实） */
  const buildData = (atDate?: Date, atPos?: GeoPoint, atAddress?: string): WatermarkData => {
    const dt = atDate ?? effDate;
    const pp = atPos ?? pos;
    const disp = toDatum(pp.lat, pp.lng, pp.datum, settings.system);
    const cs = formatLatLng(disp.lat, disp.lng, settings.format);
    const altLine =
      settings.altOverride ||
      (pp.altitude != null
        ? `海拔 ${pp.altitude.toFixed(1)} m` + (pp.accuracy ? ` · 精度 ±${pp.accuracy.toFixed(0)} m` : '')
        : pp.accuracy
          ? `精度 ±${pp.accuracy.toFixed(0)} m`
          : '海拔 —  m');
    const p = (n: number) => n.toString().padStart(2, '0');
    const siteTime = `${dt.getFullYear()}.${p(dt.getMonth() + 1)}.${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
    const siteLng = `${Math.abs(disp.lng).toFixed(6)}°${disp.lng >= 0 ? 'E' : 'W'}`;
    const siteLat = `${Math.abs(disp.lat).toFixed(6)}°${disp.lat >= 0 ? 'N' : 'S'}`;
    return {
      timeStr: fmtTime(dt),
      dateStr: fmtDate(dt),
      weekdayStr: fmtWeekday(dt),
      address:
        atAddress ||
        settings.locationOverride ||
        simplifyAddress(autoAddress, settings.addrMode) ||
        '位置解析中…',
      latStr: cs.latStr,
      lngStr: cs.lngStr,
      altLine,
      weather: settings.weather,
      project: settings.project,
      note: settings.note,
      sourceLabel: source === 'gps' ? 'GPS 实时' : '地图定点',
      siteTime,
      siteLng,
      siteLat,
      antiCode: antiCode(siteTime, siteLat, siteLng),
    };
  };
  const wmData = buildData();

  /* ---------- 地图交互 ---------- */
  const handlePick = (lat: number, lng: number, datum: Datum) => {
    followRef.current = false;
    setSource('map');
    setPos((old) => ({ lat, lng, datum, altitude: old.altitude ?? null, accuracy: null }));
  };

  const handleUseGPS = () => {
    if (!lastGps) {
      showToast('暂无 GPS 信号');
      return;
    }
    followRef.current = true;
    setSource('gps');
    /* 带上海拔/精度一起切回，避免水印海拔行瞬间变"—" */
    setPos({ ...lastGps });
    showToast('已切换 GPS 实时定位');
  };

  /* ---------- 快门 ---------- */
  const [fly, setFly] = useState<{ url: string; id: number } | null>(null);
  const shutterRef = useRef<HTMLButtonElement>(null);
  const galleryRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* 出片收尾：存相册 + 家云同步 + 飞入动画（拍摄与相册导入共用） */
  const finalizeShot = (url: string, data: WatermarkData, d: Date) => {
    const b64 = url.slice(url.indexOf(',') + 1);
    /* 先把相册落盘结果算完，再组装不可变的 shot 对象进 state */
    let savedMsg = '照片已生成';
    let photoUri: string | undefined;
    try {
      if (window.AndroidBridge?.savePhoto) {
        const fileName = `天象七星_${fmtFileTime(d)}.jpg`;
        const ret = window.AndroidBridge.savePhoto(b64, fileName);
        if (ret.startsWith('ok')) {
          savedMsg = '已保存到相册 · 天象七星';
          const uri = ret.slice(3);
          if (uri) photoUri = uri;
        } else {
          savedMsg = `保存相册失败：${ret}`;
        }
      }
    } catch {
      savedMsg = '保存相册失败，可点缩略图手动下载';
    }
    const shot: Shot = {
      id: Date.now(),
      url,
      timeLabel: `${fmtDate(d)} ${fmtTime(d)}`,
      address: data.address === '位置解析中…' ? '' : data.address,
      latStr: data.latStr,
      lngStr: data.lngStr,
      fileName: `天象七星_${fmtFileTime(d)}.jpg`,
      photoUri,
    };
    setShots((s) => [shot, ...s].slice(0, 10));
    const meta: CloudMeta = {
      fileName: shot.fileName,
      project: settings.project,
      note: settings.note,
      time: data.siteTime,
      lat: data.siteLat,
      lng: data.siteLng,
      alt: data.altLine,
      addr: data.address,
      weather: settings.weather,
      style: STYLE_LABELS[settings.wmStyle] || settings.wmStyle,
      device: '天象七星-Android',
      deviceId: getDeviceId(),
      deviceName: devName(getDeviceId()),
    };
    setFly({ url, id: shot.id });
    showToast(savedMsg);
    /* 云同步：上传压缩版网页图（长边≤1280，约 250KB），远程/中继通道更稳 */
    const cloudCfg = getCloudCfg();
    if (cloudCfg.on && cloudCfg.url) {
      (async () => {
        let small = '';
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          const sc = Math.min(1, 1280 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * sc);
          c.height = Math.round(img.height * sc);
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
          small = c.toDataURL('image/jpeg', 0.8).slice('data:image/jpeg;base64,'.length);
        } catch {
          small = b64; // 压缩失败退回原图
        }
        const handle = (up: string) => {
          if (up === 'ok') {
            showToast('已同步家云 ✓');
          } else if (up === 'pending') {
            enqueue({ meta, image: small });
            showToast('已注册 · 等待管理员审批通过后自动上传');
          } else if (up === 'blocked') {
            showToast('设备已被管理员封禁');
          } else if (up === 'bad-invite') {
            showToast('邀请码错误，请核对');
          } else if (up === 'bad-response') {
            enqueue({ meta, image: small });
            showToast('地址被网页代理拦截 · 需直连IP或内网穿透');
          } else {
            enqueue({ meta, image: small });
            showToast('家云暂不可达 · 已排队补传');
          }
        };
        /* 后台线程上传，UI 不阻塞；无异步桥的旧环境回退同步 */
        if (!cloudUploadAsync(cloudCfg, meta, small, handle)) {
          handle(cloudUpload(cloudCfg, meta, small));
        }
      })();
    }
  };

  const onShutter = async () => {
    navigator.vibrate?.(18);
    setFlash(true);
    setTimeout(() => setFlash(false), 480);
    try {
      const data = buildData();
      const url = await composePhoto({
        video: videoRef.current,
        image: imgRef.current,
        mirrored: facing === 'user',
        wmPos: settings.wmPos,
        wmStyle: settings.wmStyle,
        data,
        fields: settings.fields,
      });
      finalizeShot(url, data, effDate);
    } catch {
      showToast('画面未就绪，请稍候');
    }
  };

  /* ---------- 相册导入：本地照片加水印（优先 EXIF 原始拍摄时间 + 原始 GPS） ---------- */
  const importPhoto = async (dataUrl: string, lastModified?: number) => {
    try {
      const exif = await parseExifTime(dataUrl);
      const gps = await parseExifGps(dataUrl);
      const dt = exif ?? (lastModified ? new Date(lastModified) : new Date());
      /* 照片自带 GPS（WGS-84）优先：水印位置用照片真实拍摄地，而非当前定位 */
      const photoPos: GeoPoint | undefined = gps
        ? { lat: gps.lat, lng: gps.lng, datum: 'wgs84' }
        : undefined;
      /* 照片 GPS 的地址单独逆解析：不能用当前定位的地址 */
      let photoAddr: string | undefined;
      if (photoPos) {
        try {
          photoAddr = (await reverseGeocode(photoPos.lat, photoPos.lng)) || undefined;
        } catch {
          /* 解析失败则回退默认地址逻辑 */
        }
      }
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const data = buildData(dt, photoPos, photoAddr);
      const url = await composePhoto({
        video: null,
        image: img,
        mirrored: false,
        wmPos: settings.wmPos,
        wmStyle: settings.wmStyle,
        data,
        fields: settings.fields,
      });
      finalizeShot(url, data, dt);
      if (photoPos) showToast('已采用照片原始 GPS 位置');
    } catch {
      showToast('照片导入失败');
    }
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => importPhoto(String(fr.result), f.lastModified);
    fr.onerror = () => showToast('照片读取失败');
    fr.readAsDataURL(f);
  };

  /* 调试/自动化钩子：CDP 可直接调 window.__txImport(dataUrl) */
  useEffect(() => {
    (window as unknown as { __txImport?: (u: string) => Promise<void> }).__txImport = (u: string) =>
      importPhoto(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 启动后补传离线队列（异步，不卡界面） */
  useEffect(() => {
    const run = () =>
      flushQueueAsync(getCloudCfg(), (n, fails) => {
        try {
          localStorage.setItem('geocam.cloud.lastflush', JSON.stringify({ n, fails, at: Date.now() }));
        } catch {
          /* ignore */
        }
        if (n > 0) showToast(`已补传 ${n} 张到家云`);
      });
    (window as unknown as { __txFlush?: () => void }).__txFlush = run;
    const t = setTimeout(run, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drawerOpen = mapOpen || editOpen;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05070a] text-white [font-family:'Noto_Sans_SC',system-ui,sans-serif]">
      {/* ================= 取景器 ================= */}
      <div className="absolute inset-0">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
            camStatus === 'live' ? 'opacity-100' : 'opacity-0'
          } ${facing === 'user' ? '-scale-x-100' : ''}`}
        />
        {camStatus !== 'live' && (
          <img
            ref={imgRef}
            src="images/fallback-site.jpg"
            alt="施工现场"
            onLoad={() => setImgReady(true)}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
              imgReady ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {/* 暗角 */}
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(120%_90%_at_50%_40%,transparent_55%,rgba(0,0,0,0.55)_100%)]" />

        {/* 九宫格 + 中心准星 */}
        {settings.grid && (
          <div className="pointer-events-none absolute inset-0 z-10">
            <div className="absolute left-1/3 top-0 h-full w-px bg-white/15" />
            <div className="absolute left-2/3 top-0 h-full w-px bg-white/15" />
            <div className="absolute top-1/3 left-0 h-px w-full bg-white/15" />
            <div className="absolute top-2/3 left-0 h-px w-full bg-white/15" />
          </div>
        )}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 opacity-40">
          <Crosshair size={26} strokeWidth={1.2} className="text-[#FFD028]" />
        </div>

        {/* 四角框 */}
        <div className="pointer-events-none absolute inset-5 z-10">
          {['left-0 top-0 border-l-2 border-t-2 rounded-tl-lg', 'right-0 top-0 border-r-2 border-t-2 rounded-tr-lg', 'left-0 bottom-0 border-l-2 border-b-2 rounded-bl-lg', 'right-0 bottom-0 border-r-2 border-b-2 rounded-br-lg'].map(
            (c) => (
              <span key={c} className={`absolute h-6 w-6 border-[#FFD028]/45 ${c}`} />
            )
          )}
        </div>

        {/* 加载 / 后备提示 */}
        {camStatus === 'loading' && (
          <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
            <Loader2 size={30} className="animate-spin text-[#FFD028]" />
          </div>
        )}
        {camStatus === 'fallback' && (
          <div className="absolute left-1/2 top-[70px] z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-400/30 bg-black/60 px-3.5 py-1.5 backdrop-blur-sm">
            <VideoOff size={13} className="text-amber-400" />
            <span className="whitespace-nowrap text-[11px] text-amber-200/90">
              未检测到摄像头 · 已启用工程演示画面
            </span>
          </div>
        )}
      </div>

      {/* ================= 顶栏 ================= */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/75 to-transparent px-4 pb-8 pt-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFD028] shadow-lg shadow-[#FFD028]/20">
            <Crosshair size={19} className="text-black" />
          </div>
          <div>
            <div className="text-[14px] font-bold leading-tight tracking-wide">滑洲天象七星</div>
            <div className="font-mono text-[9.5px] tracking-[0.18em] text-white/40">
              TIANXIANG SAT-7 CAM
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUseGPS}
            title={source === 'gps' && gpsFix ? 'GPS 已定位' : '切换到 GPS 实时定位'}
            className={`mr-1 flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] transition sm:px-3 ${
              source === 'gps' && gpsFix
                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                : 'border-white/15 bg-black/40 text-white/60 hover:text-white'
            }`}
          >
            <Satellite size={12} />
            <span className="hidden sm:inline">
              {source === 'gps' && gpsFix ? 'GPS 已定位' : 'GPS 定位'}
            </span>
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            title="相册导入加水印"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-black/40 text-white/70 backdrop-blur-sm transition hover:text-white"
          >
            <ImagePlus size={16} />
          </button>
          <button
            onClick={() => patch({ grid: !settings.grid })}
            title="九宫格"
            className={`flex h-9 w-9 items-center justify-center rounded-xl border backdrop-blur-sm transition ${
              settings.grid
                ? 'border-[#FFD028]/50 bg-[#FFD028]/15 text-[#FFD028]'
                : 'border-white/15 bg-black/40 text-white/70 hover:text-white'
            }`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => {
              setEditOpen(true);
              setMapOpen(false);
            }}
            title="水印编辑"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-black/40 text-white/70 backdrop-blur-sm transition hover:text-white"
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* ================= 水印 ================= */}
      <WatermarkCard
        data={wmData}
        fields={settings.fields}
        position={settings.wmPos}
        style={settings.wmStyle}
        onClick={() => {
          setEditOpen(true);
          setMapOpen(false);
        }}
        onPickNote={() => {
          setEditOpen(false);
          setMapOpen(false);
          setNotePick(true);
        }}
      />

      {/* ================= 底栏 ================= */}
      <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-5 pb-[max(18px,env(safe-area-inset-bottom))] pt-12">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          {/* 相册 */}
          <button
            ref={galleryRef}
            onClick={() => {
              const shot = shots[0];
              if (!shot) return;
              if (shot.photoUri && window.AndroidBridge?.openPhoto) {
                const ret = window.AndroidBridge.openPhoto(shot.photoUri);
                if (ret === 'ok') return;
              }
              setActiveShot(shot);
            }}
            className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-white/5 transition hover:bg-white/10"
            title="最近照片"
          >
            {shots[0] ? (
              <img src={shots[0].url} className="h-full w-full object-cover" alt="最近照片" />
            ) : (
              <Images size={18} className="text-white/55" />
            )}
          </button>

          {/* 地图定点 */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              setMapOpen(true);
              setEditOpen(false);
            }}
            className="flex h-12 items-center gap-2 rounded-full border border-[#FFD028]/60 bg-[#FFD028]/12 px-4 text-[13px] font-semibold text-[#FFD028] backdrop-blur-sm transition hover:bg-[#FFD028]/25"
          >
            <MapPinned size={17} />
            地图定点
          </motion.button>

          {/* 快门 */}
          <motion.button
            ref={shutterRef}
            whileTap={{ scale: 0.88 }}
            onClick={onShutter}
            aria-label="拍摄"
            className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full border-[3px] border-white/90 bg-white/10 shadow-xl backdrop-blur-sm"
          >
            <span className="h-[58px] w-[58px] rounded-full bg-gradient-to-b from-[#FFD028] to-[#FF9500] shadow-inner transition hover:brightness-110" />
          </motion.button>

          {/* 切换摄像头 */}
          <button
            onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            disabled={camStatus !== 'live'}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/20 bg-white/5 text-white/75 transition enabled:hover:bg-white/10 disabled:opacity-30"
            title="前后摄像头"
          >
            <SwitchCamera size={18} />
          </button>

          {/* 编辑 */}
          <button
            onClick={() => {
              setEditOpen(true);
              setMapOpen(false);
            }}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/20 bg-white/5 text-white/75 transition hover:bg-white/10"
            title="水印编辑"
          >
            <SlidersHorizontal size={18} />
          </button>
        </div>
      </div>

      {/* ================= 抽屉背景 ================= */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setMapOpen(false);
              setEditOpen(false);
            }}
            className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      {/* ================= 抽屉 ================= */}
      <AnimatePresence>
        {mapOpen && (
          <MapPanel
            open={mapOpen}
            onClose={() => setMapOpen(false)}
            position={pos}
            source={source}
            gpsFix={gpsFix}
            lastGps={lastGps}
            format={settings.format}
            system={settings.system}
            onPick={handlePick}
            onUseGPS={handleUseGPS}
            onToast={showToast}
          />
        )}
        {editOpen && (
          <EditPanel
            open={editOpen}
            onClose={() => setEditOpen(false)}
            settings={settings}
            patch={patch}
            autoAddress={autoAddress}
            source={source}
            onOpenMap={() => {
              setEditOpen(false);
              setMapOpen(true);
            }}
            onReset={() => {
              setSettings({ ...DEFAULT_SETTINGS, amapKey: getAmapKey() });
              showToast('已恢复默认设置');
            }}
          />
        )}
      </AnimatePresence>

      {/* ================= 存入相册飞入动画 ================= */}
      <AnimatePresence>
        {fly &&
          (() => {
            const s = shutterRef.current?.getBoundingClientRect();
            const g = galleryRef.current?.getBoundingClientRect();
            if (!s || !g) return null;
            const size = 48;
            const from = { x: s.left + s.width / 2 - size / 2, y: s.top + s.height / 2 - size / 2 };
            const to = { x: g.left + g.width / 2 - size / 2, y: g.top + g.height / 2 - size / 2 };
            return (
              <motion.img
                key={`fly-${fly.id}`}
                src={fly.url}
                initial={{ x: from.x, y: from.y, scale: 1.5, opacity: 0, rotate: -6 }}
                animate={{
                  x: [from.x, (from.x + to.x) / 2 + 40, to.x],
                  y: [from.y, (from.y + to.y) / 2 - 60, to.y],
                  scale: [1.5, 1.1, 0.55],
                  opacity: [0, 1, 0.9],
                  rotate: [-6, 4, 0],
                }}
                transition={{ duration: 0.72, ease: [0.3, 0.7, 0.35, 1], times: [0, 0.55, 1] }}
                onAnimationComplete={() => setFly(null)}
                className="pointer-events-none fixed left-0 top-0 z-[70] h-12 w-12 rounded-xl border-2 border-[#FFD028]/80 object-cover shadow-xl shadow-black/60"
                style={{ originX: 0.5, originY: 0.5 }}
              />
            );
          })()}
      </AnimatePresence>

      {/* ================= 施工内容选项面板 ================= */}
      <AnimatePresence>
        {notePick && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setNotePick(false)}
              className="fixed inset-0 z-[48] bg-black/55 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
              className="fixed inset-x-0 bottom-0 z-[49] mx-auto max-w-lg rounded-t-3xl border-t border-white/15 bg-[#0b0e11] px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[14px] font-semibold text-white">选择施工内容</div>
                <button
                  onClick={() => setNotePick(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {NOTE_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      patch({ note: c });
                      setNotePick(false);
                    }}
                    className={`rounded-full border px-3.5 py-1.5 text-[12.5px] transition ${
                      settings.note === c
                        ? 'border-[#FFD028]/70 bg-[#FFD028]/15 font-semibold text-[#FFD028]'
                        : 'border-white/12 bg-white/[0.04] text-white/75 hover:text-white'
                    }`}
                  >
                    {c}
                  </button>
                ))}
                <button
                  onClick={() => {
                    patch({ note: '' });
                    setNotePick(false);
                  }}
                  className={`rounded-full border px-3.5 py-1.5 text-[12.5px] transition ${
                    !settings.note
                      ? 'border-[#FFD028]/70 bg-[#FFD028]/15 font-semibold text-[#FFD028]'
                      : 'border-white/12 bg-white/[0.04] text-white/55 hover:text-white'
                  }`}
                >
                  不填
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={settings.note}
                  onChange={(e) => patch({ note: e.target.value })}
                  placeholder="也可自定义输入…"
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white outline-none transition placeholder:text-white/25 focus:border-[#FFD028]/50"
                />
                <button
                  onClick={() => setNotePick(false)}
                  className="shrink-0 rounded-lg bg-[#FFD028] px-4 py-2 text-[13px] font-bold text-black transition hover:brightness-110"
                >
                  完成
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ================= 闪光 ================= */}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.9, 0] }}
            transition={{ duration: 0.45, times: [0, 0.12, 1] }}
            className="pointer-events-none fixed inset-0 z-[45] bg-white"
          />
        )}
      </AnimatePresence>

      {/* ================= 照片预览 ================= */}
      <AnimatePresence>
        {activeShot && <CaptureModal shot={activeShot} onClose={() => setActiveShot(null)} />}
      </AnimatePresence>

      {/* ================= Toast ================= */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-32 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/85 px-4 py-2 backdrop-blur-md"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#FFD028]" />
            <span className="whitespace-nowrap text-[12.5px] text-white/90">{toast.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ================= 相册导入（隐藏域） ================= */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChosen}
      />
    </div>
  );
}
