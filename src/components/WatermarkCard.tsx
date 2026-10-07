import { motion } from 'framer-motion';
import { MapPin, Navigation, Mountain, Briefcase, FileText, Thermometer } from 'lucide-react';
import type { WatermarkData, WMFields, WMStyle } from '../lib/capture';
import { getTemplate, getActiveTemplateId, tplRowValue, tplFieldOn } from '../lib/templates';

interface Props {
  data: WatermarkData;
  fields: WMFields;
  position: 'bottom' | 'top';
  style: WMStyle;
  alpha?: number;
  onClick: () => void;
  onPickNote: () => void;
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-[3px]">
      <span className="mt-[1px] shrink-0 text-[#FFD028]">{icon}</span>
      <span className="min-w-0 text-[12.5px] leading-snug text-white/95">{children}</span>
    </div>
  );
}

/** 施工内容行：点击弹出选项面板（今日相机式点选） */
function NoteRow({ onPickNote, note }: { onPickNote: () => void; note: string }) {
  return (
    <Row icon={<FileText size={14} />}>
      <span
        onClick={(e) => {
          e.stopPropagation();
          onPickNote();
        }}
        className="pointer-events-auto cursor-pointer break-words decoration-white/40 decoration-dotted underline-offset-4 hover:underline"
      >
        {note}
      </span>
    </Row>
  );
}

/** 信息行（地址/经纬度/海拔/工程/备注），各样式共用 */
function InfoRows({
  data,
  fields,
  monoCls = 'font-mono text-[12px]',
  onPickNote,
}: {
  data: WatermarkData;
  fields: WMFields;
  monoCls?: string;
  onPickNote?: () => void;
}) {
  return (
    <>
      {fields.addr && data.address && (
        <Row icon={<MapPin size={14} />}>
          <span className="break-words">{data.address}</span>
        </Row>
      )}
      {(fields.lat || fields.lng) && (
        <Row icon={<Navigation size={14} />}>
          <div className={`${monoCls} leading-relaxed text-white/95`}>
            {fields.lat && <div>{data.latStr}</div>}
            {fields.lng && <div>{data.lngStr}</div>}
          </div>
        </Row>
      )}
      {fields.alt && data.altLine && <Row icon={<Mountain size={14} />}>{data.altLine}</Row>}
      {fields.project && data.project && (
        <Row icon={<Briefcase size={14} />}>
          <span className="break-words">{data.project}</span>
        </Row>
      )}
      {fields.note && data.note && onPickNote && <NoteRow onPickNote={onPickNote} note={data.note} />}
      {fields.note && data.note && !onPickNote && (
        <Row icon={<FileText size={14} />}>
          <span className="break-words">{data.note}</span>
        </Row>
      )}
    </>
  );
}

const cardPos = (position: 'bottom' | 'top') =>
  position === 'bottom'
    ? 'bottom-[max(106px,calc(env(safe-area-inset-bottom)_+_98px))]'
    : 'top-[70px]';

