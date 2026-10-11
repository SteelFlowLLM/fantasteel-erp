"""묶음 '철강맨 행사' (steelman-event): 3차 6종 (명절·연말·생일·환영) + 5차 6종 (승진·크리스마스·더위·추위·휴가·축하). 6차에 새해를 한복·띠로 보강. 키는 shared MESSAGE_EMOTICONS와 같다."""
from emoticon_lib import emoticon, face, flatten, fr, hanbok, molten_bottom, nod, tint


def build(sh):
    G = sh.get
    idle = G(0, 0)
    happy5 = G(4, 5)
    wave1, wave2 = G(5, 1), G(5, 2)
    bow = face(idle, eyes='happy')

    E = []

    # 새해 복 많이 받으세요: 한복 입고 절 + 그해 띠(2027 정미년 = 양) + 복주머니 + 작은 불꽃놀이 (6차 보강)
    # 띠는 해마다 바꾼다: ZODIAC 소품만 바꿔 다시 만든다
    ZODIAC = 'sheep'
    han = hanbok(idle)
    han_bow = hanbok(bow)
    goreum = ('goreum', 22, 32)
    E.append(emoticon('새해', 'steelman-new-year', ['새해 복', '많이 받으세요'], 'R', [
        fr(han, 220, front=[goreum, ('pouch', 36, 31), (ZODIAC, -6, 34)]),
        fr(nod(han_bow, 2), 100, front=[('pouch', 36, 31), (ZODIAC, -6, 34)]),
        fr(nod(han_bow, 4, helmet_extra=1), 120, front=[('pouch', 36, 32), (ZODIAC, -6, 34)]),
        fr(flatten(nod(han_bow, 6, helmet_extra=2), 0.94, 1.04), 700,
           front=[('pouch', 36, 33), (ZODIAC, -6, 34), ('burst_at', -7, 4, 5, 'W', 'R', 'r'), ('burst_at', 37, 2, 5, 'W', 'Y', 'O')]),
        fr(nod(han_bow, 2), 100, front=[('pouch', 36, 31), (ZODIAC, -6, 34)]),
        fr(han_bow, 450, front=[goreum, ('pouch', 36, 31), (ZODIAC, -6, 33), ('spark_s', 44, 10), ('spark_s', 2, 12)]),
    ]))

    # 즐거운 설: 떡국 한 그릇 + 김
    steam = [('steam', 19, 25), ('steam', 25, 23), ('steam', 31, 25)]
    steam2 = [('steam', 20, 23), ('steam', 26, 25), ('steam', 32, 23)]
    E.append(emoticon('설날', 'steelman-seollal', ['즐거운', '설 보내세요'], 'R', [
        fr(bow, 260, front=[('tteokguk', 17, 33)] + steam),
        fr(bow, 260, front=[('tteokguk', 17, 33), ('spark_s', 44, 12)] + steam2),
        fr(bow, 260, front=[('tteokguk', 17, 33)] + steam),
        fr(bow, 260, front=[('tteokguk', 17, 33), ('spark_s', 2, 14)] + steam2),
    ]))

    # 즐거운 추석: 보름달 + 송편 한 접시
    E.append(emoticon('추석', 'steelman-chuseok', ['즐거운', '추석 보내세요'], 'O', [
        fr(bow, 300, back=[('moon', -8, 10)], front=[('songpyeon', 14, 35), ('spark_s', 44, 6)]),
        fr(bow, 300, back=[('moon', -8, 10)], front=[('songpyeon', 14, 35), ('spark_s', 46, 14), ('spark_s', 40, 2)]),
        fr(face(idle, eyes='happy', mouth='open'), 300, back=[('moon', -8, 10)], front=[('songpyeon', 14, 35), ('spark_l', 44, 8)]),
        fr(bow, 300, back=[('moon', -8, 10)], front=[('songpyeon', 14, 35)]),
    ]))

    # 올해도 수고했어요: 안전모에 눈이 쌓인 채 꾸벅
    snow = [('snow', 2, 6), ('snow', 42, 16), ('snow', 40, 2)]
    snow2 = [('snow', 4, 14), ('snow', 44, 6), ('snow', 0, 24)]
    E.append(emoticon('연말', 'steelman-year-end', ['올해도', '수고했어요'], 'W', [
        fr(idle, 220, front=[('snowcap', 16, 6)] + snow),
        fr(nod(bow, 2), 100, front=[('snowcap', 16, 8)] + snow2),
        fr(nod(bow, 4, helmet_extra=1), 600, front=[('snowcap', 16, 11)] + snow),
        fr(nod(bow, 2), 100, front=[('snowcap', 16, 8)] + snow2),
        fr(bow, 400, front=[('snowcap', 16, 6)] + snow),
    ]))

    # 생일 축하해요: 촛불이 타닥타닥 케이크 + 꽃가루
    E.append(emoticon('생일', 'steelman-birthday', ['생일', '축하해요'], 'P', [
        fr(happy5 if i % 2 else wave2, 200, back=[('confetti', -6, -2, i, 10, 58, 24)],
           front=[('cake', -7, 34), ('flames' if i % 2 else 'flames2', -7, 33)])
        for i in range(6)
    ]))

    # 환영합니다: 꽃가루가 빵빵 터지고 손 흔들기
    E.append(emoticon('환영', 'steelman-welcome', '환영합니다', 'Y', [
        fr(wave1 if i % 2 else wave2, 160,
           back=[('confetti', -6, -2, 10 + i, 18, 60, 48), ('burst_at', -4 + (i * 13) % 40, -4 + (i * 7) % 12, 5 + i % 3, 'W', 'RYEBV'[i % 5], 'r')])
        for i in range(6)
    ] + [fr(happy5, 400, back=[('confetti', -6, -2, 30, 18, 60, 48)])]))
    # ── 5차 ────────────────────────────────────────────
    # 승진 축하드려요: 안전모에 줄무늬가 하나 더 + 꽃가루
    proud = face(idle, eyes='happy', mouth='open')
    E.append(emoticon('승진', 'steelman-promotion', ['승진', '축하드려요'], 'Y', [
        fr(idle, 200),
        fr(proud, 120, front=[('helmet_stripe', 21, 8), ('spark_s', 18, 2)]),
        fr(proud, 160, back=[('confetti', -6, -2, 41, 14, 60, 40)], front=[('helmet_stripe', 21, 8), ('spark_l', 30, 0)]),
        fr(happy5, 600, back=[('confetti', -6, -2, 42, 14, 60, 40)], front=[('helmet_stripe', 21, 8)]),
    ]))

    # 메리 크리스마스: 산타 모자 안전모 + 눈
    snow3 = [('snow', 2, 8), ('snow', 44, 18), ('snow', 40, 0)]
    snow4 = [('snow', 4, 16), ('snow', 46, 8), ('snow', 0, 26)]
    E.append(emoticon('크리스마스', 'steelman-christmas', '메리 성탄!', 'R', [
        fr(wave1 if i % 2 else wave2, 220, front=[('santa_hat', 13, 1)] + (snow3 if i % 2 else snow4)) for i in range(4)
    ]))

    # 더워요: 해 아래 녹아내림
    hot = face(idle, eyes='tired', mouth='open')
    E.append(emoticon('더워요', 'steelman-hot', '더워요', 'R', [
        fr(hot, 220, back=[('sun', 34, -4, 0)], front=[('sweat', 38, 18)]),
        fr(molten_bottom(flatten(hot, 0.94, 1.04), 40), 220, back=[('sun', 34, -4, 0.4)], front=[('sweat', 38, 20), ('sweat', 6, 22)]),
        fr(molten_bottom(flatten(hot, 0.86, 1.1), 36), 220, back=[('sun', 34, -4, 0.8)], front=[('sweat', 38, 24)]),
        fr(molten_bottom(flatten(hot, 0.8, 1.16), 34), 600, back=[('sun', 34, -4, 1.2)], front=[('drip', 8, 44), ('drip', 38, 44)]),
    ]))

    # 추워요: 꽁꽁 얼어 고드름
    cold = tint(face(idle, eyes='squeeze', mouth='wave'), 'B', 0.35)
    E.append(emoticon('추워요', 'steelman-cold', '추워요', 'B', [
        fr(cold, 90, front=[('snow', 2, 6), ('snow', 42, 14)], shake=(1, 0)),
        fr(cold, 90, front=[('snow', 4, 12), ('snow', 40, 20)], shake=(-1, 0)),
        fr(tint(cold, 'C', 0.3), 90, front=[('icicle', 12, 17), ('icicle', 24, 17), ('snow', 2, 18)], shake=(1, 0)),
        fr(tint(cold, 'C', 0.45), 700, front=[('icicle', 12, 17), ('icicle', 24, 17), ('snow', 6, 24), ('snow', 42, 10)]),
    ]))

    # 휴가 다녀오겠습니다: 밀짚모자에 캐리어 끌고 손 흔들기
    E.append(emoticon('휴가', 'steelman-vacation', '휴가 갑니다!', 'B', [
        fr(wave1 if i % 2 else wave2, 200, front=[('straw_hat', 13, 3), ('suitcase', 0, 30)], back=[('sun', 38, -6, i * 0.3)]) for i in range(4)
    ]))

    # 축하해요: 폭죽 빵 + 꽃가루
    E.append(emoticon('축하', 'steelman-congrats', '축하해요', 'P', [
        fr(idle, 160, front=[('popper', 36, 26)]),
        fr(face(idle, eyes='happy', mouth='open'), 100, front=[('popper', 36, 26), ('burst_at', 36, 8, 7, 'W', 'Y', 'R')]),
        fr(face(idle, eyes='happy', mouth='open'), 160, back=[('confetti', -6, -2, 51, 18, 60, 44)], front=[('popper', 36, 26)]),
        fr(happy5, 600, back=[('confetti', -6, -2, 52, 18, 60, 44)], front=[('popper', 36, 26)]),
    ]))
    return E
