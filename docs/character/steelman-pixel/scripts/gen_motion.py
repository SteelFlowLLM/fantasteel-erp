"""24px steelman (eyes) mochi motions -> Aseprite Lua script."""
import sys

S = 24
PAL = {
    'N': '#1b2531', 'K': '#121922', 'O': '#e07028', 'D': '#af5d2a', 'L': '#f08a45',
    'W': '#ffffff', 'S': '#c9d3de', 'P': '#f5a3a3', 'B': '#8ec5f0', 'M': '#8a3b2a',
}
HELMET = [
    "........OOOOOOOO........",
    "......OOOOODDOOOOO......",
    ".....OLOOOODDOOOOOO.....",
    "....OLLOOOODDOOOOOOO....",
    "....OLOOOOODDOOOOOOO....",
    "...OOOOOOOODDOOOOOOOO...",
    "...OOOOOOOODDOOOOOOOO...",
    ".OOOOOOOOOOOOOOOOOOOOOO.",
    "..OOOOOOOOOOOOOOOOOOOO..",
]
# body shapes: (left, right, height)  height = bottom - top
BODY = {
    'n':  (3, 20, 8),
    's1': (2, 21, 7),
    's2': (1, 22, 6),
    't1': (4, 19, 9),
    't2': (5, 18, 10),
}
LAYERS = ['배경', '그림자', '몸', '헬멧', '표정', '효과']


def blank():
    return [[None] * S for _ in range(S)]


def put(g, x, y, c):
    if 0 <= x < S and 0 <= y < S:
        g[y][x] = c


def background():
    g = blank()
    corner = [3, 2, 1]
    for y in range(S):
        t = corner[y] if y < 3 else corner[S - 1 - y] if y >= S - 3 else 0
        for x in range(t, S - t):
            g[y][x] = 'N'
    return g


