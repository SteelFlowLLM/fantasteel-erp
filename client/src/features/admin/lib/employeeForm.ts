// 사원 등록·수정 창의 입력값 계산 (REQ-AUTH-002).
// 수정 창은 연 시점의 값과 updatedAt을 한 번만 잡아 둔다. 창이 열린 채 다른 탭이 저장해 목록이 새로 불러와져도
// 이 값은 그대로라서, 저장하면 COM-001(검토 이후 데이터 변경)로 막힌다 (04 9.3, cross-cutting.md 수정 폼 규칙).

export interface EmployeeFormValues {
  employeeNo: string;
  employeeName: string;
  departmentId: number | null;
  jobGradeId: number | null;
  roleId: number | null;
}

export interface EmployeeFormTarget {
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  jobGradeId: number;
  roleId: number;
  updatedAt: string;
}

export interface OpenedEmployeeForm {
  values: EmployeeFormValues;
  /** 수정 창을 연 시점의 updatedAt. 등록이면 null. */
  expectedUpdatedAt: string | null;
}

/** 창을 연 시점의 입력값과 updatedAt. 창이 열려 있는 동안 다시 계산하지 않는다. */
export function openEmployeeForm(target?: EmployeeFormTarget): OpenedEmployeeForm {
  return {
    values: {
      employeeNo: target?.employeeNo ?? '',
      employeeName: target?.employeeName ?? '',
      departmentId: target?.departmentId ?? null,
      jobGradeId: target?.jobGradeId ?? null,
      roleId: target?.roleId ?? null,
    },
    expectedUpdatedAt: target?.updatedAt ?? null,
  };
}

/** 연 시점의 값과 달라졌는지 (이름은 앞뒤 공백을 빼고 비교) */
export function isEmployeeFormDirty(form: EmployeeFormValues, opened: EmployeeFormValues): boolean {
  return (Object.keys(opened) as (keyof EmployeeFormValues)[]).some((key) =>
    key === 'employeeName' ? form.employeeName.trim() !== opened.employeeName : form[key] !== opened[key],
  );
}
