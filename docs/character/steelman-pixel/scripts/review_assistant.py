"""Labelled contact sheet of every assistant variant.

usage: python3 review_assistant.py <out.png> [scale] [bg|clear] [from_row] [to_row]
  bg    : navy background (default)
  clear : transparent version (outline, no background/shadow) on a white panel
"""
import sys
from PIL import Image, ImageDraw, ImageFont
import gen_assistant as ga

out = sys.argv[1]
K = int(sys.argv[2]) if len(sys.argv) > 2 else 5
mode = sys.argv[3] if len(sys.argv) > 3 else 'bg'
tags = ga.all_tags()
lo = int(sys.argv[4]) if len(sys.argv) > 4 else 0
hi = int(sys.argv[5]) if len(sys.argv) > 5 else len(tags)
tags = tags[lo:hi]
layers = ga.LAYERS if mode == 'bg' else [k for k in ga.LAYERS if k not in ('배경', '그림자')]

FONT = ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc', 15)
maxf = max(len(seq) for *_, seq in tags)
LABEL_W, PAD = 190, 6
cell = ga.S * K + PAD
im = Image.new('RGB', (LABEL_W + maxf * cell + PAD, len(tags) * cell + PAD),
               '#f3f4f6' if mode == 'bg' else '#ffffff')
d = ImageDraw.Draw(im)
for r, (name, fname, desc, seq) in enumerate(tags):
    y0 = PAD + r * cell
    d.text((8, y0 + cell // 2 - 18), name, fill='#1b2531', font=FONT)
    d.text((8, y0 + cell // 2 + 2), desc, fill='#5b6675', font=FONT)
    for c, (L, dur) in enumerate(seq):
        tile = Image.new('RGBA', (ga.S, ga.S), (0, 0, 0, 0))
        px = tile.load()
        for k in layers:
            for y in range(ga.S):
                for x in range(ga.S):
                    v = L[k][y][x]
                    if v:
                        px[x, y] = ga.rgb(v) + (255,)
        tile = tile.resize((ga.S * K, ga.S * K), Image.NEAREST)
        if mode == 'clear':
            d.rectangle([LABEL_W + c * cell - 1, y0 - 1, LABEL_W + c * cell + ga.S * K, y0 + ga.S * K], outline='#e5e7eb')
        im.paste(tile, (LABEL_W + c * cell, y0), tile)
im.save(out)