def frame(body='n', bottom=20, eyes='open', mouth='smile', fx=None, fx_step=0, blush=True):
    left, right, h = BODY[body]
    top = bottom - h
    L = {k: blank() for k in LAYERS}
    L['배경'] = background()
    # shadow stays on the ground (row 21); shrinks while airborne
    air = 20 - bottom
    for x in range(left + 1 + air * 2, right - air * 2):
        put(L['그림자'], x, 21, 'K')
    # mochi body
    b = L['몸']
    for x in range(left + 1, right):
        put(b, x, top, 'W')
    for y in range(top + 1, bottom):
        for x in range(left, right + 1):
            put(b, x, y, 'W')
    for x in range(left + 1, right):
        put(b, x, bottom, 'S')
    # helmet rides on top of the head
    for j, row in enumerate(HELMET):
        for x, c in enumerate(row):
            if c != '.':
                put(L['헬멧'], x, top - len(HELMET) + j, c)
    # face
    f = L['표정']
    by = bottom
    lx, rx = (6, 16)  # left/right eye column (2 px wide)
    if body == 's2':
        lx, rx = 5, 17
    def eye(x0):
        if eyes == 'open':
            for y in range(by - 6, by - 3):
                put(f, x0, y, 'N'); put(f, x0 + 1, y, 'N')
        elif eyes == 'big':
            for y in range(by - 7, by - 3):
                put(f, x0, y, 'N'); put(f, x0 + 1, y, 'N')
            put(f, x0, by - 7, 'W')
        elif eyes == 'half':
            for y in (by - 5, by - 4):
                put(f, x0, y, 'N'); put(f, x0 + 1, y, 'N')
        elif eyes == 'closed':
            put(f, x0, by - 4, 'N'); put(f, x0 + 1, by - 4, 'N')
        elif eyes == 'happy':  # ^
            put(f, x0 - 1, by - 4, 'N'); put(f, x0, by - 5, 'N')
            put(f, x0 + 1, by - 5, 'N'); put(f, x0 + 2, by - 4, 'N')
        elif eyes == 'squeeze':  # > <
            pass
        elif eyes == 'sad':
            for y in (by - 5, by - 4):
                put(f, x0, y, 'N'); put(f, x0 + 1, y, 'N')
    if eyes == 'squeeze':
        for dx, dy in [(0, -6), (1, -5), (0, -4)]:
            put(f, lx + dx, by + dy, 'N')
        for dx, dy in [(1, -6), (0, -5), (1, -4)]:
            put(f, rx + dx, by + dy, 'N')
    else:
        eye(lx); eye(rx)
    if eyes == 'sad':  # inner brows tilt up
        put(f, lx + 1, by - 6, 'N'); put(f, rx, by - 6, 'N')
    if blush:
        for x in (left + 1, left + 2, right - 2, right - 1):
            put(f, x, by - 3, 'P')
    cx = 11
    if mouth == 'smile':
        for x, y in [(cx - 1, by - 2), (cx + 2, by - 2), (cx, by - 1), (cx + 1, by - 1)]:
            put(f, x, y, 'N')
    elif mouth == 'open':
        for x in range(cx - 1, cx + 3):
            put(f, x, by - 2, 'N')
        put(f, cx - 1, by - 1, 'N'); put(f, cx + 2, by - 1, 'N')
        put(f, cx, by - 1, 'P'); put(f, cx + 1, by - 1, 'P')
    elif mouth == 'o':
        for x, y in [(cx, by - 2), (cx + 1, by - 2), (cx, by - 1), (cx + 1, by - 1)]:
            put(f, x, y, 'N')
    elif mouth == 'flat':
        put(f, cx, by - 1, 'N'); put(f, cx + 1, by - 1, 'N')
    elif mouth == 'frown':
        for x, y in [(cx, by - 2), (cx + 1, by - 2), (cx - 1, by - 1), (cx + 2, by - 1)]:
            put(f, x, y, 'N')
    elif mouth == 'wavy':
        for x, y in [(cx - 1, by - 1), (cx, by - 2), (cx + 1, by - 1), (cx + 2, by - 2)]:
            put(f, x, y, 'N')
    # effects
    e = L['효과']
    if fx == 'sparkle':
        for cx_, cy_ in ([(2, 4), (21, 3)] if fx_step % 2 == 0 else [(2, 2), (21, 5)]):
            for d in (-1, 0, 1):
                put(e, cx_ + d, cy_, 'L'); put(e, cx_, cy_ + d, 'L')
    elif fx == 'bang':
        for y in range(1, 5):
            put(e, 21, y + fx_step, 'O')
        put(e, 21, 6 + fx_step, 'O')
    elif fx == 'tear':
        put(e, lx, by - 3 + fx_step, 'B')
        put(e, rx + 1, by - 3 + max(0, fx_step - 1), 'B')
    elif fx == 'z':
        zx, zy = [(19, 3), (18, 1), (17, 0)][fx_step]
        for j, row in enumerate(["SSSS", "..S.", ".S..", "SSSS"]):
            for i, c in enumerate(row):
                if c != '.':
                    put(e, zx + i, zy + j, c)
    return L


