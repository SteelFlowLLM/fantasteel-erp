// 수주 등록 초안 (REQ-ACT-005, BP-ACT-02, 업무 프로세스 12.3). 확정 주체는 초안을 만든 사원(수주 등록 사용 권한)이고,
// 실행하면 수주 등록과 같이 합격 재고 우선 예약·부족분 생산계획이 생긴다 (BP-SO-01).
import { Injectable } from '@nestjs/common';
import { ACTION_TYPE, PERMISSION, type ActionDraftResultView, type AuthUser, type SalesOrderDraftLine, type SalesOrderDraftPayload } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import type { Tx } from '../../../prisma/prisma.service';
import { SalesOrderService } from '../../sales-order/sales-order.service';
import { MessageActionRepository, type DraftRow } from '../message-action.repository';
import { memoized, type ActionDefinition, type LookupMemo } from './action-definition';
import { executedResultOf, originOf } from './business-refs';
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

const PATCH_FIELDS = new Set(['customerId', 'items']);

type Customer = Awaited<ReturnType<MessageActionRepository['findCustomers']>>[number];
type ProductItem = Awaited<ReturnType<MessageActionRepository['findProductItems']>>[number];

/** 저장된 payload(jsonb)를 수주 등록 초안 값으로 읽는다 */
export function salesOrderPayloadOf(raw: unknown): SalesOrderDraftPayload {
  const p = isRecord(raw) ? raw : {};
  return {
    customerId: idOrNull(p.customerId),
    items: linesOf(p.items).map((line) => ({ itemId: idOrNull(line.itemId), orderedQty: qtyOrNull(line.orderedQty), dueDate: dateOrNull(line.dueDate) })),
    ...draftBaseOf(p),
  };
}

/** LLM이 준 값 → 검증을 통과한 칸만 채운 초안. 고객사·규격은 이름이나 코드가 정확히 하나와 맞을 때만 */
export function salesOrderFromExtraction(extracted: Record<string, unknown>, customers: readonly Customer[], items: readonly ProductItem[], sourceText: string | null): SalesOrderDraftPayload {
  const customer = matchOne(customers, extracted.customerName, (c) => [c.customerName, c.customerCode]);
  const lines: SalesOrderDraftLine[] = linesOf(extracted.items).map((line) => ({
    itemId: matchOne(items, line.itemCode, (i) => [i.itemCode, i.itemName])?.id ?? null,
    orderedQty: extractedQtyOf(line.orderedQty),
    dueDate: extractedDateOf(line.dueDate),
  }));
  // 아무 값도 없는 줄은 버린다 (LLM이 빈 줄을 만들어도 미확정 칸이 늘지 않게)
  const filledLines = lines.filter((l) => l.itemId !== null || l.orderedQty !== null || l.dueDate !== null);
  const aiFilledFields = [...(customer ? ['customerId'] : []), ...(filledLines.length > 0 ? ['items'] : [])];
  return { customerId: customer?.id ?? null, items: filledLines, sourceText, aiFilledFields };
}

/** 확정 전에 비어 있거나 기준정보와 맞지 않는 칸 (추출 스키마: 고객사·품목마다 규격·매수·납기) */
export function salesOrderUnresolvedFields(payload: SalesOrderDraftPayload, customerExists: boolean, productItemIds: ReadonlySet<number>): string[] {
  const missing: string[] = [];
  if (payload.customerId === null || !customerExists) missing.push('고객사');
  if (payload.items.length === 0) missing.push('품목');
  payload.items.forEach((line, index) => {
    const n = index + 1;
    if (line.itemId === null || !productItemIds.has(line.itemId)) missing.push(`품목 ${n} 규격`);
    if (line.orderedQty === null) missing.push(`품목 ${n} 매수`);
    if (line.dueDate === null) missing.push(`품목 ${n} 납기`);
  });
  return missing;
}

@Injectable()
export class SalesOrderAction implements ActionDefinition<SalesOrderDraftPayload> {
  readonly actionType = ACTION_TYPE.SALES_ORDER_CREATE;
  readonly confirmer = 'DRAFT_CREATOR';
  readonly permission = PERMISSION.SALES_ORDER_CREATE;

  constructor(
    private readonly salesOrders: SalesOrderService,
    private readonly repository: MessageActionRepository,
  ) {}

  parse(raw: unknown): SalesOrderDraftPayload {
    return salesOrderPayloadOf(raw);
  }

  empty(sourceText: string | null): SalesOrderDraftPayload {
    return { customerId: null, items: [], sourceText, aiFilledFields: [] };
  }

  async extractionGuide(tx: Tx): Promise<string> {
    const customers = await this.repository.findCustomers(tx);
    const items = await this.repository.findProductItems(tx);
    return [
      '- customerName: 고객사 이름. 아래 고객사 목록의 이름만 쓴다',
      '- items: 수주 품목 목록. 각 품목은 { "itemCode": 규격 코드(아래 규격 목록의 코드만), "orderedQty": 매수(정수), "dueDate": 납기 YYYY-MM-DD }',
      '  톤만 있고 매수가 없으면 orderedQty는 null로 둔다(톤을 매수로 바꾸지 않는다). 규격이 하나로 정해지지 않으면 itemCode는 null',
      '',
      '고객사 목록 (코드 | 이름):',
      ...customers.map((c) => `${c.customerCode} | ${c.customerName}`),
      '',
      '규격 목록 (코드 | 이름):',
      ...items.map((i) => `${i.itemCode} | ${i.itemName}`),
    ].join('\n');
  }

