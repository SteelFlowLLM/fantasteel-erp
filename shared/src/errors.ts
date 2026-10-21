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
  'SO-003': { message: '전량 출고된 수주는 취소할 수 없습니다', status: 409 },
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
  // 🟡 VOC-는 정의서 9.3에 없다 (Voice2ERP, 2026-10-15). 팀 확인 후 정의서에 올린다.
  'VOC-001': { message: '회의록을 찾을 수 없습니다', status: 404 },
  'VOC-002': { message: '참석자로 고른 사원을 찾을 수 없습니다', status: 404 },
  'VOC-003': { message: '회의록 작성자만 AI 정리를 할 수 있어요', status: 403 },
  'VOC-004': { message: '지금 상태에서는 AI 정리를 할 수 없어요', status: 409 },
  'VOC-006': { message: '이 후보는 아직 허가할 수 없어요', status: 400 },
  'VOC-007': { message: '허가 또는 제외하지 않은 후보가 남아 있어요', status: 409 },
  'VOC-005': { message: '회의 기록이 너무 길어 지금은 분석할 수 없어요 (4만 자 이하)', status: 400 },
  'VOC-008': { message: '이미 Notion으로 내보낸 회의록이에요', status: 409 },
  'VOC-009': { message: '말을 너무 자주 보냈어요. 잠시 뒤에 다시 불러 주세요', status: 429 },
  // 🟡 INT-는 정의서 9.3에 없다 (외부 서비스 연결, 2026-10-16 이슈 #358). 팀 확인 후 정의서에 올린다.
  'INT-001': { message: '지원하지 않는 연결 대상입니다', status: 404 },
  'INT-002': { message: '연결되어 있지 않아요. 관리자가 먼저 연결해 주세요', status: 409 },
  'INT-003': { message: '연결이 끊겼어요. 관리자가 다시 연결해 주세요', status: 409 },
  'INT-004': { message: '외부 서비스 요청이 실패했어요', status: 502 },
  'INT-005': { message: '외부 서비스에 필요한 도구가 없어요', status: 502 },
  'INT-006': { message: 'Notion 상위 페이지가 설정되지 않았어요. 관리자가 연결 설정에서 정해 주세요', status: 409 },
  'INT-007': { message: '연결 요청이 만료됐거나 올바르지 않아요. 처음부터 다시 연결해 주세요', status: 400 },
  'INT-008': { message: '서버 암호화 키(INTEGRATION_SECRET_KEY)가 없거나 올바르지 않아요', status: 500 },
  'INT-009': { message: '외부 서비스가 요청을 처리했는지 확인하지 못했어요. 결과를 직접 확인한 뒤 다시 시도해 주세요', status: 502 },
  'INT-010': { message: 'Google OAuth 클라이언트 id·secret이 설정되지 않았어요. 관리자가 연결 설정에서 넣어 주세요', status: 409 },
  'INT-011': { message: 'Google Drive 폴더가 설정되지 않았어요. 관리자가 연결 설정에서 정해 주세요', status: 409 },
  'INT-012': { message: 'Drive 폴더나 파일을 찾을 수 없어요', status: 404 },
  'INT-013': { message: '가져올 수 없는 종류의 파일이에요', status: 400 },
  'INT-014': { message: '파일이 너무 커서 가져올 수 없어요', status: 413 },
  'INT-015': { message: '서버 설정(.env)의 Google 값이 올바르지 않아요. 서버 관리자가 확인해 주세요', status: 500 },
  'INT-016': { message: '서버 설정(.env)의 서비스 계정으로 연결돼 있어 이 화면에서 연결하거나 끊지 않아요', status: 409 },
  // 🟡 RES-는 정의서 9.3에 없다 (철강맨AI 심층 조사, 2026-10-17 이슈 #378). 팀 확인 후 정의서에 올린다.
  'RES-001': { message: '조사를 찾을 수 없어요', status: 404 },
  'RES-002': { message: '지금 상태에서는 할 수 없어요', status: 409 },
  'RES-003': { message: '계획이 그 사이 바뀌었어요. 새 계획을 보고 다시 시작해 주세요', status: 409 },
  'RES-004': { message: '검색어에 회사 안 정보가 있어요. 일반적인 낱말로 바꿔 주세요', status: 400 },
  'RES-005': { message: '사용할 AI 모델이 정해지지 않았어요. AI 연결 설정에서 모델을 골라 주세요', status: 409 },
  'RES-006': { message: '진행 중인 조사가 너무 많아요. 끝나거나 취소한 뒤 다시 시작해 주세요', status: 409 },
  'RES-007': { message: '이미 Notion으로 내보낸 조사예요', status: 409 },
  'RES-008': { message: 'AI가 고친 계획을 내지 못했어요. 부탁을 바꿔 다시 해 주세요', status: 502 },
  // 🟡 AST-는 정의서 9.3에 없다 (철강맨AI 대화 기록, 2026-10-19 이슈 #399). 팀 확인 후 정의서에 올린다.
  'AST-001': { message: '대화를 찾을 수 없어요', status: 404 },
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
