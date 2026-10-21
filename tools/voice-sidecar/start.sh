#!/bin/sh
# 내 Mac의 음성 서버를 한 번에 켠다: whisper.cpp(127.0.0.1:8000, 이 Mac 안에서만) + 사이드카(0.0.0.0:8001, API 키 검사).
# whisper.cpp에는 키 기능이 없어서 밖에는 키를 검사하는 사이드카만 연다.
#   tools/voice-sidecar/start.sh            다른 PC(같은 망·Tailscale)에서도 붙게 연다 (API 키 필요)
#   tools/voice-sidecar/start.sh --local    이 Mac에서만 쓴다 (ERP 서버가 이 Mac일 때, 키 없음)
# 끄기: 이 터미널에서 Ctrl+C (whisper.cpp도 같이 꺼진다)
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PYTHON=${VOICE_PYTHON:-$HOME/voice-env/bin/python}
WHISPER_PORT=${WHISPER_PORT:-8000}
SIDECAR_PORT=${SIDECAR_PORT:-8001}
if [ "${1:-}" = "--local" ]; then
  SIDECAR_HOST=${SIDECAR_HOST:-127.0.0.1}
else
  SIDECAR_HOST=${SIDECAR_HOST:-0.0.0.0}
fi

# 모델 파일: WHISPER_MODEL → ~/models → Spokenly 앱이 받아 둔 파일 순서로 찾는다
find_model() {
  if [ -n "${WHISPER_MODEL:-}" ]; then echo "$WHISPER_MODEL"; return; fi
  for f in "$HOME"/models/ggml-large-v3-turbo*.bin "$HOME"/models/ggml-*.bin \
    "$HOME/Library/Containers/app.spokenly/Data/Library/Application Support/Spokenly/Models/whisper-ggml-large-v3-turbo-q5_0.bin"; do
    if [ -f "$f" ]; then echo "$f"; return; fi
  done
}
MODEL=$(find_model)
if [ -z "$MODEL" ] || [ ! -f "$MODEL" ]; then
  echo "whisper 모델 파일(ggml-*.bin)을 찾지 못했어요. ~/models에 두거나 WHISPER_MODEL=경로 로 알려 주세요" >&2
  exit 1
fi
command -v whisper-server >/dev/null || { echo "whisper-server가 없어요: brew install whisper-cpp" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg가 없어요: brew install ffmpeg" >&2; exit 1; }
[ -x "$PYTHON" ] || { echo "파이썬 환경이 없어요: $PYTHON (tools/voice-sidecar/README.md)" >&2; exit 1; }

WHISPER_PID=""
if lsof -nP -iTCP:"$WHISPER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "whisper 서버가 이미 $WHISPER_PORT 포트에 떠 있어 그대로 써요"
else
  VAD=""
  for v in "$HOME"/models/ggml-silero-*.bin; do [ -f "$v" ] && VAD="--vad --vad-model $v"; done
  echo "whisper 서버를 켜요: $(basename "$MODEL") (127.0.0.1:$WHISPER_PORT)"
  # shellcheck disable=SC2086 # VAD는 빈 값이거나 옵션 두 개다
  whisper-server -m "$MODEL" --host 127.0.0.1 --port "$WHISPER_PORT" \
    --inference-path /v1/audio/transcriptions --convert -l ko $VAD >/dev/null 2>&1 &
  WHISPER_PID=$!
fi
trap '[ -n "$WHISPER_PID" ] && kill "$WHISPER_PID" 2>/dev/null' EXIT INT TERM

if [ "$SIDECAR_HOST" != "127.0.0.1" ]; then
  echo ""
  echo "ERP 음성 인식 카드에 넣을 주소 (방식: 내 음성 서버)"
  LAN=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
  [ -n "$LAN" ] && echo "  같은 망:   http://$LAN:$SIDECAR_PORT/v1"
  if command -v tailscale >/dev/null; then
    TS=$(tailscale ip -4 2>/dev/null | head -1 || true)
    [ -n "$TS" ] && echo "  Tailscale: http://$TS:$SIDECAR_PORT/v1"
  fi
  echo "  이 Mac:    http://127.0.0.1:$SIDECAR_PORT/v1"
fi

SIDECAR_HOST=$SIDECAR_HOST SIDECAR_PORT=$SIDECAR_PORT WHISPER_URL="http://127.0.0.1:$WHISPER_PORT/v1/audio/transcriptions" \
  "$PYTHON" "$ROOT/tools/voice-sidecar/server.py"
