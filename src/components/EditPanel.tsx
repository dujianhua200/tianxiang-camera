import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Clock,
  ClipboardList,
  Eye,
  RotateCcw,
  MapPinned,
  Cloud,
  ChevronDown,
  Palette,
  Settings,
  Download,
  Upload,
  Copy,
  Trash2,
  Check,
} from 'lucide-react';
import { CoordFormat, CoordSystem, FORMAT_LABELS } from '../lib/coords';
import { toLocalInput, simplifyAddress, type AddrMode } from '../lib/geo';
import { NOTE_PRESETS } from '../lib/presets';
import { cloudPing, cloudPingAsync, getCloudCfg } from '../lib/cloud';
import type { WMFields, WMStyle } from '../lib/capture';
import {
  allTemplates,
  getActiveTemplateId,
  setActiveTemplateId,
  loadCustomTemplates,
  saveCustomTemplates,
  templateToJson,
  templateToShareCode,
  importTemplateText,
} from '../lib/templates';

export interface Settings {
  timeMode: 'live' | 'custom';
  customTime: string;
  format: CoordFormat;
  system: CoordSystem;
  locationOverride: string;
  weather: string;
  project: string;
  note: string;
  altOverride: string;
  amapKey: string;
  addrMode: AddrMode;
  autoWeather: boolean;
  cloudOn: boolean;
  cloudUrl: string;
  cloudLan: string;
  cloudToken: string;
  fields: WMFields;
  wmStyle: WMStyle;
  wmPos: 'bottom' | 'top';
  grid: boolean;
  /** 水印大小（0.6–1.5）/ 透明度（0.4–1） */
  wmScale: number;
  wmAlpha: number;
  /** 轨迹记录开关（供影像分布图使用） */
  trackOn: boolean;
  /** 拍摄人（日志/分布图表头） */
  photographer: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  patch: (p: Partial<Settings>) => void;
  autoAddress: string;
  source: 'gps' | 'map';
  onOpenMap: () => void;
  onReset: () => void;
}

const STYLE_LABELS: Record<WMStyle, string> = {
  card: '工程卡片',
  hero: '今日大抬头',
  strip: '信息底栏',
  stamp: '打卡印章',
  site: '七星台账',
  today: '今日工程',
  todayWork: '今日工作',
  tpl: '自定义模板',
};

