"""24px steelman: AI assistant situation motions (2~3 variants each) -> Aseprite Lua.

usage: python3 gen_assistant.py <out.aseprite> <out.lua>
Layers: 배경(navy) · 그림자 · 외곽선(navy, for transparent export) · 몸 · 헬멧 · 표정 · 효과
"""
import sys

S = 24
PAL = {
    'N': '#1b2531', 'K': '#121922', 'O': '#e07028', 'D': '#af5d2a', 'L': '#f08a45',
    'W': '#ffffff', 'S': '#c9d3de', 'P': '#f5a3a3', 'B': '#8ec5f0',
    'Y': '#f5c542', 'G': '#8a96a3', 'C': '#bfe3f7', 'R': '#e5484d', 'E': '#3fb37f',
    'H': '#5b6675', 'Q': '#fff1b8', 'T': '#c98a4b',
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
# (left, right, height): height = bottom - top
BODY = {'n': (3, 20, 8), 's1': (2, 21, 7), 's2': (1, 22, 6), 's3': (0, 23, 5),
        't1': (4, 19, 9), 't2': (5, 18, 10)}
LAYERS = ['배경', '그림자', '외곽선', '몸', '헬멧', '표정', '효과']
OUTLINE_FROM = ['몸', '헬멧', '표정', '효과']

PROPS = {
    'q':        ["OO.", "..O", ".O.", "...", ".O."],
    'bang':     ["O", "O", "O", ".", "O"],
    'lock':     [".GGG.", "G...G", "YYYYY", "YYNYY", "YYNYY", "YYYYY"],
    'lock_s':   [".G.", "YYY", "YNY"],
    'check':    ["...E", "..E.", "E.E.", ".E.."],
    'gear_a':   [".G.G.", "GGGGG", ".GHG.", "GGGGG", ".G.G."],
    'gear_b':   ["..G..", ".GGG.", "GGHGG", ".GGG.", "..G.."],
    'bulb_off': [".SSS.", "SSSSS", "SSSSS", ".SSS.", ".GGG.", "..G.."],
    'bulb_on':  [".YYY.", "YYWYY", "YYYYY", ".YYY.", ".GGG.", "..G.."],
    'note':     ["..YY", "..Y.", "..Y.", "YYY.", "YY.."],
    'cone':     ["..O..", ".OOO.", ".WWW.", ".OOO.", "OWWWO", "OOOOO"],
    'puff':     [".S.", "SSS", ".S."],
    'puff_b':   ["SS.", "SSS", ".SS"],
    'star':     [".Y.", "YYY", ".Y."],
    'drop':     [".B.", "BBB", ".B."],
    'drop_t':   ["B", "B"],
    'hand':     ["WW", "WW", "SS"],
    'spark':    [".L.", "LWL", ".L."],
    'spark_y':  [".Y.", "YWY", ".Y."],
    'dot_y':    ["Y"],
    'lampR':    ["RR", "RR"],
    'lampD':    ["HH", "HH"],
    'rays':     ["Y....Y", "......", "Y....Y"],
    'sign':     ["GGGGGGG", "GYNYNYG", "GNYNYNG", "GYNYNYG", "GGGGGGG"] + ["...G..."] * 6,
    'sign_b':   ["GGGGGGG", "GNYNYNG", "GYNYNYG", "GNYNYNG", "GGGGGGG"] + ["...G..."] * 6,
    # 새 상황용 소품
    'arcs_a':   ["B.", ".B", ".B", "B."],
    'arcs_b':   ["B..", ".B.", "..B", "..B", ".B.", "B.."],
    'book_a':   ["TQQQQTQQQQT", "TQGGQTQGGQT", "TQQQQTQQQQT", "TQGGQTQGGQT", "TTTTTTTTTTT"],
    'book_b':   ["TQQQQTQQQQT", "TQGGQTQQGGT", "TQQQQTQQQQT", "TQGGQTQGQQT", "TTTTTTTTTTT"],
    'book_c':   ["TQQQQTT....", "TQGGQTQT...", "TQQQQTQQT..", "TQGGQTQGQT.", "TTTTTTTTTTT"],
    'book_s':   ["TTTT", "TQQT", "TQQT", "TTTT"],
    'box':      ["TT....TT", "TDKKKKDT", "DLLLLLLD", "DLLLLLLD", "DDDDDDDD"],
    'memo':     ["QQQQQ", "QHHHQ", "QQQQQ", "QHHQQ", "QQQQQ", "QHHHQ", "QQQQQ"],
    'memo_ok':  ["QQQQQ", "QHHHQ", "QQQQQ", "QHHQQ", "QQQQQ", "QEQHQ", "QQEQQ"],
    'memo_0':   ["TTTT.", "TQQTT", "TQQQT", "TQQQT", "TQQQT", "TQQQT", "TTTTT"],
    'memo_1':   ["QQQQQ", "QHHQQ", "QQQQQ", "QQQQQ", "QQQQQ", "QQQQQ", "QQQQQ"],
    'memo_2':   ["QQQQQ", "QHHHQ", "QQQQQ", "QHQQQ", "QQQQQ", "QQQQQ", "QQQQQ"],
    'memo_3':   ["QQQQQ", "QHHHQ", "QQQQQ", "QHHQQ", "QQQQQ", "QHQQQ", "QQQQQ"],
    'pencil':   ["....P", "...Y.", "..Y..", ".Y...", "N...."],
    'arrow':    ["..O.", "OOOO", "..O."],
    'hg_a':     ["GGGGG", "HYYYH", ".HYH.", "..Y..", ".H.H.", "H...H", "GGGGG"],
    'hg_b':     ["GGGGG", "H.Y.H", ".HYH.", "..Y..", ".HYH.", "HYYYH", "GGGGG"],
    'hg_c':     ["GGGGG", "H...H", ".H.H.", "..H..", ".HYH.", "HYYYH", "GGGGG"],
    'hg_flip':  ["GH.HG", "GYH.G", "GYYHG", "GYH.G", "GH.HG"],
    'xs':       ["R.R", ".R.", "R.R"],
}
SPINNER = [(2, 0), (4, 1), (4, 3), (2, 4), (0, 3), (0, 1)]


def blank():
    return [[None] * S for _ in range(S)]


def put(g, x, y, c):
    if 0 <= x < S and 0 <= y < S:
        g[y][x] = c


def stamp(g, pat, x0, y0):
    for j, row in enumerate(pat):
        for i, c in enumerate(row):
            if c != '.':
                put(g, x0 + i, y0 + j, c)


def background():
    g = blank()
    corner = [3, 2, 1]
    for y in range(S):
        t = corner[y] if y < 3 else corner[S - 1 - y] if y >= S - 3 else 0
        for x in range(t, S - t):
            g[y][x] = 'N'
    return g


def outline(L):
    """Navy 1px outline around everything except the background (4-neighbour)."""
    filled = [[any(L[k][y][x] for k in OUTLINE_FROM) for x in range(S)] for y in range(S)]
    g = blank()
    for y in range(S):
        for x in range(S):
            if filled[y][x]:
                continue
            for ddx, ddy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + ddx, y + ddy
                if 0 <= nx < S and 0 <= ny < S and filled[ny][nx]:
                    g[y][x] = 'N'
                    break
    return g


def frame(body='n', bottom=20, dx=0, eyes='open', eyes_r=None, ex=0, ey=0, mouth='smile',
          blush=True, hdx=0, hdy=0, props=(), lens=None, bar=None, bubble=None, spinner=None):
    left, right, h = BODY[body]
    left += dx; right += dx
    top = bottom - h
    L = {k: blank() for k in LAYERS}
    L['배경'] = background()
    air = max(0, 20 - bottom)
    for x in range(left + 1 + air * 2, right - air * 2):
        put(L['그림자'], x, 21, 'K')
    b = L['몸']
    for x in range(left + 1, right):
        put(b, x, top, 'W')
    for y in range(top + 1, bottom):
        for x in range(left, right + 1):
            put(b, x, y, 'W')
    for x in range(left + 1, right):
        put(b, x, bottom, 'S')
    for j, row in enumerate(HELMET):
        for x, c in enumerate(row):
            if c != '.':
                put(L['헬멧'], x + dx + hdx, top - len(HELMET) + j + hdy, c)

    f = L['표정']
    by = bottom
    lx, rx = 6 + dx, 16 + dx
    if body in ('s2', 's3'):
        lx, rx = lx - 1, rx + 1

    def eye(x0, kind):
        x0 += ex
        w3 = x0 - (1 if x0 < 11 + dx else 0)  # 3-wide eyes grow outward
        if kind == 'open':
            for y in range(by - 6 + ey, by - 3 + ey):
                put(f, x0, y, 'N'); put(f, x0 + 1, y, 'N')
        elif kind == 'big':
            for y in range(by - 7 + ey, by - 3 + ey):
                put(f, x0, y, 'N'); put(f, x0 + 1, y, 'N')
            put(f, x0, by - 7 + ey, 'W')
        elif kind in ('half', 'sad'):
            for y in (by - 5, by - 4):
                put(f, x0, y, 'N'); put(f, x0 + 1, y, 'N')
        elif kind == 'down':  # looking down
            for y in (by - 4, by - 3):
                put(f, x0, y, 'N'); put(f, x0 + 1, y, 'N')
        elif kind == 'closed':
            put(f, x0, by - 4, 'N'); put(f, x0 + 1, by - 4, 'N')
        elif kind == 'happy':
            put(f, x0 - 1, by - 4, 'N'); put(f, x0, by - 5, 'N')
            put(f, x0 + 1, by - 5, 'N'); put(f, x0 + 2, by - 4, 'N')
        elif kind == 'x':
            stamp(f, ["N.N", ".N.", "N.N"], w3, by - 6)
        elif kind.startswith('dizzy'):  # grey ring with a pupil running around it
            stamp(f, ["SSS", "S.S", "SSS"], w3, by - 6)
            px, py = [(1, 0), (2, 1), (1, 2), (0, 1)][int(kind[-1]) % 4]
            put(f, w3 + px, by - 6 + py, 'N')
        elif kind == 'sparkle':  # starry eyes
            stamp(f, [".N.", "NWN", ".N."], w3, by - 6)

    if eyes == 'squeeze':
        stamp(f, ["N.", ".N", "N."], lx, by - 6)
        stamp(f, [".N", "N.", ".N"], rx, by - 6)
    else:
        eye(lx, eyes)
        eye(rx, eyes_r or eyes)
    if eyes == 'sad':
        put(f, lx + 1, by - 6, 'N'); put(f, rx, by - 6, 'N')
    if blush:
        for x in (left + 1, left + 2, right - 2, right - 1):
            put(f, x, by - 3, 'P')
    cx = 11 + dx
    m = {
        'smile': [(cx - 1, by - 2), (cx + 2, by - 2), (cx, by - 1), (cx + 1, by - 1)],
        'grin':  [(cx - 2, by - 2), (cx + 3, by - 2)] + [(x, by - 1) for x in range(cx - 1, cx + 3)],
        'o':     [(cx, by - 2), (cx + 1, by - 2), (cx, by - 1), (cx + 1, by - 1)],
        'flat':  [(cx, by - 1), (cx + 1, by - 1)],
        'line':  [(x, by - 1) for x in range(cx - 1, cx + 3)],
        'frown': [(cx, by - 2), (cx + 1, by - 2), (cx - 1, by - 1), (cx + 2, by - 1)],
        'wavy':  [(cx - 1, by - 1), (cx, by - 2), (cx + 1, by - 1), (cx + 2, by - 2)],
        'side':  [(cx + 2, by - 2), (cx, by - 1), (cx + 1, by - 1)],
    }
    if mouth == 'open':
        for x in range(cx - 1, cx + 3):
            put(f, x, by - 2, 'N')
        put(f, cx - 1, by - 1, 'N'); put(f, cx + 2, by - 1, 'N')
        put(f, cx, by - 1, 'P'); put(f, cx + 1, by - 1, 'P')
    elif mouth == 'zip':
        stamp(f, PROPS['lock_s'], cx, by - 3)
    elif mouth:
        for x, y in m[mouth]:
            put(f, x, y, 'N')

    e = L['효과']
    if bubble is not None:
        if bubble == 'q' or bubble == 'x':  # taller bubble for a symbol
            rows = {0: (17, 20), 1: (16, 21), 2: (15, 22), 3: (15, 22), 4: (15, 22), 5: (16, 21)}
            for y, (a, c) in rows.items():
                for x in range(a, c + 1):
                    put(e, x, y, 'W')
            if bubble == 'q':
                stamp(e, ["NN.", "..N", ".N.", "...", ".N."], 17, 1)
            else:
                stamp(e, PROPS['xs'], 17, 1)
        else:  # thought bubble with 0~3 dots
            for y, (a, c) in {0: (17, 20), 1: (16, 21), 2: (16, 22), 3: (17, 21)}.items():
                for x in range(a, c + 1):
                    put(e, x, y, 'W')
            put(e, 14, 3, 'W')
            for i in range(bubble):
                put(e, 17 + i * 2, 2, 'N')
    if lens:  # magnifier; eyes stay visible through the lens
        mx, my = lens
        for j, row in enumerate([".GG.", "GCCG", "GCCG", ".GG."]):
            for i, c in enumerate(row):
                if c == '.':
                    continue
                x, y = mx + i, my + j
                if 0 <= x < S and 0 <= y < S and c == 'C' and f[y][x] == 'N':
                    put(e, x, y, 'N')
                else:
                    put(e, x, y, c)
        put(e, mx + 4, my + 4, 'T'); put(e, mx + 5, my + 5, 'T'); put(e, mx + 4, my + 3, 'G')
    if bar is not None:
        for x in range(5, 19):
            put(e, x, 22, 'H')
        for x in range(5, 5 + bar):
            put(e, x, 22, 'O')
    if spinner is not None:  # (x0, y0, step): six dots, bright head + fading tail
        sx, sy, step = spinner
        for i, (px, py) in enumerate(SPINNER):
            age = (step - i) % len(SPINNER)
            put(e, sx + px, sy + py, 'O' if age == 0 else 'L' if age == 1 else 'G')
    for name, x, y in props:
        stamp(e, PROPS[name], x, y)
    L['외곽선'] = outline(L)
    return L


F = frame


def siren(on, dy=0):
    return [('lampR' if on else 'lampD', 11, 1 + dy)] + ([('rays', 9, dy)] if on else [])


# (상황, 파일 이름, [(시안, 설명, [(frame, ms)])])
SITUATIONS = [
    ('생각 중', 'thinking', [
        ('A', '말풍선 점점점', [
            (F(ey=-1, mouth='flat', bubble=1), 250),
            (F(ey=-1, mouth='flat', bubble=2), 250),
            (F('s1', ey=-1, mouth='flat', bubble=3), 250),
            (F(ey=-1, mouth='flat', bubble=3), 250),
            (F(ey=-1, mouth='flat', bubble=0), 200),
        ]),
        ('B', '갸우뚱 두리번', [
            (F(ex=-1, ey=-1, mouth='side'), 450),
            (F('s1', ex=-1, ey=-1, mouth='side'), 250),
            (F(ey=-1, mouth='flat'), 200),
            (F(ex=1, ey=-1, mouth='side'), 450),
            (F('s1', ex=1, ey=-1, mouth='side'), 250),
            (F(ey=-1, mouth='flat'), 200),
        ]),
        ('C', '톱니바퀴', [
            (F(ex=1, ey=-1, mouth='flat', props=[('gear_a', 18, 1)]), 180),
            (F(ex=1, ey=-1, mouth='flat', props=[('gear_b', 18, 1)]), 180),
            (F('s1', ex=1, ey=-1, mouth='flat', props=[('gear_a', 18, 1)]), 180),
            (F(ex=1, ey=-1, mouth='flat', props=[('gear_b', 18, 1)]), 180),
            (F(eyes='closed', mouth='flat', props=[('gear_a', 18, 1)]), 120),
            (F(ex=1, ey=-1, mouth='flat', props=[('gear_b', 18, 1)]), 180),
        ]),
    ]),
    ('조회 중', 'searching', [
        ('A', '돋보기 훑기', [
            (F(ex=-1, mouth='o', lens=(4, 13)), 220),
            (F(mouth='o', lens=(8, 12)), 220),
            (F(ex=1, mouth='o', lens=(12, 12)), 220),
            (F(ex=1, mouth='o', lens=(15, 13)), 220),
            (F(mouth='o', lens=(11, 13)), 220),
            (F(ex=-1, mouth='o', lens=(7, 13)), 220),
        ]),
        ('B', '두리번 + 로딩바', [
            (F(ex=-1, mouth='flat', bar=2), 200),
            (F(ex=-1, mouth='flat', bar=4), 200),
            (F(mouth='flat', bar=6), 150),
            (F(ex=1, mouth='flat', bar=8), 200),
            (F(ex=1, mouth='flat', bar=11), 200),
            (F('s1', eyes='happy', mouth='smile', bar=14), 300),
        ]),
        ('C', '돋보기 반짝', [
            (F(eyes_r='big', mouth='o', lens=(15, 12)), 300),
            (F(eyes_r='big', mouth='o', lens=(15, 12), props=[('spark', 18, 10)]), 150),
            (F(eyes_r='big', mouth='o', lens=(15, 12)), 300),
            (F('s1', eyes_r='big', mouth='o', lens=(16, 13)), 250),
        ]),
    ]),
    ('문서 찾는 중', 'reading', [
        ('A', '책 넘기기', [
            (F(eyes='down', mouth=None, props=[('book_a', 6, 17)]), 350),
            (F(eyes='down', mouth=None, props=[('book_c', 6, 17)]), 120),
            (F(eyes='down', mouth=None, props=[('book_b', 6, 17)]), 350),
            (F('s1', eyes='closed', mouth=None, props=[('book_b', 6, 17)]), 100),
            (F(eyes='down', mouth=None, props=[('book_c', 6, 17)]), 120),
        ]),
        ('B', '책 들고 두리번', [
            (F(ex=-1, ey=-1, mouth='flat', props=[('book_s', 19, 14)]), 300),
            (F(ex=1, ey=-1, mouth='flat', props=[('book_s', 19, 13)]), 300),
            (F('s1', ex=1, mouth='o', props=[('book_s', 19, 14)]), 250),
            (F(ex=-1, ey=-1, mouth='flat', props=[('book_s', 19, 13)]), 300),
        ]),
        ('C', '책 + 돋보기', [
            (F(eyes='down', mouth='o', lens=(7, 14), props=[('book_a', 6, 17)]), 280),
            (F(eyes='down', mouth='o', lens=(11, 14), props=[('book_a', 6, 17)]), 280),
            (F(eyes='down', mouth='o', lens=(11, 14), props=[('book_b', 6, 17)]), 280),
            (F(eyes='down', mouth='o', lens=(7, 14), props=[('book_b', 6, 17)]), 280),
        ]),
    ]),
    ('듣는 중', 'listening', [
        ('A', '귀 기울이기', [
            (F(dx=-1, ex=1, mouth='smile', props=[('arcs_a', 21, 13)]), 300),
            (F(dx=-1, ex=1, mouth='smile', props=[('arcs_b', 21, 12)]), 300),
            (F(dx=-1, eyes='closed', mouth='smile', props=[('arcs_a', 21, 13)]), 100),
            (F(dx=-1, ex=1, mouth='smile', props=[('arcs_b', 21, 12)]), 300),
        ]),
        ('B', '끄덕 맞장구', [
            (F(mouth='smile'), 300),
            (F('s1', eyes='happy', mouth='smile', hdy=1), 160),
            (F(mouth='smile'), 300),
            (F('s1', eyes='happy', mouth='smile', hdy=1), 160),
        ]),
        ('C', '초롱초롱', [
            (F(eyes='big', mouth='o'), 300),
            (F(eyes='big', mouth='o', props=[('spark', 1, 6)]), 200),
            (F('s1', eyes='big', mouth='o'), 200),
            (F(eyes='big', mouth='o', props=[('spark', 20, 6)]), 200),
            (F(eyes='closed', mouth='o'), 90),
        ]),
    ]),
    ('찾았다', 'found', [
        ('A', '돋보기 번쩍', [
            (F(ex=1, mouth='o', lens=(14, 12)), 200),
            (F('s1', eyes='big', mouth='o', lens=(15, 13)), 100),
            (F('t1', bottom=19, eyes='sparkle', mouth='open', lens=(15, 10), props=[('bang', 21, 0), ('spark_y', 1, 5)]), 150),
            (F(eyes='sparkle', mouth='open', lens=(15, 11), props=[('bang', 21, 1)]), 250),
            (F(eyes='happy', mouth='grin', lens=(15, 11)), 400),
        ]),
        ('B', '반짝 점프', [
            (F(mouth='flat'), 200),
            (F('s1', eyes='big', mouth='o'), 100),
            (F('t1', bottom=18, eyes='sparkle', mouth='open', props=[('spark_y', 1, 3), ('spark_y', 19, 2)]), 140),
            (F('s2', eyes='sparkle', mouth='open', props=[('spark_y', 0, 6), ('spark_y', 20, 5)]), 100),
            (F(eyes='happy', mouth='grin', props=[('dot_y', 2, 4), ('dot_y', 21, 3)]), 400),
        ]),
        ('C', '쪽지 발견', [
            (F(eyes='down', mouth='flat', props=[('memo', 17, 22)]), 200),
            (F('s1', eyes='big', mouth='o', props=[('memo', 17, 18)]), 120),
            (F(eyes='sparkle', mouth='open', props=[('memo', 17, 14)]), 150),
            (F(eyes='happy', mouth='grin', props=[('memo', 17, 13), ('spark_y', 20, 10)]), 400),
        ]),
    ]),
    ('결과 0건', 'no_result', [
        ('A', '빈 상자', [
            (F(eyes='down', mouth='o', props=[('box', 8, 16)]), 350),
            (F(eyes='down', ex=-1, mouth='flat', props=[('box', 8, 16)]), 250),
            (F(eyes='down', ex=1, mouth='flat', props=[('box', 8, 16)]), 250),
            (F('s1', eyes='sad', mouth='frown', props=[('box', 8, 17)]), 500),
        ]),
        ('B', 'X 말풍선', [
            (F(ey=-1, mouth='flat'), 250),
            (F(ey=-1, mouth='o', bubble='x'), 300),
            (F('s1', eyes='closed', mouth='frown', bubble='x', props=[('drop_t', 3, 13)]), 300),
            (F('s1', eyes='closed', mouth='frown', bubble='x', props=[('drop_t', 3, 14)]), 500),
        ]),
        ('C', '빈 쪽지', [
            (F(eyes='down', mouth='flat', props=[('memo_0', 17, 13)]), 350),
            (F(dx=-1, eyes='closed', mouth='frown', props=[('memo_0', 17, 13)]), 140),
            (F(dx=1, eyes='closed', mouth='frown', props=[('memo_0', 17, 13)]), 140),
            (F(eyes='sad', mouth='frown', props=[('memo_0', 17, 14)]), 500),
        ]),
    ]),
    ('답 쓰는 중', 'writing', [
        ('A', '연필 사각사각', [
            (F(dx=-2, eyes='down', mouth='flat', props=[('memo_1', 17, 13), ('pencil', 18, 10)]), 200),
            (F(dx=-2, eyes='down', mouth='flat', props=[('memo_1', 17, 13), ('pencil', 20, 10)]), 200),
            (F(dx=-2, eyes='down', mouth='flat', props=[('memo_2', 17, 13), ('pencil', 18, 12)]), 200),
            (F(dx=-2, eyes='down', mouth='flat', props=[('memo_2', 17, 13), ('pencil', 19, 12)]), 200),
            (F(dx=-2, eyes='down', mouth='flat', props=[('memo_3', 17, 13), ('pencil', 18, 14)]), 200),
            (F('s1', dx=-2, eyes='happy', mouth='smile', props=[('memo_3', 17, 13), ('pencil', 20, 14)]), 250),
        ]),
        ('B', '말하며 점점점', [
            (F(mouth='open', bubble=1), 160),
            (F(mouth='smile', bubble=2), 160),
            (F('s1', mouth='o', bubble=3), 160),
            (F(mouth='open', bubble=3), 160),
            (F(mouth='smile', bubble=0), 160),
        ]),
    ]),
    ('답 완료', 'done', [
        ('A', '끄덕끄덕', [
            (F(mouth='smile'), 200),
            (F('s1', eyes='happy', mouth='smile', hdy=1), 150),
            (F(eyes='happy', mouth='smile'), 150),
            (F('s1', eyes='happy', mouth='smile', hdy=1), 150),
            (F(eyes='happy', mouth='grin'), 500),
        ]),
        ('B', '체크 뿅', [
            (F(mouth='smile'), 200),
            (F('s1', eyes='happy', mouth='open'), 100),
            (F('t1', eyes='happy', mouth='open', props=[('check', 18, 1)]), 120),
            (F(eyes='happy', mouth='grin', props=[('check', 18, 1), ('spark', 14, 0)]), 200),
            (F(eyes='happy', mouth='grin', props=[('check', 18, 1)]), 500),
        ]),
        ('C', '전구 반짝', [
            (F(ey=-1, mouth='flat', props=[('bulb_off', 17, 0)]), 300),
            (F('t1', eyes='big', mouth='o', props=[('bulb_on', 17, 0)]), 150),
            (F(eyes='happy', mouth='open', props=[('bulb_on', 17, 0), ('dot_y', 15, 1), ('dot_y', 22, 2), ('dot_y', 15, 5)]), 200),
            (F(eyes='happy', mouth='open', props=[('bulb_on', 17, 0)]), 200),
            (F(eyes='happy', mouth='grin', props=[('bulb_on', 17, 0), ('dot_y', 15, 1), ('dot_y', 22, 2), ('dot_y', 15, 5)]), 500),
        ]),
    ]),
    ('초안 확인 부탁', 'draft_review', [
        ('A', '서류 내밀기', [
            (F(dx=-2, mouth='smile'), 200),
            (F(dx=-2, mouth='smile', props=[('memo_ok', 20, 14)]), 120),
            (F(dx=-2, mouth='open', props=[('memo_ok', 18, 13)]), 200),
            (F('s1', dx=-2, eyes='closed', mouth='smile', hdy=1, props=[('memo_ok', 18, 14)]), 350),
            (F(dx=-2, eyes='happy', mouth='smile', props=[('memo_ok', 18, 13)]), 500),
        ]),
        ('B', '꾸벅 인사', [
            (F(mouth='smile'), 250),
            (F('s1', eyes='closed', mouth='smile', hdy=1), 150),
            (F('s2', eyes='closed', mouth='smile', hdy=2), 350),
            (F('s1', eyes='happy', mouth='smile', hdy=1), 150),
            (F(eyes='happy', mouth='grin'), 500),
        ]),
        ('C', '여기 봐주세요', [
            (F(dx=-2, ex=1, mouth='open', props=[('arrow', 19, 15)]), 200),
            (F(dx=-2, ex=1, mouth='smile', props=[('arrow', 20, 15)]), 200),
            (F(dx=-2, ex=1, mouth='open', props=[('arrow', 19, 15)]), 200),
            (F(dx=-2, eyes='happy', mouth='smile', props=[('arrow', 20, 15)]), 300),
        ]),
    ]),
    ('시간 초과', 'slow', [
        ('A', '모래시계', [
            (F(dx=-2, eyes='half', ex=1, mouth='flat', props=[('hg_a', 18, 13)]), 350),
            (F(dx=-2, eyes='half', ex=1, mouth='flat', props=[('hg_b', 18, 13), ('drop_t', 1, 12)]), 350),
            (F(dx=-2, eyes='half', ex=1, mouth='wavy', props=[('hg_c', 18, 13), ('drop_t', 1, 13)]), 350),
            (F(dx=-2, eyes='closed', mouth='wavy', props=[('hg_flip', 18, 14)]), 200),
        ]),
        ('B', '흐물흐물', [
            (F(eyes='half', mouth='flat'), 300),
            (F('s1', eyes='half', mouth='flat'), 300),
            (F('s2', eyes='closed', mouth='wavy', props=[('drop_t', 0, 14)]), 400),
            (F('s3', eyes='closed', mouth='wavy', props=[('drop_t', 0, 15)]), 600),
            (F('s2', eyes='half', mouth='flat'), 300),
        ]),
        ('C', '빙글 로딩', [
            (F(ex=1, ey=-1, mouth='flat', spinner=(18, 1, 0)), 120),
            (F(ex=1, ey=-1, mouth='flat', spinner=(18, 1, 1)), 120),
            (F(ex=1, ey=-1, mouth='flat', spinner=(18, 1, 2)), 120),
            (F(ex=1, ey=-1, mouth='wavy', spinner=(18, 1, 3), props=[('drop_t', 2, 12)]), 120),
            (F(ex=1, ey=-1, mouth='wavy', spinner=(18, 1, 4), props=[('drop_t', 2, 13)]), 120),
            (F(ex=1, ey=-1, mouth='flat', spinner=(18, 1, 5)), 120),
        ]),
    ]),
    ('확인할 수 없음', 'unknown', [
        ('A', '두리번 + 물음표', [
            (F(ex=-1, mouth='flat'), 300),
            (F(ex=1, mouth='flat'), 300),
            (F('t1', mouth='o', props=[('q', 19, 1)]), 150),
            (F(mouth='wavy', props=[('q', 19, 0)]), 300),
            (F(mouth='wavy', props=[('q', 19, 1)]), 500),
        ]),
        ('B', '물음표 말풍선', [
            (F(ey=-1, mouth='flat'), 250),
            (F(ey=-1, mouth='wavy', bubble='q'), 400),
            (F('s1', ey=-1, mouth='wavy', bubble='q'), 250),
            (F(ey=-1, mouth='wavy', bubble='q'), 500),
        ]),
        ('C', '머쓱 땀방울', [
            (F(mouth='smile'), 250),
            (F('s1', eyes='closed', mouth='wavy', props=[('drop', 20, 9)]), 300),
            (F('s1', eyes='closed', mouth='wavy', props=[('drop', 20, 10)]), 300),
            (F(eyes='happy', mouth='wavy', props=[('drop', 20, 11)]), 400),
            (F(eyes='happy', mouth='wavy'), 300),
        ]),
    ]),
    ('권한 밖 안내', 'no_permission', [
        ('A', '자물쇠 뿅', [
            (F(mouth='smile'), 200),
            (F('t1', eyes='big', mouth='o', props=[('lock', 18, 2)]), 150),
            (F(eyes='closed', mouth='frown', props=[('lock', 18, 1)]), 300),
            (F('s1', eyes='closed', mouth='frown', props=[('lock', 18, 1), ('drop_t', 3, 13)]), 300),
            (F('s1', eyes='closed', mouth='frown', props=[('lock', 18, 1), ('drop_t', 3, 14)]), 500),
        ]),
        ('B', '도리도리', [
            (F(eyes='closed', mouth='frown', props=[('lock_s', 20, 2)]), 200),
            (F(dx=-1, eyes='closed', mouth='frown', props=[('lock_s', 20, 2)]), 120),
            (F(dx=1, eyes='closed', mouth='frown', props=[('lock_s', 20, 2)]), 120),
            (F(dx=-1, eyes='closed', mouth='frown', props=[('lock_s', 20, 2)]), 120),
            (F(dx=1, eyes='closed', mouth='frown', props=[('lock_s', 20, 2)]), 120),
            (F(eyes='sad', mouth='frown', props=[('lock_s', 20, 2)]), 500),
        ]),
        ('C', '입에 자물쇠', [
            (F(mouth='smile'), 250),
            (F('s1', eyes='squeeze', mouth='zip'), 200),
            (F(eyes='sad', mouth='zip'), 400),
            (F(eyes='closed', mouth='zip'), 120),
            (F(eyes='sad', mouth='zip'), 500),
        ]),
    ]),
    ('오류', 'error', [
        ('A', '헬멧 펑', [
            (F(mouth='flat'), 200),
            (F('s2', eyes='x', mouth='o', hdy=-3, props=[('puff', 2, 6), ('puff_b', 19, 5)]), 150),
            (F('s1', eyes='x', mouth='o', hdy=-1, props=[('puff_b', 1, 4), ('puff', 20, 3)]), 150),
            (F(eyes='x', mouth='wavy', props=[('puff', 0, 2)]), 300),
            (F(eyes='x', mouth='wavy'), 500),
        ]),
        ('B', '빙글빙글', [
            (F(eyes='dizzy0', mouth='wavy', blush=False, props=[('star', 2, 1), ('star', 19, 2)]), 140),
            (F(eyes='dizzy1', mouth='wavy', blush=False, props=[('star', 4, 0), ('star', 17, 1)]), 140),
            (F('s1', eyes='dizzy2', mouth='wavy', blush=False, props=[('star', 6, 1), ('star', 15, 0)]), 140),
            (F(eyes='dizzy3', mouth='wavy', blush=False, props=[('star', 4, 2), ('star', 18, 0)]), 140),
        ]),
        ('C', '헬멧 삐뚤', [
            (F(mouth='flat'), 200),
            (F('s1', eyes='big', mouth='o', hdx=1, hdy=1), 150),
            (F(eyes='big', mouth='wavy', hdx=1, hdy=1, props=[('drop', 0, 12)]), 300),
            (F(eyes='big', mouth='wavy', hdx=1, hdy=1, props=[('drop', 0, 13)]), 300),
            (F(eyes='half', mouth='wavy', hdx=1, hdy=1), 400),
        ]),
    ]),
    ('준비 중', 'coming_soon', [
        ('A', '공사 표지판', [
            (F(dx=-2, mouth='smile', props=[('sign', 16, 10)]), 400),
            (F(dx=-2, eyes='happy', mouth='smile', props=[('sign_b', 16, 9)]), 400),
            (F('s1', dx=-2, mouth='smile', props=[('sign', 16, 10)]), 300),
            (F(dx=-2, eyes='closed', mouth='smile', props=[('sign_b', 16, 10)]), 100),
            (F(dx=-2, mouth='smile', props=[('sign', 16, 10)]), 400),
        ]),
        ('B', '라바콘', [
            (F(dx=-2, mouth='smile', props=[('cone', 18, 15)]), 400),
            (F('s1', dx=-2, eyes='happy', mouth='open', props=[('cone', 18, 15), ('drop_t', 1, 13)]), 300),
            (F(dx=-2, eyes='happy', mouth='smile', props=[('cone', 18, 15), ('drop_t', 1, 14)]), 300),
            (F(dx=-2, mouth='smile', props=[('cone', 18, 15)]), 400),
        ]),
        ('C', '경광등', [
            (F(mouth='line', props=siren(True)), 200),
            (F(mouth='line', props=siren(False)), 200),
            (F('s1', mouth='line', props=siren(True, 1)), 200),
            (F(mouth='line', props=siren(False)), 200),
            (F(eyes='closed', mouth='line', props=siren(True)), 120),
            (F(mouth='line', props=siren(False)), 200),
        ]),
    ]),
    ('인사', 'greet', [
        ('A', '뿅 등장', [
            (F(bottom=31, eyes='closed', mouth='flat'), 120),
            (F(bottom=27, eyes='closed', mouth='flat'), 90),
            (F('t2', bottom=21, mouth='o'), 90),
            (F('t1', bottom=18, eyes='happy', mouth='open', props=[('spark', 1, 4), ('spark', 20, 3)]), 120),
            (F('s2', eyes='happy', mouth='open'), 100),
            (F('s1', eyes='happy', mouth='grin'), 100),
            (F(eyes='happy', mouth='grin'), 600),
        ]),
        ('B', '통통 + 음표', [
            (F('s1', eyes='happy', mouth='open'), 120),
            (F('t1', bottom=18, eyes='happy', mouth='open', props=[('note', 1, 3)]), 150),
            (F('s1', eyes='happy', mouth='open', props=[('note', 1, 2)]), 120),
            (F('t1', bottom=18, eyes='happy', mouth='open', props=[('note', 1, 1)]), 150),
            (F('s2', eyes='happy', mouth='grin', props=[('note', 1, 1)]), 120),
            (F(eyes='happy', mouth='grin'), 500),
        ]),
        ('C', '손 흔들기', [
            (F(mouth='open', props=[('hand', 21, 13)]), 160),
            (F(mouth='open', props=[('hand', 21, 11)]), 160),
            (F(eyes='happy', mouth='open', props=[('hand', 21, 13)]), 160),
            (F(eyes='happy', mouth='open', props=[('hand', 21, 11)]), 160),
            (F(eyes='happy', mouth='grin', props=[('hand', 21, 14)]), 500),
        ]),
    ]),
]


def rgb(c):
    h = PAL[c].lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def all_tags():
    """[(태그 이름, 파일 이름, 설명, frames)]"""
    out = []
    for i, (ko, en, variants) in enumerate(SITUATIONS, 1):
        for v, desc, seq in variants:
            out.append((f'{ko} {v}', f'{i:02d}_{en}_{v}', desc, seq))
    return out


def to_lua(out):
    frames, tags = [], []
    for name, fname, desc, seq in all_tags():
        start = len(frames) + 1
        frames.extend(seq)
        tags.append((name, start, len(frames)))
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
        for name, fname, desc, seq in all_tags():
            fh.write(f'{name}\t{fname}\t{desc}\n')
