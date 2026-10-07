/* 施工日志拼图面板：本次拍摄 / 相册多选 → 按时间拼长图 → 下载 */
import { useMemo, useRef, useState } from 'react';
import { X, Download, Images, FolderOpen, Loader2 } from 'lucide-react';
import type { Shot } from './CaptureModal';
import { buildDiaryImage, loadImage, DiaryPhoto } from '../lib/diary';
import { parseExifTime } from '../lib/exif';

interface Props {
  open: boolean;
  onClose: () => void;
  shots: Shot[];
  project: string;
  weather: string;
  photographer: string;
}

const fmtT = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtD = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
};

export default function DiaryPanel({ open, onClose, shots, project, weather, photographer }: Props) {
  const [tab, setTab] = useState<'session' | 'gallery'>('session');
  const [picked, setPicked] = useState<{ url: string; time: string; address: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [meta, setMeta] = useState({ project, weather, photographer, date: fmtD(new Date()) });
  const fileRef = useRef<HTMLInputElement>(null);

  const sessionList = useMemo(
    () =>
      shots.map((s) => ({
        url: s.url,
        time: s.timeLabel.replace(/-/g, '.'),
        address: s.address || '',
      })),
    [shots]
  );
  const list = tab === 'session' ? sessionList : picked;

  if (!open) return null;

  const onGallery = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      const arr: { url: string; time: string; address: string; ts: number }[] = [];
      for (const f of Array.from(files).slice(0, 40)) {
        const url = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.onerror = rej;
          r.readAsDataURL(f);
        });
        let d: Date | null = null;
        try {
          d = await parseExifTime(url);
        } catch {
          /* ignore */
        }
        const dt = d || new Date(f.lastModified);
        arr.push({ url, time: fmtT(dt), address: '', ts: dt.getTime() });
      }
      arr.sort((a, b) => a.ts - b.ts);
      setPicked(arr.map(({ url, time, address }) => ({ url, time, address })));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!list.length) return;
    setBusy(true);
    setResult(null);
    try {
      const photos: DiaryPhoto[] = [];
      for (const it of list) photos.push({ img: await loadImage(it.url), time: it.time, address: it.address });
      const url = await buildDiaryImage(photos, meta);
      setResult(url);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result;
    a.download = `施工日志_${meta.date.replace(/\./g, '')}.jpg`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-[#101418] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[15px] font-bold text-white">施工日志拼图</div>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="mb-3 flex gap-2">
          {(
            [
              ['session', `本次拍摄（${sessionList.length}）`],
              ['gallery', `相册多选（${picked.length}）`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`flex-1 rounded-lg border px-2 py-2 text-[12.5px] transition ${
                tab === v
                  ? 'border-[#FFD028]/60 bg-[#FFD028]/15 font-semibold text-[#FFD028]'
                  : 'border-white/10 bg-white/[0.03] text-white/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'gallery' && (
          <button
            onClick={() => fileRef.current?.click()}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/25 py-3 text-[13px] text-white/70 hover:text-white"
          >
            <FolderOpen size={15} /> 从相册多选照片（按拍摄时间排序）
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onGallery(e.target.files)}
        />

        {list.length > 0 && (
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {list.map((it, i) => (
              <img key={i} src={it.url} className="h-14 w-14 shrink-0 rounded-md object-cover" alt="" />
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-[12px]">
          {(
            [
              ['project', '工程名称'],
              ['date', '日期'],
              ['weather', '天气'],
              ['photographer', '拍摄人'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block">
              <span className="mb-1 block text-white/40">{label}</span>
              <input
                value={meta[k]}
                onChange={(e) => setMeta({ ...meta, [k]: e.target.value })}
                className="w-full rounded-lg border border-white/15 bg-white/[0.05] px-2.5 py-2 text-white outline-none focus:border-[#FFD028]/60"
              />
            </label>
          ))}
        </div>

        {result && (
          <div className="mt-3">
            <img src={result} className="max-h-64 w-full rounded-lg object-contain" alt="施工日志预览" />
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={generate}
            disabled={!list.length || busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#FFD028] py-2.5 text-[14px] font-bold text-black disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Images size={16} />}
            生成拼图
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
        <div className="mt-2 text-[11px] leading-relaxed text-white/35">
          按时间先后拼图并编号；相册多选时按照片 EXIF 拍摄时间排序（无 EXIF 则按文件时间）。
        </div>
      </div>
    </div>
  );
}
