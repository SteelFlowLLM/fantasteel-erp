// 출하요청 생성 초안 (REQ-ACT-005, BP-ACT-02, 업무 프로세스 12.3). 확정 주체는 초안을 만든 사원(출하요청 관리 사용 권한)이고,
// 실행하면 배정 대기 출하요청이 생긴다 (BP-SHP-01). 같은 고객사의 수주 품목만 묶는다.
import { Injectable } from '@nestjs/common';
import {
  ACTION_TYPE,
  PERMISSION,
  SALES_ORDER_ITEM_STATUS,
  type ActionDraftResultView,
  type AuthUser,
  type ShipmentRequestDraftLine,
  type ShipmentRequestDraftPayload,
} from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import type { Tx } from '../../../prisma/prisma.service';
import { ShipmentService } from '../../shipment/shipment.service';
import { MessageActionRepository, type DraftRow, type SalesOrderItemBrief } from '../message-action.repository';
import { memoized, type ActionDefinition, type LookupMemo } from './action-definition';
import { EXTRACTION_CANDIDATE_LIMIT, executedResultOf, originOf, salesOrderItemGuideLine, salesOrderItemLabel, salesOrderItemOf } from './business-refs';
import {
  dateOrNull,
  datePatch,
  draftBaseOf,
  extractedDateOf,
  extractedQtyOf,
  idOrNull,
  idPatch,
  isRecord,
  linesOf,
  linesPatch,
  matchOne,
  MAX_DRAFT_QTY,
  qtyOrNull,
  qtyPatch,
  rejectUnknownFields,
} from './draft-values';

const PATCH_FIELDS = new Set(['customerId', 'shipDate', 'items']);
/** 출하요청할 수 있는 수주 품목 상태 (취소·출하완료 제외) */
const OPEN_ITEM_STATUSES: readonly string[] = [SALES_ORDER_ITEM_STATUS.OPEN, SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED];

type Customer = Awaited<ReturnType<MessageActionRepository['findCustomers']>>[number];

/** 저장된 payload(jsonb)를 출하요청 초안 값으로 읽는다 */
export function shipmentRequestPayloadOf(raw: unknown): ShipmentRequestDraftPayload {
  const p = isRecord(raw) ? raw : {};
  return {
    customerId: idOrNull(p.customerId),
    shipDate: dateOrNull(p.shipDate),
    items: linesOf(p.items).map((line) => ({ salesOrderItemId: idOrNull(line.salesOrderItemId), requestQty: qtyOrNull(line.requestQty) })),
    ...draftBaseOf(p),
  };
}

/**
 * 확정 전에 비어 있거나 업무 데이터와 맞지 않는 칸 (추출 스키마: 고객사·품목마다 수주 품목·매수).
 * 수주 품목은 진행 중이고 고른 고객사의 것이어야 하며 한 번만 넣는다. 출하 예정일은 선택이다
 */
export function shipmentRequestUnresolvedFields(payload: ShipmentRequestDraftPayload, customerExists: boolean, salesOrderItems: readonly Pick<SalesOrderItemBrief, 'id' | 'salesOrderItemStatus' | 'salesOrder'>[]): string[] {
  const missing: string[] = [];
  if (payload.customerId === null || !customerExists) missing.push('고객사');
  if (payload.items.length === 0) missing.push('품목');
  const seen = new Set<number>();
  payload.items.forEach((line, index) => {
    const n = index + 1;
    const row = line.salesOrderItemId === null ? undefined : salesOrderItems.find((r) => r.id === line.salesOrderItemId);
    const usable = row && OPEN_ITEM_STATUSES.includes(row.salesOrderItemStatus) && row.salesOrder.customerId === payload.customerId && !seen.has(row.id);
    if (!usable) missing.push(`품목 ${n} 수주 품목`);
    if (row) seen.add(row.id);
    if (line.requestQty === null) missing.push(`품목 ${n} 매수`);
  });
  return missing;
}

@Injectable()
export class ShipmentRequestAction implements ActionDefinition<ShipmentRequestDraftPayload> {
  readonly actionType = ACTION_TYPE.SHIPMENT_REQUEST_CREATE;
  readonly confirmer = 'DRAFT_CREATOR';
  readonly permission = PERMISSION.SHIPMENT_REQUEST_MANAGE;

  constructor(
    private readonly shipments: ShipmentService,
    private readonly repository: MessageActionRepository,
  ) {}

