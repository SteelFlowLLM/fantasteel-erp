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

필요한 것: ffmpeg(PATH), 파이썬 3.11 가상환경 `~/voice-env`(mlx-audio, pyannote.audio, torch, soundfile, numpy), 그리고 `whisper-pyannote`를 쓸 때 whisper.cpp 서버(`http://127.0.0.1:8000/v1`, [docs/backend/stt.md](../../docs/backend/stt.md)). 받아쓰기 엔진은 한 번에 하나만 돌고, 긴 회의는 조각마다 차례를 놓아 그 사이 짧은 요청(철강맨 부르기)을 먼저 처리한다(아래 '긴 회의').

**코드를 새로 받았으면** 자동 켜기는 `~/Library/Application Support/fantasteel-voice/`에 복사한 `server.py`를 돌리므로 `tools/voice-sidecar/start.sh --install`(다른 PC용) 또는 `--install --local`을 다시 해야 새 코드로 바뀐다. 받아쓰는 중에 하면 그 전사가 끊기니 ERP 회의록에 전사 중인 것이 없을 때 한다.

## 엔진 (요청의 `model` 값)

| model | 하는 일 |
| --- | --- |
| `whisper-pyannote` (기본) | whisper.cpp가 전사하고 pyannote `speaker-diarization-community-1`이 회의 전체에 한 번 화자를 나눈다. 전사 구간마다 시간이 가장 많이 겹치는 화자를 붙이고, 한 구간에 두 사람의 말이 섞였으면 낱말 시각으로 나눈다. 3초보다 짧은 소리(ERP 연결 확인)는 화자를 나누지 않는다 |
| `whisper` | whisper.cpp로 받아쓰기만 한다(화자 없음). 긴 녹음은 소리 크기로 말 없는 곳을 찾아 나눈다 |
| `vibevoice` | VibeVoice-ASR MLX 4-bit(`~/.lmstudio/models/mlx-community/VibeVoice-ASR-4bit`) 한 모델이 전사와 화자 분리를 함께 한다. 느리다 |

pyannote 모델은 Hugging Face 토큰이 필요하다. `HF_TOKEN` 환경변수가 없으면 `server/.env`의 `HF_TOKEN=…` 줄을 읽는다(값은 출력·기록하지 않는다). 모델은 첫 요청에서 불러온다.

선택 환경변수: `SIDECAR_HOST`(127.0.0.1), `SIDECAR_PORT`(8001), `SIDECAR_API_KEY`, `SIDECAR_API_KEY_FILE`(`~/.config/fantasteel-voice/api-key`), `WHISPER_URL`, `PYANNOTE_PIPELINE`, `VIBEVOICE_MODEL`, `VIBEVOICE_MAX_TOKENS`(65536), `SIDECAR_CHUNK_SEC`(180, 긴 회의 조각 길이), `SIDECAR_QUICK_WAIT_SEC`(15, 짧은 요청이 차례를 기다리는 최대 초), `SIDECAR_SPEAKER_MERGE`(0.85, 같은 사람으로 합칠 목소리 유사도).

## 긴 회의 (이슈 #522)

- 1분 이상인 녹음은 약 3분 조각으로 나눠 받아쓴다. 목표 시각 앞뒤 30초 안에서 아무도 말하지 않는 곳(화자 분리의 빈틈, `whisper`는 소리 크기)을 골라 자르고, 조각 시각은 회의 전체 시각으로 옮겨 잇는다. 조각 파일은 받아쓴 뒤 바로 지운다.
- 받아쓰기 엔진 차례는 조각 하나 동안만 쥔다. 그 사이 1분보다 짧은 요청이 기다리면 다음 조각보다 먼저 처리한다. 짧은 요청은 15초까지 기다리고 그래도 차례가 오지 않으면(VibeVoice가 도는 중 등) 503이다. whisper.cpp는 요청을 하나씩 처리해서 조각 하나의 전사 시간(이 Mac, 부하가 클 때 3분 조각 10~20초)이 짧은 요청이 기다리는 최대 시간이다.
- 화자 분리(pyannote)는 회의 전체에 한 번만 돌린다(따로 잠가 그동안 부르기 조각이 지나간다). 말소리 구간이 없으면 받아쓰지 않고 빈 결과를 준다(whisper는 무음에도 "감사합니다."를 지어낸다).
- 화자 수: `max_speakers`(ERP가 참석자 수로 보낸다)를 받으면 그 수로 나눈 뒤 목소리 중심이 아주 비슷한(코사인 0.85 이상) 화자를 합친다. 말하지 않은 참석자가 있어도 한 사람이 둘로 덜 쪼개진다. 옛 ERP의 `num_speakers`(정확한 수)도 받는다. pyannote의 `max_speakers`를 그대로 쓰지 않은 이유와 합성 회의 점수는 [docs/backend/stt.md](../../docs/backend/stt.md) '긴 회의 나눠 전사'.
- 용어 힌트: 요청의 `prompt`(강종·고객사·참석자 이름 등)를 줄바꿈·제어 문자를 빼고 400자까지 조각마다 whisper initial prompt로 넘긴다.
- whisper 서버가 잠깐 끊겨 조각 하나가 실패(502)하면 그 조각만 2초 뒤 한 번 더 해 본다.
- whisper가 한 문장을 되풀이하는 데 빠지면(같은 글 6자 이상이 4번 잇달아) 그 자리부터 새 문맥으로(힌트 없이) 다시 받아써 덜 되풀이한 쪽을 쓴다.
- 진행: 요청에 `stream=progress`를 주면 `Content-Type: application/x-ndjson`으로 한 줄씩 `{"type":"progress","stage":"diarize","current":1,"total":1}`, `{"type":"progress","stage":"transcribe","current":3,"total":12}` … `{"type":"result","result":{…아래 응답 모양…}}`를 보낸다. 머리글을 보낸 뒤 실패하면 `{"type":"error","status":502,"message":"…"}` 줄로 알린다. 받는 쪽이 연결을 끊으면 남은 조각을 받아쓰지 않는다. `stream`이 없으면 예전처럼 JSON 한 번이다.
- `GET /health` → `{"status":"ok","transcribing":n}`: 받아쓰는 중인 1분 이상 녹음 수(키 없이 열린다). ERP의 "다시 켜기"·"끄기"는 이 값이 0보다 크면 확인을 받는다.

