import type { ActionType, AuthUser, Permission } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';

/** 초안을 확정하는 주체. Message → ERP 구매요청은 요청자(원본 메시지 작성자)다 (REQ-ACT-003). */
export type ActionConfirmer = 'REQUESTER';

/** 실행 핸들러가 보는 초안 */
export interface ActionDraftForExecution {
  id: number;
  messageId: number | null;
  payload: unknown;
}

/** 실행 결과. 유형마다 만든 문서의 id·번호를 넣는다. */
export type ActionExecutionResult = Record<string, string | number | null>;

/**
 * 업무 유형 정의 (REQ-ACT-004, 업무 프로세스 정의서 12.3).
 * 유형을 추가하려면 이 인터페이스를 구현한 정의 1개와 그 업무 모듈의 실행 핸들러 1개를 만들어 ACTION_DEFINITIONS에 넣는다.
 * 초안의 생성·수정·확정·반려 흐름(ActionDraftService)은 유형을 모른다.
 */
export interface ActionDefinition {
  type: ActionType;
  label: string;
  confirmer: ActionConfirmer;
  /** 초안을 만들거나 확정하는 사람에게 필요한 시스템 권한 (USE) */
  requiredPermission: Permission;
  /** 필드 이름 → 화면 표시명 (미확정 필드 안내에 쓴다) */
  fieldLabels: Record<string, string>;
  /** 새 초안의 payload. v2는 AI 추출이 없어 값이 비어 있다 (SPEC 9장 #2). 추출기를 붙일 때 이 자리를 채운다. */
  initialPayload(requesterId: number): Record<string, unknown>;
  /** 요청자가 고친 값을 검증해 payload에 반영한다. 값이 틀리면 COM-003. */
  applyPatch(tx: Tx, payload: unknown, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** 아직 확정할 수 없는 필드 목록 (비어 있거나 현재 기준정보와 맞지 않는 값). 비어 있어야 확정할 수 있다. */
  validate(tx: Tx, payload: unknown): Promise<string[]>;
  /** 확정된 초안을 ERP 데이터로 만든다. 업무 모듈의 검증·권한을 그대로 거친다. */
  execute(tx: Tx, draft: ActionDraftForExecution, actor: AuthUser): Promise<ActionExecutionResult>;
}

/** 등록할 업무 유형 정의 목록의 주입 토큰 */
export const ACTION_DEFINITIONS = Symbol('ACTION_DEFINITIONS');
