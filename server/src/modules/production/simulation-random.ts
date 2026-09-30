/** 시드로 재현되는 난수 (mulberry32). 같은 시드면 같은 순서의 값이 나온다. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 연주 손실률 0~5%를 소수 4자리 문자열로 뽑는다 (0.0000 ~ 0.0500, 1만분의 1 단위). */
export function sampleLossRate(random: () => number): string {
  return (Math.floor(random() * 501) / 10000).toFixed(4);
}

/** 손실 매수 = floor(계획 매수 × 손실률). 부동소수 오차를 피하려고 1만분의 1 단위 정수로 계산한다. */
export function lossQtyOf(plannedQty: number, sampledLossRate: string): number {
  return Math.floor((plannedQty * Math.round(Number(sampledLossRate) * 10000)) / 10000);
}

/**
 * 손실 매수를 히트(연주 실적)별로 나눈다. 뒤 히트부터 1매씩 돌아가며 뺀다.
 * 돌려주는 배열은 plannedQtys와 같은 순서의 히트별 손실 매수.
 */
export function distributeLoss(plannedQtys: number[], totalLoss: number): number[] {
  const n = plannedQtys.length;
  const loss = plannedQtys.map(() => 0);
  let rest = Math.min(totalLoss, plannedQtys.reduce((s, v) => s + v, 0));
  for (let i = n - 1; rest > 0; i = (i - 1 + n) % n) {
    if (loss[i] < plannedQtys[i]) {
      loss[i]++;
      rest--;
    }
  }
  return loss;
}
