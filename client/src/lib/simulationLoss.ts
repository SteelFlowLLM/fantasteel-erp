// 실적 시뮬레이션의 손실 (REQ-PRD-007, 업무 프로세스 8장 BP-SEED-01).
// - 같은 난수 시드는 같은 결과를 낸다 (mulberry32).
// - 샘플 손실률은 0~5% (소수 4자리, 0.0000~0.0500).
// - 손실 매수 = floor(계획 슬래브 매수 × 샘플 손실률), 실적 매수 = 계획 매수 − 손실 매수 → 감소율이 5%를 넘지 않는다.
import { floorMulInt, fromUnits, RATE_DIGITS } from '@/lib/decimal';

/** 재현 가능한 난수 (0 이상 1 미만). seed는 32비트 정수로 맞춘다. */
export function createSeededRandom(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_SAMPLE_LOSS_RATE = '0.0500';

/** 샘플 손실률 0.0000~0.0500 (난수 하나를 쓴다) */
export function drawSampleLossRate(random: () => number): string {
  const tenThousandths = Math.min(500, Math.floor(random() * 501));
  return fromUnits(BigInt(tenThousandths), RATE_DIGITS);
}

/** 손실 매수 = floor(계획 매수 × 샘플 손실률) */
export const lossQtyOf = (plannedQty: number, sampleLossRate: string): number => floorMulInt(plannedQty, sampleLossRate);

/** 실제 감소율 = 손실 매수 ÷ 계획 매수 (표시용, 계획 매수 0이면 0) */
export const actualLossRateOf = (plannedQty: number, lossQty: number): number => (plannedQty > 0 ? lossQty / plannedQty : 0);
