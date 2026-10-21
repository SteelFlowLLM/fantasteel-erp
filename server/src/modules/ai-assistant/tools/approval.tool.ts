import { PURCHASE_REQUISITION_STATUS, PURCHASE_REQUISITION_STATUS_LABEL, type AuthUser, type PurchaseRequisitionSummary } from '@fantasteel/shared';
import type { PurchasingService } from '../../purchasing/purchasing.service';
import { limitRows, TOOL_ROW_LIMIT, type AssistantTool } from './assistant-tool';

export const NOT_DEPARTMENT_HEAD = '부서장이 아니라 승인할 구매요청이 없어요 (구매요청은 요청자 소속 부서의 부서장이 승인해요)';

export interface ApprovalInbox {
  /** 부서장이 아니면 null: 결재함이 없다 */
  total: number | null;
  rows: PurchaseRequisitionSummary[];
}

/** 내가 승인할 구매요청: 내 부서원의 승인 대기, 내 요청 제외 (승인함 화면과 같은 GET purchase-requisitions?approvable=true) */
export async function readApprovalInbox(purchasing: PurchasingService, user: AuthUser, size: number = TOOL_ROW_LIMIT): Promise<ApprovalInbox> {
  if (user.headDepartmentIds.length === 0) return { total: null, rows: [] };
  const page = await purchasing.listRequisitions(user, { approvable: true, page: 1, size });
  return { total: page.total, rows: page.items };
}

export function approvalRow(r: PurchaseRequisitionSummary) {
  return {
    구매요청번호: r.purchaseRequisitionNo,
    구매요청id: r.id,
    상태: PURCHASE_REQUISITION_STATUS_LABEL[r.purchaseRequisitionStatus],
    원료: `${r.itemCode} ${r.itemName}`,
    '요청 톤': r.requestedTon,
    '희망 입고일': r.desiredReceiptDate,
    요청자: `${r.requesterName}(${r.departmentName})`,
    '요청일': r.createdAt.slice(0, 10),
    ...(r.productionPlanNo ? { 생산계획: r.productionPlanNo } : {}),
  };
}

/**
 * 내 결재함 (GET purchase-requisitions?approvable=true, 문서에 없는 기능 이슈 #506).
 * 구매요청은 요청자 소속 부서의 부서장이 최종 승인하므로, 부서장인 사원에게만 결재 대기가 있다.
 * 부서장이 아니면 service가 COM-002를 주는 요청이라 부르지 않고 "결재함이 없다"고 알린다. 사원 본인의 것이라 철강맨AI 패널에서만 알린다.
 */
export function myApprovalsTool(purchasing: PurchasingService): AssistantTool {
  return {
    access: { checkedBy: 'SERVICE', permissions: [], note: '부서장만 자기 부서원이 올린 구매요청을 승인해요.' },
    panelOnly: true,
    definition: {
      name: 'get_my_approvals',
      description: `내 결재함을 조회한다. 내가 부서장으로서 승인해야 할 구매요청(${PURCHASE_REQUISITION_STATUS_LABEL[PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL]})의 번호·원료·요청 톤·희망 입고일·요청자를 준다. 부서장이 아니면 결재 대기가 없다. 승인·반려는 할 수 없다.`,
      parameters: { type: 'object', properties: {} },
    },
    async run(_args, user) {
      const inbox = await readApprovalInbox(purchasing, user);
      const limited = limitRows(inbox.rows);
      return {
        label: '내 결재함',
        data:
          inbox.total === null
            ? { '결재 대기 구매요청 수': 0, 안내: NOT_DEPARTMENT_HEAD }
            : { '결재 대기 구매요청 수': inbox.total, 구매요청: limited.rows.map(approvalRow), '생략 줄 수': Math.max(0, inbox.total - limited.rows.length) },
      };
    },
  };
}
