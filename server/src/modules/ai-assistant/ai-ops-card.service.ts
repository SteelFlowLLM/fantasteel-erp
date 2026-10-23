import { Injectable } from '@nestjs/common';
import {
  isOrderableQty,
  orderedQtyIssueOf,
  PAST_CASE_CATEGORY,
  PERMISSION,
  PERMISSION_LABEL,
  type AiActionCardExecuteResult,
  type AiHeatPlanCard,
  type AiHotRollingCard,
  type AiPastCaseCard,
  type AiSalesOrderCard,
  type AiSalesOrderCardLine,
  type AuthUser,
  type Permission,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { runAsAiAssisted } from '../../common/business-event/ai-assisted.context';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { validDate } from '../meeting-minutes/meeting-analysis.validator';
import { PastCaseService } from '../past-case/past-case.service';
import { HotRollingService } from '../production/hot-rolling.service';
import { ProductionService } from '../production/production.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { AiAssistantRepository } from './ai-assistant.repository';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { optionalString, requiredString, ToolArgumentError } from './tools/assistant-tool';

/** 수주 카드 한 장의 품목 줄 수 상한 (가정값). 작은 모델이 줄을 지어내는 것을 막는다 */
const LINE_MAX = 10;
const ISSUE = {
  customer: '고객사를 정해 주세요',
  customerNotFound: (name: string) => `고객사 "${name}"을(를) 찾지 못했어요`,
  item: (n: number) => `${n}번째 줄의 규격을 정해 주세요`,
  qty: orderedQtyIssueOf,
  dueDate: (n: number) => `${n}번째 줄의 납기를 확인해 주세요 (오늘부터 1년 안)`,
  lines: '품목 줄을 하나 이상 넣어 주세요',
} as const;

type Lookup = { id: number; code: string; name: string };

/** 이름·코드로 하나만 맞을 때만 id를 돌려준다: 정확히 같은 것 → 부분 일치가 하나뿐인 것 */
function matchOne(query: string, rows: readonly Lookup[]): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (q.length < 2) return null;
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const exact = rows.filter((r) => squash(r.name) === q || squash(r.code) === q);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;
  const partial = rows.filter((r) => squash(r.name).includes(q) || squash(r.code).includes(q));
  return partial.length === 1 ? partial[0].id : null;
}

/**
 * AI 어시스턴트 실행 카드 중 기존 업무 화면의 확정 기능을 그대로 부르는 것 (REQ-AST-005): 수주 등록, 열연 배정, 히트 편성 확정, 과거 사례 등록.
 * 카드는 제안(조회)만 하고 서버에 저장하지 않는다. 사용자가 [실행]하면 같은 API가 하는 권한 확인(@RequirePermission USE)을 여기서 하고,
 * 업무 규칙·검증·작업 로그는 각 모듈 service가 한다(새 규칙을 만들지 않는다).
 */
