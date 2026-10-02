// 위젯 배치 (SPEC 4장 3번, REQ-DSH-002): 12칸 격자의 위치·크기, 기본 배치, 추가·제외, 사원별 저장(브라우저 localStorage).
// 배치는 화면 설정이라 가짜 DB가 아니라 이 브라우저에 사원마다 저장한다 (ERD에 배치 테이블이 없다).
import { verticalCompactor, type LayoutItem } from 'react-grid-layout';
import type { DashboardWidgetKey } from '@/api/dashboard';
import { isWidgetKey, widgetDef, WIDGETS } from '@/features/dashboard/widgetCatalog';

export const GRID_COLS = 12;
export const GRID_ROW_HEIGHT = 60;
export const GRID_GAP = 16;

export interface WidgetPlacement {
  key: DashboardWidgetKey;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 기본 배치: 기본 위젯을 기본 크기로 왼쪽 → 오른쪽, 넘치면 다음 줄 */
export function buildDefaultPlacements(): WidgetPlacement[] {
  const out: WidgetPlacement[] = [];
  let x = 0;
  let rowTop = 0;
  let rowHeight = 0;
  for (const def of WIDGETS.filter((w) => w.isDefault)) {
    if (x + def.defaultW > GRID_COLS) {
      rowTop += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    out.push({ key: def.key, x, y: rowTop, w: def.defaultW, h: def.defaultH });
    x += def.defaultW;
    rowHeight = Math.max(rowHeight, def.defaultH);
  }
  return out;
}

/** 위젯 추가: 맨 아래 왼쪽에 기본 크기로 놓는다. 이미 있으면 그대로 */
export function appendPlacement(placements: readonly WidgetPlacement[], key: DashboardWidgetKey): WidgetPlacement[] {
  if (placements.some((p) => p.key === key)) return [...placements];
  const def = widgetDef(key);
  const bottom = placements.reduce((max, p) => Math.max(max, p.y + p.h), 0);
  return [...placements, { key, x: 0, y: bottom, w: Math.min(def.defaultW, GRID_COLS), h: def.defaultH }];
}

export const removePlacement = (placements: readonly WidgetPlacement[], key: DashboardWidgetKey): WidgetPlacement[] => placements.filter((p) => p.key !== key);

/** 격자 항목. 저장된 크기가 최소보다 작으면 저장값을 그대로 두고, 최소 크기는 줄일 때만 적용한다 */
export function toLayoutItems(placements: readonly WidgetPlacement[]): LayoutItem[] {
  return placements.map((p) => {
    const def = widgetDef(p.key);
    return { i: p.key, x: p.x, y: p.y, w: p.w, h: p.h, minW: Math.min(def.minW, p.w), minH: Math.min(def.minH, p.h) };
  });
}

export function fromLayoutItems(items: readonly LayoutItem[]): WidgetPlacement[] {
  return items.filter((item) => isWidgetKey(item.i)).map((item) => ({ key: item.i as DashboardWidgetKey, x: item.x, y: item.y, w: item.w, h: item.h }));
}

/** 격자가 화면에 놓는 모양(빈 줄을 위로 당긴 배치). 바뀌었는지 비교할 때 쓴다 */
export const compactPlacements = (placements: readonly WidgetPlacement[]): WidgetPlacement[] => fromLayoutItems(verticalCompactor.compact(toLayoutItems(placements), GRID_COLS));

/** 두 배치가 같은지 (순서 무관) */
export function samePlacements(a: readonly WidgetPlacement[], b: readonly WidgetPlacement[]): boolean {
  if (a.length !== b.length) return false;
  const byKey = new Map(a.map((p) => [p.key, p]));
  return b.every((p) => {
    const q = byKey.get(p.key);
    return !!q && q.x === p.x && q.y === p.y && q.w === p.w && q.h === p.h;
  });
}

export const isDefaultLayout = (placements: readonly WidgetPlacement[]): boolean => samePlacements(compactPlacements(placements), compactPlacements(buildDefaultPlacements()));

const isGridInt = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** 저장값 확인: 모르는 위젯·겹친 키·격자 밖 값은 버린다. 하나도 못 쓰면 null */
export function parsePlacements(raw: unknown): WidgetPlacement[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: WidgetPlacement[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { key, x, y, w, h } = entry as Record<string, unknown>;
    if (!isWidgetKey(key) || seen.has(key)) continue;
    if (!isGridInt(w, 1, GRID_COLS) || !isGridInt(x, 0, GRID_COLS - 1) || x + w > GRID_COLS || !isGridInt(y, 0, 10_000) || !isGridInt(h, 1, 100)) continue;
    seen.add(key);
    out.push({ key, x, y, w, h });
  }
  return out.length > 0 || raw.length === 0 ? out : null;
}

// ── 사원별 저장 (localStorage) ──────────────────────────────

export const layoutStorageKey = (employeeId: number): string => `fantasteel.dashboard-layout.v1.${employeeId}`;

/** 저장된 배치 (없거나 읽을 수 없으면 null = 기본 배치) */
export function readStoredLayout(employeeId: number, storage: Storage | null = browserStorage()): WidgetPlacement[] | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(layoutStorageKey(employeeId));
    return text === null ? null : parsePlacements(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 저장. 기본 배치와 같으면 저장값을 지운다(나중에 기본 배치가 바뀌면 따라가도록). 저장하지 못하면 false */
export function writeStoredLayout(employeeId: number, placements: readonly WidgetPlacement[], storage: Storage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    if (isDefaultLayout(placements)) storage.removeItem(layoutStorageKey(employeeId));
    else storage.setItem(layoutStorageKey(employeeId), JSON.stringify(compactPlacements(placements)));
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
