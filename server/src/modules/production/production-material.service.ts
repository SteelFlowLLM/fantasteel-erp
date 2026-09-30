import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODE } from '@fantasteel/shared';
import { lockRawMaterialInventory } from '../../common/concurrency/locks';
import { AppException } from '../../common/errors/app.exception';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { type PlanRow, ProductionRepository } from './production.repository';
import { YieldCalculator } from './yield.calculator';

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

export interface RawNeed { rawMaterialId: number; materialName: string; needTon: Prisma.Decimal }
export interface RawShortage extends RawNeed { remainingTon: Prisma.Decimal; shortageTon: Prisma.Decimal }
export interface RawConsumption { rawMaterialId: number; lotId: number; lotNo: string; ton: Prisma.Decimal }

/** 원료가 모자랄 때의 오류 (409). 어떤 원료가 몇 톤 부족한지 메시지에 적는다. */
export function rawShortageError(prefix: string, shortages: RawShortage[]): AppException {
  const detail = shortages
    .map((s) => `${s.materialName} ${s.shortageTon.toFixed(3)}t 부족(필요 ${s.needTon.toFixed(3)}t, 잔량 ${s.remainingTon.toFixed(3)}t)`)
    .join(', ');
  return new AppException(ERROR_CODE.COM_005, `${prefix}: ${detail}. 구매요청으로 원료를 확보한 뒤 다시 진행해 주세요`, HttpStatus.CONFLICT);
}

/** 용선·원료·합금철 투입량 계산과 원료 LOT 차감 (REQ-LOT-004, 입고일 FIFO). */
@Injectable()
export class ProductionMaterialService {
  constructor(
    private readonly repo: ProductionRepository,
    private readonly yields: YieldCalculator,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * 히트 1개에 투입할 용선(t) = 히트 용량 ÷ 제강 수율 (소수 3자리).
   * 마지막 히트는 계획 전체 필요 용선(YieldCalculator와 같은 값)에서 앞 히트 몫을 뺀 나머지를 써서 합계가 어긋나지 않게 한다.
   */
  async hotMetalTonForHeat(tx: Tx, plan: PlanRow, heatSeq: number): Promise<Prisma.Decimal> {
    const itemType = plan.productSpec.item.itemType as 'SLAB' | 'COIL';
    const y = (await this.yields.routingYields(tx, itemType)).steelmaking;
    const cap = await this.yields.heatCapacityTon(tx);
    const perHeat = cap.div(y).toDecimalPlaces(3);
    if (heatSeq < plan.heatCount) return perHeat;
    return cap.mul(plan.heatCount).div(y).toDecimalPlaces(3).sub(perHeat.mul(plan.heatCount - 1));
  }

  /** 이 계획에 아직 더 만들어야 하는 용선(t) = 남은 히트의 투입량 − 계획 용선 LOT 잔량. */
  async remainingHotMetalNeedTon(tx: Tx, plan: PlanRow): Promise<Prisma.Decimal> {
    let need = D(0);
    for (const r of plan.productionResults) {
      if (r.processCode === 'STEELMAKING' && r.productionResultStatus !== 'COMPLETED' && r.heatSeq) need = need.add(await this.hotMetalTonForHeat(tx, plan, r.heatSeq));
    }
    const onHand = (await this.repo.planHotMetalLots(tx, plan.id)).reduce((s, l) => s.add(l.remainingTon ?? 0), D(0));
    return Prisma.Decimal.max(0, need.sub(onHand));
  }

  /** 제선: 철광석·석탄·석회석 = 용선(t) × 원단위(t/t). */
  async ironmakingNeeds(tx: Tx, hotMetalTon: Prisma.Decimal): Promise<RawNeed[]> {
    const rates = await this.repo.ironmakingRates(tx);
    if (!rates.length) throw new AppException(ERROR_CODE.MST_001, '제선 배합 원단위가 등록되어 있지 않습니다');
    return rates.map((r) => ({ rawMaterialId: r.rawMaterialId, materialName: r.rawMaterial.item.itemName, needTon: hotMetalTon.mul(r.consumptionRate).toDecimalPlaces(3) }));
  }

  /** 제강: 합금철 = 히트 톤 × 강종별 원단위(kg/t) ÷ 1,000. */
  async alloyNeeds(tx: Tx, steelGradeId: number, heatTon: Prisma.Decimal): Promise<RawNeed[]> {
    const rates = await this.repo.alloyRates(tx, steelGradeId);
    return rates.map((r) => ({ rawMaterialId: r.rawMaterialId, materialName: r.rawMaterial.item.itemName, needTon: heatTon.mul(r.consumptionRate).div(1000).toDecimalPlaces(3) }));
  }

  /** 원료 LOT 잔량으로 부족 여부만 본다 (변경 없음). 같은 원료가 여러 번 나오면 합쳐서 본다. */
  async findShortages(tx: Tx, needs: RawNeed[]): Promise<RawShortage[]> {
    const merged = new Map<number, RawNeed>();
    for (const n of needs) {
      const prev = merged.get(n.rawMaterialId);
      merged.set(n.rawMaterialId, prev ? { ...prev, needTon: prev.needTon.add(n.needTon) } : n);
    }
    const out: RawShortage[] = [];
    for (const n of merged.values()) {
      const remainingTon = await this.repo.rawRemainingTon(tx, n.rawMaterialId);
      if (remainingTon.lt(n.needTon)) out.push({ ...n, remainingTon, shortageTon: n.needTon.sub(remainingTon) });
    }
    return out;
  }

  /**
   * 원료 LOT을 입고일 FIFO로 차감한다. 하나라도 모자라면 아무것도 바꾸지 않고 오류를 낸다 (잔량은 음수가 될 수 없다).
   * lot.remaining_ton과 inventory.on_hand_ton을 같은 트랜잭션에서 맞춘다.
   */
  async consumeRaw(tx: Tx, needs: RawNeed[], shortagePrefix: string): Promise<RawConsumption[]> {
    const sorted = [...needs].filter((n) => n.needTon.gt(0)).sort((a, b) => a.rawMaterialId - b.rawMaterialId);
    for (const n of sorted) await lockRawMaterialInventory(tx, n.rawMaterialId);
    const shortages = await this.findShortages(tx, sorted);
    if (shortages.length) throw rawShortageError(shortagePrefix, shortages);

    const out: RawConsumption[] = [];
    const now = new Date();
    for (const n of sorted) {
      let rest = n.needTon;
      for (const lot of await this.repo.rawLotsFifo(tx, n.rawMaterialId)) {
        if (rest.lte(0)) break;
        const take = Prisma.Decimal.min(rest, lot.remainingTon ?? 0);
        if (take.lte(0)) continue;
        const left = (lot.remainingTon ?? D(0)).sub(take);
        await this.repo.updateLot(tx, lot.id, left.lte(0) ? { remainingTon: 0, lotStatus: 'CONSUMED', consumedAt: now } : { remainingTon: left });
        out.push({ rawMaterialId: n.rawMaterialId, lotId: lot.id, lotNo: lot.lotNo, ton: take });
        rest = rest.sub(take);
      }
      // StockService.adjustRawMaterialTon은 음수 증감이면 실패한다 (upsert의 INSERT 후보 행이 on_hand_ton ≥ 0 CHECK에 먼저 걸림).
      // 핵심 서비스가 고쳐질 때까지 차감만 여기서 직접 한다. 재고 행은 위 lockRawMaterialInventory가 만들고 잠가 두었다.
      await this.repo.decrementRawInventoryTon(tx, n.rawMaterialId, n.needTon);
      this.realtime.changed('inventories');
    }
    return out;
  }
}
