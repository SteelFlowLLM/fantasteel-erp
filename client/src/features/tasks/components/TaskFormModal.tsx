'use client';

// 업무 추가·수정 창 (REQ-NTF-001: 담당자와 마감일 지정). 담당자는 조직도(GET /departments)의 사용 중 사원에서 고른다 (REQ-ORG-004).
// 마감일은 서버에서 필수다 (api/server/tasks.ts).
import { useId, useMemo, useState } from 'react';
import type { OrgChartDepartmentView } from '@/api/adminOrganization';
import { InputError } from '@/api/client';
import { TASK_DESCRIPTION_MAX, TASK_TITLE_MAX, taskApi, type TaskView } from '@/api/tasks';
import { Button } from '@/components/Button';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { LINK_PATH_MAX_LENGTH } from '@/features/tasks/lib/taskDue';
import { useAction } from '@/hooks/useAction';
import { useAdminOrgChart } from '@/hooks/useAdminOrganization';
import { useMe } from '@/hooks/useMe';

type MemberGroup = { departmentName: string; members: { id: number; employeeName: string; jobGradeName: string }[] };

const groupsOfChart = (nodes: readonly OrgChartDepartmentView[]): MemberGroup[] =>
  nodes.flatMap((node) => [{ departmentName: node.departmentName, members: node.members }, ...groupsOfChart(node.children)]).filter((group) => group.members.length > 0);

/** 메신저 메시지에서 업무를 등록할 때 (16번): 제목·설명을 메시지로 미리 채우고, 연결 화면은 그 메시지로 정해진다 */
export interface TaskSourceMessage {
  messageId: number;
  title: string;
  description: string;
}

export function TaskFormModal({ task, source, onClose }: { task: TaskView | null; source?: TaskSourceMessage; onClose: () => void }) {
  const myId = useMe().employeeId;
  const formId = useId();
  const chart = useAdminOrgChart();
  const [title, setTitle] = useState(task?.title ?? source?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? source?.description ?? '');
  const [assigneeId, setAssigneeId] = useState<number | null>(task?.assignee.id ?? myId);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [linkPath, setLinkPath] = useState(task?.linkPath ?? '');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const options = {
    onSuccess: onClose,
    onError: (error: unknown) => setFieldErrors(error instanceof InputError ? error.fieldErrors : {}),
  };
  const create = useAction(taskApi.create, { success: '업무를 추가했어요', ...options });
  const update = useAction(taskApi.update, { success: '업무를 고쳤어요', ...options });
  const pending = create.isPending || update.isPending;

  const groups = useMemo(
    () =>
      groupsOfChart(chart.data ?? []).map((group) => ({
        departmentName: group.departmentName,
        members: group.members.map((m) => ({ id: m.id, label: `${m.employeeName} ${m.jobGradeName}${m.id === myId ? ' (나)' : ''}` })),
      })),
    [chart.data, myId],
  );

  const submit = () => {
    const input = { title, description, assigneeId, dueDate, linkPath };
    if (task) update.mutate({ ...input, id: task.id, expectedUpdatedAt: task.updatedAt });
    else create.mutate(source ? { ...input, linkPath: null, messageId: source.messageId } : input);
  };

  return (
    <Modal
      title={task ? '업무 고치기' : source ? '메시지로 업무 등록' : '업무 추가'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="mr-auto self-center text-cap text-ink-3">
            {assigneeId === myId ? '나에게 맡기는 업무는 알림이 없어요' : '담당자에게 업무 지정 알림이 가요'}
          </span>
          <Button onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={pending}>
            {pending ? '저장하는 중…' : task ? '저장' : '추가'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="제목" required htmlFor={`${formId}-title`} error={fieldErrors.title}>
          <Input
            id={`${formId}-title`}
            value={title}
            maxLength={TASK_TITLE_MAX}
            autoFocus
            placeholder="예: 원료 입고 일정 확인"
            invalid={Boolean(fieldErrors.title)}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="설명" htmlFor={`${formId}-description`} error={fieldErrors.description}>
          <Textarea
            id={`${formId}-description`}
            value={description}
            rows={3}
            maxLength={TASK_DESCRIPTION_MAX}
            placeholder="필요한 내용을 적어 주세요"
            invalid={Boolean(fieldErrors.description)}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="담당자" required htmlFor={`${formId}-assignee`} hint="조직도의 사용 중인 사원" error={fieldErrors.assigneeId}>
            <Select
              id={`${formId}-assignee`}
              value={assigneeId ?? ''}
              disabled={chart.isPending}
              invalid={Boolean(fieldErrors.assigneeId)}
              onChange={(event) => setAssigneeId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">담당자 고르기</option>
              {groups.map((group) => (
                <optgroup key={group.departmentName} label={group.departmentName}>
                  {group.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="마감일" required htmlFor={`${formId}-due`} error={fieldErrors.dueDate}>
            <DateInput id={`${formId}-due`} value={dueDate} onChange={setDueDate} invalid={Boolean(fieldErrors.dueDate)} className="w-full" />
          </Field>
        </div>
        {source ? <p className="text-cap text-ink-3">업무에서 이 메시지로 바로 갈 수 있어요.</p> : (
          <Field
            label="연결 화면"
            htmlFor={`${formId}-link`}
            hint="업무에서 바로 열 화면 경로 (선택). 예: /goods-receipts, /sales-orders/12"
            error={fieldErrors.linkPath}
          >
            <Input
              id={`${formId}-link`}
              value={linkPath}
              maxLength={LINK_PATH_MAX_LENGTH}
              placeholder="/…"
              invalid={Boolean(fieldErrors.linkPath)}
              onChange={(event) => setLinkPath(event.target.value)}
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}
