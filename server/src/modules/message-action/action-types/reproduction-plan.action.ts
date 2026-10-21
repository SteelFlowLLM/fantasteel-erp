// 재생산 계획 생성 초안 (REQ-ACT-005, BP-ACT-02, 업무 프로세스 12.3, API-202). 확정 주체는 초안을 만든 사원(생산계획 확정 사용 권한)이다.
// 추가 계획 매수는 초안에 두지 않고 실행 때 서버가 다시 계산한다: 여재를 먼저 예약하고 남은 매수만 재생산 계획으로 만든다 (BP-QC-01).
import { Injectable } from '@nestjs/common';
import { ACTION_TYPE, PERMISSION, SALES_ORDER_ITEM_STATUS, type ActionDraftResultView, type AuthUser, type ReproductionPlanDraftPayload } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import type { Tx } from '../../../prisma/prisma.service';
import { ProductionService } from '../../production/production.service';
import { MessageActionRepository, type DraftRow, type SalesOrderItemBrief } from '../message-action.repository';
import type { ActionDefinition } from './action-definition';
import { EXTRACTION_CANDIDATE_LIMIT, executedResultOf, originOf, salesOrderItemGuideLine, salesOrderItemLabel, salesOrderItemLineNo, salesOrderItemOf } from './business-refs';
import { draftBaseOf, idOrNull, idPatch, isRecord, rejectUnknownFields } from './draft-values';

const PATCH_FIELDS = new Set(['salesOrderItemId']);
/** 재생산할 수 있는 수주 품목 상태 (production.createReproductionPlanInTx와 같다) */
const OPEN_ITEM_STATUSES: readonly string[] = [SALES_ORDER_ITEM_STATUS.OPEN, SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED];

/** 저장된 payload(jsonb)를 재생산 계획 초안 값으로 읽는다 */
export function reproductionPlanPayloadOf(raw: unknown): ReproductionPlanDraftPayload {
  const p = isRecord(raw) ? raw : {};
  return { salesOrderItemId: idOrNull(p.salesOrderItemId), ...draftBaseOf(p) };
}

/** 확정 전에 비어 있거나 진행 중이 아닌 수주 품목 */
export function reproductionPlanUnresolvedFields(row: Pick<SalesOrderItemBrief, 'salesOrderItemStatus'> | undefined): string[] {
  return row && OPEN_ITEM_STATUSES.includes(row.salesOrderItemStatus) ? [] : ['수주 품목'];
}

@Injectable()
export class ReproductionPlanAction implements ActionDefinition<ReproductionPlanDraftPayload> {
  readonly actionType = ACTION_TYPE.REPRODUCTION_PLAN_CREATE;
  readonly confirmer = 'DRAFT_CREATOR';
  readonly permission = PERMISSION.PRODUCTION_PLAN_CONFIRM;

  constructor(
    private readonly production: ProductionService,
    private readonly repository: MessageActionRepository,
  ) {}

  parse(raw: unknown): ReproductionPlanDraftPayload {
    return reproductionPlanPayloadOf(raw);
  }

  empty(sourceText: string | null): ReproductionPlanDraftPayload {
    return { salesOrderItemId: null, sourceText, aiFilledFields: [] };
  }

  async extractionGuide(tx: Tx): Promise<string> {
    const openItems = await this.repository.findSalesOrderItems(tx, { salesOrderItemStatus: { in: [...OPEN_ITEM_STATUSES] } }, EXTRACTION_CANDIDATE_LIMIT);
    return [
      '- salesOrderNo: 재생산할 수주번호. 아래 목록에 있는 번호만 쓴다',
      '- lineNo: 수주 안의 줄 번호(정수). 수주에 품목이 하나뿐이거나 모르면 null',
      '- itemCode: 그 줄의 규격 코드. 모르면 null',
      '재생산 매수는 고르지 않는다(실행 때 서버가 부족 매수를 다시 계산한다).',
      '',
      '진행 중 수주 품목 (수주번호 | 줄 번호 | 규격 코드 | 고객사 | 주문 매수 | 납기):',
      ...openItems.map(salesOrderItemGuideLine),
    ].join('\n');
  }

