import math, numpy as np
from PIL import Image, ImageDraw

S = 1024
CX, CY = S//2, S//2

def vgrad(w, h, top, bot):
    t = np.linspace(0, 1, h)[:, None, None]
    top = np.array(top); bot = np.array(bot)
    return np.repeat((top[None,None,:]*(1-t) + bot[None,None,:]*t), w, axis=1)

def rgrad(size, center, r0, r1, c0, c1):
    yy, xx = np.mgrid[0:size, 0:size]
    d = np.sqrt((xx-center[0])**2 + (yy-center[1])**2)
    t = np.clip((d-r0)/(r1-r0), 0, 1)[..., None]
    c0 = np.array(c0); c1 = np.array(c1)
    return c0[None,None,:]*(1-t) + c1[None,None,:]*t

def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0,0,size,size], radius=radius, fill=255)
    return m

def apply_mask(img, mask):
    """把 mask 乘到 img 的 alpha 上（不吞掉原有半透明）"""
    a = np.array(img); m = np.array(mask)
    a[...,3] = (a[...,3].astype(int) * m // 255).astype(np.uint8)
    return Image.fromarray(a, 'RGBA')

# ---------- 底：深空渐变 ----------
bg = vgrad(S, S, (36,40,47), (11,13,17))
glow = rgrad(S, (CX, 400), 60, 640, (255,255,255,26), (255,255,255,0))
base = Image.fromarray(np.clip(bg,0,255).astype(np.uint8), 'RGB').convert('RGBA')
base = Image.alpha_composite(base, Image.fromarray(np.clip(glow,0,255).astype(np.uint8), 'RGBA'))
base.putalpha(rounded_mask(S, 232))
img = Image.new('RGBA', (S,S), (0,0,0,0))
img = Image.alpha_composite(img, base)
d = ImageDraw.Draw(img)
d.rounded_rectangle([30,30,S-30,S-30], radius=204, outline=(255,208,40,70), width=3)

# ---------- 七星 ----------
def sparkle(dr, x, y, r, color):
    pts = []
    for k in range(8):
        ang = math.pi/4*k - math.pi/2
        rr = r if k%2==0 else r*0.28
        pts.append((x+rr*math.cos(ang), y+rr*math.sin(ang)))
    dr.polygon(pts, fill=color)
for x,y,r in [(300,250,15),(430,180,10),(600,150,13),(740,220,9),(830,330,12),(230,380,9),(690,300,7)]:
    sparkle(d, x, y, r, (255,236,150,150))
    sparkle(d, x, y, int(r*0.45), (255,255,255,220))

# ---------- 轨道环 ----------
d.ellipse([CX-330,CY-330,CX+330,CY+330], outline=(255,208,40,110), width=5)
d.arc([CX-398,CY-398,CX+398,CY+398], start=-58, end=128, fill=(255,208,40,225), width=9)
ex = CX+398*math.cos(math.radians(128)); ey = CY+398*math.sin(math.radians(128))
d.ellipse([ex-13,ey-13,ex+13,ey+13], fill=(255,208,40,255))

# ---------- 金色定位针 ----------
pin_cy = 470; pr = 205
pg = vgrad(S, S, (255,232,115), (214,144,6))
parr = np.dstack([np.clip(pg,0,255).astype(np.uint8), np.full((S,S),255,np.uint8)])
pimg = Image.fromarray(parr, 'RGBA')
pmask = Image.new('L', (S,S), 0)
pd = ImageDraw.Draw(pmask)
pd.ellipse([CX-pr, pin_cy-pr, CX+pr, pin_cy+pr], fill=255)
pd.polygon([(CX-pr*0.80, pin_cy+pr*0.32),(CX+pr*0.80, pin_cy+pr*0.32),(CX, pin_cy+pr*1.78)], fill=255)
pimg = apply_mask(pimg, pmask)
img = Image.alpha_composite(img, pimg)
# 针体高光（左上柔光）
hl = Image.new('RGBA',(S,S),(0,0,0,0))
ImageDraw.Draw(hl).ellipse([CX-pr, pin_cy-pr, CX-pr*0.28, pin_cy+pr*0.9], fill=(255,255,255,64))
hl = apply_mask(hl, pmask)
img = Image.alpha_composite(img, hl)

# ---------- 针内光圈 ----------
d = ImageDraw.Draw(img)
ir = 128
lens = rgrad(S, (CX,pin_cy), 10, ir, (52,58,66,255), (8,10,13,255))
lens_img = Image.fromarray(np.clip(lens,0,255).astype(np.uint8),'RGBA')
lmask = Image.new('L',(S,S),0)
ImageDraw.Draw(lmask).ellipse([CX-ir,pin_cy-ir,CX+ir,pin_cy+ir], fill=255)
lens_img = apply_mask(lens_img, lmask)
img = Image.alpha_composite(img, lens_img)
d = ImageDraw.Draw(img)
d.ellipse([CX-ir,pin_cy-ir,CX+ir,pin_cy+ir], outline=(120,84,8,255), width=7)
d.ellipse([CX-ir+14,pin_cy-ir+14,CX+ir-14,pin_cy+ir-14], outline=(255,208,40,90), width=2)
for k in range(6):
    a = math.radians(30+k*60)
    d.line([CX, pin_cy, CX+(ir-20)*math.cos(a), pin_cy+(ir-20)*math.sin(a)], fill=(0,0,0,110), width=6)
d.arc([CX-72,pin_cy-78,CX+8,pin_cy+2], start=180, end=290, fill=(255,255,255,150), width=13)
d.ellipse([CX-16,pin_cy-16,CX+16,pin_cy+16], fill=(255,208,40,255))
d.ellipse([CX-16,pin_cy-16,CX+16,pin_cy+16], outline=(120,84,8,255), width=3)

# ---------- 底部暗角 ----------
vig = rgrad(S, (CX,CY), 420, 760, (0,0,0,0), (0,0,0,90))
img = Image.alpha_composite(img, Image.fromarray(np.clip(vig,0,255).astype(np.uint8),'RGBA'))

img.save('/tmp/icon_1024.png')
for name, px in {'mipmap-mdpi':48,'mipmap-hdpi':72,'mipmap-xhdpi':96,'mipmap-xxhdpi':144,'mipmap-xxxhdpi':192}.items():
    img.resize((px,px), Image.LANCZOS).save(f'/tmp/{name}.png')
print('done')
