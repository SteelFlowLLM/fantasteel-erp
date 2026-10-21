// 생산 실적 입력 화면의 투입 예정 원료량 계산 (업무 프로세스 4.4, REQ-PRD-005).
//   철광석·석탄·석회석(t) = 용선 × 용선 1t당 원단위(t/t)
//   합금철(t) = 히트 톤 × 강종별 원단위(kg/t) ÷ 1,000
// MRP 순소요 계산은 서버(server/src/modules/mrp)가 한다.
import { decDiv, decMul, TON_DIGITS } from '@/lib/decimal';

/** 철광석·석탄·석회석: 용선 1t당 원단위(t/t) */
export const rawMaterialTonFor = (hotMetalTon: string, tonPerTon: string): string => decMul(hotMetalTon, tonPerTon, TON_DIGITS);

/** 합금철: 용강(히트) 1t당 원단위(kg/t) ÷ 1,000 */
export const ferroalloyTonFor = (heatTon: string, kgPerTon: string): string => decDiv(decMul(heatTon, kgPerTon, 6), '1000', TON_DIGITS);
