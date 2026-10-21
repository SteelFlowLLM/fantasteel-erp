#!/bin/sh
# 내 Mac의 음성 서버를 한 번에 켠다: whisper.cpp(127.0.0.1:8000, 이 Mac 안에서만) + 사이드카(0.0.0.0:8001, API 키 검사).
# whisper.cpp에는 키 기능이 없어서 밖에는 키를 검사하는 사이드카만 연다.
#   tools/voice-sidecar/start.sh            다른 PC(같은 망·Tailscale)에서도 붙게 연다 (API 키 필요)
#   tools/voice-sidecar/start.sh --local    이 Mac에서만 쓴다 (ERP 서버가 이 Mac일 때, 키 없음)
# 끄기: 이 터미널에서 Ctrl+C (whisper.cpp도 같이 꺼진다)
# 로그인 때 저절로 켜기 (macOS LaunchAgent, 멈추면 다시 켜진다. 로그는 ~/Library/Logs/fantasteel-voice.log)
#   tools/voice-sidecar/start.sh --install [--local]   등록하고 바로 켠다
#   tools/voice-sidecar/start.sh --uninstall           끄고 등록을 지운다
#   tools/voice-sidecar/start.sh --status              켜졌는지, ERP에 넣을 주소·키 위치
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# 자동 켜기는 이 스크립트와 server.py를 APP_DIR에 복사해 그쪽을 돌린다:
# launchd가 띄운 셸은 macOS 개인정보 보호 때문에 ~/Documents(저장소)와 다른 앱 폴더(~/Library/Containers)를 읽지 못한다
APP_DIR="$HOME/Library/Application Support/fantasteel-voice"
# shellcheck disable=SC1091 # 자동 켜기 때 --install이 만든 설정 (HF_TOKEN·WHISPER_MODEL)
if [ -f "$SCRIPT_DIR/env" ]; then . "$SCRIPT_DIR/env"; fi
PYTHON=${VOICE_PYTHON:-$HOME/voice-env/bin/python}
WHISPER_PORT=${WHISPER_PORT:-8000}
SIDECAR_PORT=${SIDECAR_PORT:-8001}
# ERP 서버(server/src/modules/stt/stt-local-server.service.ts)가 같은 이름·경로로 켜고 끈다
LABEL=com.fantasteel.voice
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/fantasteel-voice.log"
KEY_FILE=${SIDECAR_API_KEY_FILE:-$HOME/.config/fantasteel-voice/api-key}
DOMAIN="gui/$(id -u)"

