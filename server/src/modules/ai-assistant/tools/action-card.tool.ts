import type { AiActionCardService } from '../ai-action-card.service';
import type { AiOpsCardService } from '../ai-ops-card.service';
import { OPEN_ACCESS, type AssistantTool } from './assistant-tool';

export const ACTION_CARD_TOOL = 'propose_action_card';
export const SALES_ORDER_CARD_TOOL = 'propose_sales_order';
export const HOT_ROLLING_CARD_TOOL = 'propose_hot_rolling_allocation';
export const HEAT_PLAN_CARD_TOOL = 'propose_heat_plan_confirmation';
export const PAST_CASE_CARD_TOOL = 'propose_past_case';

/** 카드를 만드는 도구 전부. 카드를 보여 줄 수 있는 화면(철강맨AI 패널)이 요청했을 때만 모델에 알린다 */
export const ACTION_CARD_TOOLS: readonly string[] = [ACTION_CARD_TOOL, SALES_ORDER_CARD_TOOL, HOT_ROLLING_CARD_TOOL, HEAT_PLAN_CARD_TOOL, PAST_CASE_CARD_TOOL];

const NOT_REGISTERED = '실행 카드를 화면에 만들었어요. 아직 반영되지 않았어요. 사용자가 카드를 확인하고 실행을 눌러야 반영돼요';

/**
 * 실행 카드 제안 도구 (REQ-AST-005). 조회 도구와 달리 아무것도 바꾸지 않고, 사용자가 카드에서 실행을 눌러야 업무에 반영된다.
 * 권한은 제안할 때(만들 수 없는 사람에게는 카드를 만들지 않는다)와 실행할 때 사용자 권한으로 본다.
 */
