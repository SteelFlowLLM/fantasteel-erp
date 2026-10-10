"""묶음 '철강맨 일상' (steelman-daily): 2차 19종 (동기끼리 주고받는 재미용 + 철강 말장난), 3차 14종, 4차 6종(요즘 말투 밈), 5차 26종. 키는 shared MESSAGE_EMOTICONS와 같다."""
from PIL import Image

from emoticon_lib import (
    emoticon, face, flatten, flip, fr, ghost, heat, helmet_off, molten_bottom, nod, pix, prop, ring_burst,
    roller_img, silver, stretch, sway, tint, wall_img, stretch_wide, CELL, big_text, glitch, helmet_off, shift,
)


def build(sh):
    G = sh.get
    idle = G(0, 0)
    happy = [G(4, i) for i in range(6)]
    wave1, wave2 = G(5, 1), G(5, 2)
    fall0, fall1 = G(9, 0), G(9, 1)
    land0 = G(10, 0)
    sleep = [G(11, i) for i in range(4)]
    sur0, sur1 = G(12, 0), G(12, 1)

    E = []

    # 멘붕: 눈이 빙글, 안전모가 튕겨 올라 돌다가 삐뚤게 내려앉음
    dizzy = face(idle, eyes='swirl', mouth='wave')
    body, helmet = helmet_off(dizzy)
    E.append(emoticon('멘붕', 'steelman-panic', '멘붕', 'W', [
        fr(idle, 120),
        fr(dizzy, 80, shake=(1, 0)),
        fr(dizzy, 80, shake=(-1, 0)),
        fr(body, 90, front=[('img', 0, -6, helmet)], shake=(1, 0)),
        fr(body, 90, front=[('img', 0, -8, flip(helmet))], shake=(-1, 0)),
        fr(body, 110, front=[('img', 0, -9, helmet), ('ellipsis', 36, 14)]),
        fr(body, 110, front=[('img', 0, -8, flip(helmet)), ('ellipsis', 36, 14)]),
        fr(body, 90, front=[('img', 0, -4, helmet), ('ellipsis', 36, 14)]),
        fr(dizzy, 700, front=[('img', 2, 1, helmet), ('ellipsis', 38, 14)], char_at=(0, 0)),
    ]))

    # ㅋㅋㅋ: ^^ 눈으로 좌우로 들썩, 웃음 눈물
    lol = face(idle, eyes='happy', mouth='big')
    seq = [(-2, -1, 0), (2, 1, -1), (-2, -1, 0), (2, 1, -1), (-1, 0, 0), (1, 0, -1)]
    E.append(emoticon('ㅋㅋㅋ', 'steelman-lol', 'ㅋㅋㅋ', 'W', [
        fr(sway(lol, h, b), 90, cx=c, front=[('drop', 13 + h, 25), ('drop', 34 + h, 25)] if i % 2 else [])
        for i, (h, b, c) in enumerate(seq)
    ] + [fr(lol, 300, front=[('drop', 13, 26), ('drop', 34, 26)])]))

    # 사랑해요: 하트 눈으로 손 흔들고, 하트가 퐁퐁
    lw1, lw2 = face(wave1, eyes='heart'), face(wave2, eyes='heart')
    E.append(emoticon('사랑해요', 'steelman-love', '사랑해요', 'P', [
        fr(lw1, 150, front=[('heart_s', 42, 14)]),
        fr(lw2, 150, front=[('heart', 41, 8), ('heart_s', 4, 18)]),
        fr(lw1, 150, front=[('heart', 42, 2), ('heart_s', 2, 12)]),
        fr(lw2, 150, front=[('heart', 43, -4), ('heart_s', 1, 6), ('heart_s', 42, 16)]),
        fr(lw1, 150, front=[('heart_s', 0, 0), ('heart', 40, 9)]),
        fr(lw2, 400, front=[('heart', 41, 3), ('heart_s', 3, 14)]),
    ]))

    # 배고파: 빈 도시락 들고 흐물, 배에서 꼬르륵
    sad = face(idle, eyes='tired', mouth='wave')
    E.append(emoticon('배고파', 'steelman-hungry', '배고파', 'W', [
        fr(flatten(sad, 0.96, 1.02), 220, front=[('box', -2, 34)]),
        fr(flatten(sad, 0.92, 1.05), 220, front=[('box', -2, 35), ('growl', 33, 37)]),
        fr(flatten(sad, 0.9, 1.06), 220, front=[('box', -2, 36), ('growl', 35, 35)]),
        fr(flatten(sad, 0.92, 1.05), 220, front=[('box', -2, 35), ('growl', 33, 37)]),
        fr(flatten(sad, 0.88, 1.08), 500, front=[('box', -2, 37), ('sweat', 38, 22)]),
    ]))

    # 커피 수혈: 아이스 라테를 쭉 → 번쩍 충전
    sip = face(idle, eyes='closed')
    awake = face(idle, eyes='wide', mouth='open')
    E.append(emoticon('커피', 'steelman-coffee', '커피 수혈', 'W', [
        fr(face(idle, eyes='tired'), 220, front=[('cup', 34, 27)]),
        fr(sip, 140, front=[('cup', 29, 22)]),
        fr(sip, 420, front=[('cup', 24, 18)]),
        fr(awake, 100, front=[('cup', 34, 27), ('bolt', 2, 12), ('bolt', 42, 8)], shake=(1, 0)),
        fr(stretch(awake, 1.05), 100, front=[('cup', 34, 25), ('bolt', 0, 10), ('bolt', 44, 6), ('spark_l', 22, -2)], shake=(-1, 0)),
        fr(awake, 500, front=[('cup', 34, 27), ('spark_s', 4, 16), ('spark_s', 44, 12)]),
    ]))

    # 월요일…: 먹구름 아래서 점점 늘어짐
    blue = face(idle, eyes='tired', mouth='flat')
    rain = [('rain', 19, 6), ('rain', 22, 8), ('rain', 25, 6), ('rain', 28, 8)]
    rain2 = [('rain', 20, 8), ('rain', 23, 6), ('rain', 26, 8), ('rain', 29, 6)]
    E.append(emoticon('월요병', 'steelman-monday', '월요일…', 'W', [
        fr(blue, 260, front=[('cloud', 17, 0)] + rain),
        fr(flatten(blue, 0.93, 1.04), 260, front=[('cloud', 17, 0)] + rain2),
        fr(flatten(blue, 0.86, 1.08), 260, front=[('cloud', 17, 0)] + rain),
        fr(flatten(blue, 0.8, 1.12), 600, front=[('cloud', 17, 0)] + rain2),
    ]))

    # 불금!: 좌우로 뒤집으며 신나게 춤, 음표·반짝
    dance = [happy[1], flip(happy[1]), happy[3], flip(happy[3])]
    notes = [('note', 2, 8), ('note_y', 42, 4), ('note', 44, 16), ('note_y', 0, 18)]
    E.append(emoticon('불금', 'steelman-friday', '불금!', 'Y', [
        fr(dance[i % 4], 120, front=[notes[i % 4], notes[(i + 2) % 4], ('spark_s', (i * 11) % 44, 2 + (i % 3) * 4)])
        for i in range(8)
    ]))

    # 졸려요: 코일에 기대 앉아 꾸벅꾸벅
    E.append(emoticon('졸려', 'steelman-sleepy', '졸려요', 'W', [
        fr(sleep[i], 320, back=[('coil', -7, 25)], char_at=(4, 0)) for i in range(4)
    ]))

    # ㅠㅠ: 눈물 분수
    cry = face(idle, eyes='cry', mouth='wave')
    arcs = [[(14, 26), (35, 26)], [(10, 25), (39, 25)], [(7, 27), (42, 27)], [(5, 31), (44, 31)], [(4, 36), (45, 36)]]
    frames = []
    for i in range(6):
        front = []
        for k in range(3):
            for (x, y) in arcs[(i + k * 2) % 5]:
                front.append(('drop_l', x - 1, y))
        frames.append(fr(cry, 110, front=front, cx=-1 if i % 2 else 0))
    E.append(emoticon('울음', 'steelman-cry', 'ㅠㅠ', 'B', frames))

    # 부글부글: 얼굴이 빨개지며 머리에서 김
    def mad(k):
        return tint(face(idle, eyes='angry', mouth='grit'), 'R', k, rows=(20, 30), only_light=True)
    E.append(emoticon('화남', 'steelman-angry', '부글부글', 'R', [
        fr(face(idle, eyes='angry', mouth='flat'), 160),
        fr(mad(0.2), 110, front=[('puff_s', 12, 4)], shake=(1, 0)),
        fr(mad(0.35), 110, front=[('puff', 9, 0), ('puff_s', 33, 4), ('anger', 36, 12)], shake=(-1, 0)),
        fr(mad(0.45), 110, front=[('puff', 7, -4), ('puff', 32, 0), ('anger', 36, 12)], shake=(1, 0)),
        fr(mad(0.5), 110, front=[('puff', 5, -8), ('puff', 34, -4), ('puff_s', 20, 2), ('anger', 36, 11)], shake=(-1, 0)),
        fr(mad(0.5), 400, front=[('puff', 8, -6), ('puff', 31, -8), ('anger', 36, 12)]),
    ]))

    # 대박: 놀라고 뒤에서 불꽃놀이
    E.append(emoticon('대박', 'steelman-wow', '대박', 'Y', [
        fr(sur0, 120),
        fr(sur1, 90, back=[('burst_at', -2, -2, 4, 'W', 'R', 'r')]),
        fr(sur1, 90, back=[('burst_at', -6, -6, 8, 'W', 'R', 'r'), ('burst_at', 36, 2, 4, 'W', 'Y', 'O')]),
        fr(sur0, 90, back=[('burst_at', -8, -8, 10, 'P', 'R', 'r'), ('burst_at', 32, -2, 8, 'W', 'Y', 'O')]),
        fr(sur1, 90, back=[('burst_at', 32, -4, 10, 'y', 'Y', 'O'), ('burst_at', 14, 10, 4, 'W', 'V', 'V')]),
        fr(sur1, 90, back=[('burst_at', 10, 6, 8, 'C', 'V', 'V'), ('spark_s', -2, 4)]),
        fr(sur0, 400, back=[('spark_l', 0, 2), ('spark_s', 42, 6), ('spark_s', 20, -6)]),
    ]))

    # 굿모닝: 해가 떠오르고 기지개
    E.append(emoticon('굿모닝', 'steelman-morning', '굿모닝', 'Y', [
        fr(face(idle, eyes='closed'), 220, back=[('sun', -8, 20, 0)]),
        fr(face(idle, eyes='closed', mouth='o'), 200, back=[('sun', -8, 12, 0.3)]),
        fr(stretch(fall0, 1.04), 200, back=[('sun', -8, 4, 0.6)]),
        fr(stretch(fall1, 1.06), 200, back=[('sun', -8, 0, 0.9)]),
        fr(happy[5], 500, back=[('sun', -8, 0, 1.2)], front=[('spark_s', 42, 10)]),
    ]))

    # 군침 싹: 철판 삼겹살을 보고 눈이 반짝, 침 한 방울
    yum = nod(face(idle, eyes='wide', mouth='drool'), 1)
    steam = [('steam', 17, 31), ('steam', 24, 29), ('steam', 31, 31)]
    steam2 = [('steam', 18, 29), ('steam', 25, 31), ('steam', 32, 29)]
    E.append(emoticon('군침 싹', 'steelman-yummy', '군침 싹', 'W', [
        fr(idle, 200, front=[('grill', 13, 38)] + steam),
        fr(yum, 160, front=[('grill', 13, 38), ('spark_s', 12, 18), ('spark_s', 37, 18)] + steam2),
        fr(yum, 160, front=[('grill', 13, 38), ('drop', 26, 31)] + steam),
        fr(yum, 160, front=[('grill', 13, 38), ('drop', 26, 33), ('spark_s', 11, 17), ('spark_s', 38, 17)] + steam2),
        fr(yum, 500, front=[('grill', 13, 38), ('drop_l', 25, 34)] + steam),
    ]))

    # 냉정하게 거절: 팔을 X로, 파랗게 식으며 눈송이
    cold = face(idle, eyes='tired', mouth='flat')
    snow = [('snow', 2, 10), ('snow', 42, 4), ('snow', 40, 26)]
    snow2 = [('snow', 4, 22), ('snow', 44, 14), ('snow', 0, 2)]
    E.append(emoticon('냉정하게 거절', 'steelman-cold-no', ['냉정하게', '거절'], 'B', [
        fr(idle, 150),
        fr(cold, 120, front=[('arms_x', 16, 30)]),
        fr(tint(cold, 'B', 0.25), 150, front=[('arms_x', 16, 30)] + snow),
        fr(tint(cold, 'B', 0.45), 150, front=[('arms_x', 16, 30)] + snow2),
        fr(tint(cold, 'B', 0.5), 500, front=[('arms_x', 16, 30)] + snow),
    ]))

    # 압연 당함: 롤이 내려와 종잇장처럼 납작
    roll = [roller_img(40, 9, p) for p in range(6)]
    flat = face(idle, eyes='x', mouth='flat')
    E.append(emoticon('압연 당함', 'steelman-rolled', '압연 당함', 'W', [
        fr(idle, 160, front=[('img', 3, -16, roll[0])]),
        fr(sur1, 100, front=[('img', 3, -6, roll[1])]),
        fr(flatten(flat, 0.7, 1.1), 90, front=[('img', 3, 10, roll[2])], shake=(1, 0)),
        fr(flatten(flat, 0.4, 1.25), 90, front=[('img', 3, 23, roll[3])], shake=(-1, 0)),
        fr(flatten(flat, 0.28, 1.35), 120, front=[('img', 20, 28, roll[4])]),
        fr(flatten(flat, 0.28, 1.35), 140, front=[('img', 40, 28, roll[5])]),
        fr(flatten(flat, 0.28, 1.35), 500, front=[('sweat', 38, 30), ('spark_s', 4, 30)]),
    ]))

    # 담금질 중: 달군 몸을 물통에 쏙 → 치익 김 → 개운
    bucket = wall_img(40, 12)
    for x in range(1, 41):
        bucket.putpixel((x, 1), (79, 143, 209, 255))
        bucket.putpixel((x, 2), (142, 197, 240, 255))
    hot = heat(face(idle, eyes='angry', mouth='grit'), 0.55)
    E.append(emoticon('담금질', 'steelman-quench', '담금질 중', 'B', [
        fr(hot, 160, front=[('img', 3, 34, bucket)]),
        fr(hot, 90, front=[('img', 3, 34, bucket)], char_at=(0, 8)),
        fr(hot, 110, front=[('img', 3, 34, bucket), ('puff', 6, 18), ('puff', 34, 16)], char_at=(0, 14)),
        fr(face(idle, eyes='squeeze', mouth='wave'), 140, front=[('img', 3, 34, bucket), ('puff', 4, 10), ('puff', 36, 8), ('puff_s', 20, 6)], char_at=(0, 14)),
        fr(face(idle, eyes='squeeze', mouth='wave'), 140, front=[('img', 3, 34, bucket), ('puff', 2, 2), ('puff', 38, 0), ('puff', 18, -2)], char_at=(0, 12)),
        fr(face(idle, eyes='happy'), 500, front=[('img', 3, 34, bucket), ('sweat', 38, 18), ('spark_s', 6, 14)], char_at=(0, 6)),
    ]))

    # 철벽 방어: 철판 벽이 올라오고 눈만 빼꼼
    wall = wall_img(42, 30)
    peek = face(idle, eyes='dot', mouth='flat')
    E.append(emoticon('철벽 방어', 'steelman-wall', '철벽 방어', 'W', [
        fr(idle, 150),
        fr(face(idle, mouth='o'), 80, front=[('img', 2, 40, wall)]),
        fr(peek, 80, front=[('img', 2, 30, wall)]),
        fr(peek, 120, front=[('img', 2, 24, wall), ('spark_l', 0, 20), ('spark_s', 44, 22)], shake=(1, 0)),
        fr(peek, 300, front=[('img', 2, 24, wall)]),
        fr(peek, 200, front=[('img', 2, 24, wall)], char_at=(0, -3)),
        fr(face(idle, eyes='closed'), 120, front=[('img', 2, 24, wall)], char_at=(0, -3)),
        fr(peek, 400, front=[('img', 2, 24, wall)], char_at=(0, 2)),
    ]))

    # 강철 멘탈: 은빛 몸에 화살이 팅 하고 튕겨 나감
    steel = silver(idle)
    smug = silver(face(idle, eyes='happy'))
    arrow = prop('arrow')
    back_arrow = flip(arrow)
    E.append(emoticon('강철 멘탈', 'steelman-steel-mind', '강철 멘탈', 'W', [
        fr(steel, 160, front=[('img', -14, 30, arrow), ('spark_w', 30, 18)]),
        fr(steel, 90, front=[('img', -2, 30, arrow)]),
        fr(steel, 80, front=[('img', 4, 30, arrow), ('spark_l', 9, 28)], shake=(1, 0)),
        fr(steel, 90, front=[('img', -4, 24, back_arrow), ('spark_s', 10, 28)]),
        fr(smug, 90, front=[('img', -10, 18, back_arrow)]),
        fr(smug, 500, front=[('spark_w', 30, 18), ('spark_w', 14, 26), ('spark_s', 40, 10)]),
    ]))

    # 멘탈 녹는 중: 아래부터 쇳물처럼 녹아 퍼짐
    melt = face(idle, eyes='tired', mouth='wave')
    stages = [(1.0, 1.0, 44), (0.86, 1.12, 40), (0.72, 1.24, 37), (0.58, 1.36, 36), (0.5, 1.44, 36)]
    frames = []
    for i, (ratio, widen, row) in enumerate(stages):
        img = molten_bottom(flatten(melt, ratio, widen), row)
        drips = [('drip', 6 + (i * 5) % 8, 44), ('drip', 38 - (i * 3) % 6, 44)] if i else []
        frames.append(fr(img, 200 if i < 4 else 600, front=drips + ([('sweat', 36, 47 - round(48 * ratio) + 6)] if i > 1 else [])))
    E.append(emoticon('멘탈 녹는 중', 'steelman-melting', ['멘탈', '녹는 중'], 'O', frames))

    # ── 3차 ────────────────────────────────────────────
    think = [G(7, i) for i in range(4)]
    grin = face(idle, eyes='happy', mouth='smile')

    # 좋다 (🤙): 엄지·새끼손가락을 펴고 씨익
    E.append(emoticon('좋다', 'steelman-shaka', '좋다', 'W', [
        fr(idle, 150),
        fr(grin, 120, front=[('shaka', 37, 19)]),
        fr(grin, 120, front=[('shaka', 37, 17), ('spark_s', 46, 22)]),
        fr(grin, 120, front=[('shaka', 37, 19)]),
        fr(grin, 120, front=[('shaka', 37, 17), ('spark_l', 45, 20)]),
        fr(grin, 500, front=[('shaka', 37, 18)]),
    ]))

    # 야르!: 만세 점프 + 노란 불티
    E.append(emoticon('야르', 'steelman-yar', '야르!', 'Y', [
        fr(happy[0], 90), fr(happy[1], 90),
        fr(happy[2], 100, back=[('burst_at', 2, 0, 6, 'y', 'Y', 'O')]),
        fr(happy[3], 100, back=[('burst_at', 0, -2, 9, 'y', 'Y', 'O'), ('burst_at', 34, 2, 6, 'y', 'Y', 'O')]),
        fr(happy[4], 90, back=[('burst_at', 32, 0, 9, 'y', 'Y', 'O')]),
        fr(happy[2], 100, back=[('burst_at', 14, -6, 7, 'y', 'Y', 'O')]),
        fr(happy[5], 450, front=[('spark_l', 0, 10), ('spark_s', 44, 8)]),
    ]))

    # 할렐야루: 후광과 빛줄기 속에서 둥실
    bliss = face(idle, eyes='closed', mouth='smile')
    E.append(emoticon('할렐야루', 'steelman-hallelujah', '할렐야루', 'Y', [
        fr(bliss, 180, back=[('img', 24 - 22, 24 - 22, ring_burst(20, 'Y', 'Y', 'O', rays=12, length=5, phase=i * 0.25))],
           front=[('halo', 17, 2 - (i % 2) - (i % 3))], char_at=(0, -(i % 3)))
        for i in range(6)
    ]))

    # 감다살: 별 눈 + 엄지 척 + 반짝
    sharp = face(idle, eyes='star', mouth='open')
    E.append(emoticon('감다살', 'steelman-sense', '감다살', 'Y', [
        fr(idle, 140),
        fr(sharp, 100, front=[('thumb', 36, 26), ('spark_l', 2, 14)]),
        fr(sharp, 100, front=[('thumb', 36, 25), ('spark_s', 3, 15), ('spark_l', 44, 18)]),
        fr(sharp, 100, front=[('thumb', 36, 26), ('spark_l', 0, 22)]),
        fr(sharp, 500, front=[('thumb', 36, 25), ('spark_s', 44, 19), ('spark_s', 2, 16)]),
    ]))

    # 감다뒤: 고개를 천천히 갸웃, 물음표
    blank_face = face(idle, eyes='dot', mouth='flat')
    E.append(emoticon('감다뒤', 'steelman-no-sense', '감다뒤', 'W', [
        fr(blank_face, 200),
        fr(sway(blank_face, -1), 160),
        fr(sway(blank_face, -2), 160, front=[('qmark', 38, 10)]),
        fr(sway(blank_face, -3), 600, front=[('qmark', 38, 8)]),
    ]))

    # 중꺾마: 머리 위로 든 휜 철판이 팅 하고 다시 펴짐
    E.append(emoticon('중꺾마', 'steelman-unbroken', '중꺾마', 'O', [
        fr(fall0, 160, front=[('plate', 13, -1, 5)]),
        fr(fall1, 120, front=[('plate', 13, -1, 3)]),
        fr(fall0, 100, front=[('plate', 13, 0, 0), ('spark_l', 8, -2), ('spark_l', 34, -2)], shake=(1, 0)),
        fr(happy[5], 500, front=[('plate', 13, 0, 0), ('spark_s', 46, 10), ('spark_s', 0, 12)]),
    ]))

    # 오히려 좋아: 비를 맞으면서도 엄지 척
    happy_rain = face(idle, eyes='happy', mouth='open')
    E.append(emoticon('오히려 좋아', 'steelman-even-better', '오히려 좋아', 'W', [
        fr(happy_rain, 220, front=[('cloud', 17, 0), ('thumb', 36, 26)] + rain),
        fr(happy_rain, 220, front=[('cloud', 17, 0), ('thumb', 36, 25)] + rain2),
        fr(happy_rain, 220, front=[('cloud', 17, 0), ('thumb', 36, 26), ('spark_s', 45, 22)] + rain),
        fr(happy_rain, 220, front=[('cloud', 17, 0), ('thumb', 36, 25)] + rain2),
    ]))

    # 얼죽아: 눈보라 속에서 덜덜 떨며 아이스 커피
    shiver = tint(face(idle, eyes='squeeze', mouth='wave'), 'B', 0.3)
    sipping = tint(face(idle, eyes='closed'), 'B', 0.2)
    E.append(emoticon('얼죽아', 'steelman-iced', '얼죽아', 'B', [
        fr(shiver, 90, front=[('ice_cup', 34, 27), ('snow', 2, 6), ('snow', 42, 14)], shake=(1, 0)),
        fr(shiver, 90, front=[('ice_cup', 34, 27), ('snow', 4, 12), ('snow', 40, 20)], shake=(-1, 0)),
        fr(shiver, 90, front=[('ice_cup', 34, 27), ('snow', 2, 18), ('snow', 44, 6)], shake=(1, 0)),
        fr(shiver, 90, front=[('ice_cup', 34, 27), ('snow', 6, 24), ('snow', 42, 12)], shake=(-1, 0)),
        fr(sipping, 600, front=[('ice_cup', 24, 18), ('snow', 2, 10), ('snow', 42, 18), ('spark_s', 12, 20)]),
    ]))

    # 불길하다…: 먹구름이 몰려오고 음표가 커짐
    uneasy = face(idle, eyes='dot', mouth='flat')
    E.append(emoticon('불길하다', 'steelman-ominous', '불길하다…', 'W', [
        fr(uneasy, 280, back=[('cloud_dark', 36, 2)], front=[('note', 40, 22)]),
        fr(uneasy, 280, back=[('cloud_dark', -6, 4), ('cloud_dark', 36, 2)], front=[('note', 41, 18), ('note', 0, 24)]),
        fr(tint(uneasy, 'H', 0.12), 280, back=[('cloud_dark', -6, 4), ('cloud_dark', 36, 2), ('cloud_dark', 14, -2)],
           front=[('note', 42, 14), ('note', 1, 20), ('sweat', 36, 20)]),
        fr(tint(uneasy, 'H', 0.2), 600, back=[('cloud_dark', -6, 4), ('cloud_dark', 36, 2), ('cloud_dark', 14, -2)],
           front=[('note', 43, 10), ('note', 2, 16), ('sweat', 36, 23)]),
    ]))

    # 겉과 속: 겉으로는 '넵!' 웃는 얼굴, 생각 풍선 속은 ㅠㅠ
    fake = face(idle, eyes='happy', mouth='open')
    E.append(emoticon('겉과 속', 'steelman-inner-voice', '넵!', 'W', [
        fr(fake, 350),
        fr(fake, 150, front=[('bubble', 30, 0)]),
        fr(fake, 800, front=[('bubble', 30, 0, prop('tiny_cry'))]),
    ]))

    # 대충 답장: 누워서 폰 들고 'ㅇㅇ'
    lying = idle.transpose(Image.ROTATE_90)
    E.append(emoticon('대충 답장', 'steelman-lazy-reply', 'ㅇㅇ', 'W', [
        fr(lying, 400, front=[('phone', 31, 12)], char_at=(-3, 6)),
        fr(face(idle, eyes='closed').transpose(Image.ROTATE_90), 200, front=[('phone', 31, 12)], char_at=(-3, 6)),
        fr(lying, 600, front=[('phone', 31, 11)], char_at=(-3, 6)),
    ]))

    # 넵병: 넵넵넵넵 무한 끄덕 → 빙글
    nod_face = face(idle, eyes='happy')
    frames = []
    for _ in range(4):
        frames += [fr(nod(nod_face, 3), 60), fr(idle, 60)]
    frames += [fr(face(idle, eyes='swirl', mouth='wave'), 500, front=[('sweat', 38, 18)])]
    E.append(emoticon('넵병', 'steelman-nep-nep', '넵넵넵넵', 'W', frames))

    # 사무실 지박령: 다리 없는 창백한 유령이 책상 위를 둥둥
    spook = ghost(face(idle, eyes='tired', mouth='o'))
    E.append(emoticon('지박령', 'steelman-office-ghost', ['사무실', '지박령'], 'W', [
        fr(spook, 200, char_at=(0, y)) for y in (0, -1, -2, -3, -2, -1)
    ]))

    # 점심 뭐 먹지: 생각하는 머리 위로 밥·면·김밥이 돌아감
    menu = ['bowl', 'noodle', 'gimbap', 'bowl', 'noodle', 'gimbap']
    E.append(emoticon('점심 뭐 먹지', 'steelman-lunch-menu', '점심 뭐 먹지', 'W', [
        fr(think[i % 3], 240, front=[(menu[i], 36 if menu[i] != 'gimbap' else 38, 6)]) for i in range(6)
    ] + [fr(think[3], 400, front=[('noodle', 36, 6), ('spark_s', 47, 4)])]))

    # ── 4차: 요즘 말투 밈 (말 자체의 재미만 쓰고 사람을 놀리는 그림은 넣지 않는다) ──
    # 예?: 눈이 동그래지며 고개를 내밀고, 큰 물음표가 쿵
    huh = face(idle, eyes='wide', mouth='o')
    E.append(emoticon('예?', 'steelman-huh', '예?', 'W', [
        fr(idle, 160),
        fr(huh, 80, front=[('qmark_l', 40, -2)]),
        fr(stretch(huh, 1.04), 80, front=[('qmark_l', 40, 3)]),
        fr(sway(huh, 1), 80, front=[('qmark_l', 40, 6)], shake=(0, 1)),
        fr(sway(huh, 1), 700, front=[('qmark_l', 40, 5)]),
    ]))

    # 엄…: 눈만 좌우로 굴리며 멈칫, 땀 한 방울
    um_l, um_r = face(idle, eyes='look_l', mouth='flat'), face(idle, eyes='look_r', mouth='flat')
    E.append(emoticon('엄', 'steelman-um', '엄…', 'W', [
        fr(idle, 200),
        fr(um_l, 300),
        fr(um_r, 300),
        fr(um_l, 250),
        fr(face(idle, eyes='dot', mouth='flat'), 700, front=[('sweat', 37, 19)]),
    ]))

    # 아뇨아뇨아뇨: 손을 빠르게 휘저으며 도리도리
    nono = face(idle, eyes='squeeze', mouth='open')
    seq = [(-2, 28), (2, 33), (-2, 28), (2, 33), (-2, 28), (2, 33)]
    E.append(emoticon('아뇨아뇨아뇨', 'steelman-no-no', '아뇨아뇨아뇨', 'W', [
        fr(sway(nono, h), 70, front=[('palm', x, 22), ('speed_s', x - 6 if h < 0 else x + 12, 26)]) for h, x in seq
    ] + [fr(nono, 450, front=[('palm', 30, 22), ('sweat', 10, 18)])]))

    # 줴줴이야: 두 손을 입에 모으고 외치며 하얀 깃발을 흔듦 (GG)
    yell = face(idle, eyes='closed', mouth='big')
    hands = ('cup_hands', 19, 26)
    yells = [('img', 39, 20, flip(prop('yell'))), ('img', 43, 18, flip(prop('yell')))]
    flag1, flag2 = ('img', 0, 20, flip(prop('flag_w'))), ('img', 0, 21, flip(prop('flag_w2')))
    E.append(emoticon('줴줴이야', 'steelman-gg', '줴줴이야', 'W', [
        fr(yell, 150, front=[flag1, hands]),
        fr(yell, 150, front=[flag2, hands] + yells, cx=-1),
        fr(yell, 150, front=[flag1, hands]),
        fr(yell, 150, front=[flag2, hands] + yells, cx=-1),
        fr(yell, 500, front=[flag1, hands] + yells),
    ]))

    # 티~원: 이름을 길게 늘여 부르듯 몸이 옆으로 쭉 늘어남, 마이크
    call = face(idle, eyes='happy', mouth='o')
    frames = [fr(face(idle, eyes='happy', mouth='smile'), 200, front=[('mic', 34, 26)])]
    for k, dur in ((1.1, 110), (1.2, 110), (1.3, 110), (1.36, 650)):
        w = round(CELL * k)
        frames.append(fr(stretch_wide(call, k), dur, front=[('mic', 34 + (w - CELL) // 2, 26)], char_at=((CELL - w) // 2, 0)))
    frames.append(fr(face(idle, eyes='happy', mouth='smile'), 200, front=[('mic', 34, 26), ('spark_s', 4, 14)]))
    E.append(emoticon('티~원', 'steelman-t-one', '티~원', 'O', frames))

    # 요오오~이: 한 팔 번쩍 들고 점프
    yoi = face(wave1, eyes='happy', mouth='big')
    E.append(emoticon('요오오~이', 'steelman-yoi', '요오오~이', 'Y', [
        fr(flatten(yoi, 0.94, 1.04), 110),
        fr(yoi, 80, char_at=(0, -2)),
        fr(yoi, 140, char_at=(0, -4), front=[('spark_l', 42, 2), ('spark_s', 2, 10)]),
        fr(yoi, 80, char_at=(0, -2), front=[('spark_s', 44, 4)]),
        fr(flatten(yoi, 0.94, 1.04), 100, front=[('dust', 6, 43), ('dust', 36, 43)]),
        fr(yoi, 500, front=[('spark_s', 43, 6), ('spark_s', 3, 12)]),
    ]))
    # ── 5차 ────────────────────────────────────────────
    # '네' 변형: 넵… (영혼 없음)
    soulless = face(idle, eyes='dot', mouth='flat')
    E.append(emoticon('넵…', 'steelman-nep-soulless', '넵…', 'g', [
        fr(soulless, 300),
        fr(tint(soulless, 'g', 0.3), 300),
        fr(tint(soulless, 'g', 0.55), 300),
        fr(tint(soulless, 'g', 0.75), 800),
    ]))

    # 네에~: 몸이 옆으로 늘어지는 대답
    lazy = face(idle, eyes='closed', mouth='smile')
    frames = []
    for k, dur in ((1.0, 200), (1.12, 160), (1.24, 160), (1.34, 600), (1.12, 120)):
        w = round(CELL * k)
        frames.append(fr(stretch_wide(flatten(lazy, 1 / (k ** 0.5), 1.0), k), dur, char_at=((CELL - w) // 2, 0)))
    E.append(emoticon('네에~', 'steelman-nee', '네에~', 'W', frames))

    # 넹: 볼 빨개지며 고개 갸웃
    cute = face(idle, eyes='happy', mouth='smile')
    E.append(emoticon('넹', 'steelman-neng', '넹', 'P', [
        fr(cute, 200),
        fr(sway(cute, -1), 140, front=[('blush', 14, 26)]),
        fr(sway(cute, -2), 600, front=[('blush', 13, 26), ('heart_s', 40, 10)]),
        fr(sway(cute, -1), 140, front=[('blush', 14, 26)]),
    ]))

    # 글자만 크게: 큰 글자가 쿵 떨어지고 구석에 작은 철강맨
    mini = idle.resize((24, 24), Image.NEAREST)

    def big_word(tag, key, word, color):
        t = big_text(word, color)
        x = (CELL - t.width) // 2
        E.append(emoticon(tag, key, '', color, [
            fr(None, 120, front=[('img', x, -14, t), ('img', 30, 24, mini)]),
            fr(None, 80, front=[('img', x, -2, t), ('img', 30, 24, mini)]),
            fr(None, 80, front=[('img', x, 6, t), ('img', 30, 24, mini)], shake=(0, 1)),
            fr(None, 700, front=[('img', x, 4, t), ('img', 30, 24, face(idle, eyes='happy').resize((24, 24), Image.NEAREST))]),
        ], oy=15))
    big_word('ㅇㅋ', 'steelman-okay', 'ㅇㅋ', 'E')
    big_word('ㄱㄱ', 'steelman-gogo', 'ㄱㄱ', 'O')
    big_word('헐', 'steelman-heol', '헐', 'W')

    # 킹받네: 얼굴이 찌그러지고 부들부들
    king = face(idle, eyes='angry', mouth='grit')
    E.append(emoticon('킹받네', 'steelman-kingbat', '킹받네', 'R', [
        fr(king, 90, front=[('anger', 36, 8)], shake=(1, 0)),
        fr(flatten(king, 0.94, 1.06), 90, front=[('anger', 37, 10)], shake=(-1, 0)),
        fr(king, 90, front=[('anger', 36, 8)], shake=(1, 0)),
        fr(flatten(tint(king, 'R', 0.2), 0.92, 1.08), 90, front=[('anger', 37, 10), ('anger', 4, 12)], shake=(-1, 0)),
        fr(tint(king, 'R', 0.2), 500, front=[('anger', 36, 8), ('anger', 4, 12)]),
    ]))

    # 정신 나감: 눈이 빙글, 안전모가 혼자 빙글빙글
    dazed = face(idle, eyes='swirl', mouth='wave')
    body, helmet = helmet_off(dazed)
    spin = [helmet, flip(helmet)]
    E.append(emoticon('정신 나감', 'steelman-out-of-mind', '정신 나감', 'V', [
        fr(body, 110, front=[('img', dx, dy, spin[i % 2])]) for i, (dx, dy) in enumerate([(0, -6), (3, -8), (0, -10), (-3, -8), (0, -6), (3, -8), (0, -10), (-3, -8)])
    ] + [fr(dazed, 400, front=[('spark_s', 40, 8)])]))

    # 녹슬었다: 몸이 점점 갈색으로 녹슬며 축 처짐
    rust = face(idle, eyes='tired', mouth='flat')
    E.append(emoticon('녹슬었다', 'steelman-rusty', '녹슬었다', 'T', [
        fr(rust, 250),
        fr(tint(rust, 'T', 0.3), 250),
        fr(flatten(tint(rust, 'T', 0.5), 0.96, 1.02), 250),
        fr(flatten(tint(rust, 't', 0.55), 0.92, 1.04), 800, front=[('dust_s', 6, 42), ('dust_s', 38, 42)]),
    ]))

    # 오류: 화면 깨지듯 지지직
    err = face(idle, eyes='x', mouth='wave')
    E.append(emoticon('오류', 'steelman-error', '오류', 'R', [
        fr(idle, 200),
        fr(glitch(err, 1), 70, shake=(1, 0)),
        fr(glitch(err, 2), 70, shake=(-1, 0)),
        fr(glitch(err, 3), 70),
        fr(err, 120),
        fr(glitch(err, 4), 70, shake=(1, 0)),
        fr(err, 500, front=[('excl', 40, 10)]),
    ]))

    # 짠!: 잔을 부딪침 (음료)
    E.append(emoticon('짠', 'steelman-cheers', '짠!', 'Y', [
        fr(face(idle, eyes='happy'), 160, front=[('glass', 32, 26), ('img', 48, 26, flip(prop('glass')))]),
        fr(face(idle, eyes='happy'), 100, front=[('glass', 36, 22), ('img', 44, 22, flip(prop('glass')))]),
        fr(face(idle, eyes='happy', mouth='open'), 120, front=[('glass', 38, 20), ('img', 42, 20, flip(prop('glass'))), ('spark_l', 38, 12)]),
        fr(face(idle, eyes='happy', mouth='open'), 600, front=[('glass', 36, 22), ('img', 44, 22, flip(prop('glass'))), ('spark_s', 42, 14)]),
    ]))

    # 하이파이브: 반대쪽에서 손이 들어와 짝
    E.append(emoticon('하이파이브', 'steelman-high-five', '하이파이브', 'O', [
        fr(wave1, 160, front=[('palm', 56, 12)]),
        fr(wave1, 100, front=[('palm', 48, 12)]),
        fr(face(wave2, eyes='happy', mouth='open'), 100, front=[('palm', 42, 12), ('burst_at', 38, 6, 6, 'y', 'Y', 'O')], shake=(1, 0)),
        fr(face(wave2, eyes='happy', mouth='open'), 600, front=[('palm', 44, 12), ('spark_s', 40, 4)]),
    ]))

    # 월급날: 돈봉투를 안고 빙글빙글
    pay = face(idle, eyes='star', mouth='open')
    E.append(emoticon('월급날', 'steelman-payday', '월급날', 'E', [
        fr(pay if i % 2 == 0 else flip(pay), 140, front=[('envelope', 17, 30)], back=[('spark_s', 2 + (i * 9) % 40, 4 + (i * 5) % 14)])
        for i in range(6)
    ] + [fr(pay, 400, front=[('envelope', 17, 30), ('heart_s', 40, 10)])]))

    # 칼퇴 각: 6시 정각, 잔상만 남기고 사라짐
    ready = face(idle, eyes='angry', mouth='smile')
    ghost_img = tint(ready, 'W', 0.6)
    E.append(emoticon('칼퇴 각', 'steelman-leave-on-time', '칼퇴 각', 'O', [
        fr(ready, 300, back=[('clock', 40, 0)], front=[('briefcase', 34, 32)]),
        fr(ready, 300, back=[('clock', 40, 0)], front=[('briefcase', 34, 32), ('excl', 52, 2)]),
        fr(ghost_img, 90, back=[('clock', 40, 0), ('speed', -6, 22), ('speed', -6, 32)]),
        fr(None, 600, back=[('clock', 40, 0), ('dust', 18, 40), ('speed', 0, 28)]),
    ]))

    # 주말 순삭: 달력이 휙휙 넘어가고 멍
    stunned = face(idle, eyes='dot', mouth='o')
    E.append(emoticon('주말 순삭', 'steelman-weekend-gone', '주말 순삭', 'W', [
        fr(idle, 160, back=[('calendar', 34, 2)]),
        fr(idle, 80, back=[('calendar', 34, 2)], front=[('speed_s', 34, 6)]),
        fr(stunned, 80, back=[('calendar', 34, 3)], front=[('speed_s', 36, 8)]),
        fr(stunned, 80, back=[('calendar', 34, 2)], front=[('speed_s', 34, 6)]),
        fr(stunned, 800, back=[('calendar', 34, 2)], front=[('sweat', 8, 20)]),
    ]))

    # 부럽다: 벽 뒤에서 반만 보며 눈 반짝
    envy = face(idle, eyes='star', mouth='o')
    E.append(emoticon('부럽다', 'steelman-envy', '부럽다', 'Y', [
        fr(envy, 300, front=[('wall', 20, 4, 30, 44)], char_at=(-6, 0)),
        fr(envy, 300, front=[('wall', 20, 4, 30, 44), ('spark_s', 8, 18)], char_at=(-5, 0)),
        fr(envy, 300, front=[('wall', 20, 4, 30, 44), ('spark_l', 6, 16)], char_at=(-6, 0)),
    ]))

    # 엥?: 고개를 크게 갸웃 + 물음표
    eh = face(idle, eyes='dot', mouth='o')
    E.append(emoticon('엥', 'steelman-eh', '엥?', 'W', [
        fr(eh, 150),
        fr(sway(eh, 2), 120, front=[('qmark', 40, 10)]),
        fr(sway(eh, 4), 700, front=[('qmark_l', 40, 4)]),
    ]))

    # 그만해: 손바닥 내밀며 천천히 도리도리
    stop = face(idle, eyes='closed', mouth='frown')
    E.append(emoticon('그만해', 'steelman-stop-it', '그만해', 'R', [
        fr(sway(stop, h), 200, front=[('palm', 30, 20)]) for h in (-2, 0, 2, 0)
    ] + [fr(stop, 500, front=[('palm', 30, 20)])]))

    # 현타: 창밖을 멍하니, 눈이 점 두 개
    blank_stare = tint(face(idle, eyes='dot', mouth='flat'), 'g', 0.2)
    E.append(emoticon('현타', 'steelman-reality-check', '현타', 'g', [
        fr(blank_stare, 500, back=[('window', 32, 0)]),
        fr(blank_stare, 500, back=[('window', 32, 0)], front=[('ellipsis', 36, 14)]),
        fr(tint(blank_stare, 'g', 0.25), 900, back=[('window', 32, 0)], front=[('ellipsis', 36, 14)]),
    ]))

    # 요들갑: 제자리에서 팔다리 파닥파닥 + 느낌표 3개
    fuss = [face(happy[1], eyes='wide', mouth='open'), face(happy[3], eyes='wide', mouth='open')]
    E.append(emoticon('요들갑', 'steelman-fuss', '요들갑', 'O', [
        fr(fuss[i % 2], 80, front=[('excl', 2 + i % 2, 8), ('excl', 42, 6 + i % 2), ('excl', 46, 14)], shake=(1 if i % 2 else -1, 0))
        for i in range(8)
    ]))

    # 진지 모드: 안경을 쓰면 렌즈가 번쩍
    serious = face(idle, eyes='closed', mouth='flat')
    E.append(emoticon('진지 모드', 'steelman-serious', '진지 모드', 'b', [
        fr(serious, 200, front=[('glasses', 15, 12)]),
        fr(serious, 120, front=[('glasses', 15, 18)]),
        fr(serious, 120, front=[('glasses', 15, 22)]),
        fr(serious, 100, front=[('glasses', 15, 22), ('spark_w', 18, 22), ('spark_w', 28, 22)]),
        fr(serious, 600, front=[('glasses', 15, 22)]),
    ]))

    # 밥플릭스: 밥 먹으며 폰으로 영상
    eat = face(idle, eyes='happy', mouth='o')
    E.append(emoticon('밥플릭스', 'steelman-bobflix', '밥플릭스', 'R', [
        fr(eat if i % 2 else idle, 260, front=[('bowl', 0, 32), ('phone', 38, 26), ('spoon', 14, 26 + (i % 2))]) for i in range(4)
    ]))

    # 플렉스: 선글라스 쓰고 돈봉투 흔들기
    flex = face(wave2, mouth='smile')
    E.append(emoticon('플렉스', 'steelman-flex', '플렉스', 'Y', [
        fr(face(wave1, mouth='smile'), 140, front=[('sunglasses', 15, 21), ('envelope', 36, 6)]),
        fr(flex, 140, front=[('sunglasses', 15, 21), ('envelope', 38, 4), ('spark_s', 2, 16)]),
        fr(face(wave1, mouth='smile'), 140, front=[('sunglasses', 15, 21), ('envelope', 36, 6), ('spark_l', 2, 14)]),
        fr(flex, 500, front=[('sunglasses', 15, 21), ('envelope', 38, 4), ('spark_s', 46, 18)]),
    ]))

    # 박수: 짝짝짝
    clap = face(idle, eyes='happy', mouth='open')
    E.append(emoticon('박수', 'steelman-clap', '박수', 'Y', [
        fr(clap, 110, front=[('clap', 20, 32)] + ([('spark_s', 14, 28), ('spark_s', 30, 28)] if i % 2 else []), cx=-(i % 2))
        for i in range(6)
    ]))

    # 조연 '코일이': 데굴데굴 굴러와 꼬리 살랑
    E.append(emoticon('코일이', 'steelman-coil-dog', '코일이 멍!', 'W', [
        fr(idle, 160, front=[('dog', 52, 22, 0)]),
        fr(idle, 120, front=[('dog', 40, 22, 1)]),
        fr(face(idle, eyes='happy'), 120, front=[('dog', 30, 22, 2)]),
        fr(face(idle, eyes='happy', mouth='open'), 200, front=[('dog', 26, 22, 3), ('heart_s', 34, 14)]),
        fr(face(idle, eyes='happy', mouth='open'), 200, front=[('dog', 26, 22, 4), ('heart_s', 36, 10)]),
        fr(face(idle, eyes='happy'), 400, front=[('dog', 26, 22, 5)]),
    ]))

    # 조연 '슬래브 냥이': 납작하게 쭉 기지개
    E.append(emoticon('슬래브 냥이', 'steelman-slab-cat', '냥이 기지개', 'W', [
        fr(idle, 200, front=[('cat', 18, 26, 1.0)]),
        fr(idle, 200, front=[('cat', 14, 27, 1.2)]),
        fr(face(idle, eyes='happy'), 500, front=[('cat', 10, 28, 1.45, False)]),
        fr(face(idle, eyes='happy'), 300, front=[('cat', 18, 26, 1.0), ('heart_s', 4, 16)]),
    ]))
    return E
