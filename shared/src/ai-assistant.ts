// AI 어시스턴트 (REQ-AST, BP-AST-01, API-262·263). 업무 지식(용어 사전)과 데이터 조회(REQ-AST-004)를 답하고,
// 쓰기 도구는 사용자가 승인 카드에서 허용해야 실행한다 (REQ-AST-005·010, 이슈 #362).
import type { Role } from './codes';

/** 화면이 들고 있는 지난 대화 한 줄. 대화 기록은 서버에 저장하지 않아(저장 여부 미결정) 화면이 최근 것을 함께 보낸다 */
export interface AiAssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 지금 보고 있는 화면 (REQ-AST-007) */
export interface AiAssistantScreenContext {
  /** 주소와 쿼리 (예: /sales-orders?id=12) */
  path: string;
  /** 화면 제목 (예: 수주 관리) */
  title: string;
  /** 위젯 등에서 맥락을 들고 열었을 때의 설명 (예: SM355A · 최근 30일) */
  label: string | null;
}

export interface AiAssistantMessageInput {
  question: string;
  screen?: AiAssistantScreenContext;
  /** 회의록 상세에서 묻는 질문이면 그 회의록 id. 서버가 회의 내용을 읽어 질문의 맥락으로 쓴다 (Voice2ERP 회의 질문하기) */
  meetingMinutesId?: number;
  /** 오래된 것부터. 서버는 최근 몇 개만 쓴다 */
  history?: AiAssistantTurn[];
  /** 생각 정도 (문서에 없는 기능, 2026-10-16 추가). 없으면 서버 기본값(보통) */
  reasoning?: AiReasoningLevel;
  /** 질문과 함께 보는 사진 (문서에 없는 기능, 2026-10-16 추가). 사진을 볼 수 있는 모델일 때만. 지난 대화에는 남기지 않는다 */
  images?: AiAssistantImageInput[];
  /**
   * 화면이 승인 카드(approval_required 이벤트)를 보이고 허용·거부를 보낼 수 있으면 true (문서에 없는 기능, 2026-10-16 추가).
   * 실시간 답 API(messages/stream)에서만 쓰기 도구를 모델에 알린다. 없거나 false면, 또는 API-262(한 번에 답)면 쓰기 도구가 없다
   */
  approvalCards?: boolean;
  /**
   * 웹 검색을 켠 질문이면 true (문서에 없는 기능, 이슈 #367). 실시간 답 API(messages/stream)에서만 웹 도구
   * (web_search·read_web_page, 카카오 키가 있으면 search_places)를 모델에 알린다. 사내 채팅 @AI(API-262)는 쓰지 않는다
   */
  webSearch?: boolean;
}

/** LM Studio(OpenAI 호환 image_url)가 받는 사진 형식 */
export const AI_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AiImageMediaType = (typeof AI_IMAGE_MEDIA_TYPES)[number];
/** 질문 하나에 붙이는 사진 수와 한 장의 크기 상한 (가정값). 화면이 긴 변을 줄여 보내므로 보통 수백 KB다 */
export const AI_IMAGE_MAX_COUNT = 4;
export const AI_IMAGE_MAX_BYTES = 2_000_000;

export interface AiAssistantImageInput {
  mediaType: AiImageMediaType;
  /** data: 접두어 없는 base64 */
  dataBase64: string;
}

/** 지금 설정된 모델이 할 수 있는 것 (GET /ai-assistant/capabilities). LM Studio가 아니면 알 수 없어 null */
export interface AiAssistantCapabilitiesView {
  model: string | null;
  /** 사진을 볼 수 있는지 */
  vision: boolean | null;
  /** 생각 정도를 바꿀 수 있는지 */
  reasoning: boolean | null;
  /** 웹 검색으로 쓸 수 있는 것 (이슈 #367). 모델과 상관없이 서버의 키 설정으로 정해진다 */
  webSearch: AiWebSearchCapabilities;
}

/** 웹 검색 엔진: 네이버 검색 API(키가 있을 때) → DuckDuckGo HTML → 위키백과 순으로 쓴다 */
export const AI_WEB_SEARCH_ENGINES = ['naver', 'duckduckgo', 'wikipedia'] as const;
export type AiWebSearchEngine = (typeof AI_WEB_SEARCH_ENGINES)[number];

export interface AiWebSearchCapabilities {
  /** 쓸 수 있는 엔진 (부르는 순서) */
  engines: AiWebSearchEngine[];
  /** 장소 검색(search_places)을 쓸 수 있는지. 카카오나 네이버 키가 있어야 한다 */
  placeSearch: boolean;
}

/** 생각 정도: 끔·낮게·보통·깊게. 모델이 단계를 모르면 켜고 끄기만 한다 */
export const AI_REASONING_LEVELS = ['off', 'low', 'medium', 'high'] as const;
export type AiReasoningLevel = (typeof AI_REASONING_LEVELS)[number];
export const AI_REASONING_LABEL: Record<AiReasoningLevel, string> = { off: '끔', low: '낮게', medium: '보통', high: '깊게' };
export const AI_REASONING_DEFAULT: AiReasoningLevel = 'medium';

