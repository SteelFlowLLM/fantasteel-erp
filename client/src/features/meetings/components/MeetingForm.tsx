'use client';

// 새 회의록: 제목·회의일·참석자는 공통, 기록은 녹음 / 파일 올리기 / 글로 붙여넣기 중 하나로 받는다.
// 음성은 올리면 서버가 백그라운드로 글로 바꾼다 (BP-VOC-01). AI 정리는 다음 단계다.
import { useId, useState } from 'react';
import { InputError } from '@/api/errors';
import { MEETING_TITLE_MAX, MEETING_TRANSCRIPT_MAX, meetingMinutesApi, meetingMinutesAudioApi, type MeetingMinutesView } from '@/api/meetingMinutes';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { PageHead } from '@/components/Page';
import { Tabs } from '@/components/Tabs';
import { AudioRecorder } from '@/features/meetings/components/AudioRecorder';
import { AttendeePicker } from '@/features/meetings/components/AttendeePicker';
import { useAction } from '@/hooks/useAction';
import { useMe } from '@/hooks/useMe';
import { fmtBytes, todayStr } from '@/lib/format';
import { audioFileProblem } from '@/lib/meetingAudio';

type InputMode = 'record' | 'file' | 'text';
const MODE_TABS = [
  { key: 'record', label: '녹음' },
  { key: 'file', label: '파일 올리기' },
  { key: 'text', label: '글로 붙여넣기' },
] as const;

export function MeetingForm({ onCreated, onCancel }: { onCreated: (created: MeetingMinutesView) => void; onCancel: () => void }) {
  const myId = useMe().employeeId;
  const formId = useId();
  const [title, setTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState(todayStr());
  const [attendeeIds, setAttendeeIds] = useState<number[]>([myId]);
  const [mode, setMode] = useState<InputMode>('record');
  const [transcript, setTranscript] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [notified, setNotified] = useState(false);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
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

  const upload = useAction(meetingMinutesAudioApi.create, {
    success: '음성을 올렸어요. 글로 바꾸는 중이에요',
    toastOnError: false,
    onSuccess: onCreated,
    onError: (error) => {
      setFieldErrors(error instanceof InputError ? error.fieldErrors : {});
      setServerMessage(error instanceof Error ? error.message : '음성을 올리지 못했어요');
    },
  });
  const pending = create.isPending || upload.isPending;
  const isAudio = mode !== 'text';

  const switchMode = (next: InputMode) => {
    setMode(next);
    setAudioFile(null);
    setFileProblem(null);
    setServerMessage(null);
    setFieldErrors({});
  };

  const lineCount = transcript.split(/\r?\n/).filter((line) => line.trim() !== '').length;

  return (
    <>
      <PageHead
        crumb="회의록"
        title="새 회의록"
        actions={
          <Button icon="chevron-left" onClick={onCancel} disabled={pending}>
            목록으로
          </Button>
        }
      />
      <Card className="flex-none">
        <CardHead title="회의 정보와 전체 기록" meta="음성은 글로 바꿔 원본 전사로 저장해요. 원본 음성은 저장하지 않아요" />
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            setServerMessage(null);
            setFieldErrors({});
            if (isAudio) {
              if (audioFile && notified) upload.mutate({ meetingMinutesTitle: title, meetingDate, attendeeIds, file: audioFile });
              return;
            }
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
            <Tabs items={MODE_TABS} active={mode} onChange={switchMode} ariaLabel="기록 입력 방법" />
            {isAudio ? (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={notified} disabled={pending} onChange={(event) => setNotified(event.target.checked)} />
                  <span>
                    참석자에게 녹음·전사 사실을 알렸어요 <span className="text-danger">*</span>
                  </span>
                </label>
                {mode === 'record' ? (
                  <AudioRecorder disabled={!notified || pending} file={audioFile} onChange={setAudioFile} />
                ) : (
                  <Field label="음성 파일" required error={fieldErrors.file ?? fileProblem} hint="오디오 파일, 100MB까지">
                    <div className="flex flex-col gap-1.5">
                      <input
                        type="file"
                        accept="audio/*,video/webm"
                        disabled={!notified || pending}
                        aria-label="음성 파일"
                        onChange={(event) => {
                          const picked = event.target.files?.[0] ?? null;
                          const problem = picked ? audioFileProblem(picked) : null;
                          setFileProblem(problem);
                          setAudioFile(picked && !problem ? picked : null);
                        }}
                      />
                      {audioFile ? (
                        <span className="text-cap text-ink-2">
                          {audioFile.name} · {fmtBytes(audioFile.size)}
                        </span>
                      ) : null}
                    </div>
                  </Field>
                )}
                {!notified ? <span className="text-cap text-ink-3">알렸다고 확인해야 녹음하거나 올릴 수 있어요</span> : null}
              </>
            ) : (
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
            )}
          </CardBody>
          <CardFoot>
            <span className="text-cap text-ink-3">{isAudio ? '올린 뒤 글로 바뀔 때까지 기다리지 않고 상세 화면으로 가요' : '만든 뒤에는 전체 기록을 고칠 수 없어요 · AI 정리는 다음 단계에서 붙어요'}</span>
            <Button className="ml-auto" onClick={onCancel} disabled={pending}>
              취소
            </Button>
            <Button variant="primary" type="submit" disabled={pending || (isAudio && (!notified || !audioFile))}>
              {isAudio ? (upload.isPending ? '올리는 중…' : '올리기') : create.isPending ? '저장하는 중…' : '회의록 만들기'}
            </Button>
          </CardFoot>
        </form>
      </Card>
    </>
  );
}
