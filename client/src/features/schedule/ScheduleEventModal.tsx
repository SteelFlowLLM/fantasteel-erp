'use client';

// 내 일정 직접 등록·수정 창 (2026-10-16, 문서에 없는 기능). 등록자 본인만 참석자로 두는 나만의 일정이다.
import type { ScheduleEventView } from '@fantasteel/shared';
import { useState } from 'react';
import { scheduleEventApi, scheduleEventKeys } from '@/api/scheduleEvents';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { DESCRIPTION_MAX, TITLE_MAX, emptyForm, endOptions, formOf, formProblem, inputOf, shiftEnd, startOptions, type ScheduleForm } from '@/features/schedule/lib/scheduleForm';
import { useAction } from '@/hooks/useAction';

/** event가 있으면 고치기, 없으면 date 날에 새로 추가 */
export function ScheduleEventModal({ event, date, onClose }: { event?: ScheduleEventView; date: string; onClose: () => void }) {
  const [form, setForm] = useState<ScheduleForm>(() => (event ? formOf(event) : emptyForm(date)));
  const [touched, setTouched] = useState(false);
  const create = useAction(scheduleEventApi.create, { success: '일정을 추가했어요', invalidate: [scheduleEventKeys.all], onSuccess: onClose });
  const update = useAction(scheduleEventApi.update, { success: '일정을 고쳤어요', invalidate: [scheduleEventKeys.all], onSuccess: onClose });
  const pending = create.isPending || update.isPending;
  const problem = formProblem(form);
  const set = <K extends keyof ScheduleForm>(key: K, value: ScheduleForm[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (problem || pending) return;
    if (event) update.mutate({ id: event.id, input: inputOf(form) });
    else create.mutate(inputOf(form));
  };

  return (
    <Modal
      title={event ? '일정 고치기' : '일정 추가'}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={pending} onClick={submit}>
            {pending ? '저장하는 중…' : '저장'}
          </Button>
        </>
      }
    >
      {/* 입력칸에서 Enter를 눌러도 저장되지 않게 제출 버튼 없이 둔다 (저장은 아래 버튼으로만) */}
      <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
        <Field label="제목" required error={touched && !form.title.trim() ? '제목을 입력해 주세요' : null}>
          <Input value={form.title} maxLength={TITLE_MAX} autoFocus placeholder="예: 거래처 방문" onChange={(e) => set('title', e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_120px_120px] gap-3">
          <Field label="날짜" required>
            <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="시작" required>
            <Select
              value={form.start}
              className="font-mono tabular-nums"
              onChange={(e) => {
                const start = e.target.value;
                setForm((prev) => ({ ...prev, start, end: shiftEnd(prev.start, prev.end, start) }));
              }}
            >
              {startOptions(form.start).map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="끝" required>
            <Select value={form.end} className="font-mono tabular-nums" onChange={(e) => set('end', e.target.value)}>
              {endOptions(form.start, form.end).map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {touched && problem && form.title.trim() ? <span className="text-xs text-danger">{problem}</span> : null}
        <Field label="메모" hint="나만 보는 일정이에요. 다른 사원에게 알림을 보내지 않아요.">
          <Textarea rows={3} maxLength={DESCRIPTION_MAX} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
