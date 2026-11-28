#!/usr/bin/env python3
"""Picture questions: crops a REAL diagram from the notes or slides, covers labels with the background colour and adds a „?” marker,
a red ring or a red frame. It never draws anything else.

Usage: python3 scripts/mask-image.py spec.json [name-filter…] [--preview]   (needs Pillow: pip install pillow)
spec.json: list of {src, out, crop?: [x0,y0,x1,y1], masks?: [[x0,y0,x1,y1]], pad?, fill?: [r,g,b], colfill?: bool,
                    marks?: [{at: [x,y], box?: [..], anchor?: "left"|"right", size?}], rings?: [[x,y,r]], rects?: [[x0,y0,x1,y1]], width?, upscale?}
Coordinates are in source-image pixels; `out` is relative to app/public/data/images/ (e.g. "<bookId>/<name>.webp").
Default mask fill: median colour of a ring around the box; `colfill`: per-column colour from just above/below (for banded charts).
--preview writes JPEGs to $PREVIEW instead.
"""
import json, os, statistics, sys
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "public", "data", "images")
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

def bg(im, r, ring=4):
    x0, y0, x1, y1 = r
    px = []
    W, H = im.size
    for x in range(max(0, x0 - ring), min(W, x1 + ring), 2):
        for y in (max(0, y0 - ring), min(H - 1, y1 + ring)):
            px.append(im.getpixel((x, y)))
    for y in range(max(0, y0 - ring), min(H, y1 + ring), 2):
        for x in (max(0, x0 - ring), min(W - 1, x1 + ring)):
            px.append(im.getpixel((x, y)))
    return tuple(int(statistics.median(c[i] for c in px)) for i in range(3))

def render(item, preview=False):
    im = Image.open(item["src"]).convert("RGB")
    pad = item.get("pad", 6)
    d = ImageDraw.Draw(im)
    W, H = im.size
    src = im.copy()
    for r in item.get("masks", []):
        r = [max(0, r[0] - pad), max(0, r[1] - pad), min(W - 1, r[2] + pad), min(H - 1, r[3] + pad)]
        if item.get("fill"):
            d.rectangle(r, fill=tuple(item["fill"]))
            continue
        if not item.get("colfill"):
            d.rectangle(r, fill=bg(src, r))
            continue
        # column fill: each column takes the median colour just above and below the box (keeps bands/gradients)
        for x in range(r[0], r[2] + 1):
            px = [src.getpixel((x, y)) for y in list(range(max(0, r[1] - 8), r[1] - 2)) + list(range(r[3] + 3, min(H, r[3] + 9)))]
            col = tuple(int(statistics.median(c[i] for c in px)) for i in range(3)) if px else bg(src, r)
            d.line([(x, r[1]), (x, r[3])], fill=col)
    if item.get("crop"):
        im = im.crop(tuple(item["crop"]))
        ox, oy = item["crop"][0], item["crop"][1]
    else:
        ox = oy = 0
    w = item.get("width", 1000)
    s = min(1.0, w / im.width)
    if item.get("upscale"):
        s = w / im.width
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS) if s != 1 else im
    d = ImageDraw.Draw(im)
    for (x0, y0, x1, y1) in item.get("rects", []):
        for k in range(6):
            d.rectangle([(x0 - ox) * s - k, (y0 - oy) * s - k, (x1 - ox) * s + k, (y1 - oy) * s + k], outline=(230, 20, 20))
    for (x, y, r) in item.get("rings", []):
        x, y, r = (x - ox) * s, (y - oy) * s, r * s
        for k in range(4):
            d.ellipse([x - r - k, y - r - k, x + r + k, y + r + k], outline=(230, 20, 20))
    for m in item.get("marks", []):
        size = m.get("size", 34)
        f = ImageFont.truetype(BOLD, size)
        t = m.get("text", "?")
        tw = d.textlength(t, font=f)
        bw, bh = max(tw + size * 0.7, size * 1.3), size * 1.3
        x, y = (m["at"][0] - ox) * s, (m["at"][1] - oy) * s
        if m.get("box") and m.get("anchor") == "left": x = (m["box"][0] - ox) * s + bw / 2 + 4
        if m.get("box") and m.get("anchor") == "right": x = (m["box"][2] - ox) * s - bw / 2 - 4
        box = [x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2]
        d.rounded_rectangle(box, radius=size * 0.3, fill=(255, 212, 0), outline=(20, 20, 20), width=3)
        d.text((x, y), t, font=f, fill=(0, 0, 0), anchor="mm")
    out = os.path.join(ROOT, item["out"])
    if preview:
        out = os.path.join(os.environ.get("PREVIEW", "/tmp"), os.path.basename(item["out"]).replace(".webp", ".jpg"))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if out.endswith(".webp"):
        im.save(out, "WEBP", quality=item.get("quality", 80), method=6)
    else:
        im.save(out, quality=85)
    return out

if __name__ == "__main__":
    spec = json.load(open(sys.argv[1]))
    preview = "--preview" in sys.argv
    only = [a for a in sys.argv[2:] if not a.startswith("--")]
    for it in spec:
        if only and not any(o in it["out"] for o in only):
            continue
        p = render(it, preview)
        print(p, os.path.getsize(p) // 1024, "KB")
