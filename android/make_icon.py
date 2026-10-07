#!/usr/bin/env python3
"""天象七星 App 图标生成器（星空蓝版）：PIL 程序化绘制，1024px 主图 → 5 档 mipmap。
用法：python3 make_icon.py   （输出到 res/mipmap-*/ic_launcher.png）
依赖：pillow, numpy
"""
import math
import numpy as np
from PIL import Image, ImageDraw

S = 1024
CX, CY = S // 2, S // 2

def vgrad(w, h, top, bot):
    t = np.linspace(0, 1, h)[:, None, None]
    top = np.array(top); bot = np.array(bot)
    return np.repeat((top[None, None, :] * (1 - t) + bot[None, None, :] * t), w, axis=1)

def rgrad(size, center, r0, r1, c0, c1):
    yy, xx = np.mgrid[0:size, 0:size]
    d = np.sqrt((xx - center[0]) ** 2 + (yy - center[1]) ** 2)
    t = np.clip((d - r0) / (r1 - r0), 0, 1)[..., None]
    c0 = np.array(c0); c1 = np.array(c1)
    return c0[None, None, :] * (1 - t) + c1[None, None, :] * t

def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    return m

def apply_mask(img, mask):
    """mask 乘到 alpha（保留原有半透明，不吞）"""
    a = np.array(img); m = np.array(mask)
    a[..., 3] = (a[..., 3].astype(int) * m // 255).astype(np.uint8)
    return Image.fromarray(a, 'RGBA')

def sparkle(dr, x, y, r, color):
    pts = []
    for k in range(8):
        ang = math.pi / 4 * k - math.pi / 2
        rr = r if k % 2 == 0 else r * 0.28
        pts.append((x + rr * math.cos(ang), y + rr * math.sin(ang)))
    dr.polygon(pts, fill=color)

def pin_mask(cx, cy, pr):
    m = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([cx - pr, cy - pr, cx + pr, cy + pr], fill=255)
    d.polygon([(cx - pr * 0.80, cy + pr * 0.32), (cx + pr * 0.80, cy + pr * 0.32),
               (cx, cy + pr * 1.78)], fill=255)
    return m

# ---------- 底：星空蓝 ----------
bg = rgrad(S, (CX, 420), 60, 720, (22, 64, 127, 255), (5, 11, 26, 255))
base = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8), 'RGBA')
base.putalpha(rounded_mask(S, 232))
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
img = Image.alpha_composite(img, base)
d = ImageDraw.Draw(img)
d.rounded_rectangle([30, 30, S - 30, S - 30], radius=204, outline=(140, 180, 235, 80), width=3)

# 七星
for x, y, r in [(300, 250, 15), (430, 180, 10), (600, 150, 13), (740, 220, 9),
                (830, 330, 12), (230, 380, 9), (690, 300, 7)]:
    sparkle(d, x, y, r, (190, 215, 245, 170))
    sparkle(d, x, y, int(r * 0.45), (255, 255, 255, 230))

# ---------- 银蓝定位针 ----------
pcy, pr = 470, 205
pg = vgrad(S, S, (242, 247, 255), (143, 169, 206))
parr = np.dstack([np.clip(pg, 0, 255).astype(np.uint8), np.full((S, S), 255, np.uint8)])
pimg = apply_mask(Image.fromarray(parr, 'RGBA'), pin_mask(CX, pcy, pr))
img = Image.alpha_composite(img, pimg)
d = ImageDraw.Draw(img)
d.ellipse([CX - pr, pcy - pr, CX + pr, pcy + pr], outline=(150, 190, 240, 220), width=6)

# ---------- 针内深蓝光圈 ----------
ir = 128
lens = rgrad(S, (CX, pcy), 10, ir, (38, 66, 110, 255), (6, 12, 26, 255))
lens_img = Image.fromarray(np.clip(lens, 0, 255).astype(np.uint8), 'RGBA')
lm = Image.new('L', (S, S), 0)
ImageDraw.Draw(lm).ellipse([CX - ir, pcy - ir, CX + ir, pcy + ir], fill=255)
lens_img = apply_mask(lens_img, lm)
img = Image.alpha_composite(img, lens_img)
d = ImageDraw.Draw(img)
d.ellipse([CX - ir, pcy - ir, CX + ir, pcy + ir], outline=(150, 190, 240, 230), width=6)
for k in range(6):
    a = math.radians(30 + k * 60)
    d.line([CX, pcy, CX + (ir - 18) * math.cos(a), pcy + (ir - 18) * math.sin(a)],
           fill=(10, 18, 34, 140), width=7)
d.arc([CX - 72, pcy - 78, CX + 8, pcy + 2], start=180, end=290, fill=(255, 255, 255, 160), width=13)
d.ellipse([CX - 17, pcy - 17, CX + 17, pcy + 17], fill=(150, 190, 240, 255))

# ---------- 输出 5 档 ----------
import os
here = os.path.dirname(os.path.abspath(__file__))
for name, px in {'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96,
                 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192}.items():
    out = os.path.join(here, 'res', name, 'ic_launcher.png')
    img.resize((px, px), Image.LANCZOS).save(out)
    print('wrote', out)