@Injectable()
export class AiOpsCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiAssistantRepository,
    private readonly salesOrders: SalesOrderService,
    private readonly hotRolling: HotRollingService,
    private readonly production: ProductionService,
    private readonly pastCases: PastCaseService,
  ) {}

  // ── 제안 (조회만) ─────────────────────────────────────────

  async proposeSalesOrder(user: AuthUser, args: Record<string, unknown>): Promise<Omit<AiSalesOrderCard, 'key'>> {
    this.requireUse(user, PERMISSION.SALES_ORDER_CREATE, 'ToolArgument');
    const today = seoulToday();
    const customerName = optionalString(args, 'customerName', 100) ?? null;
    const customers = (await this.repository.findCustomers(this.prisma)).map((c) => ({ id: c.id, code: c.customerCode, name: c.customerName }));
    const customerId = customerName === null ? null : matchOne(customerName, customers);
    const products = (await this.repository.findProducts(this.prisma)).map((i) => ({ id: i.id, code: i.itemCode, name: i.itemName }));
    const rawLines = (Array.isArray(args.lines) ? args.lines : []).slice(0, LINE_MAX);

    const issues: string[] = [];
    if (customerName === null) issues.push(ISSUE.customer);
    else if (customerId === null) issues.push(ISSUE.customerNotFound(customerName));
    if (rawLines.length === 0) issues.push(ISSUE.lines);
    const lines = rawLines.map((raw, index): AiSalesOrderCardLine => {
      const line = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
      const itemText = typeof line.itemName === 'string' ? line.itemName.trim().slice(0, 100) : '';
      const itemId = itemText ? matchOne(itemText, products) : null;
      const found = products.find((p) => p.id === itemId);
      const qty = isOrderableQty(line.orderedQty) ? line.orderedQty : null;
      const dueDate = validDate(typeof line.dueDate === 'string' ? line.dueDate.trim() : undefined, today);
      if (itemId === null) issues.push(ISSUE.item(index + 1));
      if (qty === null) issues.push(ISSUE.qty(index + 1));
      if (dueDate === null) issues.push(ISSUE.dueDate(index + 1));
      return { itemId, itemLabel: found ? `${found.code} · ${found.name}` : itemText || null, orderedQty: qty, dueDate };
    });
    const customerLabel = customers.find((c) => c.id === customerId)?.name ?? customerName;
    return { kind: 'SALES_ORDER', title: `수주 등록 · ${customerLabel ?? '고객사 미정'}`, customerId, customerName: customerLabel, lines, issues };
  }

  async proposeHotRolling(user: AuthUser, args: Record<string, unknown>): Promise<Omit<AiHotRollingCard, 'key'>> {
    this.requireUse(user, PERMISSION.HOT_ROLLING_ALLOCATE, 'ToolArgument');
    const planNo = requiredString(args, 'productionPlanNo', 30).toUpperCase();
    const plan = await this.repository.findProductionPlanByNo(this.prisma, planNo);
    if (!plan) throw new ToolArgumentError(`생산계획 ${planNo}을(를) 찾을 수 없어요`);
    // 추천은 저장하지 않는 조회다. 작업 로그(ALLOCATION_RECOMMENDED)를 남기는 recommend는 사용자가 화면에서 누를 때의 일이다
    const detail = await this.hotRolling.detail(plan.id);
    if (!detail.isRollable) throw new ToolArgumentError(detail.notRollableReason ?? '열연할 수 없는 계획이에요');
    if (detail.neededQty === 0) throw new ToolArgumentError('더 배정할 슬래브가 없어요');
    const recommended = detail.candidates.filter((c) => c.isRecommended);
    if (recommended.length === 0) throw new ToolArgumentError(`배정할 수 있는 슬래브(${detail.slabItemCode})의 가용 재고가 없어요`);
    return {
      kind: 'HOT_ROLLING',
      title: `열연 배정 · ${detail.plan.productionPlanNo}`,
      productionPlanId: plan.id,
      productionPlanNo: detail.plan.productionPlanNo,
      itemLabel: `${detail.slabItem.itemCode} · ${detail.slabItem.itemName}`,
      neededQty: detail.neededQty,
      availableQty: detail.slabPool.availableQty,
      lots: recommended.map((c) => ({ lotId: c.lotId, lotNo: c.lotNo, producedDate: c.producedDate, heatNo: c.heatNo })),
      issues: [],
    };
  }

  async proposeHeatPlan(user: AuthUser, args: Record<string, unknown>): Promise<Omit<AiHeatPlanCard, 'key'>> {
    this.requireUse(user, PERMISSION.PRODUCTION_PLAN_CONFIRM, 'ToolArgument');
    const planNo = requiredString(args, 'productionPlanNo', 30).toUpperCase();
    const plan = await this.repository.findProductionPlanByNo(this.prisma, planNo);
    if (!plan) throw new ToolArgumentError(`생산계획 ${planNo}을(를) 찾을 수 없어요`);
    const detail = await this.production.getPlanDetail(plan.id);
    if (detail.productionPlanStatus !== 'PLANNED') throw new ToolArgumentError('작업을 시작한 계획은 히트 편성을 바꿀 수 없어요');
    const formation = await this.production.previewHeatPlan(plan.id);
    return {
      kind: 'HEAT_PLAN',
      title: `히트 편성 확정 · ${detail.productionPlanNo}`,
      productionPlanId: plan.id,
      productionPlanNo: detail.productionPlanNo,
      itemLabel: `${detail.itemCode} · ${detail.itemName}`,
      shortageQty: detail.shortageQty,
      currentHeatCount: detail.heatCount,
      newHeatCount: formation.heatCount,
      heatTon: formation.heatTon,
      requiredMoltenSteelTon: formation.requiredMoltenSteelTon,
      issues: formation.heatCount === detail.heatCount ? ['히트 수는 그대로예요. 확정하면 확정 이력만 남아요'] : [],
    };
  }

  async proposePastCase(user: AuthUser, args: Record<string, unknown>): Promise<Omit<AiPastCaseCard, 'key'>> {
    this.requireUse(user, PERMISSION.DISPOSITION_SET, 'ToolArgument');
    const lotNo = requiredString(args, 'lotNo', 40);
    const lot = await this.repository.findLotByNo(this.prisma, lotNo);
    if (!lot) throw new ToolArgumentError(`LOT ${lotNo}을(를) 찾을 수 없어요`);
    let draft;
    try {
      draft = await this.pastCases.createDraft(lot.id);
    } catch (error) {
      if (error instanceof AppException) throw new ToolArgumentError(error.message);
      throw error;
    }
    const issues = [...(draft.aiNotice ? [draft.aiNotice] : []), ...(draft.cause.trim() === '' ? ['원인을 확인해 주세요'] : []), ...(draft.actionTaken.trim() === '' ? ['조치를 확인해 주세요'] : [])];
    return {
      kind: 'PAST_CASE',
      title: draft.title,
      lotId: draft.lot.lotId,
      lotNo: draft.lot.lotNo,
      caseCategory: draft.caseCategory,
      phenomenon: draft.phenomenon,
      cause: draft.cause,
      actionTaken: draft.actionTaken,
      equipmentText: draft.equipmentText,
      occurredDate: draft.occurredDate,
      aiWritten: draft.aiWritten,
      referenceCaseNos: draft.referenceCaseNos,
      issues,
    };
  }

  // ── 실행 (사용자가 [실행]을 눌렀을 때) ──────────────────────

  async execute(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    switch (dto.kind) {
      case 'SALES_ORDER':
        return this.executeSalesOrder(user, dto);
      case 'HOT_ROLLING':
        return this.executeHotRolling(user, dto);
      case 'HEAT_PLAN':
        return this.executeHeatPlan(user, dto);
      case 'PAST_CASE':
        return this.executePastCase(user, dto);
      default:
        throw new AppException('COM-004', '카드 종류가 올바르지 않아요');
    }
  }

  private async executeSalesOrder(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    this.requireUse(user, PERMISSION.SALES_ORDER_CREATE);
    const missing: string[] = [];
    if (dto.customerId === undefined) missing.push('고객사');
    const lines = dto.lines ?? [];
    if (lines.length === 0) missing.push('품목');
    lines.forEach((line, index) => {
      if (line.itemId === undefined) missing.push(`${index + 1}번째 줄 규격`);
      if (line.orderedQty === undefined) missing.push(`${index + 1}번째 줄 매수`);
      if (line.dueDate === undefined) missing.push(`${index + 1}번째 줄 납기`);
    });
    if (missing.length > 0 || dto.customerId === undefined) throw new AppException('ACT-001', `채워야 할 칸: ${missing.join(', ')}`);
    const today = seoulToday();
    for (const [index, line] of lines.entries()) {
      if (validDate(line.dueDate, today) === null) throw new AppException('COM-004', `${index + 1}번째 줄 납기는 오늘부터 1년 안의 날짜로 입력해 주세요`);
    }
    // 매수·규격·고객사 검증, 예약, 부족분 생산계획, 작업 로그는 수주 등록 service가 한다. 그 로그는 AI 경유로 남는다(REQ-AST-010)
    const customerId = dto.customerId;
    const result = await runAsAiAssisted(() => this.salesOrders.create(user, {
      customerId,
      items: lines.map((line) => ({ itemId: line.itemId as number, orderedQty: line.orderedQty, dueDate: line.dueDate as string })),
    }));
    return { kind: 'SALES_ORDER', registered: { type: 'sales_order', id: result.salesOrderId, no: result.salesOrderNo } };
  }

  private async executeHotRolling(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    this.requireUse(user, PERMISSION.HOT_ROLLING_ALLOCATE);
    if (dto.productionPlanId === undefined || !dto.lotIds || dto.lotIds.length === 0) throw new AppException('ACT-001', '채워야 할 칸: 생산계획, 배정할 슬래브');
    const planId = dto.productionPlanId;
    const lotIds = [...new Set(dto.lotIds)];
    const detail = await runAsAiAssisted(() => this.hotRolling.confirm(user, planId, { lotIds }));
    return { kind: 'HOT_ROLLING', registered: { type: 'hot_rolling', id: dto.productionPlanId, no: detail.plan.productionPlanNo } };
  }

  private async executeHeatPlan(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    this.requireUse(user, PERMISSION.PRODUCTION_PLAN_CONFIRM);
    if (dto.productionPlanId === undefined) throw new AppException('ACT-001', '채워야 할 칸: 생산계획');
    const planId = dto.productionPlanId;
    const detail = await runAsAiAssisted(() => this.production.confirmHeatPlan(user, planId));
    return { kind: 'HEAT_PLAN', registered: { type: 'heat_plan', id: dto.productionPlanId, no: detail.productionPlanNo } };
  }

  private async executePastCase(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    this.requireUse(user, PERMISSION.DISPOSITION_SET);
    const missing = [
      ...(dto.lotId === undefined ? ['관련 LOT'] : []),
      ...(!dto.title?.trim() ? ['제목'] : []),
      ...(!dto.phenomenon?.trim() ? ['현상'] : []),
      ...(dto.occurredDate === undefined ? ['발생일'] : []),
      ...(dto.caseCategory === undefined ? ['구분'] : []),
    ];
    if (missing.length > 0 || dto.lotId === undefined || dto.caseCategory === undefined || dto.occurredDate === undefined) throw new AppException('ACT-001', `채워야 할 칸: ${missing.join(', ')}`);
    // 작업 로그(CASE_REGISTERED)가 AI 경유로 남는다 (REQ-AST-010, 다른 카드와 같다)
    const { lotId, occurredDate } = dto;
    const created = await runAsAiAssisted(() => this.pastCases.create(user, {
      caseCategory: dto.caseCategory === 'EQUIPMENT' ? PAST_CASE_CATEGORY.EQUIPMENT : PAST_CASE_CATEGORY.QUALITY,
      title: (dto.title ?? '').trim(),
      phenomenon: (dto.phenomenon ?? '').trim(),
      cause: (dto.cause ?? '').trim(),
      actionTaken: (dto.actionTaken ?? '').trim(),
      equipmentText: (dto.equipmentText ?? '').trim(),
      occurredDate,
      lotIds: [lotId],
    }));
    return { kind: 'PAST_CASE', registered: { type: 'past_case', id: created.id, no: created.caseNo } };
  }

  /** 같은 API의 @RequirePermission(…, 'USE')와 같은 확인. 제안할 때는 모델에 이유를 돌려주고, 실행할 때는 COM-002로 거절한다 */
  private requireUse(user: AuthUser, permission: Permission, mode: 'ToolArgument' | 'Exception' = 'Exception'): void {
    if (hasPermission(user, { permission, level: 'USE' })) return;
    const message = `'${PERMISSION_LABEL[permission]}' 사용 권한이 없어요`;
    if (mode === 'ToolArgument') throw new ToolArgumentError(message);
    throw new AppException('COM-002', message);
  }
}
