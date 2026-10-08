// 업무방 멤버 추천: 수주 담당 영업 + 수주를 이어받는 부서(생산·물류)의 부서장. 조직도로만 고르고 정해 주지는 않는다(화면에서 한 번에 더하기).
// 부서 코드는 시드 값(가정값, docs/backend/seed.md)이라 코드가 바뀌면 추천도 비어 있을 뿐 업무방 열기에는 영향이 없다.
import type { OrgChartNode } from '@/api/directory';

/** 수주 뒤에 일하는 부서: 생산(계획·실적)·물류(출하) */
export const WORK_ROOM_SUGGEST_DEPARTMENT_CODES = ['PRD', 'LOG'] as const;

export interface SuggestedMember {
  id: number;
  employeeName: string;
  reason: string;
}

function flatten(nodes: readonly OrgChartNode[]): OrgChartNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** 추천 멤버 (나·이미 멤버인 사람 제외, 중복 없음). 담당 영업이 먼저 온다 */
export function suggestWorkRoomMembers(
  tree: readonly OrgChartNode[],
  input: { ownerEmployeeId: number | null; myId: number; existingIds: ReadonlySet<number> },
): SuggestedMember[] {
  const nodes = flatten(tree);
  const nameOf = new Map(nodes.flatMap((node) => node.members.map((m) => [m.id, m.employeeName] as const)));
  const result: SuggestedMember[] = [];
  const add = (id: number | null | undefined, reason: string) => {
    if (id === null || id === undefined || id === input.myId || input.existingIds.has(id) || result.some((r) => r.id === id)) return;
    const employeeName = nameOf.get(id);
    // 조직도에 없는 사원(퇴사 등)은 추천하지 않는다
    if (employeeName) result.push({ id, employeeName, reason });
  };
  add(input.ownerEmployeeId, '담당 영업');
  for (const code of WORK_ROOM_SUGGEST_DEPARTMENT_CODES) {
    const department = nodes.find((node) => node.departmentCode === code);
    if (department?.head) add(department.head.id, `${department.departmentName} 부서장`);
  }
  return result;
}
