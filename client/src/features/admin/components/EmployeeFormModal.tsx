'use client';

// 사원 등록·정보 수정 창 (REQ-AUTH-002). 칸: 사원번호·이름·부서·직급·역할(1개). 비밀번호·이메일은 로그인 작업 때 넣는다.
import { useState } from 'react';
import { ROLE_LABEL } from '@/codes';
import { employeeAdminApi } from '@/api/adminEmployees';
import { InputError } from '@/api/client';
import type { DepartmentView, EmployeeView, JobGradeView, RoleView } from '@/api/directory';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { RolePermissionSummary } from '@/features/admin/components/RolePermissionSummary';
import { isEmployeeFormDirty, openEmployeeForm, type EmployeeFormValues } from '@/features/admin/lib/employeeForm';
import { countLevels, levelCountText, levelsOf } from '@/features/admin/lib/permissionMatrix';
import { departmentOptionLabel } from '@/features/admin/lib/orgRules';
import { useAction } from '@/hooks/useAction';
import { cn } from '@/lib/cn';

export interface EmployeeFormModalProps {
  /** 없으면 등록 */
  target?: EmployeeView;
  meId: number;
  departments: readonly DepartmentView[];
  jobGrades: readonly JobGradeView[];
  roles: readonly RoleView[];
  onClose: () => void;
  onSaved: (employeeId: number) => void;
}

export function EmployeeFormModal({ target, meId, departments, jobGrades, roles, onClose, onSaved }: EmployeeFormModalProps) {
  const isEdit = target !== undefined;
  // 연 시점의 값·updatedAt은 한 번만 잡는다. 다른 탭 저장으로 target이 새로 불러와져도 바뀌지 않아 COM-001이 걸린다.
  const [opened] = useState(() => openEmployeeForm(target));
  const initial = opened.values;
  const [form, setForm] = useState<EmployeeFormValues>(initial);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const set = <K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const onError = (error: unknown) => setErrors(error instanceof InputError ? error.fieldErrors : {});
  const create = useAction(employeeAdminApi.create, { success: '사원을 등록했어요', onSuccess: (saved) => onSaved(saved.id), onError });
  const update = useAction(employeeAdminApi.update, { success: '사원 정보를 저장했어요', onSuccess: (saved) => onSaved(saved.id), onError });
  const pending = create.isPending || update.isPending;

  const dirty = isEmployeeFormDirty(form, initial);
  const role = roles.find((r) => r.id === form.roleId);
  const isMe = target?.id === meId;
  const isHead = (target?.headDepartmentIds.length ?? 0) > 0;

  const submit = () => {
    setErrors({});
    if (target) {
      update.mutate({
        id: target.id,
        employeeName: form.employeeName,
        departmentId: form.departmentId,
        jobGradeId: form.jobGradeId,
        roleId: form.roleId,
        expectedUpdatedAt: opened.expectedUpdatedAt,
      });
    } else {
      create.mutate({ employeeNo: form.employeeNo, employeeName: form.employeeName, departmentId: form.departmentId, jobGradeId: form.jobGradeId, roleId: form.roleId });
    }
  };

  return (
    <Modal
      title={isEdit ? '사원 정보 수정' : '사원 등록'}
      onClose={onClose}
      width={600}
      footer={
        <>
          {Object.keys(errors).length > 0 ? <span className="mr-auto self-center text-cap text-danger">빨간 표시를 확인해 주세요</span> : null}
          <Button onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending || (isEdit && !dirty)} title={isEdit && !dirty ? '바뀐 내용이 없어요' : undefined}>
            {pending ? '저장하는 중…' : isEdit ? '저장' : '등록'}
          </Button>
        </>
      }
    >
      <p className="text-cap text-ink-3">{target ? `${target.employeeName} · 사원번호 ${target.employeeNo}` : '역할이 메뉴와 업무 권한을 정해요'}</p>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="이름" required error={errors.employeeName} htmlFor="employee-name">
          <Input id="employee-name" maxLength={50} placeholder="예: 홍길동" value={form.employeeName} invalid={Boolean(errors.employeeName)} onChange={(e) => set('employeeName', e.target.value)} />
        </Field>
        <Field
          label="사원번호"
          required={!isEdit}
          error={errors.employeeNo}
          hint={isEdit ? '사원번호는 바꿀 수 없어요' : '숫자 7자리 · 로그인 ID로 쓰여요'}
          htmlFor="employee-no"
        >
          <Input
            id="employee-no"
            className="font-mono"
            inputMode="numeric"
            maxLength={7}
            placeholder="숫자 7자리"
            readOnly={isEdit}
            value={form.employeeNo}
            invalid={Boolean(errors.employeeNo)}
            onChange={(e) => set('employeeNo', e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field
          label="부서"
          required
          error={errors.departmentId}
          hint={isHead ? '부서장이라 다른 부서로 옮기려면 부서장을 먼저 바꿔 주세요' : undefined}
          htmlFor="employee-department"
        >
          <Select
            id="employee-department"
            value={form.departmentId ?? ''}
            invalid={Boolean(errors.departmentId)}
            onChange={(e) => set('departmentId', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">부서 선택</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {departmentOptionLabel(d.departmentName, d.depth)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="직급" required error={errors.jobGradeId} htmlFor="employee-job-grade">
          <Select
            id="employee-job-grade"
            value={form.jobGradeId ?? ''}
            invalid={Boolean(errors.jobGradeId)}
            onChange={(e) => set('jobGradeId', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">직급 선택</option>
            {jobGrades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.jobGradeName}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* 버튼 묶음이라 <label>로 감싸지 않는다: label 안의 첫 버튼이 label 클릭을 받아 역할이 바뀐다. */}
      <fieldset className="flex min-w-0 flex-col gap-1.5" aria-describedby="employee-role-note">
        <legend className="mb-1.5 text-xs font-medium text-ink-2">
          역할
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        </legend>
        <div role="radiogroup" aria-label="역할" aria-required="true" aria-invalid={Boolean(errors.roleId) || undefined} className="grid grid-cols-3 gap-2">
          {roles.map((r) => {
            const counts = countLevels(levelsOf(r.permissions));
            const on = r.id === form.roleId;
            return (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set('roleId', r.id)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-sm border px-3 py-2 text-left',
                  on ? 'border-brand bg-brand-tint' : 'border-line-strong bg-surface hover:bg-surface-2',
                )}
              >
                <b className={cn('text-sm font-semibold', on ? 'text-brand' : 'text-ink')}>{ROLE_LABEL[r.roleCode]}</b>
                <span className="text-cap text-ink-3">{levelCountText(counts)}</span>
              </button>
            );
          })}
        </div>
        {errors.roleId ? (
          <span id="employee-role-note" role="alert" className="text-cap text-danger">
            {errors.roleId}
          </span>
        ) : (
          <span id="employee-role-note" className="text-cap text-ink-3">
            사원 한 명에 역할 하나예요
          </span>
        )}
      </fieldset>

      <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2 px-3.5 py-3">
        <span className="text-xs font-medium text-ink-2">권한 미리보기</span>
        {role ? <RolePermissionSummary permissions={role.permissions} /> : <span className="text-cap text-ink-3">역할을 고르면 권한이 보여요</span>}
        <span className="text-cap text-ink-3">구매요청 승인은 역할이 아니라 부서장 지정으로 정해져요.</span>
      </div>

      {isMe && form.roleId !== initial.roleId ? (
        <Banner tone="wait">내 역할이에요. 저장하면 바로 내 메뉴와 버튼이 새 역할 권한으로 바뀌어요.</Banner>
      ) : null}
    </Modal>
  );
}
