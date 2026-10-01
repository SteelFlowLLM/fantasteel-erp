import { describe, expect, it } from 'vitest';
import { PERMISSION_LEVEL, PERMISSION_LEVEL_LABEL } from '@/codes';
import { isEmployeeFormDirty, openEmployeeForm } from '@/features/admin/lib/employeeForm';
import { levelCountText, levelLabelOf, NO_PERMISSION_LEVEL_LABEL } from '@/features/admin/lib/permissionMatrix';

const target = { employeeNo: '2610001', employeeName: '박서영', departmentId: 2, jobGradeId: 3, roleId: 1, updatedAt: '2026-10-01T09:00:00.000Z' };

describe('사원 수정 창: 연 시점의 값 (COM-001)', () => {
  it('연 시점의 updatedAt을 잡아 두고, 나중에 새로 불러온 행이 와도 바뀌지 않는다', () => {
    const opened = openEmployeeForm(target);
    // 다른 탭이 직급을 바꿔 목록이 새로 불러와진 상황
    const refetched = { ...target, jobGradeId: 4, updatedAt: '2026-10-01T09:05:00.000Z' };
    expect(opened.expectedUpdatedAt).toBe(target.updatedAt);
    expect(opened.expectedUpdatedAt).not.toBe(refetched.updatedAt);
    expect(opened.values.jobGradeId).toBe(3);
  });

  it('등록이면 빈 값과 updatedAt 없음', () => {
    expect(openEmployeeForm()).toEqual({
      values: { employeeNo: '', employeeName: '', departmentId: null, jobGradeId: null, roleId: null },
      expectedUpdatedAt: null,
    });
  });

  it('바뀐 칸이 있을 때만 저장할 수 있다 (이름은 앞뒤 공백을 빼고 비교)', () => {
    const { values } = openEmployeeForm(target);
    expect(isEmployeeFormDirty(values, values)).toBe(false);
    expect(isEmployeeFormDirty({ ...values, employeeName: ' 박서영 ' }, values)).toBe(false);
    expect(isEmployeeFormDirty({ ...values, employeeName: '박서윤' }, values)).toBe(true);
    expect(isEmployeeFormDirty({ ...values, roleId: 2 }, values)).toBe(true);
  });
});

describe('권한 수준 표시명 (PERMISSION_LEVEL_LABEL)', () => {
  it('사용·조회는 공통 코드 표시명, 행이 없으면 없음', () => {
    expect(levelLabelOf(PERMISSION_LEVEL.USE)).toBe(PERMISSION_LEVEL_LABEL.USE);
    expect(levelLabelOf(PERMISSION_LEVEL.VIEW)).toBe(PERMISSION_LEVEL_LABEL.VIEW);
    expect(levelLabelOf(null)).toBe(NO_PERMISSION_LEVEL_LABEL);
  });

  it('개수 줄도 공통 코드 표시명으로 만든다', () => {
    expect(levelCountText({ use: 3, view: 5 })).toBe(`${PERMISSION_LEVEL_LABEL.USE} 3 · ${PERMISSION_LEVEL_LABEL.VIEW} 5`);
  });
});
