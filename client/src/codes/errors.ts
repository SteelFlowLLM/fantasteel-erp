// 에러 코드와 메시지 (업무 프로세스 9.3, PLAN 4장 표). 형식은 코드 컨벤션 5장 `영역-번호`.
// 공통 코드 그룹이 아니다 (공통 코드 정의서 4장: 에러 코드는 컨벤션 5장·업무 프로세스 9장에서 관리).

export const ERROR_MESSAGE = {
  'SO-001': '등록되지 않은 규격입니다',
  'SO-002': '수량은 1 이상의 정수로 입력해 주세요',
  'SO-003': '출고된 매수가 있는 수주는 취소할 수 없습니다',
  'SO-004': '진행 중인 출하요청을 먼저 취소해 주세요',
  'MST-001': '수율·배합·규격 매핑·검사 기준 누락',
  'MST-002': '사용된 규격은 치수·이론중량을 수정할 수 없습니다',
  'INV-001': '예약·배정 가능한 매수 부족',
  'INV-002': '제품 또는 상위 히트가 미합격',
  'INV-003': '이미 배정된 LOT',
  'INV-004': '이미 투입·출고된 LOT',
  'PUR-001': '승인권자(부서장) 미지정',
  'PUR-002': '승인 전 발주 불가',
  'PUR-003': '발주 미입고량 초과',
  'ACT-001': '초안 필수값 미확정',
  'SHP-001': '밀시트 PDF 생성 실패(스냅샷은 있음)',
  'SHP-002': '출하 가능 매수를 넘었습니다',
  'SHP-003': '출고 확정된 출하요청은 취소할 수 없습니다',
  'COM-001': '검토 이후 데이터 변경',
  'COM-002': '해당 업무 권한 없음',
  'COM-003': '참조 대상이 없습니다',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGE;
export const ERROR_CODES = Object.keys(ERROR_MESSAGE) as ErrorCode[];
export const isErrorCode = (value: string): value is ErrorCode => value in ERROR_MESSAGE;
