// MRP 조회 (REQ-PRD-005, BP-PRD-01, 업무 프로세스 4.4·12.2 GET /mrp/requirements?from&to).
// 실행 이력을 저장하지 않는다(PLAN 7장). 기간을 정해 지금 데이터로 바로 계산한다.
// 차감은 기간과 관계없이 열린 생산계획 전부로 하고(앞선 필요일이 먼저 쓴다, 계획 몫 입고예정은 그 계획 전용), 필요일 ≤ 종료일만 보인다.
// 시작일 전 계획은 밀린 소요(isBeforePeriod)로 함께 보인다. 응답 모양은 서버(shared MrpRequirementsView)를 따른다.
// 두 데이터 모드 모두 서버가 계산한다(api/server/mrp.ts). 조회 권한은 서버가 확인한다(COM-002).
import type { MrpRequirementsView } from '@fantasteel/shared';
import { FieldErrors } from '@/api/client';
import { serverMrpRequirements } from '@/api/server/mrp';

export type { MrpMaterialView, MrpPlanView, MrpRequirementsView, MrpRequisitionLineView } from '@fantasteel/shared';

export interface MrpPeriod {
  /** YYYY-MM-DD (포함) */
  from: string;
  /** YYYY-MM-DD (포함) */
  to: string;
}

export const mrpKeys = {
  all: ['mrp'] as const,
  requirements: (period: MrpPeriod) => ['mrp', 'requirements', period.from, period.to] as const,
};

/** 있는 날짜의 YYYY-MM-DD인지 (2026-02-30은 아니다) */
function isDateText(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 기간 확인: 날짜 형식, 시작 ≤ 끝 */
function checkPeriod(period: MrpPeriod): void {
  const errors = new FieldErrors();
  if (!isDateText(period.from)) errors.add('from', '시작일을 YYYY-MM-DD로 입력해 주세요');
  if (!isDateText(period.to)) errors.add('to', '종료일을 YYYY-MM-DD로 입력해 주세요');
  if (errors.isEmpty && period.from > period.to) errors.add('to', '종료일은 시작일과 같거나 뒤여야 해요');
  errors.throwIfAny('기간을 확인해 주세요');
}

export const mrpApi = {
  /** 필요일이 종료일 이하인 생산계획의 원료 소요·순소요 (시작일 전 = 밀린 소요, 저장하지 않음) */
  requirements: async (period: MrpPeriod): Promise<MrpRequirementsView> => {
    checkPeriod(period);
    return serverMrpRequirements(period);
  },
};
