/* 水印模板 JSON 化：字体/颜色/行项不再写死，模板可导出分享、团队统一。
 * v1 范围：卡片类模板（黄头卡/白卡/深色卡等）；hero/strip/stamp 等异形样式仍走内置代码。
 * 分享：导出 JSON 文件 / 复制分享码（base64url），对方导入即用。
 */
import type { WatermarkData, WMFields } from './capture';

export type TplField =
  | 'addr' | 'lng' | 'lat' | 'date' | 'weather' | 'project' | 'alt' | 'note';

export interface TplRowDef {
  field: TplField;
  label: string; // 如 '地　　点：'
}

export interface WatermarkTemplate {
  id: string;
  name: string;
  version: 1;
  builtin?: boolean;
  card: {
    widthPct: number; // 卡片宽占照片宽 %（竖图），横图自动 *0.72
    radius: number; // 圆角（S 单位）
    padding: number; // 内边距（S 单位）
    bg: string; // 卡片底色
  };
  header?: {
    field: 'note' | 'project'; // 开关绑定的 fields 项
    label: string; // '施 工 内 容：'
    bg: string;
    labelColor: string;
    valueColor: string;
    placeholder: string; // 空值时显示，如 '请选择选项'
    placeholderColor: string;
  };
  rows: TplRowDef[];
  fonts: {
    headerSize: number; // S 单位
    label: { size: number; weight: number; color: string };
    value: { size: number; weight: number; color: string };
  };
  divider: string; // 分割线颜色，'none' 不画
}

/* ---------- 字段取值 / 开关映射（与 capture.ts 解耦，纯函数） ---------- */

export function tplRowValue(field: TplRowDef['field'], d: WatermarkData): string | null {
  switch (field) {
    case 'addr':
      return d.address || null;
    case 'lng':
      return d.siteLng || null;
    case 'lat':
      return d.siteLat || null;
    case 'date':
      return d.siteTime || null;
    case 'weather':
      return d.weather || null;
    case 'project':
      return d.project || null;
    case 'alt':
      return d.altLine || null;
    case 'note':
      return d.note || null;
  }
}

export function tplFieldOn(field: TplField, f: WMFields): boolean {
  switch (field) {
    case 'addr':
      return f.addr;
    case 'lng':
      return f.lng;
    case 'lat':
      return f.lat;
    case 'date':
      return f.date;
    case 'weather':
      return f.weather;
    case 'project':
      return f.project;
    case 'alt':
      return f.alt;
    case 'note':
      return f.note;
  }
}

/* ---------- 内置模板 ---------- */

export const BUILTIN_TEMPLATES: WatermarkTemplate[] = [
  {
    id: 'built-in:today-yellow',
    name: '今日工程·黄头卡',
    version: 1,
    builtin: true,
    card: { widthPct: 62, radius: 2.2, padding: 4.5, bg: 'rgba(242,244,246,0.88)' },
    header: {
      field: 'note',
      label: '施 工 内 容：',
      bg: '#F7D400',
      labelColor: 'rgba(23,24,26,0.95)',
      valueColor: 'rgba(61,61,61,0.95)',
      placeholder: '请选择选项',
      placeholderColor: 'rgba(138,122,0,0.95)',
    },
    rows: [
      { field: 'addr', label: '地　　点：' },
      { field: 'lng', label: '经　　度：' },
      { field: 'lat', label: '纬　　度：' },
      { field: 'date', label: '拍 摄 时 间：' },
      { field: 'weather', label: '天　　气：' },
    ],
    fonts: {
      headerSize: 5.6,
      label: { size: 5.4, weight: 600, color: 'rgba(23,24,26,0.95)' },
      value: { size: 5.4, weight: 500, color: 'rgba(38,40,43,0.95)' },
    },
    divider: 'rgba(23,24,26,0.08)',
  },
  {
    id: 'built-in:simple-white',
    name: '简约白卡',
    version: 1,
    builtin: true,
    card: { widthPct: 58, radius: 2.4, padding: 4.5, bg: 'rgba(255,255,255,0.92)' },
    header: {
      field: 'note',
      label: '施工内容：',
      bg: '#17181A',
      labelColor: '#FFD028',
      valueColor: 'rgba(255,255,255,0.95)',
      placeholder: '请选择选项',
      placeholderColor: 'rgba(255,255,255,0.55)',
    },
    rows: [
      { field: 'addr', label: '地点：' },
      { field: 'lng', label: '经度：' },
      { field: 'lat', label: '纬度：' },
      { field: 'date', label: '时间：' },
      { field: 'weather', label: '天气：' },
      { field: 'project', label: '工程：' },
    ],
    fonts: {
      headerSize: 5.2,
      label: { size: 4.6, weight: 500, color: 'rgba(120,126,132,0.95)' },
      value: { size: 4.8, weight: 600, color: 'rgba(23,24,26,0.95)' },
    },
    divider: 'rgba(23,24,26,0.10)',
  },
  {
    id: 'built-in:dark-card',
    name: '深色工程卡',
    version: 1,
    builtin: true,
    card: { widthPct: 60, radius: 2.6, padding: 5, bg: 'rgba(10,12,15,0.78)' },
    header: {
      field: 'project',
      label: '',
      bg: 'rgba(255,208,40,0.95)',
      labelColor: '#17181A',
      valueColor: '#17181A',
      placeholder: '未命名工程',
      placeholderColor: 'rgba(23,24,26,0.6)',
    },
    rows: [
      { field: 'addr', label: '地点 ' },
      { field: 'lng', label: '经度 ' },
      { field: 'lat', label: '纬度 ' },
      { field: 'date', label: '时间 ' },
      { field: 'weather', label: '天气 ' },
      { field: 'note', label: '内容 ' },
    ],
    fonts: {
      headerSize: 5.4,
      label: { size: 4.4, weight: 500, color: 'rgba(255,255,255,0.55)' },
      value: { size: 4.8, weight: 600, color: 'rgba(255,255,255,0.95)' },
    },
    divider: 'rgba(255,255,255,0.12)',
  },
];

