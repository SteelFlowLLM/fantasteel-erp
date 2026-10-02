"""Hand-drawn small steelman (smile) at several sizes -> Aseprite Lua script."""
import sys

PAL = {
    'N': '#1b2531', 'O': '#e07028', 'D': '#af5d2a', 'L': '#f08a45',
    'W': '#ffffff', 'S': '#c9d3de', 'P': '#f5a3a3', 'G': '#9fb3c8',
}

# '.' = background navy, other letters = PAL
SPRITES = {
    12: ([
        "....OOOO....",
        "...OODDOO...",
        "..OLODDOOO..",
        ".OOOOOOOOOO.",
        "..WWWWWWWW..",
        ".WWNWWWWNWW.",
        ".WPNWWWWNPW.",
        ".WWWWNNWWWW.",
        "..SSSSSSSS..",
    ], [2, 1]),
    16: ([
        ".....OOOOOO.....",
        "....OOODDOOO....",
        "...OLOODDOOOO...",
        "...OOOODDOOOO...",
        ".OOOOOOOOOOOOOO.",
        "...WWWWWWWWWW...",
        "..WWWNWWWWNWWW..",
        "..WWWNWWWWNWWW..",
        "..WPPWWWWWWPPW..",
        "..WWWWNWWNWWWW..",
        "..WWWWWNNWWWWW..",
        "...SSSSSSSSSS...",
    ], [2, 1]),
    20: ([
        ".......OOOOOO.......",
        ".....OOOODDOOOO.....",
        "....OLOOODDOOOOO....",
        "...OLOOOODDOOOOOO...",
        "...OOOOOODDOOOOOO...",
        ".OOOOOOOOOOOOOOOOOO.",
        "...WWWWWWWWWWWWWW...",
        "..WWWWWWWWWWWWWWWW..",
        "..WWWNNWWWWWWNNWWW..",
        "..WWWNNWWWWWWNNWWW..",
        "..WPPWWWWWWWWWWPPW..",
        "..WWWWWWNWWNWWWWWW..",
        "..WWWWWWWNNWWWWWWW..",
        "...SSSSSSSSSSSSSS...",
    ], [3, 1, 1]),
    24: ([
        "........OOOOOOOO........",
        "......OOOOODDOOOOO......",
        ".....OLOOOODDOOOOOO.....",
        "....OLLOOOODDOOOOOOO....",
        "....OLOOOOODDOOOOOOO....",
        "...OOOOOOOODDOOOOOOOO...",
        "...OOOOOOOODDOOOOOOOO...",
        ".OOOOOOOOOOOOOOOOOOOOOO.",
        "..OOOOOOOOOOOOOOOOOOOO..",
        "....WWWWWWWWWWWWWWWW....",
        "...WWWWWWWWWWWWWWWWWW...",
        "...WWWNNWWWWWWWWNNWWW...",
        "...WWWNNWWWWWWWWNNWWW...",
        "...WWWNNWWWWWWWWNNWWW...",
        "...WPPWWWWWWWWWWWWPPW...",
        "...WWWWWWWNWWNWWWWWWW...",
        "...WWWWWWWWNNWWWWWWWW...",
        "....SSSSSSSSSSSSSSSS....",
    ], [3, 2, 1]),
}


def grid(size):
    rows, corner = SPRITES[size]
    assert all(len(r) == size for r in rows), size
    top = (size - len(rows) + 1) // 2
    g = [[None] * size for _ in range(size)]
    for y in range(size):
        t = corner[y] if y < len(corner) else corner[size - 1 - y] if y >= size - len(corner) else 0
        for x in range(t, size - t):
            g[y][x] = 'N'
    for j, row in enumerate(rows):
        for x, c in enumerate(row):
            if c != '.':
                g[top + j][x] = c
    return g


def lua(size, out):
    g = grid(size)
    px = []
    for y in range(size):
        for x in range(size):
            c = g[y][x]
            if c:
                h = PAL[c].lstrip('#')
                px.append('{%d,%d,%d,%d,%d}' % (x, y, int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)))
    pal = '\n'.join('pal:setColor(%d, Color{r=%d,g=%d,b=%d})' % (i, int(v[1:3], 16), int(v[3:5], 16), int(v[5:7], 16))
                    for i, v in enumerate(PAL.values()))
    return f'''
do
  local spr = Sprite({size}, {size}, ColorMode.RGB)
  local pal = Palette({len(PAL)})
  {pal}
  spr:setPalette(pal)
  spr.layers[1].name = "철강맨"
  local img = Image({size}, {size}, ColorMode.RGB)
  for _, p in ipairs({{{','.join(px)}}}) do
    img:drawPixel(p[1], p[2], app.pixelColor.rgba(p[3], p[4], p[5], 255))
  end
  spr.cels[1].image = img
  spr:saveAs("{out}/steelman_{size}_eyes.aseprite")
  spr:close()
end
'''


if __name__ == '__main__':
    out, path = sys.argv[1], sys.argv[2]
    with open(path, 'w') as fh:
        fh.write('\n'.join(lua(s, out) for s in SPRITES))
