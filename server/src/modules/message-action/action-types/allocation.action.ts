// 배정 확정 초안 (REQ-ACT-005, BP-ACT-02, 업무 프로세스 12.3). 확정 주체는 초안을 만든 사원(출하요청 관리 사용 권한)이고,
// 실행하면 고른 LOT이 그 출하요청 품목에 CONFIRMED로 배정된다 (REQ-INV-006).
// AI는 배정할 출하요청 품목만 고르고, LOT은 시스템 배정 추천(FIFO)으로 채운다 (모듈 문서 10장).
// Agent 대응 후보의 배정 확정(추천 확인 기록, 실행 없음)은 factory-agent가 따로 다룬다.
import { Injectable } from '@nestjs/common';
import { ACTION_TYPE, PERMISSION, SHIPMENT_REQUEST_STATUS, type ActionDraftResultView, type AllocationDraftPayload, type AuthUser } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import type { Tx } from '../../../prisma/prisma.service';
import { InventoryService } from '../../inventory/inventory.service';
import { MessageActionRepository, type DraftRow, type ShipmentRequestItemBrief } from '../message-action.repository';
import type { ActionDefinition } from './action-definition';
import { EXTRACTION_CANDIDATE_LIMIT, executedResultOf, originOf, shipmentRequestItemLabel, shipmentRequestItemLineNo } from './business-refs';
import { draftBaseOf, idOrNull, idPatch, idsOf, isRecord, matchOne, rejectUnknownFields } from './draft-values';

const PATCH_FIELDS = new Set(['shipmentRequestItemId', 'lotIds']);
/** 배정을 바꿀 수 있는 출하요청 상태 (출고 확정·취소 전) */
const OPEN_REQUEST_STATUSES: readonly string[] = [SHIPMENT_REQUEST_STATUS.REQUESTED, SHIPMENT_REQUEST_STATUS.ALLOCATED];

/** 저장된 payload(jsonb)를 배정 확정 초안 값으로 읽는다 */
export function allocationPayloadOf(raw: unknown): AllocationDraftPayload {
  const p = isRecord(raw) ? raw : {};
  return { shipmentRequestItemId: idOrNull(p.shipmentRequestItemId), lotIds: idsOf(p.lotIds), ...draftBaseOf(p) };
}

/** 확정 전에 비어 있거나 배정할 수 없는 칸 (출하요청 품목이 배정 대기·배정 확정 상태여야 하고, 배정할 LOT이 하나 이상) */
export function allocationUnresolvedFields(payload: AllocationDraftPayload, requestItem: Pick<ShipmentRequestItemBrief, 'shipmentRequest'> | undefined): string[] {
  const missing: string[] = [];
  if (!requestItem || !OPEN_REQUEST_STATUSES.includes(requestItem.shipmentRequest.shipmentRequestStatus)) missing.push('출하요청 품목');
  if (payload.lotIds.length === 0) missing.push('배정 LOT');
  return missing;
}

@Injectable()
export class AllocationAction implements ActionDefinition<AllocationDraftPayload> {
  readonly actionType = ACTION_TYPE.ALLOCATION_CONFIRM;
  readonly confirmer = 'DRAFT_CREATOR';
  readonly permission = PERMISSION.SHIPMENT_REQUEST_MANAGE;

  constructor(
    private readonly inventory: InventoryService,
    private readonly repository: MessageActionRepository,
  ) {}

  parse(raw: unknown): AllocationDraftPayload {
    return allocationPayloadOf(raw);
  }

  empty(sourceText: string | null): AllocationDraftPayload {
    return { shipmentRequestItemId: null, lotIds: [], sourceText, aiFilledFields: [] };
  }

  async extractionGuide(tx: Tx): Promise<string> {
    const openItems = await this.repository.findShipmentRequestItems(tx, { shipmentRequest: { shipmentRequestStatus: { in: [...OPEN_REQUEST_STATUSES] } } }, EXTRACTION_CANDIDATE_LIMIT);
    return [
      '- shipmentRequestNo: 배정할 출하요청 번호. 아래 목록에 있는 번호만 쓴다',
      '- lineNo: 출하요청 안의 줄 번호(정수). 출하요청에 품목이 하나뿐이거나 모르면 null',
      '- itemCode: 그 줄의 규격 코드. 모르면 null',
      '배정할 LOT은 고르지 않는다(시스템이 오래된 순으로 추천한다).',
      '',
      '배정할 수 있는 출하요청 품목 (출하요청 번호 | 줄 번호 | 규격 코드 | 고객사 | 요청 매수):',
      ...openItems.map(
        (r) => `${r.shipmentRequest.shipmentRequestNo} | ${shipmentRequestItemLineNo(r)} | ${r.salesOrderItem.item.itemCode} | ${r.shipmentRequest.customer.customerName} | ${r.requestQty}매`,
      ),
    ].join('\n');
  }

  async fromExtraction(tx: Tx, extracted: Record<string, unknown>, sourceText: string | null): Promise<AllocationDraftPayload> {
    const requestItem = await this.requestItemOf(tx, extracted);
    if (!requestItem) return this.empty(sourceText);
    return { shipmentRequestItemId: requestItem.id, lotIds: await this.inventory.recommendedShipmentLotIds(tx, requestItem.id), sourceText, aiFilledFields: ['shipmentRequestItemId'] };
  }