/* ---------- 自定义模板存取 ---------- */

const LS_KEY = 'tx_custom_templates';
const LS_ACTIVE = 'tx_active_template';

export function loadCustomTemplates(): WatermarkTemplate[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((t) => validateTemplate(t).length === 0);
  } catch {
    return [];
  }
}

export function saveCustomTemplates(list: WatermarkTemplate[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* 配额满则静默失败 */
  }
}

export function allTemplates(): WatermarkTemplate[] {
  return [...BUILTIN_TEMPLATES, ...loadCustomTemplates()];
}

export function getTemplate(id: string): WatermarkTemplate {
  return allTemplates().find((t) => t.id === id) || BUILTIN_TEMPLATES[0];
}

export function getActiveTemplateId(): string {
  try {
    return localStorage.getItem(LS_ACTIVE) || BUILTIN_TEMPLATES[0].id;
  } catch {
    return BUILTIN_TEMPLATES[0].id;
  }
}

export function setActiveTemplateId(id: string) {
  try {
    localStorage.setItem(LS_ACTIVE, id);
  } catch {
    /* ignore */
  }
}

/* ---------- 校验 ---------- */

const ROW_FIELDS = ['addr', 'lng', 'lat', 'date', 'weather', 'project', 'alt', 'note'];

export function validateTemplate(t: unknown): string[] {
  const errs: string[] = [];
  if (!t || typeof t !== 'object') return ['不是有效的 JSON 对象'];
  const o = t as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name.trim()) errs.push('缺少 name（模板名）');
  if (o.version !== 1) errs.push('version 必须为 1');
  const card = o.card as Record<string, unknown> | undefined;
  if (!card || typeof card !== 'object') errs.push('缺少 card');
  else {
    if (typeof card.widthPct !== 'number' || card.widthPct < 20 || card.widthPct > 100)
      errs.push('card.widthPct 应为 20–100');
    for (const k of ['radius', 'padding'])
      if (typeof card[k] !== 'number' || (card[k] as number) < 0 || (card[k] as number) > 20)
        errs.push(`card.${k} 应为 0–20 的数字`);
    if (typeof card.bg !== 'string' || !card.bg) errs.push('card.bg 必须为颜色字符串');
  }
  const rows = o.rows as unknown;
  if (!Array.isArray(rows) || rows.length === 0) errs.push('rows 不能为空数组');
  else
    rows.forEach((r, i) => {
      const rr = r as Record<string, unknown>;
      if (!rr || !ROW_FIELDS.includes(String(rr.field))) errs.push(`rows[${i}].field 非法`);
      if (typeof rr?.label !== 'string') errs.push(`rows[${i}].label 必须为字符串`);
    });
  const fonts = o.fonts as Record<string, unknown> | undefined;
  if (!fonts || typeof fonts !== 'object') errs.push('缺少 fonts');
  else {
    if (typeof fonts.headerSize !== 'number') errs.push('fonts.headerSize 必须为数字');
    for (const k of ['label', 'value']) {
      const ff = (fonts[k] || {}) as Record<string, unknown>;
      if (typeof ff.size !== 'number' || typeof ff.color !== 'string')
        errs.push(`fonts.${k} 需要 size（数字）与 color（字符串）`);
    }
  }
  if (o.header !== undefined) {
    const h = o.header as Record<string, unknown>;
    for (const k of ['label', 'bg', 'labelColor', 'valueColor', 'placeholder', 'placeholderColor'])
      if (typeof h[k] !== 'string') errs.push(`header.${k} 必须为字符串`);
    if (h.field !== 'note' && h.field !== 'project') errs.push('header.field 仅支持 note/project');
  }
  return errs;
}

/* ---------- 导入 / 导出 / 分享码 ---------- */

export function templateToJson(t: WatermarkTemplate): string {
  const { builtin, ...rest } = t;
  return JSON.stringify({ ...rest, id: undefined, version: 1 }, null, 2);
}

export function importTemplateText(text: string): { tpl?: WatermarkTemplate; errors: string[] } {
  let obj: unknown;
  const trimmed = text.trim();
  try {
    // 分享码是 base64url(JSON)
    const decoded = /^[A-Za-z0-9_-]+$/.test(trimmed) && trimmed.length > 40
      ? JSON.parse(new TextDecoder().decode(
          Uint8Array.from(atob(trimmed.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
        ))
      : JSON.parse(trimmed);
    obj = decoded;
  } catch {
    return { errors: ['解析失败：不是有效的 JSON 或分享码'] };
  }
  const errors = validateTemplate(obj);
  if (errors.length) return { errors };
  const o = obj as Record<string, unknown>;
  const tpl = {
    ...(o as object),
    id: 'custom:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    builtin: false,
  } as WatermarkTemplate;
  return { tpl, errors: [] };
}

export function templateToShareCode(t: WatermarkTemplate): string {
  const bytes = new TextEncoder().encode(templateToJson(t));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
