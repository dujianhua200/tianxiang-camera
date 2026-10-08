/* 存证校验面板：哈希链账本校验 + 暗水印读取验证 */
import { useEffect, useState } from 'react';
import { X, ShieldCheck, CheckCircle2, AlertTriangle, FileQuestion, Loader2 } from 'lucide-react';
import type { Shot } from './CaptureModal';
import {
  verifyChain,
  readChain,
  readTxwm,
  dataUrlToBytes,
  type VerifyReport,
  type TxwmPayload,
  type PhotoStatus,
} from '../lib/provenance';

interface Props {
  open: boolean;
  onClose: () => void;
  shots: Shot[];
}

const fmtT = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const STATUS_META: Record<PhotoStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: '一致', cls: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10', Icon: CheckCircle2 },
  tampered: { label: '疑似篡改', cls: 'text-red-300 border-red-400/30 bg-red-400/10', Icon: AlertTriangle },
  missing: { label: '不在本机', cls: 'text-zinc-400 border-white/15 bg-white/5', Icon: FileQuestion },
};

export default function ChainPanel({ open, onClose, shots }: Props) {
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [wm, setWm] = useState<TxwmPayload | null | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    setReport(null);
    setWm(undefined);
    (async () => {
      try {
        const r = await verifyChain(shots.map((s) => ({ id: s.id, dataUrl: s.url })));
        setReport(r);
      } catch {
        setReport({ entries: [], chainOk: readChain().length === 0, brokenAt: null, checkedAt: Date.now() });
      } finally {
        setBusy(false);
      }
      /* 最新一张照片的暗水印回读 */
      try {
        setWm(shots[0] ? readTxwm(dataUrlToBytes(shots[0].url)) : null);
      } catch {
        setWm(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  if (!open) return null;

  const n = report?.entries.length ?? 0;
  const okCount = report?.entries.filter((e) => e.status === 'ok').length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#101418]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-[#FFD028]" />
            <span className="text-[14px] font-semibold text-white">存证校验</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {busy ? (
            <div className="flex items-center justify-center gap-2 py-10 text-white/50">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-[13px]">正在重算哈希…</span>
            </div>
          ) : (
            <>
              {/* 总览 */}
              <div className="mb-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-white/50">哈希链账本</span>
                  {report && (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        report.chainOk
                          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                          : 'border-red-400/30 bg-red-400/10 text-red-300'
                      }`}
                    >
                      {report.chainOk ? '链完整' : `断裂于第 ${(report.brokenAt ?? 0) + 1} 条`}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[13px] text-white/85">
                  共 {n} 条 · 本机可验 {okCount} 张一致
                </div>
              </div>

              {/* 暗水印回读 */}
              <div className="mb-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
                <div className="text-[12px] text-white/50">最新照片暗水印</div>
                {wm === undefined ? (
                  <div className="mt-1 text-[13px] text-white/40">读取中…</div>
                ) : wm ? (
                  <div className="mt-1 space-y-0.5 text-[12px] text-white/80">
                    <div>拍摄 {fmtT(wm.ts)}</div>
                    <div className="font-mono">
                      {wm.lat.toFixed(6)}, {wm.lng.toFixed(6)}
                    </div>
                    {wm.project && <div className="truncate">工程：{wm.project}</div>}
                    {wm.note && <div className="truncate">内容：{wm.note}</div>}
                  </div>
                ) : (
                  <div className="mt-1 text-[12px] text-amber-200/70">
                    无暗水印（旧版本照片，或经过转码/压缩）
                  </div>
                )}
              </div>

              {/* 条目 */}
              <div className="space-y-2">
                {report?.entries
                  .slice()
                  .reverse()
                  .map(({ entry, status }) => {
                    const m = STATUS_META[status];
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[12px] text-white/85">
                            {entry.fileName || `照片 ${entry.id}`}
                          </div>
                          <div className="font-mono text-[11px] text-white/40">{fmtT(entry.ts)}</div>
                        </div>
                        <span
                          className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${m.cls}`}
                        >
                          <m.Icon size={12} />
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                {n === 0 && (
                  <div className="py-6 text-center text-[12px] text-white/40">
                    还没有存证记录，拍一张照片即自动上链
                  </div>
                )}
              </div>

              <div className="mt-3 text-[11px] leading-relaxed text-white/35">
                暗水印藏在 JPEG 文件头中，肉眼不可见，随原文件复制/上传保留；转码、重压缩、裁剪会丢失，此时以本机哈希链账本为准。服务端 /api/verify 上线后可跨设备校验。
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
