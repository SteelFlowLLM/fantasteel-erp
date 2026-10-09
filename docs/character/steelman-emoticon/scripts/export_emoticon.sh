#!/bin/bash
# 메신저 철강맨 이모티콘을 다시 만든다: ./export_emoticon.sh
# Aseprite(Steam) CLI와 python3 + Pillow가 필요하다. 글자 글꼴은 macOS 기본(Apple SD Gothic Neo), 다른 OS는 EMOTICON_FONT로 바꾼다.
# 결과: ../steelman_work_64·daily_64·event_64.aseprite(묶음마다), ../gif·png·sheet, 그리고 화면이 쓰는 client/public/emoticons/<키>.gif·.png
set -euo pipefail
cd "$(dirname "$0")"
A="${ASEPRITE:-$HOME/Library/Application Support/Steam/steamapps/common/Aseprite/Aseprite.app/Contents/MacOS/aseprite}"
OUT="$(cd .. && pwd)"
PUBLIC="$(cd ../../../../client/public && pwd)/emoticons"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT/gif" "$OUT/png" "$OUT/sheet" "$PUBLIC"

# 묶음마다: work = 철강맨 업무, daily = 철강맨 일상, event = 철강맨 행사
for SET in work daily event; do
  ASE="$OUT/steelman_${SET}_64.aseprite"
  WORK="$TMP/$SET"
  mkdir -p "$WORK"
  rm -f "$ASE"

  # 1) 레이어(뒤효과·캐릭터·앞효과·글자) + 이모티콘마다 태그
  python3 gen_emoticon.py "$OUT/source/steelman_pet_sheet.png" "$WORK" "$SET" "$ASE"
  "$A" -b --script "$WORK/build.lua" >/dev/null

  # 2) 시트 + 프레임·재생 시간·태그 json
  "$A" -b "$ASE" --split-tags --sheet-type rows \
    --sheet "$OUT/sheet/steelman_${SET}_64.png" --data "$OUT/sheet/steelman_${SET}_64.json" \
    --format json-array --list-tags >/dev/null

  # 3) 이모티콘별 GIF(움직임) + 멈춘 그림 PNG(가장 오래 머무는 프레임). 원본 크기 64px, 화면이 2배로 보여 준다
  while IFS=$'\t' read -r tag key text; do
    "$A" -b "$ASE" --tag "$tag" --save-as "$OUT/gif/$key.gif" >/dev/null
  done < "$WORK/tags.tsv"
  python3 - "$OUT" "$SET" "$WORK/tags.tsv" <<'PY'
import json, sys
from PIL import Image
out, set_name, tags_path = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(f'{out}/sheet/steelman_{set_name}_64.json'))
sheet = Image.open(f'{out}/sheet/steelman_{set_name}_64.png')
keys = [line.rstrip('\n').split('\t')[1] for line in open(tags_path)]
for tag, key in zip(data['meta']['frameTags'], keys):
    idx = max(range(tag['from'], tag['to'] + 1), key=lambda i: (data['frames'][i]['duration'], i))
    f = data['frames'][idx]['frame']
    sheet.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h'])).save(f'{out}/png/{key}.png')
PY
done

# 4) 화면용 사본
cp "$OUT"/gif/*.gif "$OUT"/png/*.png "$PUBLIC/"
echo "done: $OUT, $PUBLIC"
