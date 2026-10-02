# 철강맨 캐릭터 디자인

FantaSteel ERP의 AI 어시스턴트 옆에 붙일 캐릭터 "철강맨"의 도트(픽셀) 디자인입니다.
원본 디자인 `steelman.png`(주황 안전모 + 흰 얼굴 + 고글)를 Aseprite로 도트화했습니다.

- 디자인만 만들어 둔 상태입니다. 화면(`client/`)에는 아직 적용하지 않았습니다.
- 모든 `.aseprite` 파일은 Aseprite에서 열어 레이어·프레임·태그 단위로 고칠 수 있습니다.

## 진행 순서

| 단계 | 폴더 | 내용 |
|---|---|---|
| ① | `steelman-pixel/` | 원본을 32×32로 옮긴 고글 버전. 표정 8종(미소·활짝·신남·씩·놀람·갸웃·머쓱·메롱) |
| ② | `steelman-pixel/sizes/` | 더 작고 통통하게 다시 그림. 12·16·20·24px × 고글 버전 / 눈 버전 |
| ③ | `steelman-pixel/motion/` | **24px 눈 버전으로 확정.** 얼굴이 모찌처럼 말랑한 기분별 모션 8종 |
| ④ | `steelman-pixel/assistant/` | AI 어시스턴트 대화 상황 15종 × 시안 2~3개(총 44개) + 버튼·아바타 아이콘 |

## 확정한 기본 디자인 (24px 눈 버전)

- 고글을 빼고 세로로 긴 눈(2×3)을 그렸고, 분홍 볼터치를 더했습니다.
- 헬멧을 크게, 얼굴을 넓고 납작하게 그려 통통한 느낌을 냈습니다.
- 말랑한 움직임: 얼굴 아래를 바닥에 고정하고, 납작해질 때는 옆으로 퍼지고 늘어날 때는 좁아집니다. 헬멧은 얼굴 윗면을 따라 움직입니다.

### 색

| 이름 | 값 | 쓰는 곳 |
|---|---|---|
| 네이비 | `#1b2531` | 배경, 눈·입, 외곽선 |
| 주황 | `#e07028` | 헬멧 |
| 진한 주황 | `#af5d2a` | 헬멧 줄무늬 |
| 밝은 주황 | `#f08a45` | 헬멧 하이라이트 |
| 흰색 / 연회색 | `#ffffff` / `#c9d3de` | 얼굴 / 턱 그림자 |
| 분홍 | `#f5a3a3` | 볼터치, 혀 |

소품용 색(노랑·회색·빨강·초록·하늘색·크림색 등)은 `steelman-pixel/scripts/gen_assistant.py`의 `PAL`에 있습니다.

## ③ 기분별 모션 (`motion/`)

기본 · 깜빡 · 기쁨 · 말랑 · 놀람 · 슬픔 · 졸림 · 말하기. 모션마다 Aseprite 태그가 있고 프레임마다 재생 시간이 들어 있습니다.

## ④ AI 어시스턴트 시안 (`assistant/`)

AI가 도구로 자료를 찾고, 못 찾고, 찾은 결과를 보여 주는 대화 흐름에 맞춘 시안입니다. 상황마다 A/B/C 중 하나를 골라 씁니다.
상황 목록·쓰는 때·진행 상태는 [`ai-assistant-situations.md`](ai-assistant-situations.md)에 있습니다.

| 파일 | 내용 |
|---|---|
| `steelman_assistant.aseprite` | 시안 44개. 태그 = `상황 시안`(예: `생각 중 A`). 레이어: 배경 · 그림자 · 외곽선 · 몸 · 헬멧 · 표정 · 효과 |
| `overview.png` / `overview_transparent.png` | 이름표를 붙인 한눈에 보기 |
| `gif/` · `gif_transparent/` | 시안별 GIF, 8배 확대 |
| `sheet/` | 스프라이트 시트(한 줄에 시안 하나) + 프레임 위치·재생 시간·태그 json |
| `icons/` | 정지 아이콘 16px(상단 바 버튼) · 20px(대화 아바타) · 24px(배너), 배경 있음 / 투명 |

- 투명 버전은 `배경`·`그림자` 레이어를 끈 것입니다. 흰 패널 위에서도 보이도록 네이비 외곽선 레이어를 따로 둡니다.
- 말풍선·돋보기·책·상자·연필·모래시계·자물쇠·공사 표지판 같은 소품과 그림자·반짝이·눈물·땀방울은 원본에 없어서 새로 그렸습니다.

## 다시 만들기 (`steelman-pixel/scripts/`)

픽셀은 Python으로 정의하고, Aseprite Lua 스크립트로 `.aseprite` 파일을 만든 뒤 Aseprite CLI로 PNG·GIF·시트를 내보냅니다.
필요한 것: Aseprite(Steam판 경로 기본, `ASEPRITE` 환경 변수로 바꿀 수 있음), python3, Pillow.

| 스크립트 | 만드는 것 |
|---|---|
| `export_assistant.sh` | ④ 전체 (아래 `gen_assistant.py`·`gen_icons.py`·`review_assistant.py`를 차례로 실행) |
| `gen_assistant.py` | ④ 상황별 모션 `.aseprite` |
| `gen_icons.py` | ④ 아이콘 16·20·24px |
| `review_assistant.py` | ④ 이름표 붙은 한눈에 보기 |
| `gen_motion.py` | ③ 기분별 모션 `.aseprite` |
| `gen_small.py` / `gen_eyes.py` | ② 크기별 고글 버전 / 눈 버전 |
| `gen.py` | ① 32px 표정 8종 |

②·③·①은 `python3 <스크립트> <출력 .aseprite 또는 폴더> <출력 .lua>`로 Lua를 만든 뒤 `aseprite -b --script <출력 .lua>`로 실행합니다.
