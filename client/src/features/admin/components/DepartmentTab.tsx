'use client';

// 부서 탭 (REQ-ORG-001·002): 왼쪽 부서 계층 | 오른쪽 편집(부서 코드·부서명·상위 부서·부서장·정렬 순서). 삭제는 참조가 없을 때만.
import { useState } from 'react';
import { PERMISSION } from '@/codes';
import { departmentAdminApi } from '@/api/adminOrganization';
import { InputError } from '@/api/client';
import type { DepartmentView, EmployeeView } from '@/api/directory';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, StateView } from '@/components/StateView';
import { DepartmentCreateModal } from '@/features/admin/components/DepartmentCreateModal';
import { blockedParentIdsOf, departmentOptionLabel } from '@/features/admin/lib/orgRules';
import { useAction } from '@/hooks/useAction';
import { useDepartmentList, useEmployeeList } from '@/hooks/useDirectory';
import { cn } from '@/lib/cn';
import { permissionNeedText } from '@/lib/permissions';

const INDENT = ['pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20'] as const;

export function DepartmentTab({ canEdit }: { canEdit: boolean }) {
  const departments = useDepartmentList();
  const employees = useEmployeeList();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const lockTitle = canEdit ? undefined : permissionNeedText([PERMISSION.ORG_MANAGE]);

  return (
    <>
      <Banner tone="run" className="flex-none">
        부서장은 그 부서 사원이 올린 구매요청의 <b>승인권자</b>예요. 부서장은 역할이 아니고, 부서마다 그 부서의 사용 중인 사원 1명을 지정해요.
      </Banner>
      <QueryBoundary query={departments} loadingLabel="부서를 불러오는 중…">
        {(list) => {
          const selected = list.find((d) => d.id === selectedId) ?? list[0];
          return (
            <div className="grid min-h-0 flex-none grid-cols-[360px_minmax(0,1fr)] items-start gap-4">
              <Card>
                <CardHead
                  title="부서 계층"
                  meta={`${list.length}개`}
                  actions={
                    <Button size="sm" variant="primary" icon="plus" disabled={!canEdit} title={lockTitle} onClick={() => setCreating(true)}>
                      부서 만들기
                    </Button>
                  }
                />
                <ul aria-label="부서 계층">
                  {list.map((d) => {
                    const isSelected = d.id === selected?.id;
                    return (
                      <li key={d.id} className="border-b border-line last:border-b-0">
                        <button
                          type="button"
                          aria-current={isSelected || undefined}
                          onClick={() => setSelectedId(d.id)}
                          className={cn(
                            'flex w-full flex-col gap-0.5 py-2 pr-4 text-left',
                            INDENT[Math.min(d.depth, INDENT.length - 1)],
                            isSelected ? 'bg-brand-tint hover:bg-brand-tint-hover' : 'hover:bg-surface-2',
                          )}
                        >
                          <span className="flex w-full items-center gap-2">
                            {d.depth > 0 ? <span className="text-ink-3">└</span> : null}
                            <b className="text-sm font-semibold">{d.departmentName}</b>
                            <span className="font-mono text-cap text-ink-3">{d.departmentCode}</span>
                            <span className="ml-auto text-cap text-ink-2 tabular-nums">{d.memberCount}명</span>
                          </span>
                          <span className={cn('text-cap', d.depth > 0 && 'pl-4', d.headEmployeeName ? 'text-ink-3' : 'text-wait')}>
                            {d.headEmployeeName ? `부서장 ${d.headEmployeeName}` : '부서장 없음'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {list.length === 0 ? <EmptyNote>등록된 부서가 없어요</EmptyNote> : null}
              </Card>
              {selected ? (
                <DepartmentEditor
                  key={`${selected.id}-${selected.updatedAt}`}
                  department={selected}
                  departments={list}
                  employees={employees.data ?? []}
                  canEdit={canEdit}
                  onDeleted={() => setSelectedId(null)}
                />
              ) : (
                <Card>
                  <StateView kind="empty" title="부서를 골라 주세요" />
                </Card>
              )}
            </div>
          );
        }}
      </QueryBoundary>
      {creating && departments.data ? (
        <DepartmentCreateModal
          departments={departments.data}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            setSelectedId(id);
          }}
        />
      ) : null}
    </>
  );
}

interface EditorState {
  departmentCode: string;
  departmentName: string;
  parentId: number | null;
  headEmployeeId: number | null;
  sortOrder: string;
}

function DepartmentEditor({
  department,
  departments,
  employees,
  canEdit,
  onDeleted,
}: {
  department: DepartmentView;
  departments: readonly DepartmentView[];
  employees: readonly EmployeeView[];
  canEdit: boolean;
  onDeleted: () => void;
}) {
  const initial: EditorState = {
    departmentCode: department.departmentCode,
    departmentName: department.departmentName,
    parentId: department.parentId,
    headEmployeeId: department.headEmployeeId,
    sortOrder: String(department.sortOrder),
  };
  const [form, setForm] = useState<EditorState>(initial);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const onError = (error: unknown) => setErrors(error instanceof InputError ? error.fieldErrors : {});
  const save = useAction(departmentAdminApi.update, { success: '부서 정보를 저장했어요', onError });
  const remove = useAction(departmentAdminApi.remove, {
    success: (saved) => `${saved.name} 부서를 삭제했어요`,
    onSuccess: () => {
      setConfirmDelete(false);
      onDeleted();
    },
  });

  const blocked = blockedParentIdsOf(departments, department.id);
  const members = employees.filter((e) => e.departmentId === department.id);
  const headCandidates = members.filter((e) => e.isActive);
  const childCount = departments.filter((d) => d.parentId === department.id).length;
  const currentHead = employees.find((e) => e.id === department.headEmployeeId);
  const dirty = (Object.keys(initial) as (keyof EditorState)[]).some((key) => form[key] !== initial[key]);
  const deleteBlock =
    members.length > 0 ? `소속 사원이 ${members.length}명 있어 삭제할 수 없어요` : childCount > 0 ? `하위 부서가 ${childCount}개 있어 삭제할 수 없어요` : null;
  const lockTitle = canEdit ? undefined : permissionNeedText([PERMISSION.ORG_MANAGE]);

  const submit = () => {
    setErrors({});
    save.mutate({ id: department.id, ...form, expectedUpdatedAt: department.updatedAt });
  };

  return (
    <Card>
      <CardHead
        title={department.departmentName}
        meta={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{department.departmentCode}</span>
            {currentHead ? <Badge tone="run" plain>부서장 {currentHead.employeeName}</Badge> : <Badge tone="wait">부서장 없음</Badge>}
            <span>
              소속 {members.length}명 · 하위 부서 {childCount}개
            </span>
          </span>
        }
      />
      <CardBody>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="부서 코드" required error={errors.departmentCode} hint="영문 대문자·숫자·하이픈 30자 이내" htmlFor="department-code">
            <Input
              id="department-code"
              className="font-mono"
              maxLength={30}
              disabled={!canEdit}
              value={form.departmentCode}
              invalid={Boolean(errors.departmentCode)}
              onChange={(e) => set('departmentCode', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="부서명" required error={errors.departmentName} htmlFor="department-name">
            <Input id="department-name" maxLength={50} disabled={!canEdit} value={form.departmentName} invalid={Boolean(errors.departmentName)} onChange={(e) => set('departmentName', e.target.value)} />
          </Field>
          <Field label="상위 부서" error={errors.parentId} hint="자기 자신이나 하위 부서는 상위 부서로 지정할 수 없어요" htmlFor="department-parent">
            <Select
              id="department-parent"
              disabled={!canEdit}
              value={form.parentId ?? ''}
              invalid={Boolean(errors.parentId)}
              onChange={(e) => set('parentId', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">상위 부서 없음 (최상위)</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id} disabled={blocked.has(d.id)}>
                  {departmentOptionLabel(d.departmentName, d.depth)}
                  {blocked.has(d.id) ? ' (자기 자신·하위 부서)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="부서장 (승인권자)"
            error={errors.headEmployeeId}
            hint={headCandidates.length > 0 ? '이 부서의 사용 중인 사원 중에서 1명을 골라요' : '이 부서에 사용 중인 사원이 없어요. 사원 화면에서 먼저 이 부서로 등록해 주세요'}
            htmlFor="department-head"
          >
            <Select
              id="department-head"
              disabled={!canEdit}
              value={form.headEmployeeId ?? ''}
              invalid={Boolean(errors.headEmployeeId)}
              onChange={(e) => set('headEmployeeId', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">지정 안 함</option>
              {headCandidates.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeName} · {e.jobGradeName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="정렬 순서" required error={errors.sortOrder} hint="같은 상위 부서 안에서 작은 수가 먼저 나와요" htmlFor="department-sort">
            <Input
              id="department-sort"
              inputMode="numeric"
              numeric
              disabled={!canEdit}
              value={form.sortOrder}
              invalid={Boolean(errors.sortOrder)}
              onChange={(e) => set('sortOrder', e.target.value)}
            />
          </Field>
        </div>
      </CardBody>
      <CardFoot>
        <Button
          variant="danger-outline"
          size="sm"
          icon="trash"
          disabled={!canEdit || deleteBlock !== null}
          title={lockTitle ?? deleteBlock ?? undefined}
          onClick={() => setConfirmDelete(true)}
        >
          삭제
        </Button>
        {dirty ? <span className="ml-auto text-cap text-wait">저장 전 변경이 있어요</span> : <span className="ml-auto" />}
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setForm(initial);
            setErrors({});
          }}
        >
          되돌리기
        </Button>
        <Button size="sm" variant="primary" disabled={!canEdit || !dirty || save.isPending} title={lockTitle} onClick={submit}>
          {save.isPending ? '저장하는 중…' : '저장'}
        </Button>
      </CardFoot>
      {confirmDelete ? (
        <ConfirmDialog
          title="부서를 삭제할까요?"
          confirmLabel="삭제"
          tone="danger"
          pending={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate({ id: department.id, expectedUpdatedAt: department.updatedAt })}
        >
          {department.departmentName}({department.departmentCode}) 부서를 지워요. 되돌릴 수 없어요.
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}
