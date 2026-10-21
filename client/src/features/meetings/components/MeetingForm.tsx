'use client';

// 새 회의록: 제목·회의일·참석자는 공통, 기록은 녹음 / 파일 올리기 / Drive에서 가져오기 / 글로 붙여넣기 중 하나로 받는다.
// Drive 가져오기(이슈 #361)는 회사 Google Drive가 연결되고 폴더가 정해졌을 때만 보인다.
// 음성은 올리면 서버가 백그라운드로 글로 바꾼다 (BP-VOC-01). AI 정리는 만든 뒤 상세 화면의 AI 분석(MeetingAnalysisPanel)에서 시킨다.
// 회의일은 오늘이 기본이고, 녹음 파일·Drive 녹음을 고르면 그 파일의 마지막 수정 날짜(서울 기준)로 바꾼다(직접 고친 뒤에는 그대로 둔다).
import { useId, useMemo, useState } from 'react';
import { InputError } from '@/api/errors';
import type { DriveFileView } from '@/api/integrations';
import { MEETING_TITLE_MAX, MEETING_TRANSCRIPT_MAX, meetingMinutesApi, meetingMinutesAudioApi, meetingMinutesDriveApi, type MeetingMinutesView } from '@/api/meetingMinutes';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { PageHead } from '@/components/Page';
import { Tabs } from '@/components/Tabs';
import { AudioRecorder } from '@/features/meetings/components/AudioRecorder';
import { DriveAudioPicker } from '@/features/meetings/components/DriveAudioPicker';
import { AttendeePicker } from '@/features/meetings/components/AttendeePicker';
import { useAction } from '@/hooks/useAction';
import { useIntegrations } from '@/hooks/useIntegrations';
import { useMe } from '@/hooks/useMe';
import { fmtBytes, todayStr } from '@/lib/format';
import { canImportAudioFromDrive, driveFileSizeLabel, googleDriveConnection } from '@/lib/integrations';
import { MEETING_AUDIO_ACCEPT, audioFileProblem, meetingDateOfAudio } from '@/lib/meetingAudio';

type InputMode = 'record' | 'file' | 'drive' | 'text';
const MODE_TABS: readonly { key: InputMode; label: string }[] = [
  { key: 'record', label: '녹음' },
  { key: 'file', label: '파일 올리기' },
  { key: 'drive', label: 'Drive에서 녹음 가져오기' },
  { key: 'text', label: '글로 붙여넣기' },
];

