// 실적 시뮬레이션의 손실 표시 (REQ-PRD-007, 업무 프로세스 8장 BP-SEED-01).
// 손실 매수 계산(난수 시드·샘플 손실률 0~5%)은 서버(server/src/modules/production/simulation.calculator.ts)가 한다.

/** 실제 감소율 = 손실 매수 ÷ 계획 매수 (표시용, 계획 매수 0이면 0) */
export const actualLossRateOf = (plannedQty: number, lossQty: number): number => (plannedQty > 0 ? lossQty / plannedQty : 0);