/** 可折叠分组：展开状态记 localStorage，下次打开保持 */
function Accordion(p: {
  id: string;
  icon: React.ReactNode;
  title: string;
  badge?: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        onClick={() => p.onToggle(p.id)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition hover:bg-white/[0.03]"
      >
        <span className="shrink-0 text-[#FFD028]">{p.icon}</span>
        <span className="flex-1 text-[13px] font-semibold text-white/90">{p.title}</span>
        {p.badge && (
          <span className="max-w-[130px] truncate text-[11px] text-white/40">{p.badge}</span>
        )}
        <ChevronDown
          size={15}
          className={`shrink-0 text-white/40 transition-transform duration-200 ${p.open ? 'rotate-180' : ''}`}
        />
      </button>
      {p.open && <div className="border-t border-white/[0.07] px-3.5 py-3.5">{p.children}</div>}
    </div>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`flex-1 rounded-md px-2 py-1.5 text-[12px] transition ${
            value === o.v ? 'bg-[#FFD028] font-semibold text-black' : 'text-white/60 hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <span className="w-10 shrink-0 text-[12px] text-white/60">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 flex-1 accent-[#FFD028]"
      />
      <span className="w-11 shrink-0 text-right text-[12px] tabular-nums text-white/80">{format(value)}</span>
    </div>
  );
}

/* ---------- 水印模板管理：应用 / 导出 / 分享码 / 导入 / 删除 ---------- */
function TemplateManager() {
  const [list, setList] = useState(allTemplates);
  const [active, setActive] = useState(getActiveTemplateId());
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErr, setImportErr] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    setList(allTemplates());
    setActive(getActiveTemplateId());
  };
  const apply = (id: string) => {
    setActiveTemplateId(id);
    refresh();
  };
  const doExport = (id: string) => {
    const t = list.find((x) => x.id === id);
    if (!t) return;
    const blob = new Blob([templateToJson(t)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `水印模板_${t.name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const doCopyCode = async (id: string) => {
    const t = list.find((x) => x.id === id);
    if (!t) return;
    try {
      await navigator.clipboard.writeText(templateToShareCode(t));
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* 剪贴板不可用 */
    }
  };
  const doDelete = (id: string) => {
    const customs = loadCustomTemplates().filter((x) => x.id !== id);
    saveCustomTemplates(customs);
    if (getActiveTemplateId() === id) setActiveTemplateId('built-in:today-yellow');
    refresh();
  };
  const doImport = () => {
    const { tpl, errors } = importTemplateText(importText);
    setImportErr(errors);
    if (!tpl) return;
    const customs = loadCustomTemplates();
    customs.push(tpl);
    saveCustomTemplates(customs);
    setImportText('');
    setShowImport(false);
    apply(tpl.id);
  };
  const onFile = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      setImportText(String(r.result || ''));
      setShowImport(true);
    };
    r.readAsText(f);
  };

  return (
    <div className="space-y-2">
      {list.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
            active === t.id ? 'border-[#FFD028]/60 bg-[#FFD028]/10' : 'border-white/10 bg-white/[0.03]'
          }`}
        >
          <button onClick={() => apply(t.id)} className="min-w-0 flex-1 text-left">
            <div className={`truncate text-[13px] ${active === t.id ? 'font-semibold text-[#FFD028]' : 'text-white/80'}`}>
              {t.name}
            </div>
            <div className="text-[10.5px] text-white/35">
              {t.builtin ? '内置' : '自定义'} · {t.rows.length} 行
            </div>
          </button>
          {active === t.id && <Check size={14} className="shrink-0 text-[#FFD028]" />}
          <button onClick={() => doExport(t.id)} title="导出 JSON 文件（发给队友）" className="text-white/50 hover:text-white">
            <Download size={14} />
          </button>
          <button onClick={() => doCopyCode(t.id)} title="复制分享码（粘贴即导入）" className="text-white/50 hover:text-white">
            {copied === t.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          </button>
          {!t.builtin && (
            <button onClick={() => doDelete(t.id)} title="删除" className="text-white/50 hover:text-red-400">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button
          onClick={() => setShowImport(!showImport)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 py-2 text-[12px] text-white/70 hover:text-white"
        >
          <Upload size={13} /> 导入模板
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 py-2 text-[12px] text-white/70 hover:text-white"
        >
          <Upload size={13} /> 从文件导入
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
      {showImport && (
        <div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="粘贴模板 JSON 或分享码…"
            rows={4}
            className="w-full rounded-lg border border-white/15 bg-white/[0.05] px-2.5 py-2 font-mono text-[11px] text-white outline-none focus:border-[#FFD028]/60"
          />
          {importErr.length > 0 && (
            <div className="mt-1 text-[11px] leading-relaxed text-red-400">{importErr.join('；')}</div>
          )}
          <button
            onClick={doImport}
            className="mt-1.5 w-full rounded-lg bg-[#FFD028] py-2 text-[13px] font-bold text-black"
          >
            确认导入
          </button>
        </div>
      )}
      <div className="text-[10.5px] leading-relaxed text-white/35">
        队里统一模板：导出 JSON 发群里，队友导入即用，全队水印格式一致。
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`flex w-1/2 items-center justify-between rounded-lg border px-3 py-2 text-left text-[12.5px] transition ${
        checked ? 'border-[#FFD028]/30 bg-[#FFD028]/8 text-white' : 'border-white/10 bg-white/[0.03] text-white/50'
      }`}
    >
      {label}
      <span
        className={`relative shrink-0 rounded-full transition ${checked ? 'bg-[#FFD028]' : 'bg-white/15'}`}
        style={{ height: 18, width: 32 }}
      >
        <span
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white transition-all ${
            checked ? 'left-[15px]' : 'left-[3px]'
          }`}
        />
      </span>
    </button>
  );
}

