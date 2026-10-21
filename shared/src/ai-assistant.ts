// AI 어시스턴트 (REQ-AST, BP-AST-01, API-262·263). 업무 지식(용어 사전)과 데이터 조회(REQ-AST-004)를 답하고, 실행이 필요한 요청은 실행 카드(REQ-AST-005)로 보여 준다.
import type { Role } from './codes';
import type { MeetingCandidate, MeetingCandidateUpdateInput } from './meeting-minutes';
import type { AiScreenMapEntry, AiScreenTool } from './ai-screen-control';
import type { AiResearchSeed } from './ai-research';

/** 지난 대화 한 줄. 저장한 대화(threadId)면 서버가 DB에서 읽고, 아니면 화면이 최근 것을 함께 보낸다 (회의 질문) */
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
  /**
   * 이어 묻는 저장한 대화 id (문서에 없는 기능, 이슈 #399). 내 대화만. 있으면 지난 대화를 DB에서 읽고 history는 쓰지 않는다.
   * 실시간 답 API(messages/stream)에서만 저장한다
   */
  threadId?: number;
  /** true면 답이 끝났을 때 질문과 답을 저장한다 (threadId가 없으면 새 대화). 철강맨AI 패널만 보낸다 (이슈 #399) */
  saveThread?: boolean;
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
   * 브라우저 도구(browser_open·browser_snapshot·browser_click·browser_type·browser_scroll·browser_back·browser_read_file)를 모델에 알린다. 기본은 꺼짐
   */
  browser?: boolean;
  /**
   * 화면이 대화마다 만드는 열쇠(UUID). 같은 열쇠의 다음 질문은 열어 둔 브라우저 탭을 이어 쓴다 (이슈 #423).
   * 서버는 사원 번호와 묶어 쓰므로 남의 열쇠를 보내도 남의 탭은 쓰지 않는다
   */
  browserSessionId?: string;
  /**
   * 답마다 화면이 만드는 열쇠(UUID). 답하는 동안 POST /ai-assistant/agent-control/:agentControlId로
   * 브라우저·화면 조작을 멈추고 한 단계씩 넘기고 이어 가게 한다 (이슈 #425). 서버는 사원 번호와 묶어 쓴다
   */
  agentControlId?: string;
  /**
   * 화면 조작을 켠 질문이면 true (문서에 없는 기능, 이슈 #382, 시험 중). 서버에서 AI_SCREEN_CONTROL_ENABLED=true이고 실시간 답 API일 때만
   * 화면 도구(ui_snapshot·ui_navigate·ui_click·ui_fill·ui_select)를 모델에 알린다. 동작은 사용자의 브라우저가 한다
   */
  screenControl?: boolean;
  /** 화면 조작 때 열 수 있는 화면(이 사원의 레일 메뉴). ui_navigate는 이 주소만 연다 */
  screenMap?: AiScreenMapEntry[];
  /**
   * Notion을 켠 질문이면 true (문서에 없는 기능, 이슈 #398). Notion이 연결돼 있고 상위 페이지가 정해져 있고 실시간 답 API일 때만
   * Notion 도구(notion_search·notion_read_page, 실행 카드를 받는 화면이면 propose_notion_page)를 모델에 알린다. 기본은 꺼짐
   */
  notion?: boolean;
  /**
   * Drive를 켠 질문이면 true (문서에 없는 기능, 이슈 #398 2단계). Drive가 연결돼 있고 폴더가 정해져 있고 실시간 답 API일 때만
   * Drive 도구(drive_search·drive_read_file)를 모델에 알린다. 기본은 꺼짐
   */
  drive?: boolean;
  /**
   * 입력칸에서 @로 고른 Drive 파일 id (이슈 #398 2단계, AI_DRIVE_ATTACH_MAX개까지). Drive 칩과 상관없이 서버가 읽어 이 질문에 글(또는 사진)로 붙인다.
   * 실시간 답 API에서만 쓴다. 지난 대화에는 남지 않는다
   */
  driveFileIds?: string[];
}

/** 질문 하나에 @로 붙이는 Drive 파일 수 (가정값) */
export const AI_DRIVE_ATTACH_MAX = 3;

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
  /** ERP 화면 조작을 쓸 수 있는지 (이슈 #382). 서버 AI_SCREEN_CONTROL_ENABLED=true일 때 */
  screenControl: { available: boolean };
  /** Notion을 쓸 수 있는지 (이슈 #398). Notion이 연결돼 있고 관리자가 상위 페이지를 정했을 때 */
  notion: AiNotionCapabilities;
  /** Drive 도구를 쓸 수 있는지 (이슈 #398 2단계). Drive가 연결돼 있고(서비스 계정 또는 OAuth) 폴더가 정해졌을 때 */
  drive: AiNotionCapabilities;
}

