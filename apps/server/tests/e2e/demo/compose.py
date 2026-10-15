"""Phone frames + captions -> stage PNGs at a fixed rate, for ffmpeg to turn into a GIF and an MP4."""
import glob
import json
import sys
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

out = Path(sys.argv[1])
lang = sys.argv[2]
dest = Path(sys.argv[3])
FPS = 12
W, H = 720, 1280
SCALE = 2  # draw at 2x, shrink at the end, for smooth edges
# macOS keeps PingFang as a downloaded font asset, not under /System/Library/Fonts.
PINGFANG = next(iter(glob.glob('/System/Library/AssetsV2/*/*/AssetData/PingFang.ttc')), None)
if not PINGFANG:
    sys.exit('PingFang.ttc not found: open Font Book and download PingFang SC')


@lru_cache(None)
def font(size, bold=True):
    # PingFang.ttc: index 0 regular .. pick semibold for captions
    return ImageFont.truetype(PINGFANG, size * SCALE, index=11 if bold else 3)


meta = json.loads((out / f'app-{lang}.json').read_text())
times = json.loads((out / f'frames-{lang}' / 'times.json').read_text())
marks, end, caps = meta['marks'], meta['end'], meta['caps']

S = SCALE
bg = Image.new('RGB', (W * S, H * S))
d = ImageDraw.Draw(bg)
for y in range(H * S):
    k = y / (H * S)
    d.line([(0, y), (W * S, y)], fill=(int(13 + 10 * k), int(17 + 12 * k), int(28 + 30 * k)))

# A 440x956-point iPhone screen (the 17 Pro Max's, which record.ts records on); the frames are the part between the
# status bar and the home indicator.
PT_W, PT_H, PT_TOP, PT_BOTTOM = 440, 956, 54, 34
SCREEN_W = 420
K = SCREEN_W / PT_W
SCREEN_H = round(PT_H * K)
BEZEL = 13
px, py = (W - SCREEN_W) // 2, 222
frame_box = (px - BEZEL, py - BEZEL, px + SCREEN_W + BEZEL, py + SCREEN_H + BEZEL)

