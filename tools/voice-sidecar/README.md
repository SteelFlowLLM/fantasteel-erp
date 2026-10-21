# Voice2ERP 화자 분리 사이드카

회의 음성을 글로 바꾸면서 **누가 말했는지(화자)** 도 나눠 주는 개발용 서버다. ERP 서버가 쓰는 OpenAI 호환 `POST /v1/audio/transcriptions`를 그대로 흉내 내고, 응답 구간마다 `speaker`('SPEAKER_1', 'SPEAKER_2' …, 처음 나온 순서)를 붙인다. 저장소의 TypeScript 빌드와는 무관한 도구이고 새로 설치할 패키지는 없다(`~/voice-env`에 이미 있는 것만 쓴다).

## 실행

```bash
tools/voice-sidecar/start.sh            # whisper.cpp(127.0.0.1:8000) + 사이드카(0.0.0.0:8001, API 키) 한 번에. 주소·키를 터미널에 보인다
tools/voice-sidecar/start.sh --local    # 이 컴퓨터에서만 (키 없음)
tools/voice-sidecar/start.sh --install  # 로그인 때 저절로 켜기 (LaunchAgent, --uninstall·--status)
sh tools/voice-sidecar/start.test.sh    # start.sh 시험 (launchctl은 부르지 않는다)
~/voice-env/bin/python tools/voice-sidecar/server.py     # 사이드카만 http://127.0.0.1:8001
curl http://127.0.0.1:8001/health
```

다른 PC·Tailscale의 ERP가 붙는 법은 [docs/voice2erp/voice-server-connect.md](../../docs/voice2erp/voice-server-connect.md).

필요한 것: ffmpeg(PATH), 파이썬 3.11 가상환경 `~/voice-env`(mlx-audio, pyannote.audio, torch, soundfile), 그리고 `whisper-pyannote`를 쓸 때 whisper.cpp 서버(`http://127.0.0.1:8000/v1`, [docs/backend/stt.md](../../docs/backend/stt.md)). 한 번에 요청 하나만 처리한다(나머지는 기다린다).

## 엔진 (요청의 `model` 값)

| model | 하는 일 |
| --- | --- |
| `whisper-pyannote` (기본) | whisper.cpp가 전사하고 pyannote `speaker-diarization-community-1`이 화자를 나눈다. 전사 구간마다 시간이 가장 많이 겹치는 화자를 붙인다. 3초보다 짧은 소리(ERP 연결 확인)는 화자를 나누지 않는다 |
| `whisper` | whisper.cpp로 받아쓰기만 한다(화자 없음) |
| `vibevoice` | VibeVoice-ASR MLX 4-bit(`~/.lmstudio/models/mlx-community/VibeVoice-ASR-4bit`) 한 모델이 전사와 화자 분리를 함께 한다. 느리다 |

pyannote 모델은 Hugging Face 토큰이 필요하다. `HF_TOKEN` 환경변수가 없으면 `server/.env`의 `HF_TOKEN=…` 줄을 읽는다(값은 출력·기록하지 않는다). 모델은 첫 요청에서 불러온다.

선택 환경변수: `SIDECAR_HOST`(127.0.0.1), `SIDECAR_PORT`(8001), `SIDECAR_API_KEY`, `SIDECAR_API_KEY_FILE`(`~/.config/fantasteel-voice/api-key`), `WHISPER_URL`, `PYANNOTE_PIPELINE`, `VIBEVOICE_MODEL`, `VIBEVOICE_MAX_TOKENS`(65536).

## ERP에 연결

관리자 화면 AI 연결 → 음성 인식(STT) 카드에서 서버 주소 `http://127.0.0.1:8001/v1`, 모델 `whisper-pyannote` 또는 `vibevoice`로 저장한다. 전사 요청 제한 시간은 60분이다. 연결 확인은 1초 무음을 보내므로 첫 확인은 모델을 불러오는 동안 오래 걸릴 수 있다. 전사가 끝나면 회의록 화면의 "화자 연결" 카드에서 화자를 참석자에게 이어 준다.

## 개인정보

- 음성은 이 컴퓨터 안에서만 처리하고 외부로 보내지 않는다(모델 내려받기 때 Hugging Face에 접속하는 것 제외).
- 업로드한 음성과 변환한 WAV는 임시 폴더에 두었다가 요청이 끝나면(성공·실패 모두) 지운다. 음성도 전사 내용도 로그에 남기지 않는다 (BP-VOC-01).
- 기본은 `127.0.0.1`에만 열린다. 다른 PC에 열면(`SIDECAR_HOST`가 127.0.0.1이 아니면) **API 키**가 꼭 있어야 하고, 없으면 만들어 키 파일에 둔다(처음부터 권한 600). 127.0.0.1로만 열면 `SIDECAR_API_KEY`를 직접 줄 때만 키를 요구한다(키 파일이 남아 있어도 읽지 않는다). 키 파일은 링크를 따라가지 않고, 남의 파일이라 권한을 못 바로잡으면 오류로 끝낸다. 키는 터미널에만 보이고 파일·로그로 가는 실행(자동 시작 등)에는 위치만 남긴다. 시험: `npm run test:voice`. 키가 있으면 `/v1/*` 요청 모두에 `Authorization: Bearer …`를 요구하고, 틀리면 본문을 읽기 전에 401로 끊는다. `/health`만 키 없이 `{"status":"ok"}`를 준다.
- whisper.cpp에는 키 기능이 없어 `start.sh`는 whisper.cpp를 127.0.0.1에만 연다.

## 모델 목록

`GET /v1/models` (키 필요): `{ "object": "list", "data": [ { "id": "whisper-pyannote", "label": "받아쓰기 + 화자 분리 (whisper + pyannote)", "diarization": true, "available": true, "note": null }, … ] }`. `available`은 whisper.cpp 포트가 열렸는지, `HF_TOKEN`이 있는지, VibeVoice 모델 폴더가 있는지로 정하고 모델을 불러 보지는 않는다. ERP 음성 인식 카드가 연결 확인 때 이 목록을 고르기 칸으로 보인다.

## 응답 모양

```json
{ "text": "…", "duration": 23.6, "segments": [ { "id": 0, "start": 0.0, "end": 4.2, "text": "…", "speaker": "SPEAKER_1" } ] }
```

오류는 `{ "error": { "message": "…" } }`와 4xx/5xx.
