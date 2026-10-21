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
| `GET /stt/wake-settings` | VIEW | 철강맨 부르기 회사 설정 `{ enabled, voiceApproval }` (이슈 #457) |
| `PUT /stt/wake-settings` | USE | 같은 모양으로 저장. `enabled`가 false면 `voiceApproval`도 false로 저장 |
| `POST /stt/wake-clip` | 로그인만 | 철강맨 부르기(이슈 #457). 아래 절 |

## 철강맨 부르기 조각 받아쓰기 (이슈 #457, 문서에 없는 기능)

화면(`features/shell/SteelmanWake.tsx`)이 소리 크기로 잘라 낸 말소리 조각 하나(16kHz·모노 WAV, 최대 8초)를 multipart `file`로 보내면 `{ text, error }`를 돌려준다.
- 회사 설정: 관리자가 AI 연결 화면의 '철강맨 부르기' 카드에서 회사 전체로 끈다(`storage/settings/steelman-wake.json`, `SteelmanWakeSettingsStore`). 파일이 없으면 기본값 **부르기 켬·말로 승인 끔**(가정값). 부르기가 꺼져 있으면 이 API는 한도를 세기 전에 `VOC-011`(403)로 거절하고, 철강맨AI의 `GET ai-assistant/capabilities`가 `steelmanWake: { available, voiceApproval }`로 알려 화면이 스위치를 숨기고 마이크를 끈다. 켜 있어도 사원 각자의 스위치(기본 꺼짐)를 켜야 듣는다.
- 설정 화면이 아니라 모든 사원이 쓰는 기능이라 권한 코드 없이 **로그인만** 본다(`ORG_MANAGE` 아님). 저장된 주소·키·모델을 그대로 쓴다.
- 사원당 **1분 30번**(`STT_WAKE_CLIP_LIMITS.perMinute`, 가정값). 넘으면 음성 서버에 보내지 않고 `VOC-009`(429). 한도는 메모리(`SttWakeLimiter`)라 서버를 다시 켜면 비지만 1분 창이라 상관없다. 한도를 넘은 요청은 세지 않는다.
- 크기 512KB까지(multer가 끊는다). 이름표(MIME)가 아니라 바이트 머리를 읽어(`stt-wake-clip.ts`의 `wakeClipProblem`) RIFF·WAVE·PCM이고 data 길이가 8초(+0.5초 여유) 안인 것만 받는다. 아니면 음성 서버에 보내지 않고 `COM-004`. 소리도 받아쓴 글도 **저장·로그하지 않는다**(부르는 말이 없는 글은 화면이 바로 버린다).
- 저장된 모델이 사이드카의 화자 분리 엔진(`whisper-pyannote`·`vibevoice`)이면 받아쓰기만 하는 `whisper`로 바꿔 보낸다(`quickModelOf`, 몇 초짜리라 화자 분리가 필요 없고 느리다). 제한 시간 20초.
- 음성 서버에 닿지 않거나 거절하면 HTTP 오류가 아니라 `{ text: null, error }`라 화면이 스위치 옆에 "음성 서버가 꺼져 있어요"로 보인다. 자세한 이유(음성 서버 주소·Tailscale 이름·서버가 준 오류)는 설정 권한(`ORG_MANAGE` USE)이 있는 사원에게만 돌려주고, 나머지 사원에게는 "음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요"만 준다. 자세한 이유는 서버 기록(`Logger.warn`, 사원 id 포함, 소리·글 없음)에 남는다.
- 이 Mac 음성 서버(8001, whisper)로 `say -v Yuna`로 만든 1~3초 소리가 0.3~0.9초에 받아써졌다(2026-10-21).

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

- '철강맨 부르기' 카드(`SteelmanWakeSettingsCard`, 이슈 #457, 철강맨AI 기능 탭): [철강맨 부르기 쓰기](기본 켬)·[말로 승인 허용](기본 끔, 부르기를 끄면 같이 꺼짐)을 각각 [켜기 | 끄기] 단추로 고르고 [저장]한다. 머리의 배지가 저장된 상태(켜짐·꺼짐)를, 바꾸고 저장하지 않았으면 '저장해야 적용돼요'를 보인다. 저장하면 철강맨AI 기능 정보도 다시 읽어 사원 화면의 마이크 단추가 바로 숨거나 나타난다. 맨 위 '음성 서버' 줄은 저장된 음성 설정으로 연결을 확인해 연결됨·연결 안 됨(이유)·응답 시간·주소를 보이고 [연결 확인]으로 다시 확인한다(`POST stt/connection-test`, 탭을 처음 열 때 한 번, 설정 사용 권한이 있을 때만). '음성 인식 탭에서 바꾸기'로 음성 인식 탭으로 간다.

`/admin/llm`(AI 연결)은 탭 세 개로 나뉜다: AI 모델(LM Studio) · 음성 인식 · 철강맨AI 기능(브라우저 주소, 철강맨 부르기). 음성 인식 탭은 처음 열 때 저장된 설정으로 연결을 한 번 확인한다(1초 무음을 실제로 보내므로 화면을 열자마자가 아니라 탭을 열 때). 음성 인식 탭의 "음성 인식 (STT)" 카드와 오른쪽 "이 Mac의 음성 서버"·"음성 연결 안내" 카드:
- **방식**: 내 음성 서버(whisper.cpp·화자 분리) / OpenAI 방식 음성 API. 서버에는 저장하지 않고 주소로 짐작(인터넷 주소면 API)하며, 바꾸면 주소·모델 기본값만 채운다(API: `https://api.openai.com/v1`·`whisper-1`).
- 서버 주소(입력칸 아래에 이 서버 컴퓨터·같은 망·Tailscale·인터넷 중 어디인지 안내, 암호화 없는 인터넷 주소·`0.0.0.0`은 경고), 모델, API 키(저장 후 가림), 연결 확인, 파일로 시험.
- "이 Mac의 음성 서버" 카드(ERP 서버가 macOS일 때만): 켜짐·켜는 중·꺼짐·등록 안 됨, [켜기]·[끄기]. 켜는 중이면 2초마다 다시 본다.
- 안내 카드: "LLM을 API로 바꿔도 음성은 여기 설정을 써요", 다른 PC의 음성 서버에 붙는 법(0.0.0.0·방화벽·Tailscale).

## 테스트

`server/src/modules/stt/stt.spec.ts` — DB 없이 `npm run test:unit -w @fantasteel/server`로 돈다.
`steelman-wake-settings.store.spec.ts` — 회사 설정 기본값·깨진 파일·부르기를 끄면 말로 승인도 꺼짐. `stt-wake-clip.spec.ts` — WAV 머리(PCM·8초·LIST 덩이·깨진 머리). `stt-wake.spec.ts` — 철강맨 부르기: 사원별 1분 횟수(넘은 요청은 세지 않음·1분 뒤 다시), 짧은 조각 모델, 저장된 설정·20초로 보내기, 음성 서버 실패는 이유로(관리자만 자세히)·모르는 오류는 던짐, 조각 없음·WAV 아님·8초 넘음 COM-004, 한도 초과 VOC-009, 회사 설정 꺼짐 VOC-011(한도 안 셈), 로그인만(공개 아님·`ORG_MANAGE` 아님), 회사 설정 API는 `ORG_MANAGE` VIEW·USE.

## 설정 파일 쓰기 (2026-10-21, #487)

- `storage/settings/stt.json`·`steelman-wake.json`과 철강맨AI 브라우저 설정은 공통 함수 `writeFileAtomic`(common/storage)으로 같은 폴더의 임시 파일(무작위 이름)에 다 쓴 뒤 이름을 바꿔 끼운다. 실패하면 임시 파일(API 키가 든)을 지운다. 쓰는 도중 읽는 요청이 반쪽 JSON을 읽어 오류가 나지 않는다. LLM 설정(`llm.json`)에도 같은 문제가 있지만 그 저장소는 #468이 고치는 중이라 이 이슈에서는 건드리지 않았다 🟡.
