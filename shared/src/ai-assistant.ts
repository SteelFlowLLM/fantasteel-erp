// AI 어시스턴트 (REQ-AST, BP-AST-01, API-262·263). 업무 지식(용어 사전)과 데이터 조회(REQ-AST-004)를 답한다. 실행 카드는 아직 없다.
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
};

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
}

/**
 * 답을 만드는 과정의 실시간 이벤트 (POST /ai-assistant/messages/stream, 한 줄에 JSON 하나).
 * - thinking·answer: 글 조각. answer는 출처 표시를 지우기 전 원문이라, done의 reply.answer로 바꿔 보인다
 * - 한 차례에서 answer 조각 뒤에 tool_start가 오면 그 글은 최종 답이 아니라 도구를 부르기 전의 중간 글이다
 * - 마지막은 done 또는 error 하나
 */
export type AiAssistantStreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'answer'; text: string }
  | { type: 'tool_start'; id: string; name: string; arguments: string }
  | { type: 'tool_end'; id: string; label: string | null; resultPreview: string; durationMs: number }
  | { type: 'done'; reply: AiAssistantReplyView }
  | { type: 'error'; message: string };

/** 역할별 추천 질문과 처음 쓰는 사용자용 질문 (REQ-AST-008) */
export interface AiAssistantSuggestedQuestionsView {
  roleCode: Role;
  roleQuestions: string[];
  firstTimeQuestions: string[];
}