const inputCls =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white outline-none transition placeholder:text-white/25 focus:border-[#FFD028]/50';

export default function EditPanel(p: Props) {
  const s = p.settings;
  const { patch } = p;
  const [cloudTest, setCloudTest] = useState('');
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;
  const setField = (k: keyof WMFields, v: boolean) => patch({ fields: { ...s.fields, [k]: v } });

  const [openSecs, setOpenSecs] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('tx.edit.sections');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch {
      /* 读不到就用默认 */
    }
    return ['style', 'content', 'site'];
  });
  const toggleSec = (id: string) =>
    setOpenSecs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem('tx.edit.sections', JSON.stringify(next));
      } catch {
        /* 存不下也无妨 */
      }
      return next;
    });
  const acc = (id: string) => ({ open: openSecs.includes(id), onToggle: toggleSec });

  return (
    <motion.div
      initial={isDesktop ? { x: -420, opacity: 0 } : { y: '100%' }}
      animate={isDesktop ? { x: 0, opacity: 1 } : { y: 0 }}
      exit={isDesktop ? { x: -420, opacity: 0 } : { y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 260 }}
      className="fixed inset-x-0 bottom-0 z-40 flex h-[82dvh] flex-col overflow-hidden rounded-t-3xl border-t border-white/15 bg-[#0b0e11] shadow-2xl md:inset-x-auto md:bottom-3 md:left-3 md:top-3 md:h-auto md:w-[380px] md:rounded-2xl md:border"
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFD028]/15">
          <ClipboardList size={17} className="text-[#FFD028]" />
        </div>
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-white">水印信息编辑</div>
          <div className="text-[11px] text-white/45">点击画面水印也可快速打开</div>
        </div>
        <button
          onClick={p.onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X size={17} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-5">
        {/* 时间 */}
        <Accordion id="style" icon={<Palette size={15} />} title="水印样式" badge={STYLE_LABELS[s.wmStyle]} {...acc("style")}>
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] text-white/40">水印样式</div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['card', '工程卡片'],
                ['hero', '今日大抬头'],
                ['strip', '信息底栏'],
                ['stamp', '打卡印章'],
                ['site', '七星台账'],
                ['today', '今日工程'],
                ['todayWork', '今日工作'],
                ['tpl', '自定义模板'],
              ] as [WMStyle, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => patch({ wmStyle: v })}
                className={`rounded-lg border px-2 py-2 text-[12px] transition ${
                  s.wmStyle === v
                    ? 'border-[#FFD028]/60 bg-[#FFD028]/15 font-semibold text-[#FFD028]'
                    : 'border-white/10 bg-white/[0.03] text-white/60 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1.5 text-[11px] text-white/40">水印位置</div>
          <Seg
            value={s.wmPos}
            options={[
              { v: 'bottom', label: '画面底部' },
              { v: 'top', label: '画面顶部' },
            ]}
            onChange={(v) => patch({ wmPos: v })}
          />
          {(s.wmStyle === 'hero' || s.wmStyle === 'strip') && (
            <div className="mt-1 text-[10.5px] text-amber-300/70">
              当前样式位置固定（大抬头=上+下、底栏=底部），此设置不生效
            </div>
          )}
        </div>

        <div className="mt-3">
          <div className="mb-1.5 text-[11px] text-white/40">水印大小 / 透明度</div>
          <Slider
            label="大小"
            value={s.wmScale}
            min={0.6}
            max={1.5}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => patch({ wmScale: v })}
          />
          <Slider
            label="透明度"
            value={s.wmAlpha}
            min={0.4}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => patch({ wmAlpha: v })}
          />
        </div>

        {s.wmStyle === 'tpl' && (
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] text-white/40">水印模板（JSON，可分享给全队统一）</div>
            <TemplateManager />
          </div>
        )}
        </Accordion>
        <Accordion id="content" icon={<Eye size={15} />} title="水印内容" {...acc("content")}>
        {/* 显示项 */}
        <div className="flex flex-wrap gap-2">
          <Toggle label="日期星期" checked={s.fields.date} onChange={(v) => setField('date', v)} />
          <Toggle label="地点地址" checked={s.fields.addr} onChange={(v) => setField('addr', v)} />
          <Toggle label="经度" checked={s.fields.lng} onChange={(v) => setField('lng', v)} />
          <Toggle label="纬度" checked={s.fields.lat} onChange={(v) => setField('lat', v)} />
          <Toggle label="海拔精度" checked={s.fields.alt} onChange={(v) => setField('alt', v)} />
          <Toggle label="天气" checked={s.fields.weather} onChange={(v) => setField('weather', v)} />
          <Toggle label="工程名称" checked={s.fields.project} onChange={(v) => setField('project', v)} />
          <Toggle label="施工内容" checked={s.fields.note} onChange={(v) => setField('note', v)} />
          <Toggle label="九宫格线" checked={s.grid} onChange={(v) => patch({ grid: v })} />
        </div>

        </Accordion>
        <Accordion id="datetime" icon={<Clock size={15} />} title="时间地点" {...acc("datetime")}>
        {/* 时间 */}
        <Seg
          value={s.timeMode}
          options={[
            { v: 'live', label: '实时时间' },
            { v: 'custom', label: '自定义时间' },
          ]}
          onChange={(v) => patch({ timeMode: v })}
        />
        {s.timeMode === 'custom' && (
          <input
            type="datetime-local"
            value={s.customTime}
            max={toLocalInput(new Date(new Date().getFullYear() + 5, 0, 1))}
            onChange={(e) => patch({ customTime: e.target.value })}
            className={`${inputCls} mt-2 [color-scheme:dark]`}
          />
        )}

        {/* 地点 */}
        <div className="mb-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/40">自动解析地址</span>
            <span className="rounded bg-[#FFD028]/15 px-1.5 py-0.5 text-[10.5px] text-[#FFD028]">
              {p.source === 'gps' ? 'GPS 实时' : '地图定点'}
            </span>
          </div>
          <div className="mt-1 text-[12.5px] leading-snug text-white/85">
            {simplifyAddress(p.autoAddress, s.addrMode) || '等待定位…'}
          </div>
        </div>
        <div className="mb-2">
          <Seg
            value={s.addrMode}
            options={[
              { v: 'full', label: '完整地址' },
              { v: 'short', label: '简洁' },
              { v: 'min', label: '极简' },
            ]}
            onChange={(v: AddrMode) => patch({ addrMode: v })}
          />
          <div className="mt-1 text-[10.5px] text-white/35">
            简洁=区·地标（如「东城区·王府井」）；极简=只留地标或街道
          </div>
        </div>
        <input
          value={s.locationOverride}
          onChange={(e) => patch({ locationOverride: e.target.value })}
          placeholder="自定义地点名称（留空使用自动地址）"
          className={inputCls}
        />
        <button
          onClick={p.onOpenMap}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#FFD028]/40 bg-[#FFD028]/10 py-2 text-[12.5px] font-medium text-[#FFD028] transition hover:bg-[#FFD028]/20"
        >
          <MapPinned size={14} />
          打开地图选点 · 改变相机经纬度
        </button>

        {/* 经纬度 */}
        <Seg
          value={s.format}
          options={(['dd', 'ddm', 'dms'] as CoordFormat[]).map((f) => ({
            v: f,
            label: FORMAT_LABELS[f],
          }))}
          onChange={(v) => patch({ format: v })}
        />
        <div className="mt-2">
          <Seg
            value={s.system}
            options={[
              { v: 'wgs84', label: 'WGS-84 坐标系' },
              { v: 'gcj02', label: 'GCJ-02（国测局）' },
            ]}
            onChange={(v: CoordSystem) => patch({ system: v })}
          />
        </div>

        </Accordion>
        <Accordion id="site" icon={<ClipboardList size={15} />} title="现场信息" {...acc("site")}>
        {/* 现场信息 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={s.weather}
              onChange={(e) => patch({ weather: e.target.value })}
              placeholder="天气，如：晴 26°C"
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={() => patch({ autoWeather: !s.autoWeather })}
              className={`shrink-0 rounded-lg border px-2.5 py-2 text-[11.5px] transition ${
                s.autoWeather
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                  : 'border-white/10 bg-white/[0.03] text-white/50'
              }`}
              title="按定位自动获取实时天气（Open-Meteo 免费源）"
            >
              {s.autoWeather ? '自动天气 ✓' : '自动天气'}
            </button>
          </div>
          <input
            value={s.altOverride}
            onChange={(e) => patch({ altOverride: e.target.value })}
            placeholder="海拔（留空自动，可填如：48.5 m）"
            className={inputCls}
          />
          <input
            value={s.project}
            onChange={(e) => patch({ project: e.target.value })}
            placeholder="工程名称"
            className={inputCls}
          />
          <input
            value={s.note}
            onChange={(e) => patch({ note: e.target.value })}
            placeholder="备注 / 施工内容（七星台账模板头部）"
            className={inputCls}
          />
          <input
            value={s.photographer}
            onChange={(e) => patch({ photographer: e.target.value })}
            placeholder="拍摄人（施工日志 / 分布图表头）"
            className={inputCls}
          />
          <Toggle label="记录轨迹（供施工影像分布图使用）" checked={s.trackOn} onChange={(v) => patch({ trackOn: v })} />
          <div className="flex flex-wrap gap-1.5">
            {NOTE_PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => patch({ note: c === '不填' ? '' : c })}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                  (c === '不填' ? !s.note : s.note === c)
                    ? 'border-[#FFD028]/60 bg-[#FFD028]/15 text-[#FFD028]'
                    : 'border-white/10 bg-white/[0.03] text-white/55 hover:text-white'
                }`}
              >
                {c}
              </button>
            ))}
            <button
              onClick={() => patch({ note: '' })}
              className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/55 transition hover:text-white"
            >
              不填
            </button>
          </div>
        </div>

        </Accordion>
        <Accordion id="cloud" icon={<Cloud size={15} />} title="同步备份" {...acc("cloud")}>
        {/* 家云同步 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="text-[12.5px] text-white/85">拍照后自动同步到飞牛 NAS</span>
            <button
              onClick={() => patch({ cloudOn: !s.cloudOn })}
              className={`relative h-[22px] w-[40px] rounded-full transition ${s.cloudOn ? 'bg-[#FFD028]' : 'bg-white/15'}`}
            >
              <span
                className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-all ${s.cloudOn ? 'left-[21px]' : 'left-[3px]'}`}
              />
            </button>
          </div>
          <input
            value={s.cloudUrl}
            onChange={(e) => patch({ cloudUrl: e.target.value })}
            placeholder="服务器地址，如 https://ledger.你的域名:9800 或 http://192.168.1.83:9800"
            spellCheck={false}
            className={`${inputCls} font-mono text-[12px]`}
          />
          <input
            value={s.cloudLan}
            onChange={(e) => patch({ cloudLan: e.target.value })}
            placeholder="家里 Wi-Fi 地址（可选）http://192.168.1.83:9800"
            spellCheck={false}
            className={`${inputCls} font-mono text-[12px]`}
          />
          <input
            value={s.cloudToken}
            onChange={(e) => patch({ cloudToken: e.target.value })}
            placeholder="邀请码（向管理员索取，如 tx888）"
            spellCheck={false}
            type="password"
            className={`${inputCls} font-mono text-[12px]`}
          />
          <button
            onClick={() => {
              const cfg = getCloudCfg();
              setCloudTest(`测试中…`);
              const show = (r: string) =>
                setCloudTest(r === 'ok' ? '✓ 连接成功' : `✗ ${r}`);
              if (!cloudPingAsync(cfg, show)) show(cloudPing(cfg));
            }}
            className="w-full rounded-lg border border-[#FFD028]/40 bg-[#FFD028]/10 py-2 text-[12.5px] font-medium text-[#FFD028] transition hover:bg-[#FFD028]/20"
          >
            测试连接
          </button>
          {cloudTest && (
            <div className={`text-[11px] ${cloudTest.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300'}`}>
              {cloudTest}
            </div>
          )}
          <div className="text-[10.5px] leading-snug text-white/35">
            首次拍照会用邀请码自动注册，管理员在网页后台点「同意」后开始同步；
            断网自动排队、恢复补传。
          </div>
        </div>

        </Accordion>
        <Accordion id="advanced" icon={<Settings size={15} />} title="高级" {...acc("advanced")}>
          <div className="mb-1.5 text-[11px] text-white/40">高德 Web 服务 Key</div>
        <input
          value={s.amapKey}
          onChange={(e) => patch({ amapKey: e.target.value })}
          placeholder="高德 Web服务 Key（免费申请，填入后地址解析到街道+POI 级）"
          spellCheck={false}
          className={`${inputCls} mt-2 font-mono text-[12px]`}
        />
        <div className="mt-1 text-[10.5px] leading-snug text-white/35">
          地址解析与地点搜索走高德精确服务（区/街道·最近POI，同元道·今日相机粒度）；
          源码不再内置 Key，请填入自己的高德 Web 服务 Key（console.amap.com 免费申请），
          不填则自动用免费逆地理服务。
        </div>

        <button
          onClick={p.onReset}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 py-2 text-[12px] text-white/50 transition hover:bg-white/5 hover:text-white"
        >
          <RotateCcw size={13} />
          恢复默认设置
        </button>
        <div className="mt-3 text-center font-mono text-[10px] tracking-widest text-white/25">
          天象七星 v1.03
        </div>
        </Accordion>
      </div>
    </motion.div>
  );
}