/** 조회 도구의 한글 제목. 도구를 부르는 순간(결과가 오기 전) 화면에 보인다 */
export const AI_ASSISTANT_TOOL_TITLE: Record<string, string> = {
  get_inventory: '재고 조회',
  get_sales_orders: '수주 조회',
  trace_lot: 'LOT 추적',
  get_business_events: '작업 로그 조회',
  get_production_plans: '생산계획 조회',
  get_production_results: '생산실적 조회',
  get_quality_inspections: '품질검사 조회',
  get_rejected_lots: '불합격 LOT 조회',
  get_purchase_requisitions: '구매요청 조회',
  get_purchase_orders: '발주 조회',
  get_goods_receipts: '입고 조회',
  get_shipment_requests: '출하요청 조회',
  get_mill_sheets: '밀시트 조회',
  search_past_cases: '과거 사례 검색',
  add_my_schedule_event: '내 일정 추가',
  create_purchase_request_draft: '구매요청 초안 만들기',
  web_search: '웹 검색',
  search_places: '장소 검색',
  read_web_page: '웹 페이지 읽기',
};

/** 웹 도구 (이슈 #367). 조회 도구처럼 묻지 않고 실행하지만, 웹 검색을 켠 실시간 답에서만 알린다 */
export const AI_ASSISTANT_WEB_TOOLS = ['web_search', 'search_places', 'read_web_page'] as const;
export type AiAssistantWebTool = (typeof AI_ASSISTANT_WEB_TOOLS)[number];

export const isAiAssistantWebTool = (name: string): name is AiAssistantWebTool => (AI_ASSISTANT_WEB_TOOLS as readonly string[]).includes(name);

/** 웹 도구가 찾거나 읽은 페이지 하나. url은 검색 결과에 있던 주소(읽은 페이지면 이동 뒤 최종 주소) */
export interface AiWebSource {
  title: string;
  url: string;
}

/** 업무 데이터를 바꾸는 쓰기 도구. 늘 승인 카드를 거친다. 나머지 도구는 조회 도구라 묻지 않는다 */
export const AI_ASSISTANT_WRITE_TOOLS = ['add_my_schedule_event', 'create_purchase_request_draft'] as const;
export type AiAssistantWriteTool = (typeof AI_ASSISTANT_WRITE_TOOLS)[number];

export const isAiAssistantWriteTool = (name: string): name is AiAssistantWriteTool => (AI_ASSISTANT_WRITE_TOOLS as readonly string[]).includes(name);

/** 승인 카드를 기다리는 시간 (결정값). 지나면 거부로 본다 */
export const AI_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

/** 사용자가 카드에서 고르는 값 */
export const AI_APPROVAL_DECISIONS = ['ALLOW', 'DENY'] as const;
export type AiApprovalDecision = (typeof AI_APPROVAL_DECISIONS)[number];
/** 카드가 끝난 이유: 허용·거부·시간 초과(거부로 본다) */
export type AiApprovalResolution = AiApprovalDecision | 'TIMEOUT';
export const AI_APPROVAL_RESOLUTION_LABEL: Record<AiApprovalResolution, string> = { ALLOW: '허용', DENY: '거부', TIMEOUT: '시간 초과' };

/** 승인 카드에 보일 한 줄 (예: { label: '날짜', value: '2026-10-17 (토)' }) */
export interface AiApprovalDetail {
  label: string;
  value: string;
}

/** POST ai-assistant/approvals/:approvalId 본문 */
export interface AiApprovalDecisionInput {
  decision: AiApprovalDecision;
}

/** POST ai-assistant/approvals/:approvalId 응답 */
export interface AiApprovalDecisionView {
  approvalId: string;
  decision: AiApprovalDecision;
}

/** 쓰기 도구가 만든 업무. 화면이 linkPath로 이동 링크를 보인다 */
export interface AiToolExecutionResult {
  /** 만든 행의 테이블 (작업 로그 대상과 같은 이름, 예: schedule_event, action_draft) */
  table: string;
  id: number;
  /** 화면에 보일 이름 (예: 일정 제목, '구매요청 초안 #12') */
  label: string;
  /** 화면 주소 (예: /schedule?week=2026-10-12, /action-drafts/12) */
  linkPath: string;
}

export type AiToolExecutionStatus = 'SUCCESS' | 'FAILED';

/** 답의 출처 종류 (REQ-AST-009): 용어 사전, 업무 프로세스 정의서, 업무 매뉴얼(화면 절차), 조회 데이터. 사례 번호는 다음 단계 */
export type AiAssistantSourceKind = 'GLOSSARY' | 'PROCESS' | 'MANUAL' | 'DATA';

