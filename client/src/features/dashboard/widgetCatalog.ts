// 위젯 목록 (화면 상수, REQ-DSH-001·002). 이름은 요구사항 정의서 그대로다.
// 크기는 12칸 격자의 칸 수: 기본 크기(추가할 때)와 최소 크기(줄일 수 있는 한계, SPEC 4장 3번). 넘치는 내용은 카드 안에서 스크롤한다.
// 바로가기는 그 화면을 열 수 있는 사원에게만 보인다(screens.ts).
import { DASHBOARD_WIDGET_KEYS, type DashboardWidgetKey, type SoonWidgetKey } from '@/api/dashboard';
import type { IconName } from '@/components/Icon';
import { SCREEN, type ScreenDef } from '@/features/shell/screens';

export interface WidgetDef {
  key: DashboardWidgetKey;
  label: string;
  /** 기본 위젯 (REQ-DSH-001). 아니면 추가 후보 (REQ-DSH-002) */
  isDefault: boolean;
  /** P2 준비 중 (데이터 없이 디자인만) */
  soon: boolean;
  /** '위젯 추가' 목록의 한 줄 설명 */
  description: string;
  icon: IconName;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  /** 카드 머리의 바로가기 */
  link?: { screen: ScreenDef; label: string };
}

const SOON_KEYS: readonly SoonWidgetKey[] = ['AGENT_RISK', 'AI_USAGE'];
export const isSoonWidget = (key: DashboardWidgetKey): key is SoonWidgetKey => (SOON_KEYS as readonly string[]).includes(key);

type WidgetSpec = Omit<WidgetDef, 'key' | 'soon'>;

const SPEC: Record<DashboardWidgetKey, WidgetSpec> = {
  PROCESS_FLOW: {
    label: '공정 흐름 현황',
    isDefault: true,
    description: '수주부터 생산계획·검사·재고·출하요청·출고까지 단계별 건수를 한 줄로 보여 줘요',
    icon: 'flow',
    defaultW: 12,
    defaultH: 3,
    minW: 4,
    minH: 2,
  },
  ORDER_FULFILLMENT: {
    label: '수주 충족 현황',
    isDefault: true,
    description: '진행 중 수주 품목의 생산중·검사합격·예약·출하 매수와 진행률을 납기 빠른 순으로 보여 줘요',
    icon: 'clipboard',
    defaultW: 6,
    defaultH: 5,
    minW: 4,
    minH: 3,
    link: { screen: SCREEN.salesOrders, label: '수주 목록' },
  },
  AGENT_RISK: {
    label: 'Agent 위험 감지',
    isDefault: true,
    description: 'AI Factory Agent가 감지한 위험과 대응 후보를 보여 줘요',
    icon: 'radar',
    defaultW: 6,
    defaultH: 5,
    minW: 3,
    minH: 3,
  },
  RECENT_EVENTS: {
    label: '최근 작업 로그',
    isDefault: true,
    description: '최근 등록·확정·출고 같은 작업 로그를 최신순으로 보여 줘요',
    icon: 'history',
    defaultW: 6,
    defaultH: 5,
    minW: 3,
    minH: 2,
    link: { screen: SCREEN.businessEvents, label: '작업 로그' },
  },
  PRODUCT_STOCK: {
    label: '제품 재고',
    isDefault: true,
    description: '규격별 재고·합격·예약·가용 매수를 보여 줘요',
    icon: 'stock',
    defaultW: 6,
    defaultH: 5,
    minW: 3,
    minH: 3,
    link: { screen: SCREEN.inventories, label: '재고' },
  },
  PROCESS_YIELD: {
    label: '공정별 수율',
    isDefault: true,
    description: '제강·연주·열연의 계획 수율과 작업 실적 수율을 비교해요',
    icon: 'gauge',
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 3,
    link: { screen: SCREEN.productionResults, label: '작업 실적' },
  },
  RAW_MATERIAL_BALANCE: {
    label: '원료 잔량 대비 소요',
    isDefault: false,
    description: '원료 잔량·입고예정과 MRP 총소요·순소요를 나란히 보여 줘요',
    icon: 'calc',
    defaultW: 6,
    defaultH: 4,
    minW: 4,
    minH: 3,
    link: { screen: SCREEN.mrp, label: 'MRP' },
  },
  REJECT_RATE: {
    label: '강종별 불합격률',
    isDefault: false,
    description: '최근 판정된 검사의 강종별·공정별 불합격률을 보여 줘요 (합격률로 바꿔 볼 수 있어요)',
    icon: 'quality',
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 3,
    // 바로가기 없음: 불합격 관리는 왼쪽 메뉴에 있고, 머리 오른쪽은 불합격률·합격률 전환이 쓴다
  },
  DELIVERY_RISK: {
    label: '납기 위험 수주',
    isDefault: false,
    description: '납기가 가깝거나 지났는데 출하가 남은 수주 품목을 보여 줘요',
    icon: 'alert',
    defaultW: 6,
    defaultH: 4,
    minW: 4,
    minH: 2,
    link: { screen: SCREEN.salesOrders, label: '수주 목록' },
  },
  PURCHASE_PROGRESS: {
    label: '구매 진행',
    isDefault: false,
    description: '구매요청 상태별 건수와 입고가 남은 발주를 보여 줘요',
    icon: 'cart',
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 3,
    link: { screen: SCREEN.purchaseOrders, label: '발주' },
  },
  SHIPMENT_RESULT: {
    label: '출하 실적',
    isDefault: false,
    description: '최근 출고 확정한 슬래브·코일을 하루 단위 막대로 보여 줘요',
    icon: 'truck',
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 3,
    link: { screen: SCREEN.goodsIssues, label: '출고 확정' },
  },
  SURPLUS_AGE: {
    label: '여재 보유 기간',
    isDefault: false,
    description: '수주에 묶이지 않은 합격 슬래브(여재)를 오래 보유한 순으로 보여 줘요',
    icon: 'slab',
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 3,
    link: { screen: SCREEN.inventories, label: '재고' },
  },
  PRODUCTION_VOLUME: {
    label: '생산량',
    isDefault: false,
    description: '최근 만든 슬래브·코일을 하루 단위 막대로 보여 줘요',
    icon: 'factory',
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 3,
    link: { screen: SCREEN.productionResults, label: '작업 실적' },
  },
  AI_USAGE: {
    label: 'AI 활용 현황',
    isDefault: false,
    description: 'AI 어시스턴트·업무 초안·Agent를 얼마나 썼는지 보여 줘요',
    icon: 'wave',
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 2,
  },
};

export const WIDGETS: readonly WidgetDef[] = DASHBOARD_WIDGET_KEYS.map((key) => ({ key, soon: isSoonWidget(key), ...SPEC[key] }));

const BY_KEY = new Map<string, WidgetDef>(WIDGETS.map((w) => [w.key, w]));

export const widgetDef = (key: DashboardWidgetKey): WidgetDef => BY_KEY.get(key) ?? { key, soon: isSoonWidget(key), ...SPEC[key] };

export const isWidgetKey = (value: unknown): value is DashboardWidgetKey => typeof value === 'string' && BY_KEY.has(value);
