// 펫 사다리 소품 — src/ladder/gen.py 로 만든 파일 (손으로 고치지 않는다)
// 엔진이 펫과 같은 배율로 키워 top + mid×n + bottom 순서로 세로로 이어 그린다.
(window.FANTA_PET_PROPS = window.FANTA_PET_PROPS || {}).ladder = {
  width: 12,
  sheet: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAUCAYAAAC58NwRAAAAtklEQVR42mNgAAJpVcP/IMyAA6DIgxj//377//HrT6yaMORBBIhz+OzN/+g2wfjI8igmwAWxmI6iYd7qvf+bJy77v3LPJQwNGHIwa3F5HEMeRESnN4BNwaUBRR7mKXwaUOQp1oAN49Tw/9MKBL5gC8dYNYCCDabg20otFAyTx7DhZqY2VozVBlDQ4fIDKPJg8gMQrERpyCluBWN3v3iMxIchByJAHAMzr/8RSVUYGrDKEZtaQQIAREWhpDRfoZ8AAAAASUVORK5CYII=',
  top:    { x: 0, y: 0, w: 12, h: 8 },  // 맨 위: 위 면 가장자리에 거는 고리 (앞으로 꺾임)
  hookY: 2,                  // top 타일 안에서 '위 면 높이'에 맞출 y
  mid:    { x: 0, y: 8, w: 12, h: 8 },  // 세로로 반복: 발판 1개 + 레일
  bottom: { x: 0, y: 16, w: 12, h: 4 },  // 맨 아래 고무 받침 (마지막 행이 바닥·아래 면에 닿음)
  rungGap: 8                 // 발판 간격 = mid.h
};