export interface AiNotionCapabilities {
  available: boolean;
  /** 쓸 수 없을 때 화면에 보일 이유 (예: 관리자가 Notion 상위 페이지를 정하지 않았어요) */
  reason?: string;
}

export interface AiBrowserCapabilities {
  available: boolean;
  /** 쓸 수 없을 때 화면에 보일 이유 (예: 서버에서 꺼 두었어요) */
  reason?: string;
  /** 한 답에서 세는 브라우저 동작 수 상한 (이슈 #430). 화면 읽기·실패한 동작은 세지 않는다. 화면의 'n/상한'에 쓴다 */
  maxActions?: number;
  /** 관리자가 '모든 사이트 열기'를 켰는지 (이슈 #430). 켜면 목록 밖 주소도 연다 */
  openAllSites?: boolean;
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
  get_quality_reject_rate: '강종별 불합격률 조회',
  get_purchase_requisitions: '구매요청 조회',
  get_purchase_orders: '발주 조회',
  get_goods_receipts: '입고 조회',
  get_mrp_requirements: 'MRP 원료 소요 조회',
  get_shipment_requests: '출하요청 조회',
  get_mill_sheets: '밀시트 조회',
  get_dashboard_summary: '대시보드 현황 조회',
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
  browser_read_file: '브라우저 문서 읽기',
  ui_snapshot: '화면 읽기',
  ui_navigate: '화면 열기',
  ui_click: '화면 누르기',
  ui_fill: '화면 입력',
  ui_select: '화면 고르기',
  notion_search: 'Notion 검색',
  notion_read_page: 'Notion 페이지 읽기',
  drive_search: 'Drive 파일 찾기',
  drive_read_file: 'Drive 파일 읽기',
  get_my_schedule: '내 일정 조회',
  get_my_tasks: '내 업무 조회',
  search_chat_history: '지난 대화 찾기',
  search_room_messages: '지난 메시지 찾기',
};

/** 웹 도구 (이슈 #367). 조회 도구처럼 묻지 않고 실행하지만, 웹 검색을 켠 실시간 답에서만 알린다 */
export const AI_ASSISTANT_WEB_TOOLS = ['web_search', 'search_places', 'read_web_page'] as const;
export type AiAssistantWebTool = (typeof AI_ASSISTANT_WEB_TOOLS)[number];

export const isAiAssistantWebTool = (name: string): name is AiAssistantWebTool => (AI_ASSISTANT_WEB_TOOLS as readonly string[]).includes(name);