export function MeetingForm({ onCreated, onCancel }: { onCreated: (created: MeetingMinutesView) => void; onCancel: () => void }) {
  const myId = useMe().employeeId;
  const formId = useId();
  const [title, setTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState(todayStr());
  // 회의일을 직접 고쳤으면 파일을 골라도 덮어쓰지 않는다
  const [meetingDateEdited, setMeetingDateEdited] = useState(false);
  const [attendeeIds, setAttendeeIds] = useState<number[]>([myId]);
  const [mode, setMode] = useState<InputMode>('record');
  const [transcript, setTranscript] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [notified, setNotified] = useState(false);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [driveFile, setDriveFile] = useState<DriveFileView | null>(null);
  const [pickingDrive, setPickingDrive] = useState(false);
  const integrations = useIntegrations();
  const driveReady = canImportAudioFromDrive(googleDriveConnection(integrations.data));
  const modeTabs = useMemo(() => MODE_TABS.filter((tab) => tab.key !== 'drive' || driveReady), [driveReady]);

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
  // 서버 오류(INT-002·003·010~014 …)는 토스트로 알린다. 입력칸 오류는 칸 아래에도 보인다
  const importFromDrive = useAction(meetingMinutesDriveApi.create, {
    success: 'Drive 녹음을 가져왔어요. 글로 바꾸는 중이에요',
    onSuccess: onCreated,
    onError: (error) => setFieldErrors(error instanceof InputError ? error.fieldErrors : {}),
  });
  const pending = create.isPending || upload.isPending || importFromDrive.isPending;
  const isAudio = mode !== 'text';

  const switchMode = (next: InputMode) => {
    setMode(next);
    setAudioFile(null);
    setDriveFile(null);
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
              if (mode === 'drive') {
                if (driveFile && notified) importFromDrive.mutate({ meetingMinutesTitle: title, meetingDate, attendeeIds, driveFileId: driveFile.id });
                return;
              }
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
                <DateInput
                  id={`${formId}-date`}
                  value={meetingDate}
                  onChange={(value) => {
                    setMeetingDate(value);
                    setMeetingDateEdited(true);
                  }}
                  invalid={Boolean(fieldErrors.meetingDate)}
                  className="w-full"
                />
              </Field>
            </div>
            <Field label={`참석자 ${attendeeIds.length}명`} required error={fieldErrors.attendeeIds} hint="조직도의 사용 중인 사원">
              <AttendeePicker selected={attendeeIds} myId={myId} invalid={Boolean(fieldErrors.attendeeIds)} onChange={setAttendeeIds} />
            </Field>
            <Tabs items={modeTabs} active={mode} onChange={switchMode} ariaLabel="기록 입력 방법" />
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
                ) : mode === 'drive' ? (
                  <Field label="Drive 녹음" required htmlFor={`${formId}-drive`} error={fieldErrors.driveFileId} hint="회사 Drive 폴더에 올라온 녹음을 골라요. 파일은 서버가 Drive에서 직접 받아 글로 바꿔요">
                    <div className="flex items-center gap-2.5">
                      <Button id={`${formId}-drive`} icon="upload" onClick={() => setPickingDrive(true)} disabled={!notified || pending}>
                        {driveFile ? '다른 녹음 고르기' : 'Drive에서 고르기'}
                      </Button>
                      {driveFile ? (
                        <span className="min-w-0 truncate text-cap text-ink-2">
                          {driveFile.name} · {driveFileSizeLabel(driveFile.size)}
                        </span>
                      ) : null}
                    </div>
                  </Field>
                ) : (
                  <Field label="음성 파일" required error={fieldErrors.file ?? fileProblem} hint="오디오 파일, 500MB까지 (m4a·mp3·wav·webm·aac·ogg·mp4·flac)">
                    <div className="flex flex-col gap-1.5">
                      <input
                        type="file"
                        accept={MEETING_AUDIO_ACCEPT}
                        disabled={!notified || pending}
                        aria-label="음성 파일"
                        onChange={(event) => {
                          const picked = event.target.files?.[0] ?? null;
                          const problem = picked ? audioFileProblem(picked) : null;
                          setFileProblem(problem);
                          setAudioFile(picked && !problem ? picked : null);
                          const fileDate = picked && !problem ? meetingDateOfAudio(picked.lastModified) : null;
                          if (fileDate && !meetingDateEdited) setMeetingDate(fileDate);
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
            <span className="text-cap text-ink-3">{isAudio ? '올린 뒤 글로 바뀔 때까지 기다리지 않고 상세 화면으로 가요' : '만든 뒤에는 전체 기록을 고칠 수 없어요 · 만든 뒤 상세 화면에서 "AI로 정리"를 눌러요'}</span>
            <Button className="ml-auto" onClick={onCancel} disabled={pending}>
              취소
            </Button>
            <Button variant="primary" type="submit" disabled={pending || (isAudio && (!notified || !(mode === 'drive' ? driveFile : audioFile)))}>
              {isAudio ? (upload.isPending ? '올리는 중…' : importFromDrive.isPending ? '가져오는 중…' : mode === 'drive' ? '가져오기' : '올리기') : create.isPending ? '저장하는 중…' : '회의록 만들기'}
            </Button>
          </CardFoot>
        </form>
      </Card>
      {pickingDrive ? (
        <DriveAudioPicker
          selectedId={driveFile?.id ?? null}
          onPick={(file) => {
            setDriveFile(file);
            const fileDate = meetingDateOfAudio(file.modifiedTime);
            if (fileDate && !meetingDateEdited) setMeetingDate(fileDate);
            setPickingDrive(false);
          }}
          onClose={() => setPickingDrive(false)}
        />
      ) : null}
    </>
  );
}
