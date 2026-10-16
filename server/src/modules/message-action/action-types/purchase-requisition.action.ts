// 구매요청 생성 초안 (REQ-ACT-001~003, BP-ACT-01). 확정 주체는 메시지 작성자(요청자)이고, 실행하면 부서장 승인을 기다리는 구매요청이 생긴다.
import { Injectable } from '@nestjs/common';
import { ACTION_TYPE, ITEM_TYPE, PERMISSION, type ActionDraftResultView, type AuthUser, type PurchaseRequisitionDraftPayload } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { Prisma } from '../../../generated/prisma/client';
import type { Tx } from '../../../prisma/prisma.service';
import { isValidDate, PurchasingService, TON_PATTERN } from '../../purchasing/purchasing.service';
import { MessageActionRepository, type DraftRow } from '../message-action.repository';
import type { ActionDefinition } from './action-definition';

const REQUEST_REASON_MAX = 500;
const PATCH_FIELDS = new Set(['itemId', 'requestedTon', 'desiredReceiptDate', 'requestReason']);

const isPositiveTon = (s: string) => TON_PATTERN.test(s) && Number(s) > 0;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const textOrNull = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);

type ItemBrief = Awaited<ReturnType<MessageActionRepository['findItems']>>[number];

/** 저장된 payload(jsonb)를 구매요청 초안 값으로 읽는다 */
export function payloadOf(raw: unknown): PurchaseRequisitionDraftPayload {
  const p = isRecord(raw) ? raw : {};
  return {
    itemId: typeof p.itemId === 'number' ? p.itemId : null,
    requestedTon: textOrNull(p.requestedTon),
    desiredReceiptDate: textOrNull(p.desiredReceiptDate),
    requestReason: textOrNull(p.requestReason),
    sourceText: textOrNull(p.sourceText),
  };
}

/** 확정 전에 비어 있거나 기준정보와 맞지 않는 필수 칸 (추출 스키마 REQ-ACT-001: 원료 품목·수량(톤)·희망 입고일) */
export function unresolvedFieldsOf(payload: PurchaseRequisitionDraftPayload, item: ItemBrief | undefined): string[] {
  const missing: string[] = [];
  if (!item || item.itemType !== ITEM_TYPE.RAW_MATERIAL) missing.push('원료 품목');
  if (!payload.requestedTon || !isPositiveTon(payload.requestedTon)) missing.push('수량(톤)');
  if (!payload.desiredReceiptDate || !isValidDate(payload.desiredReceiptDate)) missing.push('희망 입고일');
  return missing;
}

/** 수정 요청의 글 칸: 보내지 않으면 undefined, null·빈 글이면 null. 글이 아니면 COM-004 */
function textPatch(value: unknown, message: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new AppException('COM-004', message);
  return value.trim() || null;
}

@Injectable()
export class PurchaseRequisitionAction implements ActionDefinition<PurchaseRequisitionDraftPayload> {
  readonly actionType = ACTION_TYPE.PURCHASE_REQUISITION_CREATE;
  readonly confirmer = 'MESSAGE_SENDER';
  readonly permission = PERMISSION.PURCHASE_REQUISITION_CREATE;

  constructor(
    private readonly purchasing: PurchasingService,
    private readonly repository: MessageActionRepository,
  ) {}

  parse(raw: unknown): PurchaseRequisitionDraftPayload {
    return payloadOf(raw);
  }

  empty(sourceText: string | null): PurchaseRequisitionDraftPayload {
    return { itemId: null, requestedTon: null, desiredReceiptDate: null, requestReason: null, sourceText };
  }

