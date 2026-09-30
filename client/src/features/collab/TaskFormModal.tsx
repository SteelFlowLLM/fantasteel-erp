// 업무 추가·수정 모달 (REQ-NTF-001): 담당자는 조직 정보(사원 목록)에서 고르고, 마감일은 DateInput.
import { useMemo, useState } from 'react';
import { useDirectoryEmployees } from '@/api/directory';
import { taskApi, type TaskView, type UpdateTaskBody } from '@/api/tasks';
import { DateInput } from '@/components/DateInput';
import { Field, Icon, Modal } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { useMe } from '@/stores/auth';

const linkError = (path: string) => (!path || (path.startsWith('/') && !path.startsWith('//')) ? null : '"/"로 시작하는 화면 경로만 넣을 수 있어요 (예: /goods-receipts)');

export function TaskFormModal({ task, onClose }: { task?: TaskView; onClose: () => void }) {
  const me = useMe();
  const directory = useDirectoryEmployees();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [assigneeId, setAssigneeId] = useState<number>(task?.assigneeId ?? me.employeeId);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [linkPath, setLinkPath] = useState(task?.linkPath ?? '');
  const [touched, setTouched] = useState(false);

  const create = useAction(taskApi.create, { success: '업무를 추가했어요', invalidate: ['tasks'], onSuccess: onClose });
  const update = useAction(taskApi.update, { success: '업무를 고쳤어요', invalidate: ['tasks'], onSuccess: onClose });
  const pending = create.isPending || update.isPending;

  // 부서별로 묶은 담당자 목록
  const groups = useMemo(() => {
    const map = new Map<string, { id: number; label: string }[]>();
    for (const e of directory.data ?? []) {
      if (!map.has(e.departmentName)) map.set(e.departmentName, []);
      map.get(e.departmentName)?.push({ id: e.id, label: `${e.employeeName} ${e.jobGrade}${e.id === me.employeeId ? ' (나)' : ''}` });
    }
    return [...map.entries()];
  }, [directory.data, me.employeeId]);
  const assigneeKnown = (directory.data ?? []).some((e) => e.id === assigneeId);

  const titleError = title.trim() ? null : '제목을 입력해 주세요';
  const pathError = linkError(linkPath.trim());
  const submit = () => {
    setTouched(true);
    if (titleError || pathError) return;
    const t = title.trim();
    const d = description.trim();
    const l = linkPath.trim();
    if (!task) {
      create.mutate({ title: t, description: d || undefined, assigneeId, dueDate: dueDate || undefined, linkPath: l || undefined });
      return;
    }
    // 바뀐 항목만 보낸다 (비운 항목은 null)
    const patch: UpdateTaskBody = {};
    if (t !== task.title) patch.title = t;
    if (d !== (task.description ?? '')) patch.description = d || null;
    if (assigneeId !== task.assigneeId) patch.assigneeId = assigneeId;
    if (dueDate !== (task.dueDate ?? '')) patch.dueDate = dueDate || null;
    if (l !== (task.linkPath ?? '')) patch.linkPath = l || null;
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    update.mutate({ id: task.id, ...patch });
  };

  return (
    <Modal
      title={task ? '업무 수정' : '업무 추가'}
      onClose={onClose}
      footer={
        <>
          <span className="hl-cap" style={{ marginRight: 'auto', alignSelf: 'center' }}>
            {assigneeId !== me.employeeId ? '담당자에게 업무 배정 알림이 가요' : '나에게 맡기는 업무는 알림이 없어요'}
          </span>
          <button type="button" className="hl-btn" onClick={onClose}>취소</button>
          <button type="button" className="hl-btn hl-btn--primary" disabled={pending} onClick={submit}>{pending ? '저장하는 중…' : task ? '저장' : '추가'}</button>
        </>
      }
    >
      <Field label={<>제목<span className="req">*</span></>} error={touched ? titleError : null}>
        <input className={`hl-input${touched && titleError ? ' is-error' : ''}`} value={title} maxLength={200} autoFocus placeholder="예: 원료 입고 일정 확인" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="설명">
        <textarea className="hl-input" rows={3} value={description} maxLength={2000} placeholder="필요한 내용을 적어 주세요" onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 14 }}>
        <Field label={<>담당자<span className="req">*</span></>} hint="조직 정보의 재직 중인 사원">
          <span className="hl-selectwrap">
            <select className="hl-input" value={assigneeId} disabled={directory.isLoading} onChange={(e) => setAssigneeId(Number(e.target.value))}>
              {!assigneeKnown ? <option value={assigneeId}>{task && task.assigneeId === assigneeId ? task.assigneeName : me.employeeName}</option> : null}
              {groups.map(([dept, people]) => (
                <optgroup key={dept} label={dept}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </optgroup>
              ))}
            </select>
            <Icon name="chevron-down" size="sm" />
          </span>
        </Field>
        <div className="hl-field">
          <span className="hl-field__label">마감일</span>
          <DateInput value={dueDate} onChange={setDueDate} ariaLabel="마감일" />
          <span className="hl-field__hint">비워 두면 마감 없음</span>
        </div>
      </div>
      <Field label="연결 화면" hint="업무에서 바로 열 화면 경로 (선택). 예: /goods-receipts, /sales-orders/12" error={touched ? pathError : null}>
        <input className={`hl-input mono${touched && pathError ? ' is-error' : ''}`} value={linkPath} placeholder="/…" onChange={(e) => setLinkPath(e.target.value)} />
      </Field>
    </Modal>
  );
}
