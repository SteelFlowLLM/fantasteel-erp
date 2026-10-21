# 음성 인식(STT) 연결 (`server/src/modules/stt/`)

문서에 없는 기능 (Voice2ERP 1단계). LLM 연결(`modules/llm/`)과 같은 구조로, 회의 녹음을 글로 바꾸는 Whisper 서버에 연결한다. 다음 단계(회의록 음성 등록)가 `SttClient`·`SttSettingsStore`를 주입해 쓴다.

## 설정

DB가 아니라 `storage/settings/stt.json`에 저장한다. 파일이 없으면 `.env`의 `STT_BASE_URL`·`STT_MODEL`·`STT_API_KEY`, 그것도 없으면 `http://127.0.0.1:8000/v1`(`STT_DEFAULT_BASE_URL`).
`model`은 whisper.cpp가 무시하므로 비워 둘 수 있고(요청에는 `whisper-1`을 보낸다), OpenAI는 `whisper-1`이 필요하다. API 키는 응답에 돌려주지 않고 `hasApiKey`만 알린다.

## API (명세서에 없는 경로, 권한은 LLM 설정과 같은 `ORG_MANAGE`)

| 메서드 경로 | 권한 | 설명 |
| --- | --- | --- |
| `GET /stt/settings` | VIEW | `{ baseUrl, model, hasApiKey }` |
| `PUT /stt/settings` | USE | `apiKey`를 보내지 않으면 유지, 빈 문자열이면 삭제 |
| `POST /stt/connection-test` | USE | `{ baseUrl, model?, apiKey? }` → `{ connected, baseUrl, latencyMs, error, models[] }`. 먼저 `GET {baseUrl}/models`(10초)로 모델 목록을 받고(없으면 빈 목록, 닿지 않거나 401이면 바로 실패), 그다음 화면에 입력한(저장 전) 모델·키로 1초 무음 WAV(16kHz·모노·16비트)를 실제로 보내 HTTP 성공이면 연결됨. `model`·`apiKey`를 보내지 않으면 저장된 값을 쓴다(`model: null`은 모델 이름 없이) |
| `GET /stt/local-server` | VIEW | ERP 서버와 같은 Mac의 음성 서버(LaunchAgent `com.fantasteel.voice`) `{ supported, installed, running, healthy, pid, logPath, message }`. macOS가 아니면 `supported: false` (이슈 #450) |
| `POST /stt/local-server/start` · `/stop` | USE | `launchctl bootstrap`/`kickstart`·`bootout`만 실행한다(화면 값은 명령에 넣지 않는다). 끄기는 지금만이고 다음 로그인 때 다시 켜진다. 등록 전·macOS가 아니면 COM-004 |
| `POST /stt/transcribe-test` | USE | multipart `file`(오디오, 100MB까지). `{ ok, text, segmentCount, durationSec, latencyMs, error }` |

`SttClient.transcribe`는 `POST {baseUrl}/audio/transcriptions`(multipart: file, model, language=ko, response_format=verbose_json, temperature=0)를 부르고, OpenAI·whisper.cpp의 `verbose_json`과 `{ text }`만 오는 json을 모두 `{ text, segments[{ start, end, text }], durationSec }`로 바꾼다. 제한 시간은 변환 **60분**(VibeVoice처럼 느린 화자 분리 엔진 대비), 연결 확인 30초.

응답 구간에 `speaker`(문자열)가 있으면 `SttSegment.speaker`로 남기고, 없거나 문자열이 아니면 null이다. 일반 whisper.cpp·OpenAI는 주지 않는다.

주소는 관리자가 넣는 서버 설정이라 `localhost`·`127.0.0.1`·같은 망(`192.168.x.x`·`10.x`·`172.16~31.x`)·Tailscale(`100.64~127.x`·`*.ts.net`)·인터넷 주소를 모두 받고(`http://`·`https://`만), 철강맨AI 웹 도구의 사설 주소 차단과는 별개다. 다만 링크 로컬(`169.254.x.x`, IPv6 `fe80::/10`)·클라우드 메타데이터 이름은 거절하고, 주소 안의 아이디·비밀번호(`http://user:pw@…`)도 받지 않는다. 요청은 리다이렉트를 따라가지 않고, 오류 문구에는 주소의 아이디·비밀번호와 서버의 JSON이 아닌 응답 본문을 내보내지 않는다. 저장된 API 키는 새로 보낸 주소의 출처(프로토콜·호스트·포트)가 저장된 주소와 같을 때만 쓰며, 다른 출처로 바꾸면서 키를 비워 두면 연결 확인에는 키를 보내지 않고 저장하면 키를 지운다. 연결 실패는 오류가 아니라 이유가 담긴 결과로 돌려주며, 원인(거절·길 없음·이름 못 찾음·인증서·404)별로 문구를 나누고, 404에는 서버가 준 이유(예: OpenAI의 모델 없음)를 붙인다.

## whisper.cpp 실행 예

모델 파일은 저장소 밖(홈 폴더 등)에 둔다. 커밋하지 않는다.

```bash
whisper-server -m ~/models/ggml-large-v3-turbo.bin --host 127.0.0.1 --port 8000 \
  --inference-path /v1/audio/transcriptions --convert -l ko \
  --vad --vad-model ~/models/ggml-silero-v5.1.2.bin
```

다른 PC에서 붙을 때는 `--host 0.0.0.0`으로 띄운다([voice2erp/voice-server-connect.md](../voice2erp/voice-server-connect.md)).

`--convert`는 ffmpeg로 mp3·m4a·webm 등을 WAV로 바꾸므로 ffmpeg가 PATH에 있어야 한다. ERP 서버가 부르므로 `127.0.0.1`은 ERP 서버를 돌리는 컴퓨터다.

## 모델 목록 (이슈 #445)

`SttClient.listModels`가 `GET {baseUrl}/models`를 읽어 `SttModelOption { id, label, diarization, available, note }[]`로 바꾼다. 사이드카는 화면 이름·화자 분리 여부·준비 상태를 주고, OpenAI처럼 음성과 상관없는 모델까지 주는 곳은 이름에 whisper·transcribe·asr·stt가 든 것만 남긴다(최대 50개). 연결 확인 제한 시간은 무음 전사 90초(whisper가 모델을 처음 올리는 시간), 목록 10초.

## 화자 분리 사이드카 (Voice2ERP 묶음 1)

`tools/voice-sidecar/server.py`(파이썬 표준 라이브러리 서버, 127.0.0.1:8001)가 같은 OpenAI 호환 `POST /v1/audio/transcriptions`를 열고 구간에 `speaker`('SPEAKER_1' …, 처음 나온 순서)를 붙여 돌려준다. ERP는 STT 설정만 바꾸면 된다: 서버 주소 `http://127.0.0.1:8001/v1`, 모델 `whisper-pyannote`(기본)·`whisper`(받아쓰기만)·`vibevoice`. `tools/voice-sidecar/start.sh`가 whisper.cpp와 함께 켜고, 다른 PC에 열 때는 API 키를 요구한다(내 Mac을 음성 API로 쓰기: [voice2erp/voice-server-connect.md](../voice2erp/voice-server-connect.md)).
- `whisper-pyannote`: whisper.cpp 서버(8000)가 전사, pyannote `speaker-diarization-community-1`이 화자 분리(`HF_TOKEN`은 `server/.env`에서 읽는다), 구간마다 시간이 가장 많이 겹친 화자.
- `vibevoice`: VibeVoice-ASR MLX 4-bit 한 모델이 전사와 화자 분리를 함께 한다(느림, 한국어 정확도는 whisper보다 낮을 수 있다).
- 음성은 임시 폴더에만 두고 요청이 끝나면 지운다. 자세한 실행법은 `tools/voice-sidecar/README.md`. 화자를 참석자에게 잇는 API는 [meeting-minutes.md](meeting-minutes.md).

## 화면

`/admin/llm`(AI 연결)의 "음성 인식 (STT)" 카드와 오른쪽 "음성 연결 안내" 카드:
- **방식**: 내 음성 서버(whisper.cpp·화자 분리) / OpenAI 방식 음성 API. 서버에는 저장하지 않고 주소로 짐작(인터넷 주소면 API)하며, 바꾸면 주소·모델 기본값만 채운다(API: `https://api.openai.com/v1`·`whisper-1`).
- 서버 주소(입력칸 아래에 이 서버 컴퓨터·같은 망·Tailscale·인터넷 중 어디인지 안내, 암호화 없는 인터넷 주소·`0.0.0.0`은 경고), 모델, API 키(저장 후 가림), 연결 확인, 파일로 시험.
- "이 Mac의 음성 서버" 카드(ERP 서버가 macOS일 때만): 켜짐·켜는 중·꺼짐·등록 안 됨, [켜기]·[끄기]. 켜는 중이면 2초마다 다시 본다.
- 안내 카드: "LLM을 API로 바꿔도 음성은 여기 설정을 써요", 다른 PC의 음성 서버에 붙는 법(0.0.0.0·방화벽·Tailscale).

## 테스트

`server/src/modules/stt/stt.spec.ts` — DB 없이 `npm run test:unit -w @fantasteel/server`로 돈다.
