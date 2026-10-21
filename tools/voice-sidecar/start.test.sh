#!/bin/sh
# start.sh 시험 (launchctl은 부르지 않는다: VOICE_DRY_RUN=1). 실행: sh tools/voice-sidecar/start.test.sh
# 빈칸·작은따옴표가 든 홈 폴더, 포트 바꾸기, --local 안내, 복사본으로 다시 설치할 때 HF_TOKEN 보존, 로그 돌리기.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAKE_HOME="$WORK/home with space/o'neil"
mkdir -p "$FAKE_HOME/models"
MODEL="$FAKE_HOME/models/ggml-large-v3-turbo-it's.bin"
printf 'x' > "$MODEL"
APP_DIR="$FAKE_HOME/Library/Application Support/fantasteel-voice"
PLIST="$FAKE_HOME/Library/LaunchAgents/com.fantasteel.voice.plist"
failures=0

check() {
  if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi
}

run() {
  HOME="$FAKE_HOME" VOICE_DRY_RUN=1 HF_TOKEN="${TEST_HF:-}" SIDECAR_PORT="${TEST_PORT:-8001}" sh "$@" 2>&1
}

out=$(TEST_HF="hf_ab'cd" TEST_PORT=8123 run "$HERE/start.sh" --install)
check "설치하면 복사본·env·plist가 생긴다" '[ -f "$APP_DIR/start.sh" ] && [ -f "$APP_DIR/server.py" ] && [ -f "$APP_DIR/env" ] && [ -f "$PLIST" ]'
check "env는 본인만 읽는다" '[ "$(stat -f %Lp "$APP_DIR/env")" = 600 ]'
check "작은따옴표가 든 경로·토큰도 env를 읽을 수 있다" '( . "$APP_DIR/env"; [ "$WHISPER_MODEL" = "$MODEL" ] && [ "$HF_TOKEN" = "hf_ab'"'"'cd" ] )'
check "바꾼 포트를 plist·env에 적는다" 'grep -q "<string>8123</string>" "$PLIST" && ( . "$APP_DIR/env"; [ "$SIDECAR_PORT" = 8123 ] )'
check "plist는 복사본 start.sh를 돌린다" 'grep -q "fantasteel-voice/start.sh</string>" "$PLIST"'
check "DRY_RUN이면 launchctl을 부르지 않고 보이기만 한다" 'printf "%s" "$out" | grep -q "^launchctl bootstrap"'
check "다른 PC용 설치는 API 키 안내를 보인다" 'printf "%s" "$out" | grep -q "API 키:"'

out=$(run "$APP_DIR/start.sh" --install)
check "복사본으로 다시 설치해도 HF_TOKEN을 지킨다" '( . "$APP_DIR/env"; [ "$HF_TOKEN" = "hf_ab'"'"'cd" ] )'
check "HF_TOKEN을 지켰으면 없다는 경고가 없다" '! printf "%s" "$out" | grep -q "HF_TOKEN을 찾지 못했어요"'

out=$(run "$HERE/start.sh" --install --local)
check "--local 설치는 API 키 안내를 빼고 이 Mac 주소만 보인다" '! printf "%s" "$out" | grep -q "API 키:" && ! printf "%s" "$out" | grep -q "같은 망:"'
check "--local 설치는 plist에 --local을 넘긴다" 'grep -q "<string>--local</string>" "$PLIST"'

LOG="$FAKE_HOME/Library/Logs/fantasteel-voice.log"
mkdir -p "$(dirname "$LOG")"
head -c 6000000 /dev/zero > "$LOG"
HOME="$FAKE_HOME" FANTASTEEL_VOICE_AGENT=1 VOICE_PYTHON=/nonexistent/python sh "$APP_DIR/start.sh" >/dev/null 2>&1 || true
check "자동 켜기 로그가 5MB를 넘으면 돌린다" '[ -f "$LOG.1" ] && [ "$(wc -c < "$LOG")" -lt 1000 ] && grep -q "파이썬 환경이 없어요" "$LOG"'

out=$(run "$HERE/start.sh" --uninstall)
check "지우면 plist·복사본·env가 없어진다" '[ ! -f "$PLIST" ] && [ ! -f "$APP_DIR/start.sh" ] && [ ! -f "$APP_DIR/env" ]'

if [ "$failures" -gt 0 ]; then echo "$failures개 실패"; exit 1; fi
echo "모두 통과"
