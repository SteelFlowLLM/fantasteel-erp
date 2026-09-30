import { Injectable } from '@nestjs/common';
import { ERROR_CODE, PROCESS_CODE_LABEL, type AuthUser, type ProcessCode } from '@fantasteel/shared';
import { lockLots, lockRow } from '../../common/concurrency/locks';
import { AppException, badInput, invalidState, notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { StockService } from '../inventory/stock.service';
import { NotificationSender } from '../notification/notification.sender';
import type { CompleteProductionResultDto } from './dto/complete-production-result.dto';
import type { ListProductionResultsDto } from './dto/list-production-results.dto';
import { ProductionMaterialService } from './production-material.service';
import { ProductionPlanProgressService } from './production-plan-progress.service';
import { type PlanRow, ProductionRepository, type ResultRow } from './production.repository';
import { slabSpecOf, toResultView, type ResultView } from './production.view';
import { YieldCalculator } from './yield.calculator';

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

/** 누가·언제 한 작업인지. 시뮬레이션은 actor = null(SYSTEM), isSimulated = true, 시각을 직접 준다. */
export interface ResultContext {
  actor: AuthUser | null;
  at: Date;
  isSimulated?: boolean;
  /** 시뮬레이션이 연주에서 뽑은 손실률 (0~0.05) */
  sampledLossRate?: string;
}

interface Completion {
  data: Prisma.ProductionResultUncheckedUpdateInput;
  /** 실적 등록 이벤트 한 줄 */
  summary: string;
  /** 새로 만든 LOT + 투입한 LOT (LOT 타임라인용) */
  lotIds: number[];
  after: Record<string, unknown>;
}

@Injectable()
export class ProductionResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProductionRepository,
    private readonly yields: YieldCalculator,
    private readonly materials: ProductionMaterialService,
    private readonly progress: ProductionPlanProgressService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly realtime: RealtimeService,
  ) {}

  async list(q: ListProductionResultsDto): Promise<ResultView[]> {
    return this.listViews(this.prisma, { planId: q.planId, processCode: q.processCode, status: q.status });
  }

  /** 실적 목록. 끝나지 않은 제선 실적에는 그 계획에 아직 필요한 용선 톤을 붙인다. */
  async listViews(tx: Tx, filter: { planId?: number; processCode?: string; status?: string }): Promise<ResultView[]> {
    const rows = await this.repo.listResults(tx, filter);
    const needByPlan = new Map<number, Prisma.Decimal>();
    const out: ResultView[] = [];
    for (const r of rows) {
      let need: Prisma.Decimal | null = null;
      if (r.processCode === 'IRONMAKING' && r.productionResultStatus !== 'COMPLETED' && r.productionPlanId) {
        if (!needByPlan.has(r.productionPlanId)) {
          const plan = await this.repo.findPlan(tx, r.productionPlanId);
          if (plan) needByPlan.set(plan.id, await this.materials.remainingHotMetalNeedTon(tx, plan));
        }
        need = needByPlan.get(r.productionPlanId) ?? null;
      }
      out.push(toResultView(r, need));
    }
    return out;
  }

  start(id: number, user: AuthUser) {
    return this.prisma.tx(async (tx) => this.view(tx, (await this.startResult(tx, id, { actor: user, at: new Date() })).id));
  }

  complete(id: number, dto: CompleteProductionResultDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => this.view(tx, (await this.completeResult(tx, id, dto, { actor: user, at: new Date() })).id));
  }

  private async view(tx: Tx, id: number): Promise<ResultView> {
    const r = await this.repo.findResult(tx, id);
    if (!r) throw notFound('공정 실적');
    return toResultView(r);
  }

  // ───────────────────────────── 시작 ─────────────────────────────

  /** 작업 시작 (READY → STARTED). 계획의 첫 시작이면 계획을 IN_PROGRESS로 바꾼다. */
  async startResult(tx: Tx, id: number, ctx: ResultContext): Promise<ResultRow> {
    const { result, plan } = await this.load(tx, id);
    if (result.productionResultStatus !== 'READY') throw invalidState('대기 상태의 작업만 시작할 수 있습니다');
    if (result.processCode === 'CASTING') {
      const steel = plan.productionResults.find((r) => r.processCode === 'STEELMAKING' && r.heatSeq === result.heatSeq);
      if (steel?.productionResultStatus !== 'COMPLETED') throw invalidState(`${result.heatSeq}번 히트의 제강 실적을 먼저 등록해 주세요`);
    }
    await this.repo.updateResult(tx, id, { productionResultStatus: 'STARTED', startedAt: ctx.at, operatorEmployeeId: ctx.actor?.employeeId ?? null, isSimulated: ctx.isSimulated ?? false });
    await this.progress.markStarted(tx, plan);
    await this.events.record(tx, {
      actor: ctx.actor,
      eventType: 'WORK_STARTED',
      targetType: 'PRODUCTION_RESULT',
      targetId: id,
      targetNo: this.label(plan, result),
      salesOrderId: plan.salesOrderItem?.salesOrderId ?? null,
      summary: `${this.label(plan, result)} 작업 시작`,
      before: { productionResultStatus: 'READY' },
      after: { productionResultStatus: 'STARTED', startedAt: ctx.at },
      reasonCode: ctx.isSimulated ? 'SIMULATION' : null,
    });
    this.realtime.changed('production-results', 'production-plans');
    return (await this.repo.findResult(tx, id))!;
  }

  // ───────────────────────────── 완료 ─────────────────────────────

  /** 작업 완료·실적 등록 (STARTED → COMPLETED). 공정별로 투입을 차감하고 LOT·계보를 만든다. */
  async completeResult(tx: Tx, id: number, dto: CompleteProductionResultDto, ctx: ResultContext): Promise<ResultRow> {
    const { result, plan } = await this.load(tx, id);
    if (result.productionResultStatus !== 'STARTED') throw invalidState('작업 중인 실적만 완료할 수 있습니다. 먼저 작업을 시작해 주세요');
    const startedAt = result.startedAt ?? ctx.at;
    const at = ctx.at < startedAt ? startedAt : ctx.at;

    let done: Completion;
    switch (result.processCode as ProcessCode) {
      case 'IRONMAKING': done = await this.completeIronmaking(tx, plan, result, dto, startedAt, at); break;
      case 'STEELMAKING': done = await this.completeSteelmaking(tx, plan, result, dto, at); break;
      case 'CASTING': done = await this.completeCasting(tx, plan, result, dto, at, ctx); break;
      case 'HOT_ROLLING': done = await this.completeHotRolling(tx, plan, result, dto, at); break;
      default: throw invalidState('알 수 없는 공정입니다');
    }

    await this.repo.updateResult(tx, id, { ...done.data, productionResultStatus: 'COMPLETED', completedAt: at, isSimulated: ctx.isSimulated ?? result.isSimulated });
    const common = {
      actor: ctx.actor,
      targetType: 'PRODUCTION_RESULT' as const,
      targetId: id,
      targetNo: this.label(plan, result),
      salesOrderId: plan.salesOrderItem?.salesOrderId ?? null,
      lotIds: done.lotIds,
      reasonCode: ctx.isSimulated ? ('SIMULATION' as const) : null,
    };
    await this.events.record(tx, {
      ...common, eventType: 'WORK_COMPLETED', summary: `${this.label(plan, result)} 작업 완료`,
      before: { productionResultStatus: 'STARTED' }, after: { productionResultStatus: 'COMPLETED', startedAt, completedAt: at },
    });
    await this.events.record(tx, { ...common, eventType: 'RESULT_REGISTERED', summary: done.summary, after: done.after });

    await this.progress.refresh(tx, plan.id, ctx.actor);
    this.realtime.changed('production-results', 'production-plans', 'lots');
    return (await this.repo.findResult(tx, id))!;
  }

  /** 제선: 원료 LOT을 입고일 FIFO로 차감하고 용선 LOT을 만든다. 원료→용선은 기간 기반 연결. */
  private async completeIronmaking(tx: Tx, plan: PlanRow, result: ResultRow, dto: CompleteProductionResultDto, startedAt: Date, at: Date): Promise<Completion> {
    if (!dto.blastFurnaceNo) throw badInput('고로 번호를 입력해 주세요');
    const needTon = await this.materials.remainingHotMetalNeedTon(tx, plan);
    const hotMetalTon = dto.hotMetalTon !== undefined ? D(dto.hotMetalTon) : needTon;
    if (hotMetalTon.lte(0)) throw badInput(dto.hotMetalTon !== undefined ? '용선량은 0보다 커야 합니다' : '이 계획에는 용선이 더 필요하지 않습니다. 용선량을 직접 입력해 주세요');

    const consumed = await this.materials.consumeRaw(tx, await this.materials.ironmakingNeeds(tx, hotMetalTon), '원료가 부족해 제선 실적을 등록할 수 없습니다');
    const lot = await this.repo.createLot(tx, {
      lotNo: await this.numbering.hotMetalNo(tx, dto.blastFurnaceNo, at), lotType: 'HOT_METAL', initialTon: hotMetalTon, remainingTon: hotMetalTon,
      blastFurnaceNo: dto.blastFurnaceNo, productionPlanId: plan.id, productionResultId: result.id, producedAt: at,
    });
    await this.repo.createRelations(tx, consumed.map((c) => ({
      parentLotId: c.lotId, childLotId: lot.id, relationType: 'RAW_TO_HOT_METAL', evidenceType: 'PERIOD', inputTon: c.ton, periodStart: startedAt, periodEnd: at,
    })));
    const inputTon = consumed.reduce((s, c) => s.add(c.ton), D(0));

    // 필요한 양보다 적게 출선했으면 남은 양을 위한 제선 실적을 이어서 만든다.
    if (needTon.sub(hotMetalTon).gt(0)) await this.repo.createResult(tx, { productionPlanId: plan.id, processCode: 'IRONMAKING' });
    return {
      data: { blastFurnaceNo: dto.blastFurnaceNo, inputTon, outputTon: hotMetalTon },
      summary: `용선 ${lot.lotNo} ${hotMetalTon.toFixed(3)}t 생산 (원료 ${inputTon.toFixed(3)}t 투입)`,
      lotIds: [lot.id, ...consumed.map((c) => c.lotId)],
      after: { hotMetalNo: lot.lotNo, hotMetalTon, inputTon, rawMaterialLots: consumed.map((c) => ({ lotNo: c.lotNo, inputTon: c.ton })) },
    };
  }

  /** 제강: 계획의 용선 LOT(FIFO)과 합금철 LOT을 차감하고 히트 LOT을 만든다. 성분 검사 대기. */
  private async completeSteelmaking(tx: Tx, plan: PlanRow, result: ResultRow, dto: CompleteProductionResultDto, at: Date): Promise<Completion> {
    if (!dto.converterNo) throw badInput('전로 번호를 입력해 주세요');
    if (!result.heatSeq) throw invalidState('히트 순번이 없는 제강 실적입니다');
    const heatTon = await this.yields.heatCapacityTon(tx);
    const hotMetalNeed = await this.materials.hotMetalTonForHeat(tx, plan, result.heatSeq);
    const hotLots = await this.repo.planHotMetalLots(tx, plan.id);
    await lockLots(tx, hotLots.map((l) => l.id));
    const onHand = hotLots.reduce((s, l) => s.add(l.remainingTon ?? 0), D(0));
    if (onHand.lt(hotMetalNeed)) {
      throw invalidState(`용선이 ${hotMetalNeed.sub(onHand).toFixed(3)}t 부족합니다 (필요 ${hotMetalNeed.toFixed(3)}t, 잔량 ${onHand.toFixed(3)}t). 제선 실적을 먼저 등록해 주세요`);
    }
    // 합금철은 부족하면 여기서 멈춘다 (용선을 차감하기 전).
    const alloys = await this.materials.consumeRaw(tx, await this.materials.alloyNeeds(tx, plan.steelGradeId, heatTon), '합금철이 부족해 제강 실적을 등록할 수 없습니다');

    const usedHot: { lotId: number; lotNo: string; ton: Prisma.Decimal }[] = [];
    let rest = hotMetalNeed;
    for (const l of hotLots) {
      if (rest.lte(0)) break;
      const take = Prisma.Decimal.min(rest, l.remainingTon ?? 0);
      const left = (l.remainingTon ?? D(0)).sub(take);
      await this.repo.updateLot(tx, l.id, left.lte(0) ? { remainingTon: 0, lotStatus: 'CONSUMED', consumedAt: at } : { remainingTon: left });
      usedHot.push({ lotId: l.id, lotNo: l.lotNo, ton: take });
      rest = rest.sub(take);
    }

    const heat = await this.repo.createLot(tx, {
      lotNo: await this.numbering.heatNo(tx, dto.converterNo, at), lotType: 'HEAT', steelGradeId: plan.steelGradeId, initialTon: heatTon, converterNo: dto.converterNo,
      productionPlanId: plan.id, productionResultId: result.id, isPassed: null, producedAt: at,
    });
    await this.repo.createRelations(tx, [
      ...usedHot.map((h) => ({ parentLotId: h.lotId, childLotId: heat.id, relationType: 'HOT_METAL_TO_HEAT', evidenceType: 'DIRECT', inputTon: h.ton })),
      ...alloys.map((a) => ({ parentLotId: a.lotId, childLotId: heat.id, relationType: 'ALLOY_TO_HEAT', evidenceType: 'DIRECT', inputTon: a.ton })),
    ]);
    await this.notifications.toRole(tx, 'QUALITY', {
      notificationType: 'QUALITY',
      title: `히트 ${heat.lotNo} 성분 검사 대기`,
      body: `${plan.productionPlanNo} ${plan.steelGrade.steelGradeCode} ${result.heatSeq}번 히트`,
      linkPath: `/quality/inspections?lot=${heat.id}`,
      dedupeKey: `INSPECTION_WAITING:${heat.id}`,
    });
    const alloyTon = alloys.reduce((s, a) => s.add(a.ton), D(0));
    return {
      data: { converterNo: dto.converterNo, inputTon: hotMetalNeed, outputTon: heatTon },
      summary: `히트 ${heat.lotNo} ${heatTon.toFixed(3)}t 생산 (용선 ${hotMetalNeed.toFixed(3)}t, 합금철 ${alloyTon.toFixed(3)}t 투입)`,
      lotIds: [heat.id, ...usedHot.map((h) => h.lotId), ...alloys.map((a) => a.lotId)],
      after: {
        heatNo: heat.lotNo, heatTon, hotMetalLots: usedHot.map((h) => ({ lotNo: h.lotNo, inputTon: h.ton })), alloyLots: alloys.map((a) => ({ lotNo: a.lotNo, inputTon: a.ton })),
      },
    };
  }

  /** 연주: 히트 1개에서 슬래브를 매별 LOT으로 만든다 (히트번호-SS). 히트는 소진 처리. 슬래브 검사 대기. */
  private async completeCasting(tx: Tx, plan: PlanRow, result: ResultRow, dto: CompleteProductionResultDto, at: Date, ctx: ResultContext): Promise<Completion> {
    const plannedQty = result.plannedQty ?? 0;
    if (dto.outputQty === undefined) throw badInput('슬래브 생산 매수를 입력해 주세요');
    if (dto.outputQty > plannedQty) throw badInput(`슬래브 생산 매수는 히트당 계획 매수(${plannedQty}매)를 넘을 수 없습니다`);
    const steel = plan.productionResults.find((r) => r.processCode === 'STEELMAKING' && r.heatSeq === result.heatSeq);
    const heat = steel ? await this.repo.heatLotOfResult(tx, steel.id) : null;
    if (!heat) throw invalidState(`${result.heatSeq}번 히트의 제강 실적을 먼저 등록해 주세요`);
    const slabSpec = slabSpecOf(plan);
    if (!slabSpec) throw new AppException(ERROR_CODE.MST_001, '코일 규격에 대응하는 슬래브 규격 매핑이 없습니다');
    await lockLots(tx, [heat.id]);

    const slabs: { id: number; lotNo: string }[] = [];
    for (let seq = 1; seq <= dto.outputQty; seq++) {
      slabs.push(await this.repo.createLot(tx, {
        lotNo: this.numbering.slabNo(heat.lotNo, seq), lotType: 'SLAB', productSpecId: slabSpec.id, steelGradeId: plan.steelGradeId, heatLotId: heat.id, yardId: slabSpec.yardId,
        productionPlanId: plan.id, productionResultId: result.id, salesOrderItemId: plan.salesOrderItemId, isPassed: null, producedAt: at,
      }));
    }
    await this.repo.createRelations(tx, slabs.map((s) => ({ parentLotId: heat.id, childLotId: s.id, relationType: 'HEAT_TO_SLAB', evidenceType: 'DIRECT' })));
    await this.repo.updateLot(tx, heat.id, { lotStatus: 'CONSUMED', consumedAt: at });
    if (slabs.length) {
      await this.notifications.toRole(tx, 'QUALITY', {
        notificationType: 'QUALITY',
        title: `슬래브 ${slabs.length}매 검사 대기`,
        body: `${plan.productionPlanNo} 히트 ${heat.lotNo}`,
        linkPath: `/quality/inspections?lot=${slabs[0].id}`,
        dedupeKey: `INSPECTION_WAITING:${slabs[0].id}`,
      });
    }
    const lossQty = plannedQty - dto.outputQty;
    const outputTon = slabSpec.theoreticalWeightTon.mul(dto.outputQty);
    return {
      data: { outputQty: dto.outputQty, lossQty, sampledLossRate: ctx.sampledLossRate ?? null, inputTon: heat.initialTon, outputTon },
      summary: `히트 ${heat.lotNo} 연주: 슬래브 ${dto.outputQty}매 생산 (계획 ${plannedQty}매, 손실 ${lossQty}매)`,
      lotIds: [heat.id, ...slabs.map((s) => s.id)],
      after: { heatNo: heat.lotNo, plannedQty, outputQty: dto.outputQty, lossQty, sampledLossRate: ctx.sampledLossRate ?? null, slabNos: slabs.map((s) => s.lotNo) },
    };
  }

  /**
   * 열연: 이 계획의 CONFIRMED 열연 배정(선택분 또는 전부)을 투입해 슬래브 1매당 코일 1개를 만든다 (C + 슬래브번호).
   * 목표 매수에 못 미치면 남은 매수의 열연 실적을 이어서 만든다 (여러 번에 나눠 등록).
   */
  private async completeHotRolling(tx: Tx, plan: PlanRow, result: ResultRow, dto: CompleteProductionResultDto, at: Date): Promise<Completion> {
    let allocations = await this.repo.rollingAllocations(tx, plan.id, 'CONFIRMED');
    if (dto.allocationIds) {
      const wanted = new Set(dto.allocationIds);
      allocations = allocations.filter((a) => wanted.has(a.id));
      if (allocations.length !== wanted.size) throw badInput('이 계획의 확정된 열연 배정이 아닌 것이 섞여 있습니다');
    }
    if (!allocations.length) throw invalidState('배정 확정된 슬래브가 없습니다. 열연 투입 슬래브를 먼저 배정해 주세요');
    const plannedQty = result.plannedQty ?? plan.shortageQty;
    if (allocations.length > plannedQty) throw badInput(`필요 매수(${plannedQty}개)보다 많은 슬래브를 투입할 수 없습니다`);
    await lockLots(tx, allocations.map((a) => a.lotId));

    const coils: { id: number; lotNo: string }[] = [];
    const relations: Prisma.LotRelationCreateManyInput[] = [];
    let inputTon = D(0);
    let outputTon = D(0);
    for (const a of allocations) {
      const slab = a.lot;
      const coilSpec = slab.productSpec?.slabMapping?.coilSpec;
      if (!coilSpec || coilSpec.id !== plan.productSpecId) throw badInput(`${slab.lotNo}: 이 계획의 코일 규격에 대응하는 슬래브가 아닙니다`);
      await this.stock.consumeForRolling(tx, a.id);
      const coil = await this.repo.createLot(tx, {
        lotNo: this.numbering.coilNo(slab.lotNo), lotType: 'COIL', productSpecId: coilSpec.id, steelGradeId: slab.steelGradeId, heatLotId: slab.heatLotId, yardId: coilSpec.yardId,
        productionPlanId: plan.id, productionResultId: result.id, salesOrderItemId: plan.salesOrderItemId, isPassed: null, producedAt: at,
      });
      coils.push(coil);
      relations.push({ parentLotId: slab.id, childLotId: coil.id, relationType: 'SLAB_TO_COIL', evidenceType: 'DIRECT' });
      inputTon = inputTon.add(slab.productSpec?.theoreticalWeightTon ?? 0);
      outputTon = outputTon.add(coilSpec.theoreticalWeightTon);
    }
    await this.repo.createRelations(tx, relations);

    const rolledQty = await this.repo.countPlanCoils(tx, plan.id);
    if (rolledQty < plan.shortageQty) await this.repo.createResult(tx, { productionPlanId: plan.id, processCode: 'HOT_ROLLING', plannedQty: plan.shortageQty - rolledQty });
    await this.notifications.toRole(tx, 'QUALITY', {
      notificationType: 'QUALITY',
      title: `코일 ${coils.length}개 검사 대기`,
      body: `${plan.productionPlanNo} 열연`,
      linkPath: `/quality/inspections?lot=${coils[0].id}`,
      dedupeKey: `INSPECTION_WAITING:${coils[0].id}`,
    });
    return {
      data: { outputQty: coils.length, lossQty: 0, inputTon, outputTon },
      summary: `열연: 슬래브 ${allocations.length}매 투입 → 코일 ${coils.length}개 생산`,
      lotIds: [...allocations.map((a) => a.lotId), ...coils.map((c) => c.id)],
      after: { outputQty: coils.length, rolledQty, targetQty: plan.shortageQty, coils: allocations.map((a, i) => ({ slabNo: a.lot.lotNo, coilNo: coils[i].lotNo })) },
    };
  }

  // ───────────────────────────── 공통 ─────────────────────────────

  /** 계획 행을 잠가 같은 계획의 실적 등록이 겹치지 않게 한 뒤 읽는다. */
  private async load(tx: Tx, id: number): Promise<{ result: ResultRow; plan: PlanRow }> {
    const found = await this.repo.findResult(tx, id);
    if (!found?.productionPlanId) throw notFound('공정 실적');
    await lockRow(tx, 'production_plan', found.productionPlanId);
    const result = await this.repo.findResult(tx, id);
    const plan = await this.repo.findPlan(tx, found.productionPlanId);
    if (!result || !plan) throw notFound('공정 실적');
    if (!['CONFIRMED', 'IN_PROGRESS'].includes(plan.productionPlanStatus)) throw invalidState('편성 확정·생산 중인 계획의 실적만 등록할 수 있습니다');
    return { result, plan };
  }

  private label(plan: PlanRow, result: { processCode: string; heatSeq: number | null }): string {
    const process = PROCESS_CODE_LABEL[result.processCode as ProcessCode] ?? result.processCode;
    return `${plan.productionPlanNo} ${process}${result.heatSeq ? ` ${result.heatSeq}번 히트` : ''}`;
  }
}
