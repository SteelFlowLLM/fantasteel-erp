// 위젯 목록의 화면용 정보. 이름·기본 크기·P2 여부는 shared의 WIDGETS가 기준이고, 여기에는 화면에서만 쓰는 것(설명·아이콘·최소 크기·바로가기)을 둔다.
//
// [임시] 위젯이 작을 때의 처리 — SPEC 7번 미정, 8번 "먼저 만들어 보고 정한다".
// 지금은 가장 단순하게: (1) 위젯별 최소 크기(minW·minH) 아래로는 줄일 수 없고, (2) 넘치는 내용은 카드 안에서 스크롤하며,
// (3) 긴 글자는 말줄임(…) + title로 보여준다. "요약 모드"는 만들지 않았다.
// 정해지면 아래 WIDGET_UI의 minW·minH 숫자(또는 이 파일)만 고치면 된다.
import { WIDGETS, type WidgetCode, type WidgetDef, type WidgetPlacement } from '@fantasteel/shared';

/** 격자 설정 (12칸). 서버 검증(x + w ≤ 12)과 같다. */
export const GRID_COLS = 12;
export const GRID_ROW_HEIGHT = 60;
export const GRID_GAP = 16;

export interface WidgetUi {
  /** "위젯 추가" 목록의 한 줄 설명 */
  description: string;
  icon: string;
  /** 최소 크기 (격자 칸). 임시 값 — 파일 머리말 참고 */
  minW: number;
  minH: number;
  /** 카드 머리의 바로가기 */
  link?: { to: string; label: string };
}

export const WIDGET_UI: Record<WidgetCode, WidgetUi> = {
  PROCESS_FLOW: { description: '생산계획부터 검사·재고·출고까지 단계별 건수를 한 줄로 보여줘요', icon: 'flow', minW: 4, minH: 2 },
  ORDER_FULFILLMENT: { description: '진행 중 수주의 예약·생산 중·출하 매수와 진행률을 납기 빠른 순으로 보여줘요', icon: 'order', minW: 4, minH: 3, link: { to: '/sales-orders', label: '수주 목록' } },
  AGENT_RISK: { description: 'AI Factory Agent가 감지한 위험과 대응 후보를 보여줘요', icon: 'radar', minW: 3, minH: 3 },
  RECENT_EVENTS: { description: '최근 등록·확정·출고 같은 작업 기록을 최신순으로 보여줘요', icon: 'history', minW: 3, minH: 2, link: { to: '/business-events', label: '작업 로그' } },
  PRODUCT_STOCK: { description: '규격별 합격 재고·예약·가용 매수를 보여줘요', icon: 'stock', minW: 3, minH: 3, link: { to: '/inventories', label: '재고' } },
  PROCESS_YIELD: { description: '제선·제강·연주·열연의 계획 수율과 실적 수율을 비교해요', icon: 'gauge', minW: 3, minH: 3 },
  RAW_MATERIAL_BALANCE: { description: '원료 잔량·입고 예정과 최신 MRP 소요를 나란히 보여줘요', icon: 'calc', minW: 4, minH: 3, link: { to: '/mrp', label: 'MRP' } },
  REJECT_RATE: { description: '최근 검사 기록의 강종별·공정별 불합격률을 보여줘요', icon: 'quality', minW: 3, minH: 3 },
  DELIVERY_RISK: { description: '납기가 가깝거나 지났는데 출하가 남은 수주 품목을 보여줘요', icon: 'alert', minW: 4, minH: 2, link: { to: '/sales-orders', label: '수주 목록' } },
  PURCHASE_PROGRESS: { description: '구매요청 상태별 건수와 미입고 발주를 보여줘요', icon: 'cart', minW: 3, minH: 3, link: { to: '/purchase-orders', label: '발주' } },
  SHIPMENT_RESULT: { description: '최근 출고 확정 실적을 하루 단위 막대로 보여줘요', icon: 'truck', minW: 3, minH: 3 },
  SURPLUS_AGE: { description: '수주에 묶이지 않은 합격 슬래브(여재)를 오래된 순으로 보여줘요', icon: 'slab', minW: 3, minH: 3 },
  PRODUCTION_VOLUME: { description: '최근 하루 단위 슬래브·코일 생산량을 막대로 보여줘요', icon: 'factory', minW: 3, minH: 3 },
  AI_USAGE: { description: 'AI 기능을 얼마나 썼는지 보여줘요', icon: 'wave', minW: 3, minH: 2 },
};

const DEF_BY_CODE = new Map<string, WidgetDef>(WIDGETS.map((w) => [w.code, w]));
export const widgetDef = (code: WidgetCode): WidgetDef | undefined => DEF_BY_CODE.get(code);

/** 기본 배치 — 서버(dashboard-layout.ts buildDefaultLayout)와 같은 규칙: isDefault 위젯을 기본 크기로 왼쪽→오른쪽, 넘치면 다음 줄. */
export function buildDefaultPlacements(): WidgetPlacement[] {
  const out: WidgetPlacement[] = [];
  let x = 0;
  let rowTop = 0;
  let rowHeight = 0;
  for (const w of WIDGETS.filter((d) => d.isDefault)) {
    if (x + w.defaultW > GRID_COLS) {
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

/** 위젯 추가: 맨 아래 왼쪽에 기본 크기로 놓는다. */
export function appendPlacement(placements: readonly WidgetPlacement[], code: WidgetCode): WidgetPlacement[] {
  const def = widgetDef(code);
  if (!def || placements.some((p) => p.widgetCode === code)) return [...placements];
  const bottom = placements.reduce((max, p) => Math.max(max, p.y + p.h), 0);
  return [...placements, { widgetCode: code, x: 0, y: bottom, w: Math.min(def.defaultW, GRID_COLS), h: def.defaultH }];
}

/** 두 배치가 같은지 (순서 무관) */
export function samePlacements(a: readonly WidgetPlacement[], b: readonly WidgetPlacement[]): boolean {
  if (a.length !== b.length) return false;
  const byCode = new Map(a.map((p) => [p.widgetCode, p]));
  return b.every((p) => {
    const q = byCode.get(p.widgetCode);
    return !!q && q.x === p.x && q.y === p.y && q.w === p.w && q.h === p.h;
  });
}
