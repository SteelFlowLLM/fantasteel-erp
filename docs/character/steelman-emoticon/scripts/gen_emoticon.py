"""철강맨 메신저 이모티콘 8종 (64px, 움직임) -> 레이어 PNG + Aseprite Lua.

사용: python3 gen_emoticon.py <펫 원본 시트.png> <작업 폴더> <출력 .aseprite>
  작업 폴더/frames/*.png, 작업 폴더/build.lua, 작업 폴더/tags.tsv(태그 · 키 · 글자)
캐릭터는 펫 철강맨(신형 작업복) 48px 시트를 그대로 쓰고, 64px 캔버스 위쪽에 글자를 얹는다.
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

CELL = 48
PAL = {
    'N': '#1b2531', 'W': '#ffffff', 'w': '#f0f4f8', 's': '#cdd6e1', 'g': '#9aa8bd',
    'O': '#e07028', 'o': '#f39250', 'D': '#b4532c', 'Y': '#ffd166', 'y': '#fff1b8',
    'R': '#e5484d', 'r': '#a8323a', 'B': '#8ec5f0', 'b': '#4f8fd1', 'T': '#c98a4b',
    't': '#7b4630', 'G': '#8a96a3', 'H': '#5b6675', 'K': '#3a4556', 'E': '#3fb37f',
}
LAYERS = ['뒤효과', '캐릭터', '앞효과', '글자']
SIZE = 64
ORIGIN = (8, 15)   # 64px 캔버스 안 48px 캐릭터 칸의 왼쪽 위
# 글자 글꼴: macOS 기본 한글 글꼴 굵게(index 6). 다른 OS는 EMOTICON_FONT=<ttf 경로>로 바꾼다
FONT = os.environ.get('EMOTICON_FONT', '/System/Library/Fonts/AppleSDGothicNeo.ttc')
FONT_INDEX = int(os.environ.get('EMOTICON_FONT_INDEX', '6'))

PROPS = {
    'spark_s': [".Y.", "YyY", ".Y."],
    'spark_l': ["..Y..", "..Y..", "YYyYY", "..Y..", "..Y.."],
    'sweat': [".N..", "NBN.", "NBBN", "NBbN", ".NN."],
    'dust': [".ss.", "swws", ".ss."],
    'dust_s': [".s.", "sws", ".s."],
    'speed': ["gggggg"],
    'speed_s': ["gggg"],
    'thumb': [
        "...NN...",
        "..NWWN..",
        "..NWWN..",
        "NNNWWNN.",
        "NWWWWWWN",
        "NWWWWWsN",
        "NWWWWWsN",
        "NsWWWWsN",
        ".NssssN.",
        "..NNNN..",
    ],
    'hook': (["....NGN....", "....NHN...."] * 14) + [
        "NNNNNNNNNNN",
        "NYYKKYYKKYN",
        "NYKKYYKKYYN",
        "NKKYYKKYYKN",
        "NNNNNNNNNNN",
        ".....NGN...",
        ".....NGN...",
        ".....NGN...",
        ".NNN.NGN...",
        "NGGN.NGN...",
        "NGGNNNGGN..",
        ".NGGGGGN...",
        "..NNNNN....",
    ],
    'stamp': [
        "....NNNN....",
        "...NTTTTN...",
        "...NTTTtN...",
        "...NTTTtN...",
        "....NTtN....",
        "....NTtN....",
        "....NTtN....",
        ".NNNNNNNNNN.",
        ".NtTTTTTTtN.",
        "NNNNNNNNNNNN",
        "NRRRRRRRRRRN",
        "NRRRRRRRRRRN",
        "NrrrrrrrrrrN",
        "NNNNNNNNNNNN",
    ],
}


def hex_rgba(c):
    h = PAL[c].lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255


def prop_img(name):
    if name == 'mark':
        return mark_img()
    rows = PROPS[name]
    w = max(len(r) for r in rows)
    im = Image.new('RGBA', (w, len(rows)), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            if c != '.':
                im.putpixel((x, y), hex_rgba(c))
    return im


def mark_img():
    """결재 도장 자국: 두 줄 빨간 원 + 체크."""
    n = 17
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    c = (n - 1) / 2
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - c, y - c)
            if 6.6 <= d <= 8.4:
                im.putpixel((x, y), hex_rgba('R'))
    for x, y in ((4, 8), (5, 9), (6, 10), (7, 11), (8, 10), (9, 9), (10, 8), (11, 7), (12, 6)):
        for dy in (0, 1):
            im.putpixel((x, y + dy - 1), hex_rgba('R'))
    return im


def burst(r, dim=False):
    """용광로 불꽃: 몸 중심에서 퍼지는 8방향 불티."""
    im = Image.new('RGBA', (CELL + 16, CELL + 16), (0, 0, 0, 0))
    cx, cy = 24 + 8, 26 + 8
    for k in range(12):
        a = math.pi * 2 * k / 12 + math.pi / 12
        for j, c in ((0, 'y'), (1, 'Y'), (2, 'Y'), (3, 'O' if not dim else 'D'), (4, 'O' if not dim else 'D')):
            x = round(cx + math.cos(a) * (r - j))
            y = round(cy + math.sin(a) * (r - j))
            for dx, dy in ((0, 0),):
                if 0 <= x + dx < im.width and 0 <= y + dy < im.height:
                    im.putpixel((x + dx, y + dy), hex_rgba(c))
    return im, -8, -8


class Sheet:
    def __init__(self, path):
        self.im = Image.open(path).convert('RGBA')

    def get(self, row, col):
        return self.im.crop((col * CELL, row * CELL, col * CELL + CELL, row * CELL + CELL))


# ── 몸 변형 ──────────────────────────────────────────────
HEAD_BOTTOM = 30   # 얼굴 아래 끝 줄 (펫 시트 공통)
HELMET_BOTTOM = 19


def nod(img, k, helmet_extra=0):
    """머리(0~30줄)만 k칸 내려 고개 숙임을 만든다. 몸은 그대로."""
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.alpha_composite(img.crop((0, HEAD_BOTTOM + 1, CELL, CELL)), (0, HEAD_BOTTOM + 1))
    head = img.crop((0, 0, CELL, HEAD_BOTTOM + 1))
    if helmet_extra:
        face = head.crop((0, HELMET_BOTTOM + 1, CELL, HEAD_BOTTOM + 1))
        helmet = head.crop((0, 0, CELL, HELMET_BOTTOM + 1))
        head = Image.new('RGBA', head.size, (0, 0, 0, 0))
        head.alpha_composite(face, (0, HELMET_BOTTOM + 1))
        head.alpha_composite(helmet, (0, helmet_extra))
    out.alpha_composite(head, (0, k))
    return out


def flatten(img, ratio, widen=1.0):
    """바닥(46줄)에 붙인 채 납작하게."""
    w, h = round(CELL * widen), round(CELL * ratio)
    small = img.resize((w, h), Image.NEAREST)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.alpha_composite(small.crop((max(0, (w - CELL) // 2), 0, max(0, (w - CELL) // 2) + min(w, CELL), h)),
                        (max(0, (CELL - w) // 2), 47 - h))
    return out


def fr(char, dur, back=(), front=(), shake=(0, 0), cx=0):
    """한 프레임. 프롭 위치는 48px 캐릭터 칸 기준 좌표 (이름, x, y). 칸 밖(음수·48 이상)도 64 캔버스 안이면 보인다"""
    return {'char': char, 'dur': dur, 'back': list(back), 'front': list(front), 'shake': shake, 'cx': cx}


def build(sh):
    G = sh.get
    idle, blink2 = G(0, 0), G(1, 2)
    happy0 = G(4, 0)
    wave1, wave2, wave3 = G(5, 1), G(5, 2), G(5, 3)
    land0, land1 = G(10, 0), G(10, 1)
    sur0, sur1 = G(12, 0), G(12, 1)
    walk = [G(2, i) for i in range(6)]
    talk1 = G(3, 1)

    E = []  # (태그, 키 = shared MESSAGE_EMOTICONS의 key, 글자, 글자색, 글자 위치, frames)

    # 1 확인: 손 번쩍 + 반짝
    E.append(('확인', 'steelman-ok', '확인!', 'O', 'center', [
        fr(idle, 160),
        fr(wave1, 120),
        fr(wave2, 140, front=[('spark_s', 42, 12)]),
        fr(wave2, 140, front=[('spark_l', 41, 11)]),
        fr(wave2, 140, front=[('spark_s', 42, 12)]),
        fr(wave2, 500),
    ]))

    # 2 넵넵: 빠르게 두 번 끄덕
    E.append(('넵넵', 'steelman-yes', '넵넵', 'W', 'center', [
        fr(idle, 120),
        fr(nod(happy0, 2), 70), fr(nod(happy0, 3), 110), fr(idle, 80),
        fr(nod(happy0, 2), 70), fr(nod(happy0, 3), 110), fr(idle, 80),
        fr(happy0, 600),
    ]))

    # 3 감사합니다: 꾸벅, 안전모가 살짝 미끄러짐
    E.append(('감사', 'steelman-thanks', '감사합니다', 'W', 'center', [
        fr(idle, 220),
        fr(nod(happy0, 2), 90),
        fr(nod(happy0, 4, helmet_extra=1), 90),
        fr(nod(happy0, 5, helmet_extra=2), 700, front=[('spark_s', 4, 18), ('spark_s', 41, 18)]),
        fr(nod(happy0, 2), 100),
        fr(happy0, 500),
    ]))

    # 4 죄송합니다: 납작 엎드림 + 땀
    flat1 = flatten(land0, 0.78, 1.08)
    flat2 = flatten(land0, 0.72, 1.12)
    E.append(('죄송', 'steelman-sorry', '죄송합니다', 'W', 'center', [
        fr(idle, 160),
        fr(land1, 90),
        fr(land0, 100),
        fr(flat1, 120),
        fr(flat2, 260, front=[('sweat', 38, 18)]),
        fr(flat2, 260, front=[('sweat', 38, 20), ('sweat', 6, 22)]),
        fr(flat1, 260, front=[('sweat', 38, 22), ('sweat', 6, 24)]),
        fr(flat2, 400, front=[('sweat', 6, 26)]),
    ]))

    # 5 결재 완료: 도장 쾅 → 도장 자국
    E.append(('결재', 'steelman-approve', '결재 완료', 'R', 'center', [
        fr(idle, 160),
        fr(wave1, 140, front=[('stamp', 36, 6)]),
        fr(wave2, 200, front=[('stamp', 36, 2)]),
        fr(land0, 80, front=[('stamp', 40, 33), ('spark_l', 52, 28), ('spark_l', 34, 30),
                             ('spark_s', 53, 40)], shake=(1, 0)),
        fr(land0, 80, front=[('stamp', 40, 33), ('spark_s', 52, 29)], shake=(-1, 0)),
        fr(wave3, 700, front=[('mark', 38, 30), ('stamp', 36, 3)]),
    ]))

    # 6 최고: 엄지 척 + 용광로 불꽃
    E.append(('최고', 'steelman-best', '최고', 'Y', 'center', [
        fr(idle, 160),
        fr(talk1, 120, front=[('thumb', 36, 26)]),
        fr(talk1, 80, back=[('burst', 8)], front=[('thumb', 36, 25)]),
        fr(talk1, 80, back=[('burst', 13)], front=[('thumb', 36, 25)]),
        fr(talk1, 80, back=[('burst', 18)], front=[('thumb', 36, 25)]),
        fr(talk1, 120, back=[('burst_dim', 22)], front=[('thumb', 36, 25)]),
        fr(talk1, 500, front=[('thumb', 36, 26), ('spark_s', 43, 21)]),
    ]))

    # 7 헉: 크레인 갈고리가 툭
    hook_top = -len(PROPS['hook'])
    E.append(('헉', 'steelman-gasp', '헉!', 'W', 'left', [
        fr(idle, 200, front=[('hook', 25, hook_top - 6)]),
        fr(idle, 90, front=[('hook', 25, hook_top + 4)]),
        fr(blink2, 90, front=[('hook', 25, hook_top + 12)]),
        fr(sur0, 90, front=[('hook', 25, hook_top + 10), ('spark_l', 22, 2), ('spark_s', 40, 4)], shake=(1, 0)),
        fr(sur1, 90, front=[('hook', 25, hook_top + 10), ('spark_s', 21, 3)], shake=(-1, 0)),
        fr(sur1, 300, front=[('hook', 25, hook_top + 10), ('sweat', 8, 18)]),
        fr(sur0, 400, front=[('hook', 25, hook_top + 10), ('sweat', 8, 21)]),
    ]))

    # 8 퇴근!: 손 흔들고 제자리 달리기
    run = []
    for i in range(12):
        w = walk[i % 6]
        bob = -1 if i % 2 else 0
        sp = [('speed', -6 + (i % 3) * -2, 22), ('speed_s', -2 + (i % 3) * -2, 30), ('speed', -6 + ((i + 1) % 3) * -2, 38)]
        dust = [('dust', 8 - (i % 4) * 3, 42)] if i % 4 < 3 else [('dust_s', 2, 43)]
        run.append(fr(w, 70, back=sp + dust, cx=bob))
    E.append(('퇴근', 'steelman-off', '퇴근!', 'O', 'center', [
        fr(wave1, 160), fr(wave2, 160), fr(wave1, 160), fr(wave2, 160),
    ] + run))
    return E


# ── 그리기 ──────────────────────────────────────────────
class Canvas:
    def __init__(self, s):
        self.im = Image.new('RGBA', (s, s), (0, 0, 0, 0))

    def alpha_composite_clip(self, src, x, y):
        # PIL alpha_composite는 음수 좌표를 못 받아서 잘라 붙인다.
        sx, sy = max(0, -x), max(0, -y)
        if sx >= src.width or sy >= src.height:
            return
        part = src.crop((sx, sy, src.width, src.height))
        self.im.alpha_composite(part, (max(0, x), max(0, y)))


def place_props(canvas, props, origin):
    ox, oy = origin
    for p in props:
        name = p[0]
        if name in ('burst', 'burst_dim'):
            im, dx, dy = burst(p[1], dim=name == 'burst_dim')
            canvas.alpha_composite_clip(im, ox + dx, oy + dy)
            continue
        canvas.alpha_composite_clip(prop_img(name), ox + p[1], oy + p[2])


def outline_text(text, color, align):
    """앤티에일리어싱 없는 12px 글자 + 네이비 1px 외곽선 (도트처럼 보이게)."""
    font = ImageFont.truetype(FONT, 12, index=FONT_INDEX)
    mask = Image.new('L', (SIZE, 20), 0)
    d = ImageDraw.Draw(mask)
    d.fontmode = '1'
    l, t, r, _ = d.textbbox((0, 0), text, font=font)
    x = (SIZE - (r - l)) // 2 - l if align == 'center' else 3 - l
    d.text((x, 3 - t), text, font=font, fill=255)
    grown = Image.new('L', mask.size, 0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            grown.paste(255, (0, 0), mask.transform(mask.size, Image.AFFINE, (1, 0, -dx, 0, 1, -dy)))
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(Image.new('RGBA', mask.size, hex_rgba('N')), (0, 0), grown)
    out.paste(Image.new('RGBA', mask.size, hex_rgba(color)), (0, 0), mask)
    return out


def render(E, workdir):
    frames_dir = os.path.join(workdir, 'frames')
    os.makedirs(frames_dir, exist_ok=True)
    plan = []  # (dur, {layer: path})
    tags = []
    for tag, key, text, color, align, seq in E:
        start = len(plan) + 1
        text_img = outline_text(text, color, align)
        for i, f in enumerate(seq):
            o = (ORIGIN[0] + f['shake'][0], ORIGIN[1] + f['shake'][1] + f['cx'])
            layers = {k: Canvas(SIZE) for k in LAYERS}
            place_props(layers['뒤효과'], f['back'], o)
            layers['캐릭터'].alpha_composite_clip(f['char'], o[0], o[1])
            place_props(layers['앞효과'], f['front'], o)
            layers['글자'].im = text_img
            paths = {}
            for k in LAYERS:
                if layers[k].im.getbbox() is None:
                    continue
                p = os.path.join(frames_dir, f'{key}_{i:02d}_{LAYERS.index(k)}.png')
                layers[k].im.save(p)
                paths[k] = p
            plan.append((f['dur'], paths))
        tags.append((tag, start, len(plan), key))
    return plan, tags


def to_lua(plan, tags, out_path):
    lines = ['local ORDER = {' + ','.join(f'"{k}"' for k in LAYERS) + '}', 'local DATA = {']
    for dur, paths in plan:
        parts = ','.join(f'["{k}"]="{v}"' for k, v in paths.items())
        lines.append('{d=%g,%s},' % (dur / 1000, parts))
    lines.append('}')
    lines.append('local TAGS = {' + ','.join(f'{{"{n}",{a},{b}}}' for n, a, b, _ in tags) + '}')
    pal = '\n'.join('pal:setColor(%d, Color{r=%d,g=%d,b=%d})' % ((i,) + hex_rgba(k)[:3]) for i, k in enumerate(PAL))
    lines.append(f'''
local spr = Sprite({SIZE}, {SIZE}, ColorMode.RGB)
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
    local p = DATA[f][name]
    if p then spr:newCel(layers[i], f, Image{{fromFile=p}}, Point(0, 0)) end
  end
end
for _, t in ipairs(TAGS) do local tag = spr:newTag(t[2], t[3]); tag.name = t[1] end
spr:saveAs("{out_path}")
''')
    return '\n'.join(lines)


if __name__ == '__main__':
    sheet_path, workdir, ase_path = sys.argv[1], sys.argv[2], sys.argv[3]
    E = build(Sheet(sheet_path))
    with open(os.path.join(workdir, 'tags.tsv'), 'w') as fh:
        for tag, key, text, *_ in E:
            fh.write(f'{tag}\t{key}\t{text}\n')
    plan, tags = render(E, workdir)
    with open(os.path.join(workdir, 'build.lua'), 'w') as fh:
        fh.write(to_lua(plan, tags, ase_path))
