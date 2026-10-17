// AI 어시스턴트 (REQ-AST, BP-AST-01, API-262·263). 업무 지식(용어 사전)과 데이터 조회(REQ-AST-004)를 답하고, 실행이 필요한 요청은 실행 카드(REQ-AST-005)로 보여 준다.
import type { Role } from './codes';
import type { MeetingCandidate, MeetingCandidateUpdateInput } from './meeting-minutes';

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
  /** 심층 조사 보고서에 대해 묻는 질문이면 그 조사 id (내 조사만). 서버가 보고서·출처 목록을 참고 자료로 넣는다 (이슈 #384) */
  researchRunId?: number;
  /** true면 실행이 필요한 요청을 실행 카드로 만들어 답에 담는다 (철강맨AI 패널만 보낸다) */
  actionCards?: boolean;
  /** 오래된 것부터. 서버는 최근 몇 개만 쓴다 */
  history?: AiAssistantTurn[];
  /** 생각 정도 (문서에 없는 기능, 2026-10-16 추가). 없으면 서버 기본값(보통) */
  reasoning?: AiReasoningLevel;
  /** 질문과 함께 보는 사진 (문서에 없는 기능, 2026-10-16 추가). 사진을 볼 수 있는 모델일 때만. 지난 대화에는 남기지 않는다 */
  images?: AiAssistantImageInput[];
  /**
   * 웹 검색을 켠 질문이면 true (문서에 없는 기능, 이슈 #367). 실시간 답 API(messages/stream)에서만 웹 도구
   * (web_search·read_web_page, 카카오 키가 있으면 search_places)를 모델에 알린다. 사내 채팅 @AI(API-262)는 쓰지 않는다
   */
  webSearch?: boolean;
  /**
   * 브라우저 사용을 켠 질문이면 true (문서에 없는 기능, 이슈 #373). 서버에서 AI_BROWSER_ENABLED=true이고 실시간 답 API일 때만
   * 브라우저 도구(browser_open·browser_snapshot·browser_click·browser_type·browser_scroll·browser_back)를 모델에 알린다. 기본은 꺼짐
   */
  browser?: boolean;
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
  /** 브라우저 사용을 쓸 수 있는지 (이슈 #373). 서버 설정과 Chrome이 있는지로 정한다(Chrome을 띄워 보지는 않는다) */
  browser: AiBrowserCapabilities;
  /** 심층 조사를 쓸 수 있는지 (이슈 #378). LLM 모델이 정해져 있으면 쓸 수 있다 */
  deepResearch: { available: boolean };
}

export interface AiBrowserCapabilities {
  available: boolean;
  /** 쓸 수 없을 때 화면에 보일 이유 (예: 서버에서 꺼 두었어요) */
  reason?: string;
}

/** 웹 검색 엔진: 네이버 검색 API → 다음(카카오) 웹 검색(각각 키가 있을 때) → DuckDuckGo HTML → 위키백과 순으로 쓴다 */
export const AI_WEB_SEARCH_ENGINES = ['naver', 'kakao', 'duckduckgo', 'wikipedia'] as const;
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
  web_search: '웹 검색',
  search_places: '장소 검색',
  read_web_page: '웹 페이지 읽기',
  browser_open: '브라우저 열기',
  browser_snapshot: '브라우저 화면 읽기',
  browser_click: '브라우저 누르기',
  browser_type: '브라우저 입력',
  browser_scroll: '브라우저 스크롤',
  browser_back: '브라우저 뒤로',
};

/** 웹 도구 (이슈 #367). 조회 도구처럼 묻지 않고 실행하지만, 웹 검색을 켠 실시간 답에서만 알린다 */
export const AI_ASSISTANT_WEB_TOOLS = ['web_search', 'search_places', 'read_web_page'] as const;
export type AiAssistantWebTool = (typeof AI_ASSISTANT_WEB_TOOLS)[number];

export const isAiAssistantWebTool = (name: string): name is AiAssistantWebTool => (AI_ASSISTANT_WEB_TOOLS as readonly string[]).includes(name);

