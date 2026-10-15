'use client';

// 회의록 AI 분석 카드 (REQ-VOC-003, BP-VOC-01). AI가 정리한 내용은 "AI 정리" 표시로 원본 전사와 구분하고,
// 후보는 모두 검토 대기다: 수정·제외·추가 허가는 다음 단계(등록)에서 연결한다.
import { MEETING_MINUTES_STATUS, type MeetingAnalysis, type MeetingCandidate, type MeetingMinutesView } from '@fantasteel/shared';
import { meetingMinutesApi } from '@/api/meetingMinutes';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { useAction } from '@/hooks/useAction';
import { useMe } from '@/hooks/useMe';
import { fmtDateTime } from '@/lib/format';
import { analyzeAvailability, evidenceLabel, formatSchedule, groupCandidates } from '@/lib/meetingAnalysis';

const NEXT_STEP_HINT = '다음 단계에서 연결';

function AiLabel() {
  return (
    <Badge tone="ai" plain title="AI가 정리한 내용이에요. 원본 전사와 다를 수 있으니 확인해 주세요">
      AI 정리
    </Badge>
  );
}

function EvidenceChips({ evidence, onJump }: { evidence: number[]; onJump: (index: number) => void }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {evidence.map((index) => (
        <button
          key={index}
          type="button"
          onClick={() => onJump(index)}
          title="원본 전사의 이 발언으로 이동"
          className="inline-flex h-5 items-center rounded-xs border border-line-strong bg-surface px-1.5 font-mono text-cap text-ink-2 hover:border-ai hover:bg-ai-bg hover:text-ai-strong"
        >
          {evidenceLabel(index)}
        </button>
      ))}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 text-sm">
      <span className="text-xs text-ink-3">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function fields(c: MeetingCandidate, minutes: MeetingMinutesView): React.ReactNode {
  const nameOf = (id: number) => minutes.attendees.find((a) => a.employeeId === id)?.employeeName ?? `사원 ${id}`;
  if (c.kind === 'TASK') {
    return (
      <>
        <Field label="담당자">{c.assigneeId !== null ? nameOf(c.assigneeId) : <span className="text-ink-3">미정{c.assigneeName ? ` (말한 이름: ${c.assigneeName})` : ''}</span>}</Field>
        <Field label="마감일">{c.dueDate ?? <span className="text-ink-3">미정</span>}</Field>
      </>
    );
  }
  if (c.kind === 'EVENT') {
    return (
      <>
        <Field label="일정 시각">
          {c.startAt ? formatSchedule(c.startAt, c.endAt) : <span className="text-ink-3">미정</span>}
          {c.endAssumed ? <span className="ml-1 text-cap text-ink-3">(끝 시각은 가정)</span> : null}
        </Field>
        <Field label="참석자">{c.attendeeIds.length > 0 ? c.attendeeIds.map(nameOf).join(', ') : <span className="text-ink-3">미정</span>}</Field>
      </>
    );
  }
  return (
    <>
      <Field label="품목">
        {c.purchase?.itemId != null ? (c.itemName ?? '-') : <span className="text-ink-3">미정{c.itemName ? ` (말한 품목: ${c.itemName})` : ''}</span>}
      </Field>
      <Field label="수량">{c.purchase?.requestedTon ? `${c.purchase.requestedTon} 톤` : <span className="text-ink-3">미정</span>}</Field>
      <Field label="희망 입고일">{c.purchase?.desiredReceiptDate ?? <span className="text-ink-3">미정</span>}</Field>
    </>
  );
}

function CandidateCard({ candidate, minutes, onJump }: { candidate: MeetingCandidate; minutes: MeetingMinutesView; onJump: (index: number) => void }) {
  return (
    <li className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="outline">{candidate.kind === 'TASK' ? '할 일' : candidate.kind === 'EVENT' ? '일정' : '구매요청'}</Badge>
        <b className="min-w-0 break-words text-sm">{candidate.title}</b>
        <span className="ml-auto flex items-center gap-1">
          <AiLabel />
          <Badge tone="neutral" plain>검토 대기</Badge>
        </span>
      </div>
      {candidate.description ? <p className="text-sm text-ink-2">{candidate.description}</p> : null}
      <div className="flex flex-col gap-0.5">
        {fields(candidate, minutes)}
        {candidate.relatedSalesOrderNo ? <Field label="관련 수주">{candidate.relatedSalesOrderNo}</Field> : null}
        {candidate.sourceText ? (
          <Field label="말한 표현">
            <q className="text-ink-2">{candidate.sourceText}</q>
          </Field>
        ) : null}
      </div>
      {candidate.issues.length > 0 ? (
        <ul className="flex flex-col gap-0.5 rounded-xs bg-wait-bg px-2 py-1.5 text-xs text-[#7a3d00]">
          {candidate.issues.map((issue) => (
            <li key={issue} className="flex items-start gap-1">
              <span aria-hidden>⚠</span>
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <span className="text-cap text-ink-3">근거 발언</span>
        {candidate.evidence.map((index) => (
          <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-1.5 text-xs text-ink-2">
            <EvidenceChips evidence={[index]} onJump={onJump} />
            <span className="break-words">{minutes.transcriptSegments[index]?.text ?? ''}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" disabled title={NEXT_STEP_HINT}>수정</Button>
        <Button size="sm" disabled title={NEXT_STEP_HINT}>제외</Button>
        <Button size="sm" variant="primary" disabled title={NEXT_STEP_HINT}>추가 허가</Button>
      </div>
    </li>
  );
}

function Result({ analysis, minutes, onJump }: { analysis: MeetingAnalysis; minutes: MeetingMinutesView; onJump: (index: number) => void }) {
  const groups = groupCandidates(analysis.candidates);
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold">요약</h3>
          <AiLabel />
          <span className="text-cap text-ink-3">{fmtDateTime(analysis.analyzedAt)}{analysis.model ? ` · ${analysis.model}` : ''}</span>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{analysis.summary || '요약이 없어요'}</p>
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold">결정사항</h3>
        {analysis.decisions.length === 0 ? (
          <p className="text-sm text-ink-3">정리된 결정사항이 없어요</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {analysis.decisions.map((decision) => (
              <li key={decision.text} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm">
                <span className="min-w-0 break-words">• {decision.text}</span>
                <EvidenceChips evidence={decision.evidence} onJump={onJump} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {groups.length === 0 ? (
        <p className="text-sm text-ink-3">등록할 후보가 없어요</p>
      ) : (
        groups.map((group) => (
          <section key={group.kind} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {group.label} <span className="font-normal text-ink-3">{group.items.length}</span>
            </h3>
            <ul className="flex flex-col gap-2">
              {group.items.map((candidate) => (
                <CandidateCard key={candidate.key} candidate={candidate} minutes={minutes} onJump={onJump} />
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="text-cap text-ink-3">후보는 AI가 제안한 것이고, 아직 아무것도 등록되지 않았어요. 담당자·날짜·품목은 서버가 참석자와 품목 목록에서 확인한 값이에요.</p>
    </div>
  );
}

export function MeetingAnalysisPanel({ minutes, onJump }: { minutes: MeetingMinutesView; onJump: (index: number) => void }) {
  const me = useMe();
  const analyze = useAction(meetingMinutesApi.analyze);
  const availability = analyzeAvailability(minutes, me.employeeId);
  const status = minutes.meetingMinutesStatus;
  const rerun = status === MEETING_MINUTES_STATUS.REVIEW || (status === MEETING_MINUTES_STATUS.FAILED && minutes.analysisResult !== null);
  const retry = status === MEETING_MINUTES_STATUS.FAILED;

  return (
    <Card>
      <CardHead
        title="AI 분석"
        meta="요약·결정사항·등록 후보"
        actions={
          availability.ok ? (
            <Button size="sm" variant="ai" icon={rerun || retry ? 'refresh' : undefined} disabled={analyze.isPending} onClick={() => analyze.mutate(minutes.id)}>
              {rerun || retry ? '다시 정리' : 'AI로 정리'}
            </Button>
          ) : null
        }
      />
      <CardBody>
        {status === MEETING_MINUTES_STATUS.ANALYZING ? (
          <div role="status" className="flex items-center gap-2 text-sm text-run">
            <span className="size-3.5 animate-spin rounded-full border-2 border-run border-t-transparent" aria-hidden />
            AI가 정리하는 중…
          </div>
        ) : status === MEETING_MINUTES_STATUS.REVIEW && minutes.analysisResult ? (
          <Result analysis={minutes.analysisResult} minutes={minutes} onJump={onJump} />
        ) : (
          <>
            {status === MEETING_MINUTES_STATUS.TRANSCRIBING ? (
              <p className="text-sm text-ink-2">전사가 끝나면 AI로 정리할 수 있어요.</p>
            ) : availability.ok ? (
              <p className="text-sm text-ink-2">원본 전사를 읽고 요약·결정사항·할 일·일정·구매요청 후보를 만들어요. 등록은 확인한 뒤에만 해요.</p>
            ) : availability.reason ? (
              <p className="flex items-center gap-1 text-sm text-danger">
                <Icon name="alert" size="sm" />
                {availability.reason}
              </p>
            ) : (
              <p className="text-sm text-ink-2">회의록을 만든 사람({minutes.creator.name})이 AI로 정리할 수 있어요.</p>
            )}
            <p className="text-cap text-ink-3">원본 전사는 AI가 고치지 않아요. AI가 만든 내용은 &quot;AI 정리&quot; 표시가 붙어요.</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