  async applyPatch(tx: Tx, current: PurchaseRequisitionDraftPayload, patch: Record<string, unknown>): Promise<PurchaseRequisitionDraftPayload> {
    const unknown = Object.keys(patch).filter((key) => !PATCH_FIELDS.has(key));
    if (unknown.length > 0) throw new AppException('COM-004', `구매요청 초안에 없는 칸이에요: ${unknown.join(', ')}`);
    const next = { ...current };
    if (patch.itemId !== undefined) {
      if (patch.itemId !== null) {
        if (typeof patch.itemId !== 'number' || !Number.isInteger(patch.itemId)) throw new AppException('COM-004', '원료 품목을 골라 주세요');
        const item = await this.itemOf(tx, patch.itemId);
        if (!item) throw new AppException('COM-003', '원료 품목을 찾을 수 없어요');
        if (item.itemType !== ITEM_TYPE.RAW_MATERIAL) throw new AppException('COM-004', '원료 품목을 골라 주세요');
      }
      next.itemId = patch.itemId;
    }
    const ton = textPatch(patch.requestedTon, '수량(톤)은 숫자로 입력해 주세요');
    if (ton !== undefined) {
      if (ton && !isPositiveTon(ton)) throw new AppException('COM-004', '수량(톤)은 0보다 큰 숫자로, 소수 3자리까지 입력해 주세요');
      next.requestedTon = ton ? new Prisma.Decimal(ton).toFixed(3) : null;
    }
    const date = textPatch(patch.desiredReceiptDate, '희망 입고일은 YYYY-MM-DD로 입력해 주세요');
    if (date !== undefined) {
      if (date && !isValidDate(date)) throw new AppException('COM-004', '희망 입고일은 YYYY-MM-DD 형식의 날짜로 입력해 주세요');
      next.desiredReceiptDate = date;
    }
    const reason = textPatch(patch.requestReason, '요청 근거는 글로 입력해 주세요');
    if (reason !== undefined) {
      if (reason && reason.length > REQUEST_REASON_MAX) throw new AppException('COM-004', `요청 근거는 ${REQUEST_REASON_MAX}자까지 쓸 수 있어요`);
      next.requestReason = reason;
    }
    return next;
  }

  async unresolvedFields(tx: Tx, payload: PurchaseRequisitionDraftPayload): Promise<string[]> {
    return unresolvedFieldsOf(payload, await this.itemOf(tx, payload.itemId));
  }

  /** 승인권자(소속 부서의 부서장, 본인이 아님)가 없으면 PUR-001 (구매요청 등록과 같은 규칙) */
  assertCanExecute(tx: Tx, actor: AuthUser): Promise<void> {
    return this.purchasing.assertCanRequest(tx, actor);
  }

  async confirmReason(tx: Tx, payload: PurchaseRequisitionDraftPayload): Promise<string> {
    const item = await this.itemOf(tx, payload.itemId);
    return `DRAFT_CONFIRMED: 요청자 확정 (${item?.itemCode} ${payload.requestedTon}t, 희망 입고일 ${payload.desiredReceiptDate})`;
  }

  async execute(tx: Tx, draft: DraftRow, actor: AuthUser): Promise<ActionDraftResultView> {
    const p = payloadOf(draft.payload);
    const input = { itemId: p.itemId ?? 0, requestedTon: p.requestedTon ?? '', desiredReceiptDate: p.desiredReceiptDate ?? '', requestReason: p.requestReason };
    const requisition = await this.purchasing.createRequisition(tx, input, actor, { actionDraftId: draft.id, messageId: draft.messageId });
    return { table: 'purchase_requisition', id: requisition.id, no: requisition.purchaseRequisitionNo, status: requisition.purchaseRequisitionStatus };
  }

  resultOf(draft: DraftRow): ActionDraftResultView | null {
    const requisition = draft.purchaseRequisition;
    return requisition
      ? { table: 'purchase_requisition', id: requisition.id, no: requisition.purchaseRequisitionNo, status: requisition.purchaseRequisitionStatus }
      : null;
  }

  private async itemOf(tx: Tx, itemId: number | null): Promise<ItemBrief | undefined> {
    if (itemId === null) return undefined;
    const [item] = await this.repository.findItems(tx, [itemId]);
    return item;
  }
}
