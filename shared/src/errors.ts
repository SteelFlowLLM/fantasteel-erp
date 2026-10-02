// 오류 코드 (업무 프로세스 정의서 9.3, 코드 컨벤션 5장 `영역-번호`).
// message는 정의서 문구를 그대로 쓰고, 화면에 더 구체적인 문구가 필요하면 throw할 때 message를 넘긴다.
// status는 정의서에 (409)로 적힌 것은 그대로, 나머지는 세팅 때 정한 값이다 (docs/backend/README.md "정해 둔 값").

export interface ErrorDefinition {
  message: string;
  status: number;
}

export const ERROR_CODE = {
  'SO-001': { message: '등록되지 않은 규격입니다', status: 400 },
  'SO-002': { message: '수량은 1 이상의 정수로 입력해 주세요', status: 400 },
  'SO-003': { message: '출고된 매수가 있는 수주는 취소할 수 없습니다', status: 409 },
  'SO-004': { message: '진행 중인 출하요청을 먼저 취소해 주세요', status: 409 },
  'MST-001': { message: '수율·배합·규격 매핑·검사 기준 누락', status: 400 },
  'MST-002': { message: '사용된 규격은 치수·이론중량을 수정할 수 없습니다', status: 409 },
  'INV-001': { message: '예약·배정 가능한 매수 부족', status: 409 },
  'INV-002': { message: '제품 또는 상위 히트가 미합격', status: 409 },
  'INV-003': { message: '이미 배정된 LOT', status: 409 },
  'INV-004': { message: '이미 투입·출고된 LOT', status: 409 },
  'PUR-001': { message: '승인권자(부서장) 미지정', status: 409 },
  'PUR-002': { message: '승인 전 발주 불가', status: 409 },
  'PUR-003': { message: '발주 미입고량 초과', status: 409 },
  'ACT-001': { message: '초안 필수값 미확정', status: 400 },
  'SHP-001': { message: '밀시트 PDF 생성 실패(스냅샷은 있음)', status: 500 },
  'SHP-002': { message: '출하 가능 매수를 넘었습니다', status: 409 },
  'SHP-003': { message: '출고 확정된 출하요청은 취소할 수 없습니다', status: 409 },
  'COM-001': { message: '검토 이후 데이터 변경(버전 충돌)', status: 409 },
  'COM-002': { message: '해당 업무 권한 없음', status: 403 },
  'COM-003': { message: '참조 대상이 없습니다', status: 404 },
  // 🟡 정의서 9.3에 없음. 공통 기반에 필요해 둔 값이며 팀 확인 후 정의서에 올린다.
  'AUTH-001': { message: '사원번호 또는 비밀번호가 올바르지 않습니다', status: 401 },
  'AUTH-002': { message: '로그인이 필요합니다', status: 401 },
  'COM-004': { message: '입력값 형식이 올바르지 않습니다', status: 400 },
  'COM-999': { message: '서버 오류가 발생했습니다', status: 500 },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CODE;
