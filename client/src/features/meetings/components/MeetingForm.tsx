'use client';

// 새 회의록: 제목·회의일·참석자·전체 기록(글로 붙여 넣기). 음성 입력(STT)과 AI 정리는 다음 단계다 (BP-VOC-01).
import { useId, useState } from 'react';
import { InputError } from '@/api/errors';
import { MEETING_TITLE_MAX, MEETING_TRANSCRIPT_MAX, meetingMinutesApi, type MeetingMinutesView } from '@/api/meetingMinutes';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { PageHead } from '@/components/Page';
import { AttendeePicker } from '@/features/meetings/components/AttendeePicker';
import { useAction } from '@/hooks/useAction';
import { useMe } from '@/hooks/useMe';
import { todayStr } from '@/lib/format';

export function MeetingForm({ onCreated, onCancel }: { onCreated: (created: MeetingMinutesView) => void; onCancel: () => void }) {
  const myId = useMe().employeeId;
  const formId = useId();
  const [title, setTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState(todayStr());
  const [attendeeIds, setAttendeeIds] = useState<number[]>([myId]);
  const [transcript, setTranscript] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const create = useAction(meetingMinutesApi.create, {
    success: '회의록을 만들었어요',
    toastOnError: false,
    onSuccess: onCreated,
    onError: (error) => {
      setFieldErrors(error instanceof InputError ? error.fieldErrors : {});
      setServerMessage(error instanceof Error ? error.message : '회의록을 만들지 못했어요');
    },
  });

  const lineCount = transcript.split(/\r?\n/).filter((line) => line.trim() !== '').length;

  return (
    <>
      <PageHead
        crumb="회의록"
        title="새 회의록"
        actions={
          <Button icon="chevron-left" onClick={onCancel} disabled={create.isPending}>
            목록으로
          </Button>
        }
      />
      <Card className="flex-none">
        <CardHead title="회의 정보와 전체 기록" meta="글로 붙여 넣은 기록을 원본 전사로 저장해요" />
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            setServerMessage(null);
            setFieldErrors({});
            create.mutate({ meetingMinutesTitle: title, meetingDate, attendeeIds, transcript });
          }}
        >
          <CardBody className="gap-3.5">
            {serverMessage ? <Banner tone="danger">{serverMessage}</Banner> : null}
            <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-3.5">
              <Field label="제목" required htmlFor={`${formId}-title`} error={fieldErrors.meetingMinutesTitle}>
                <Input
                  id={`${formId}-title`}
                  value={title}
                  maxLength={MEETING_TITLE_MAX}
                  autoFocus
                  placeholder="예: 동해철강 방문 준비 회의"
                  invalid={Boolean(fieldErrors.meetingMinutesTitle)}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field label="회의일" required htmlFor={`${formId}-date`} error={fieldErrors.meetingDate}>
                <DateInput id={`${formId}-date`} value={meetingDate} onChange={setMeetingDate} invalid={Boolean(fieldErrors.meetingDate)} className="w-full" />
              </Field>
            </div>
            <Field label={`참석자 ${attendeeIds.length}명`} required error={fieldErrors.attendeeIds} hint="조직도의 사용 중인 사원">
              <AttendeePicker selected={attendeeIds} myId={myId} invalid={Boolean(fieldErrors.attendeeIds)} onChange={setAttendeeIds} />
            </Field>
            <Field
              label="전체 기록"
              required
              htmlFor={`${formId}-transcript`}
              error={fieldErrors.transcript}
              hint={`한 줄에 한 발언. 예) 김영업: 다음 주 화요일 2시에 동해철강 방문합시다 · 지금 ${lineCount}줄`}
            >
              <Textarea
                id={`${formId}-transcript`}
                value={transcript}
                rows={14}
                maxLength={MEETING_TRANSCRIPT_MAX}
                placeholder={'김영업: 다음 주 화요일 2시에 동해철강 방문합시다\n정다은: 원료 입고 일정부터 확인할게요'}
                invalid={Boolean(fieldErrors.transcript)}
                onChange={(event) => setTranscript(event.target.value)}
              />
            </Field>
          </CardBody>
          <CardFoot>
            <span className="text-cap text-ink-3">만든 뒤에는 전체 기록을 고칠 수 없어요 · AI 정리는 다음 단계에서 붙어요</span>
            <Button className="ml-auto" onClick={onCancel} disabled={create.isPending}>
              취소
            </Button>
            <Button variant="primary" type="submit" disabled={create.isPending}>
              {create.isPending ? '저장하는 중…' : '회의록 만들기'}
            </Button>
          </CardFoot>
        </form>
      </Card>
    </>
  );
}