/** 브라우저 도구 (이슈 #373). 브라우저 사용을 켠 실시간 답에서만 알린다. 로그인·결제·삭제·개인정보 입력은 서버가 막는다 */
export const AI_ASSISTANT_BROWSER_TOOLS = ['browser_open', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_scroll', 'browser_back'] as const;
export type AiAssistantBrowserTool = (typeof AI_ASSISTANT_BROWSER_TOOLS)[number];

export const isAiAssistantBrowserTool = (name: string): name is AiAssistantBrowserTool => (AI_ASSISTANT_BROWSER_TOOLS as readonly string[]).includes(name);

/** 웹 도구가 찾거나 읽은 페이지 하나. url은 검색 결과에 있던 주소(읽은 페이지면 이동 뒤 최종 주소) */
export interface AiWebSource {
  title: string;
  url: string;
}

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
  /** 실행 카드(REQ-AST-005). 서버는 저장하지 않고, 사용자가 확인해 실행을 누를 때만 업무에 반영한다 */
  actionCards: AiActionCard[];
  /**
   * 웹 출처 (이슈 #367). 웹 검색을 켠 질문에만 있다. 답이 링크로 단 검색 결과와 읽은 페이지 순서이고,
   * 둘 다 없으면 검색 결과 앞의 3개. 답 본문의 링크는 이 질문의 웹 도구 결과에 있던 주소만 남는다
   */
  webSources?: AiWebSource[];
}

/**
 * 업무·일정·구매요청 카드. 회의록 등록 후보(MeetingCandidate)와 같은 칸·같은 규칙이다: 업무(TASK)·일정(EVENT)·구매요청 초안(PURCHASE).
 * key는 한 답 안에서 카드를 가르는 'a1', 'a2' …. 사원·품목 id는 모델이 아니라 서버가 DB에서 맞춘 값이다.
 */
export type AiWorkCard = Pick<
  MeetingCandidate,
  'key' | 'kind' | 'title' | 'description' | 'assigneeId' | 'assigneeName' | 'dueDate' | 'startAt' | 'endAt' | 'endAssumed' | 'attendeeIds' | 'purchase' | 'itemName' | 'issues'
>;

/** 수주 등록 카드의 품목 한 줄. 못 맞춘 칸은 null이고 카드의 issues로 알린다 */
export interface AiSalesOrderCardLine {
  itemId: number | null;
  /** 규격 코드 · 품목 이름 (itemId가 없으면 모델이 말한 규격 그대로) */
  itemLabel: string | null;
  orderedQty: number | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
}

/** 수주 등록 카드 (SalesOrderService.create). 예약·부족분 생산계획은 실행할 때 기존 수주 등록 로직이 한다 */
export interface AiSalesOrderCard {
  key: string;
  kind: 'SALES_ORDER';
  title: string;
  customerId: number | null;
  customerName: string | null;
  lines: AiSalesOrderCardLine[];
  issues: string[];
}

/** 열연 배정 카드 (HotRollingService.confirm). 슬래브는 FIFO 추천 순서이고 서버가 저장하지 않고 보여 주기만 한다 */
export interface AiHotRollingCard {
  key: string;
  kind: 'HOT_ROLLING';
  title: string;
  productionPlanId: number;
  productionPlanNo: string;
  itemLabel: string;
  neededQty: number;
  availableQty: number;
  lots: { lotId: number; lotNo: string; producedDate: string | null; heatNo: string | null }[];
  issues: string[];
}

/** 히트 편성 확정 카드 (ProductionService.confirmHeatPlan) */
export interface AiHeatPlanCard {
  key: string;
  kind: 'HEAT_PLAN';
  title: string;
  productionPlanId: number;
  productionPlanNo: string;
  itemLabel: string;
  shortageQty: number;
  currentHeatCount: number;
  newHeatCount: number;
  /** 소수 3자리 문자열 */
  heatTon: string;
  requiredMoltenSteelTon: string;
  issues: string[];
}

/** 과거 사례 등록 카드 (PastCaseService.createDraft → create). 불합격 LOT의 초안을 사용자가 고쳐 등록한다 */
export interface AiPastCaseCard {
  key: string;
  kind: 'PAST_CASE';
  title: string;
  lotId: number;
  lotNo: string;
  caseCategory: 'QUALITY' | 'EQUIPMENT';
  phenomenon: string;
  cause: string;
  actionTaken: string;
  equipmentText: string;
  /** YYYY-MM-DD */
  occurredDate: string;
  aiWritten: boolean;
  referenceCaseNos: string[];
  issues: string[];
}