shadow = Image.new('RGBA', bg.size, (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([v * S for v in (frame_box[0], frame_box[1] + 18, frame_box[2], frame_box[3] + 18)], radius=(62 * K + BEZEL) * S, fill=(0, 0, 0, 160))
shadow = shadow.filter(ImageFilter.GaussianBlur(30 * S))
base = bg.convert('RGBA')
base.alpha_composite(shadow)
bd = ImageDraw.Draw(base)
bd.rounded_rectangle([v * S for v in frame_box], radius=(62 * K + BEZEL) * S, fill=(26, 28, 33), outline=(92, 98, 112), width=3 * S)

brand = 'workoffdesk · ' + ('Claude Code、Codex 都能用 · 不经过任何中转' if lang == 'zh-CN' else 'Claude Code and Codex · no relay in between')
f_brand = font(17, bold=False)
bw = bd.textlength(brand, font=f_brand)
bd.text(((W * S - bw) / 2, (H - 56) * S), brand, font=f_brand, fill=(139, 148, 158))
base = base.convert('RGB')

mask = Image.new('L', (SCREEN_W * S, SCREEN_H * S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SCREEN_W * S - 1, SCREEN_H * S - 1], radius=round(62 * K * S), fill=255)
APP_Y, APP_H = round(PT_TOP * K * S), round((PT_H - PT_TOP - PT_BOTTOM) * K * S)
f_clock = ImageFont.truetype(PINGFANG, round(17 * K * S), index=11)


def screen(shot):
    """The phone's whole screen: status bar, the app, home indicator."""
    app = shot.resize((SCREEN_W * S, APP_H), Image.LANCZOS)
    top, bottom = app.getpixel((4, 2)), app.getpixel((4, APP_H - 2))
    scr = Image.new('RGB', (SCREEN_W * S, SCREEN_H * S), top)
    ImageDraw.Draw(scr).rectangle([0, APP_Y + APP_H, SCREEN_W * S, SCREEN_H * S], fill=bottom)
    scr.paste(app, (0, APP_Y))
    d = ImageDraw.Draw(scr)
    u = K * S
    # Dynamic Island
    d.rounded_rectangle([(PT_W / 2 - 63) * u, 11 * u, (PT_W / 2 + 63) * u, 48 * u], radius=19 * u, fill=(0, 0, 0))
    # clock
    tw = d.textlength('9:41', font=f_clock)
    d.text(((PT_W / 4 + 6) * u - tw / 2, 18 * u), '9:41', font=f_clock, fill=(255, 255, 255))
    # signal bars, wifi, battery
    x = (PT_W - 118) * u
    for n in range(4):
        h = (4 + n * 2.6) * u
        d.rounded_rectangle([x + n * 5 * u, 32 * u - h, x + n * 5 * u + 3 * u, 32 * u], radius=u, fill=(255, 255, 255))
    cx, cy = x + 34 * u, 33 * u
    for r in (11, 7, 3):
        d.pieslice([cx - r * u, cy - r * u, cx + r * u, cy + r * u], 225, 315, fill=(255, 255, 255))
        if r > 3:
            rr = r - 2
            d.pieslice([cx - rr * u, cy - rr * u, cx + rr * u, cy + rr * u], 225, 315, fill=top)
    bx = x + 52 * u
    d.rounded_rectangle([bx, 21 * u, bx + 25 * u, 33 * u], radius=4 * u, outline=(160, 160, 160), width=max(1, round(u)))
    d.rounded_rectangle([bx + 2 * u, 23 * u, bx + 20 * u, 31 * u], radius=2 * u, fill=(255, 255, 255))
    d.rounded_rectangle([bx + 26 * u, 25 * u, bx + 28 * u, 29 * u], radius=u - 1, fill=(160, 160, 160))
    # home indicator
    d.rounded_rectangle([(PT_W / 2 - 70) * u, (PT_H - 13) * u, (PT_W / 2 + 70) * u, (PT_H - 8) * u], radius=3 * u, fill=(235, 235, 240))
    return scr


f_cap = font(38)
f_step = font(16, bold=False)


def caption_at(t):
    i = max((k for k, m in enumerate(marks) if m['t'] <= t), default=0)
    since = t - marks[i]['t']
    return i, min(1.0, since / 0.35)


def draw_caption(img, i, alpha):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    lines = caps[i].split('\n')
    size = 38
    while max(ld.textlength(l, font=font(size)) for l in lines) > (W - 72) * S:
        size -= 1
    fc = font(size)
    lh = size * 1.37 * S
    top = 128 * S - len(lines) * lh / 2 + (1 - alpha) * 14 * S
    for n, line in enumerate(lines):
        w = ld.textlength(line, font=fc)
        ld.text(((W * S - w) / 2, top + n * lh), line, font=fc, fill=(240, 246, 252, int(255 * alpha)))
    # step dots
    n = len(caps)
    gap = 22 * S
    x0 = (W * S - (n - 1) * gap) / 2
    for k in range(n):
        r = (5 if k == i else 4) * S
        cx, cy = x0 + k * gap, 40 * S
        ld.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(56, 139, 253, 255) if k == i else (72, 79, 92, 255))
    img.alpha_composite(layer)


dest.mkdir(parents=True, exist_ok=True)
for old in dest.glob('*.png'):
    old.unlink()
frames_dir = out / f'frames-{lang}'
cache = {}
n_out = int(end * FPS)
j = 0
for k in range(n_out):
    t = k / FPS
    while j + 1 < len(times) and times[j + 1] <= t:
        j += 1
    if j not in cache:
        cache.clear()
        cache[j] = screen(Image.open(frames_dir / f'{j:04d}.jpg').convert('RGB'))
    img = base.copy()
    img.paste(cache[j], (px * S, py * S), mask)
    img = img.convert('RGBA')
    i, a = caption_at(t)
    draw_caption(img, i, a)
    img.convert('RGB').resize((W, H), Image.LANCZOS).save(dest / f'{k:04d}.png')
print(n_out, 'frames', SCREEN_W, SCREEN_H)
