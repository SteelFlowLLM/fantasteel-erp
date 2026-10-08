# 철강맨 메신저 이모티콘

메신저에서 보내는 움직이는 이모티콘 8종입니다 (18번, 문서에 없는 추가 기능). 카카오 이모티콘처럼 동작을 크게 하고 짧은 글자를 얹되, 그림과 대사는 철강 공장·결재 업무에 맞춰 새로 만들었습니다.

| 키 (`message.emoticon_key`) | 글자 | 동작 |
|---|---|---|
| `steelman-ok` | 확인! | 손을 번쩍 들고 반짝 |
| `steelman-yes` | 넵넵 | 빠르게 두 번 끄덕 |
| `steelman-thanks` | 감사합니다 | 꾸벅, 안전모가 살짝 미끄러짐 |
| `steelman-sorry` | 죄송합니다 | 납작 엎드리고 땀 |
| `steelman-approve` | 결재 완료 | 도장을 쾅 찍고 도장 자국 |
| `steelman-best` | 최고 | 엄지 척 + 용광로 불꽃 |
| `steelman-gasp` | 헉! | 크레인 갈고리가 툭 떨어짐 |
| `steelman-off` | 퇴근! | 손 흔들고 달리기 |

키와 이름 목록은 `shared/src/messenger.ts`의 `MESSAGE_EMOTICONS`입니다. 이모티콘을 더하면 여기와 그 목록을 함께 고칩니다.

## 규격

- 캔버스 64×64px, 투명 배경. 캐릭터는 48px 칸을 (8, 15)에 놓고, 위쪽에 12px 글자(네이비 1px 외곽선)를 얹습니다.
- 화면은 2배(128px)로 `image-rendering: pixelated`로 보여 줍니다. 크기는 48(글자 없음)·64·128(64를 Scale2x) 시안을 비교해서 64로 정했습니다(2026-10-08).
- 캐릭터: 노션 「디자인」 페이지의 펫 철강맨 신형 작업복 시트(`source/steelman_pet_sheet.png`, 칸 48px, 동작 17줄). 표정·몸은 시트 그대로 쓰고, 고개 숙이기·납작해지기만 시트 프레임을 잘라 옮겨 만들었습니다.
- 새로 그린 소품: 도장, 도장 자국, 크레인 갈고리, 엄지, 용광로 불꽃, 땀, 속도선, 먼지.

## 파일

| 파일 | 내용 |
|---|---|
| `steelman_emoticon_64.aseprite` | 원본. 태그 = 이모티콘 이름, 레이어 = 뒤효과 · 캐릭터 · 앞효과 · 글자. 프레임마다 재생 시간 |
| `gif/<키>.gif` | 움직임 (원본 크기) |
| `png/<키>.png` | 멈춘 그림 = 가장 오래 머무는 프레임 ('동작 줄이기'를 켠 사람에게 보임) |
| `sheet/` | 스프라이트 시트(한 줄에 이모티콘 하나) + 프레임 위치·재생 시간·태그 json |
| `source/steelman_pet_sheet.png` | 바탕 캐릭터 시트 |
| `scripts/` | 다시 만들기 |

화면은 `client/public/emoticons/<키>.gif`·`.png` 사본을 씁니다.

## 다시 만들기

```bash
./docs/character/steelman-emoticon/scripts/export_emoticon.sh
```

`gen_emoticon.py`가 프레임을 레이어 PNG로 만들고 Aseprite Lua로 `.aseprite`를 만든 뒤, Aseprite CLI로 GIF·시트를 내보내고 `client/public/emoticons/`로 복사합니다. 필요한 것: Aseprite(Steam판 경로 기본, `ASEPRITE`로 바꿀 수 있음), python3, Pillow. 글자 글꼴은 macOS 기본(Apple SD Gothic Neo 굵게)이고, 다른 OS는 `EMOTICON_FONT`(ttf 경로)·`EMOTICON_FONT_INDEX`로 바꿉니다.

Aseprite에서 `.aseprite`를 직접 고쳤다면 스크립트를 다시 돌리지 말고(덮어씀) Aseprite에서 GIF·PNG를 내보내 `gif/`·`png/`와 `client/public/emoticons/`에 넣습니다.

## 아쉬운 점

- 확인!은 경례가 아니라 손 번쩍입니다. 펫 시트에 경례 자세가 없습니다.
- 퇴근!은 안전모를 벗지 않습니다. 안전모 없는 머리는 새로 그려야 합니다.
- 글자는 도트 글꼴이 아니라 시스템 글꼴을 앤티에일리어싱 없이 쓴 것입니다.