/** 실행 카드 한 장 (REQ-AST-005). 종류는 kind로 가른다 */
export type AiActionCard = AiWorkCard | AiSalesOrderCard | AiHotRollingCard | AiHeatPlanCard | AiPastCaseCard;
export type AiActionCardKind = AiActionCard['kind'];

/** POST ai-assistant/action-cards/execute. 카드에서 사용자가 확인·수정한 값을 그대로 보낸다 (서버가 다시 검증한다) */
export type AiActionCardExecuteInput =
  | AiWorkCardExecuteInput
  | { kind: 'SALES_ORDER'; customerId?: number; lines: { itemId?: number; orderedQty?: number; dueDate?: string }[] }
  | { kind: 'HOT_ROLLING'; productionPlanId: number; lotIds: number[] }
  | { kind: 'HEAT_PLAN'; productionPlanId: number }
  | { kind: 'PAST_CASE'; lotId: number; caseCategory: 'QUALITY' | 'EQUIPMENT'; title: string; phenomenon: string; cause: string; actionTaken: string; equipmentText: string; occurredDate: string };

export interface AiWorkCardExecuteInput extends Omit<MeetingCandidateUpdateInput, 'decision'> {
  kind: AiWorkCard['kind'];
  /** 비어 있는 칸(아직 정하지 않은 값)은 보내지 않는다. 필수 칸이 비면 서버가 ACT-001로 거절한다 */
  title: string;
}

/** 카드를 실행해 만든 것. 구매요청은 바로 만들지 않고 초안(확인 대기)으로 만든다 */
export interface AiActionCardExecuteResult {
  kind: AiActionCardKind;
  registered: {
    type: 'task' | 'schedule_event' | 'action_draft' | 'sales_order' | 'hot_rolling' | 'heat_plan' | 'past_case';
    id: number;
    /** 번호가 있는 것 (수주번호·생산계획 번호·사례 번호) */
    no?: string;
  };
}

/**
 * 답을 만드는 과정의 실시간 이벤트 (POST /ai-assistant/messages/stream, 한 줄에 JSON 하나).
 * - thinking·answer: 글 조각. answer는 출처 표시를 지우기 전 원문이라, done의 reply.answer로 바꿔 보인다
 * - 한 차례에서 answer 조각 뒤에 tool_start가 오면 그 글은 최종 답이 아니라 도구를 부르기 전의 중간 글이다
 * - 웹 도구(이슈 #367)는 조회 도구와 같은 tool_start → tool_end이고, tool_end.webSources에 찾은·읽은 페이지가 온다.
 *   답에 쓴 웹 출처는 done의 reply.webSources
 * - browser_frame: 브라우저 도구(열기·누르기·입력·스크롤·뒤로) 뒤의 화면 사진 (이슈 #373). 모델에는 보내지 않고 화면에만 보인다
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
      type: 'browser_frame';
      /** 호스트 + 경로 (쿼리·#조각 없음) */
      url: string;
      /** 페이지 제목. 웹에서 온 글이라 글로만 그린다 */
      title: string;
      /** JPEG(품질 50쯤, 너비 800 이하) base64, data: 접두어 없음 */
      imageBase64: string;
      /** 찍은 때 (ISO 8601) */
      at: string;
    }
  | { type: 'done'; reply: AiAssistantReplyView }
  | { type: 'error'; message: string };

/** 역할별 추천 질문과 처음 쓰는 사용자용 질문 (REQ-AST-008) */
export interface AiAssistantSuggestedQuestionsView {
  roleCode: Role;
  roleQuestions: string[];
  firstTimeQuestions: string[];
  /** 내 권한으로 실행 카드를 만들 수 있는 요청 예시 (REQ-AST-005). 화면이 입력칸에 채워 주고 사용자가 고쳐서 보낸다 */
  actionCardExamples: AiActionCardExample[];
}

export interface AiActionCardExample {
  kind: AiActionCardKind;
  /** 칩에 보일 짧은 이름 (예: 수주 등록) */
  label: string;
  /** 입력칸에 채울 요청 문장. ○○는 사용자가 채울 자리 */
  text: string;
}
