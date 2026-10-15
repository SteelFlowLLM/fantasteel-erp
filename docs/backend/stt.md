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

`SttClient.transcribe`는 `POST {baseUrl}/audio/transcriptions`(multipart: file, model, language=ko, response_format=verbose_json, temperature=0)를 부르고, OpenAI·whisper.cpp의 `verbose_json`과 `{ text }`만 오는 json을 모두 `{ text, segments[{ start, end, text }], durationSec }`로 바꾼다. 제한 시간은 변환 15분, 연결 확인 30초.

## whisper.cpp 실행 예

모델 파일은 저장소 밖(홈 폴더 등)에 둔다. 커밋하지 않는다.

```bash
whisper-server -m ~/models/ggml-large-v3-turbo.bin --host 127.0.0.1 --port 8000 \
  --inference-path /v1/audio/transcriptions --convert -l ko \
  --vad --vad-model ~/models/ggml-silero-v5.1.2.bin
```

`--convert`는 ffmpeg로 mp3·m4a·webm 등을 WAV로 바꾸므로 ffmpeg가 PATH에 있어야 한다. ERP 서버가 부르므로 `127.0.0.1`은 ERP 서버를 돌리는 컴퓨터다.

## 화면

`/admin/llm`(AI 연결)의 두 번째 카드 "음성 인식 (STT)": 서버 주소·모델·API 키 저장, 연결 확인, 파일로 시험.

## 테스트

`server/src/modules/stt/stt.spec.ts` — DB 없이 `npm run test:unit -w @fantasteel/server`로 돈다.
