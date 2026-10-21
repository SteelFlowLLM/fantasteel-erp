// AI 어시스턴트 실행 카드 (REQ-AST-005). 카드는 서버에 저장하지 않아 화면이 사용자가 고친 값을 들고 있다가, 실행할 때 그대로 보낸다.
// 업무·일정·구매요청 카드의 필수 칸 규칙은 회의록 후보와 같은 shared의 missingFieldsOf를 쓰고, 값의 뜻은 서버가 실행할 때 다시 검증한다.
import {
  AI_RESEARCH_LIMITS,
  missingFieldsOf,
  notionSyncOf,
  type AiActionCard,
  type AiActionCardExecuteInput,
  type AiActionCardExecuteResult,
  type AiActionCardKind,
  type AiNotionCard,
  type AiPastCaseCard,
  type AiScheduleEventUpdateCard,
  type AiTaskUpdateCard,
  type AiSalesOrderCard,
  type AiWorkCard,
  type MeetingCandidateUpdateInput,
} from '@fantasteel/shared';

export const CARD_KIND_LABEL = {
  TASK: '업무',
  EVENT: '일정',
  PURCHASE: '구매요청',
  SALES_ORDER: '수주 등록',
  HOT_ROLLING: '열연 배정',
  HEAT_PLAN: '히트 편성',
  PAST_CASE: '과거 사례',
  NOTION_PAGE_CREATE: 'Notion 새 페이지',
  NOTION_PAGE_APPEND: 'Notion 글 더하기',
  NOTION_PAGE_UPDATE: 'Notion 고치기',
  SCHEDULE_EVENT_UPDATE: '일정 고치기',
  TASK_UPDATE: '업무 고치기',
  RESEARCH: '심층 조사',
} as const satisfies Record<AiActionCardKind, string>;

type Registered = AiActionCardExecuteResult['registered'];

/** 실행 결과를 열 수 있는 화면과 안내 문구. external이면 새 탭으로 여는 바깥 주소(Notion) */
export const CARD_RESULT: Record<Registered['type'], { message: (registered: Registered) => string; href: (registered: Registered) => string; linkLabel: (registered: Registered) => string; external?: boolean }> = {
  task: { message: (r) => (r.updated ? '업무를 고쳤어요' : '업무로 등록됐어요'), href: () => '/tasks', linkLabel: () => '업무 보기' },
  schedule_event: { message: (r) => `${r.updated ? '일정을 고쳤어요' : '일정으로 등록됐어요'}${r.note ? ` (${r.note})` : ''}`, href: () => '/schedule', linkLabel: () => '내 일정 보기' },
  action_draft: { message: () => '구매요청 초안이 만들어졌어요. 초안을 확정하면 구매요청이 되고 부서장 승인을 기다려요', href: (r) => `/action-drafts/${r.id}`, linkLabel: (r) => `초안 #${r.id} 열기` },
  sales_order: { message: (r) => `수주 ${r.no ?? ''}를 등록했어요`, href: (r) => `/sales-orders/${r.id}`, linkLabel: () => '수주 열기' },
  hot_rolling: { message: (r) => `${r.no ?? '생산계획'}의 열연 배정을 확정했어요`, href: () => '/production/rolling', linkLabel: () => '열연 투입 배정 보기' },
  heat_plan: { message: (r) => `${r.no ?? '생산계획'}의 히트 편성을 확정했어요`, href: () => '/production/plans', linkLabel: () => '생산계획 보기' },
  past_case: { message: (r) => `과거 사례 ${r.no ?? ''}를 등록했어요`, href: () => '/past-cases', linkLabel: () => '과거 사례 보기' },
  notion_page: { message: (r) => (r.note ? `Notion에 반영했어요 (Notion 알림: ${r.note})` : 'Notion에 반영했어요'), href: (r) => r.url ?? '', linkLabel: () => 'Notion에서 열기', external: true },
  research: { message: () => '심층 조사를 만들었어요. 계획을 확인하고 시작해 주세요', href: (r) => `/ai-research?id=${r.id}`, linkLabel: () => '조사 화면 열기' },
};

export const isNotionCard = (card: AiActionCard): card is AiNotionCard => card.kind === 'NOTION_PAGE_CREATE' || card.kind === 'NOTION_PAGE_APPEND' || card.kind === 'NOTION_PAGE_UPDATE';

