import { WIDGETS, type WidgetPlacement } from '@fantasteel/shared';

export const GRID_COLUMNS = 12;

/** 저장된 배치가 없을 때의 기본 배치: isDefault 위젯을 기본 크기로 왼쪽→오른쪽, 넘치면 다음 줄로 채운다. */
export function buildDefaultLayout(): WidgetPlacement[] {
  const out: WidgetPlacement[] = [];
  let x = 0;
  let rowTop = 0;
  let rowHeight = 0;
  for (const w of WIDGETS.filter((d) => d.isDefault)) {
    if (x + w.defaultW > GRID_COLUMNS) {
      rowTop += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    out.push({ widgetCode: w.code, x, y: rowTop, w: w.defaultW, h: w.defaultH });
    x += w.defaultW;
    rowHeight = Math.max(rowHeight, w.defaultH);
  }
  return out;
}

/** 배치 검증 (REQ-DSH-002). 문제가 있으면 첫 번째 메시지를, 없으면 null을 돌려준다. */
export function validatePlacements(placements: readonly Partial<Record<keyof WidgetPlacement, unknown>>[]): string | null {
  const known = new Set<string>(WIDGETS.map((w) => w.code));
  const seen = new Set<string>();
  for (const p of placements) {
    const code = String(p.widgetCode);
    if (typeof p.widgetCode !== 'string' || !known.has(code)) return `알 수 없는 위젯입니다: ${code}`;
    if (seen.has(code)) return `같은 위젯을 두 번 배치할 수 없습니다: ${code}`;
    seen.add(code);
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      if (!Number.isInteger(p[key])) return `${code}의 ${key} 값은 정수여야 합니다`;
    }
    const { x, y, w, h } = p as WidgetPlacement;
    if (x < 0 || y < 0) return `${code}의 위치(x, y)는 0 이상이어야 합니다`;
    if (w < 1 || h < 1) return `${code}의 크기(w, h)는 1 이상이어야 합니다`;
    if (x + w > GRID_COLUMNS) return `${code}가 ${GRID_COLUMNS}칸 격자를 벗어납니다 (x + w ≤ ${GRID_COLUMNS})`;
  }
  return null;
}

/** DB에 저장된 JSON을 믿지 않고 다시 검사한다. 이상하면 null (→ 기본 배치). */
export function parseStoredLayout(raw: unknown): WidgetPlacement[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw as Partial<Record<keyof WidgetPlacement, unknown>>[];
  if (list.some((p) => typeof p !== 'object' || p === null) || validatePlacements(list) !== null) return null;
  return list.map((p) => ({ widgetCode: p.widgetCode as WidgetPlacement['widgetCode'], x: p.x as number, y: p.y as number, w: p.w as number, h: p.h as number }));
}
