import { Injectable } from '@nestjs/common';
import { ACTION_TYPE, ACTION_TYPE_LABEL, PERMISSION, type AuthUser } from '@fantasteel/shared';
import type { Tx } from '../../../prisma/prisma.service';
import { PurchaseRequisitionActionHandler } from '../../purchasing/purchase-requisition-action.handler';
import type { ActionDefinition, ActionDraftForExecution, ActionExecutionResult } from '../action-definition';

/**
 * 구매요청 유형 (업무 프로세스 정의서 12.3).
 * schema: rawMaterialId, requiredTon, desiredReceiptDate, requesterId / confirmer: REQUESTER / handler: 구매 모듈.
 */
@Injectable()
export class PurchaseRequisitionCreateDefinition implements ActionDefinition {
  readonly type = ACTION_TYPE.PURCHASE_REQUISITION_CREATE;
  readonly label = ACTION_TYPE_LABEL.PURCHASE_REQUISITION_CREATE;
  readonly confirmer = 'REQUESTER' as const;
  readonly requiredPermission = PERMISSION.PURCHASE_REQUISITION_CREATE;
  readonly fieldLabels = { rawMaterialId: '원료', requiredTon: '수량(톤)', desiredReceiptDate: '희망 입고일', requesterId: '요청자', requestReason: '요청 사유' };

  constructor(private readonly handler: PurchaseRequisitionActionHandler) {}

  initialPayload(requesterId: number): Record<string, unknown> {
    return { ...this.handler.initialPayload(requesterId) };
  }

  async applyPatch(tx: Tx, payload: unknown, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return { ...(await this.handler.applyPatch(tx, payload, patch)) };
  }

  validate(tx: Tx, payload: unknown): Promise<string[]> {
    return this.handler.unresolvedFields(tx, payload);
  }

  async execute(tx: Tx, draft: ActionDraftForExecution, actor: AuthUser): Promise<ActionExecutionResult> {
    return { ...(await this.handler.execute(tx, draft, actor)) };
  }
}
