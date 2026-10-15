'use client';

// 후보 한 건 고치기 (REQ-VOC-004). 사용자가 바꾼 칸만 서버로 보낸다: 서버는 보낸 칸의 AI 확인 사유를 지우므로, 건드리지 않은 칸을 보내면 경고가 사라진다.
import { ITEM_TYPE, type MeetingCandidate, type MeetingCandidateUpdateInput } from '@fantasteel/shared';
import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Input, Select, Textarea } from '@/components/Input';
import { AttendeePicker, groupsOfChart } from '@/features/meetings/components/AttendeePicker';
import { useAdminOrgChart } from '@/hooks/useAdminOrganization';
import { useItemList } from '@/hooks/useLookups';
import { MEETING_TITLE_MAX } from '@/api/meetingMinutes';

/** 'YYYY-MM-DDTHH:mm' (서울 시각, datetime-local 입력값). +09:00 ISO를 그대로 잘라 만든다 */
const toLocalInput = (iso: string | null): string => (iso ? iso.slice(0, 16) : '');

interface Draft {
  title: string;
  description: string;
  assigneeId: string;
  dueDate: string;
  startAt: string;
  endAt: string;
  attendeeIds: number[];
  itemId: string;
  requestedTon: string;
  desiredReceiptDate: string;
}

const draftOf = (c: MeetingCandidate): Draft => ({
  title: c.title,
  description: c.description ?? '',
  assigneeId: c.assigneeId === null ? '' : String(c.assigneeId),
  dueDate: c.dueDate ?? '',
  startAt: toLocalInput(c.startAt),
  endAt: toLocalInput(c.endAt),
  attendeeIds: c.attendeeIds,
  itemId: c.purchase?.itemId == null ? '' : String(c.purchase.itemId),
  requestedTon: c.purchase?.requestedTon ?? '',
  desiredReceiptDate: c.purchase?.desiredReceiptDate ?? '',
});

/** 처음 값과 다른 칸만 모은다. 비어 있는 칸은 "아직 정하지 않음"이라 보내지 않는다 */
export function changesOf(c: MeetingCandidate, next: Draft): MeetingCandidateUpdateInput {
  const before = draftOf(c);
  const input: MeetingCandidateUpdateInput = {};
  if (next.title.trim() !== before.title) input.title = next.title.trim();
  if (next.description.trim() !== before.description) input.description = next.description.trim() || null;
  if (c.kind === 'TASK') {
    if (next.assigneeId !== '' && next.assigneeId !== before.assigneeId) input.assigneeId = Number(next.assigneeId);
    if (next.dueDate !== '' && next.dueDate !== before.dueDate) input.dueDate = next.dueDate;
  } else if (c.kind === 'EVENT') {
    if (next.startAt !== '' && next.startAt !== before.startAt) input.startAt = next.startAt;
    if (next.endAt !== '' && next.endAt !== before.endAt) input.endAt = next.endAt;
    const same = next.attendeeIds.length === before.attendeeIds.length && next.attendeeIds.every((id) => before.attendeeIds.includes(id));
    if (!same) input.attendeeIds = next.attendeeIds;
  } else {
    const purchase: NonNullable<MeetingCandidateUpdateInput['purchase']> = {};
    if (next.itemId !== '' && next.itemId !== before.itemId) purchase.itemId = Number(next.itemId);
    if (next.requestedTon.trim() !== '' && next.requestedTon.trim() !== before.requestedTon) purchase.requestedTon = next.requestedTon.trim();
    if (next.desiredReceiptDate !== '' && next.desiredReceiptDate !== before.desiredReceiptDate) purchase.desiredReceiptDate = next.desiredReceiptDate;
    if (Object.keys(purchase).length > 0) input.purchase = purchase;
  }
  return input;
}

