'use client';

// 회의록 상세: 정보, 원본 전사(번호 붙은 발언), AI 분석 자리. 원본 전사와 AI 요약은 따로 둔다 (BP-VOC-01).
import { MEETING_MINUTES_STATUS, MEETING_MINUTES_STATUS_LABEL } from '@fantasteel/shared';
import { ROLE_LABEL } from '@/codes';
import type { MeetingMinutesView } from '@/api/meetingMinutes';
import { Avatar } from '@/components/Avatar';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { KvList } from '@/components/KvList';
import { PageHead } from '@/components/Page';
import { EmptyNote, StateView } from '@/components/StateView';
import { MeetingStatusBadge } from '@/features/meetings/components/MeetingStatusBadge';
import { useMeetingMinutes } from '@/hooks/useMeetingMinutes';
import { fmtDateTime } from '@/lib/format';
import { fmtClock } from '@/lib/meetingAudio';

function Body({ minutes }: { minutes: MeetingMinutesView }) {
  return (
    <>
      <PageHead crumb={<>회의록<Icon name="chevron-right" size="sm" />{minutes.meetingDate}</>} title={minutes.meetingMinutesTitle} actions={<MeetingStatusBadge status={minutes.meetingMinutesStatus} />} />
      {minutes.meetingMinutesStatus === MEETING_MINUTES_STATUS.TRANSCRIBING ? (
        <Banner tone="run" icon="clock">
          <b>음성을 글로 바꾸는 중…</b> 길이에 따라 몇 분 걸릴 수 있어요. 이 화면은 끝나면 저절로 바뀌어요.
        </Banner>
      ) : null}
      {minutes.meetingMinutesStatus === MEETING_MINUTES_STATUS.ANALYZING ? (
        <Banner tone="run" icon="clock">
          <b>AI가 내용을 정리하는 중…</b> 끝나면 저절로 바뀌어요.
        </Banner>
      ) : null}
      {minutes.meetingMinutesStatus === MEETING_MINUTES_STATUS.FAILED ? (
        <Banner tone="danger">
          <b>{minutes.failureReason ?? '전사하지 못했어요'}</b>
          <div className="mt-0.5 text-cap">음성을 다시 올려서 새 회의록으로 만들어 주세요. 원본 음성은 저장하지 않아 이 회의록에서 다시 돌릴 수 없어요.</div>
        </Banner>
      ) : minutes.failureReason ? (
        <Banner tone="danger">{minutes.failureReason}</Banner>
      ) : null}
      <Card className="flex-none">
        <CardBody className="gap-3">
          <KvList
            columns={3}
            items={[
              { label: '회의일', value: minutes.meetingDate },
              { label: '상태', value: MEETING_MINUTES_STATUS_LABEL[minutes.meetingMinutesStatus] },
              { label: '작성', value: `${minutes.creator.name} · ${fmtDateTime(minutes.createdAt)}` },
            ]}
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-3">참석자 {minutes.attendees.length}명</span>
            <div className="flex flex-wrap gap-1">
              {minutes.attendees.map((attendee) => (
                <span key={attendee.employeeId} className="inline-flex h-6 items-center gap-1 rounded-xl border border-line-strong bg-surface pr-2 pl-0.5 text-xs">
                  <Avatar name={attendee.employeeName} size="sm" />
                  {attendee.employeeName}
                  <span className="text-cap text-ink-3">{attendee.departmentName} · {ROLE_LABEL[attendee.roleCode]}</span>
                </span>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>
      <div className="grid min-h-0 flex-none grid-cols-1 gap-3.5 xl:grid-cols-2">
        <Card>
          <CardHead
            title={
              <span className="flex items-center gap-1.5">
                <Icon name="mic" />
                원본 전사
              </span>
            }
            meta={`발언 ${minutes.transcriptSegments.length} · 사람이 말한 그대로`}
          />
          {minutes.transcriptSegments.length === 0 ? (
            <EmptyNote>{minutes.meetingMinutesStatus === MEETING_MINUTES_STATUS.TRANSCRIBING ? '글로 바꾸는 중이에요' : '전사된 발언이 없어요'}</EmptyNote>
          ) : (
            <ol className="flex flex-col py-1.5">
              {minutes.transcriptSegments.map((segment, index) => (
                <li key={index} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-2 px-3.5 py-1.5 text-sm leading-snug">
                  <span className="text-right font-mono text-cap text-ink-3">{index + 1}</span>
                  <span className="break-words whitespace-pre-wrap">
                    {segment.start !== null ? <span className="mr-1.5 font-mono text-cap text-ink-3 tabular-nums">[{fmtClock(segment.start)}]</span> : null}
                    {segment.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card>
          <CardHead title="AI 분석" meta="요약·결정사항·할 일" />
          <CardBody>
            <p className="text-sm text-ink-2">AI 분석 — 다음 단계에서 연결해요.</p>
            <p className="text-cap text-ink-3">연결되면 원본 전사를 바탕으로 요약·결정사항·할 일 초안을 만들고, 확인한 뒤에만 등록해요. 원본 전사는 AI가 고치지 않아요.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

export function MeetingDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const query = useMeetingMinutes(id);
  if (query.data) return <Body minutes={query.data} />;
  if (query.error) {
    return (
      <StateView
        kind="empty"
        title="회의록을 열 수 없어요"
        text={query.error instanceof Error ? query.error.message : undefined}
        actions={
          <Button size="sm" onClick={onBack}>
            목록으로
          </Button>
        }
      />
    );
  }
  return <StateView kind="loading" title="회의록을 불러오는 중…" />;
}
