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
# 글자 글꼴: 한글 도트 글꼴 Galmuri (OFL-1.1, ../fonts/). 도트가 깨끗하게 나오는 크기에서만 쓴다
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts')
TEXT_MAX_W = 60
# (파일, 크기): 한 줄은 11 Bold → 넓으면 11 Condensed → 9, 두 줄은 9 → 넓으면 7
ONE_LINE_FONTS = [('Galmuri11-Bold.ttf', 12), ('Galmuri11-Condensed.ttf', 12), ('Galmuri9.ttf', 10)]
TWO_LINE_FONTS = [('Galmuri9.ttf', 10), ('Galmuri7.ttf', 8)]
BIG_FONT = ('Galmuri14.ttf', 15)  # 그린 뒤 2배


def galmuri(name, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size)


def pick_font(lines):
    """칸 폭(60px)에 들어가는 가장 큰 글꼴. 다 넘치면 가장 작은 것."""
    d = ImageDraw.Draw(Image.new('L', (1, 1)))
    for name, size in (ONE_LINE_FONTS if len(lines) == 1 else TWO_LINE_FONTS):
        font = galmuri(name, size)
        if max(d.textbbox((0, 0), t, font=font)[2] - d.textbbox((0, 0), t, font=font)[0] for t in lines) <= TEXT_MAX_W:
            return font
    return font


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
    # ── 3차 소품 ──
    'shaka': [
        ".NN.........",
        "NWWN........",
        "NWWN........",
        "NWWNNNNNN...",
        "NWWWWWWWWN..",
        "NWWNWNWNWN..",
        "NWWWWWWWWNNN",
        "NsWWWWWWWWWN",
        ".NsWWWWWWNNN",
        "..NssssssN..",
        "...NNNNNN...",
    ],
    'halo': [
        "...OOOOOOO...",
        ".OOYYYYYYYOO.",
        "OY.........YO",
        ".OOYYYYYYYOO.",
        "...OOOOOOO...",
    ],
    'cross': [
        "NNNNNNNNNNN", "NWWWWWWWWWN", "NWWWEEEWWWN", "NWWWEEEWWWN", "NWEEEEEEEWN", "NWEEEEEEEWN",
        "NWEEEEEEEWN", "NWWWEEEWWWN", "NWWWEEEWWWN", "NWWWWWWWWWN", "NNNNNNNNNNN",
    ],
    'calendar': [
        ".N..N...N..N.", "NNNNNNNNNNNNN", "NRRRRRRRRRRRN", "NNNNNNNNNNNNN", "NWWWWWWWWWWWN", "NWgWgWgWgWgWN",
        "NWWWWWWWWWWWN", "NWgWgWgWgWgWN", "NWWWWWWWWWWWN", "NWgWgWgWgWgWN", "NWWWWWWWWWWWN", "NNNNNNNNNNNNN",
    ],
    'circle_r': [".RRR.", "R...R", "R...R", "R...R", ".RRR."],
    'bowl': [
        "....NNNNNNN....",
        "..NNWWWWWWWNN..",
        ".NWWWWsWWWWWWN.",
        "NNNNNNNNNNNNNNN",
        "NTTTTTTTTTTTTTN",
        "NTyTTTTTTTTTTTN",
        ".NTTTTTTTTTTTN.",
        "..NtttttttttN..",
        "...NNNNNNNNN...",
    ],
    'noodle': [
        "....NNNNNNN....",
        "..NNYyYYyYYNN..",
        ".NYYyYYYyYYYYN.",
        "NNNNNNNNNNNNNNN",
        "NRRRRRRRRRRRRRN",
        "NRyRRRRRRRRRRRN",
        ".NRRRRRRRRRRRN.",
        "..NrrrrrrrrrN..",
        "...NNNNNNNNN...",
    ],
    'gimbap': [".NNNNN.", "NKKKKKN", "NKWWWKN", "NKWOEKN", "NKWWWKN", "NKKKKKN", ".NNNNN."],
    'spoon': [".NN.", "NssN", ".Ns.", ".Ns.", ".Ns.", "..N."],
    'chair': [
        "...NNNNNNNNN....", "...NKKKKKKKN....", "...NKHHHHHKN....", "...NKHHHHHKN....", "...NKHHHHHKN....",
        "...NKKKKKKKN....", "...NNNNNNNNN....", ".NNNNNNNNNNNNN..", ".NKKKKKKKKKKKN..", ".NNNNNNNNNNNNN..",
        ".......NN.......", ".......NN.......", "....NNNNNNNN....", "...N..N..N..N...",
    ],
    'briefcase': [
        "...NNNN...", "...N..N...", "NNNNNNNNNN", "NTTTTTTTTN", "NTTTyyTTTN", "NttttttttN", "NTTTTTTTTN", "NNNNNNNNNN",
    ],
    'phone': ["NNNN", "NCCN", "NCCN", "NCCN", "NKKN", "NNNN"],
    'pouch': [
        "...NNN...", "..NYYYN..", "...NRN...", "..NRRRN..", ".NRRYRRN.", "NRRYYYRRN",
        "NRRRYRRRN", "NRRRRRRrN", ".NrrrrrN.", "..NNNNN..",
    ],
    'tteokguk': [
        "..NNNNNNNNN..",
        ".NWWEWWWYWWN.",
        "NNNNNNNNNNNNN",
        "NbbbbbbbbbbbN",
        ".NbBbbbbbbbN.",
        "..NbbbbbbbN..",
        "...NNNNNNN...",
    ],
    'songpyeon': [
        "..NNN...NNN...NNN..",
        ".NPPPN.NEEEN.NWWWN.",
        "NPPPPPNEEEEENWWWWWN",
        "NNNNNNNNNNNNNNNNNNN",
        "NbbbbbbbbbbbbbbbbbN",
        ".NNNNNNNNNNNNNNNNN.",
    ],
    'chair_l': [
        ".....NNNNNNNNNNNN.....", ".....NKKKKKKKKKKN.....", ".....NKHHHHHHHHKN.....", ".....NKHHHHHHHHKN.....",
        ".....NKHHHHHHHHKN.....", ".....NKHHHHHHHHKN.....", ".....NKKKKKKKKKKN.....", ".....NNNNNNNNNNNN.....",
        "..NNNNNNNNNNNNNNNNNN..", "..NKKKKKKKKKKKKKKKKN..", "..NNNNNNNNNNNNNNNNNN..", "..........NN..........",
        "..........NN..........", "..........NN..........", ".....NNNNNNNNNNNN.....", "....N....N..N....N....",
    ],
    'tiny_cry': ["NNN.NNN", ".N...N.", ".N...N.", ".B...B.", ".B...B."],
    'cake': [
        "...N...N...N...", "...R...B...R...", ".NNNNNNNNNNNNN.", "NPPPPPPPPPPPPPN", "NWPWWPWWPWWPWWN",
        "NTTTTTTTTTTTTTN", "NTTTTTTTTTTTTTN", "NPPPPPPPPPPPPPN", "NTTTTTTTTTTTTTN", "NNNNNNNNNNNNNNN",
    ],
    'flames': ["...Y...Y...Y..."],
    'flames2': ["...O...O...O..."],
    'snowcap': [
        "....NNNNNNNN....",
        "..NNWWWWWWWWNN..",
        ".NWWWWWWWWWWWWN.",
        "NWWsWWWWWWWWsWWN",
    ],
    'cloud_dark': [
        "...NNN.......", "..NHHHN.NN...", ".NHHHHHNHHN..", "NHHHHHHHHHHHN", "NHHHHHHHHHHHN", ".NNNNNNNNNNN.",
    ],
    'ice_cup': [
        "....N..", "....N..", "...N...", ".NNNNN.", "NCCCCCN", "NNNNNNN",
        ".NCWCN.", ".NTCTN.", ".NTTTN.", ".NTCTN.", ".NTTTN.", "..NNN..",
    ],
    'xsmall': ["R...R", ".R.R.", "..R..", ".R.R.", "R...R"],
    'excl': ["N", "N", "N", ".", "N"],

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
    # ── 4차 소품 ──
    'qmark_l': [
        ".NNNNN.", "NWWWWWN", "NWNNNWN", "NNN.NWN", "...NWWN", "..NWWN.", "..NWN..", "..NNN..", "..NNN..",
        "..NWN..", "..NNN..",
    ],
    'flag_w': [
        "NNNNNNNNN", "NWWWWWWWN", "NWWWWWWsN", "NWWWWWWWN", "NWWWWWsN.", "NNNNNNNN.",
        "NT.......", "NT.......", "NT.......", "NT.......", "NT.......", "Nt.......", "NN.......",
    ],
    'flag_w2': [
        "NNNNNNN..", "NWWWWWWNN", "NWWWWWWWN", "NWWWWWsWN", "NWWWWWWN.", "NNNNNNNN.",
        "NT.......", "NT.......", "NT.......", "NT.......", "NT.......", "Nt.......", "NN.......",
    ],
    'mic': [".NNN.", "NKHKN", "NHKHN", "NKHKN", ".NNN.", "..N..", "..N..", "..N..", ".NNN."],
    'yell': ["..N", ".N.", "...", "NN.", "...", ".N.", "..N"],
    'cup_hands': ["NN......NN", "NWN....NWN", "NWN....NWN", ".NN....NN."],
    # ── 5차 소품 ──
    'envelope': [
        "NNNNNNNNNNNNN", "NWWNWWWWWNWWN", "NWWWNWWWNWWWN", "NWWWWNNNWWWWN", "NEEEEEEEEEEEN", "NEEEeEEEeEEEN",
        "NWWWWWWWWWWWN", "NNNNNNNNNNNNN",
    ],
    'clock': [
        "...NNNNN...", "..NWWWWWN..", ".NWWWNWWWN.", "NWWWWNWWWWN", "NWWWWNWWWWN", "NWWWWNWWWWN",
        "NWWWWNWWWWN", "NWWWWNWWWWN", ".NWWWWWWWN.", "..NWWWWWN..", "...NNNNN...",
    ],
    'checklist': [
        "NNNNNNNNNN", "NWWWWWWWWN", "NgNWggggWN", "NWWWWWWWWN", "NgNWggggWN", "NWWWWWWWWN",
        "NgNWggggWN", "NWWWWWWWWN", "NNNNNNNNNN",
    ],
    'tick': ["...E", "E.E.", ".E.."],
    'glasses': ["NNNNNNN...NNNNNNN", "NCCCCWN...NCCCCWN", "NCCCCCNNNNNCCCCCN", "NNNNNNN...NNNNNNN"],
    'sunglasses': ["NNNNNNN...NNNNNNN", "NKKKKWN...NKKKKWN", "NKKKKKNNNNNKKKKKN", ".NNNNN.....NNNNN."],
    'straw_hat': [
        ".......NNNNNNN.......", ".....NNYYYYYYYNN.....", "....NYYYYYYYYYYYN....", "....NRRRRRRRRRRRN....",
        "NNNNNYYYYYYYYYYYNNNNN", "NYYYYYYYYYYYYYYYYYYYN", ".NNNNNNNNNNNNNNNNNNN.",
    ],
    'suitcase': [
        "...NNNN...", "...N..N...", "NNNNNNNNNN", "NBBBBBBBbN", "NBBBBBBBbN", "NbbbbbbbbN",
        "NBBBBBBBbN", "NBBBBBBBbN", "NNNNNNNNNN", ".N......N.",
    ],
    'santa_hat': [
        "..................NN", ".................NWWN", "..........NNNNNNNWWN", ".......NNNRRRRRRNNN.",
        ".....NNRRRRRRRRRRN..", "....NRRRRRRRRRRRRRN.", "..NNWWWWWWWWWWWWWWNN", ".NWWWWWWWWWWWWWWWWWWN", "..NNNNNNNNNNNNNNNNNN.",
    ],
    'icicle': ["NNNNNNNNNNNNN", "NCBNCBNCCNCBN", ".NC.NB.NC.NB.", ".N...N..N..N."],
    'box_ship': [
        "NNNNNNNNNNNNN", "NTTTTTyTTTTTN", "NTTTTTyTTTTTN", "NNNNNNNNNNNNN", "NTTTTTTTTTTTN", "NTTTTTTTTTEEN",
        "NTTTTTTTTEETN", "NtttEtttEEtTN", "NTTTTEEEETTTN", "NTTTTTEETTTTN", "NtttttttttttN", "NNNNNNNNNNNNN",
    ],
    'lamp': [
        "..NNNNN...", ".NYYYYYN..", "NYYYYYYYN.", "NNNNNNNNN.", "....NN....", "....NN....", "....NN....", "..NNNNNN..",
    ],
    'popper': [
        "......NN", ".....NRN", "....NRYN", "...NRRN.", "..NYRN..", ".NRRN...", "NRYN....", "NNN.....",
    ],
    'glass': [".NNNNN.", "NWWWWWN", "NYYYYYN", "NYyYYYN", "NYYYYYN", ".NYYYN.", "..NYN..", "..NYN..", ".NNNNN."],
    'window': [
        "NNNNNNNNNNNNNNN", "NCCCCCCNCCCCCCN", "NCCWWCCNCCCCCCN", "NCWWWWCNCCCCCCN", "NCCCCCCNCCCCCCN", "NNNNNNNNNNNNNNN",
        "NCCCCCCNCCCCCCN", "NCCCCCCNCCCCCCN", "NCCCCCCNCCCCCCN", "NNNNNNNNNNNNNNN",
    ],
    'blush': ["PP.......PP"],
    'clap': [".N.N.N.", "NWNWNWN", "NWWWWWN", "NsWWWsN", ".NNNNN."],
    'helmet_stripe': ["YYYYYYY"],
    'salute': ["..NNN.", ".NWWWN", "NWWWWN", "NWWWsN", ".NssN.", "..NN.."],
    'cart': [
        "N..................", "N..................", "NNNNNNNNNNNNNNNNNNN", "NGGGGGGGGGGGGGGGGGN",
        "NNNNNNNNNNNNNNNNNNN", "..NNN.........NNN..", ".NKHKN.......NKHKN.", "..NNN.........NNN..",
    ],
    'moon_s': [".NNN.", "NYYN.", "NYN..", "NYYN.", ".NNN."],
    # ── 6차 소품 ──
    'sheep': [
        "..NNNN.......", ".NWWWWNNNN...", "NWWWWWWNssN..", "NWWWWWWNsNsN.", "NWWWWWWWNssN.", ".NWWWWWWNNN..",
        "..NNNNNNN....", "..NN..NN.....",
    ],
    'goreum': ["NNNN", "NRRN", ".NRN", ".NRN", "NRRN", "NN.."],
    'dot_on': [".NNN.", "NEEEN", "NELEN", "NEEEN", ".NNN."],
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