  /** 출하요청 품목을 바꾸면 LOT을 그 품목의 추천으로 다시 채운다. LOT만 보내면 사람이 고른 LOT으로 바꾼다 */
  async applyPatch(tx: Tx, current: AllocationDraftPayload, patch: Record<string, unknown>): Promise<AllocationDraftPayload> {
    rejectUnknownFields(patch, PATCH_FIELDS, '배정 확정');
    const next = { ...current };
    const requestItemId = idPatch(patch.shipmentRequestItemId, '출하요청 품목을 골라 주세요');
    if (requestItemId !== undefined) {
      if (requestItemId !== null && (await this.repository.findShipmentRequestItems(tx, { id: requestItemId })).length === 0) throw new AppException('COM-003', '출하요청 품목을 찾을 수 없어요');
      next.shipmentRequestItemId = requestItemId;
      next.lotIds = requestItemId === null ? [] : await this.inventory.recommendedShipmentLotIds(tx, requestItemId);
    }
    if (patch.lotIds !== undefined) {
      if (patch.lotIds !== null && (!Array.isArray(patch.lotIds) || idsOf(patch.lotIds).length !== patch.lotIds.length)) throw new AppException('COM-004', '배정할 LOT을 겹치지 않게 골라 주세요');
      next.lotIds = idsOf(patch.lotIds);
    }
    return next;
  }

  async unresolvedFields(tx: Tx, payload: AllocationDraftPayload): Promise<string[]> {
    return allocationUnresolvedFields(payload, await this.findRequestItem(tx, payload.shipmentRequestItemId));
  }

  async assertCanExecute(): Promise<void> {}

  async payloadLabels(tx: Tx, payload: AllocationDraftPayload): Promise<Record<string, string>> {
    const labels: Record<string, string> = {};
    const requestItem = await this.findRequestItem(tx, payload.shipmentRequestItemId);
    if (requestItem) labels.shipmentRequestItemId = shipmentRequestItemLabel(requestItem);
    const lots = payload.lotIds.length > 0 ? await this.repository.findLots(tx, payload.lotIds) : [];
    if (lots.length > 0) labels.lotIds = lots.map((l) => l.lotNo).join(' · ');
    return labels;
  }

  async confirmReason(tx: Tx, payload: AllocationDraftPayload): Promise<string> {
    const labels = await this.payloadLabels(tx, payload);
    return `DRAFT_CONFIRMED: 배정 확정 (${labels.shipmentRequestItemId ?? '출하요청 품목'}, LOT ${payload.lotIds.length}개 FIFO 추천)`;
  }

  async execute(tx: Tx, draft: DraftRow, actor: AuthUser): Promise<ActionDraftResultView> {
    const p = allocationPayloadOf(draft.payload);
    if (p.shipmentRequestItemId === null || p.lotIds.length === 0) throw new AppException('ACT-001');
    await this.inventory.confirmShipmentAllocationsInTx(tx, actor, { shipmentRequestItemId: p.shipmentRequestItemId, lotIds: p.lotIds }, originOf(draft, p));
    const requestItem = await this.findRequestItem(tx, p.shipmentRequestItemId);
    if (!requestItem) throw new AppException('COM-003', '출하요청 품목을 찾을 수 없어요');
    const request = requestItem.shipmentRequest;
    return { table: 'shipment_request', id: request.id, no: request.shipmentRequestNo, status: request.shipmentRequestStatus };
  }

  resultOf(draft: DraftRow): ActionDraftResultView | null {
    return executedResultOf(draft);
  }

  private async findRequestItem(tx: Tx, id: number | null): Promise<ShipmentRequestItemBrief | undefined> {
    if (id === null) return undefined;
    const [row] = await this.repository.findShipmentRequestItems(tx, { id });
    return row;
  }

  /** LLM이 준 출하요청 번호(·줄 번호·규격 코드)로 배정할 수 있는 출하요청 품목 하나를 고른다. 하나로 정해지지 않으면 null */
  private async requestItemOf(tx: Tx, extracted: Record<string, unknown>): Promise<ShipmentRequestItemBrief | null> {
    const no = extracted.shipmentRequestNo;
    if (typeof no !== 'string' || !no.trim()) return null;
    const rows = await this.repository.findShipmentRequestItems(tx, {
      shipmentRequest: { shipmentRequestNo: { equals: no.trim(), mode: 'insensitive' }, shipmentRequestStatus: { in: [...OPEN_REQUEST_STATUSES] } },
    });
    const lineNo = extracted.lineNo;
    if (typeof lineNo === 'number' && Number.isInteger(lineNo)) {
      const byLine = rows.find((r) => shipmentRequestItemLineNo(r) === lineNo);
      if (byLine) return byLine;
    }
    if (typeof extracted.itemCode === 'string' && extracted.itemCode.trim()) return matchOne(rows, extracted.itemCode, (r) => [r.salesOrderItem.item.itemCode, r.salesOrderItem.item.itemName]);
    return rows.length === 1 ? rows[0] : null;
  }
}
