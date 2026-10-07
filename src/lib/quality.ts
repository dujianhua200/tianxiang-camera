/* 影像质检（纯端侧，无依赖）：拍摄后秒级给出模糊/曝光建议，不合格只提示不拦截。
 * 模糊：灰度缩略图 Laplacian 方差；曝光：直方图统计过曝/欠曝像素占比。
 */
export interface QualityResult {
  /** 0–100 综合分 */
  score: number;
  blurry: boolean;
  tooDark: boolean;
  tooBright: boolean;
}

const N = 96;

export function checkQuality(img: HTMLImageElement): QualityResult {
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, N, N);
  const px = ctx.getImageData(0, 0, N, N).data;
  const gray = new Float32Array(N * N);
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < N * N; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    const v = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = v;
    if (v < 18) dark++;
    if (v > 242) bright++;
  }
  /* Laplacian 方差（跳过最外圈） */
  let sum = 0;
  let sum2 = 0;
  let cnt = 0;
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      const lap =
        -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - N] + gray[i + N];
      sum += lap;
      sum2 += lap * lap;
      cnt++;
    }
  }
  const mean = sum / cnt;
  const variance = sum2 / cnt - mean * mean;
  const total = N * N;
  const darkRatio = dark / total;
  const brightRatio = bright / total;

  const blurry = variance < 55;
  const tooDark = darkRatio > 0.45;
  const tooBright = brightRatio > 0.4;

  let score = 100;
  if (blurry) score -= 45;
  if (tooDark) score -= 25;
  if (tooBright) score -= 25;
  score = Math.max(5, Math.round(score));

  return { score, blurry, tooDark, tooBright };
}

/** 质检不通过时的提示文案（null = 通过） */
export function qualityAdvice(q: QualityResult): string | null {
  const parts: string[] = [];
  if (q.blurry) parts.push('有点模糊');
  if (q.tooDark) parts.push('过暗');
  if (q.tooBright) parts.push('过曝');
  if (!parts.length) return null;
  return `照片${parts.join('、')}（${q.score}分），建议重拍一张`;
}
