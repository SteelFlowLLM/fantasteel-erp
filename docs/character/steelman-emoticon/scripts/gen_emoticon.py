"""철강맨 메신저 이모티콘 묶음 하나 (64px, 움직임) -> 레이어 PNG + Aseprite Lua.

사용: python3 gen_emoticon.py <펫 원본 시트.png> <작업 폴더> <묶음: work|daily|event> <출력 .aseprite>
  작업 폴더/frames/*.png, 작업 폴더/build.lua, 작업 폴더/tags.tsv(태그 · 키 · 글자)
검토용: python3 gen_emoticon.py <펫 원본 시트.png> --review <묶음> <출력 .png>  (프레임을 한 장에 펼친 그림)
캐릭터는 펫 철강맨(신형 작업복) 48px 시트를 쓰고, 64px 캔버스 위쪽에 글자를 얹는다. 그리기 도구는 emoticon_lib.py.
"""
import os
import sys

from PIL import Image

import set_daily
import set_event
import set_work
from emoticon_lib import LAYERS, ORIGIN, SIZE, Canvas, Sheet, outline_text, place_props, render, to_lua

SETS = {'work': set_work, 'daily': set_daily, 'event': set_event}


def composite(e):
    """검토용: 레이어를 합친 프레임들."""
    text = outline_text(e['lines'], e['color'], e['align'])
    out = []
    for f in e['frames']:
        o = (ORIGIN[0] + f['shake'][0], e['oy'] + f['shake'][1] + f['cx'])
        c = Canvas(SIZE)
        place_props(c, f['back'], o)
        if f['char'] is not None:
            c.put(f['char'], o[0] + f['char_at'][0], o[1] + f['char_at'][1])
        place_props(c, f['front'], o)
        c.im.alpha_composite(text)
        out.append((c.im, f['dur']))
    return out


def review(E, path, scale=3):
    cols = max(len(e['frames']) for e in E)
    sheet = Image.new('RGBA', (cols * SIZE, len(E) * SIZE), (255, 255, 255, 255))
    for r, e in enumerate(E):
        for c, (im, _) in enumerate(composite(e)):
            if (r + c) % 2:
                sheet.paste((238, 242, 246, 255), (c * SIZE, r * SIZE, c * SIZE + SIZE, r * SIZE + SIZE))
            sheet.alpha_composite(im, (c * SIZE, r * SIZE))
    sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST).save(path)


if __name__ == '__main__':
    if sys.argv[2] == '--review':
        sheet_path, set_name, out = sys.argv[1], sys.argv[3], sys.argv[4]
        review(SETS[set_name].build(Sheet(sheet_path)), out)
        sys.exit(0)
    sheet_path, workdir, set_name, ase_path = sys.argv[1:5]
    E = SETS[set_name].build(Sheet(sheet_path))
    with open(os.path.join(workdir, 'tags.tsv'), 'w') as fh:
        for e in E:
            fh.write(f"{e['tag']}\t{e['key']}\t{' '.join(e['lines'])}\n")
    plan, tags = render(E, workdir)
    with open(os.path.join(workdir, 'build.lua'), 'w') as fh:
        fh.write(to_lua(plan, tags, ase_path))