  parse(raw: unknown): ShipmentRequestDraftPayload {
    return shipmentRequestPayloadOf(raw);
  }

  empty(sourceText: string | null): ShipmentRequestDraftPayload {
    return { customerId: null, shipDate: null, items: [], sourceText, aiFilledFields: [] };
  }

  async extractionGuide(tx: Tx): Promise<string> {
    const customers = await this.repository.findCustomers(tx);
    const openItems = await this.repository.findSalesOrderItems(tx, { salesOrderItemStatus: { in: [...OPEN_ITEM_STATUSES] } }, EXTRACTION_CANDIDATE_LIMIT);
    return [
      '- customerName: 고객사 이름. 아래 고객사 목록의 이름만 쓴다',
      '- shipDate: 출하 예정일 YYYY-MM-DD. 없으면 null',
      '- items: 출하할 품목 목록. 각 품목은 { "salesOrderNo": 수주번호, "lineNo": 수주 안의 줄 번호(정수), "itemCode": 규격 코드, "requestQty": 출하 매수(정수) }',
      '  아래 진행 중 수주 품목 목록에 있는 것만 쓴다. 모르는 값은 null',
      '',
      '고객사 목록 (코드 | 이름):',
      ...customers.map((c) => `${c.customerCode} | ${c.customerName}`),
      '',
      '진행 중 수주 품목 (수주번호 | 줄 번호 | 규격 코드 | 고객사 | 주문 매수 | 납기):',
      ...openItems.map(salesOrderItemGuideLine),
    ].join('\n');
  }

  async fromExtraction(tx: Tx, extracted: Record<string, unknown>, sourceText: string | null): Promise<ShipmentRequestDraftPayload> {
    const customers: Customer[] = await this.repository.findCustomers(tx);
    const lines: ShipmentRequestDraftLine[] = [];
    const customerIds = new Set<number>();
    for (const line of linesOf(extracted.items)) {
      const row = await salesOrderItemOf(tx, this.repository, line.salesOrderNo, line.itemCode, line.lineNo);
      if (row) customerIds.add(row.salesOrder.customerId);
      const requestQty = extractedQtyOf(line.requestQty);
      if (row || requestQty !== null) lines.push({ salesOrderItemId: row?.id ?? null, requestQty });
    }
    // 고객사를 말하지 않았어도 고른 수주 품목이 모두 한 고객사면 그 고객사로 둔다
    const named = matchOne(customers, extracted.customerName, (c) => [c.customerName, c.customerCode]);
    const customerId = named?.id ?? (customerIds.size === 1 ? [...customerIds][0] : null);
    const shipDate = extractedDateOf(extracted.shipDate);
    const aiFilledFields = [...(customerId !== null ? ['customerId'] : []), ...(shipDate ? ['shipDate'] : []), ...(lines.length > 0 ? ['items'] : [])];
    return { customerId, shipDate, items: lines, sourceText, aiFilledFields };
  }

  async applyPatch(tx: Tx, current: ShipmentRequestDraftPayload, patch: Record<string, unknown>): Promise<ShipmentRequestDraftPayload> {
    rejectUnknownFields(patch, PATCH_FIELDS, '출하요청');
    const next = { ...current };
    const customerId = idPatch(patch.customerId, '고객사를 골라 주세요');
    if (customerId !== undefined) {
      if (customerId !== null && (await this.repository.findCustomers(tx)).every((c) => c.id !== customerId)) throw new AppException('COM-003', '고객사를 찾을 수 없어요');
      next.customerId = customerId;
    }
    if (patch.shipDate !== undefined) next.shipDate = datePatch(patch.shipDate, '출하 예정일은 YYYY-MM-DD 형식의 날짜로 입력해 주세요');
    const lines = linesPatch(patch.items);
    if (lines !== undefined) {
      next.items = lines.map((line, index) => ({
        salesOrderItemId: idPatch(line.salesOrderItemId, `품목 ${index + 1}의 수주 품목을 골라 주세요`) ?? null,
        requestQty: qtyPatch(line.requestQty, `품목 ${index + 1}의 매수는 1 이상의 정수(${MAX_DRAFT_QTY.toLocaleString('ko-KR')}매까지)로 입력해 주세요`),
      }));
      const ids = next.items.map((l) => l.salesOrderItemId).filter((id): id is number => id !== null);
      const found = ids.length > 0 ? await this.repository.findSalesOrderItems(tx, { id: { in: ids } }) : [];
      const missingIndex = next.items.findIndex((l) => l.salesOrderItemId !== null && found.every((r) => r.id !== l.salesOrderItemId));
      if (missingIndex >= 0) throw new AppException('COM-003', `품목 ${missingIndex + 1}의 수주 품목을 찾을 수 없어요`);
    }
    return next;
  }

