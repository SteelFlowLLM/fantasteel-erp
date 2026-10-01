import { describe, expect, it } from 'vitest';
import {
  appendPlacement,
  buildDefaultPlacements,
  compactPlacements,
  isDefaultLayout,
  layoutStorageKey,
  parsePlacements,
  readStoredLayout,
  removePlacement,
  samePlacements,
  toLayoutItems,
  writeStoredLayout,
} from '@/features/dashboard/lib/layout';
import { WIDGETS } from '@/features/dashboard/widgetCatalog';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe('위젯 목록', () => {
  it('기본 6개 + 후보 8개, 요구사항 이름 그대로, P2 2개는 준비 중', () => {
    expect(WIDGETS.filter((w) => w.isDefault).map((w) => w.label)).toEqual(['공정 흐름 현황', '수주 충족 현황', 'Agent 위험 감지', '최근 작업 로그', '제품 재고', '공정별 수율']);
    expect(WIDGETS.filter((w) => !w.isDefault).map((w) => w.label)).toEqual([
      '원료 잔량 대비 소요',
      '강종별 불합격률',
      '납기 위험 수주',
      '구매 진행',
      '출하 실적',
      '여재 보유 기간',
      '생산량',
      'AI 활용 현황',
    ]);
    expect(WIDGETS.filter((w) => w.soon).map((w) => w.key)).toEqual(['AGENT_RISK', 'AI_USAGE']);
    for (const w of WIDGETS) {
      expect(w.minW).toBeLessThanOrEqual(w.defaultW);
      expect(w.minH).toBeLessThanOrEqual(w.defaultH);
    }
  });
});

describe('위젯 배치', () => {
  it('기본 배치: 공정 흐름 한 줄 → 6칸씩 두 개씩', () => {
    expect(buildDefaultPlacements()).toEqual([
      { key: 'PROCESS_FLOW', x: 0, y: 0, w: 12, h: 3 },
      { key: 'ORDER_FULFILLMENT', x: 0, y: 3, w: 6, h: 5 },
      { key: 'AGENT_RISK', x: 6, y: 3, w: 6, h: 5 },
      { key: 'RECENT_EVENTS', x: 0, y: 8, w: 6, h: 5 },
      { key: 'PRODUCT_STOCK', x: 6, y: 8, w: 6, h: 5 },
      { key: 'PROCESS_YIELD', x: 0, y: 13, w: 6, h: 4 },
    ]);
  });

  it('추가는 맨 아래 왼쪽 기본 크기, 같은 위젯은 두 번 넣지 않고, 제외하면 빠진다', () => {
    const base = buildDefaultPlacements();
    const added = appendPlacement(base, 'SHIPMENT_RESULT');
    expect(added.at(-1)).toEqual({ key: 'SHIPMENT_RESULT', x: 0, y: 17, w: 6, h: 4 });
    expect(appendPlacement(added, 'SHIPMENT_RESULT')).toHaveLength(added.length);
    expect(removePlacement(added, 'AGENT_RISK').some((p) => p.key === 'AGENT_RISK')).toBe(false);
  });

  it('최소 크기: 저장값이 더 작으면 저장값을 한계로 둔다', () => {
    const [item] = toLayoutItems([{ key: 'ORDER_FULFILLMENT', x: 0, y: 0, w: 3, h: 5 }]);
    expect([item.minW, item.minH]).toEqual([3, 3]);
    const [normal] = toLayoutItems([{ key: 'ORDER_FULFILLMENT', x: 0, y: 0, w: 8, h: 6 }]);
    expect([normal.minW, normal.minH]).toEqual([4, 3]);
  });

  it('빈 줄을 위로 당겨 비교한다', () => {
    const gap = [{ key: 'PROCESS_FLOW' as const, x: 0, y: 5, w: 12, h: 3 }];
    expect(compactPlacements(gap)).toEqual([{ key: 'PROCESS_FLOW', x: 0, y: 0, w: 12, h: 3 }]);
    expect(samePlacements(compactPlacements(gap), [{ key: 'PROCESS_FLOW', x: 0, y: 0, w: 12, h: 3 }])).toBe(true);
    expect(isDefaultLayout(buildDefaultPlacements())).toBe(true);
    expect(isDefaultLayout(removePlacement(buildDefaultPlacements(), 'AGENT_RISK'))).toBe(false);
  });

  it('저장값 확인: 모르는 위젯·중복·격자 밖은 버린다', () => {
    expect(
      parsePlacements([
        { key: 'PROCESS_FLOW', x: 0, y: 0, w: 12, h: 3 },
        { key: 'PROCESS_FLOW', x: 0, y: 3, w: 6, h: 3 },
        { key: 'WIDGET_X', x: 0, y: 0, w: 6, h: 3 },
        { key: 'PRODUCT_STOCK', x: 8, y: 3, w: 6, h: 3 },
        { key: 'RECENT_EVENTS', x: 0, y: 3, w: 6.5, h: 3 },
      ]),
    ).toEqual([{ key: 'PROCESS_FLOW', x: 0, y: 0, w: 12, h: 3 }]);
    expect(parsePlacements('x')).toBeNull();
    expect(parsePlacements([{ key: 'X' }])).toBeNull();
    expect(parsePlacements([])).toEqual([]);
  });

  it('사원마다 따로 저장하고, 기본 배치로 저장하면 저장값을 지운다', () => {
    const storage = new MemoryStorage();
    expect(readStoredLayout(7, storage)).toBeNull();
    const custom = appendPlacement(removePlacement(buildDefaultPlacements(), 'AGENT_RISK'), 'DELIVERY_RISK');
    expect(writeStoredLayout(7, custom, storage)).toBe(true);
    const saved = readStoredLayout(7, storage);
    expect(saved && samePlacements(saved, compactPlacements(custom))).toBe(true);
    expect(readStoredLayout(8, storage)).toBeNull();
    writeStoredLayout(7, buildDefaultPlacements(), storage);
    expect(storage.getItem(layoutStorageKey(7))).toBeNull();
    storage.setItem(layoutStorageKey(9), '{망가진 값');
    expect(readStoredLayout(9, storage)).toBeNull();
    expect(readStoredLayout(9, null)).toBeNull();
  });
});
