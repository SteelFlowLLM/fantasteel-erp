"""Static steelman icons (16/20/24px, eyes version) for the AI button and chat avatar.

usage: python3 gen_icons.py <out_dir> <out.lua>
Each .aseprite has 3 layers: 배경(navy rounded square) · 외곽선(navy) · 캐릭터.
Hide 배경 for the transparent version (outline keeps it visible on white panels).
"""
import sys
import gen_eyes as ge

PAL = ge.PAL


def layers(size):
    rows, corner = ge.SPRITES[size]
    top = (size - len(rows) + 1) // 2
    bg = [[None] * size for _ in range(size)]
    for y in range(size):
        t = corner[y] if y < len(corner) else corner[size - 1 - y] if y >= size - len(corner) else 0
        for x in range(t, size - t):
            bg[y][x] = 'N'
    ch = [[None] * size for _ in range(size)]
    for j, row in enumerate(rows):
        for x, c in enumerate(row):
            if c != '.':
                ch[top + j][x] = c
    ol = [[None] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            if ch[y][x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < size and 0 <= ny < size and ch[ny][nx]:
                    ol[y][x] = 'N'
                    break
    return {'배경': bg, '외곽선': ol, '캐릭터': ch}


def rgb(c):
    h = PAL[c].lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def lua(size, out_dir):
    L = layers(size)
    blocks = []
    for name in ('배경', '외곽선', '캐릭터'):
        px = ','.join('{%d,%d,%d,%d,%d}' % ((x, y) + rgb(c))
                      for y, row in enumerate(L[name]) for x, c in enumerate(row) if c)
        blocks.append(f'{{"{name}",{{{px}}}}}')
    return f'''
do
  local spr = Sprite({size}, {size}, ColorMode.RGB)
  local data = {{{','.join(blocks)}}}
  for i, d in ipairs(data) do
    local layer = (i == 1) and spr.layers[1] or spr:newLayer()
    layer.name = d[1]
    local img = Image({size}, {size}, ColorMode.RGB)
    for _, p in ipairs(d[2]) do img:drawPixel(p[1], p[2], app.pixelColor.rgba(p[3], p[4], p[5], 255)) end
    spr:newCel(layer, 1, img, Point(0, 0))
  end
  spr:saveAs("{out_dir}/steelman_icon_{size}.aseprite")
  spr:close()
end
'''


if __name__ == '__main__':
    out_dir, path = sys.argv[1], sys.argv[2]
    with open(path, 'w') as fh:
        fh.write('\n'.join(lua(s, out_dir) for s in (16, 20, 24)))
