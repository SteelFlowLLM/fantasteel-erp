import { Injectable } from '@nestjs/common';
import { REQUISITION_SOURCE_TYPE, type AuthUser, type PurchaseRequisitionDraftPayload } from '@fantasteel/shared';
import { badInput } from '../../common/errors/app.exception';
import type { Tx } from '../../prisma/prisma.service';
import { PurchaseRequisitionService } from './purchase-requisition.service';
import { D, isDateOnly, isTonText, todayKst } from './purchasing.util';

const EDITABLE_FIELDS = ['rawMaterialId', 'requiredTon', 'desiredReceiptDate', 'requestReason'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * Message → ERP 구매요청의 실행 핸들러 (BP-ACT-01). 초안 값 검증과 구매요청 생성은 구매 모듈이 책임진다.
 * message-action 모듈의 ActionDefinition이 이 핸들러를 부른다.
 */
@Injectable()
export class PurchaseRequisitionActionHandler {
  constructor(private readonly requisitions: PurchaseRequisitionService) {}

  initialPayload(requesterId: number): PurchaseRequisitionDraftPayload {
    return { rawMaterialId: null, requiredTon: null, desiredReceiptDate: null, requesterId, requestReason: null };
  }

  /** 저장된 JSON을 추출 스키마 모양으로 읽는다. 모양이 다른 값은 미확정(null)으로 본다. */
  readPayload(raw: unknown): PurchaseRequisitionDraftPayload {
    const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      rawMaterialId: typeof o.rawMaterialId === 'number' && Number.isInteger(o.rawMaterialId) ? o.rawMaterialId : null,
      requiredTon: isTonText(o.requiredTon) ? o.requiredTon : null,
      desiredReceiptDate: isDateOnly(o.desiredReceiptDate) ? o.desiredReceiptDate : null,
      requesterId: typeof o.requesterId === 'number' ? o.requesterId : 0,
      requestReason: typeof o.requestReason === 'string' ? o.requestReason : null,
    };
  }

  /** 요청자가 입력한 값을 검증해 반영한다. null은 "아직 모름"으로 허용한다. 요청자는 바꿀 수 없다. */
  async applyPatch(tx: Tx, raw: unknown, patch: Record<string, unknown>): Promise<PurchaseRequisitionDraftPayload> {
    const payload = this.readPayload(raw);
    for (const key of Object.keys(patch)) {
      if (key === 'requesterId') {
        if (patch.requesterId !== payload.requesterId) throw badInput('요청자는 원본 메시지 작성자로 정해져 있어 바꿀 수 없습니다');
        continue;
      }
      if (!EDITABLE_FIELDS.includes(key as EditableField)) throw badInput(`구매요청 초안에 없는 항목입니다: ${key}`);
    }
    if ('rawMaterialId' in patch) {
      const v = patch.rawMaterialId;
      if (v !== null) {
        if (typeof v !== 'number' || !Number.isInteger(v)) throw badInput('원료를 선택해 주세요');
        if (!(await this.isUsableRawMaterial(tx, v))) throw badInput('등록되지 않았거나 사용 중지된 원료입니다');
      }
      payload.rawMaterialId = v as number | null;
    }
    if ('requiredTon' in patch) {
      const v = typeof patch.requiredTon === 'number' ? String(patch.requiredTon) : patch.requiredTon;
      if (v !== null) {
        if (!isTonText(v) || D(v).lte(0)) throw badInput('수량(톤)은 0보다 큰 숫자(소수 3자리 이하)로 입력해 주세요');
        payload.requiredTon = D(v).toFixed(3);
      } else payload.requiredTon = null;
    }
    if ('desiredReceiptDate' in patch) {
      const v = patch.desiredReceiptDate;
      if (v !== null) {
        if (!isDateOnly(v)) throw badInput('희망 입고일은 YYYY-MM-DD 형식의 날짜로 입력해 주세요');
        if (v < todayKst()) throw badInput('희망 입고일은 오늘 이후로 입력해 주세요');
      }
      payload.desiredReceiptDate = v as string | null;
    }
    if ('requestReason' in patch) {
      const v = patch.requestReason;
      if (v !== null && typeof v !== 'string') throw badInput('요청 사유는 글자로 입력해 주세요');
      if (typeof v === 'string' && v.length > 500) throw badInput('요청 사유는 500자 이하로 입력해 주세요');
      payload.requestReason = typeof v === 'string' ? v.trim() || null : null;
    }
    return payload;
  }

  /** 확정할 수 없는 필드. 현재 기준정보로 다시 확인한다 (초안을 만든 뒤 원료가 중지됐거나 날짜가 지났을 수 있다). */
  async unresolvedFields(tx: Tx, raw: unknown): Promise<string[]> {
    const payload = this.readPayload(raw);
    const unresolved: string[] = [];
    if (payload.rawMaterialId === null || !(await this.isUsableRawMaterial(tx, payload.rawMaterialId))) unresolved.push('rawMaterialId');
    if (payload.requiredTon === null || D(payload.requiredTon).lte(0)) unresolved.push('requiredTon');
    if (payload.desiredReceiptDate === null || payload.desiredReceiptDate < todayKst()) unresolved.push('desiredReceiptDate');
    return unresolved;
  }

  /** 구매요청을 만들고 곧바로 제출한다: 화면 제출과 같은 승인권자·알림 로직을 탄다. 이후 부서장 승인은 따로다 (REQ-ACT-002·003). */
  async execute(tx: Tx, draft: { id: number; messageId: number | null; payload: unknown }, actor: AuthUser): Promise<{ purchaseRequisitionId: number; purchaseRequisitionNo: string }> {
    const payload = this.readPayload(draft.payload);
    if (payload.rawMaterialId === null || payload.requiredTon === null || payload.desiredReceiptDate === null) throw badInput('구매요청 초안의 필수값이 비어 있습니다');
    const row = await this.requisitions.createInTx(tx, {
      requester: actor,
      items: [{ rawMaterialId: payload.rawMaterialId, requiredTon: payload.requiredTon }],
      desiredReceiptDate: payload.desiredReceiptDate,
      requestReason: payload.requestReason ?? null,
      sourceType: REQUISITION_SOURCE_TYPE.MESSAGE,
      sourceDraftId: draft.id,
    });
    await this.requisitions.submitInTx(tx, row.id, actor, { messageId: draft.messageId, actionDraftId: draft.id });
    return { purchaseRequisitionId: row.id, purchaseRequisitionNo: row.purchaseRequisitionNo };
  }

  private async isUsableRawMaterial(tx: Tx, rawMaterialId: number): Promise<boolean> {
    const rm = await tx.rawMaterial.findUnique({ where: { id: rawMaterialId }, select: { item: { select: { isActive: true } } } });
    return !!rm && rm.item.isActive;
  }
}
