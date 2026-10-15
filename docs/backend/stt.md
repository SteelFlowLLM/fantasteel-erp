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
| `POST /stt/connection-test` | USE | `{ baseUrl, apiKey? }`. 1초 무음 WAV(16kHz·모노·16비트)를 실제로 보내 HTTP 성공이면 연결됨 |
| `POST /stt/transcribe-test` | USE | multipart `file`(오디오, 100MB까지). `{ ok, text, segmentCount, durationSec, latencyMs, error }` |

`SttClient.transcribe`는 `POST {baseUrl}/audio/transcriptions`(multipart: file, model, language=ko, response_format=verbose_json, temperature=0)를 부르고, OpenAI·whisper.cpp의 `verbose_json`과 `{ text }`만 오는 json을 모두 `{ text, segments[{ start, end, text }], durationSec }`로 바꾼다. 제한 시간은 변환 **60분**(VibeVoice처럼 느린 화자 분리 엔진 대비), 연결 확인 30초.

응답 구간에 `speaker`(문자열)가 있으면 `SttSegment.speaker`로 남기고, 없거나 문자열이 아니면 null이다. 일반 whisper.cpp·OpenAI는 주지 않는다.

## whisper.cpp 실행 예

모델 파일은 저장소 밖(홈 폴더 등)에 둔다. 커밋하지 않는다.

```bash
whisper-server -m ~/models/ggml-large-v3-turbo.bin --host 127.0.0.1 --port 8000 \
  --inference-path /v1/audio/transcriptions --convert -l ko \
  --vad --vad-model ~/models/ggml-silero-v5.1.2.bin
```

`--convert`는 ffmpeg로 mp3·m4a·webm 등을 WAV로 바꾸므로 ffmpeg가 PATH에 있어야 한다. ERP 서버가 부르므로 `127.0.0.1`은 ERP 서버를 돌리는 컴퓨터다.

## 화자 분리 사이드카 (Voice2ERP 묶음 1)

`tools/voice-sidecar/server.py`(파이썬 표준 라이브러리 서버, 127.0.0.1:8001)가 같은 OpenAI 호환 `POST /v1/audio/transcriptions`를 열고 구간에 `speaker`('SPEAKER_1' …, 처음 나온 순서)를 붙여 돌려준다. ERP는 STT 설정만 바꾸면 된다: 서버 주소 `http://127.0.0.1:8001/v1`, 모델 `whisper-pyannote`(기본) 또는 `vibevoice`.
- `whisper-pyannote`: whisper.cpp 서버(8000)가 전사, pyannote `speaker-diarization-community-1`이 화자 분리(`HF_TOKEN`은 `server/.env`에서 읽는다), 구간마다 시간이 가장 많이 겹친 화자.
- `vibevoice`: VibeVoice-ASR MLX 4-bit 한 모델이 전사와 화자 분리를 함께 한다(느림, 한국어 정확도는 whisper보다 낮을 수 있다).
- 음성은 임시 폴더에만 두고 요청이 끝나면 지운다. 자세한 실행법은 `tools/voice-sidecar/README.md`. 화자를 참석자에게 잇는 API는 [meeting-minutes.md](meeting-minutes.md).

## 화면

`/admin/llm`(AI 연결)의 두 번째 카드 "음성 인식 (STT)": 서버 주소·모델·API 키 저장, 연결 확인, 파일로 시험.

## 테스트

`server/src/modules/stt/stt.spec.ts` — DB 없이 `npm run test:unit -w @fantasteel/server`로 돈다.
