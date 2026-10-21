// 확장 유형이 같이 쓰는 업무 데이터 표시·맞추기·결과 연결 (수주 품목·출하요청 품목, DRAFT_EXECUTED 결과).
import type { ActionDraftPayload, ActionDraftResultView } from '@fantasteel/shared';
import type { BusinessEventInput } from '../../../common/business-event/business-event.recorder';
import type { Tx } from '../../../prisma/prisma.service';
import type { DraftRow, MessageActionRepository, SalesOrderItemBrief, ShipmentRequestItemBrief } from '../message-action.repository';
import { isAiAssisted } from './action-definition';
import { isRecord, matchOne } from './draft-values';

/** AI 추출 후보로 보낼 진행 중 업무의 최대 줄 수 (프롬프트가 너무 길어지지 않게, 최근 것부터) */
export const EXTRACTION_CANDIDATE_LIMIT = 80;

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** 수주·출하요청 안에서 몇 번째 줄인지 (id 순, 1부터) */
const lineNoOf = (ids: { id: number }[], id: number) => ids.findIndex((row) => row.id === id) + 1;

export const salesOrderItemLineNo = (row: SalesOrderItemBrief) => lineNoOf(row.salesOrder.salesOrderItems, row.id);
export const shipmentRequestItemLineNo = (row: ShipmentRequestItemBrief) => lineNoOf(row.shipmentRequest.shipmentRequestItems, row.id);

/** 예: 'SO-2610-001 #2 SL-SS275-250x1200x10000 (가람중공업)' */
export const salesOrderItemLabel = (row: SalesOrderItemBrief) =>
  `${row.salesOrder.salesOrderNo} #${salesOrderItemLineNo(row)} ${row.item.itemCode} (${row.salesOrder.customer.customerName})`;

/** 예: 'DR-2610-0001 #1 SL-SS275-… 3매' */
export const shipmentRequestItemLabel = (row: ShipmentRequestItemBrief) =>
  `${row.shipmentRequest.shipmentRequestNo} #${shipmentRequestItemLineNo(row)} ${row.salesOrderItem.item.itemCode} ${row.requestQty}매`;

/** LLM에 보낼 수주 품목 한 줄 */
export const salesOrderItemGuideLine = (row: SalesOrderItemBrief) =>
  `${row.salesOrder.salesOrderNo} | ${salesOrderItemLineNo(row)} | ${row.item.itemCode} | ${row.salesOrder.customer.customerName} | 주문 ${row.orderedQty}매 | 납기 ${dateOnly(row.dueDate)}`;

/**
 * LLM이 준 수주번호(·규격 코드·줄 번호)로 수주 품목 하나를 고른다. 수주에 품목이 여럿인데 규격·줄 번호로 하나가 되지 않으면 null.
 * 줄 번호는 수주 안의 순서(1부터)
 */
export async function salesOrderItemOf(tx: Tx, repository: MessageActionRepository, salesOrderNo: unknown, itemCode: unknown, lineNo: unknown): Promise<SalesOrderItemBrief | null> {
  if (typeof salesOrderNo !== 'string' || !salesOrderNo.trim()) return null;
  const rows = await repository.findSalesOrderItems(tx, { salesOrder: { salesOrderNo: { equals: salesOrderNo.trim(), mode: 'insensitive' } } });
  if (typeof lineNo === 'number' && Number.isInteger(lineNo)) {
    const byLine = rows.find((r) => salesOrderItemLineNo(r) === lineNo);
    if (byLine) return byLine;
  }
  if (typeof itemCode === 'string' && itemCode.trim()) return matchOne(rows, itemCode, (r) => [r.item.itemCode, r.item.itemName]);
  return rows.length === 1 ? rows[0] : null;
}

/** 초안 실행으로 만든 업무 작업 로그에 남길 원본 초안·메시지·AI 경유 (모듈 문서 10장 결과 연결) */
export const originOf = (draft: DraftRow, payload: ActionDraftPayload): Pick<BusinessEventInput, 'actionDraftId' | 'messageId' | 'isAiAssisted'> => ({
  actionDraftId: draft.id,
  messageId: draft.messageId,
  isAiAssisted: isAiAssisted(payload),
});

/** 구매요청 밖의 유형이 만든 업무: 마지막 DRAFT_EXECUTED after의 결과 테이블·id·번호. 지금 상태는 모르므로 null */
export function executedResultOf(draft: DraftRow): ActionDraftResultView | null {
  const after = draft.businessEvents[0]?.afterData;
  if (!isRecord(after)) return null;
  const { resultTable, resultId, resultNo } = after;
  return typeof resultTable === 'string' && typeof resultId === 'number' && typeof resultNo === 'string' ? { table: resultTable, id: resultId, no: resultNo, status: null } : null;
}
