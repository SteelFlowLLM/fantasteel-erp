import type { Role } from '@fantasteel/shared';

/**
 * 역할별 추천 질문 (REQ-AST-008, 질문 내용은 구현 단계 확정). 화면 디자인 단계의 AiPanel 예시 문구를 그대로 옮겼다(가정값).
 * 데이터 질문 가운데 재고·수주·LOT 추적은 조회 도구로 답하고, 히트·불합격·입고예정·출하요청 현황은 그 도구가 붙을 때까지 조회할 수 없다고 답한다.
 */
export const ROLE_SUGGESTED_QUESTIONS: Record<Role, readonly string[]> = {
  SALES: ['납기 위험 수주 알려줘', '이 수주 진행 상황 알려줘', 'SS275 코일 재고 몇 개야?'],
  PURCHASE: ['원료 부족 현황 알려줘', '입고예정 알려줘', '구매요청은 어떻게 등록해?'],
  PRODUCTION: ['지금 진행 중인 히트 알려줘', '히트 편성이 뭐야?', '여재 슬래브 몇 매 있어?'],
  QUALITY: ['최근 불합격 현황 알려줘', '이 LOT 역추적해줘', '비슷한 사례 찾아줘'],
  LOGISTICS: ['출하요청 현황 알려줘', '출고 확정은 어떻게 해?', '밀시트는 어디서 봐?'],
  ADMIN: ['역할별 권한 알려줘', '부서장은 어떻게 지정해?', '용어 사전에서 여재 찾아줘'],
};

/** 처음 쓰는 사용자용 신입 가이드 질문 (REQ-AST-008) */
export const FIRST_TIME_QUESTIONS: readonly string[] = ['예약과 배정은 뭐가 달라?', '여재가 뭐야?', '수주부터 출하까지 순서 알려줘'];
