import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/codes';
import {
  DEPARTMENT_CODE_PATTERN,
  EMPLOYEE_NO_PATTERN,
  blockedParentIdsOf,
  descendantIdsOf,
  totalMemberCountOf,
} from '@/features/admin/lib/orgRules';
import { changedCellsOf, countLevels, effectiveLevelOf, nextLevelOf, permissionRowsByArea, permissionsToSave } from '@/features/admin/lib/permissionMatrix';

// 1 생산부 ─ 2 제선 ─ 4 (제선 하위)
//         └ 3 제강
// 5 영업부
const TREE = [
  { id: 1, parentId: null, memberCount: 1 },
  { id: 2, parentId: 1, memberCount: 2 },
  { id: 3, parentId: 1, memberCount: 3 },
  { id: 4, parentId: 2, memberCount: 4 },
  { id: 5, parentId: null, memberCount: 5 },
];

describe('부서 계층 (REQ-ORG-001, 순환 금지)', () => {
  it('하위 부서를 모두 찾는다', () => {
    expect([...descendantIdsOf(TREE, 1)].sort()).toEqual([2, 3, 4]);
    expect([...descendantIdsOf(TREE, 5)]).toEqual([]);
  });

  it('자기 자신과 하위 부서는 상위 부서로 고를 수 없다', () => {
    expect([...blockedParentIdsOf(TREE, 2)].sort()).toEqual([2, 4]);
    expect(blockedParentIdsOf(TREE, null).size).toBe(0);
  });

  it('순환이 이미 있어도 멈춘다', () => {
    const cyclic = [
      { id: 1, parentId: 2 },
      { id: 2, parentId: 1 },
    ];
    expect([...descendantIdsOf(cyclic, 1)]).toEqual([2]);
  });

  it('하위 부서까지 더한 인원', () => {
    expect(totalMemberCountOf(TREE, 1)).toBe(10);
    expect(totalMemberCountOf(TREE, 2)).toBe(6);
  });
});

describe('입력 형식 (가정값)', () => {
  it('사원번호는 숫자 7자리', () => {
    expect(EMPLOYEE_NO_PATTERN.test('1503001')).toBe(true);
    expect(EMPLOYEE_NO_PATTERN.test('150300')).toBe(false);
    expect(EMPLOYEE_NO_PATTERN.test('15030011')).toBe(false);
    expect(EMPLOYEE_NO_PATTERN.test('A503001')).toBe(false);
  });

  it('부서 코드', () => {
    expect(DEPARTMENT_CODE_PATTERN.test('PRD-IRON')).toBe(true);
    expect(DEPARTMENT_CODE_PATTERN.test('prd')).toBe(false);
    expect(DEPARTMENT_CODE_PATTERN.test('-PRD')).toBe(false);
    expect(DEPARTMENT_CODE_PATTERN.test('A'.repeat(31))).toBe(false);
  });
});

describe('권한 행렬 (REQ-AUTH-003)', () => {
  it('칸은 사용 → 조회 → 없음 → 사용 순으로 바뀐다', () => {
    expect(nextLevelOf('USE')).toBe('VIEW');
    expect(nextLevelOf('VIEW')).toBeNull();
    expect(nextLevelOf(null)).toBe('USE');
  });

  it('저장 전 변경을 덮어 보고, 같은 값으로 되돌린 칸은 변경에서 뺀다', () => {
    const saved = { EMPLOYEE_MANAGE: 'USE', SALES_ORDER_CREATE: 'VIEW' } as const;
    const draft = { EMPLOYEE_MANAGE: 'VIEW', SALES_ORDER_CREATE: 'VIEW', MASTER_MANAGE: null } as const;
    expect(effectiveLevelOf(saved, draft, 'EMPLOYEE_MANAGE')).toBe('VIEW');
    expect(effectiveLevelOf(saved, draft, 'SALES_ORDER_CANCEL')).toBeNull();
    expect(changedCellsOf(saved, draft)).toEqual(['EMPLOYEE_MANAGE']);
    expect(changedCellsOf(saved, undefined)).toEqual([]);
  });

  it('저장할 목록에는 없음을 넣지 않는다', () => {
    const saved = { EMPLOYEE_MANAGE: 'USE', SALES_ORDER_CREATE: 'VIEW' } as const;
    expect(permissionsToSave(saved, { SALES_ORDER_CREATE: null, MASTER_MANAGE: 'USE' })).toEqual([
      { permission: 'EMPLOYEE_MANAGE', permissionLevel: 'USE' },
      { permission: 'MASTER_MANAGE', permissionLevel: 'USE' },
    ]);
  });

  it('사용·조회 개수와 영역별 17개 행', () => {
    expect(countLevels({ EMPLOYEE_MANAGE: 'USE', ORG_MANAGE: 'USE', SALES_ORDER_CREATE: 'VIEW' })).toEqual({ use: 2, view: 1 });
    const rows = permissionRowsByArea();
    expect(rows.map((row) => row.area)).toEqual(['영업', '구매', '생산', '품질', '물류', '관리']);
    expect(rows.flatMap((row) => row.permissions)).toEqual([...PERMISSIONS]);
    expect(PERMISSIONS).toHaveLength(17);
  });
});