export function CandidateEditor({ candidate, myId, pending, onCancel, onSave }: { candidate: MeetingCandidate; myId: number; pending: boolean; onCancel: () => void; onSave: (input: MeetingCandidateUpdateInput) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(candidate));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const chart = useAdminOrgChart();
  const groups = useMemo(() => groupsOfChart(chart.data ?? []), [chart.data]);
  const rawMaterials = useItemList({ itemType: ITEM_TYPE.RAW_MATERIAL });
  const titleError = draft.title.trim() === '' ? '제목을 입력해 주세요' : null;
  const changes = changesOf(candidate, draft);

  const save = () => {
    if (titleError) return;
    if (Object.keys(changes).length === 0) onCancel();
    else onSave(changes);
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xs border border-line-strong bg-surface p-3">
      <Field label="제목" htmlFor={`cand-${candidate.key}-title`} error={titleError}>
        <Input id={`cand-${candidate.key}-title`} value={draft.title} maxLength={MEETING_TITLE_MAX} invalid={!!titleError} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="설명" htmlFor={`cand-${candidate.key}-desc`}>
        <Textarea id={`cand-${candidate.key}-desc`} rows={2} maxLength={1000} value={draft.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      {candidate.kind === 'TASK' ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field label="담당자" htmlFor={`cand-${candidate.key}-assignee`} hint="회의 참석자가 아니어도 고를 수 있어요">
            <Select id={`cand-${candidate.key}-assignee`} value={draft.assigneeId} onChange={(e) => set('assigneeId', e.target.value)}>
              <option value="">선택해 주세요</option>
              {groups.map((group) => (
                <optgroup key={group.departmentName} label={group.departmentName}>
                  {group.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.employeeName} {member.jobGradeName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="마감일" htmlFor={`cand-${candidate.key}-due`}>
            <DateInput id={`cand-${candidate.key}-due`} value={draft.dueDate} onChange={(value) => set('dueDate', value)} />
          </Field>
        </div>
      ) : null}
      {candidate.kind === 'EVENT' ? (
        <>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label="시작" htmlFor={`cand-${candidate.key}-start`}>
              <Input id={`cand-${candidate.key}-start`} type="datetime-local" value={draft.startAt} onChange={(e) => set('startAt', e.target.value)} />
            </Field>
            <Field label="끝" htmlFor={`cand-${candidate.key}-end`}>
              <Input id={`cand-${candidate.key}-end`} type="datetime-local" value={draft.endAt} onChange={(e) => set('endAt', e.target.value)} />
            </Field>
          </div>
          <Field label="참석자" hint="일정이 등록되면 알림이 가요">
            <AttendeePicker selected={draft.attendeeIds} myId={myId} onChange={(ids) => set('attendeeIds', ids)} />
          </Field>
        </>
      ) : null}
      {candidate.kind === 'PURCHASE' ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Field label="원료 품목" htmlFor={`cand-${candidate.key}-item`}>
            <Select id={`cand-${candidate.key}-item`} value={draft.itemId} onChange={(e) => set('itemId', e.target.value)}>
              <option value="">선택해 주세요</option>
              {(rawMaterials.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.itemName} ({item.itemCode})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="수량" htmlFor={`cand-${candidate.key}-ton`} hint="소수 3자리까지">
            <Input id={`cand-${candidate.key}-ton`} numeric suffix="t" inputMode="decimal" value={draft.requestedTon} onChange={(e) => set('requestedTon', e.target.value)} />
          </Field>
          <Field label="희망 입고일" htmlFor={`cand-${candidate.key}-receipt`}>
            <DateInput id={`cand-${candidate.key}-receipt`} value={draft.desiredReceiptDate} onChange={(value) => set('desiredReceiptDate', value)} />
          </Field>
        </div>
      ) : null}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" onClick={onCancel} disabled={pending}>
          취소
        </Button>
        <Button size="sm" variant="primary" onClick={save} disabled={pending || !!titleError}>
          {pending ? '저장하는 중…' : '저장'}
        </Button>
      </div>
    </div>
  );
}
