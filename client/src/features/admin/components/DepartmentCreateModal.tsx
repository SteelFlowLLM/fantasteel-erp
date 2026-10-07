'use client';

// 부서 만들기 창. 부서장은 소속 사원이 생긴 뒤 부서 탭에서 지정한다 (부서장 = 그 부서 사원).
import { useState } from 'react';
import { departmentAdminApi, isOrgServerMode } from '@/api/adminOrganization';
import { InputError } from '@/api/client';
import type { DepartmentView } from '@/api/directory';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { departmentOptionLabel } from '@/features/admin/lib/orgRules';
import { useAction } from '@/hooks/useAction';

export function DepartmentCreateModal({ departments, onClose, onSaved }: { departments: readonly DepartmentView[]; onClose: () => void; onSaved: (id: number) => void }) {
  const [departmentCode, setDepartmentCode] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [parentId, setParentId] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState('0');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const create = useAction(departmentAdminApi.create, {
    success: (saved) => `${saved.name} 부서를 만들었어요`,
    onSuccess: (saved) => onSaved(saved.id),
    onError: (error) => setErrors(error instanceof InputError ? error.fieldErrors : {}),
  });

  const submit = () => {
    setErrors({});
    create.mutate({ departmentCode, departmentName, parentId, sortOrder });
  };

  return (
    <Modal
      title="부서 만들기"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} disabled={create.isPending}>
            {create.isPending ? '만드는 중…' : '만들기'}
          </Button>
        </>
      }
    >
      <Field label="부서 코드" required error={errors.departmentCode} hint="영문 대문자·숫자·하이픈 30자 이내 (예: PRD-IRON)" htmlFor="new-department-code">
        <Input
          id="new-department-code"
          className="font-mono"
          maxLength={30}
          placeholder="PRD-IRON"
          value={departmentCode}
          invalid={Boolean(errors.departmentCode)}
          onChange={(e) => setDepartmentCode(e.target.value.toUpperCase())}
        />
      </Field>
      <Field label="부서명" required error={errors.departmentName} htmlFor="new-department-name">
        <Input id="new-department-name" maxLength={50} placeholder="예: 제선파트" value={departmentName} invalid={Boolean(errors.departmentName)} onChange={(e) => setDepartmentName(e.target.value)} />
      </Field>
      <Field label="상위 부서" error={errors.parentId} htmlFor="new-department-parent">
        <Select id="new-department-parent" value={parentId ?? ''} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">상위 부서 없음 (최상위)</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {departmentOptionLabel(d.departmentName, d.depth)}
            </option>
          ))}
        </Select>
      </Field>
      {/* 정렬 순서는 ERD에 없어 서버 모드에서 숨긴다 */}
      {isOrgServerMode() ? null : (
        <Field label="정렬 순서" required error={errors.sortOrder} hint="같은 상위 부서 안에서 작은 수가 먼저 나와요" htmlFor="new-department-sort">
          <Input id="new-department-sort" inputMode="numeric" numeric value={sortOrder} invalid={Boolean(errors.sortOrder)} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
      )}
      <p className="text-cap text-ink-3">부서장은 부서를 만들고 사원을 이 부서로 등록한 뒤, 부서 탭에서 그 사원 중 1명을 지정해요.</p>
    </Modal>
  );
}
