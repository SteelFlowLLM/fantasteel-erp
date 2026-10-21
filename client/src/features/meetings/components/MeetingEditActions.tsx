'use client';

// 회의록 상세 머리의 참석자 고치기·삭제 (이슈 #449). 확정 전이고 전사·AI 정리 중이 아닐 때 작성자나 관리자에게만 보인다.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { meetingMinutesApi, meetingMinutesKeys, type MeetingMinutesView } from '@/api/meetingMinutes';
import { InputError } from '@/api/errors';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Modal } from '@/components/Modal';
import { AttendeePicker } from '@/features/meetings/components/AttendeePicker';
import { useAction } from '@/hooks/useAction';
import { useMe } from '@/hooks/useMe';
import { canEditMeeting, unlinkedSpeakerCount } from '@/lib/meetingEdit';

export function MeetingEditActions({ minutes, onDeleted }: { minutes: MeetingMinutesView; onDeleted: () => void }) {
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (!canEditMeeting(minutes, me)) return null;
  return (
    <>
      <Button size="sm" icon="users" onClick={() => setEditing(true)}>
        참석자 고치기
      </Button>
      <Button size="sm" variant="danger-outline" icon="trash" onClick={() => setDeleting(true)}>
        삭제
      </Button>
      {editing ? <AttendeeEditModal minutes={minutes} onClose={() => setEditing(false)} /> : null}
      {deleting ? <DeleteDialog minutes={minutes} onClose={() => setDeleting(false)} onDeleted={onDeleted} /> : null}
    </>
  );
}

function AttendeeEditModal({ minutes, onClose }: { minutes: MeetingMinutesView; onClose: () => void }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number[]>(() => minutes.attendees.map((a) => a.employeeId));
  const [error, setError] = useState<string | null>(null);
  const save = useAction(meetingMinutesApi.updateAttendees, {
    success: '참석자를 고쳤어요',
    toastOnError: false,
    onSuccess: (view) => {
      queryClient.setQueryData(meetingMinutesKeys.detail(me.employeeId, minutes.id), view);
      onClose();
    },
    onError: (e) => setError(e instanceof InputError ? (e.fieldErrors.attendeeIds ?? e.message) : e instanceof Error ? e.message : '참석자를 고치지 못했어요'),
  });
  const unlinked = unlinkedSpeakerCount(minutes, selected);

  return (
    <Modal
      title="참석자 고치기"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            취소
          </Button>
          <Button variant="primary" onClick={() => save.mutate({ id: minutes.id, attendeeIds: selected })} disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? '저장하는 중…' : `${selected.length}명으로 저장`}
          </Button>
        </>
      }
    >
      <AttendeePicker
        selected={selected}
        myId={me.employeeId}
        invalid={error !== null}
        onChange={(ids) => {
          setSelected(ids);
          setError(null);
        }}
      />
      {error ? <p className="text-cap text-danger">{error}</p> : null}
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-cap text-ink-3">
        {unlinked > 0 ? <li className="text-wait">빠지는 참석자에게 연결한 화자 {unlinked}명은 &apos;모름&apos;으로 돌아가요.</li> : null}
        {minutes.analysisResult ? <li>AI 요약·후보는 그대로예요. 새 참석자를 반영하려면 다시 정리해 주세요.</li> : null}
        <li>참석자 알림은 확정할 때 그때의 참석자에게 가요.</li>
      </ul>
    </Modal>
  );
}

function DeleteDialog({ minutes, onClose, onDeleted }: { minutes: MeetingMinutesView; onClose: () => void; onDeleted: () => void }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const remove = useAction(meetingMinutesApi.remove, {
    success: '회의록을 지웠어요',
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: meetingMinutesKeys.detail(me.employeeId, minutes.id) });
      onDeleted();
    },
  });
  return (
    <ConfirmDialog title="회의록 삭제" confirmLabel="삭제" tone="danger" pending={remove.isPending} onCancel={onClose} onConfirm={() => remove.mutate(minutes.id)}>
      ‘{minutes.meetingMinutesTitle}’ 회의록을 지울까요? 전사·AI 정리·화자 연결이 모두 사라지고 되돌릴 수 없어요.
    </ConfirmDialog>
  );
}