# 모델 파일: WHISPER_MODEL → ~/models → Spokenly 앱이 받아 둔 파일 순서로 찾는다
find_model() {
  if [ -n "${WHISPER_MODEL:-}" ]; then echo "$WHISPER_MODEL"; return; fi
  for f in "$HOME"/models/ggml-large-v3-turbo*.bin "$HOME"/models/ggml-*.bin "$APP_DIR"/models/*ggml*.bin \
    "$HOME/Library/Containers/app.spokenly/Data/Library/Application Support/Spokenly/Models/whisper-ggml-large-v3-turbo-q5_0.bin"; do
    if [ -f "$f" ]; then echo "$f"; return; fi
  done
}
print_addresses() {
  echo "ERP 음성 인식 카드에 넣을 주소 (방식: 내 음성 서버)"
  LAN=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
  [ -n "$LAN" ] && echo "  같은 망:   http://$LAN:$SIDECAR_PORT/v1"
  if command -v tailscale >/dev/null; then
    TS=$(tailscale ip -4 2>/dev/null | head -1 || true)
    [ -n "$TS" ] && echo "  Tailscale: http://$TS:$SIDECAR_PORT/v1"
  fi
  echo "  이 Mac:    http://127.0.0.1:$SIDECAR_PORT/v1"
  return 0
}

case "${1:-}" in
  --install)
    MODE_ARG=""
    [ "${2:-}" = "--local" ] && MODE_ARG="<string>--local</string>"
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")" "$APP_DIR/models"
    if [ "$SCRIPT_DIR" != "$APP_DIR" ]; then
      cp "$SCRIPT_DIR/start.sh" "$SCRIPT_DIR/server.py" "$APP_DIR/"
    fi
    MODEL=$(find_model)
    if [ -z "$MODEL" ] || [ ! -f "$MODEL" ]; then
      echo "whisper 모델 파일(ggml-*.bin)을 찾지 못했어요. ~/models에 두거나 WHISPER_MODEL=경로 로 알려 주세요" >&2
      exit 1
    fi
    case "$MODEL" in
      */Library/Containers/*)
        # 다른 앱(Spokenly) 폴더는 자동 켜기에서 읽을 수 없어 한 번 복사해 둔다
        echo "모델 파일을 복사해요 (한 번만): $(basename "$MODEL")"
        cp "$MODEL" "$APP_DIR/models/"
        MODEL="$APP_DIR/models/$(basename "$MODEL")"
        ;;
    esac
    HF=${HF_TOKEN:-}
    if [ -z "$HF" ] && [ -f "$SCRIPT_DIR/../../server/.env" ]; then
      HF=$(sed -n 's/^HF_TOKEN=//p' "$SCRIPT_DIR/../../server/.env" | head -1 | tr -d "\"'")
    fi
    # 화자 분리용 토큰이 들어가므로 본인만 읽게 한다
    umask 077
    {
      echo "WHISPER_MODEL='$MODEL'"
      if [ -n "$HF" ]; then echo "export HF_TOKEN='$HF'"; fi
    } > "$APP_DIR/env"
    umask 022
    if [ -z "$HF" ]; then echo "HF_TOKEN을 찾지 못했어요. 받아쓰기는 되지만 화자 분리는 안 돼요 (server/.env에 HF_TOKEN=…)"; fi
    # launchd는 로그인 셸의 PATH를 모른다: whisper-server·ffmpeg(Homebrew)와 lsof·ipconfig(/usr/sbin)를 찾게 적어 둔다.
    # 작업 폴더도 정한다: 기본값 /는 쓸 수 없어 whisper-server --convert가 변환 파일을 못 만들고 500을 낸다
    cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$APP_DIR/start.sh</string>$MODE_ARG</array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_END
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    # 내리는 중에 바로 올리면 bootstrap이 'Input/output error'로 실패한다: 다 내려갈 때까지 기다린다
    i=0
    while launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 && [ $i -lt 20 ]; do sleep 0.5; i=$((i + 1)); done
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "등록했어요. 이제 로그인하면 음성 서버가 저절로 켜져요 (로그: $LOG)"
    echo "코드를 새로 받았으면 --install을 다시 하면 새 코드로 바뀌어요"
    echo "API 키: ${KEY_FILE} (처음 켜질 때 만들어져요. 보기: cat \"$KEY_FILE\")"
    print_addresses
    exit 0
    ;;
  --uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST" "$APP_DIR/start.sh" "$APP_DIR/server.py" "$APP_DIR/env"
    echo "음성 서버를 끄고 자동 켜기를 지웠어요 (복사한 모델 파일은 $APP_DIR/models에 남겨 둬요)"
    exit 0
    ;;
  --status)
    if [ ! -f "$PLIST" ]; then echo "자동 켜기: 등록 안 됨 (tools/voice-sidecar/start.sh --install)"; else echo "자동 켜기: 등록됨 ($PLIST)"; fi
    if launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q "state = running"; then echo "상태: 켜짐"; else echo "상태: 꺼짐"; fi
    if curl -s -m 2 "http://127.0.0.1:$SIDECAR_PORT/health" >/dev/null 2>&1; then echo "응답: 됨 (127.0.0.1:$SIDECAR_PORT)"; else echo "응답: 없음"; fi
    echo "API 키 파일: $KEY_FILE"
    echo "로그: $LOG"
    print_addresses
    exit 0
    ;;
  --local) SIDECAR_HOST=${SIDECAR_HOST:-127.0.0.1} ;;
  "") SIDECAR_HOST=${SIDECAR_HOST:-0.0.0.0} ;;
  *) echo "모르는 옵션이에요: $1 (--local, --install, --uninstall, --status)" >&2; exit 2 ;;
esac

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
  print_addresses
fi

SIDECAR_HOST=$SIDECAR_HOST SIDECAR_PORT=$SIDECAR_PORT WHISPER_URL="http://127.0.0.1:$WHISPER_PORT/v1/audio/transcriptions" \
  "$PYTHON" "$SCRIPT_DIR/server.py"