export function actionCardTools(cards: AiActionCardService, ops: AiOpsCardService): AssistantTool[] {
  return [
    {
      access: OPEN_ACCESS,
      definition: {
        name: ACTION_CARD_TOOL,
        description:
          '사용자가 업무(할 일) 등록, 일정 등록, 구매요청 등록을 부탁했을 때 실행 카드를 만든다. 카드는 등록이 아니다: 사용자가 카드를 확인하고 [실행]을 눌러야 ERP에 반영된다. 질문·조회에는 쓰지 않는다. 부탁 하나에 카드 하나만 만든다.',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['TASK', 'EVENT', 'PURCHASE'], description: 'TASK=업무(할 일), EVENT=일정, PURCHASE=구매요청(원료)' },
            title: { type: 'string', description: '카드 제목 (예: 견적서 보내기, 열연 라인 점검 회의, 철광석 구매요청)' },
            description: { type: 'string', description: '보충 설명. 없으면 생략' },
            assigneeName: { type: 'string', description: 'TASK 담당자 이름. 사용자 본인이면 "나". 모르면 생략' },
            dueDate: { type: 'string', description: 'TASK 마감일 YYYY-MM-DD. 오늘 날짜를 기준으로 풀고, 모르면 생략' },
            startAt: { type: 'string', description: 'EVENT 시작 시각 YYYY-MM-DDTHH:mm (서울). 모르면 생략' },
            endAt: { type: 'string', description: 'EVENT 끝 시각 YYYY-MM-DDTHH:mm. 말이 없으면 생략' },
            attendeeNames: { type: 'array', items: { type: 'string' }, description: 'EVENT 참석자 이름들. 사용자 본인만이면 생략' },
            itemName: { type: 'string', description: 'PURCHASE 원료 이름 또는 코드 (예: 철광석, ORE01)' },
            quantityTon: { type: 'number', description: 'PURCHASE 수량(톤). 모르면 생략' },
            desiredReceiptDate: { type: 'string', description: 'PURCHASE 희망 입고일 YYYY-MM-DD. 모르면 생략' },
          },
          required: ['kind', 'title'],
        },
      },
      async run(args, user) {
        const card = await cards.propose(user, args);
        return { label: '실행 카드', cards: [card], data: { 결과: NOT_REGISTERED, 카드: { 종류: card.kind, 제목: card.title, '확인이 필요한 칸': card.issues } } };
      },
    },
    {
      access: OPEN_ACCESS,
      definition: {
        name: SALES_ORDER_CARD_TOOL,
        description: '사용자가 수주 등록을 부탁했을 때 수주 등록 실행 카드를 만든다. 고객사와 품목(규격·매수·납기)은 사용자가 말한 것만 넘긴다. 사용자가 실행을 눌러야 수주가 등록되고 재고 예약과 부족분 생산계획이 만들어진다.',
        parameters: {
          type: 'object',
          properties: {
            customerName: { type: 'string', description: '고객사 이름. 모르면 생략' },
            lines: {
              type: 'array',
              description: '수주 품목 줄',
              items: {
                type: 'object',
                properties: {
                  itemName: { type: 'string', description: '제품 규격 코드 또는 품목 이름 (예: SS275 코일)' },
                  orderedQty: { type: 'integer', description: '주문 매수(정수). 톤이 아니다. 모르면 생략' },
                  dueDate: { type: 'string', description: '납기 YYYY-MM-DD. 오늘 날짜를 기준으로 풀고, 모르면 생략' },
                },
              },
            },
          },
          required: ['lines'],
        },
      },
      async run(args, user) {
        const card = await ops.proposeSalesOrder(user, args);
        return { label: '실행 카드', cards: [card], data: { 결과: NOT_REGISTERED, 카드: { 종류: card.kind, 제목: card.title, '확인이 필요한 칸': card.issues } } };
      },
    },
    {
      access: OPEN_ACCESS,
      definition: {
        name: HOT_ROLLING_CARD_TOOL,
        description: '사용자가 생산계획의 열연 투입 슬래브 배정 추천·확정을 부탁했을 때 배정 실행 카드를 만든다. 생산계획 번호(PP-…)가 필요하다. FIFO 순서로 추천한 슬래브를 카드에 담고, 사용자가 실행을 눌러야 배정이 확정된다.',
        parameters: { type: 'object', properties: { productionPlanNo: { type: 'string', description: '생산계획 번호 (예: PP-2510-0001)' } }, required: ['productionPlanNo'] },
      },
      async run(args, user) {
        const card = await ops.proposeHotRolling(user, args);
        return { label: '실행 카드', cards: [card], data: { 결과: NOT_REGISTERED, 카드: { 종류: card.kind, 제목: card.title, '더 배정할 슬래브 매수': card.neededQty, '추천 슬래브 수': card.lots.length } } };
      },
    },
    {
      access: OPEN_ACCESS,
      definition: {
        name: HEAT_PLAN_CARD_TOOL,
        description: '사용자가 생산계획의 히트 편성 확정을 부탁했을 때 히트 편성 실행 카드를 만든다. 생산계획 번호(PP-…)가 필요하다. 사용자가 실행을 눌러야 히트 수가 확정된다.',
        parameters: { type: 'object', properties: { productionPlanNo: { type: 'string', description: '생산계획 번호 (예: PP-2510-0001)' } }, required: ['productionPlanNo'] },
      },
      async run(args, user) {
        const card = await ops.proposeHeatPlan(user, args);
        return { label: '실행 카드', cards: [card], data: { 결과: NOT_REGISTERED, 카드: { 종류: card.kind, 제목: card.title, '현재 히트 수': card.currentHeatCount, '확정할 히트 수': card.newHeatCount } } };
      },
    },
    {
      access: OPEN_ACCESS,
      definition: {
        name: PAST_CASE_CARD_TOOL,
        description: '사용자가 불합격 LOT를 과거 사례로 등록해 달라고 부탁했을 때 사례 등록 실행 카드를 만든다. LOT 번호가 필요하고 불합격 판정된 LOT만 된다. 사용자가 카드의 내용을 고치고 실행을 눌러야 등록된다.',
        parameters: { type: 'object', properties: { lotNo: { type: 'string', description: 'LOT 번호' } }, required: ['lotNo'] },
      },
      async run(args, user) {
        const card = await ops.proposePastCase(user, args);
        return { label: '실행 카드', cards: [card], data: { 결과: NOT_REGISTERED, 카드: { 종류: card.kind, 제목: card.title, '확인이 필요한 칸': card.issues } } };
      },
    },
  ];
}
