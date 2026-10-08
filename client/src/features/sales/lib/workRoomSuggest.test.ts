// 업무방 멤버 추천: 담당 영업 + 생산부·물류부 부서장, 나·기존 멤버·조직도에 없는 사원·중복 제외.
import { describe, expect, it } from 'vitest';
import type { OrgChartNode } from '@/api/directory';
import { suggestWorkRoomMembers } from '@/features/sales/lib/workRoomSuggest';

const member = (id: number, employeeName: string, isHead = false) => ({ id, employeeNo: String(id), employeeName, jobGradeName: '부장', isHead });
const node = (id: number, departmentCode: string, departmentName: string, members: OrgChartNode['members'], children: OrgChartNode[] = []): OrgChartNode => {
  const head = members.find((m) => m.isHead);
  return { id, departmentCode, departmentName, head: head ? { id: head.id, employeeName: head.employeeName, jobGradeName: head.jobGradeName } : null, members, children };
};

const tree: OrgChartNode[] = [
  node(1, 'SAL', '영업부', [member(2, '김도윤', true), member(3, '박서영')]),
  node(3, 'PRD', '생산부', [member(6, '강민석', true)], [node(4, 'PRD-STEEL', '제강파트', [member(8, '장혜린', true)])]),
  node(9, 'LOG', '물류부', [member(14, '신현우', true), member(15, '권예진')]),
];

describe('업무방 멤버 추천 (suggestWorkRoomMembers)', () => {
  it('담당 영업 다음에 생산부·물류부 부서장 (하위 파트 부서장은 넣지 않는다)', () => {
    expect(suggestWorkRoomMembers(tree, { ownerEmployeeId: 3, myId: 2, existingIds: new Set() })).toEqual([
      { id: 3, employeeName: '박서영', reason: '담당 영업' },
      { id: 6, employeeName: '강민석', reason: '생산부 부서장' },
      { id: 14, employeeName: '신현우', reason: '물류부 부서장' },
    ]);
  });

  it('나·이미 멤버인 사람·조직도에 없는 담당자는 빼고, 담당 영업이 부서장이어도 한 번만', () => {
    expect(suggestWorkRoomMembers(tree, { ownerEmployeeId: 3, myId: 3, existingIds: new Set([14]) }).map((s) => s.id)).toEqual([6]);
    expect(suggestWorkRoomMembers(tree, { ownerEmployeeId: 99, myId: 2, existingIds: new Set() }).map((s) => s.id)).toEqual([6, 14]);
    expect(suggestWorkRoomMembers(tree, { ownerEmployeeId: 6, myId: 2, existingIds: new Set() })).toEqual([
      { id: 6, employeeName: '강민석', reason: '담당 영업' },
      { id: 14, employeeName: '신현우', reason: '물류부 부서장' },
    ]);
  });
});