  async fromExtraction(tx: Tx, extracted: Record<string, unknown>, sourceText: string | null): Promise<ReproductionPlanDraftPayload> {
    const row = await salesOrderItemOf(tx, this.repository, extracted.salesOrderNo, extracted.itemCode, extracted.lineNo);
    return row ? { salesOrderItemId: row.id, sourceText, aiFilledFields: ['salesOrderItemId'] } : this.empty(sourceText);
  }

  async applyPatch(tx: Tx, current: ReproductionPlanDraftPayload, patch: Record<string, unknown>): Promise<ReproductionPlanDraftPayload> {
    rejectUnknownFields(patch, PATCH_FIELDS, '재생산 계획');
    const salesOrderItemId = idPatch(patch.salesOrderItemId, '수주 품목을 골라 주세요');
    if (salesOrderItemId === undefined) return current;
    if (salesOrderItemId !== null && !(await this.findItem(tx, salesOrderItemId))) throw new AppException('COM-003', '수주 품목을 찾을 수 없어요');
    return { ...current, salesOrderItemId };
  }

  async unresolvedFields(tx: Tx, payload: ReproductionPlanDraftPayload): Promise<string[]> {
    return reproductionPlanUnresolvedFields(await this.findItem(tx, payload.salesOrderItemId));
  }

  async assertCanExecute(): Promise<void> {}

  /** 예약·진행 계획·검사 대기 제품으로 이미 채워지면 실행이 늘 실패하므로 확정 전에 막는다 (재생산 계획 생성과 같은 판단) */
  async assertPayloadExecutable(tx: Tx, payload: ReproductionPlanDraftPayload): Promise<void> {
    const check = payload.salesOrderItemId === null ? null : await this.production.reproductionCheck(tx, payload.salesOrderItemId);
    if (!check || check.additionalPlanQty <= 0) throw new AppException('COM-001', '추가 계획이 필요하지 않아요 (예약·진행 계획·검사 대기 제품으로 채워져요)');
  }

  async payloadLabels(tx: Tx, payload: ReproductionPlanDraftPayload): Promise<Record<string, string>> {
    const row = await this.findItem(tx, payload.salesOrderItemId);
    return row ? { salesOrderItemId: salesOrderItemLabel(row) } : {};
  }

  async confirmReason(tx: Tx, payload: ReproductionPlanDraftPayload): Promise<string> {
    const labels = await this.payloadLabels(tx, payload);
    return `DRAFT_CONFIRMED: 재생산 계획 생성 확정 (${labels.salesOrderItemId ?? '수주 품목'})`;
  }

  /** 여재 예약만으로 채워지면 새 계획이 없으므로 결과는 그 수주 품목이다 */
  async execute(tx: Tx, draft: DraftRow, actor: AuthUser): Promise<ActionDraftResultView> {
    const p = reproductionPlanPayloadOf(draft.payload);
    if (p.salesOrderItemId === null) throw new AppException('ACT-001');
    const result = await this.production.createReproductionPlanInTx(tx, actor, p.salesOrderItemId, originOf(draft, p));
    if (result.plan) return { table: 'production_plan', id: result.plan.id, no: result.plan.productionPlanNo, status: result.plan.productionPlanStatus };
    const row = await this.findItem(tx, p.salesOrderItemId);
    return { table: 'sales_order_item', id: p.salesOrderItemId, no: row ? `${row.salesOrder.salesOrderNo} #${salesOrderItemLineNo(row)}` : String(p.salesOrderItemId), status: row?.salesOrderItemStatus ?? null };
  }

  resultOf(draft: DraftRow): ActionDraftResultView | null {
    return executedResultOf(draft);
  }

  private async findItem(tx: Tx, id: number | null): Promise<SalesOrderItemBrief | undefined> {
    if (id === null) return undefined;
    const [row] = await this.repository.findSalesOrderItems(tx, { id });
    return row;
  }
}