  async fromExtraction(tx: Tx, extracted: Record<string, unknown>, sourceText: string | null): Promise<SalesOrderDraftPayload> {
    const customers = await this.repository.findCustomers(tx);
    const items = await this.repository.findProductItems(tx);
    return salesOrderFromExtraction(extracted, customers, items, sourceText);
  }

  async applyPatch(tx: Tx, current: SalesOrderDraftPayload, patch: Record<string, unknown>): Promise<SalesOrderDraftPayload> {
    rejectUnknownFields(patch, PATCH_FIELDS, '수주 등록');
    const next = { ...current };
    const customerId = idPatch(patch.customerId, '고객사를 골라 주세요');
    if (customerId !== undefined) {
      if (customerId !== null && (await this.repository.findCustomers(tx)).every((c) => c.id !== customerId)) throw new AppException('COM-003', '고객사를 찾을 수 없어요');
      next.customerId = customerId;
    }
    const lines = linesPatch(patch.items);
    if (lines !== undefined) {
      const productIds = new Set((await this.repository.findProductItems(tx)).map((i) => i.id));
      next.items = lines.map((line, index) => {
        const n = index + 1;
        const itemId = idPatch(line.itemId, `품목 ${n}의 규격을 골라 주세요`) ?? null;
        if (itemId !== null && !productIds.has(itemId)) throw new AppException('SO-001', `품목 ${n}의 규격을 찾을 수 없어요`);
        return {
          itemId,
          orderedQty: qtyPatch(line.orderedQty, `품목 ${n}의 매수는 1 이상의 정수(${MAX_DRAFT_QTY.toLocaleString('ko-KR')}매까지)로 입력해 주세요`),
          dueDate: datePatch(line.dueDate, `품목 ${n}의 납기는 YYYY-MM-DD 형식의 날짜로 입력해 주세요`),
        };
      });
    }
    return next;
  }

  async unresolvedFields(tx: Tx, payload: SalesOrderDraftPayload, memo?: LookupMemo): Promise<string[]> {
    const customers = payload.customerId === null ? [] : await memoized(memo, 'customers', () => this.repository.findCustomers(tx));
    const productIds = payload.items.length === 0 ? new Set<number>() : new Set((await memoized(memo, 'productItems', () => this.repository.findProductItems(tx))).map((i) => i.id));
    return salesOrderUnresolvedFields(payload, customers.some((c) => c.id === payload.customerId), productIds);
  }

  /** 수주 등록에는 승인권자가 없다 */
  async assertCanExecute(): Promise<void> {}

  async payloadLabels(tx: Tx, payload: SalesOrderDraftPayload, memo?: LookupMemo): Promise<Record<string, string>> {
    const labels: Record<string, string> = {};
    if (payload.customerId !== null) {
      const customer = (await memoized(memo, 'customers', () => this.repository.findCustomers(tx))).find((c) => c.id === payload.customerId);
      if (customer) labels.customerId = customer.customerName;
    }
    const itemIds = payload.items.map((l) => l.itemId).filter((id): id is number => id !== null);
    const items = new Map((itemIds.length > 0 ? await this.repository.findItems(tx, itemIds) : []).map((i) => [i.id, i]));
    payload.items.forEach((line, index) => {
      const item = line.itemId === null ? undefined : items.get(line.itemId);
      if (item) labels[`items.${index}.itemId`] = `${item.itemCode} ${item.itemName}`;
    });
    return labels;
  }

  async confirmReason(tx: Tx, payload: SalesOrderDraftPayload): Promise<string> {
    const labels = await this.payloadLabels(tx, payload);
    const totalQty = payload.items.reduce((sum, l) => sum + (l.orderedQty ?? 0), 0);
    return `DRAFT_CONFIRMED: 수주 등록 확정 (${labels.customerId ?? '고객사'}, 품목 ${payload.items.length}개 ${totalQty}매)`;
  }

  async execute(tx: Tx, draft: DraftRow, actor: AuthUser): Promise<ActionDraftResultView> {
    const p = salesOrderPayloadOf(draft.payload);
    // 확정 때 미확정 칸이 없음을 확인했고 확정 뒤에는 값을 고칠 수 없다. 저장된 값이 깨졌을 때만 여기서 막힌다
    if (p.customerId === null || p.items.length === 0 || p.items.some((l) => l.itemId === null || l.orderedQty === null || l.dueDate === null)) throw new AppException('ACT-001');
    const dto = { customerId: p.customerId, items: p.items.map((l) => ({ itemId: l.itemId ?? 0, orderedQty: l.orderedQty, dueDate: l.dueDate ?? '' })) };
    const created = await this.salesOrders.createInTx(tx, actor, dto, originOf(draft, p));
    return { table: 'sales_order', id: created.salesOrderId, no: created.salesOrderNo, status: null };
  }

  resultOf(draft: DraftRow): ActionDraftResultView | null {
    return executedResultOf(draft);
  }
}
