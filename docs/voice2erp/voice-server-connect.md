# 음성 서버 켜기·연결하기

ERP의 음성 인식(회의록 음성 등록)은 OpenAI 호환 `POST /v1/audio/transcriptions`를 여는 서버에 붙는다. 문서에 없는 기능(이슈 #432)이고, 관리 › **AI 연결 › 음성 인식 (STT)** 카드에서 설정한다.

**LLM(LM Studio)을 API로 바꿔도 음성은 이 설정을 따로 쓴다.** 두 설정은 저장도 따로다(`storage/settings/llm.json`·`stt.json`).

## 어디서 부르나

주소는 **ERP 서버가 부른다.** 그래서 `127.0.0.1`은 사용자 PC가 아니라 ERP 서버를 돌리는 컴퓨터다. 사용자 PC에는 음성 서버가 없어도 된다.

| 방식 | 주소 예 | 모델 | 키 |
| --- | --- | --- | --- |
| 내 음성 서버, 이 컴퓨터 | `http://127.0.0.1:8000/v1` (whisper.cpp), `http://127.0.0.1:8001/v1` (화자 분리) | 비움 / `whisper-pyannote` / `vibevoice` | 없음 |
| 내 음성 서버, 같은 망 PC | `http://192.168.0.20:8000/v1` (10.x, 172.16~31.x도 같다) | 위와 같다 | 없음 |
| 내 음성 서버, Tailscale | `http://100.101.102.103:8001/v1` 또는 `http://내pc.tailnet이름.ts.net:8001/v1` | 위와 같다 | 없음 |
| OpenAI 방식 음성 API | `https://api.openai.com/v1` | `whisper-1` | 필요 |

주소는 관리자가 넣는 서버 설정이라 위 범위를 막지 않는다(철강맨AI 웹 도구의 사설 주소 차단 규칙과 별개). 화면은 주소가 어느 쪽인지(이 서버 컴퓨터·같은 망·Tailscale·인터넷)를 입력칸 아래에 알려 주고, 암호화 없는 `http://` 인터넷 주소와 `0.0.0.0`에는 경고를 띄운다.

## 음성 서버 켜기

음성 서버를 돌릴 컴퓨터(ERP 서버와 같아도, 다른 PC여도 된다)에서 한다. 모델 파일은 저장소 밖에 둔다.

```bash
# whisper.cpp (포트 8000). 같은 컴퓨터에서만 쓰면 --host 127.0.0.1
whisper-server -m ~/models/ggml-large-v3-turbo.bin --host 0.0.0.0 --port 8000 \
  --inference-path /v1/audio/transcriptions --convert -l ko \
  --vad --vad-model ~/models/ggml-silero-v5.1.2.bin
```

```bash
# 화자 분리 서버 (포트 8001, tools/voice-sidecar/README.md)
SIDECAR_HOST=0.0.0.0 ~/voice-env/bin/python tools/voice-sidecar/server.py
```

화자 분리 서버의 `whisper-pyannote`는 같은 컴퓨터의 whisper.cpp(`WHISPER_URL`, 기본 `http://127.0.0.1:8000/v1/audio/transcriptions`)를 부르므로, 두 서버를 한 컴퓨터에 두면 된다.

## 다른 PC의 음성 서버에 붙기

1. 그 PC에서 서버를 `0.0.0.0`으로 띄운다(위 명령). `127.0.0.1`로 띄우면 같은 컴퓨터 밖에서는 연결이 거절된다.
2. **같은 망**이면 그 PC의 방화벽에서 포트(8000·8001)를 연다. 확인: ERP 서버 컴퓨터에서 `curl http://192.168.0.20:8001/health`(화자 분리 서버) 또는 포트 열림 확인. 주소는 그 PC의 `192.168.x.x`다(macOS `ipconfig getifaddr en0`, Windows `ipconfig`).
3. **다른 망**(집·출장)이면 두 컴퓨터(ERP 서버와 음성 서버 PC)에 [Tailscale](https://tailscale.com)을 깔고 같은 계정으로 로그인한다. 음성 서버 PC에서 `tailscale ip -4`로 `100.x.x.x` 주소를 확인하거나 MagicDNS 이름(`…ts.net`)을 쓴다. 방화벽을 인터넷에 열 필요가 없다.
4. 관리 › AI 연결 › 음성 인식에서 방식 **내 음성 서버**, 주소를 넣고 **연결 확인** → **저장** → **파일로 시험**.

연결 확인은 1초 무음 WAV를 실제로 보내 본다(첫 확인은 서버가 모델을 올리느라 오래 걸릴 수 있다). 실패하면 이유가 나온다.

| 화면에 보이는 이유 | 보통 원인 |
| --- | --- |
| 연결을 거절했어요 | 음성 서버가 꺼져 있다, 포트가 다르다, 다른 PC인데 `127.0.0.1`로 띄웠다 |
| 길이 닿지 않아요 | 그 PC가 꺼졌다·다른 망이다, 방화벽이 포트를 막는다, Tailscale이 끊겼다 |
| 주소를 찾을 수 없어요 | 이름 철자 오류, Tailscale 이름인데 ERP 서버 쪽 Tailscale이 꺼져 있다 |
| …/audio/transcriptions 경로가 없어요 | 주소 끝의 `/v1`이 빠졌거나 OpenAI 호환 음성 서버가 아니다 |
| API 키가 맞지 않거나 권한이 없어요 | API 방식에서 키가 틀렸다 |

## 보안

- 음성 서버(whisper.cpp·화자 분리)에는 로그인이 없다. 회의 내용이 오가므로 같은 망·Tailscale 같은 믿는 망에서만 연다. 공유기 포트 포워딩 등으로 인터넷에 직접 열지 않는다.
- 링크 로컬(`169.254.x.x`)·클라우드 메타데이터 주소와 주소 안의 아이디·비밀번호는 받지 않는다. 저장된 API 키는 주소의 출처가 같을 때만 쓰므로, 주소를 바꾸면 키를 다시 입력해야 한다.
- API 키는 서버 파일(`storage/settings/stt.json`)에만 저장하고 화면에는 다시 보내지 않는다(`hasApiKey`만 알린다).
- OpenAI 방식 음성 API를 쓰면 회의 음성이 그 회사 서버로 나간다. 사내 방침을 먼저 정한다.
