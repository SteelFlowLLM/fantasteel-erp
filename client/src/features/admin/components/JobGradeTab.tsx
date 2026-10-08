'use client';

// 직급 탭 (REQ-AUTH-002, TRM-036): 직급 코드·직급명·표시 순서 등록·수정·삭제. 표시 순서는 조직도 인원 순서에 쓴다.
import { useState } from 'react';
import { PERMISSION } from '@/codes';
import { jobGradeAdminApi } from '@/api/adminOrganization';
import { InputError } from '@/api/client';
import type { JobGradeView } from '@/api/directory';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { IconButton } from '@/components/IconButton';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { useAction } from '@/hooks/useAction';
import { useJobGradeList } from '@/hooks/useDirectory';
import { useCanUse } from '@/hooks/usePermission';
import { permissionNeedText } from '@/lib/permissions';

export function JobGradeTab() {
  const jobGrades = useJobGradeList();
  // 직급 등록·수정·삭제는 API 명세대로 사원 관리 권한이다. 퇴사자가 쓰는 직급은 서버가 삭제를 막는다(API-273)
  const canEdit = useCanUse(PERMISSION.EMPLOYEE_MANAGE);
  const [editing, setEditing] = useState<JobGradeView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<JobGradeView | null>(null);
  const remove = useAction(jobGradeAdminApi.remove, { success: (saved) => `${saved.name} 직급을 삭제했어요`, onSuccess: () => setDeleting(null) });
  const lockTitle = canEdit ? undefined : permissionNeedText([PERMISSION.EMPLOYEE_MANAGE]);

  return (
    <Card className="flex-none">
      <CardHead
        title="직급"
        meta="표시 순서가 작은 직급이 조직도에서 먼저 나와요"
        actions={
          <Button size="sm" variant="primary" icon="plus" disabled={!canEdit} title={lockTitle} onClick={() => setEditing('new')}>
            직급 추가
          </Button>
        }
      />
      <CardBody flush>
        <QueryBoundary query={jobGrades} loadingLabel="직급을 불러오는 중…">
          {(list) =>
            list.length === 0 ? (
              <EmptyNote>등록된 직급이 없어요</EmptyNote>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th align="right" className="w-24">
                      표시 순서
                    </Th>
                    <Th>직급명</Th>
                    <Th align="right">사원 수</Th>
                    <Th className="w-24">
                      <span className="sr-only">관리</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((g) => {
                    const deleteTitle = lockTitle ?? (g.employeeCount > 0 ? `이 직급의 사원이 ${g.employeeCount}명 있어 삭제할 수 없어요` : undefined);
                    return (
                      <tr key={g.id}>
                        <Td align="right">{g.sortOrder}</Td>
                        <Td className="font-medium">{g.jobGradeName}</Td>
                        <Td align="right">{g.employeeCount}명</Td>
                        <Td align="right">
                          <IconButton icon="edit" label={`${g.jobGradeName} 수정`} size="sm" disabled={!canEdit} title={lockTitle} onClick={() => setEditing(g)} />
                          <IconButton
                            icon="trash"
                            label={`${g.jobGradeName} 삭제`}
                            size="sm"
                            disabled={!canEdit || g.employeeCount > 0}
                            title={deleteTitle}
                            onClick={() => setDeleting(g)}
                          />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )
          }
        </QueryBoundary>
      </CardBody>
      {editing ? <JobGradeFormModal key={editing === 'new' ? 'new' : editing.id} target={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title="직급을 삭제할까요?"
          confirmLabel="삭제"
          tone="danger"
          pending={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate({ id: deleting.id, expectedUpdatedAt: deleting.updatedAt })}
        >
          {deleting.jobGradeName} 직급을 지워요. 되돌릴 수 없어요.
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

function JobGradeFormModal({ target, onClose }: { target?: JobGradeView; onClose: () => void }) {
  const [jobGradeName, setJobGradeName] = useState(target?.jobGradeName ?? '');
  const [sortOrder, setSortOrder] = useState(target ? String(target.sortOrder) : '');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const onError = (error: unknown) => setErrors(error instanceof InputError ? error.fieldErrors : {});
  const create = useAction(jobGradeAdminApi.create, { success: (saved) => `${saved.name} 직급을 추가했어요`, onSuccess: onClose, onError });
  const update = useAction(jobGradeAdminApi.update, { success: (saved) => `${saved.name} 직급을 저장했어요`, onSuccess: onClose, onError });
  const pending = create.isPending || update.isPending;

  const submit = () => {
    setErrors({});
    if (target) update.mutate({ id: target.id, jobGradeName, sortOrder, expectedUpdatedAt: target.updatedAt });
    else create.mutate({ jobGradeName, sortOrder });
  };

  return (
    <Modal
      title={target ? '직급 수정' : '직급 추가'}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? '저장하는 중…' : target ? '저장' : '추가'}
          </Button>
        </>
      }
    >
      <Field label="직급명" required error={errors.jobGradeName} htmlFor="job-grade-name">
        <Input id="job-grade-name" maxLength={30} placeholder="예: 과장" value={jobGradeName} invalid={Boolean(errors.jobGradeName)} onChange={(e) => setJobGradeName(e.target.value)} />
      </Field>
      <Field label="표시 순서" required error={errors.sortOrder} hint="작은 수가 조직도에서 먼저 나와요" htmlFor="job-grade-sort">
        <Input id="job-grade-sort" inputMode="numeric" numeric value={sortOrder} invalid={Boolean(errors.sortOrder)} onChange={(e) => setSortOrder(e.target.value)} />
      </Field>
    </Modal>
  );
}
