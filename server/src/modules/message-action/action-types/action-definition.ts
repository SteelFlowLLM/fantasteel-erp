// 업무 유형 등록부의 한 유형 (REQ-ACT-004, 업무 프로세스 12.3·BP-ACT-02).
// 유형마다 추출 스키마(payload)·검증·확정 주체·실행 핸들러를 둔다. 유형을 더할 때는 정의 하나를 만들어 등록부(action-type.registry.ts)에 넣는다.
import type { ActionDraftPayload, ActionDraftResultView, ActionType, AuthUser, Permission } from '@fantasteel/shared';
import type { Tx } from '../../../prisma/prisma.service';
import type { DraftRow } from '../message-action.repository';

/** 확정 주체: 메시지 작성자(구매요청, BP-ACT-01) 또는 초안을 만든 사원(확장 유형, BP-ACT-02) */
export type DraftConfirmer = 'MESSAGE_SENDER' | 'DRAFT_CREATOR';

export interface ActionDefinition<P extends ActionDraftPayload = ActionDraftPayload> {
  readonly actionType: ActionType;
  readonly confirmer: DraftConfirmer;
  /** 확정 주체가 초안을 만들고 고치고 확정할 때 필요한 사용(USE) 권한 */
  readonly permission: Permission;
  /** 저장된 payload(jsonb)를 이 유형의 값으로 읽는다 */
  parse(raw: unknown): P;
  /** 원본 글만 담은 빈 payload */
  empty(sourceText: string | null): P;
  /** 수정 요청의 칸을 검증해 반영한다. 보내지 않은 칸은 그대로, null이면 비운다. 형식이 틀리면 COM-004, 없는 기준정보는 COM-003 */
  applyPatch(tx: Tx, current: P, patch: Record<string, unknown>): Promise<P>;
  /** 확정 전에 채워야 할 칸 (표시명). 비면 확정할 수 있다 */
  unresolvedFields(tx: Tx, payload: P): Promise<string[]>;
  /** 확정 주체가 실행할 수 있는지 미리 본다(예: 구매요청 승인권자). 실행이 늘 실패해 APPROVED에 갇히지 않게 */
  assertCanExecute(tx: Tx, actor: AuthUser): Promise<void>;
  /** 확정 작업 로그(DRAFT_CONFIRMED)의 사유 */
  confirmReason(tx: Tx, payload: P): Promise<string>;
  /** 업무를 만든다. 실행 트랜잭션 안에서 부른다 */
  execute(tx: Tx, draft: DraftRow, actor: AuthUser): Promise<ActionDraftResultView>;
  /** 화면에 보일 실행 결과. 실행 전이면 null */
  resultOf(draft: DraftRow): ActionDraftResultView | null;
}
