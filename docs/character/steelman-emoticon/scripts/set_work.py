"""묶음 '철강맨 업무' (steelman-work): 1차 8종 + 2차 10종. 키는 shared MESSAGE_EMOTICONS와 같다."""
from PIL import Image

from emoticon_lib import PROPS, emoticon, face, flatten, flip, fr, heat, nod, prop, roll_disc


def build(sh):
    G = sh.get
    idle, blink2 = G(0, 0), G(1, 2)
    happy = [G(4, i) for i in range(6)]
    happy0 = happy[0]
    wave1, wave2, wave3 = G(5, 1), G(5, 2), G(5, 3)
    land0, land1 = G(10, 0), G(10, 1)
    sur0, sur1 = G(12, 0), G(12, 1)
    walk = [G(2, i) for i in range(6)]
    talk1 = G(3, 1)
    think = [G(7, i) for i in range(4)]

    E = []

    # ── 1차 ────────────────────────────────────────────
    E.append(emoticon('확인', 'steelman-ok', '확인!', 'O', [
        fr(idle, 160), fr(wave1, 120),
        fr(wave2, 140, front=[('spark_s', 42, 12)]),
        fr(wave2, 140, front=[('spark_l', 41, 11)]),
        fr(wave2, 140, front=[('spark_s', 42, 12)]),
        fr(wave2, 500),
    ]))
    E.append(emoticon('넵넵', 'steelman-yes', '넵넵', 'W', [
        fr(idle, 120),
        fr(nod(happy0, 2), 70), fr(nod(happy0, 3), 110), fr(idle, 80),
        fr(nod(happy0, 2), 70), fr(nod(happy0, 3), 110), fr(idle, 80),
        fr(happy0, 600),
    ]))
    E.append(emoticon('감사', 'steelman-thanks', '감사합니다', 'W', [
        fr(idle, 220), fr(nod(happy0, 2), 90), fr(nod(happy0, 4, helmet_extra=1), 90),
        fr(nod(happy0, 5, helmet_extra=2), 700, front=[('spark_s', 4, 18), ('spark_s', 41, 18)]),
        fr(nod(happy0, 2), 100), fr(happy0, 500),
    ]))
    flat1 = flatten(land0, 0.78, 1.08)
    flat2 = flatten(land0, 0.72, 1.12)
    E.append(emoticon('죄송', 'steelman-sorry', '죄송합니다', 'W', [
        fr(idle, 160), fr(land1, 90), fr(land0, 100), fr(flat1, 120),
        fr(flat2, 260, front=[('sweat', 38, 18)]),
        fr(flat2, 260, front=[('sweat', 38, 20), ('sweat', 6, 22)]),
        fr(flat1, 260, front=[('sweat', 38, 22), ('sweat', 6, 24)]),
        fr(flat2, 400, front=[('sweat', 6, 26)]),
    ]))
    E.append(emoticon('결재', 'steelman-approve', '결재 완료', 'R', [
        fr(idle, 160),
        fr(wave1, 140, front=[('stamp', 36, 6)]),
        fr(wave2, 200, front=[('stamp', 36, 2)]),
        fr(land0, 80, front=[('stamp', 40, 33), ('spark_l', 52, 28), ('spark_l', 34, 30), ('spark_s', 53, 40)], shake=(1, 0)),
        fr(land0, 80, front=[('stamp', 40, 33), ('spark_s', 52, 29)], shake=(-1, 0)),
        fr(wave3, 700, front=[('mark', 38, 30), ('stamp', 36, 3)]),
    ]))
    E.append(emoticon('최고', 'steelman-best', '최고', 'Y', [
        fr(idle, 160),
        fr(talk1, 120, front=[('thumb', 36, 26)]),
        fr(talk1, 80, back=[('burst', 8)], front=[('thumb', 36, 25)]),
        fr(talk1, 80, back=[('burst', 13)], front=[('thumb', 36, 25)]),
        fr(talk1, 80, back=[('burst', 18)], front=[('thumb', 36, 25)]),
        fr(talk1, 120, back=[('burst_dim', 22)], front=[('thumb', 36, 25)]),
        fr(talk1, 500, front=[('thumb', 36, 26), ('spark_s', 43, 21)]),
    ]))
    hook_top = -len(PROPS['hook'])
    E.append(emoticon('헉', 'steelman-gasp', '헉!', 'W', [
        fr(idle, 200, front=[('hook', 25, hook_top - 6)]),
        fr(idle, 90, front=[('hook', 25, hook_top + 4)]),
        fr(blink2, 90, front=[('hook', 25, hook_top + 12)]),
        fr(sur0, 90, front=[('hook', 25, hook_top + 10), ('spark_l', 22, 2), ('spark_s', 40, 4)], shake=(1, 0)),
        fr(sur1, 90, front=[('hook', 25, hook_top + 10), ('spark_s', 21, 3)], shake=(-1, 0)),
        fr(sur1, 300, front=[('hook', 25, hook_top + 10), ('sweat', 8, 18)]),
        fr(sur0, 400, front=[('hook', 25, hook_top + 10), ('sweat', 8, 21)]),
    ], align='left'))
    run = []
    for i in range(12):
        sp = [('speed', -6 + (i % 3) * -2, 22), ('speed_s', -2 + (i % 3) * -2, 30), ('speed', -6 + ((i + 1) % 3) * -2, 38)]
        dust = [('dust', 8 - (i % 4) * 3, 42)] if i % 4 < 3 else [('dust_s', 2, 43)]
        run.append(fr(walk[i % 6], 70, back=sp + dust, cx=-1 if i % 2 else 0))
    E.append(emoticon('퇴근', 'steelman-off', '퇴근!', 'O', [
        fr(wave1, 160), fr(wave2, 160), fr(wave1, 160), fr(wave2, 160),
    ] + run))

    # ── 2차 ────────────────────────────────────────────
    # 확인 중: 턱 괴고 생각하며 돋보기로 밀시트 훑기
    sweep = [0, 2, 4, 6, 4, 2, 0, 2]
    E.append(emoticon('확인 중', 'steelman-checking', '확인 중', 'W', [
        fr(think[i % 3], 150, front=[('paper', 2, 27), ('magnifier', sweep[i], 24)]) for i in range(8)
    ] + [fr(think[3], 400, front=[('paper', 2, 27), ('magnifier', 3, 24), ('spark_s', 12, 22)])]))

    # 검토 부탁드려요: 결재판을 두 손으로 내밀고 꾸벅
    bow = face(idle, eyes='happy')
    E.append(emoticon('검토 부탁', 'steelman-review', ['검토', '부탁드려요'], 'W', [
        fr(idle, 200, front=[('board', 18, 31)]),
        fr(nod(bow, 2), 110, front=[('board', 18, 30)]),
        fr(nod(bow, 4, helmet_extra=1), 600, front=[('board', 18, 29), ('spark_s', 6, 20), ('spark_s', 40, 20)]),
        fr(nod(bow, 2), 110, front=[('board', 18, 30)]),
        fr(bow, 400, front=[('board', 18, 31)]),
    ]))

    # 반려: 도장 쾅 → 빨간 X
    sulky = face(wave1, eyes='tired', mouth='flat')
    E.append(emoticon('반려', 'steelman-reject', '반려', 'R', [
        fr(idle, 160),
        fr(wave1, 140, front=[('stamp', 36, 6)]),
        fr(wave2, 200, front=[('stamp', 36, 2)]),
        fr(land0, 80, front=[('stamp', 40, 33), ('spark_l', 52, 28), ('spark_s', 34, 30)], shake=(1, 0)),
        fr(land0, 80, front=[('stamp', 40, 33)], shake=(-1, 0)),
        fr(sulky, 700, front=[('xmark', 38, 30), ('stamp', 36, 3)]),
    ]))

    # 완료!: 만세 점프 + 체크 뿅
    E.append(emoticon('완료', 'steelman-done', '완료!', 'E', [
        fr(idle, 120), fr(happy[0], 90), fr(happy[1], 100),
        fr(happy[2], 120, front=[('check', 37, 10)]),
        fr(happy[3], 120, front=[('check', 37, 8), ('spark_l', 48, 4)]),
        fr(happy[4], 100, front=[('check', 37, 8)]),
        fr(happy[5], 600, front=[('check', 37, 8), ('spark_s', 49, 6)]),
    ]))

    # 긴급: 머리 위 경광등이 번쩍이고 제자리에서 동동
    frames = []
    for i in range(12):
        w = walk[i % 6]
        top = w.getbbox()[1]
        on = i % 2 == 0
        front = [('siren' if on else 'siren_off', 19, top - 6)]
        if on:
            front += [('ray_l', 15, top - 4), ('ray_r', 29, top - 4)]
        if i % 6 == 3:
            front.append(('sweat', 6, 18))
        frames.append(fr(w, 80, front=front, cx=-1 if i % 2 else 0))
    E.append(emoticon('긴급', 'steelman-urgent', '긴급', 'R', frames))

    # 잠시만요: 손바닥을 내밀며 멈춤
    talk = face(idle, mouth='o')
    hush = face(idle, mouth='flat')
    E.append(emoticon('잠시만요', 'steelman-wait', '잠시만요', 'W', [
        fr(idle, 150),
        fr(talk, 110, front=[('palm', 18, 31)]),
        fr(hush, 110, front=[('palm', 18, 28)]),
        fr(talk, 110, front=[('palm', 19, 28)]),
        fr(hush, 110, front=[('palm', 18, 28)]),
        fr(hush, 600, front=[('palm', 18, 28), ('spark_s', 33, 26)]),
    ]))

    # 화이팅: 망치 든 주먹을 두 번 번쩍
    E.append(emoticon('화이팅', 'steelman-fighting', '화이팅', 'O', [
        fr(idle, 140),
        fr(wave1, 120, front=[('hammer', 37, 9)]),
        fr(wave2, 120, front=[('hammer', 37, 5), ('spark_l', 47, 1)]),
        fr(wave1, 120, front=[('hammer', 37, 9)]),
        fr(wave2, 100, front=[('hammer', 37, 5), ('burst_at', 35, -7, 7)]),
        fr(wave3, 100, front=[('hammer', 37, 5), ('burst_at', 33, -9, 9, 'y', 'Y', 'D')]),
        fr(wave3, 500, front=[('hammer', 37, 6), ('spark_s', 48, 2)]),
    ]))

    # 수고하셨습니다: 깊이 꾸벅 + 하트 퐁
    E.append(emoticon('수고하셨습니다', 'steelman-well-done', ['수고', '하셨습니다'], 'Y', [
        fr(idle, 200),
        fr(nod(bow, 3), 90),
        fr(nod(bow, 5, helmet_extra=2), 90),
        fr(nod(bow, 6, helmet_extra=3), 600, front=[('spark_s', 4, 20), ('spark_s', 41, 20), ('heart_s', 37, 10)]),
        fr(nod(bow, 2), 100, front=[('heart_s', 38, 6)]),
        fr(bow, 450, front=[('heart_s', 39, 2)]),
    ]))

    # 열연 중: 달아오른 철강맨이 롤러 위를 달림 (열간 압연 = 열심히 일하는 중)
    hot = [heat(w, 0.55) for w in walk]
    frames = []
    for i in range(12):
        phase = i * 0.5
        back = [('puff_s', 12 + (i % 3) * 8, 4 - (i % 4) * 2), ('puff', 26 - (i % 2) * 6, 2 - (i % 3) * 2)]
        front = [('img', x, 43, roll_disc(phase)) for x in (-8, 6, 20, 34, 48)]
        front += [('spark_s', 4 + (i * 7) % 36, 40)]
        frames.append(fr(hot[i % 6], 70, back=back + [('speed', -6, 24 + (i % 2) * 6)], front=front, cx=-1 if i % 2 else 0))
    E.append(emoticon('열연 중', 'steelman-hot-rolling', '열연 중', 'O', frames))

    # 쇠뿔도 단김에: 앞의 모루 위 달군 쇠를 망치로 땅땅
    up = flip(wave1)
    hit = flip(land0)
    hammer_up = flip(prop('hammer'))
    hammer_down = hammer_up.transpose(Image.FLIP_TOP_BOTTOM)   # 내리칠 때는 머리가 아래로
    bar = [('anvil', -7, 38), ('hotbar', -4, 34)]
    E.append(emoticon('쇠뿔도 단김에', 'steelman-strike', ['쇠뿔도', '단김에'], 'O', [
        fr(up, 160, front=bar + [('img', 1, 8, hammer_up)]),
        fr(hit, 80, front=bar + [('img', -3, 23, hammer_down), ('burst_at', -9, 23, 8)], shake=(1, 0)),
        fr(up, 130, front=bar + [('img', 1, 8, hammer_up)]),
        fr(hit, 80, front=bar + [('img', -3, 23, hammer_down), ('burst_at', -11, 21, 10, 'y', 'Y', 'D')], shake=(-1, 0)),
        fr(up, 500, front=bar + [('img', 1, 8, hammer_up), ('spark_s', -2, 29)]),
    ]))

    # ── 3차 ────────────────────────────────────────────
    point = [G(6, i) for i in range(3)]

    # 알잘딱깔센: 흩어진 서류가 날아와 딱 쌓임
    fly = [[(-6, 6), (46, 2), (-4, 30)], [(4, 14), (42, 12), (6, 30)], [(24, 22), (38, 20), (22, 30)]]
    stack = [('paper', 37, 26), ('paper', 38, 29), ('paper', 37, 32)]
    E.append(emoticon('알잘딱깔센', 'steelman-neat', '알잘딱깔센', 'W', [
        fr(idle, 140, front=[('paper', x, y) for x, y in fly[0]]),
        fr(idle, 110, front=[('paper', x, y) for x, y in fly[1]]),
        fr(face(idle, eyes='happy'), 110, front=[('paper', x, y) for x, y in fly[2]]),
        fr(wave3, 120, front=stack + [('spark_l', 46, 20)]),
        fr(wave3, 600, front=stack + [('spark_s', 47, 22), ('spark_s', 33, 22)]),
    ]))

    # 정중한 거절: 꾸벅 + 작은 X, 땀
    E.append(emoticon('정중한 거절', 'steelman-decline', ['죄송하지만', '어렵겠습니다'], 'W', [
        fr(idle, 160),
        fr(nod(bow, 2), 90),
        fr(nod(bow, 4, helmet_extra=1), 650, front=[('xsmall', 40, 14), ('sweat', 5, 20)]),
        fr(nod(bow, 2), 100, front=[('xsmall', 40, 14)]),
        fr(face(idle, eyes='happy', mouth='flat'), 450, front=[('xsmall', 40, 14), ('sweat', 5, 22)]),
    ]))

    # 안전제일: 안전모에 손을 얹고 초록 십자 반짝
    E.append(emoticon('안전제일', 'steelman-safety-first', '안전제일', 'E', [
        fr(idle, 150, back=[('cross', -7, 24)]),
        fr(wave1, 120, back=[('cross', -7, 24)]),
        fr(wave2, 140, back=[('cross', -7, 24)], front=[('spark_s', 30, 6)]),
        fr(wave2, 140, back=[('cross', -7, 24)], front=[('spark_l', 29, 5)]),
        fr(wave2, 500, back=[('cross', -7, 24)], front=[('spark_s', 30, 6), ('spark_s', -4, 20)]),
    ]))

    # 확인 좋아!: 팔을 쭉 뻗어 가리키며 반짝 (지적확인)
    E.append(emoticon('확인 좋아', 'steelman-point-check', '확인 좋아!', 'O', [
        fr(idle, 150),
        fr(point[0], 100),
        fr(point[1], 100),
        fr(point[2], 120, front=[('spark_l', 45, 29)], shake=(1, 0)),
        fr(point[2], 500, front=[('spark_s', 46, 30), ('spark_s', 44, 22)]),
    ]))

    # 합격!: 돋보기로 살피고 초록 도장 자국 + 점프
    look = [('paper', 2, 27)]
    E.append(emoticon('합격', 'steelman-pass', '합격!', 'E', [
        fr(think[0], 150, front=look + [('magnifier', 1, 24)]),
        fr(think[1], 150, front=look + [('magnifier', 5, 24)]),
        fr(happy[2], 120, front=[('mark', 37, 26, 'E'), ('spark_l', 48, 18)]),
        fr(happy[3], 120, front=[('mark', 37, 26, 'E')]),
        fr(happy[5], 600, front=[('mark', 37, 26, 'E'), ('spark_s', 49, 20)]),
    ]))

    # 불합격: 돋보기로 살피다 빨간 X, 축 처짐
    down = flatten(face(idle, eyes='tired', mouth='frown'), 0.93, 1.03)
    E.append(emoticon('불합격', 'steelman-fail', '불합격', 'R', [
        fr(think[0], 150, front=look + [('magnifier', 1, 24)]),
        fr(think[1], 150, front=look + [('magnifier', 5, 24)]),
        fr(face(idle, eyes='dot', mouth='o'), 120, front=[('xmark', 37, 26)], shake=(1, 0)),
        fr(down, 600, front=[('xmark', 37, 26), ('sweat', 6, 22)]),
    ]))

    # 납기 준수!: 달력에 동그라미 + 신나는 점프
    cal = [('calendar', -7, 22)]
    E.append(emoticon('납기 준수', 'steelman-on-time', '납기 준수!', 'O', [
        fr(idle, 150, back=cal),
        fr(idle, 120, back=cal + [('circle_r', -3, 30)]),
        fr(happy[1], 110, back=cal + [('circle_r', -3, 30)], front=[('spark_s', 44, 8)]),
        fr(happy[2], 110, back=cal + [('circle_r', -3, 30)], front=[('spark_l', 44, 4)]),
        fr(happy[4], 100, back=cal + [('circle_r', -3, 30)]),
        fr(happy[5], 500, back=cal + [('circle_r', -3, 30)], front=[('spark_s', 45, 10)]),
    ]))

    # 점심 식사: 밥그릇 들고 냠냠 (상태 알림용)
    chew_a = face(idle, eyes='happy', mouth='o')
    chew_b = face(idle, eyes='happy', mouth='smile')
    E.append(emoticon('점심 식사', 'steelman-lunch', '점심 식사', 'W', [
        fr(chew_a if i % 2 else chew_b, 200, front=[('bowl', 16, 32), ('spoon', 27 if i % 2 else 31, 26 if i % 2 else 29)]) for i in range(6)
    ]))

    # 자리 비움: 걸어 나가고 빈 의자만
    frames = [fr(walk[i % 6], 90, char_at=(i * 7, 0), back=[('chair_l', 13, 31)]) for i in range(7)]
    frames += [fr(None, 500, back=[('chair_l', 13, 31)], front=[('ellipsis', 22, 22)]),
               fr(None, 500, back=[('chair_l', 13, 31)])]
    E.append(emoticon('자리 비움', 'steelman-away', '자리 비움', 'W', frames))

    # 회의 중: 결재판 끼고 종종걸음, 말풍선 점점점
    E.append(emoticon('회의 중', 'steelman-meeting', '회의 중', 'W', [
        fr(walk[i % 6], 100, front=[('board', 33, 30)] + ([('ellipsis', 22, 2)] if i % 4 < 2 else []), cx=-1 if i % 2 else 0)
        for i in range(12)
    ]))

    # 외근 중: 서류 가방 들고 바쁘게, 속도선·먼지
    E.append(emoticon('외근 중', 'steelman-outside', '외근 중', 'W', [
        fr(walk[i % 6], 80, back=[('speed', -6 - (i % 3) * 2, 24), ('speed_s', -2 - (i % 3) * 2, 34), ('dust_s', 6 - (i % 3) * 3, 43)],
           front=[('briefcase', 35, 33)], cx=-1 if i % 2 else 0)
        for i in range(12)
    ]))
    return E
