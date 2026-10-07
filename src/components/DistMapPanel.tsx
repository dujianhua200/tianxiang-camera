/* 施工影像分布图面板：选日期 → 轨迹+照片点位成图 → 下载 PNG */
import { useMemo, useState } from 'react';
import { X, Download, Map as MapIcon, Loader2 } from 'lucide-react';
import type { Shot } from './CaptureModal';
import { getTrack, dayStr, parseCoordLabel, TrackPoint } from '../lib/track';
import { buildDistMap, DistPhoto } from '../lib/distmap';

interface Props {
  open: boolean;
  onClose: () => void;
  shots: Shot[];
  project: string;
  photographer: string;
}

const toDay = (d: Date) => dayStr(d);

export default function DistMapPanel({ open, onClose, shots, project, photographer }: Props) {
  const [date, setDate] = useState(toDay(new Date()));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [stat, setStat] = useState('');

  const data = useMemo(() => {
    const track: TrackPoint[] = getTrack(date);
    const photos: DistPhoto[] = [];
    for (const s of shots) {
      if (s.day !== date) continue;
      const lat = parseCoordLabel(s.latStr);
      const lng = parseCoordLabel(s.lngStr);
      if (lat == null || lng == null) continue;
      const tm = s.timeLabel.slice(11, 16);
      photos.push({ lat, lng, time: tm || s.timeLabel });
    }
    return { track, photos };
  }, [date, shots, open]);

  if (!open) return null;

  const generate = async () => {
    setBusy(true);
    try {
      // 让出主线程，保证 UI 先转圈
      await new Promise((r) => setTimeout(r, 30));
      const url = buildDistMap({ project, date, photographer }, data.track, data.photos);
      setResult(url);
      setStat(`轨迹 ${data.track.length} 点 · 照片 ${data.photos.length} 张`);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result;
    a.download = `施工影像分布图_${date.replace(/\./g, '')}.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-[#101418] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[15px] font-bold text-white">施工影像分布图</div>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <label className="mb-3 block text-[12px]">
          <span className="mb-1 block text-white/40">日期（轨迹按天记录）</span>
          <input
            type="text"
            value={date}
            onChange={(e) => { setDate(e.target.value); setResult(null); }}
            placeholder="2026.10.07"
            className="w-full rounded-lg border border-white/15 bg-white/[0.05] px-2.5 py-2 text-white outline-none focus:border-[#FFD028]/60"
          />
        </label>

        <div className="mb-3 rounded-lg bg-white/[0.04] px-3 py-2.5 text-[12.5px] leading-relaxed text-white/60">
          当天轨迹 <span className="font-semibold text-[#FFD028]">{data.track.length}</span> 点 ·
          本次拍摄照片 <span className="font-semibold text-[#FFD028]">{data.photos.length}</span> 张
          <div className="mt-1 text-[11px] text-white/35">
            轨迹在 GPS 定位期间自动记录（可在编辑-设置中关闭）；照片仅含本次打开 App 后拍摄的。
          </div>
        </div>

        {result && (
          <div className="mt-3">
            <img src={result} className="max-h-64 w-full rounded-lg object-contain" alt="分布图预览" />
            <div className="mt-1 text-center text-[11px] text-white/40">{stat}</div>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={generate}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#FFD028] py-2.5 text-[14px] font-bold text-black disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <MapIcon size={16} />}
            生成分布图
          </button>
          {result && (
            <button
              onClick={download}
              className="flex items-center gap-2 rounded-xl border border-[#FFD028]/60 px-4 py-2.5 text-[14px] font-semibold text-[#FFD028]"
            >
              <Download size={16} /> 下载
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