## ERP에 연결

관리자 화면 AI 연결 → 음성 인식(STT) 카드에서 서버 주소 `http://127.0.0.1:8001/v1`, 모델 `whisper-pyannote` 또는 `vibevoice`로 저장한다. 전사 요청 제한 시간은 60분이다. 회의 전사 때 ERP는 `max_speakers`(참석자 수)·`prompt`(용어 힌트)·`stream=progress`를 보내고, 회의록 화면에 "받아쓰는 중 3/12"를 보인다. 연결 확인은 1초 무음을 보내므로 첫 확인은 모델을 불러오는 동안 오래 걸릴 수 있다. 전사가 끝나면 회의록 화면의 "화자 연결" 카드에서 화자를 참석자에게 이어 준다.

## 개인정보

- 음성은 이 컴퓨터 안에서만 처리하고 외부로 보내지 않는다(모델 내려받기 때 Hugging Face에 접속하는 것 제외).
- 업로드한 음성과 변환한 WAV(긴 회의의 조각 WAV 포함)는 임시 폴더에 두었다가 요청이 끝나면(성공·실패 모두) 지운다. 음성도 전사 내용도 용어 힌트도 로그에 남기지 않는다 (BP-VOC-01).
- 기본은 `127.0.0.1`에만 열린다. 다른 PC에 열면(`SIDECAR_HOST`가 127.0.0.1이 아니면) **API 키**가 꼭 있어야 하고, 없으면 만들어 키 파일에 둔다(처음부터 권한 600). 127.0.0.1로만 열면 `SIDECAR_API_KEY`를 직접 줄 때만 키를 요구한다(키 파일이 남아 있어도 읽지 않는다). 키 파일은 링크를 따라가지 않고, 남의 파일이라 권한을 못 바로잡으면 오류로 끝낸다. 키는 터미널에만 보이고 파일·로그로 가는 실행(자동 시작 등)에는 위치만 남긴다. 시험: `npm run test:voice`. 키가 있으면 `/v1/*` 요청 모두에 `Authorization: Bearer …`를 요구하고, 틀리면 본문을 읽기 전에 401로 끊는다. `/health`만 키 없이 `{"status":"ok"}`를 준다.
- whisper.cpp에는 키 기능이 없어 `start.sh`는 whisper.cpp를 127.0.0.1에만 연다.

## 모델 목록

`GET /v1/models` (키 필요): `{ "object": "list", "data": [ { "id": "whisper-pyannote", "label": "받아쓰기 + 화자 분리 (whisper + pyannote)", "diarization": true, "available": true, "note": null }, … ] }`. `available`은 whisper.cpp 포트가 열렸는지, `HF_TOKEN`이 있는지, VibeVoice 모델 폴더가 있는지로 정하고 모델을 불러 보지는 않는다. ERP 음성 인식 카드가 연결 확인 때 이 목록을 고르기 칸으로 보인다.

## 응답 모양

```json
{ "text": "…", "duration": 23.6, "segments": [ { "id": 0, "start": 0.0, "end": 4.2, "text": "…", "speaker": "SPEAKER_1" } ] }
```

오류는 `{ "error": { "message": "…" } }`와 4xx/5xx.