def mark_img(color='R'):
    """결재 도장 자국: 원 + 체크 (기본 빨강, 합격은 초록)."""
    n = 17
    im = blank(n, n)
    c = (n - 1) / 2
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - c, y - c)
            if 6.6 <= d <= 8.4:
                im.putpixel((x, y), rgba(color))
    for x, y in ((4, 8), (5, 9), (6, 10), (7, 11), (8, 10), (9, 9), (10, 8), (11, 7), (12, 6)):
        for dy in (0, 1):
            im.putpixel((x, y + dy - 1), rgba(color))
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


def thought_bubble(inner=None):
    """생각 풍선 (17x13) + 아래로 작은 동그라미 둘. inner는 가운데 넣을 그림."""
    def m(x, y):
        return ((x - 8) / 8.3) ** 2 + ((y - 4.5) / 4.8) ** 2 <= 1
    body = outlined(m, 17, 10, 'W')
    im = blank(body.width, body.height + 6)
    im.alpha_composite(body, (0, 0))
    for (x, y) in ((4, 12), (5, 12), (4, 13), (5, 13)):
        im.putpixel((x, y), rgba('W'))
    for (x, y) in ((3, 12), (6, 12), (3, 13), (6, 13), (4, 11), (5, 11), (4, 14), (5, 14)):
        im.putpixel((x, y), rgba('N'))
    im.putpixel((2, 16), rgba('N'))
    if inner is not None:
        im.alpha_composite(inner, ((body.width - inner.width) // 2, (body.height - inner.height) // 2))
    return im


def plate_img(bend):
    """철판 (20x4): bend칸만큼 가운데가 아래로 휨."""
    w, h = 20, 4
    im = blank(w + 2, h + bend + 2)
    for x in range(w):
        dy = round(bend * (1 - abs(x - (w - 1) / 2) / ((w - 1) / 2)))
        for y in range(h):
            im.putpixel((x + 1, y + 1 + dy), rgba('s' if y == 0 else 'G' if y < h - 1 else 'H'))
        im.putpixel((x + 1, dy), rgba('N'))
        im.putpixel((x + 1, h + 1 + dy), rgba('N'))
    for y in range(h + 2):
        im.putpixel((0, y), rgba('N'))
        im.putpixel((w + 1, y), rgba('N'))
    return im


def moon_img():
    def m(x, y):
        return math.hypot(x - 6, y - 6) <= 6.2
    im = outlined(m, 13, 13, 'Y')
    for (x, y) in ((4, 5), (5, 5), (8, 8), (9, 8), (8, 9)):
        im.putpixel((x + 1, y + 1), rgba('o'))
    return im


def confetti(seed, n=14, w=60, h=40):
    """꽃가루: 정해진 seed로 흩어진 색종이 조각."""
    import random
    r = random.Random(seed)
    im = blank(w, h)
    for _ in range(n):
        x, y = r.randrange(w - 2), r.randrange(h - 1)
        c = r.choice('RYEBVP')
        im.putpixel((x, y), rgba(c))
        im.putpixel((x + 1, y), rgba(c))
    return im


def ghost(img, rows_keep=38):
    """지박령: 다리 대신 물결 꼬리, 창백한 하늘색."""
    pale = tint(img, 'C', 0.55)
    out = blank()
    out.alpha_composite(pale.crop((0, 0, CELL, rows_keep)), (0, 0))
    for x in range(11, 37):
        wave = (x // 3) % 2
        for y in range(rows_keep, rows_keep + 3 + wave):
            out.putpixel((x, y), rgba('C'))
        out.putpixel((x, rows_keep + 3 + wave), rgba('N'))
    for y in range(rows_keep - 4, rows_keep + 4):
        out.putpixel((10, y), rgba('N'))
        out.putpixel((37, y), rgba('N'))
    return out


def heat_glow(w, h):
    """달군 쇠 빛: 테두리만 주황."""
    return outlined(lambda x, y: True, w, h, 'O', line='Y')


PROC = {
    'bubble': thought_bubble, 'plate': plate_img, 'moon': moon_img, 'confetti': confetti,
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


def big_text(text, color):
    """'글자만 크게': Galmuri14 15px에 1px 외곽선을 두른 뒤 정확히 2배로 키운다 (굵은 외곽선이 획 사이를 메우지 않게)."""
    font = galmuri(*BIG_FONT)
    mask = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    d.fontmode = '1'
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    d.text((2 - l, 2 - t), text, font=font, fill=255)
    grown = Image.new('L', mask.size, 0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            grown.paste(255, (0, 0), mask.transform(mask.size, Image.AFFINE, (1, 0, -dx, 0, 1, -dy)))
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(Image.new('RGBA', mask.size, rgba('N')), (0, 0), grown)
    out.paste(Image.new('RGBA', mask.size, rgba(color)), (0, 0), mask)
    out = out.crop(out.getbbox())
    return out.resize((out.width * 2, out.height * 2), Image.NEAREST)


def glitch(img, seed):
    """오류: 두 띠를 옆으로 밀고 빨강·파랑으로 물들인다 (화면이 깨지듯)."""
    import random
    r = random.Random(seed)
    rows = sorted(r.sample(range(4, 44), 4))
    out = img.copy()
    for (y0, y1) in ((rows[0], rows[1]), (rows[2], rows[3])):
        band = tint(img.crop((0, y0, CELL, y1)), r.choice('Rb'), 0.5)
        dx = r.choice((-3, -2, 2, 3))
        out.paste(Image.new('RGBA', (CELL, y1 - y0), (0, 0, 0, 0)), (0, y0))
        out.alpha_composite(band.crop((max(0, -dx), 0, CELL - max(0, dx), y1 - y0)), (max(0, dx), y0))
    return out


def bars_img(heights, colors='bEO'):
    """막대그래프: 높이 목록 → 바닥에 붙은 막대들."""
    h = max(heights) + 2
    w = len(heights) * 6 + 1
    im = blank(w, h + 1)
    for i, bh in enumerate(heights):
        if bh <= 0:
            continue
        bar = outlined(lambda x, y: True, 3, bh, colors[i % len(colors)])
        im.alpha_composite(bar, (1 + i * 6, h + 1 - bar.height))
    for x in range(w):
        im.putpixel((x, h), rgba('N'))
    return im


def stream_img(length, phase=0):
    """출선: 위에서 아래로 흘러내리는 쇳물 줄기 (폭 5)."""
    im = blank(7, length)
    for y in range(length):
        for x in range(1, 6):
            c = 'y' if x == 3 else 'Y' if (y + phase) % 4 < 2 else 'O'
            im.putpixel((x, y), rgba(c))
        im.putpixel((0, y), rgba('D'))
        im.putpixel((6, y), rgba('D'))
    return im


def coil_dog(frame=0):
    """조연 '코일이': 돌돌 말린 코일 몸에 귀·눈·다리·꼬리."""
    body = coil_img(spin=frame * 0.8)
    im = blank(30, 24)
    im.alpha_composite(body, (6, 3))
    ear = pix(["NN.", "NTN", "NTTN", ".NN."])
    im.alpha_composite(ear, (6, 1))
    im.alpha_composite(flip(ear), (19, 1))
    for (x, y) in ((11, 10), (17, 10)):
        im.putpixel((x, y), rgba('N'))
        im.putpixel((x, y + 1), rgba('N'))
    for x in (13, 14, 15):
        im.putpixel((x, 14), rgba('N'))
    im.putpixel((14, 13), rgba('K'))
    legs = 1 if frame % 2 else 0
    for lx in (9 + legs, 19 - legs):
        for y in (21, 22):
            im.putpixel((lx, y), rgba('N'))
            im.putpixel((lx + 1, y), rgba('N'))
    tail = [(26, 9), (27, 8), (28, 7)] if frame % 2 else [(26, 11), (27, 11), (28, 10)]
    for p in tail:
        im.putpixel(p, rgba('N'))
    return im


def slab_cat(k=1.0, eyes_open=True):
    """조연 '슬래브 냥이': 납작한 회색 슬래브 몸에 귀·눈·꼬리. k만큼 옆으로 늘어난다."""
    w = round(24 * k)
    h = max(5, round(9 / k))
    im = blank(w + 8, h + 10)
    body = outlined(lambda x, y: True, w, h, 'G')
    for x in range(1, w + 1):
        body.putpixel((x, 1), rgba('s'))
        body.putpixel((x, h), rgba('H'))
    im.alpha_composite(body, (2, 8))
    ear = pix(["..N.", ".NGN", "NGGN"])
    im.alpha_composite(ear, (4, 6))
    im.alpha_composite(ear, (11, 6))
    ey = 8 + 1 + max(1, h // 3)
    for x in (7, 12):
        im.putpixel((x, ey), rgba('N'))
        if eyes_open:
            im.putpixel((x, ey + 1), rgba('N'))
    im.putpixel((9, ey + 2), rgba('p'))
    for i in range(5):
        im.putpixel((w + 3 + min(i, 2), 8 + h - i), rgba('N'))
    return im


PROC.update({'bars': bars_img, 'stream': stream_img, 'dog': coil_dog, 'cat': slab_cat})


def hanbok(img, jacket='P', pants='b'):
    """한복: 작업복 윗도리(31~39줄)는 저고리 색으로, 바지(40~44줄)는 바지 색으로 (손·외곽선은 그대로)."""
    def fn_for(color):
        target = rgba(color)[:3]

        def fn(r, g, b):
            lum = (r + g + b) / 3
            base = mix(target, (255, 255, 255), 0.25) if lum > 170 else target if lum > 90 else mix(target, (0, 0, 0), 0.25)
            return base
        return fn
    out = img.copy()
    top = recolor(img.crop((13, 31, 35, 40)), fn_for(jacket))
    out.paste(top, (13, 31))
    bottom = recolor(img.crop((13, 40, 35, 45)), fn_for(pants))
    out.paste(bottom, (13, 40))
    return out


def stretch_wide(img, k):
    """바닥에 붙인 채 옆으로 늘어남. 칸보다 넓어지므로 char_at=((CELL - w) // 2, 0)으로 가운데에 놓는다."""
    w = round(CELL * k)
    return img.resize((w, CELL), Image.NEAREST)


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
    # 눈동자를 한쪽으로 굴림: 두 눈이 같은 쪽을 봐야 해서 좌우로 뒤집지 않는다
    'look_l': [".....", "NN...", "NN...", "NN...", "....."],
    'look_r': [".....", "...NN", "...NN", "...NN", "....."],
}
NO_MIRROR = {'look_l', 'look_r'}
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
        draw(pattern, *EYE_BOX['R'], mirror=eyes not in NO_MIRROR)
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
    """도트 글꼴 글자 + 네이비 1px 외곽선. 두 줄이면 작은 글꼴로 줄여 안전모와 겹치지 않게."""
    font = pick_font(lines)
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
