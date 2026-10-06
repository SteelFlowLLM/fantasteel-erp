import { Prisma } from '../../generated/prisma/client';

// 실적 시뮬레이션 계산 (REQ-PRD-007, 업무 프로세스 8장 BP-SEED-01). DB를 읽지 않는 순수 함수.

/** 난수 시드 범위: 32비트 양의 정수 */
export const MAX_RANDOM_SEED = 2_147_483_647;

/** 재현 가능한 난수 (mulberry32). 같은 시드면 같은 수열 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 샘플 손실률 0.0000~0.0500 (0.0001 단위) */
export function drawSampleLossRate(random: () => number): string {
  return (Math.min(500, Math.floor(random() * 501)) / 10_000).toFixed(4);
}

/**
 * 연주 손실: 손실 매수 = floor(계획 매수 × 샘플 손실률), 실적 매수 = 계획 − 손실 (8장 정수 매수 처리).
 * 감소율이 5%를 넘지 않고, 소량이면 손실이 0매일 수 있다. 실제 감소율도 함께 돌려준다.
 */
export function castingLoss(plannedQty: number, sampleLossRate: string): { lossQty: number; outputQty: number; actualLossRate: string } {
  const lossQty = new Prisma.Decimal(plannedQty).mul(sampleLossRate).floor().toNumber();
  return { lossQty, outputQty: plannedQty - lossQty, actualLossRate: plannedQty > 0 ? (lossQty / plannedQty).toFixed(4) : '0.0000' };
}

/** 공정별 시뮬레이션 작업 시간(시간). 문서에 없는 시연용 가정값 */
export const SIMULATION_HOURS = { IRONMAKING: 4, STEELMAKING: 1, CONTINUOUS_CASTING: 2, HOT_ROLLING: 2 } as const;

/**
 * 작업 시간을 지금을 끝으로 거꾸로 이어 붙인다. 오늘(서울) 0시보다 앞으로 넘어가면 0시~지금 안으로 비율대로 줄인다.
 * 오늘 입고한 원료도 쓸 수 있게 한다 (원료 FIFO는 작업 완료일까지 입고된 LOT만 쓴다).
 */
export function layoutSteps(hours: readonly number[], now: Date, todayStart: Date): { startedAt: Date; completedAt: Date }[] {
  const total = hours.reduce((sum, h) => sum + h, 0) * 3_600_000;
  const available = Math.max(0, now.getTime() - todayStart.getTime());
  const scale = total > available ? available / total : 1;
  let cursor = now.getTime() - total * scale;
  return hours.map((h) => {
    const startedAt = new Date(Math.round(cursor));
    cursor += h * 3_600_000 * scale;
    return { startedAt, completedAt: new Date(Math.round(cursor)) };
  });
}