/** Notion 카드가 가리키는 페이지 (새 페이지면 그 위 페이지) */
export const notionTargetOf = (card: AiNotionCard) => (card.kind === 'NOTION_PAGE_CREATE' ? card.parent : card.page);

/** 재고·생산에 큰 영향이 있어 [실행] 뒤 확인창을 한 번 더 거치는 카드 */
export const needsConfirmation = (card: AiActionCard): boolean => card.kind === 'SALES_ORDER' || card.kind === 'HOT_ROLLING' || card.kind === 'HEAT_PLAN';

export const isWorkCard = (card: AiActionCard): card is AiWorkCard => card.kind === 'TASK' || card.kind === 'EVENT' || card.kind === 'PURCHASE';

/** 수주 카드에서 비어 있는 칸 (표시명) */
function missingOfSalesOrder(card: AiSalesOrderCard): string[] {
  const missing: string[] = [];
  if (card.customerId === null) missing.push('고객사');
  if (card.lines.length === 0) missing.push('품목');
  card.lines.forEach((line, index) => {
    if (line.itemId === null) missing.push(`${index + 1}번째 줄 규격`);
    if (line.orderedQty === null) missing.push(`${index + 1}번째 줄 매수`);
    if (line.dueDate === null) missing.push(`${index + 1}번째 줄 납기`);
  });
  return missing;
}

/** 사례 카드에서 비어 있는 칸 (원인·조치·설비는 모를 수 있어 비어도 등록한다) */
function missingOfPastCase(card: AiPastCaseCard): string[] {
  return [...(card.title.trim() === '' ? ['제목'] : []), ...(card.phenomenon.trim() === '' ? ['현상'] : []), ...(card.occurredDate === '' ? ['발생일'] : [])];
}

/** 실행 전에 채워야 할 칸 (표시명). 비면 실행할 수 있다 */
export function missingOfCard(card: AiActionCard): string[] {
  switch (card.kind) {
    case 'SALES_ORDER':
      return missingOfSalesOrder(card);
    case 'PAST_CASE':
      return missingOfPastCase(card);
    case 'HOT_ROLLING':
    case 'HEAT_PLAN':
    case 'TASK_UPDATE':
      return [];
    case 'NOTION_PAGE_CREATE':
      return [...(card.pageTitle.trim() === '' ? ['제목'] : []), ...(card.content.trim() === '' ? ['내용'] : [])];
    case 'NOTION_PAGE_APPEND':
      return card.content.trim() === '' ? ['내용'] : [];
    case 'NOTION_PAGE_UPDATE':
      return card.edits.length === 0 && card.newTitle === null ? ['바꿀 내용'] : [];
    case 'SCHEDULE_EVENT_UPDATE':
      return card.scheduleEventTitle.trim() === '' ? ['제목'] : [];
    case 'RESEARCH':
      return card.question.trim().length < AI_RESEARCH_LIMITS.questionMin ? ['조사할 질문'] : [];
    default:
      return missingFieldsOf(card);
  }
}

/** 카드의 값을 실행 요청으로. 아직 정하지 않은 칸(null)은 보내지 않는다 */
export function executeInputOf(card: AiActionCard): AiActionCardExecuteInput {
  switch (card.kind) {
    case 'SALES_ORDER':
      return {
        kind: 'SALES_ORDER',
        ...(card.customerId !== null ? { customerId: card.customerId } : {}),
        lines: card.lines.map((line) => ({
          ...(line.itemId !== null ? { itemId: line.itemId } : {}),
          ...(line.orderedQty !== null ? { orderedQty: line.orderedQty } : {}),
          ...(line.dueDate !== null ? { dueDate: line.dueDate } : {}),
        })),
      };
    case 'HOT_ROLLING':
      return { kind: 'HOT_ROLLING', productionPlanId: card.productionPlanId, lotIds: card.lots.map((lot) => lot.lotId) };
    case 'HEAT_PLAN':
      return { kind: 'HEAT_PLAN', productionPlanId: card.productionPlanId };
    case 'PAST_CASE':
      return {
        kind: 'PAST_CASE',
        lotId: card.lotId,
        caseCategory: card.caseCategory,
        title: card.title,
        phenomenon: card.phenomenon,
        cause: card.cause,
        actionTaken: card.actionTaken,
        equipmentText: card.equipmentText,
        occurredDate: card.occurredDate,
      };
    case 'NOTION_PAGE_CREATE':
      return { kind: card.kind, nonce: card.nonce, notionPageId: card.parent.id, pageTitle: card.pageTitle, content: card.content };
    case 'NOTION_PAGE_APPEND':
      return { kind: card.kind, nonce: card.nonce, notionPageId: card.page.id, content: card.content };
    case 'NOTION_PAGE_UPDATE':
      return { kind: card.kind, nonce: card.nonce, notionPageId: card.page.id, ...(card.newTitle !== null ? { pageTitle: card.newTitle } : {}), edits: card.edits };
    case 'SCHEDULE_EVENT_UPDATE':
      return { kind: card.kind, scheduleEventId: card.scheduleEventId, title: card.scheduleEventTitle, description: card.scheduleEventDescription, startAt: card.startAt, endAt: card.endAt };
    case 'TASK_UPDATE':
      return taskUpdateInputOf(card);
    case 'RESEARCH':
      // 앞 답의 웹 검색 결과(seed)는 카드가 아니라 대화에서 오므로 카드 부품이 붙인다
      return { kind: 'RESEARCH', question: card.question.trim() };
    default:
      return workInputOf(card);
  }
}