/** 브라우저 도구 (이슈 #373). 브라우저 사용을 켠 실시간 답에서만 알린다. 로그인·결제·삭제·개인정보 입력은 서버가 막는다 */
export const AI_ASSISTANT_BROWSER_TOOLS = ['browser_open', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_scroll', 'browser_back', 'browser_read_file'] as const;
export type AiAssistantBrowserTool = (typeof AI_ASSISTANT_BROWSER_TOOLS)[number];

export const isAiAssistantBrowserTool = (name: string): name is AiAssistantBrowserTool => (AI_ASSISTANT_BROWSER_TOOLS as readonly string[]).includes(name);

/** Notion 읽기 도구 (이슈 #398). Notion을 켠 실시간 답에서만 알린다. 쓰기는 실행 카드(propose_notion_page)로만 한다 */
export const AI_ASSISTANT_NOTION_TOOLS = ['notion_search', 'notion_read_page'] as const;
export type AiAssistantNotionTool = (typeof AI_ASSISTANT_NOTION_TOOLS)[number];

export const isAiAssistantNotionTool = (name: string): name is AiAssistantNotionTool => (AI_ASSISTANT_NOTION_TOOLS as readonly string[]).includes(name);

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
  /** 실행 카드(REQ-AST-005). 사용자가 확인해 실행을 누를 때만 업무에 반영한다. 철강맨AI 패널 대화면 대화 기록에 함께 저장한다 (이슈 #399) */
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

/** 카드가 가리키는 Notion 페이지. id는 대시 없는 32자리 16진수 */
export interface AiNotionPageRef {
  id: string;
  title: string;
  url: string;
}

/** Notion 페이지 고치기 한 군데: 페이지 글에서 oldStr을 찾아 newStr로 바꾼다 */
export interface AiNotionTextEdit {
  oldStr: string;
  newStr: string;
}

/**
 * Notion 실행 카드 공통 (이슈 #398). nonce는 서버가 카드마다 만든 값으로, 같은 카드를 두 번 실행하지 않게 실행 요청에 그대로 보낸다.
 * 대상은 관리자가 정한 상위 페이지 아래(그 페이지 포함)만 되고, ERP가 채우는 일정·회의록·할 일 데이터베이스와 그 행은 안 된다.
 */
interface AiNotionCardBase {
  key: string;
  title: string;
  nonce: string;
  issues: string[];
}

/** 새 Notion 페이지 만들기. parent 아래에 만든다 */
export interface AiNotionCreateCard extends AiNotionCardBase {
  kind: 'NOTION_PAGE_CREATE';
  parent: AiNotionPageRef;
  pageTitle: string;
  /** Notion 마크다운. 제목은 넣지 않는다 */
  content: string;
}

/** 있는 Notion 페이지 끝에 글 더하기 */
export interface AiNotionAppendCard extends AiNotionCardBase {
  kind: 'NOTION_PAGE_APPEND';
  page: AiNotionPageRef;
  content: string;
}

/** 있는 Notion 페이지의 글 일부 바꾸기·제목 바꾸기. 페이지 전체를 덮어쓰거나 하위 페이지를 지우지 않는다 */
export interface AiNotionUpdateCard extends AiNotionCardBase {
  kind: 'NOTION_PAGE_UPDATE';
  page: AiNotionPageRef;
  /** 바꿀 제목. 그대로면 null */
  newTitle: string | null;
  edits: AiNotionTextEdit[];
}

export type AiNotionCard = AiNotionCreateCard | AiNotionAppendCard | AiNotionUpdateCard;

/** Notion 카드 글 상한 (가정값). 작은 모델이 한 번에 쓰는 양보다 넉넉하고, 사용자가 카드에서 읽을 수 있는 정도 */
export const AI_NOTION_TITLE_MAX = 200;
export const AI_NOTION_CONTENT_MAX = 20_000;
export const AI_NOTION_EDIT_MAX = 10;
export const AI_NOTION_EDIT_TEXT_MAX = 4000;

/** 일정 고치기 카드 (ScheduleEventService.update). 내가 직접 등록한 일정만, 회의록에서 만든 일정은 안 된다 */
export interface AiScheduleEventUpdateCard {
  key: string;
  kind: 'SCHEDULE_EVENT_UPDATE';
  title: string;
  scheduleEventId: number;
  before: { scheduleEventTitle: string; scheduleEventDescription: string | null; startAt: string; endAt: string };
  scheduleEventTitle: string;
  scheduleEventDescription: string | null;
  /** +09:00 ISO */
  startAt: string;
  endAt: string;
  issues: string[];
}

/** 업무 고치기·완료 카드 (TaskService.update·complete). 진행 중인 업무만, 고치기는 등록자·담당자, 완료는 담당자만 */
export interface AiTaskUpdateCard {
  key: string;
  kind: 'TASK_UPDATE';
  title: string;
  taskId: number;
  before: { taskTitle: string; taskDescription: string | null; dueDate: string };
  taskTitle: string;
  taskDescription: string | null;
  /** YYYY-MM-DD */
  dueDate: string;
  /** true면 내용은 그대로 두고 완료로 바꾼다 */
  complete: boolean;
  issues: string[];
}

/**
 * 심층 조사 만들기 카드 (이슈 #408). 대화에서 "심층 조사해 줘"라고 하면 AI가 만든다. 사용자가 질문을 확인하고 [실행]을 눌러야 조사를 만든다.
 * 바로 앞(또는 이 답)의 웹 검색 결과를 함께 넘길지는 화면이 정한다(seed).
 */
export interface AiResearchCard {
  key: string;
  kind: 'RESEARCH';
  title: string;
  /** 조사 질문 (카드에서 고칠 수 있다) */
  question: string;
  issues: string[];
}

/** 실행 카드 한 장 (REQ-AST-005). 종류는 kind로 가른다 */
export type AiActionCard = AiWorkCard | AiSalesOrderCard | AiHotRollingCard | AiHeatPlanCard | AiPastCaseCard | AiNotionCard | AiScheduleEventUpdateCard | AiTaskUpdateCard | AiResearchCard;
export type AiActionCardKind = AiActionCard['kind'];

/** POST ai-assistant/action-cards/execute. 카드에서 사용자가 확인·수정한 값을 그대로 보낸다 (서버가 다시 검증한다) */
export type AiActionCardExecuteInput =
  | AiWorkCardExecuteInput
  | { kind: 'SALES_ORDER'; customerId?: number; lines: { itemId?: number; orderedQty?: number; dueDate?: string }[] }
  | { kind: 'HOT_ROLLING'; productionPlanId: number; lotIds: number[] }
  | { kind: 'HEAT_PLAN'; productionPlanId: number }
  | { kind: 'PAST_CASE'; lotId: number; caseCategory: 'QUALITY' | 'EQUIPMENT'; title: string; phenomenon: string; cause: string; actionTaken: string; equipmentText: string; occurredDate: string }
  | { kind: 'NOTION_PAGE_CREATE'; nonce: string; notionPageId: string; pageTitle: string; content: string }
  | { kind: 'NOTION_PAGE_APPEND'; nonce: string; notionPageId: string; content: string }
  | { kind: 'NOTION_PAGE_UPDATE'; nonce: string; notionPageId: string; pageTitle?: string; edits: AiNotionTextEdit[] }
  | { kind: 'SCHEDULE_EVENT_UPDATE'; scheduleEventId: number; title: string; description: string | null; startAt: string; endAt: string }
  | { kind: 'TASK_UPDATE'; taskId: number; title?: string; description?: string | null; dueDate?: string; complete?: boolean }
  | { kind: 'RESEARCH'; question: string; seed?: AiResearchSeed };

/** 실행 요청 본문: 카드 값 + 저장한 대화의 카드 자리 (있으면 실행 뒤 그 카드를 done으로, 이슈 #399) */
export type AiActionCardExecuteRequest = AiActionCardExecuteInput & { chat?: AiChatCardRef };

export interface AiWorkCardExecuteInput extends Omit<MeetingCandidateUpdateInput, 'decision'> {
  kind: AiWorkCard['kind'];
  /** 비어 있는 칸(아직 정하지 않은 값)은 보내지 않는다. 필수 칸이 비면 서버가 ACT-001로 거절한다 */
  title: string;
}

/** 카드를 실행해 만든 것. 구매요청은 바로 만들지 않고 초안(확인 대기)으로 만든다 */
export interface AiActionCardExecuteResult {
  kind: AiActionCardKind;
  registered: {
    type: 'task' | 'schedule_event' | 'action_draft' | 'sales_order' | 'hot_rolling' | 'heat_plan' | 'past_case' | 'notion_page' | 'research';
    /** ERP 행 id. Notion 페이지는 ERP 행이 없어 0 */
    id: number;
    /** 번호가 있는 것 (수주번호·생산계획 번호·사례 번호) */
    no?: string;
    /** Notion 페이지 주소 (notion_page) */
    url?: string;
    /** 일정·업무를 고쳤으면 true (새로 만든 것이 아님) */
    updated?: boolean;
    /** 외부 서비스가 함께 알린 말 (예: Notion이 찾지 못한 고칠 곳) */
    note?: string;
  };
}

/**
 * 답을 만드는 과정의 실시간 이벤트 (POST /ai-assistant/messages/stream, 한 줄에 JSON 하나).
 * - thinking·answer: 글 조각. answer는 출처 표시를 지우기 전 원문이라, done의 reply.answer로 바꿔 보인다
 * - 한 차례에서 answer 조각 뒤에 tool_start가 오면 그 글은 최종 답이 아니라 도구를 부르기 전의 중간 글이다
 * - 웹 도구(이슈 #367)는 조회 도구와 같은 tool_start → tool_end이고, tool_end.webSources에 찾은·읽은 페이지가 온다.
 *   답에 쓴 웹 출처는 done의 reply.webSources
 * - browser_frame: 브라우저 도구(열기·누르기·입력·스크롤·뒤로) 뒤의 화면 사진 (이슈 #373). 모델에는 보내지 않고 화면에만 보인다
 * - browser_live: 답하는 동안 브라우저 화면을 초당 2장쯤 계속 보낸다 (이슈 #425). browser_frame과 달리 답에 남기지 않는다
 * - agent_paused·agent_resumed: 사용자가 멈춘 답이 다음 브라우저·화면 동작(tool) 앞에서 기다리기 시작했을 때·다시 갈 때 (이슈 #425)
 * - user_note: 사용자가 작업 중에 덧붙인 말을 모델에 넘겼을 때 (이슈 #430)
 * - ui_action: 화면 조작 (이슈 #382). 사용자의 브라우저가 지금 화면에서 실행하고 POST /ai-assistant/ui-actions/:actionId로 결과를 돌려준다.
 *   같은 도구의 tool_start 뒤, tool_end 앞에 온다
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
  | {
      type: 'browser_live';
      /** 호스트 + 경로 (쿼리·#조각 없음) */
      url: string;
      /** JPEG base64 (너비 800 이하), data: 접두어 없음 */
      imageBase64: string;
      at: string;
    }
  | { type: 'agent_paused'; tool: string }
  | { type: 'agent_resumed' }
  | { type: 'user_note'; text: string }
  | { type: 'ui_action'; actionId: string; tool: AiScreenTool; args: Record<string, string> }
  /** thread: 저장을 요청한 질문이면 저장한 대화, 저장에 실패했으면 null (이슈 #399) */
  | { type: 'done'; reply: AiAssistantReplyView; thread?: AiChatThreadRef | null }
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