  async unresolvedFields(tx: Tx, payload: ShipmentRequestDraftPayload, memo?: LookupMemo): Promise<string[]> {
    const customerExists = payload.customerId !== null && (await memoized(memo, 'customers', () => this.repository.findCustomers(tx))).some((c) => c.id === payload.customerId);
    return shipmentRequestUnresolvedFields(payload, customerExists, await this.salesOrderItemsOf(tx, payload));
  }

  async assertCanExecute(): Promise<void> {}

  /** 출하 가능 매수(ACTIVE 예약 − 진행 중 출하요청)를 넘으면 실행이 늘 실패하므로 확정 전에 막는다 (SHP-002) */
  async assertPayloadExecutable(tx: Tx, payload: ShipmentRequestDraftPayload): Promise<void> {
    const ids = payload.items.map((l) => l.salesOrderItemId).filter((id): id is number => id !== null);
    const shippable = await this.shipments.shippableQtyInTx(tx, ids);
    const index = payload.items.findIndex((l) => l.salesOrderItemId !== null && (l.requestQty ?? 0) > (shippable.get(l.salesOrderItemId) ?? 0));
    if (index >= 0) {
      const line = payload.items[index];
      throw new AppException('SHP-002', `품목 ${index + 1}의 출하 가능 매수는 ${shippable.get(line.salesOrderItemId ?? 0) ?? 0}매예요`);
    }
  }

  async payloadLabels(tx: Tx, payload: ShipmentRequestDraftPayload, memo?: LookupMemo): Promise<Record<string, string>> {
    const labels: Record<string, string> = {};
    if (payload.customerId !== null) {
      const customer = (await memoized(memo, 'customers', () => this.repository.findCustomers(tx))).find((c) => c.id === payload.customerId);
      if (customer) labels.customerId = customer.customerName;
    }
    const rows = await this.salesOrderItemsOf(tx, payload);
    payload.items.forEach((line, index) => {
      const row = rows.find((r) => r.id === line.salesOrderItemId);
      if (row) labels[`items.${index}.salesOrderItemId`] = salesOrderItemLabel(row);
    });
    return labels;
  }

  async confirmReason(tx: Tx, payload: ShipmentRequestDraftPayload): Promise<string> {
    const labels = await this.payloadLabels(tx, payload);
    const totalQty = payload.items.reduce((sum, l) => sum + (l.requestQty ?? 0), 0);
    return `DRAFT_CONFIRMED: 출하요청 생성 확정 (${labels.customerId ?? '고객사'}, 품목 ${payload.items.length}개 ${totalQty}매${payload.shipDate ? `, 출하 예정일 ${payload.shipDate}` : ''})`;
  }

  async execute(tx: Tx, draft: DraftRow, actor: AuthUser): Promise<ActionDraftResultView> {
    const p = shipmentRequestPayloadOf(draft.payload);
    if (p.customerId === null || p.items.length === 0 || p.items.some((l) => l.salesOrderItemId === null || l.requestQty === null)) throw new AppException('ACT-001');
    const dto = {
      customerId: p.customerId,
      shipDate: p.shipDate ?? undefined,
      items: p.items.map((l) => ({ salesOrderItemId: l.salesOrderItemId ?? 0, requestQty: l.requestQty ?? 0 })),
    };
    const created = await this.shipments.createInTx(tx, actor, dto, originOf(draft, p));
    return { table: 'shipment_request', id: created.id, no: created.shipmentRequestNo, status: created.shipmentRequestStatus };
  }

  resultOf(draft: DraftRow): ActionDraftResultView | null {
    return executedResultOf(draft);
  }

  private async salesOrderItemsOf(tx: Tx, payload: ShipmentRequestDraftPayload): Promise<SalesOrderItemBrief[]> {
    const ids = payload.items.map((l) => l.salesOrderItemId).filter((id): id is number => id !== null);
    return ids.length > 0 ? this.repository.findSalesOrderItems(tx, { id: { in: ids } }) : [];
  }
}