/** 업무 고치기는 바뀐 칸만 보낸다 (완료 카드는 완료만) */
function taskUpdateInputOf(card: AiTaskUpdateCard): AiActionCardExecuteInput {
  if (card.complete) return { kind: 'TASK_UPDATE', taskId: card.taskId, complete: true };
  return {
    kind: 'TASK_UPDATE',
    taskId: card.taskId,
    ...(card.taskTitle !== card.before.taskTitle ? { title: card.taskTitle } : {}),
    ...(card.taskDescription !== card.before.taskDescription ? { description: card.taskDescription } : {}),
    ...(card.dueDate !== card.before.dueDate ? { dueDate: card.dueDate } : {}),
  };
}

/** 일정 고치기 카드의 시각을 화면 칸(datetime-local, 서울)으로 */
export const seoulLocalOf = (iso: string): string => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 16);

/** 일정 고치기 카드에 사용자가 고친 칸을 반영한다 (시각은 'YYYY-MM-DDTHH:mm' 서울) */
export function applyScheduleChanges(card: AiScheduleEventUpdateCard, input: { title: string; description: string; startAt: string; endAt: string }): AiScheduleEventUpdateCard {
  const issues = Date.parse(toSeoulIso(input.endAt)) <= Date.parse(toSeoulIso(input.startAt)) ? ['끝 시각은 시작 시각보다 뒤여야 해요'] : [];
  return { ...card, title: `일정 고치기 · ${input.title}`, scheduleEventTitle: input.title, scheduleEventDescription: input.description.trim() || null, startAt: toSeoulIso(input.startAt), endAt: toSeoulIso(input.endAt), issues };
}

function workInputOf(card: AiWorkCard): AiActionCardExecuteInput {
  const input: Extract<AiActionCardExecuteInput, { kind: AiWorkCard['kind'] }> = { kind: card.kind, title: card.title };
  if (card.description) input.description = card.description;
  if (card.kind === 'TASK') {
    if (card.assigneeId !== null) input.assigneeId = card.assigneeId;
    if (card.dueDate !== null) input.dueDate = card.dueDate;
  } else if (card.kind === 'EVENT') {
    if (card.startAt !== null) input.startAt = card.startAt;
    if (card.endAt !== null) input.endAt = card.endAt;
    input.attendeeIds = card.attendeeIds;
    input.notionSync = notionSyncOf(card);
  } else if (card.purchase) {
    const purchase: NonNullable<MeetingCandidateUpdateInput['purchase']> = {};
    if (card.purchase.itemId !== null) purchase.itemId = card.purchase.itemId;
    if (card.purchase.requestedTon !== null) purchase.requestedTon = card.purchase.requestedTon;
    if (card.purchase.desiredReceiptDate !== null) purchase.desiredReceiptDate = card.purchase.desiredReceiptDate;
    input.purchase = purchase;
  }
  return input;
}

/** 'YYYY-MM-DDTHH:mm'(서울, datetime-local 값) 또는 +09:00 ISO → +09:00 ISO */
const toSeoulIso = (value: string): string => (value.length === 16 ? `${value}:00+09:00` : value);

const oneHourAfter = (iso: string): string => `${new Date(Date.parse(iso) + 9 * 3_600_000 + 3_600_000).toISOString().slice(0, 16)}:00+09:00`;

