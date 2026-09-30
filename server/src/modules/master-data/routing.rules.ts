import { PROCESS_CODE } from '@fantasteel/shared';
import { badInput } from '../../common/errors/app.exception';

export interface RoutingProcessInput { processCode: string; plannedYieldRate?: number | null }

/**
 * 라우팅 입력 검증 (REQ-MST-005).
 * - 공정 중복 금지
 * - 열연 계획 수율은 입력하지 않는다 (규격 매핑에서 계산)
 * - 수율이 있으면 0 초과 1 이하 (DTO에서도 검사하지만 서비스 입력 경로가 여러 곳이라 여기서도 확인)
 */
export function validateRoutingProcesses(processes: RoutingProcessInput[]): void {
  const seen = new Set<string>();
  for (const p of processes) {
    if (seen.has(p.processCode)) throw badInput(`공정 ${p.processCode}이(가) 중복되었습니다`);
    seen.add(p.processCode);
    validateYield(p.processCode, p.plannedYieldRate);
  }
}

export function validateYield(processCode: string, plannedYieldRate: number | null | undefined): void {
  if (processCode === PROCESS_CODE.HOT_ROLLING) {
    if (plannedYieldRate !== null && plannedYieldRate !== undefined) throw badInput('열연 계획 수율은 입력하지 않습니다. 규격 매핑에서 계산됩니다');
    return;
  }
  if (plannedYieldRate === null || plannedYieldRate === undefined) return;
  if (!(plannedYieldRate > 0 && plannedYieldRate <= 1)) throw badInput('계획 수율은 0보다 크고 1 이하여야 합니다');
}
