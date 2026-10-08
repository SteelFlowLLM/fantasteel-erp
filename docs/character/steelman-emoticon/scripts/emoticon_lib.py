"""철강맨 이모티콘 공통 그리기: 팔레트·소품·몸 변형·얼굴 바꾸기·글자·레이어 PNG·Aseprite Lua.

묶음 정의(set_work.py, set_daily.py)가 이 파일의 도구로 프레임을 만들고, gen_emoticon.py가 묶음 하나를 .aseprite로 만든다.
좌표는 모두 48px 캐릭터 칸 기준이다. 칸은 64px 캔버스의 (8, 15)에 놓이므로 칸 좌표 (-8..55, -15..48)이 캔버스 안이다.
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

CELL = 48
SIZE = 64
ORIGIN = (8, 15)
PAL = {
    'N': '#1b2531', 'W': '#ffffff', 'w': '#f0f4f8', 's': '#cdd6e1', 'g': '#9aa8bd',
    'O': '#e07028', 'o': '#f39250', 'D': '#b4532c', 'Y': '#ffd166', 'y': '#fff1b8',
    'R': '#e5484d', 'r': '#a8323a', 'B': '#8ec5f0', 'b': '#4f8fd1', 'T': '#c98a4b',
    't': '#7b4630', 'G': '#8a96a3', 'H': '#5b6675', 'K': '#3a4556', 'E': '#3fb37f',
    'P': '#f5a3a3', 'p': '#d9707a', 'C': '#d6eefc', 'V': '#9b7be0', 'L': '#a5e07a',
    'e': '#2a8a5c',
}
LAYERS = ['뒤효과', '캐릭터', '앞효과', '글자']
# 글자 글꼴: macOS 기본 한글 글꼴 굵게(index 6). 다른 OS는 EMOTICON_FONT=<ttf 경로>로 바꾼다
FONT = os.environ.get('EMOTICON_FONT', '/System/Library/Fonts/AppleSDGothicNeo.ttc')
FONT_INDEX = int(os.environ.get('EMOTICON_FONT_INDEX', '6'))


def rgba(c):
    h = PAL[c].lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255


def blank(w=CELL, h=CELL):
    return Image.new('RGBA', (w, h), (0, 0, 0, 0))


def pix(rows):
    """문자 그림 → 이미지 ('.'은 투명)."""
    w = max(len(r) for r in rows)
    im = blank(w, len(rows))
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            if c != '.':
                im.putpixel((x, y), rgba(c))
    return im


def outlined(mask_fn, w, h, fill, line='N'):
    """mask_fn(x, y) 참인 칸을 fill로 칠하고 바깥 1px을 외곽선으로 두른다 (원·막대 같은 소품용)."""
    im = blank(w + 2, h + 2)
    inside = {(x + 1, y + 1) for y in range(h) for x in range(w) if mask_fn(x, y)}
    for (x, y) in inside:
        im.putpixel((x, y), rgba(fill))
    for (x, y) in inside:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            p = (x + dx, y + dy)
            if p not in inside and 0 <= p[0] < im.width and 0 <= p[1] < im.height:
                im.putpixel(p, rgba(line))
    return im


def flip(im):
    return im.transpose(Image.FLIP_LEFT_RIGHT)


# ── 소품 (문자 그림) ─────────────────────────────────────
PROPS = {
    'spark_s': [".Y.", "YyY", ".Y."],
    'spark_l': ["..Y..", "..Y..", "YYyYY", "..Y..", "..Y.."],
    'spark_w': [".W.", "WWW", ".W."],
    'sweat': [".N..", "NBN.", "NBBN", "NBbN", ".NN."],
    'drop': ["B", "B"],
    'drop_l': [".B.", "BBB", "BbB", ".B."],
    'dust': [".ss.", "swws", ".ss."],
    'dust_s': [".s.", "sws", ".s."],
    'speed': ["gggggg"],
    'speed_s': ["gggg"],
    'thumb': [
        "...NN...", "..NWWN..", "..NWWN..", "NNNWWNN.", "NWWWWWWN",
        "NWWWWWsN", "NWWWWWsN", "NsWWWWsN", ".NssssN.", "..NNNN..",
    ],
    'hook': (["....NGN....", "....NHN...."] * 14) + [
        "NNNNNNNNNNN", "NYYKKYYKKYN", "NYKKYYKKYYN", "NKKYYKKYYKN", "NNNNNNNNNNN",
        ".....NGN...", ".....NGN...", ".....NGN...", ".NNN.NGN...", "NGGN.NGN...",
        "NGGNNNGGN..", ".NGGGGGN...", "..NNNNN....",
    ],
    'stamp': [
        "....NNNN....", "...NTTTTN...", "...NTTTtN...", "...NTTTtN...", "....NTtN....",
        "....NTtN....", "....NTtN....", ".NNNNNNNNNN.", ".NtTTTTTTtN.", "NNNNNNNNNNNN",
        "NRRRRRRRRRRN", "NRRRRRRRRRRN", "NrrrrrrrrrrN", "NNNNNNNNNNNN",
    ],
    'magnifier': [
        ".NNNN....", "NCCBBN...", "NCBBBN...", "NBBBBN...", "NBBBbN...",
        ".NNNNNN..", ".....NtN.", "......NtN", ".......NN",
    ],
    'paper': [
        "NNNNNN..", "NWWWWNN.", "NWggWWNN", "NWWWWWWN", "NWggggWN",
        "NWWWWWWN", "NWggggWN", "NWWWWWWN", "NWgggWWN", "NNNNNNNN",
    ],
    'siren': [
        "...NNN...", "..NRRRN..", ".NRyRRRN.", ".NRRRRrN.", "NNNNNNNNN", "NGGGGGGHN", "NNNNNNNNN",
    ],
    'siren_off': [
        "...NNN...", "..NrrrN..", ".NrRrrrN.", ".NrrrrrN.", "NNNNNNNNN", "NGGGGGGHN", "NNNNNNNNN",
    ],
    'ray_l': ["Y..", ".RR", "Y.."],
    'ray_r': ["..Y", "RR.", "..Y"],
    'check': [
        "........NN", ".......NEN", "......NEEN", "NN...NEEN.", "NEN.NEEN..",
        "NEENEEN...", ".NEEEN....", "..NNN.....",
    ],
    'palm': [
        "..N.N.N.N...", ".NWNWNWNWN..", ".NWNWNWNWN..", ".NWNWNWNWN..", ".NWWWWWWWN.N",
        ".NWWWWWWWNWN", ".NWWWWWWWWWN", ".NWWWWWWWWN.", ".NsWWWWWWWN.", "..NsWWWWsN..",
        "...NssssN...", "....NNNN....",
    ],
    'board': [
        "....NNNN....", "NNNNNyyNNNNN", "NKKKKKKKKKKN", "NKWWWWWWWWKN", "NKWggggggWKN",
        "NKWWWWWWWWKN", "NKWggggWWWKN", "NKWWWWWWWWKN", "NKKKKKKKKKKN", "NNNNNNNNNNNN",
    ],
    'hammer': [
        "NNNNNNNN", "NssGGGHN", "NsGGGGHN", "NNNNNNNN", "...NTN..",
        "...NTN..", "...NTN..", "...NTN..", "...NtN..", "...NtN..", "...NNN..",
    ],
    'heart': [".NN.NN.", "NRRNRRN", "NRWRRRN", "NRRRRRN", ".NRRRN.", "..NRN..", "...N..."],
    'heart_s': [".N.N.", "NRNRN", "NRRRN", ".NRN.", "..N.."],
    'box': [
        "NNNNNNNNNNN", "NBBBBBBBBBN", "NbNNNNNNNbN", "NbNWWWWWNbN", "NbNWWWWWNbN",
        "NbNNNNNNNbN", "NbbbbbbbbbN", "NNNNNNNNNNN",
    ],
    'growl': [".H.H.", "H.H.H"],
    'cup': [
        "....N..", "....N..", "...N...", ".NNNNN.", "NCCCCCN", "NNNNNNN",
        ".NCTCN.", ".NTTTN.", ".NTCTN.", ".NyyyN.", ".NyyyN.", "..NNN..",
    ],
    'bolt': ["..NN", ".NYN", "NYN.", "NYYN", ".NYN", ".NN."],
    'cloud': [
        "...NNN.......", "..NgggN.NN...", ".NgggggNggN..", "NgggggggggggN", "NgggggggggggN", ".NNNNNNNNNNN.",
    ],
    'rain': ["b", ".", "b"],
    'note': [".NN.", ".NKN", ".N.N", "NN..", "NN.."],
    'note_y': [".NN.", ".NYN", ".N.N", "NN..", "NN.."],
    'puff': [".ggg.", "gsWsg", "gsssg", ".ggg."],
    'puff_s': [".g.", "gsg", ".g."],
    'anger': [".R.R.", "RR.RR", ".....", "RR.RR", ".R.R."],
    'z': ["NNN", "..N", ".N.", "NNN"],
    'qmark': [".NN.", "N..N", "..N.", ".N..", "....", ".N.."],
    'ellipsis': ["N.N.N"],
    'snow': ["..b..", "b.b.b", ".bbb.", "b.b.b", "..b.."],
    'arrow': ["......NN.", "TTTTTTGGN", "......NN."],
    'drip': ["o", "O", "O"],
    'grill': [
        ".NNNNNNNNNNNNNNNNNNNN.", "NHHHHHHHHHHHHHHHHHHHHN", "NHPwPwPHHPwPwPHHPwPwPN", "NHpPpPpHHpPpPpHHpPpPpN",
        "NHHHHHHHHHHHHHHHHHHHHN", ".NNNNNNNNNNNNNNNNNNNN.", "..NN..............NN..", "..NN..............NN..",
    ],
    'steam': [".g.", "g..", ".g.", "..g", ".g."],
    'bucket': [
        "NNNNNNNNNNNNNNNNNNNNNNNN", "NBBbBBBBbBBBBBbBBBBBbBBN", "NGGGGGGGGGGGGGGGGGGGGGHN", ".NGsGGGGGGGGGGGGGGGGGHN.",
        ".NGsGGGGGGGGGGGGGGGGGHN.", ".NGGGGGGGGGGGGGGGGGGGHN.", ".NHHHHHHHHHHHHHHHHHHHHN.", ".NGsGGGGGGGGGGGGGGGGGHN.",
        ".NGGGGGGGGGGGGGGGGGGGHN.", "..NNNNNNNNNNNNNNNNNNNN..",
    ],
    'anvil': [
        "NNNNNNNNNNNNNNNN", "NKHHHHHHHHHHHHKN", ".NNKHHHHHHHHKNN.", "...NNKHHHHKNN...", ".....NKHHKN.....",
        "....NKHHHHKN....", "...NKKKKKKKKN...", "...NNNNNNNNNN...",
    ],
    'hotbar': ["NNNNNNNNNN", "NyYYYYYYON", "NOOOOOOODN", "NNNNNNNNNN"],
    'trophy': [
        "NNNNNNNNN", "NYYyYYYYN", "NYYyYYYDN", ".NYYYYDN.", "..NYYDN..", "...NDN...", "..NNNNN..", "..NDDDN..", "..NNNNN..",
    ],
}


def prop(name):
    return pix(PROPS[name])


def xmark_img():
    """반려 도장 자국: 빨간 원 + X."""
    n = 17
    im = blank(n, n)
    c = (n - 1) / 2
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - c, y - c)
            if 6.6 <= d <= 8.4:
                im.putpixel((x, y), rgba('R'))
    for i in range(5, 12):
        for dx in (0, 1):
            im.putpixel((i + dx - 0, i), rgba('R'))
            im.putpixel((n - 1 - i - dx, i), rgba('R'))
    return im


def mark_img():
    """결재 도장 자국: 두 줄 빨간 원 + 체크."""
    n = 17
    im = blank(n, n)
    c = (n - 1) / 2
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - c, y - c)
            if 6.6 <= d <= 8.4:
                im.putpixel((x, y), rgba('R'))
    for x, y in ((4, 8), (5, 9), (6, 10), (7, 11), (8, 10), (9, 9), (10, 8), (11, 7), (12, 6)):
        for dy in (0, 1):
            im.putpixel((x, y + dy - 1), rgba('R'))
    return im


def ring_burst(r, c_in='y', c_mid='Y', c_out='O', rays=12, length=5, phase=0.5):
    """가운데에서 퍼지는 불티 (반지름 r). 이미지 가운데가 터지는 자리."""
    size = 2 * (r + 2) + 1
    im = blank(size, size)
    cx = cy = size // 2
    colors = [c_in, c_mid, c_mid, c_out, c_out][:length]
    for k in range(rays):
        a = math.pi * 2 * (k + phase) / rays
        for j, c in enumerate(colors):
            x = round(cx + math.cos(a) * (r - j))
            y = round(cy + math.sin(a) * (r - j))
            if 0 <= x < size and 0 <= y < size and r - j >= 1:
                im.putpixel((x, y), rgba(c))
    return im


def coil_img(spin=0):
    """옆에서 본 코일 (지름 17): 감긴 줄과 가운데 구멍, 돌면 줄무늬가 돈다."""
    def m(x, y):
        return math.hypot(x - 8, y - 8) <= 8.2
    im = outlined(m, 17, 17, 'G')
    c = 9
    for y in range(im.height):
        for x in range(im.width):
            d = math.hypot(x - c, y - c)
            if im.getpixel((x, y))[3] and im.getpixel((x, y))[:3] != rgba('N')[:3]:
                if d < 3:
                    im.putpixel((x, y), rgba('K'))
                elif round(d) in (4, 6):
                    im.putpixel((x, y), rgba('H'))
                elif round(d) == 7 and (math.atan2(y - c, x - c) + spin) % (math.pi * 2) < 1.2:
                    im.putpixel((x, y), rgba('s'))
    for p in ((c - 1, c), (c, c - 1), (c + 1, c), (c, c + 1)):
        im.putpixel(p, rgba('N'))
    return im


def sun_img(rot=0):
    size = 17
    im = blank(size, size)
    c = 8
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - c, y - c)
            if d <= 4.2:
                im.putpixel((x, y), rgba('Y' if d < 3.2 else 'O'))
    for k in range(8):
        a = math.pi * 2 * k / 8 + rot
        for rr in (6, 7):
            im.putpixel((round(c + math.cos(a) * rr), round(c + math.sin(a) * rr)), rgba('Y'))
    return im


def roller_img(w, h, phase=0):
    """옆으로 누운 압연 롤 (원통): 회색 몸통에 도는 줄무늬."""
    def m(x, y):
        return True
    im = outlined(m, w, h, 'G')
    for x in range(1, w + 1):
        im.putpixel((x, 2), rgba('s'))
        im.putpixel((x, h - 1), rgba('H'))
        if (x + phase) % 6 == 0:
            for y in range(3, h - 1):
                im.putpixel((x, y), rgba('H'))
    return im


def roll_disc(phase=0):
    """정면에서 본 압연 롤 (원판, 지름 15)."""
    def m(x, y):
        return math.hypot(x - 7, y - 7) <= 7.2
    im = outlined(m, 15, 15, 'G')
    c = 8
    for k in range(3):
        a = phase + k * math.pi * 2 / 3
        for rr in range(2, 7):
            im.putpixel((round(c + math.cos(a) * rr), round(c + math.sin(a) * rr)), rgba('H'))
    for p in ((c, c), (c - 1, c), (c, c - 1), (c - 1, c - 1)):
        im.putpixel(p, rgba('K'))
    return im


def wall_img(w, h):
    """철판 벽: 회색 판 + 리벳."""
    im = outlined(lambda x, y: True, w, h, 'G')
    for x in range(1, w + 1):
        im.putpixel((x, 1), rgba('s'))
        im.putpixel((x, h), rgba('H'))
    for y in range(3, h - 1, 7):
        for x in (3, w - 2):
            im.putpixel((x, y), rgba('H'))
            im.putpixel((x, y + 1), rgba('K'))
    return im


def arms_x():
    """가슴 앞에서 X로 엇갈린 두 팔 (흰 장갑)."""
    def m(x, y):
        return abs(x - y * 1.25) <= 1.6 or abs((14 - x) - y * 1.25) <= 1.6
    im = outlined(m, 15, 11, 'W')
    for (x, y) in ((1, 1), (2, 1), (14, 1), (15, 1)):
        im.putpixel((x, y), rgba('s'))
    return im


def heat_glow(w, h):
    """달군 쇠 빛: 테두리만 주황."""
    return outlined(lambda x, y: True, w, h, 'O', line='Y')


PROC = {
    'mark': mark_img, 'xmark': xmark_img, 'coil': coil_img, 'sun': sun_img, 'roller': roller_img,
    'disc': roll_disc, 'wall': wall_img, 'arms_x': arms_x, 'burst_at': ring_burst,
}


class Sheet:
    def __init__(self, path):
        self.im = Image.open(path).convert('RGBA')

    def get(self, row, col):
        return self.im.crop((col * CELL, row * CELL, col * CELL + CELL, row * CELL + CELL))


# ── 몸 변형 ──────────────────────────────────────────────
HEAD_BOTTOM = 30   # 얼굴 아래 끝 줄 (펫 시트 공통)
HELMET_BOTTOM = 19
NAVY = rgba('N')[:3]


def nod(img, k, helmet_extra=0):
    """머리(0~30줄)만 k칸 내려 고개 숙임을 만든다. 몸은 그대로."""
    out = blank()
    out.alpha_composite(img.crop((0, HEAD_BOTTOM + 1, CELL, CELL)), (0, HEAD_BOTTOM + 1))
    head = img.crop((0, 0, CELL, HEAD_BOTTOM + 1))
    if helmet_extra:
        face = head.crop((0, HELMET_BOTTOM + 1, CELL, HEAD_BOTTOM + 1))
        helmet = head.crop((0, 0, CELL, HELMET_BOTTOM + 1))
        head = blank(CELL, HEAD_BOTTOM + 1)
        head.alpha_composite(face, (0, HELMET_BOTTOM + 1))
        head.alpha_composite(helmet, (0, helmet_extra))
    out.alpha_composite(head, (0, k))
    return out


def sway(img, head_dx, body_dx=0):
    """머리·몸을 옆으로 따로 옮겨 들썩임·기우뚱을 만든다 (회전 없이 도트를 그대로)."""
    out = blank(CELL + 8, CELL)
    out.alpha_composite(img.crop((0, HEAD_BOTTOM + 1, CELL, CELL)), (4 + body_dx, HEAD_BOTTOM + 1))
    out.alpha_composite(img.crop((0, 0, CELL, HEAD_BOTTOM + 1)), (4 + head_dx, 0))
    return out.crop((4, 0, 4 + CELL, CELL))


def flatten(img, ratio, widen=1.0):
    """바닥(46줄)에 붙인 채 납작하게."""
    w, h = round(CELL * widen), max(1, round(CELL * ratio))
    small = img.resize((w, h), Image.NEAREST)
    out = blank()
    out.alpha_composite(small.crop((max(0, (w - CELL) // 2), 0, max(0, (w - CELL) // 2) + min(w, CELL), h)),
                        (max(0, (CELL - w) // 2), 47 - h))
    return out


def stretch(img, ratio):
    """바닥에 붙인 채 위로 늘어남 (ratio > 1)."""
    h = round(CELL * ratio)
    big = img.resize((CELL, h), Image.NEAREST)
    out = blank()
    out.alpha_composite(big.crop((0, h - CELL, CELL, h)) if h > CELL else big, (0, 0 if h > CELL else CELL - h))
    return out


def shift(img, dx, dy):
    out = blank()
    out.paste(img, (dx, dy))
    return out


def helmet_off(img):
    """안전모를 떼어 낸다. 드러난 머리 위는 둥글게 그린다. (몸, 안전모) 두 장을 돌려준다."""
    helmet = blank()
    helmet.alpha_composite(img.crop((0, 0, CELL, HELMET_BOTTOM + 1)), (0, 0))
    body = blank()
    body.alpha_composite(img.crop((0, HELMET_BOTTOM + 1, CELL, CELL)), (0, HELMET_BOTTOM + 1))
    dome = [(19, 12, 35), (18, 13, 34), (17, 15, 32), (16, 18, 29)]
    for y, x0, x1 in dome:
        for x in range(x0, x1 + 1):
            body.putpixel((x, y), rgba('W'))
        body.putpixel((x0 - 1, y), rgba('N'))
        body.putpixel((x1 + 1, y), rgba('N'))
    for x in range(18, 30):
        body.putpixel((x, 15), rgba('N'))
    for x, y in ((16, 16), (17, 16), (30, 16), (31, 16), (14, 17), (33, 17)):
        body.putpixel((x, y), rgba('N'))
    return body, helmet


def _is_outline(c):
    return c[3] == 0 or (c[0] + c[1] + c[2]) < 150


def recolor(img, fn, rows=None):
    """외곽선(어두운 색)은 두고 나머지 색만 fn(r, g, b) → (r, g, b)로 바꾼다."""
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        if rows and not (rows[0] <= y <= rows[1]):
            continue
        for x in range(out.width):
            c = px[x, y]
            if not _is_outline(c):
                r, g, b = fn(c[0], c[1], c[2])
                px[x, y] = (max(0, min(255, int(r))), max(0, min(255, int(g))), max(0, min(255, int(b))), 255)
    return out


def mix(a, b, k):
    return tuple(a[i] + (b[i] - a[i]) * k for i in range(3))


def tint(img, color, k, rows=None, only_light=False):
    target = rgba(color)[:3]

    def fn(r, g, b):
        if only_light and (r + g + b) < 560:
            return r, g, b
        return mix((r, g, b), target, k)
    return recolor(img, fn, rows)


def silver(img):
    """은빛 강철: 밝기만 남기고 차가운 회색으로."""
    def fn(r, g, b):
        lum = 0.3 * r + 0.59 * g + 0.11 * b
        v = 120 + (lum - 120) * 1.1
        return v - 6, v, v + 14
    return recolor(img, fn)


def heat(img, k):
    """달군 쇠: 밝은 곳은 노랑, 나머지는 주황·빨강 쪽으로."""
    def fn(r, g, b):
        lum = (r + g + b) / 3
        hot = (255, 214, 102) if lum > 200 else (240, 112, 40) if lum > 120 else (200, 60, 40)
        return mix((r, g, b), hot, k)
    return recolor(img, fn)


def molten_bottom(img, from_row):
    """녹아내림: from_row 아래를 쇳물 주황으로."""
    def fn(r, g, b):
        return mix((r, g, b), (240, 120, 40), 0.85)
    out = recolor(img, fn, rows=(from_row, CELL))
    return out


# ── 얼굴 바꾸기 (기본 자세와 얼굴 자리가 같은 프레임만: 기본·깜빡·손 흔들기·생각·말하기) ──
EYE_BOX = {'L': (16, 22), 'R': (27, 22)}   # 5x5 칸 왼쪽 위
MOUTH_BOX = (21, 27)                         # 6x3
EYES = {
    'happy': [".....", ".NNN.", "N...N", ".....", "....."],
    'closed': [".....", ".....", ".NNN.", ".....", "....."],
    'squeeze': ["N....", ".NN..", "...N.", ".NN..", "N...."],
    'swirl': [".NNN.", "N...N", "N.N.N", "N.NN.", ".N..."],
    'heart': [".R.R.", "RRRRR", "RRRRR", ".RRR.", "..R.."],
    'x': ["N...N", ".N.N.", "..N..", ".N.N.", "N...N"],
    'dot': [".....", ".....", ".NN..", ".NN..", "....."],
    'wide': [".NNN.", "NWWNN", "NWNNN", "NNNNN", ".NNN."],
    'star': ["..Y..", ".YYY.", "YYYYY", ".YYY.", ".Y.Y."],
    'angry': ["N....", ".NN..", ".NNN.", ".NNN.", "....."],
    'tired': [".....", ".....", "NNNNN", ".NNN.", "....."],
    'cry': [".....", "NNNNN", "..N..", "..N..", "....."],
}
MOUTHS = {
    'smile': ["......", ".N..N.", "..NN.."],
    'open': [".NNNN.", ".NPPN.", "..NN.."],
    'o': ["..NN..", ".NPPN.", "..NN.."],
    'flat': ["......", ".NNNN.", "......"],
    'frown': ["......", "..NN..", ".N..N."],
    'wave': ["......", "N.NN.N", ".N..N."],
    'grit': ["NNNNNN", "NWWWWN", "NNNNNN"],
    'big': [".NNNN.", "NPPPPN", ".NNNN."],
    'drool': [".NNNN.", ".NPPN.", "..NN.."],
}


def face(img, eyes=None, mouth=None, dy=0):
    """눈·입을 지우고 새로 그린다. 오른쪽 눈은 왼쪽 무늬를 좌우로 뒤집어 쓴다."""
    out = img.copy()
    px = out.load()

    def erase(x0, y0, w, h, sample_x):
        for y in range(y0, y0 + h):
            fill = px[sample_x, y + dy] if px[sample_x, y + dy][3] else rgba('w')
            for x in range(x0, x0 + w):
                px[x, y + dy] = fill

    def draw(rows, x0, y0, mirror=False):
        for y, row in enumerate(rows):
            row = row[::-1] if mirror else row
            for x, c in enumerate(row):
                if c != '.':
                    px[x0 + x, y0 + y + dy] = rgba(c)

    if eyes:
        erase(16, 22, 5, 5, 15)
        erase(27, 22, 5, 5, 26)
        pattern = EYES[eyes]
        draw(pattern, *EYE_BOX['L'])
        draw(pattern, *EYE_BOX['R'], mirror=True)
    if mouth:
        erase(21, 27, 6, 3 if mouth not in ('smile', 'flat') else 2, 20)
        draw(MOUTHS[mouth], *MOUTH_BOX)
    return out


# ── 프레임·이모티콘 ──────────────────────────────────────
def fr(char, dur, back=(), front=(), shake=(0, 0), cx=0, char_at=(0, 0)):
    """한 프레임. 소품 (이름, x, y) 또는 ('img', x, y, 이미지) 또는 (함수 이름, x, y, 인자…). char=None이면 캐릭터 없음"""
    return {'char': char, 'char_at': char_at, 'dur': dur, 'back': list(back), 'front': list(front), 'shake': shake, 'cx': cx}


def emoticon(tag, key, text, color, frames, align='center', oy=None):
    """text는 한 줄(str) 또는 두 줄(list). 두 줄이면 캐릭터를 2칸 내린다 (oy로 바꿀 수 있음)."""
    lines = [text] if isinstance(text, str) else list(text)
    return {'tag': tag, 'key': key, 'lines': lines, 'color': color, 'align': align, 'frames': frames,
            'oy': oy if oy is not None else (ORIGIN[1] if len(lines) == 1 else 17)}


class Canvas:
    def __init__(self, s):
        self.im = Image.new('RGBA', (s, s), (0, 0, 0, 0))

    def put(self, src, x, y):
        # PIL alpha_composite는 음수 좌표를 못 받아서 잘라 붙인다.
        sx, sy = max(0, -x), max(0, -y)
        if sx >= src.width or sy >= src.height or x >= self.im.width or y >= self.im.height:
            return
        part = src.crop((sx, sy, min(src.width, sx + self.im.width - max(0, x)), min(src.height, sy + self.im.height - max(0, y))))
        self.im.alpha_composite(part, (max(0, x), max(0, y)))


def prop_image(p):
    name = p[0]
    if name == 'img':
        return p[3]
    if name in PROC:
        return PROC[name](*p[3:])
    return prop(name)


def place_props(canvas, props, origin):
    ox, oy = origin
    for p in props:
        if p[0] in ('burst', 'burst_dim'):
            # 몸 가운데(24, 26)에서 퍼지는 불꽃 (1차 '최고'와 같은 모양)
            im = ring_burst(p[1], c_out='D' if p[0] == 'burst_dim' else 'O')
            canvas.put(im, ox + 24 - im.width // 2, oy + 26 - im.height // 2)
            continue
        canvas.put(prop_image(p), ox + p[1], oy + p[2])


def outline_text(lines, color, align):
    """앤티에일리어싱 없는 굵은 글자 + 네이비 1px 외곽선 (도트처럼 보이게). 두 줄이면 10px로 줄여 안전모와 겹치지 않게."""
    size = 12 if len(lines) == 1 else 10
    font = ImageFont.truetype(FONT, size, index=FONT_INDEX)
    mask = Image.new('L', (SIZE, 30), 0)
    d = ImageDraw.Draw(mask)
    d.fontmode = '1'
    for i, text in enumerate(lines):
        l, t, r, _ = d.textbbox((0, 0), text, font=font)
        x = (SIZE - (r - l)) // 2 - l if align == 'center' else 3 - l
        d.text((x, 3 - t + i * 11), text, font=font, fill=255)
    grown = Image.new('L', mask.size, 0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            grown.paste(255, (0, 0), mask.transform(mask.size, Image.AFFINE, (1, 0, -dx, 0, 1, -dy)))
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(Image.new('RGBA', mask.size, rgba('N')), (0, 0), grown)
    out.paste(Image.new('RGBA', mask.size, rgba(color)), (0, 0), mask)
    return out


def render(E, workdir):
    frames_dir = os.path.join(workdir, 'frames')
    os.makedirs(frames_dir, exist_ok=True)
    plan = []  # (dur, {layer: path})
    tags = []
    for e in E:
        start = len(plan) + 1
        text_img = outline_text(e['lines'], e['color'], e['align'])
        for i, f in enumerate(e['frames']):
            o = (ORIGIN[0] + f['shake'][0], e['oy'] + f['shake'][1] + f['cx'])
            layers = {k: Canvas(SIZE) for k in LAYERS}
            place_props(layers['뒤효과'], f['back'], o)
            if f['char'] is not None:
                layers['캐릭터'].put(f['char'], o[0] + f['char_at'][0], o[1] + f['char_at'][1])
            place_props(layers['앞효과'], f['front'], o)
            layers['글자'].im = text_img
            paths = {}
            for k in LAYERS:
                if layers[k].im.getbbox() is None:
                    continue
                p = os.path.join(frames_dir, f"{e['key']}_{i:02d}_{LAYERS.index(k)}.png")
                layers[k].im.save(p)
                paths[k] = p
            plan.append((f['dur'], paths))
        tags.append((e['tag'], start, len(plan), e['key']))
    return plan, tags


def to_lua(plan, tags, out_path):
    lines = ['local ORDER = {' + ','.join(f'"{k}"' for k in LAYERS) + '}', 'local DATA = {']
    for dur, paths in plan:
        parts = ','.join(f'["{k}"]="{v}"' for k, v in paths.items())
        lines.append('{d=%g,%s},' % (dur / 1000, parts))
    lines.append('}')
    lines.append('local TAGS = {' + ','.join(f'{{"{n}",{a},{b}}}' for n, a, b, _ in tags) + '}')
    pal = '\n'.join('pal:setColor(%d, Color{r=%d,g=%d,b=%d})' % ((i,) + rgba(k)[:3]) for i, k in enumerate(PAL))
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