// ── 저장한 대화 (문서에 없는 기능, 이슈 #399) ─────────────────────────────

/** 대화 제목: 첫 질문 앞 몇 자 */
export const AI_CHAT_TITLE_MAX = 40;

/** 대화 목록 한 줄 (GET ai-assistant/threads) */
export interface AiChatThreadSummaryView {
  id: number;
  title: string;
  createdAt: string;
  /** 마지막으로 묻고 답한 시각. 목록은 이것이 최근인 순서 */
  updatedAt: string;
}

/** 저장한 실행 카드. 실행하면 done과 만든 것. 닫은 카드는 저장하지 않는다 */
export interface AiChatSavedCard {
  card: AiActionCard;
  status: 'ready' | 'done';
  result?: AiActionCardExecuteResult['registered'];
}

/** 저장한 질문·답 한 줄. 생각 글·도구 기록·사진·브라우저 화면 사진은 저장하지 않는다 */
export type AiChatMessageView =
  | {
      id: number;
      seq: number;
      role: 'user';
      content: string;
      createdAt: string;
      reasoning?: AiReasoningLevel;
      webSearch?: boolean;
      browser?: boolean;
      /** 함께 보낸 사진 수 (사진은 저장하지 않는다) */
      imageCount?: number;
      /** 입력칸 @로 붙인 Drive 파일 이름 (이슈 #398. 파일 글은 저장하지 않는다) */
      driveFiles?: string[];
      /** 답하는 중에 덧붙인 말 (이슈 #430) */
      notes?: string[];
    }
  | {
      id: number;
      seq: number;
      role: 'assistant';
      content: string;
      createdAt: string;
      sources: AiAssistantSource[];
      webSources?: AiWebSource[];
      actionCards: AiChatSavedCard[];
      /** 질문에 보낸 생각 정도와 모델에 보냈는지 (질문에 생각 정도를 보냈을 때만) */
      reasoning?: AiReasoningLevel;
      reasoningApplied?: boolean;
    };

