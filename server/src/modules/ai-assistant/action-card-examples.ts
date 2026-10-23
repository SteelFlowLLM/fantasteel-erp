import { PERMISSION, type AiActionCardExample, type AuthUser, type Permission } from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';

/**
 * 철강맨AI를 열었을 때 보이는 실행 카드 요청 예시 (REQ-AST-005·008, 문구는 가정값). 실행할 때 확인하는 USE 권한이 있는 사용자에게만 보인다.
 * 업무·일정은 로그인한 전 역할이 쓴다. ○○는 사용자가 채울 자리라 지어낸 데이터를 넣지 않는다.
 */
const EXAMPLES: readonly { example: AiActionCardExample; permission: Permission | null }[] = [
  { example: { kind: 'TASK', label: '업무 등록', text: '견적서 보내기 업무를 나에게 다음 주 금요일까지로 등록해줘' }, permission: null },
  { example: { kind: 'EVENT', label: '일정 등록', text: '내일 오후 2시에 라인 점검 일정 잡아줘' }, permission: null },
  { example: { kind: 'PURCHASE', label: '구매요청 등록', text: '철광석 20톤 구매요청 만들어줘' }, permission: PERMISSION.PURCHASE_REQUISITION_CREATE },
  { example: { kind: 'SALES_ORDER', label: '수주 등록', text: '고객사 ○○ SS275 코일 10매 수주 등록해줘' }, permission: PERMISSION.SALES_ORDER_CREATE },
  { example: { kind: 'HOT_ROLLING', label: '열연 배정', text: '생산계획 PP-○○○○-○○○○ 열연 배정 추천해서 카드로 만들어줘' }, permission: PERMISSION.HOT_ROLLING_ALLOCATE },
  { example: { kind: 'HEAT_PLAN', label: '히트 편성 확정', text: '생산계획 PP-○○○○-○○○○ 히트 편성 확정 카드 만들어줘' }, permission: PERMISSION.PRODUCTION_PLAN_CONFIRM },
  { example: { kind: 'PAST_CASE', label: '과거 사례 등록', text: '불합격 LOT ○○○를 과거 사례로 등록해줘' }, permission: PERMISSION.DISPOSITION_SET },
];

export function actionCardExamplesFor(user: AuthUser): AiActionCardExample[] {
  return EXAMPLES.filter(({ permission }) => permission === null || hasPermission(user, { permission, level: 'USE' })).map(({ example }) => ({ ...example }));
}
