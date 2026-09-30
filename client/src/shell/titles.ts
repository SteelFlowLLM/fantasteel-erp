// 상단 바 제목. 화면이 useShellTitle로 덮어쓸 수 있다 (예: 수주번호).
const TITLES: [RegExp, string, string][] = [
  [/^\/dashboard/, '대시보드', '현황'],
  [/^\/sales-orders\/new/, '수주 등록', '영업'],
  [/^\/sales-orders\/\d+/, '충족 현황', '영업 · 수주'],
  [/^\/sales-orders/, '수주 목록', '영업'],
  [/^\/shipment-requests\/new/, '출하요청 등록', '영업'],
  [/^\/shipment-requests\/\d+/, '출하요청 배정', '영업'],
  [/^\/shipment-requests/, '출하요청', '영업'],
  [/^\/inventories/, '재고', '재고·예약·배정'],
  [/^\/mrp/, 'MRP 결과', '구매'],
  [/^\/purchase-requisitions\/\d+/, '구매요청 상세', '구매'],
  [/^\/purchase-requisitions/, '구매요청', '구매'],
  [/^\/action-drafts/, '구매요청 초안', '메신저 → ERP'],
  [/^\/purchase-orders/, '발주', '구매'],
  [/^\/goods-receipts/, '입고', '구매'],
  [/^\/production\/plans/, '생산계획', '생산'],
  [/^\/production\/results/, '공정 실적', '생산'],
  [/^\/production\/rolling/, '열연 투입 배정', '생산'],
  [/^\/quality\/inspections/, '검사 입력', '품질'],
  [/^\/quality\/rejected/, '불합격 관리', '품질'],
  [/^\/goods-issues/, '출고 확정', '물류'],
  [/^\/mill-sheets/, '밀시트', '물류'],
  [/^\/lots\/trace/, 'LOT 추적', '추적'],
  [/^\/business-events/, '작업 로그 · Decision Replay', '추적'],
  [/^\/tasks/, '업무·알림', '협업'],
  [/^\/messenger/, '메신저', '협업'],
  [/^\/approvals/, '승인함', '부서장'],
  [/^\/admin\/employees/, '사용자', '관리자'],
  [/^\/admin\/organization/, '부서·권한', '관리자'],
  [/^\/admin\/master-data/, '기준정보', '관리자'],
  [/^\/agent/, 'AI Factory Agent', '준비 중 (P2)'],
  [/^\/meetings/, '회의록', '준비 중 (P2)'],
  [/^\/past-cases/, '과거 사례 검색', '준비 중 (EX)'],
];

export function titleFor(pathname: string): { title: string; area: string } {
  const hit = TITLES.find(([re]) => re.test(pathname));
  return hit ? { title: hit[1], area: hit[2] } : { title: '', area: '' };
}
