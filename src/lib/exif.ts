/* 极简 JPEG EXIF 解析：取 DateTimeOriginal（拍摄时间）与 GPS（原始经纬度），失败返回 null */

export interface ExifGps {
  lat: number;
  lng: number;
}

interface Endian {
  little: boolean;
  u16: (o: number) => number;
  u32: (o: number) => number;
}

function endianOf(view: DataView, tiffStart: number): Endian {
  const little = view.getUint16(tiffStart) === 0x4949; // II = little endian
  return {
    little,
    u16: (o: number) => view.getUint16(o, little),
    u32: (o: number) => view.getUint32(o, little),
  };
}

function readExifTime(view: DataView, tiffStart: number): Date | null {
  try {
    const { u16, u32 } = endianOf(view, tiffStart);

    const ifd0 = tiffStart + u32(tiffStart + 4);
    const n0 = u16(ifd0);
    let exifPtr = -1;
    for (let i = 0; i < n0; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (u16(entry) === 0x8769) {
        // ExifIFD pointer
        exifPtr = tiffStart + u32(entry + 8);
        break;
      }
    }
    if (exifPtr < 0) return null;
    const n1 = u16(exifPtr);
    for (let i = 0; i < n1; i++) {
      const entry = exifPtr + 2 + i * 12;
      if (u16(entry) === 0x9003) {
        // DateTimeOriginal "YYYY:MM:DD HH:MM:SS"
        const off = tiffStart + u32(entry + 8);
        let s = '';
        for (let j = 0; j < 19; j++) s += String.fromCharCode(view.getUint8(off + j));
        const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      }
    }
  } catch {
    /* 结构异常按无 EXIF 处理 */
  }
  return null;
}

/** 读 GPS IFD：tag1 纬度基准 / tag2 纬度(3 个 rational) / tag3 经度基准 / tag4 经度 */
function readExifGps(view: DataView, tiffStart: number): ExifGps | null {
  try {
    const { u16, u32 } = endianOf(view, tiffStart);
    const ifd0 = tiffStart + u32(tiffStart + 4);
    const n0 = u16(ifd0);
    let gpsPtr = -1;
    for (let i = 0; i < n0; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (u16(entry) === 0x8825) {
        // GPSInfo IFD pointer
        gpsPtr = tiffStart + u32(entry + 8);
        break;
      }
    }
    if (gpsPtr < 0) return null;
    const n = u16(gpsPtr);
    let latRef = 'N';
    let lngRef = 'E';
    let lat: number[] | null = null;
    let lng: number[] | null = null;
    const ascii = (off: number) => String.fromCharCode(view.getUint8(tiffStart + off));
    const rational3 = (off: number): number[] | null => {
      const base = tiffStart + off;
      const vals: number[] = [];
      for (let k = 0; k < 3; k++) {
        const num = u32(base + k * 8);
        const den = u32(base + k * 8 + 4);
        if (!den) return null;
        vals.push(num / den);
      }
      return vals;
    };
    for (let i = 0; i < n; i++) {
      const entry = gpsPtr + 2 + i * 12;
      const tag = u16(entry);
      const valOff = u32(entry + 8);
      if (tag === 0x0001) latRef = ascii(valOff);
      else if (tag === 0x0003) lngRef = ascii(valOff);
      else if (tag === 0x0002) lat = rational3(valOff);
      else if (tag === 0x0004) lng = rational3(valOff);
    }
    if (!lat || !lng) return null;
    let la = lat[0] + lat[1] / 60 + lat[2] / 3600;
    let ln = lng[0] + lng[1] / 60 + lng[2] / 3600;
    if (latRef === 'S') la = -la;
    if (lngRef === 'W') ln = -ln;
    if (!isFinite(la) || !isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
    return { lat: la, lng: ln };
  } catch {
    return null;
  }
}

/** 定位 JPEG 里 Exif APP1 段的 TIFF 起点；找不到返回 -1 */
function findTiffStart(dataUrl: string): { view: DataView; tiffStart: number } | null {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64.slice(0, 400 * 1024)); // EXIF 必在前 400KB 内
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(buf);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === 0xe1) {
      // APP1: "Exif\0\0" + TIFF
      const len = view.getUint16(i + 2);
      if (
        bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 &&
        bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66
      ) {
        return { view, tiffStart: i + 10 };
      }
      i += 2 + len;
    } else if (marker === 0xda) {
      break; // SOS，图像数据开始
    } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
    } else {
      i += 2 + view.getUint16(i + 2);
    }
  }
  return null;
}

/** 从 JPEG dataURL 解析原始拍摄时间；非 JPEG / 无 EXIF 返回 null */
export function parseExifTime(dataUrl: string): Promise<Date | null> {
  return new Promise((resolve) => {
    try {
      const hit = findTiffStart(dataUrl);
      resolve(hit ? readExifTime(hit.view, hit.tiffStart) : null);
    } catch {
      resolve(null);
    }
  });
}

/** 从 JPEG dataURL 解析原始 GPS（WGS-84）；无 GPS 信息返回 null */
export function parseExifGps(dataUrl: string): Promise<ExifGps | null> {
  return new Promise((resolve) => {
    try {
      const hit = findTiffStart(dataUrl);
      resolve(hit ? readExifGps(hit.view, hit.tiffStart) : null);
    } catch {
      resolve(null);
    }
  });
}