/** 대화 하나 (GET ai-assistant/threads/:id). 메시지는 순번 순서 */
export interface AiChatThreadView extends AiChatThreadSummaryView {
  messages: AiChatMessageView[];
}

/** 질문과 답을 저장한 뒤 done 이벤트에 담는 것. assistantMessageId는 카드를 실행할 때 보낸다 */
export interface AiChatThreadRef {
  id: number;
  title: string;
  assistantMessageId: number;
}

/** 실행 카드를 실행할 때 함께 보내는 저장한 카드 자리. 실행하면 서버가 그 카드를 done으로 바꾼다 */
export interface AiChatCardRef {
  messageId: number;
  cardKey: string;
}

/** 답하는 동안 브라우저·화면 조작을 다루는 명령 (이슈 #425). pause: 다음 동작 앞에서 멈춤, step: 하나만 하고 다시 멈춤, resume: 이어 가기 */
export const AI_AGENT_CONTROL_COMMANDS = ['pause', 'step', 'resume'] as const;
export type AiAgentControlCommand = (typeof AI_AGENT_CONTROL_COMMANDS)[number];

export interface AiAgentControlInput {
  command: AiAgentControlCommand;
}

/** 답하는 중에 덧붙이는 말 (이슈 #430). 한 답에 받는 수와 한 번의 길이 상한 (가정값) */
export const AI_AGENT_NOTES_MAX = 5;
export const AI_AGENT_NOTE_MAX_CHARS = 500;

export interface AiAgentNoteInput {
  text: string;
}

/** 멈춰 둘 수 있는 시간. 넘으면 그 답은 브라우저·화면 조작을 그만두고 지금까지 본 것으로 답한다 (가정값, 이슈 #425) */
export const AI_AGENT_PAUSE_MAX_MS = 10 * 60_000;
