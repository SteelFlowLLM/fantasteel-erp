"""Build 32x32 steelman pixel frames and emit an Aseprite Lua script."""
import json, sys

W = H = 32
PAL = {
    'N': '#1b2531',  # navy (bg, goggle, mouth)
    'O': '#e07028',  # helmet orange
    'D': '#af5d2a',  # helmet stripe
    'L': '#f08a45',  # helmet highlight
    'W': '#ffffff',  # face
    'S': '#c9d3de',  # face shade
    'B': '#8ec5f0',  # sweat
    'P': '#f2787a',  # tongue
}

def blank():
    return [[None] * W for _ in range(H)]

def put(g, x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c

def hline(g, x0, x1, y, c):
    for x in range(x0, x1 + 1):
        put(g, x, y, c)

# ---- layers -------------------------------------------------------------
def background():
    g = blank()
    r = [4, 2, 1, 1]  # rounded corner trim per row
    for y in range(H):
        t = r[y] if y < 4 else r[H - 1 - y] if y >= H - 4 else 0
        hline(g, t, W - 1 - t, y, 'N')
    return g

def helmet():
    g = blank()
    dome = {6: (13, 18), 7: (11, 20), 8: (10, 21), 9: (9, 22), 10: (9, 22),
            11: (8, 23), 12: (8, 23), 13: (8, 23)}
    for y, (a, b) in dome.items():
        hline(g, a, b, y, 'O')
    # brim
    hline(g, 5, 26, 14, 'O')
    hline(g, 5, 26, 15, 'O')
    put(g, 5, 15, None); put(g, 26, 15, None)
    # highlight on dome
    for x, y in [(11, 8), (10, 9), (10, 10)]:
        put(g, x, y, 'L')
    # center stripe
    for y in range(7, 14):
        put(g, 15, y, 'D'); put(g, 16, y, 'D')
    return g

def face():
    g = blank()
    rows = {17: (10, 21), 18: (9, 22), 19: (9, 22), 20: (9, 22), 21: (9, 22),
            22: (9, 22), 23: (9, 22), 24: (9, 22), 25: (9, 22), 26: (10, 21)}
    for y, (a, b) in rows.items():
        hline(g, a, b, y, 'W')
    hline(g, 11, 20, 26, 'S')  # chin shade
    put(g, 10, 26, 'S'); put(g, 21, 26, 'S')
    # goggles
    hline(g, 11, 20, 18, 'N')
    hline(g, 10, 21, 19, 'N')
    hline(g, 11, 20, 20, 'N')
    for x, y in [(13, 18), (12, 19), (13, 19), (14, 19)][1:]:
        pass
    # slanted lens highlight
    for x, y in [(13, 18), (12, 19)]:
        put(g, x, y, 'W')
    return g

MOUTHS = {
    'smile':     [(12, 22), (19, 22), (13, 23), (18, 23)] + [(x, 24) for x in range(14, 18)],
    'grin':      [(x, 22) for x in range(12, 20)] + [(x, 23) for x in range(12, 20)]
                 + [(x, 24) for x in range(13, 19)] + [(x, 25) for x in range(14, 18)],
    'smirk':     [(13, 23)] + [(x, 24) for x in range(14, 18)] + [(18, 23), (19, 22)],
    'surprised': [(15, 22), (16, 22), (14, 23), (17, 23), (14, 24), (17, 24), (15, 25), (16, 25)],
    'awkward':   [(12, 24), (13, 23), (14, 23), (15, 24), (16, 24), (17, 23), (18, 23), (19, 24)],
    'tongue':    [(12, 22), (19, 22), (13, 23), (18, 23)] + [(x, 23) for x in range(14, 18)],
}

def mouth(kind):
    g = blank()
    if kind == 'grin':
        for x, y in MOUTHS['grin']:
            put(g, x, y, 'N')
        hline(g, 14, 17, 25, 'P')
        hline(g, 15, 16, 24, 'P')
    else:
        for x, y in MOUTHS[kind]:
            put(g, x, y, 'N')
    if kind == 'tongue':
        for x, y in [(16, 24), (17, 24), (16, 25), (17, 25)]:
            put(g, x, y, 'P')
    return g

def effects(kind):
    g = blank()
    if kind == 'sparkle':
        # big 4-point star top-right
        cx, cy = 26, 5
        for d in range(-3, 4):
            put(g, cx + d, cy, 'O'); put(g, cx, cy + d, 'O')
        for dx, dy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
            put(g, cx + dx, cy + dy, 'O')
        # small star left
        cx, cy = 4, 22
        for d in (-1, 0, 1):
            put(g, cx + d, cy, 'O'); put(g, cx, cy + d, 'O')
    elif kind == 'question':
        q = ["OOO.", "O..O", "...O", "..O.", ".O..", "....", ".O.."]
        for j, row in enumerate(q):
            for i, c in enumerate(row):
                if c == 'O':
                    put(g, 25 + i, 2 + j, 'O')
    elif kind == 'sweat':
        for x, y in [(27, 15), (27, 16), (26, 17), (27, 17), (28, 17), (26, 18), (27, 18), (28, 18), (27, 19)]:
            put(g, x, y, 'B')
        put(g, 26, 17, '#c4e2f8')
    return g

def rotate(g, deg, cx=15.5, cy=17.0, k=8):
    """Upscale k x, rotate with nearest, sample back down: keeps palette colors."""
    from PIL import Image
    big = Image.new('RGBA', (W * k, H * k), (0, 0, 0, 0))
    px = big.load()
    for y in range(H):
        for x in range(W):
            c = g[y][x]
            if c:
                h = color(c).lstrip('#')
                v = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
                for yy in range(k):
                    for xx in range(k):
                        px[x * k + xx, y * k + yy] = v
    big = big.rotate(deg, resample=Image.NEAREST, center=(cx * k, cy * k))
    out = blank()
    bp = big.load()
    for y in range(H):
        for x in range(W):
            r, gg, b, a = bp[x * k + k // 2, y * k + k // 2]
            if a:
                out[y][x] = '#%02x%02x%02x' % (r, gg, b)
    return out

def tilt(g, rows_shift):
    """Shift head rows sideways/up to fake a tilt (pixel-safe shear)."""
    out = blank()
    for y in range(H):
        for x in range(W):
            c = g[y][x]
            if c is None:
                continue
            dy = rows_shift(x)
            dx = 0
            put(out, x + dx, y + dy, c)
    return out

FRAMES = [
    ('미소', 'smile', 'smile', None),
    ('활짝', 'grin', 'grin', None),
    ('신남', 'excited', 'smile', 'sparkle'),
    ('씩', 'smirk', 'smirk', None),
    ('놀람', 'surprised', 'surprised', None),
    ('갸웃', 'puzzled', 'smile', 'question'),
    ('머쓱', 'awkward', 'awkward', 'sweat'),
    ('메롱', 'tongue', 'tongue', None),
]

def build():
    frames = []
    for ko, en, m, fx in FRAMES:
        layers = {'배경': background(), '헬멧': helmet(), '얼굴': face(),
                  '표정': mouth(m), '효과': effects(fx)}
        if en == 'puzzled':
            # head tilts left: left side drops 1px, right side rises 1px
            for k in ('헬멧', '얼굴', '표정'):
                layers[k] = tilt(layers[k], lambda x: 1 if x <= 9 else (0 if x <= 21 else -1))
        frames.append({'ko': ko, 'en': en, 'layers': layers})
    return frames

def color(c):
    return PAL.get(c, c)

def to_lua(frames, out_path, png_dir):
    order = ['배경', '헬멧', '얼굴', '표정', '효과']
    data = []
    for f in frames:
        lay = {}
        for k in order:
            px = []
            for y in range(H):
                for x in range(W):
                    c = f['layers'][k][y][x]
                    if c:
                        h = color(c).lstrip('#')
                        px.append(f'{{{x},{y},{int(h[0:2],16)},{int(h[2:4],16)},{int(h[4:6],16)}}}')
            lay[k] = '{' + ','.join(px) + '}'
        data.append(lay)
    lines = ['local ORDER = {' + ','.join(f'"{k}"' for k in order) + '}']
    lines.append('local NAMES = {' + ','.join(f'"{f["ko"]}"' for f in frames) + '}')
    lines.append('local DATA = {')
    for lay in data:
        lines.append('{' + ','.join(f'["{k}"]={lay[k]}' for k in order) + '},')
    lines.append('}')
    lines.append(f'local OUT = {json.dumps(out_path)}')
    lines.append(r'''
local spr = Sprite(32, 32, ColorMode.RGB)
-- palette
local pal = Palette(%d)
%s
spr:setPalette(pal)
-- layers bottom -> top
local layers = {}
layers[1] = spr.layers[1]
layers[1].name = ORDER[1]
for i = 2, #ORDER do
  local l = spr:newLayer()
  l.name = ORDER[i]
  layers[i] = l
end
for f = 2, #DATA do spr:newEmptyFrame() end
for f = 1, #DATA do
  spr.frames[f].duration = 0.6
  for i, name in ipairs(ORDER) do
    local px = DATA[f][name]
    if #px > 0 then
      local img = Image(32, 32, ColorMode.RGB)
      for _, p in ipairs(px) do
        img:drawPixel(p[1], p[2], app.pixelColor.rgba(p[3], p[4], p[5], 255))
      end
      spr:newCel(layers[i], f, img, Point(0, 0))
    end
  end
  local tag = spr:newTag(f, f)
  tag.name = NAMES[f]
end
spr:saveAs(OUT)
''' % (len(PAL) + 1, '\n'.join(
        f'pal:setColor({i}, Color{{r={int(v[1:3],16)},g={int(v[3:5],16)},b={int(v[5:7],16)}}})'
        for i, v in enumerate(list(PAL.values()) + ['#c4e2f8']))))
    return '\n'.join(lines)

if __name__ == '__main__':
    out_ase, lua_path = sys.argv[1], sys.argv[2]
    frames = build()
    with open(lua_path, 'w') as fh:
        fh.write(to_lua(frames, out_ase, None))
    with open(lua_path + '.names.json', 'w') as fh:
        json.dump([[f['ko'], f['en']] for f in frames], fh, ensure_ascii=False)
