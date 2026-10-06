import { motion } from 'framer-motion';
import { X, Download, MapPin, RefreshCw } from 'lucide-react';

export interface Shot {
  id: number;
  url: string;
  timeLabel: string;
  address: string;
  latStr: string;
  lngStr: string;
  fileName: string;
  photoUri?: string;
}

interface Props {
  shot: Shot | null;
  onClose: () => void;
}

export default function CaptureModal({ shot, onClose }: Props) {
  if (!shot) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 24 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, y: 16 }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/15 bg-[#0c0f12] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#FFD028]" />
            <span className="text-[13.5px] font-semibold text-white">拍摄完成</span>
            <span className="font-mono text-[12px] text-white/40">{shot.timeLabel}</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[62vh] overflow-hidden bg-black/40">
          <img src={shot.url} alt="工程照片" className="mx-auto max-h-[62vh] w-auto max-w-full object-contain" />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 px-4 py-2.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-white/70">
            <MapPin size={13} className="shrink-0 text-[#FFD028]" />
            <span className="truncate">{shot.address || '未知位置'}</span>
          </span>
          <span className="font-mono text-[11.5px] text-[#FFD028]/90">
            {shot.latStr} · {shot.lngStr}
          </span>
        </div>

        <div className="flex gap-2.5 border-t border-white/10 p-3.5">
          <button
            onClick={onClose}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 py-2.5 text-[13px] font-medium text-white/80 transition hover:bg-white/5"
          >
            <RefreshCw size={15} />
            继续拍摄
          </button>
          <a
            href={shot.url}
            download={shot.fileName}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#FFD028] py-2.5 text-[13px] font-bold text-black transition hover:brightness-110 active:scale-[0.99]"
          >
            <Download size={15} />
            下载照片
          </a>
        </div>
      </motion.div>
    </motion.div>
  );
}