/** 사용자가 직접 정한 칸은 AI가 붙인 확인 사유가 풀린다. 사유 문구에 든 칸 이름으로 알아본다 */
const ISSUE_KEYWORD = { assigneeId: '담당자', dueDate: '마감일', startAt: '일정 시각', endAt: '끝 시각', attendeeIds: '참석자', itemId: '원료', requestedTon: '수량', desiredReceiptDate: '희망 입고일' } as const;

/** 업무·일정·구매요청 카드에 사용자가 고친 칸을 반영한다 (확인은 서버가 실행할 때 다시 한다) */
export function applyCardChanges(card: AiWorkCard, input: MeetingCandidateUpdateInput): AiWorkCard {
  const next: AiWorkCard = { ...card, attendeeIds: [...card.attendeeIds], purchase: card.purchase ? { ...card.purchase } : null };
  const solved: (keyof typeof ISSUE_KEYWORD)[] = [];

  if (input.title !== undefined) {
    // 구매요청 사유는 처음에 제목으로 채워지므로 사유를 따로 고치지 않았으면 같이 따라간다
    if (next.purchase && next.purchase.requestReason === card.title) next.purchase.requestReason = input.title;
    next.title = input.title;
  }
  if (input.description !== undefined) next.description = input.description;
  if (input.assigneeId !== undefined) {
    next.assigneeId = input.assigneeId;
    solved.push('assigneeId');
  }
  if (input.dueDate !== undefined) {
    next.dueDate = input.dueDate;
    solved.push('dueDate');
  }
  if (input.startAt !== undefined) {
    next.startAt = toSeoulIso(input.startAt);
    solved.push('startAt');
    // 끝 시각을 말하지 않아 가정했던 일정은 시작을 옮기면 끝도 1시간 뒤로 따라간다
    if (input.endAt === undefined && (card.endAssumed || card.endAt === null)) {
      next.endAt = oneHourAfter(next.startAt);
      next.endAssumed = true;
    }
  }
  if (input.endAt !== undefined) {
    next.endAt = toSeoulIso(input.endAt);
    next.endAssumed = false;
    solved.push('endAt');
  }
  if (input.attendeeIds !== undefined) {
    next.attendeeIds = input.attendeeIds;
    solved.push('attendeeIds');
  }
  if (input.notionSync !== undefined) next.notionSync = input.notionSync;
  if (input.purchase && next.purchase) {
    if (input.purchase.itemId !== undefined) {
      next.purchase.itemId = input.purchase.itemId;
      solved.push('itemId');
    }
    if (input.purchase.requestedTon !== undefined) {
      next.purchase.requestedTon = input.purchase.requestedTon;
      solved.push('requestedTon');
    }
    if (input.purchase.desiredReceiptDate !== undefined) {
      next.purchase.desiredReceiptDate = input.purchase.desiredReceiptDate;
      solved.push('desiredReceiptDate');
    }
  }
  next.issues = card.issues.filter((issue) => !solved.some((field) => issue.includes(ISSUE_KEYWORD[field])));
  return next;
}

/**
 * 수주 카드를 사용자가 고친 뒤의 확인 사유. 고친 칸이 채워졌으면 AI가 붙인 사유가 풀리므로 지금 비어 있는 칸만 다시 만든다.
 * (서버가 실행할 때 매수·납기 범위는 다시 본다)
 */
export function salesOrderIssues(card: AiSalesOrderCard): string[] {
  const issues: string[] = [];
  if (card.customerId === null) issues.push('고객사를 정해 주세요');
  if (card.lines.length === 0) issues.push('품목 줄을 하나 이상 넣어 주세요');
  card.lines.forEach((line, index) => {
    if (line.itemId === null) issues.push(`${index + 1}번째 줄의 규격을 정해 주세요`);
    if (line.orderedQty === null) issues.push(`${index + 1}번째 줄의 매수는 1 이상의 정수여야 해요`);
    if (line.dueDate === null) issues.push(`${index + 1}번째 줄의 납기를 확인해 주세요`);
  });
  return issues;
}

/** 사례 카드를 고친 뒤의 확인 사유: 원인·조치가 채워지면 그 사유가 풀린다 */
export function pastCaseIssues(card: AiPastCaseCard): string[] {
  return card.issues.filter((issue) => !(issue.includes('원인') && card.cause.trim() !== '') && !(issue.includes('조치') && card.actionTaken.trim() !== ''));
}
