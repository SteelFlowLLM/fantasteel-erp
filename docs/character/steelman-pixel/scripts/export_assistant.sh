#!/bin/bash
# AI 어시스턴트용 철강맨 디자인을 다시 만든다: ./export_assistant.sh
# Aseprite(Steam) CLI와 python3 + Pillow가 필요하다.
set -euo pipefail
cd "$(dirname "$0")"
A="${ASEPRITE:-$HOME/Library/Application Support/Steam/steamapps/common/Aseprite/Aseprite.app/Contents/MacOS/aseprite}"
OUT="$(cd .. && pwd)/assistant"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT/gif" "$OUT/gif_transparent" "$OUT/sheet" "$OUT/icons"
rm -f "$OUT/steelman_assistant.aseprite" "$OUT"/icons/*.aseprite

# 1) 모션 (상황별 시안 = 태그)
python3 gen_assistant.py "$OUT/steelman_assistant.aseprite" "$TMP/assistant.lua"
"$A" -b --script "$TMP/assistant.lua" >/dev/null

# 2) 시안별 GIF (배경 있음 / 투명) — 8배 확대
while IFS=$'\t' read -r tag fname desc; do
  "$A" -b "$OUT/steelman_assistant.aseprite" --tag "$tag" --scale 8 --save-as "$OUT/gif/$fname.gif" >/dev/null
  "$A" -b --ignore-layer 배경 --ignore-layer 그림자 "$OUT/steelman_assistant.aseprite" \
    --tag "$tag" --scale 8 --save-as "$OUT/gif_transparent/$fname.gif" >/dev/null
done < "$TMP/assistant.lua.tags"

# 3) 시트 (한 줄에 시안 하나) + 프레임·태그 정보
"$A" -b "$OUT/steelman_assistant.aseprite" --split-tags --sheet-type rows \
  --sheet "$OUT/sheet/steelman_assistant_sheet.png" --data "$OUT/sheet/steelman_assistant_sheet.json" \
  --format json-array --list-tags >/dev/null
"$A" -b --ignore-layer 배경 --ignore-layer 그림자 "$OUT/steelman_assistant.aseprite" --split-tags --sheet-type rows \
  --sheet "$OUT/sheet/steelman_assistant_sheet_transparent.png" \
  --data "$OUT/sheet/steelman_assistant_sheet_transparent.json" --format json-array --list-tags >/dev/null

# 4) 이름표 붙은 검토용 한눈에 보기
python3 review_assistant.py "$OUT/overview.png" 4 bg
python3 review_assistant.py "$OUT/overview_transparent.png" 4 clear

# 5) 아이콘 (버튼·아바타)
python3 gen_icons.py "$OUT/icons" "$TMP/icons.lua"
"$A" -b --script "$TMP/icons.lua" >/dev/null
for s in 16 20 24; do
  f="$OUT/icons/steelman_icon_$s.aseprite"
  "$A" -b "$f" --save-as "$OUT/icons/steelman_icon_${s}.png" >/dev/null
  "$A" -b --ignore-layer 배경 "$f" --save-as "$OUT/icons/steelman_icon_${s}_transparent.png" >/dev/null
  "$A" -b "$f" --scale 8 --save-as "$OUT/icons/steelman_icon_${s}@8x.png" >/dev/null
  "$A" -b --ignore-layer 배경 "$f" --scale 8 --save-as "$OUT/icons/steelman_icon_${s}_transparent@8x.png" >/dev/null
done
echo "done: $OUT"
