// 화면 제목과 상단 바 작은 줄의 영역 이름. 브라우저 탭 제목(metadata)과 상단 바가 함께 쓴다.
export interface RouteTitle {
  title: string;
  area: string;
}

const ROUTE_TITLES: ReadonlyArray<readonly [RegExp, RouteTitle]> = [
  [/^\/dashboard/, { title: '대시보드', area: '현황' }],
  [/^\/sales-orders\/new/, { title: '수주 등록', area: '영업' }],
  [/^\/sales-orders\/[^/]+/, { title: '수주 상세', area: '영업' }],
  [/^\/sales-orders/, { title: '수주', area: '영업' }],
  [/^\/shipment-requests\/new/, { title: '출하요청 등록', area: '영업' }],
  [/^\/shipment-requests\/[^/]+/, { title: '출하요청 배정', area: '영업' }],
  [/^\/shipment-requests/, { title: '출하요청', area: '영업' }],
  [/^\/inventories/, { title: '재고', area: '재고·예약·배정' }],
  [/^\/mrp/, { title: 'MRP', area: '구매' }],
  [/^\/purchase-requisitions\/[^/]+/, { title: '구매요청 상세', area: '구매' }],
  [/^\/purchase-requisitions/, { title: '구매요청', area: '구매' }],
  [/^\/action-drafts/, { title: '구매요청 초안', area: 'Message → ERP' }],
  [/^\/purchase-orders/, { title: '발주', area: '구매' }],
  [/^\/goods-receipts/, { title: '입고', area: '구매' }],
  [/^\/approvals/, { title: '승인함', area: '부서장' }],
  [/^\/production\/plans/, { title: '생산계획', area: '생산' }],
  [/^\/production\/results/, { title: '작업 실적', area: '생산' }],
  [/^\/production\/rolling/, { title: '열연 투입 배정', area: '생산' }],
  [/^\/quality\/inspections/, { title: '검사 입력', area: '품질' }],
  [/^\/quality\/rejected/, { title: '불합격 관리', area: '품질' }],
  [/^\/quality\/standards/, { title: '검사 기준', area: '품질' }],
  [/^\/goods-issues/, { title: '출고 확정', area: '물류' }],
  [/^\/mill-sheets/, { title: '밀시트', area: '물류' }],
  [/^\/lots\/trace/, { title: 'LOT 추적', area: '추적' }],
  [/^\/business-events/, { title: '작업 로그', area: '추적' }],
  [/^\/tasks/, { title: '업무·알림', area: '협업' }],
  [/^\/messenger/, { title: '메신저', area: '협업' }],
  [/^\/admin\/employees/, { title: '사원', area: '관리자' }],
  [/^\/admin\/organization/, { title: '부서·직급·권한', area: '관리자' }],
  [/^\/admin\/master-data/, { title: '기준정보', area: '관리자' }],
  [/^\/admin\/llm/, { title: 'AI 연결', area: '관리자' }],
  [/^\/agent/, { title: 'AI Factory Agent', area: '준비 중 (P2)' }],
  [/^\/meetings/, { title: '회의록', area: '준비 중 (P2)' }],
  [/^\/past-cases/, { title: '과거 사례 검색', area: '준비 중 (EX)' }],
];

export function routeTitleOf(pathname: string): RouteTitle {
  const hit = ROUTE_TITLES.find(([pattern]) => pattern.test(pathname));
  return hit ? hit[1] : { title: '', area: '' };
}

/** 브라우저 탭 제목용 (layout의 '%s · FantaSteel ERP' 틀에 들어간다) */
export const pageTitle = (pathname: string): string => routeTitleOf(pathname).title || 'FantaSteel ERP';