/* ---------- 样式 1：工程卡片 ---------- */
function CardStyle({
  data,
  fields,
  position,
  onClick,
  onPickNote,
}: {
  data: WatermarkData;
  fields: WMFields;
  position: 'bottom' | 'top';
  onClick: () => void;
  onPickNote: () => void;
}) {
  const hasRows =
    (fields.addr && data.address) ||
    fields.lat ||
    fields.lng ||
    (fields.alt && data.altLine) ||
    (fields.project && data.project) ||
    (fields.note && data.note);
  return (
    <motion.div
      layout
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      className={`pointer-events-auto absolute left-4 w-[calc(100%-2rem)] max-w-[560px] cursor-pointer select-none overflow-hidden rounded-2xl border border-white/15 bg-black/55 backdrop-blur-md transition-shadow hover:ring-2 hover:ring-[#FFD028]/40 ${cardPos(position)}`}
      initial={false}
    >
      <div className="flex gap-3 p-3.5 sm:p-4">
        <div className="w-[5px] shrink-0 rounded-full bg-gradient-to-b from-[#FFD028] to-[#FF7A00]" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[30px] font-bold leading-none tracking-tight text-white [font-variant-numeric:tabular-nums]">
            {data.timeStr}
          </div>
          {(fields.date || (fields.weather && data.weather)) && (
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[12.5px] text-white/80">
              {fields.date && (
                <span>
                  {data.dateStr} {data.weekdayStr}
                </span>
              )}
              {fields.weather && data.weather && (
                <span className="flex items-center gap-1 text-white/80">
                  <Thermometer size={13} className="text-[#FFD028]" />
                  {data.weather}
                </span>
              )}
            </div>
          )}
          {hasRows && <div className="my-2.5 border-t border-dashed border-white/20" />}
          <InfoRows data={data} fields={fields} onPickNote={onPickNote} />
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- 样式 2：今日大抬头 ---------- */
function HeroStyle({
  data,
  fields,
  onClick,
  onPickNote,
}: {
  data: WatermarkData;
  fields: WMFields;
  onClick: () => void;
  onPickNote: () => void;
}) {
  const sub: string[] = [];
  if (fields.date) sub.push(`${data.dateStr} ${data.weekdayStr}`);
  if (fields.weather && data.weather) sub.push(data.weather);
  return (
    <>
      <motion.div
        layout
        onClick={onClick}
        className="pointer-events-auto absolute left-4 top-[76px] z-20 cursor-pointer select-none [text-shadow:0_2px_10px_rgba(0,0,0,0.6)]"
        initial={false}
      >
        <div className="font-mono text-[46px] font-bold leading-none tracking-tight text-white [font-variant-numeric:tabular-nums]">
          {data.timeStr}
        </div>
        {sub.length > 0 && (
          <div className="mt-1.5 text-[13px] font-medium text-white/95">{sub.join('  ·  ')}</div>
        )}
      </motion.div>
      <div className="pointer-events-none absolute bottom-[max(106px,calc(env(safe-area-inset-bottom)_+_98px))] left-4 z-20 max-w-[560px] select-none [text-shadow:0_2px_8px_rgba(0,0,0,0.62)]">
        <InfoRows data={data} fields={fields} monoCls="font-mono text-[12.5px]" onPickNote={onPickNote} />
      </div>
    </>
  );
}

/* ---------- 样式 3：信息底栏 ---------- */
function StripStyle({
  data,
  fields,
  onClick,
  onPickNote,
}: {
  data: WatermarkData;
  fields: WMFields;
  onClick: () => void;
  onPickNote: () => void;
}) {
  const sub: string[] = [];
  if (fields.date) sub.push(`${data.dateStr} ${data.weekdayStr}`);
  if (fields.weather && data.weather) sub.push(data.weather);
  return (
    <motion.div
      layout
      onClick={onClick}
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 cursor-pointer select-none border-t-2 border-[#FFD028]/50 bg-gradient-to-b from-black/40 via-black/70 to-black/85 px-4 pb-[max(88px,calc(env(safe-area-inset-bottom)_+_80px))] pt-3"
      initial={false}
    >
      <div className="flex items-end justify-between gap-4">
        <div className="shrink-0">
          <div className="font-mono text-[26px] font-bold leading-none tracking-tight text-white [font-variant-numeric:tabular-nums]">
            {data.timeStr}
          </div>
          {sub.length > 0 && <div className="mt-1 text-[11px] text-white/80">{sub.join(' · ')}</div>}
        </div>
        <div className="min-w-0 flex-1 text-right">
          {fields.addr && data.address && (
            <div className="flex items-center justify-end gap-1.5 py-[2px]">
              <span className="truncate text-[12px] text-white/95">{data.address}</span>
              <MapPin size={13} className="shrink-0 text-[#FFD028]" />
            </div>
          )}
          {fields.lat && (
            <div className="flex items-center justify-end gap-1.5 py-[2px]">
              <span className="truncate font-mono text-[11.5px] text-white/95">{data.latStr}</span>
              <Navigation size={13} className="shrink-0 text-[#FFD028]" />
            </div>
          )}
          {fields.lng && (
            <div className="flex items-center justify-end gap-1.5 py-[2px]">
              <span className="truncate font-mono text-[11.5px] text-white/95">{data.lngStr}</span>
              <Navigation size={13} className="shrink-0 text-[#FFD028]" />
            </div>
          )}
          {fields.alt && data.altLine && (
            <div className="flex items-center justify-end gap-1.5 py-[2px]">
              <span className="truncate text-[12px] text-white/90">{data.altLine}</span>
              <Mountain size={13} className="shrink-0 text-[#FFD028]" />
            </div>
          )}
          {fields.project && data.project && (
            <div className="flex items-center justify-end gap-1.5 py-[2px]">
              <span className="truncate text-[12px] text-white/90">{data.project}</span>
              <Briefcase size={13} className="shrink-0 text-[#FFD028]" />
            </div>
          )}
          {fields.note && data.note && (
            <div className="flex items-center justify-end gap-1.5 py-[2px]">
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onPickNote();
                }}
                className="cursor-pointer truncate text-[12px] text-white/90 decoration-white/40 decoration-dotted underline-offset-4 hover:underline"
              >
                {data.note}
              </span>
              <FileText size={13} className="shrink-0 text-[#FFD028]" />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- 样式 4：打卡印章 ---------- */
function StampStyle({
  data,
  fields,
  position,
  onClick,
  onPickNote,
}: {
  data: WatermarkData;
  fields: WMFields;
  position: 'bottom' | 'top';
  onClick: () => void;
  onPickNote: () => void;
}) {
  return (
    <motion.div
      layout
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      className={`pointer-events-auto absolute left-4 z-20 w-[calc(100%-2rem)] max-w-[420px] cursor-pointer select-none rounded-lg border-2 border-[#FFD028]/85 bg-black/55 p-[3px] backdrop-blur-md ${cardPos(position)}`}
      initial={false}
    >
      <div className="rounded-md border border-white/25 px-4 py-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="font-mono text-[28px] font-bold leading-none tracking-tight text-[#FFD028] [font-variant-numeric:tabular-nums]">
            {data.timeStr}
          </div>
          {fields.weather && data.weather && (
            <div className="pt-1 text-[11.5px] text-white/85">{data.weather}</div>
          )}
        </div>
        {fields.date && (
          <div className="mt-1.5 text-[12px] text-white/85">
            {data.dateStr} {data.weekdayStr}
          </div>
        )}
        <div className="mt-2">
          <InfoRows data={data} fields={fields} onPickNote={onPickNote} />
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- 样式 5：七星台账 ---------- */
function SiteStyle({
  data,
  fields,
  position,
  onClick,
  onPickNote,
}: {
  data: WatermarkData;
  fields: WMFields;
  position: 'bottom' | 'top';
  onClick: () => void;
  onPickNote: () => void;
}) {
  const rows: { label: string; value: string }[] = [];
  if (fields.addr && data.address) rows.push({ label: '地\u3000\u3000点：', value: data.address });
  if (fields.lng) rows.push({ label: '经　　度：', value: data.siteLng });
  if (fields.lat) rows.push({ label: '纬　　度：', value: data.siteLat });
  if (fields.date) rows.push({ label: '拍 摄 时 间：', value: data.siteTime });
  if (fields.weather && data.weather) rows.push({ label: '天\u3000\u3000气：', value: data.weather });
  if (fields.project && data.project) rows.push({ label: '工\u3000\u3000程：', value: data.project });
  const content = data.note || data.project || '请选择选项';
  return (
    <div
      className={`pointer-events-auto absolute left-4 z-20 w-[60%] max-w-[330px] cursor-pointer select-none ${cardPos(position)}`}
      onClick={onClick}
    >
      <div className="overflow-hidden rounded-md bg-[#f0f2f4]/70 text-[#17181a] backdrop-blur-[2px]">
        {fields.note && (
          <div className="bg-[#F7D400]/90 px-2.5 py-1.5 text-[11.5px] font-bold leading-tight">
            施 工 内 容：<span
              onClick={(e) => {
                e.stopPropagation();
                onPickNote();
              }}
              className="cursor-pointer font-semibold text-[#3d3d3d] underline decoration-[#3d3d3d]/70 underline-offset-2"
            >{content}</span>
          </div>
        )}
        {rows.map((r, i) => (
          <div
            key={i}
            className={`flex items-baseline px-2.5 py-[5px] text-[10.5px] leading-snug ${i > 0 ? 'border-t border-black/[0.07]' : ''}`}
          >
            <span className="shrink-0 font-semibold">{r.label}</span>
            <span className="min-w-0 flex-1 break-words text-[#26282b]">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WatermarkCard({ data, fields, position, style, alpha, onClick, onPickNote }: Props) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20" style={alpha != null && alpha < 1 ? { opacity: alpha } : undefined}>
      {style === 'hero' ? (
        <HeroStyle data={data} fields={fields} onClick={onClick} onPickNote={onPickNote} />
      ) : style === 'strip' ? (
        <StripStyle data={data} fields={fields} onClick={onClick} onPickNote={onPickNote} />
      ) : style === 'stamp' ? (
        <StampStyle data={data} fields={fields} position={position} onClick={onClick} onPickNote={onPickNote} />
      ) : style === 'site' ? (
        <SiteStyle data={data} fields={fields} position={position} onClick={onClick} onPickNote={onPickNote} />
      ) : style === 'today' ? (
        <TodayStyle data={data} fields={fields} position={position} onClick={onClick} onPickNote={onPickNote} />
      ) : style === 'todayWork' ? (
        <TodayWorkStyle data={data} fields={fields} position={position} onClick={onClick} onPickNote={onPickNote} />
      ) : style === 'tpl' ? (
        <TemplateCardPreview data={data} fields={fields} position={position} onClick={onClick} onPickNote={onPickNote} />
      ) : (
        <CardStyle data={data} fields={fields} position={position} onClick={onClick} onPickNote={onPickNote} />
      )}
    </div>
  );
}

/* ---------- 样式 8：自定义模板预览（CSS 镜像 drawTemplateCard） ---------- */
function TemplateCardPreview({
  data,
  fields,
  position,
  onClick,
  onPickNote,
}: {
  data: WatermarkData;
  fields: WMFields;
  position: 'bottom' | 'top';
  onClick: () => void;
  onPickNote: () => void;
}) {
  const tpl = getTemplate(getActiveTemplateId());
  const hd = tpl.header;
  const showHead = !!hd && tplFieldOn(hd.field, fields);
  const headRaw = hd ? (hd.field === 'note' ? data.note : data.project) : '';
  const headIsPh = !headRaw;
  const headVal = headRaw || hd?.placeholder || '';
  const rows = tpl.rows
    .filter((r) => tplFieldOn(r.field, fields))
    .map((r) => ({ label: r.label, value: tplRowValue(r.field, data) }))
    .filter((r) => r.value) as { label: string; value: string }[];
  return (
    <div
      className={`pointer-events-auto absolute left-4 z-20 w-[62%] max-w-[340px] cursor-pointer select-none ${cardPos(position)}`}
      onClick={onClick}
    >
      <div className="overflow-hidden shadow-lg" style={{ background: tpl.card.bg, borderRadius: 10 }}>
        {showHead && hd && (
          <div className="px-2.5 py-1.5 text-[11.5px] font-bold leading-tight" style={{ background: hd.bg }}>
            {hd.label && <span style={{ color: hd.labelColor }}>{hd.label}</span>}
            <span
              onClick={(e) => {
                e.stopPropagation();
                onPickNote();
              }}
              className="cursor-pointer font-semibold underline underline-offset-2"
              style={{ color: headIsPh ? hd.placeholderColor : hd.valueColor }}
            >
              {headVal}
            </span>
          </div>
        )}
        {rows.map((r, i) => (
          <div
            key={i}
            className="flex items-baseline px-2.5 py-[5px] text-[10.5px] leading-snug"
            style={i > 0 && tpl.divider !== 'none' ? { borderTop: `1px solid ${tpl.divider}` } : undefined}
          >
            <span className="shrink-0 font-semibold" style={{ color: tpl.fonts.label.color }}>
              {r.label}
            </span>
            <span className="min-w-0 flex-1 break-words" style={{ color: tpl.fonts.value.color }}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 样式 6：今日工程（复刻今日相机，无防伪码） ---------- */
function TodayStyle({
  data,
  fields,
  position,
  onClick,
  onPickNote,
}: {
  data: WatermarkData;
  fields: WMFields;
  position: 'bottom' | 'top';
  onClick: () => void;
  onPickNote: () => void;
}) {
  const rows: { label: string; value: string }[] = [];
  if (fields.addr && data.address) rows.push({ label: '地　　点：', value: data.address });
  if (fields.lng) rows.push({ label: '经　　度：', value: data.siteLng });
  if (fields.lat) rows.push({ label: '纬　　度：', value: data.siteLat });
  if (fields.date) rows.push({ label: '拍 摄 时 间：', value: data.siteTime });
  if (fields.weather && data.weather) rows.push({ label: '天　　气：', value: data.weather });
  const hasNote = !!data.note;
  const content = data.note || '请选择选项';
  return (
    <div
      className={`pointer-events-auto absolute left-4 z-20 w-[62%] max-w-[340px] cursor-pointer select-none ${cardPos(position)}`}
      onClick={onClick}
    >
      <div className="overflow-hidden rounded-lg bg-[#f2f4f6]/90 text-[#17181a] shadow-lg">
        {fields.note && (
          <div className="bg-[#F7D400] px-2.5 py-1.5 text-[11.5px] font-bold leading-tight">
            施 工 内 容：
            <span
              onClick={(e) => {
                e.stopPropagation();
                onPickNote();
              }}
              className={`cursor-pointer font-semibold underline underline-offset-2 ${
                hasNote ? 'text-[#3d3d3d]' : 'text-[#8a7a00]'
              }`}
            >
              {content}
            </span>
          </div>
        )}
        {rows.map((r, i) => (
          <div
            key={i}
            className={`flex items-baseline px-2.5 py-[5px] text-[10.5px] leading-snug ${i > 0 ? 'border-t border-black/[0.07]' : ''}`}
          >
            <span className="shrink-0 font-semibold">{r.label}</span>
            <span className="min-w-0 flex-1 break-words text-[#26282b]">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 样式 7：今日工作（仿今日相机白卡） ---------- */
function TodayWorkStyle({
  data,
  fields,
  position,
  onClick,
  onPickNote,
}: {
  data: WatermarkData;
  fields: WMFields;
  position: 'bottom' | 'top';
  onClick: () => void;
  onPickNote: () => void;
}) {
  const rows: { label: string; value: string; pick?: boolean }[] = [];
  if (fields.addr && data.address) rows.push({ label: '地点', value: data.address });
  if (fields.lat || fields.lng)
    rows.push({
      label: '经纬度',
      value: [fields.lat ? data.latStr : '', fields.lng ? data.lngStr : ''].filter(Boolean).join(' '),
    });
  if (fields.alt && data.altLine) rows.push({ label: '海拔', value: data.altLine });
  if (fields.project && data.project) rows.push({ label: '工程', value: data.project });
  if (fields.note && data.note) rows.push({ label: '备注', value: data.note, pick: true });
  return (
    <div
      className={`pointer-events-auto absolute left-4 z-20 w-[calc(100%-2rem)] max-w-[560px] cursor-pointer select-none ${cardPos(position)}`}
      onClick={onClick}
    >
      <div className="rounded-xl bg-white/95 p-3.5 text-[#17181a] shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div className="font-mono text-[30px] font-bold leading-none tracking-tight [font-variant-numeric:tabular-nums]">
            {data.timeStr}
          </div>
          {fields.weather && data.weather && (
            <div className="pt-1 text-[11.5px] text-gray-500">{data.weather}</div>
          )}
        </div>
        {fields.date && (
          <div className="mt-1 text-[12px] text-gray-500">
            {data.dateStr} {data.weekdayStr}
          </div>
        )}
        {rows.length > 0 && <div className="my-2 border-t border-black/10" />}
        {rows.map((r, i) => (
          <div key={i} className="flex items-baseline gap-3 py-[3px]">
            <span className="shrink-0 text-[12px] text-gray-400">{r.label}</span>
            {r.pick ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onPickNote();
                }}
                className="min-w-0 flex-1 cursor-pointer break-words text-[12.5px] underline decoration-gray-400/70 underline-offset-2"
              >
                {r.value}
              </span>
            ) : (
              <span className="min-w-0 flex-1 break-words text-[12.5px]">{r.value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