export interface AiAssistantSource {
  kind: AiAssistantSourceKind;
  /** 용어 사전이면 용어 ID (TRM-056), 업무 프로세스면 업무 ID (BP-SO-01), 조회 데이터면 도구 이름 (get_inventory) */
  id: string;
  /** 용어 사전이면 한글명 (예약), 업무 프로세스면 업무 이름 (수주 등록·예약·계획), 조회 데이터면 조회 대상 (재고 · SS275) */
  label: string;
}

/** 답을 만들며 부른 조회 도구 한 번 (AI 실행 기록). 묻는 사람 권한으로 실행한 결과라 그 사람 화면에만 보인다 */
export interface AiAssistantToolTrace {
  /** 도구 이름 (get_inventory) */
  name: string;
  /** 모델이 넘긴 입력 JSON 그대로. 길면 앞부분만 */
  arguments: string;
  /** 도구가 돌려준 결과의 앞부분 */
  resultPreview: string;
  durationMs: number;
}

export interface AiAssistantReplyView {
  answer: string;
  sources: AiAssistantSource[];
  /** 답한 모델 id */
  model: string;
  latencyMs: number;
  /** 부른 조회 도구 (부른 순서). 서버에 저장하지 않고 이 답에만 담는다 */
  toolCalls: AiAssistantToolTrace[];
  /** 추론 모델이 마지막 답 앞에 쓴 생각 글. 없으면 null */
  thinking: string | null;
  /** 고른 생각 정도를 모델에 보냈는지. 모델이 생각 설정을 받지 않으면 false (화면이 안내한다) */
  reasoningApplied: boolean;
  /**
   * 웹 출처 (이슈 #367). 웹 검색을 켠 질문에만 있다. 답이 링크로 단 검색 결과와 읽은 페이지 순서이고,
   * 둘 다 없으면 검색 결과 앞의 3개. 답 본문의 링크는 이 질문의 웹 도구 결과에 있던 주소만 남는다
   */
  webSources?: AiWebSource[];
}

/**
 * 답을 만드는 과정의 실시간 이벤트 (POST /ai-assistant/messages/stream, 한 줄에 JSON 하나).
 * - thinking·answer: 글 조각. answer는 출처 표시를 지우기 전 원문이라, done의 reply.answer로 바꿔 보인다
 * - 한 차례에서 answer 조각 뒤에 tool_start가 오면 그 글은 최종 답이 아니라 도구를 부르기 전의 중간 글이다
 * - 쓰기 도구(승인 카드): tool_start → approval_required → approval_resolved → (허용이면) tool_execution → tool_end.
 *   인자·사전 확인이 틀리면 카드 없이 tool_end만 온다(모델이 고쳐 다시 부른다). toolId는 같은 도구 호출의 tool_start.id.
 *   카드를 기다리는 동안 heartbeat가 20초마다 온다
 * - 웹 도구(이슈 #367)는 조회 도구와 같은 tool_start → tool_end이고, tool_end.webSources에 찾은·읽은 페이지가 온다.
 *   답에 쓴 웹 출처는 done의 reply.webSources
 * - 마지막은 done 또는 error 하나
 */
export type AiAssistantStreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'answer'; text: string }
  | { type: 'tool_start'; id: string; name: string; arguments: string }
  | {
      type: 'tool_end';
      id: string;
      label: string | null;
      resultPreview: string;
      durationMs: number;
      /** 웹 도구일 때만: 이 호출이 찾은 결과(검색·장소) 또는 읽은 페이지 (이슈 #367) */
      webSources?: AiWebSource[];
    }
  | {
      type: 'approval_required';
      approvalId: string;
      /** 같은 도구 호출의 tool_start.id */
      toolId: string;
      toolName: AiAssistantWriteTool;
      /** 무엇을 하는지 한 줄 (예: 내 일정에 '주간 회의'를 추가해요) */
      title: string;
      details: AiApprovalDetail[];
      /** 이 시각까지 고르지 않으면 거부(TIMEOUT)로 본다. ISO 8601 */
      expiresAt: string;
    }
  | { type: 'approval_resolved'; approvalId: string; decision: AiApprovalResolution }
  /** 승인 카드를 기다리는 동안 20초마다 보내는 빈 이벤트. 프록시가 조용한 연결을 끊지 않게 한다. 화면은 무시한다 */
  | { type: 'heartbeat' }
  | {
      type: 'tool_execution';
      approvalId: string;
      status: AiToolExecutionStatus;
      /** 화면에 보일 결과·실패 이유 */
      message: string;
      /** 성공하면 만든 업무, 실패하면 null */
      result: AiToolExecutionResult | null;
      /** 실행 시도 횟수. 일시 오류(연결·잠금 시간 초과)면 같은 내용으로 2번까지 다시 해 최대 3 */
      attempts: number;
    }
  | { type: 'done'; reply: AiAssistantReplyView }
  | { type: 'error'; message: string };

/** 역할별 추천 질문과 처음 쓰는 사용자용 질문 (REQ-AST-008) */
export interface AiAssistantSuggestedQuestionsView {
  roleCode: Role;
  roleQuestions: string[];
  firstTimeQuestions: string[];
}
