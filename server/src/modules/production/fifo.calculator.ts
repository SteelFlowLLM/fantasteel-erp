import { Prisma } from '../../generated/prisma/client';

// 원료·용선 LOT FIFO 차감 계산 (REQ-LOT-002·004). DB를 읽지 않는 순수 함수. 톤은 Decimal(컨벤션 7-2).

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

/** 톤 소수 3자리 (반올림) */
export function roundTon(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

export interface FifoLot {
  id: number;
  lotNo: string;
  remainingTon: Prisma.Decimal | string;
}

export interface FifoTake {
  lotId: number;
  lotNo: string;
  /** 이 LOT에서 차감할 톤 */
  ton: Prisma.Decimal;
  /** 차감 후 잔량 */
  remainingTon: Prisma.Decimal;
}

export interface FifoDeduction {
  takes: FifoTake[];
  /** 모자란 톤. 0이면 다 채웠다 */
  shortageTon: Prisma.Decimal;
}

/** 앞(오래된) LOT부터 필요한 톤을 차감한다. 잔량이 음수가 되지 않는다 (CHECK lot_remaining_ton_check) */
export function planFifoDeduction(lots: readonly FifoLot[], requiredTon: Prisma.Decimal | string): FifoDeduction {
  let rest = D(requiredTon);
  const takes: FifoTake[] = [];
  for (const lot of lots) {
    if (rest.lte(0)) break;
    const remaining = D(lot.remainingTon);
    if (remaining.lte(0)) continue;
    const ton = Prisma.Decimal.min(remaining, rest);
    takes.push({ lotId: lot.id, lotNo: lot.lotNo, ton, remainingTon: remaining.sub(ton) });
    rest = rest.sub(ton);
  }
  return { takes, shortageTon: Prisma.Decimal.max(rest, 0) };
}

/** 원료별 투입량 = 기준량 × 원단위. 합금철은 kg/t라 ÷ 1,000 (4.4, REQ-PRD-005) */
export function consumptionTon(baseTon: Prisma.Decimal | string, consumptionRate: Prisma.Decimal | string, isKgPerTon: boolean): Prisma.Decimal {
  const ton = D(baseTon).mul(D(consumptionRate));
  return roundTon(isKgPerTon ? ton.div(1000) : ton);
}
