"""묶음 '철강맨 행사' (steelman-event): 3차 6종 (명절·연말·생일·환영). 키는 shared MESSAGE_EMOTICONS와 같다."""
from emoticon_lib import emoticon, face, fr, nod


def build(sh):
    G = sh.get
    idle = G(0, 0)
    happy5 = G(4, 5)
    wave1, wave2 = G(5, 1), G(5, 2)
    bow = face(idle, eyes='happy')

    E = []

    # 새해 복 많이 받으세요: 복주머니 들고 꾸벅 + 작은 불꽃놀이
    E.append(emoticon('새해', 'steelman-new-year', ['새해 복', '많이 받으세요'], 'R', [
        fr(idle, 180, front=[('pouch', 19, 31)]),
        fr(nod(bow, 2), 90, front=[('pouch', 19, 31)]),
        fr(nod(bow, 4, helmet_extra=1), 600, front=[('pouch', 19, 30), ('burst_at', -7, 8, 5, 'W', 'R', 'r'), ('burst_at', 37, 6, 5, 'W', 'Y', 'O')]),
        fr(nod(bow, 2), 90, front=[('pouch', 19, 31)]),
        fr(bow, 450, front=[('pouch', 19, 31), ('spark_s', 44, 10), ('spark_s', 2, 12)]),
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
    return E