F = frame
ANIMS = [
    ('기본', 'idle', [
        (F('n'), 500), (F('s1'), 300), (F('n'), 500), (F('n', eyes='closed'), 90),
        (F('n'), 400), (F('s1'), 300), (F('n'), 500),
    ]),
    ('깜빡', 'blink', [
        (F('n'), 700), (F('n', eyes='half'), 50), (F('n', eyes='closed'), 80),
        (F('n', eyes='half'), 50), (F('n'), 500), (F('n', eyes='closed'), 80), (F('n'), 600),
    ]),
    ('기쁨', 'happy', [
        (F('s1', eyes='happy', mouth='open'), 120),
        (F('t1', bottom=19, eyes='happy', mouth='open', fx='sparkle', fx_step=0), 90),
        (F('t1', bottom=18, eyes='happy', mouth='open', fx='sparkle', fx_step=1), 120),
        (F('n', bottom=17, eyes='happy', mouth='open', fx='sparkle', fx_step=0), 120),
        (F('t1', bottom=19, eyes='happy', mouth='open', fx='sparkle', fx_step=1), 80),
        (F('s2', eyes='happy', mouth='open'), 110),
        (F('s1', eyes='happy', mouth='smile'), 100),
        (F('n', eyes='happy', mouth='smile'), 300),
    ]),
    ('말랑', 'squish', [
        (F('n'), 300),
        (F('s2', eyes='squeeze', mouth='wavy'), 160),
        (F('t2', eyes='open', mouth='o'), 110),
        (F('s1', eyes='closed', mouth='smile'), 100),
        (F('t1', mouth='smile'), 100),
        (F('s1', mouth='smile'), 90),
        (F('n', mouth='smile'), 400),
    ]),
    ('놀람', 'surprised', [
        (F('n'), 300),
        (F('t2', bottom=19, eyes='big', mouth='o', fx='bang', fx_step=1), 110),
        (F('t1', eyes='big', mouth='o', fx='bang', fx_step=0), 120),
        (F('n', eyes='big', mouth='o', fx='bang', fx_step=0), 500),
        (F('s1', eyes='big', mouth='o'), 120),
        (F('n', eyes='open', mouth='flat'), 400),
    ]),
    ('슬픔', 'sad', [
        (F('s1', eyes='sad', mouth='frown', fx='tear', fx_step=0, blush=False), 450),
        (F('s2', eyes='sad', mouth='frown', fx='tear', fx_step=1, blush=False), 450),
        (F('s1', eyes='sad', mouth='frown', fx='tear', fx_step=2, blush=False), 450),
        (F('s2', eyes='closed', mouth='frown', fx='tear', fx_step=3, blush=False), 450),
    ]),
    ('졸림', 'sleepy', [
        (F('n', eyes='half', mouth='flat'), 600),
        (F('s1', eyes='closed', mouth='flat', fx='z', fx_step=0), 700),
        (F('s1', eyes='closed', mouth='o', fx='z', fx_step=1), 700),
        (F('s1', eyes='closed', mouth='flat', fx='z', fx_step=2), 700),
        (F('n', eyes='half', mouth='flat'), 500),
    ]),
    ('말하기', 'talk', [
        (F('n', mouth='open'), 130), (F('s1', mouth='smile'), 110), (F('n', mouth='o'), 130),
        (F('t1', mouth='open'), 110), (F('n', mouth='smile'), 130), (F('s1', mouth='open'), 110),
        (F('n', mouth='flat'), 300),
    ]),
]


def rgb(c):
    h = PAL[c].lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def to_lua(out):
    frames, tags = [], []
    for ko, en, seq in ANIMS:
        start = len(frames) + 1
        frames.extend(seq)
        tags.append((ko, start, len(frames)))
    lines = ['local ORDER = {' + ','.join(f'"{k}"' for k in LAYERS) + '}', 'local DATA = {']
    for L, dur in frames:
        parts = []
        for k in LAYERS:
            px = []
            for y in range(S):
                for x in range(S):
                    c = L[k][y][x]
                    if c:
                        r, g, b = rgb(c)
                        px.append(f'{{{x},{y},{r},{g},{b}}}')
            parts.append(f'["{k}"]={{' + ','.join(px) + '}')
        lines.append('{d=%g,%s},' % (dur / 1000, ','.join(parts)))
    lines.append('}')
    lines.append('local TAGS = {' + ','.join(f'{{"{n}",{a},{b}}}' for n, a, b in tags) + '}')
    pal = '\n'.join('pal:setColor(%d, Color{r=%d,g=%d,b=%d})' % ((i,) + rgb(k)) for i, k in enumerate(PAL))
    lines.append(f'''
local spr = Sprite({S}, {S}, ColorMode.RGB)
local pal = Palette({len(PAL)})
{pal}
spr:setPalette(pal)
local layers = {{spr.layers[1]}}
layers[1].name = ORDER[1]
for i = 2, #ORDER do local l = spr:newLayer(); l.name = ORDER[i]; layers[i] = l end
for f = 2, #DATA do spr:newEmptyFrame() end
for f = 1, #DATA do
  spr.frames[f].duration = DATA[f].d
  for i, name in ipairs(ORDER) do
    local px = DATA[f][name]
    if #px > 0 then
      local img = Image({S}, {S}, ColorMode.RGB)
      for _, p in ipairs(px) do img:drawPixel(p[1], p[2], app.pixelColor.rgba(p[3], p[4], p[5], 255)) end
      spr:newCel(layers[i], f, img, Point(0, 0))
    end
  end
end
for _, t in ipairs(TAGS) do local tag = spr:newTag(t[2], t[3]); tag.name = t[1] end
spr:saveAs("{out}")
''')
    return '\n'.join(lines)


if __name__ == '__main__':
    out, path = sys.argv[1], sys.argv[2]
    with open(path, 'w') as fh:
        fh.write(to_lua(out))
    with open(path + '.tags', 'w') as fh:
        for ko, en, _ in ANIMS:
            fh.write(f'{ko} {en}\n')
