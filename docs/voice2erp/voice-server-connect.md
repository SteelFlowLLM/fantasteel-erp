# 음성 서버 켜기·연결하기

ERP의 음성 인식(회의록 음성 등록)은 OpenAI 호환 `POST /v1/audio/transcriptions`를 여는 서버에 붙는다. 문서에 없는 기능(이슈 #432·#445·#450)이고, 관리 › **AI 연결 › 음성 인식 (STT)** 카드에서 설정한다.

**LLM(LM Studio 등)을 API로 바꿔도 음성은 이 설정을 따로 쓴다.** 두 설정은 저장도 따로다(`storage/settings/llm.json`·`stt.json`).

## 한눈에

- 받아쓰기는 **whisper.cpp**(`whisper-server`, Homebrew `whisper-cpp`)와 ggml 모델 파일로 한다. Spokenly 같은 받아쓰기 앱을 쓰는 것이 아니라, 그 앱이 받아 둔 모델 파일(`whisper-ggml-large-v3-turbo-q5_0.bin`)을 같이 쓸 수 있을 뿐이다.
- **화자 분리**(누가 말했는지)는 whisper만으로는 안 되고 `tools/voice-sidecar`(8001)가 한다. whisper로 받아쓰고 pyannote로 화자를 붙인다.
- 내 Mac을 **음성 API 서버**로 연다: whisper.cpp는 이 Mac 안(127.0.0.1:8000)에서만 열고, 밖에는 **API 키**를 검사하는 사이드카(0.0.0.0:8001)만 연다. 다른 PC·다른 곳의 ERP 서버는 주소와 키로 붙는다. 외부 회사 서버는 쓰지 않는다.

## 모델 (사이드카가 알려 주는 목록)

ERP 카드에서 **연결 확인**을 누르면 아래 목록이 모델 고르기 칸에 나온다(`GET /v1/models`). 지금 못 쓰는 모델은 이유가 붙는다.

| id | 화면 이름 | 하는 일 |
| --- | --- | --- |
| `whisper-pyannote` (기본) | 받아쓰기 + 화자 분리 (whisper + pyannote) | 회의록용. 34분 회의 약 1분 |
| `whisper` | 받아쓰기만 (whisper, 빠름) | 화자 없이 글만 |
| `vibevoice` | 받아쓰기 + 화자 분리 (VibeVoice, 느림) | 한 모델로 둘 다. 느리고 한국어는 whisper보다 낮을 수 있다 |

## 내 Mac에서 켜기

### 자동 켜기 (추천, 한 번만)

Mac의 **터미널**을 열고 저장소 폴더에서 한 번 실행한다. 그 뒤로는 로그인하면 저절로 켜지고, 멈추면 다시 켜진다(macOS LaunchAgent `com.fantasteel.voice`).

```bash
cd ~/Documents/GitHub/fantasteel-erp
tools/voice-sidecar/start.sh --install     # 다른 PC(같은 망·Tailscale)에서도 붙게 (API 키)
tools/voice-sidecar/start.sh --status      # 켜졌는지, ERP에 넣을 주소·키 파일 위치
tools/voice-sidecar/start.sh --uninstall   # 끄고 자동 켜기를 지운다
```

- macOS 개인정보 보호 때문에 자동 켜기는 `~/Documents`(저장소)와 다른 앱 폴더(Spokenly)를 읽지 못한다. 그래서 `--install`은 `start.sh`·`server.py`를 `~/Library/Application Support/fantasteel-voice/`에 복사하고, 모델이 Spokenly 폴더에만 있으면 그 파일(약 550MB)도 한 번 복사한다. 화자 분리용 `HF_TOKEN`은 `server/.env`에서 읽어 같은 폴더의 `env`(본인만 읽기)에 둔다.
- **코드를 새로 받았으면 `--install`을 다시** 하면 새 코드로 바뀐다.
- 로그: `~/Library/Logs/fantasteel-voice.log`(켜질 때 5MB를 넘으면 `.log.1` 하나만 남기고 새로 쓴다). 자동 켜기는 API 키를 로그에 남기지 않는다. 키는 `cat ~/.config/fantasteel-voice/api-key`로 본다.
- ERP 서버도 이 Mac이면 AI 연결 화면의 **이 Mac의 음성 서버** 카드에서 켜고 끌 수 있다. 끄면 다음 로그인 때 다시 켜진다. ERP 서버가 다른 컴퓨터면 그 컴퓨터가 내 Mac의 프로그램을 켤 길은 없으므로(그런 길은 보안 구멍이다) 이 카드는 보이지 않는다.
- 다른 PC에 열 필요가 없으면 `--install --local`(이 Mac에서만, 키 없음).
- 포트를 바꾸려면 `SIDECAR_PORT=8101 tools/voice-sidecar/start.sh --install`. 등록 파일에 적혀 ERP 카드도 같은 포트로 상태를 본다.
- 복사본(`~/Library/Application Support/fantasteel-voice/start.sh`)으로 다시 설치해도 기존 `HF_TOKEN`을 그대로 쓴다.

### 터미널에서 직접 켜기

```bash
tools/voice-sidecar/start.sh            # 창을 켜 둔다. 끄기: Ctrl+C (whisper.cpp도 같이 꺼진다)
tools/voice-sidecar/start.sh --local    # 이 Mac에서만 (키 없음)
```

터미널에 이렇게 나온다. 이 주소와 키를 ERP 카드에 넣는다.

```
ERP 음성 인식 카드에 넣을 주소 (방식: 내 음성 서버)
  같은 망:   http://192.168.x.x:8001/v1
  Tailscale: http://100.x.x.x:8001/v1
  이 Mac:    http://127.0.0.1:8001/v1

ERP에 넣을 API 키: fsv-…
(저장 위치: ~/.config/fantasteel-voice/api-key)
```

- 키는 처음 켤 때 만들어 `~/.config/fantasteel-voice/api-key`(본인만 읽기)에 두고, 다음부터 같은 키를 쓴다(자동 켜기도 같은 키). 바꾸려면 그 파일을 지우고 다시 켠다. `SIDECAR_API_KEY=…`로 직접 정해도 된다.
- **ERP 서버도 이 Mac이면** `tools/voice-sidecar/start.sh --local`로 켜고 주소 `http://127.0.0.1:8001/v1`, 키는 비워 둔다(이 Mac 밖에는 열지 않는다). 전에 다른 PC용으로 켜서 키 파일이 남아 있어도 `--local`은 키를 요구하지 않는다.
- 모델 파일은 `WHISPER_MODEL=경로` → `~/models/ggml-large-v3-turbo*.bin` → `~/models/ggml-*.bin` → 자동 켜기가 복사해 둔 파일 → Spokenly가 받아 둔 파일 순서로 찾는다. `~/models/ggml-silero-*.bin`이 있으면 VAD(소리 없는 구간 건너뛰기)를 켠다.
- 필요한 것: `brew install whisper-cpp ffmpeg`, 파이썬 환경 `~/voice-env`([tools/voice-sidecar/README.md](../../tools/voice-sidecar/README.md)), 화자 분리용 `HF_TOKEN`(`server/.env`).

## ERP에 연결

1. 관리 › AI 연결 › 음성 인식 (STT): 방식 **내 음성 서버**, 주소(같은 망이면 192.168.x.x, 다른 망이면 Tailscale 100.x.x.x), **API 키**에 터미널의 키.
2. **연결 확인** → 모델 고르기(회의록이면 "받아쓰기 + 화자 분리") → **저장** → **파일로 시험**.

연결 확인은 먼저 모델 목록을 받고(주소·키 확인), 1초 무음 WAV를 실제로 보내 받아쓰기 엔진까지 본다. 사이드카는 3초보다 짧은 소리에는 화자 분리를 하지 않아 확인이 1초 안팎이다(whisper가 모델을 처음 올릴 때만 더 걸린다).

| 화면에 보이는 이유 | 보통 원인 |
| --- | --- |
| 이 음성 서버는 API 키가 필요해요 | 키 칸이 비었다. 터미널의 "ERP에 넣을 API 키"를 넣는다 |
| API 키가 맞지 않거나 권한이 없어요 | 키가 틀렸다(키 파일을 지우고 새로 만들었다면 새 키) |
| 연결을 거절했어요 | 음성 서버가 꺼져 있다, 포트가 다르다, `--local`로 켰는데 다른 PC에서 부른다 |
| 길이 닿지 않아요 | 그 Mac이 꺼졌다·잠들었다·다른 망이다, 방화벽이 막는다, Tailscale이 끊겼다 |
| 주소를 찾을 수 없어요 | 이름 철자 오류, Tailscale 이름인데 ERP 서버 쪽 Tailscale이 꺼져 있다 |
| …을 찾지 못했어요 | 주소 끝의 `/v1`이 빠졌다, 모델 이름이 틀렸다 |
| 지금 다른 녹음을 받아쓰는 중이에요 (HTTP 503) | 음성 서버는 한 번에 하나만 받아쓴다. 주소·키는 맞으니 끝난 뒤 다시 누른다 |
| whisper 서버에 연결할 수 없어요 | 사이드카만 켜지고 whisper.cpp가 꺼졌다(`start.sh`로 켜면 같이 켜진다) |

## 다른 망에서 붙기 (Tailscale)

ERP 서버 컴퓨터와 음성 서버 Mac 둘 다 [Tailscale](https://tailscale.com)에 같은 계정으로 로그인한다. Mac에서 `tailscale ip -4`가 `100.x.x.x`를 보여 주면 그 주소(또는 MagicDNS 이름 `…ts.net`)를 쓴다. 공유기·방화벽을 열 필요가 없다.

**Tailscale Funnel·Serve로 8001을 인터넷에 내놓지 않는다.** Funnel은 Tailscale 밖 누구나 들어올 수 있는 공개 주소다. 회의 음성이 오가므로 tailnet 안에서만 쓴다.

## 보안

- whisper.cpp(8000)에는 키 기능이 없어 `start.sh`는 127.0.0.1에만 연다. 밖에서는 키를 검사하는 사이드카(8001)만 닿는다. 키가 틀리면 음성 파일을 받기 전에 401로 끊는다.
- macOS 방화벽이 꺼져 있으면 같은 망 누구나 열린 포트에 닿는다. 그래서 다른 PC에 열 때는 키가 꼭 있어야 하고, 없으면 사이드카가 만든다.
- 음성은 Mac의 임시 폴더에만 두고 요청이 끝나면 지운다. 음성·전사 내용은 로그에 남기지 않는다.
- ERP는 링크 로컬(`169.254.x.x`)·클라우드 메타데이터 주소와 주소 안의 아이디·비밀번호를 받지 않는다. 저장된 API 키는 주소의 출처가 같을 때만 쓰므로, 주소를 바꾸면 키를 다시 넣는다. 키는 서버 파일(`storage/settings/stt.json`)에만 두고 화면에는 다시 보내지 않는다.
- OpenAI 방식 음성 API를 고르면 회의 음성이 그 회사 서버로 나간다. 사내 방침을 먼저 정한다.
