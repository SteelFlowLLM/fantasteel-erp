// MRP 조회 (REQ-PRD-005, BP-PRD-01, 업무 프로세스 4.4·12.2 GET /mrp/requirements?from&to).
// 실행 이력을 저장하지 않는다(PLAN 7장). 기간을 정해 지금 데이터로 바로 계산한다.
// 차감은 기간과 관계없이 열린 생산계획 전부로 하고(앞선 필요일이 먼저 쓴다, 계획 몫 입고예정은 그 계획 전용), 필요일 ≤ 종료일만 보인다.
// 시작일 전 계획은 밀린 소요(beforePeriod)로 함께 보인다. 계산은 서비스(mock/services/ext/purchasing.ts computeMrpForPeriod)가 한다.
import { PERMISSION, type Permission } from '@/codes';
import { requireActor } from '@/api/actor';
import { FieldErrors, mockQuery } from '@/api/client';
import { isDateText } from '@/mock/services';
import { computeMrpForPeriod, type MrpPeriodView } from '@/mock/services/ext/purchasing';

export type { MrpMaterialRow, MrpRequisitionLine } from '@/mock/services';
export type { MrpPeriodPlanRow as MrpPlanRow, MrpPeriodView as MrpView } from '@/mock/services/ext/purchasing';

export interface MrpPeriod {
  /** YYYY-MM-DD (포함) */
  from: string;
  /** YYYY-MM-DD (포함) */
  to: string;
}

/** MRP 조회 권한: 구매(구매요청 등록·MRP)와 생산(생산계획) 쪽 조회 이상 */
export const MRP_VIEW_PERMISSIONS: readonly Permission[] = [PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PRODUCTION_PLAN_CONFIRM];

export const mrpKeys = {
  all: ['mrp'] as const,
  requirements: (period: MrpPeriod) => ['mrp', 'requirements', period.from, period.to] as const,
};

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
  requirements: (period: MrpPeriod): Promise<MrpPeriodView> =>
    mockQuery((tables) => {
      requireActor(tables, { view: MRP_VIEW_PERMISSIONS });
      checkPeriod(period);
      return computeMrpForPeriod(tables, period);
    }),
};
