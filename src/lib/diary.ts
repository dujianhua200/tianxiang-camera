/* 施工日志拼图：一天的照片按时间拼成带表头的长图（JPG），直接交监理。
 * 版式：深色表头（工程名/日期/天气/拍摄人/照片数）+ 双列照片 + 每张下标注时间地点。
 */
export interface DiaryPhoto {
  img: HTMLImageElement;
  time: string; // 2026.10.07 10:22
  address: string;
}

export interface DiaryMeta {
  project: string;
  date: string; // 2026.10.07
  weather: string;
  photographer: string;
}

const W = 1600;
const PAD = 48;
const COLS = 2;
const GAP = 32;
const IMG_H = 460;
const CAP_H = 96;
const SANS = `'PingFang SC','Microsoft YaHei',system-ui,sans-serif`;

export async function buildDiaryImage(photos: DiaryPhoto[], meta: DiaryMeta): Promise<string> {
  const cv = document.createElement('canvas');
  const cellW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const cellH = IMG_H + CAP_H;
  const rows = Math.ceil(photos.length / COLS);
  const headH = 300;
  const footH = 90;
  cv.width = W;
  cv.height = headH + rows * (cellH + GAP) + footH + PAD;
  const ctx = cv.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#EDEFF2';
  ctx.fillRect(0, 0, cv.width, cv.height);

  /* 表头 */
  ctx.fillStyle = '#14161A';
  ctx.fillRect(0, 0, W, headH);
  ctx.fillStyle = '#FFD028';
  ctx.fillRect(0, 0, 14, headH);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 72px ${SANS}`;
  ctx.fillText('施工日志', PAD + 12, 108);
  ctx.font = `400 30px ${SANS}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  const lines = [
    `工程名称：${meta.project || '未填写'}`,
    `日期：${meta.date}　　天气：${meta.weather || '未填写'}　　拍摄人：${meta.photographer || '未填写'}　　照片：${photos.length} 张`,
  ];
  lines.forEach((ln, i) => ctx.fillText(ln.slice(0, 44), PAD + 12, 172 + i * 52));

  /* 照片 */
  let y = headH + PAD;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      if (idx >= photos.length) break;
      const p = photos[idx];
      const x = PAD + c * (cellW + GAP);
      // 白底卡
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = 'rgba(20,22,26,0.1)';
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, cellW, cellH, 14);
      ctx.fill();
      ctx.stroke();
      // 图：contain
      const iw = p.img.naturalWidth || p.img.width;
      const ih = p.img.naturalHeight || p.img.height;
      const sc = Math.min(cellW / iw, IMG_H / ih);
      const dw = iw * sc, dh = ih * sc;
      ctx.save();
      roundRect(ctx, x, y, cellW, IMG_H, 14);
      ctx.clip();
      ctx.fillStyle = '#0C0E11';
      ctx.fillRect(x, y, cellW, IMG_H);
      ctx.drawImage(p.img, x + (cellW - dw) / 2, y + (IMG_H - dh) / 2, dw, dh);
      ctx.restore();
      // 序号角标
      ctx.fillStyle = '#FFD028';
      ctx.beginPath();
      ctx.arc(x + 34, y + 34, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#14161A';
      ctx.font = `700 30px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(idx + 1), x + 34, y + 45);
      ctx.textAlign = 'left';
      // 标注
      ctx.fillStyle = '#17181A';
      ctx.font = `600 28px ${SANS}`;
      ctx.fillText(p.time || '', x + 20, y + IMG_H + 40);
      ctx.fillStyle = 'rgba(23,24,26,0.6)';
      ctx.font = `400 25px ${SANS}`;
      ctx.fillText((p.address || '—').slice(0, 24), x + 20, y + IMG_H + 76);
    }
    y += cellH + GAP;
  }

  /* 落款 */
  ctx.fillStyle = 'rgba(20,22,26,0.45)';
  ctx.font = `400 24px ${SANS}`;
  ctx.fillText('天象七星工程相机 · 自动生成', PAD, cv.height - 34);

  return cv.toDataURL('image/jpeg', 0.88);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 读 dataURL 为 HTMLImageElement */
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}
