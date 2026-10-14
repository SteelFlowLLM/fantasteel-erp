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
  /** 오래된 것부터. 서버는 최근 몇 개만 쓴다 */
  history?: AiAssistantTurn[];
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

export interface AiAssistantReplyView {
  answer: string;
  sources: AiAssistantSource[];
  /** 답한 모델 id */
  model: string;
  latencyMs: number;
}

/** 역할별 추천 질문과 처음 쓰는 사용자용 질문 (REQ-AST-008) */
export interface AiAssistantSuggestedQuestionsView {
  roleCode: Role;
  roleQuestions: string[];
  firstTimeQuestions: string[];
}
