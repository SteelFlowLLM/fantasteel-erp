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
| `GET /stt/local-server` | VIEW | ERP 서버와 같은 Mac의 음성 서버(LaunchAgent `com.fantasteel.voice`) `{ supported, installed, running, healthy, pid, logPath, message, transcribing }`. macOS가 아니면 `supported: false` (이슈 #450). `transcribing`은 음성 서버 `/health`가 알려 준 받아쓰는 중인 긴 녹음 수(이슈 #522, 꺼졌거나 옛 음성 서버면 null) |
| `POST /stt/local-server/start` · `/stop` | USE | `launchctl bootstrap`/`kickstart`·`bootout`만 실행한다(화면 값은 명령에 넣지 않는다). 끄기는 지금만이고 다음 로그인 때 다시 켜진다. 등록 전·macOS가 아니면 COM-004. 본문 `{ confirmBusy?: boolean }`(이슈 #522): 켜져 있는 음성 서버가 회의 녹음을 받아쓰는 중(`transcribing` > 0)인데 `confirmBusy`가 없으면 **다시 켜기·끄기를 하지 않고** `{ …상태, needsConfirm: true, warning: '음성 서버가 회의 녹음 N건을 받아쓰는 중이에요. 지금 다시 켜면(끄면) 그 전사는 실패하고 녹음을 다시 올려야 해요' }`를 돌려준다(오류가 아니라 200). 했으면 `needsConfirm: false, warning: null` |
| `POST /stt/transcribe-test` | USE | multipart `file`(오디오, 100MB까지). `{ ok, text, segmentCount, durationSec, latencyMs, error }` |
| `GET /stt/wake-settings` | VIEW | 철강맨 부르기 회사 설정 `{ enabled, voiceApproval }` (이슈 #457) |
| `PUT /stt/wake-settings` | USE | 같은 모양으로 저장. `enabled`가 false면 `voiceApproval`도 false로 저장 |
| `POST /stt/wake-clip` | 로그인만 | 철강맨 부르기(이슈 #457). 아래 절 |

## 철강맨 부르기 조각 받아쓰기 (이슈 #457, 문서에 없는 기능)

화면(`features/shell/SteelmanWake.tsx`)이 소리 크기로 잘라 낸 말소리 조각 하나(16kHz·모노 WAV, 최대 8초)를 multipart `file`로 보내면 `{ text, error }`를 돌려준다.
- 회사 설정: 관리자가 AI 연결 화면의 '철강맨 부르기' 카드에서 회사 전체로 끈다(`storage/settings/steelman-wake.json`, `SteelmanWakeSettingsStore`). 파일이 없으면 기본값 **부르기 켬·말로 승인 끔**(가정값). 부르기가 꺼져 있으면 이 API는 한도를 세기 전에 `VOC-011`(403)로 거절하고, 철강맨AI의 `GET ai-assistant/capabilities`가 `steelmanWake: { available, voiceApproval }`로 알려 화면이 스위치를 숨기고 마이크를 끈다. 켜 있어도 사원 각자의 스위치(기본 꺼짐)를 켜야 듣는다.
- 설정 화면이 아니라 모든 사원이 쓰는 기능이라 권한 코드 없이 **로그인만** 본다(`ORG_MANAGE` 아님). 저장된 주소·키·모델을 그대로 쓴다.
- 사원당 **1분 30번**(`STT_WAKE_CLIP_LIMITS.perMinute`, 가정값). 넘으면 음성 서버에 보내지 않고 `VOC-009`(429). 한도는 메모리(`SttWakeLimiter`)라 서버를 다시 켜면 비지만 1분 창이라 상관없다. 한도를 넘은 요청은 세지 않는다.
- 크기 512KB까지(multer가 끊는다). 이름표(MIME)가 아니라 바이트 머리를 읽어(`stt-wake-clip.ts`의 `wakeClipProblem`) RIFF·WAVE·PCM이고 data 길이가 8초(+0.5초 여유) 안인 것만 받는다. 아니면 음성 서버에 보내지 않고 `COM-004`. 소리도 받아쓴 글도 **저장·로그하지 않는다**(부르는 말이 없는 글은 화면이 처리하지 않고, 무엇을 들었는지 띠에 5초만 보인 뒤 화면 메모리에서도 지운다, 이슈 #494).
- 저장된 모델이 사이드카의 화자 분리 엔진(`whisper-pyannote`·`vibevoice`)이면 받아쓰기만 하는 `whisper`로 바꿔 보낸다(`quickModelOf`, 몇 초짜리라 화자 분리가 필요 없고 느리다). 제한 시간 20초.
- 음성 서버에 닿지 않거나 거절하면 HTTP 오류가 아니라 `{ text: null, error }`라 화면이 스위치 옆에 "음성 서버가 꺼져 있어요"로 보인다. 자세한 이유(음성 서버 주소·Tailscale 이름·서버가 준 오류)는 설정 권한(`ORG_MANAGE` USE)이 있는 사원에게만 돌려주고, 나머지 사원에게는 "음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요"만 준다. 자세한 이유는 서버 기록(`Logger.warn`, 사원 id 포함, 소리·글 없음)에 남는다.
- 이 Mac 음성 서버(8001, whisper)로 `say -v Yuna`로 만든 1~3초 소리가 0.3~0.9초에 받아써졌다(2026-10-21).
- **조각 종류 `mode`(이슈 #494)**: multipart 글 칸 `mode`(`WakeClipDto`, 보내지 않으면 `wake`). `wake`는 부르는 말을 찾는 짧은 조각(8초·512KB), `command`는 "철강맨" 뒤 명령 한 덩어리(**30초·1MB**, `STT_WAKE_CLIP_LIMITS.commandMaxSeconds·commandMaxBytes`, 가정값), `partial`은 명령을 말하는 동안 화면에 보이기만 할 중간 글(30초·1MB). multer는 가장 큰 1MB에 맞춰 받고 종류별 크기·길이(`wakeClipLimitOf`, `wakeClipProblem(buffer, maxSeconds)`)는 service가 본다. `partial`은 따로 **1분 40번**(`partialPerMinute`, 가정값) 세어 명령·부르는 말 조각의 30번을 깎지 않는다. 어느 종류도 소리·글을 저장·로그하지 않는다.
- 측정(2026-10-22, 이 Mac 8001 whisper, `say -v Yuna`로 만든 12초 문장을 2·4·…·12초로 잘라 보냄): 길이와 거의 상관없이 **0.27~0.34초**에 받아썼다. 그래서 명령을 말하는 동안 2초마다 지금까지의 덩어리를 다시 보내 중간 글을 보이는 방식(30초 말에도 15번)을 켰다. 잘린 조각에서는 앞의 "철강맨"이 빠지기도 해 중간 글은 보이기만 하고 명령으로 쓰지 않는다.

`SttClient.transcribe`는 `POST {baseUrl}/audio/transcriptions`(multipart: file, model, language=ko, response_format=verbose_json, temperature=0, 회의 전사면 `prompt`=용어 힌트)를 부르고, OpenAI·whisper.cpp의 `verbose_json`과 `{ text }`만 오는 json을 모두 `{ text, segments[{ start, end, text }], durationSec }`로 바꾼다. 제한 시간은 변환 **60분**(VibeVoice처럼 느린 화자 분리 엔진 대비), 연결 확인 30초. 전역 `fetch`(undici)는 응답 헤더를 5분 안에 못 받으면 끊어서, 변환 요청에만 전용 `undici.Agent`(`headersTimeout`·`bodyTimeout` = 제한 시간 + 10초, `sttAgentOptions`)를 넘겨 5분 넘게 걸리는 긴 회의도 받는다(이슈 #485, Agent는 요청마다 만들어 끝나면 닫는다). 우리 제한이 먼저 걸려 "N초 안에 응답이 없어요"가 나온다. 모델 목록·연결 확인 같은 짧은 요청은 기본 fetch다.

응답 구간에 `speaker`(문자열)가 있으면 `SttSegment.speaker`로 남기고, 없거나 문자열이 아니면 null이다. 일반 whisper.cpp·OpenAI는 주지 않는다.

**회의 전사 요청 칸 (이슈 #522)** — `SttTranscribeInput`:
- `maxSpeakers`: 화자 분리 엔진(`whisper-pyannote`·`vibevoice`)일 때만 `max_speakers`로 보낸다(OpenAI는 모르는 칸을 거절할 수 있다). 예전 `num_speakers`(정확한 수)는 보내지 않는다. 사이드카는 옛 ERP의 `num_speakers`도 그대로 받는다.
- `prompt`: 용어 힌트(whisper initial prompt). whisper.cpp·OpenAI·사이드카 모두 받으므로 어느 서버에나 보낸다. 만드는 규칙은 [meeting-minutes.md](meeting-minutes.md) '음성으로 만들기'.
- `onProgress`: 주면 사이드카 모델(`whisper-pyannote`·`whisper`·`vibevoice`)에 `stream=progress`를 보낸다. 사이드카는 `Content-Type: application/x-ndjson`으로 한 줄에 JSON 하나씩 `{"type":"progress","stage":"diarize"|"transcribe","current","total"}` … `{"type":"result","result":{verbose_json}}`를 보내고, 머리글을 보낸 뒤의 실패는 `{"type":"error","status","message"}` 줄로 알린다(`readProgressStream`). 응답이 NDJSON이 아니면(whisper.cpp·OpenAI·옛 사이드카) 예전처럼 JSON 한 번이다. 진행 줄은 `onProgress`로 넘기고(받는 쪽이 실패해도 계속 읽는다), 결과 줄이 오기 전에 연결이 끊기면 `음성 서버와 연결이 받아쓰는 도중에 끊겼어요`(회의록에는 "…녹음을 다시 올려 주세요"), 오류 줄은 `음성 인식 서버 오류 (HTTP n): 이유`. 머리글이 바로 오므로 5분 헤더 제한(#485)에 걸리지 않는다. fetch·Agent 부분은 바꾸지 않았다(응답 읽기만 늘었다).

주소는 관리자가 넣는 서버 설정이라 `localhost`·`127.0.0.1`·같은 망(`192.168.x.x`·`10.x`·`172.16~31.x`)·Tailscale(`100.64~127.x`·`*.ts.net`)·인터넷 주소를 모두 받고(`http://`·`https://`만), 철강맨AI 웹 도구의 사설 주소 차단과는 별개다. 다만 링크 로컬(`169.254.x.x`, IPv6 `fe80::/10`)·클라우드 메타데이터 주소(`fd00:ec2::254`·`100.100.100.200`)·이름(`metadata.google.internal` 등)은 저장과 연결 확인 모두 `COM-004`로 거절하고(LLM 서버 주소와 같은 규칙 `common/net/server-url.ts`, 이전에 저장된 주소도 요청 전에 막는다. 🟡 DNS 이름이 메타데이터 주소로 풀리는 경우는 막지 않는다), 주소 안의 아이디·비밀번호(`http://user:pw@…`)도 받지 않는다. 요청은 리다이렉트를 따라가지 않고, 오류 문구에는 주소의 아이디·비밀번호와 서버의 JSON이 아닌 응답 본문을 내보내지 않는다. 저장된 API 키는 새로 보낸 주소의 출처(프로토콜·호스트·포트)가 저장된 주소와 같을 때만 쓰며, 다른 출처로 바꾸면서 키를 비워 두면 연결 확인에는 키를 보내지 않고 저장하면 키를 지운다. 연결 실패는 오류가 아니라 이유가 담긴 결과로 돌려주며, 원인(거절·길 없음·이름 못 찾음·인증서·404)별로 문구를 나누고, 404에는 서버가 준 이유(예: OpenAI의 모델 없음)를 붙인다.

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

**긴 회의 나눠 전사 (이슈 #522)** — 예전에는 회의 전체를 whisper에 한 번 보내고 엔진 잠금 하나를 끝날 때까지 쥐어, 그동안 철강맨 부르기 조각이 503을 받거나 20초 제한에 끊겼다.
- **조각**: 1분 이상인 녹음은 🟡 약 **3분**(`SIDECAR_CHUNK_SEC`, 180) 조각으로 나눠 차례로 whisper에 보낸다. 목표 시각 앞뒤 30초 안에서 **아무도 말하지 않는 곳**(화자 분리 결과의 빈틈, 받아쓰기만 할 때는 소리 크기가 바닥 소음 + 6dB 아래인 곳)의 가운데를 고르고, 없으면 목표 시각에서 자른다. 조각 구간 시각은 회의 전체 시각으로 옮겨 잇는다. 3분은 이 Mac에서 10분 조각이 39초 걸려(부하 큼) 부르기 제한 20초 안에 들도록 정했다: whisper.cpp는 요청을 하나씩 처리하므로 조각 하나의 전사 시간이 짧은 요청이 기다리는 최대 시간이다.
- **잠금**: 받아쓰기 엔진 차례(`EngineGate`)는 조각 하나를 받아쓰는 동안만 쥔다. 놓은 사이 **짧은 요청(1분 미만: 부르기 조각·명령 덩어리·연결 확인)이 기다리고 있으면 긴 전사는 다음 조각을 잡지 않고 먼저 내준다**. 짧은 요청은 🟡 15초(`SIDECAR_QUICK_WAIT_SEC`)까지 기다리고, 그래도 차례가 오지 않으면(VibeVoice가 도는 중 등) 예전과 같은 503 문구(`지금 다른 녹음을 받아쓰는 중이에요…`)다. pyannote는 따로 잠가(`diarize_lock`) 화자 분리 중에도 부르기 조각이 지나간다. VibeVoice는 한 번에 전사·화자 분리를 해서 나누지 않고 두 잠금을 다 쥔다. 조각 받아쓰기가 whisper 서버 연결 문제(502)로 실패하면 그 조각만 2초 뒤 한 번 더 해 본다.
- **화자**: pyannote는 **회의 전체에 한 번** 돌려(조각마다 돌리지 않는다) 조각이 달라도 같은 사람이 같은 화자로 이어진다. 화자 분리를 먼저 하고(진행 `diarize 1/1`), 말소리 구간이 하나도 없으면 받아쓰지 않고 빈 결과를 준다(ERP가 "말소리를 찾지 못했어요"로 끝낸다). 받아쓰기만(`whisper`)일 때는 소리 크기로 말소리가 1초도 없으면 빈 결과다.
- **최대 화자 수**: `max_speakers`(참석자 수)를 받으면 pyannote에 그 수를 정확값으로 주고 나눈 뒤 **목소리 중심(임베딩)의 코사인 유사도가 🟡 0.85(`SIDECAR_SPEAKER_MERGE`) 이상인 화자를 합친다**(가장 비슷한 쌍부터, 말한 시간 가중 평균). pyannote의 `max_speakers`를 그대로 쓰면 비슷한 목소리를 한 사람으로 합쳐 버려(합성 34분: 6명 → 4명, 정확도 91% → 72%) 쓰지 않았다. 합성 회의에서 서로 다른 사람 가운데 가장 비슷한 쌍은 0.79, 화자 수를 실제(6)보다 크게 줘 한 사람이 나뉜 쌍은 0.82~0.94였다(아래 표).
- **한 구간에 두 사람**: whisper가 두 사람의 말을 한 구간으로 묶으면 낱말 시각(whisper.cpp `words`)으로 낱말마다 화자를 보고 화자가 바뀌는 곳에서 구간을 나눈다. 1초 또는 2낱말보다 짧은 덩이는 앞뒤 화자에 붙인다(낱말 시각은 수백 ms 어긋날 수 있다). 낱말을 이은 글이 구간 글과 다르면 나누지 않는다.
- **용어 힌트**: 요청의 `prompt`를 줄바꿈·제어 문자를 빼고 400자까지 조각마다 whisper에 그대로 넘긴다.
- **되풀이 막기**: whisper는 앞 문맥에 끌려 한 문장을 되풀이하는 데 빠질 때가 있다(합성 41분의 한 조각: 100초 동안 같은 문장 102번, 힌트 없이도 37번). 조각 결과에 같은 글(6자 이상)이 4번 잇달아 나오면 되풀이가 시작된 곳부터 끝까지를 새 문맥으로(힌트 없이) 다시 받아쓰고 덜 되풀이한 쪽을 쓴다.
- **진행**: 요청에 `stream=progress`가 있으면 위 NDJSON으로 단계(`diarize`)와 조각(`transcribe n/m`)을 알린다. ERP가 연결을 끊으면 다음 조각을 받아쓰지 않고 멈춘다.
- **`/health`**: `{ "status": "ok", "transcribing": n }` — 받아쓰는 중인 1분 이상 녹음 수(키 없이 열리고 내용은 알리지 않는다). ERP의 다시 켜기·끄기 확인이 쓴다.

합성 회의(`docs/voice2erp/test-meeting`, 참석자 6명) 화자 분리 실험 — 분할·임베딩은 같고 화자 수 힌트만 바꿔 같은 whisper 구간에 붙였다(2026-10-22):

| 화자 수 힌트 | 고품질 34분 정확도/찾은 화자 | 기본 41분 |
| --- | --- | --- |
| 정확값 6 (예전) | 91.1% / 6 | 86.2% / 6 |
| pyannote `max_speakers=6` | 71.5% / 4 | — |
| 6으로 나눈 뒤 0.85 이상 합치기 (이번) | 91.1% / 6 | 86.2% / 5 |
| 참석자 7명(1명 말 안 함) 정확값 → 합치기 | 91.1% / 7 → 91.1% / 6 | 86.2% / 7 → 86.2% / 5 |
| 참석자 8명(2명 말 안 함) 정확값 → 합치기 | 88.9% / 8 → 88.9% / 7 | 85.9% / 8 → 85.9% / 5 |
| 참석자 10명 정확값 → 합치기 | 89.2% / 10 → 89.2% / 6 | 86.6% / 10 → 86.6% / 5 |

기본 41분은 정확값 6으로도 한 사람이 둘로 나뉘고 두 사람이 하나로 묶여 있어(정확도는 같다), 합치면 5명으로 보인다.

## 화면

- '철강맨 부르기' 카드(`SteelmanWakeSettingsCard`, 이슈 #457, 철강맨AI 기능 탭): [철강맨 부르기 쓰기](기본 켬)·[말로 승인 허용](기본 끔, 부르기를 끄면 같이 꺼짐)을 각각 [켜기 | 끄기] 단추로 고르고 [저장]한다. 머리의 배지가 저장된 상태(켜짐·꺼짐)를, 바꾸고 저장하지 않았으면 '저장해야 적용돼요'를 보인다. 저장하면 철강맨AI 기능 정보도 다시 읽어 사원 화면의 마이크 단추가 바로 숨거나 나타난다. 맨 위 '음성 서버' 줄은 저장된 음성 설정으로 연결을 확인해 연결됨·연결 안 됨(이유)·응답 시간·주소를 보이고 [연결 확인]으로 다시 확인한다(`POST stt/connection-test`, 탭을 처음 열 때 한 번, 설정 사용 권한이 있을 때만). '음성 인식 탭에서 바꾸기'로 음성 인식 탭으로 간다.

`/admin/llm`(AI 연결)은 탭 세 개로 나뉜다: AI 모델(LM Studio) · 음성 인식 · 철강맨AI 기능(브라우저 주소, 철강맨 부르기). 음성 인식 탭은 처음 열 때 저장된 설정으로 연결을 한 번 확인한다(1초 무음을 실제로 보내므로 화면을 열자마자가 아니라 탭을 열 때). 음성 인식 탭의 "음성 인식 (STT)" 카드와 오른쪽 "이 Mac의 음성 서버"·"음성 연결 안내" 카드:
- **방식**: 내 음성 서버(whisper.cpp·화자 분리) / OpenAI 방식 음성 API. 서버에는 저장하지 않고 주소로 짐작(인터넷 주소면 API)하며, 바꾸면 주소·모델 기본값만 채운다(API: `https://api.openai.com/v1`·`whisper-1`).
- 서버 주소(입력칸 아래에 이 서버 컴퓨터·같은 망·Tailscale·인터넷 중 어디인지 안내, 암호화 없는 인터넷 주소·`0.0.0.0`은 경고), 모델, API 키(저장 후 가림), 연결 확인, 파일로 시험.
- "이 Mac의 음성 서버" 카드(ERP 서버가 macOS일 때만): 켜짐·켜는 중·꺼짐·등록 안 됨, [켜기]·[끄기]. 켜는 중이면 2초마다 다시 본다. 음성 서버가 회의 녹음을 받아쓰는 중이면 "회의 녹음 N건을 받아쓰는 중이에요" 띠를 보이고, [다시 켜기]·[끄기]를 누르면 서버가 돌려준 경고로 **확인 창**("받아쓰는 중인데 다시 켤까요?", [그래도 다시 켜기])을 띄워 확인해야 `confirmBusy: true`로 다시 보낸다(이슈 #522).
- 안내 카드: "LLM을 API로 바꿔도 음성은 여기 설정을 써요", 다른 PC의 음성 서버에 붙는 법(0.0.0.0·방화벽·Tailscale).

## 테스트

`server/src/modules/stt/stt.spec.ts` — DB 없이 `npm run test:unit -w @fantasteel/server`로 돈다. 이슈 #522: 최대 화자 수는 사이드카 모델에만 `max_speakers`, 용어 힌트 `prompt`, `stream=progress`는 진행을 받을 때 사이드카 모델에만, NDJSON 진행·결과·오류 줄·결과 없이 끊김·받는 쪽 실패에도 끝까지 읽기. `stt-local-server.spec.ts` — `/health`의 받아쓰는 중 수, 받아쓰는 중이면 확인 없이 다시 켜기·끄기 안 함·`confirmBusy`면 함, 옛 음성 서버는 묻지 않음. 사이드카 파이썬 시험은 `npm run test:voice`(`tools/voice-sidecar/test_chunked.py`: 조각 나누기·말 없는 곳·조각 파일 지우기·잠금 놓기(긴 전사 첫 조각 → 짧은 요청 → 나머지 조각)·짧은 요청 15초 뒤 503·max_speakers·비슷한 화자 합치기·낱말로 화자 나누기·prompt·말소리 없음·조각 다시 해 보기·NDJSON 응답·/health).
`steelman-wake-settings.store.spec.ts` — 회사 설정 기본값·깨진 파일·부르기를 끄면 말로 승인도 꺼짐. `stt-wake-clip.spec.ts` — WAV 머리(PCM·8초·LIST 덩이·깨진 머리). `stt-wake.spec.ts` — 철강맨 부르기: 사원별 1분 횟수(넘은 요청은 세지 않음·1분 뒤 다시), 짧은 조각 모델, 저장된 설정·20초로 보내기, 음성 서버 실패는 이유로(관리자만 자세히)·모르는 오류는 던짐, 조각 없음·WAV 아님·8초 넘음 COM-004, 한도 초과 VOC-009, 회사 설정 꺼짐 VOC-011(한도 안 셈), 로그인만(공개 아님·`ORG_MANAGE` 아님), 회사 설정 API는 `ORG_MANAGE` VIEW·USE.

## 설정 파일 쓰기 (2026-10-21, #487)

- `storage/settings/stt.json`·`steelman-wake.json`·`llm.json`과 철강맨AI 브라우저 설정은 공통 함수 `writeFileAtomic`(common/storage)으로 같은 폴더의 임시 파일(무작위 이름)에 다 쓴 뒤 이름을 바꿔 끼운다. 실패하면 임시 파일(API 키가 든)을 지운다. 쓰는 도중 읽는 요청이 반쪽 JSON을 읽어 오류가 나지 않는다. LLM 설정(`llm.json`)은 이슈 #497에서 같은 방식으로 바꿨다.
- 설정 파일은 API 키가 들어 있어 **0600**으로 쓴다(임시 파일부터 0600이라 쓰는 동안에도 남이 읽지 못하고, 예전에 0644로 만든 파일은 다음 저장 때 0600이 된다, 이슈 #497).
