'use client';

// 회의록 AI 분석 카드 (REQ-VOC-003·004, BP-VOC-01). AI가 정리한 내용은 "AI 정리" 표시로 원본 전사와 구분한다.
// 작성자만 후보마다 고치고 허가·제외하며, 남은 후보가 없을 때 "확정하고 등록"으로 업무·일정·구매요청 초안을 만든다. AI는 스스로 등록하지 않는다.
import { ITEM_TYPE, MEETING_MINUTES_STATUS, type MeetingAnalysis, type MeetingCandidate, type MeetingCandidateDecision, type MeetingCandidateUpdateInput, type MeetingMinutesView } from '@fantasteel/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { meetingMinutesApi } from '@/api/meetingMinutes';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { Textarea } from '@/components/Input';
import { groupsOfChart } from '@/features/meetings/components/AttendeePicker';
import { CandidateEditor } from '@/features/meetings/components/MeetingCandidateEditor';
import { useAction } from '@/hooks/useAction';
import { useAdminOrgChart } from '@/hooks/useAdminOrganization';
import { useItemList } from '@/hooks/useLookups';
import { useMe } from '@/hooks/useMe';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';
import { analyzeAvailability, approvalBlocker, decisionCounts, evidenceLabel, formatSchedule, groupCandidates, registerPreview } from '@/lib/meetingAnalysis';

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

interface Names {
  employee: (id: number) => string;
  item: (id: number) => string | null;
}

/** 담당자·참석자는 회의 참석자가 아니어도 되므로 조직도의 전체 사원에서, 품목은 원료 목록에서 이름을 찾는다 */
function useNames(minutes: MeetingMinutesView): Names {
  const chart = useAdminOrgChart();
  const rawMaterials = useItemList({ itemType: ITEM_TYPE.RAW_MATERIAL });
  return useMemo(() => {
    const employees = new Map<number, string>(minutes.attendees.map((a) => [a.employeeId, a.employeeName]));
    for (const group of groupsOfChart(chart.data ?? [])) for (const member of group.members) employees.set(member.id, member.employeeName);
    const items = new Map((rawMaterials.data ?? []).map((item) => [item.id, item.itemName]));
    return { employee: (id) => employees.get(id) ?? `사원 ${id}`, item: (id) => items.get(id) ?? null };
  }, [minutes.attendees, chart.data, rawMaterials.data]);
}

function fields(c: MeetingCandidate, names: Names): React.ReactNode {
  if (c.kind === 'TASK') {
    return (
      <>
        <Field label="담당자">{c.assigneeId !== null ? names.employee(c.assigneeId) : <span className="text-ink-3">미정{c.assigneeName ? ` (말한 이름: ${c.assigneeName})` : ''}</span>}</Field>
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
        <Field label="참석자">{c.attendeeIds.length > 0 ? c.attendeeIds.map(names.employee).join(', ') : <span className="text-ink-3">미정</span>}</Field>
      </>
    );
  }
  const itemId = c.purchase?.itemId ?? null;
  return (
    <>
      <Field label="품목">{itemId !== null ? (names.item(itemId) ?? c.itemName ?? `품목 ${itemId}`) : <span className="text-ink-3">미정{c.itemName ? ` (말한 품목: ${c.itemName})` : ''}</span>}</Field>
      <Field label="수량">{c.purchase?.requestedTon ? `${c.purchase.requestedTon} 톤` : <span className="text-ink-3">미정</span>}</Field>
      <Field label="희망 입고일">{c.purchase?.desiredReceiptDate ?? <span className="text-ink-3">미정</span>}</Field>
    </>
  );
}

/** 확정 때 만들어진 결과로 가는 링크. 일정은 아직 화면이 없어 시각을 글로 보인다 */
function RegisteredNote({ candidate }: { candidate: MeetingCandidate }) {
  const registered = candidate.registered;
  if (!registered) return null;
  const link = 'font-medium text-brand hover:underline';
  return (
    <div className="flex items-center gap-1 rounded-xs bg-ok-bg px-2 py-1.5 text-xs text-ok-strong">
      <Icon name="check" size="sm" />
      {registered.type === 'task' ? (
        <>
          업무로 등록됐어요 <Link href="/tasks" className={link}>업무 보기</Link>
        </>
      ) : registered.type === 'action_draft' ? (
        <>
          구매요청 초안이 만들어졌어요 <Link href={`/action-drafts/${registered.id}`} className={link}>초안 #{registered.id} 열기</Link>
        </>
      ) : (
        <>일정으로 등록됐어요 · {formatSchedule(candidate.startAt, candidate.endAt)}</>
      )}
    </div>
  );
}

const KIND_BADGE = { TASK: '할 일', EVENT: '일정', PURCHASE: '구매요청' } as const;

function DecisionBadge({ decision, confirmed }: { decision: MeetingCandidateDecision; confirmed: boolean }) {
  if (decision === 'APPROVED') return <Badge tone="ok">{confirmed ? '등록됨' : '허가'}</Badge>;
  if (decision === 'EXCLUDED') return <Badge tone="neutral" plain>제외</Badge>;
  return <Badge tone="neutral" plain>검토 대기</Badge>;
}

interface CardProps {
  candidate: MeetingCandidate;
  minutes: MeetingMinutesView;
  names: Names;
  editable: boolean;
  editing: boolean;
  pending: boolean;
  myId: number;
  onJump: (index: number) => void;
  onEdit: (key: string | null) => void;
  onDecide: (key: string, decision: MeetingCandidateDecision) => void;
  onSave: (key: string, input: MeetingCandidateUpdateInput) => void;
}

function CandidateCard({ candidate, minutes, names, editable, editing, pending, myId, onJump, onEdit, onDecide, onSave }: CardProps) {
  const confirmed = minutes.meetingMinutesStatus === MEETING_MINUTES_STATUS.CONFIRMED;
  const excluded = candidate.decision === 'EXCLUDED';
  const blocker = approvalBlocker(candidate);
  return (
    <li className={cn('flex flex-col gap-2 rounded-sm border bg-surface-2 p-3', candidate.decision === 'APPROVED' ? 'border-ok' : 'border-line', excluded && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="outline">{KIND_BADGE[candidate.kind]}</Badge>
        <b className={cn('min-w-0 break-words text-sm', excluded && 'line-through')}>{candidate.title}</b>
        <span className="ml-auto flex items-center gap-1">
          <AiLabel />
          <DecisionBadge decision={candidate.decision} confirmed={confirmed} />
        </span>
      </div>
      {editing ? (
        <CandidateEditor candidate={candidate} myId={myId} pending={pending} onCancel={() => onEdit(null)} onSave={(input) => onSave(candidate.key, input)} />
      ) : (
        <>
          {candidate.description ? <p className="text-sm text-ink-2">{candidate.description}</p> : null}
          <div className="flex flex-col gap-0.5">
            {fields(candidate, names)}
            {candidate.relatedSalesOrderNo ? <Field label="관련 수주">{candidate.relatedSalesOrderNo}</Field> : null}
            {candidate.sourceText ? (
              <Field label="말한 표현">
                <q className="text-ink-2">{candidate.sourceText}</q>
              </Field>
            ) : null}
          </div>
        </>
      )}
      {candidate.issues.length > 0 && !excluded && !confirmed ? (
        <ul className="flex flex-col gap-0.5 rounded-xs bg-wait-bg px-2 py-1.5 text-xs text-[#7a3d00]">
          {candidate.issues.map((issue) => (
            <li key={issue} className="flex items-start gap-1">
              <span aria-hidden>⚠</span>
              <span>{issue}</span>
            </li>
          ))}
          {candidate.decision === 'APPROVED' ? <li className="text-cap">허가하면 위 내용을 확인했다는 뜻이에요</li> : null}
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
      {confirmed ? <RegisteredNote candidate={candidate} /> : null}
      {editable && !editing ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {excluded ? (
            <Button size="sm" disabled={pending} onClick={() => onDecide(candidate.key, 'PENDING')}>
              다시 살리기
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={pending} onClick={() => onEdit(candidate.key)}>
                수정
              </Button>
              <Button size="sm" disabled={pending} onClick={() => onDecide(candidate.key, 'EXCLUDED')}>
                제외
              </Button>
              {candidate.decision === 'APPROVED' ? (
                <Button size="sm" disabled={pending} onClick={() => onDecide(candidate.key, 'PENDING')}>
                  허가 취소
                </Button>
              ) : (
                <Button size="sm" variant="primary" disabled={pending || blocker !== null} title={blocker ?? '이 후보를 등록하도록 허가해요'} onClick={() => onDecide(candidate.key, 'APPROVED')}>
                  추가 허가
                </Button>
              )}
            </>
          )}
        </div>
      ) : null}
      {editable && !editing && !excluded && candidate.decision !== 'APPROVED' && blocker ? <p className="text-right text-cap text-ink-3">{blocker}. 수정에서 채워 주세요</p> : null}
    </li>
  );
}

function SummaryBlock({ analysis, minutes, editable }: { analysis: MeetingAnalysis; minutes: MeetingMinutesView; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const save = useAction((summary: string) => meetingMinutesApi.updateSummary(minutes.id, summary), { onSuccess: () => setEditing(false) });
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">요약</h3>
        <AiLabel />
        <span className="text-cap text-ink-3">
          {fmtDateTime(analysis.analyzedAt)}
          {analysis.model ? ` · ${analysis.model}` : ''}
        </span>
        {editable && !editing ? (
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              setText(analysis.summary);
              setEditing(true);
            }}
          >
            요약 수정
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <Textarea aria-label="요약" rows={5} value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" disabled={save.isPending} onClick={() => setEditing(false)}>
              취소
            </Button>
            <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate(text.trim())}>
              {save.isPending ? '저장하는 중…' : '저장'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{analysis.summary || '요약이 없어요'}</p>
      )}
    </section>
  );
}

/** 맨 아래 막대: 허가·제외·남음 수와 "확정하고 등록". 남은 후보가 없을 때만 누를 수 있다 */
function RegisterBar({ minutes, analysis }: { minutes: MeetingMinutesView; analysis: MeetingAnalysis }) {
  const [open, setOpen] = useState(false);
  const counts = decisionCounts(analysis.candidates);
  const preview = registerPreview(analysis.candidates);
  const register = useAction(meetingMinutesApi.register, {
    success: (r) => `확정했어요 · 업무 ${r.taskIds.length}건, 일정 ${r.scheduleEventIds.length}건, 구매요청 초안 ${r.actionDraftIds.length}건`,
    onSuccess: () => setOpen(false),
    onError: () => setOpen(false),
  });
  return (
    <div className="sticky bottom-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border border-line-strong bg-surface p-2.5">
      <span className="text-sm">
        허가 <b>{counts.approved}</b> · 제외 <b>{counts.excluded}</b> · 남음 <b className={counts.pending > 0 ? 'text-danger' : undefined}>{counts.pending}</b>
      </span>
      {counts.pending > 0 ? <span className="text-cap text-ink-3">남은 후보를 허가하거나 제외하면 확정할 수 있어요</span> : null}
      <Button variant="primary" className="ml-auto" disabled={counts.pending > 0 || register.isPending} onClick={() => setOpen(true)}>
        확정하고 등록
      </Button>
      {open ? (
        <ConfirmDialog title="확정하고 등록할까요?" confirmLabel="확정하고 등록" pending={register.isPending} onConfirm={() => register.mutate(minutes.id)} onCancel={() => setOpen(false)}>
          {preview.length === 0 ? (
            <p>허가한 후보가 없어요. 회의록만 확정되고 등록되는 항목은 없어요.</p>
          ) : (
            <ul className="mb-2 flex flex-col gap-1">
              {preview.map((line) => (
                <li key={line.label}>
                  <b>{line.label}</b>
                  <span className="text-ink-3"> · {line.titles.join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
          <p>제외한 후보 {counts.excluded}건은 등록하지 않아요. 참석자에게는 회의록 공유 알림이 가요.</p>
          <p className="mt-1 text-ink-3">구매요청은 바로 만들어지지 않고, 초안으로 만들어져 요청자가 한 번 더 확정해요. 확정한 뒤에는 고치거나 다시 정리할 수 없어요.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function Result({ analysis, minutes, onJump }: { analysis: MeetingAnalysis; minutes: MeetingMinutesView; onJump: (index: number) => void }) {
  const me = useMe();
  const names = useNames(minutes);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const update = useAction((v: { key: string; input: MeetingCandidateUpdateInput }) => meetingMinutesApi.updateCandidate(minutes.id, v.key, v.input), { onSuccess: () => setEditingKey(null) });
  const confirmed = minutes.meetingMinutesStatus === MEETING_MINUTES_STATUS.CONFIRMED;
  const editable = !confirmed && minutes.meetingMinutesStatus === MEETING_MINUTES_STATUS.REVIEW && minutes.creator.id === me.employeeId;
  const groups = groupCandidates(analysis.candidates);
  return (
    <div className="flex flex-col gap-4">
      {confirmed ? (
        <div className="flex items-center gap-1.5 rounded-xs bg-ok-bg px-2.5 py-2 text-sm text-ok-strong">
          <Icon name="check" size="sm" />
          <b>확정됨</b> · {minutes.confirmedAt ? fmtDateTime(minutes.confirmedAt) : ''}
          <span className="text-cap">확정한 뒤에는 고치거나 다시 정리할 수 없어요</span>
        </div>
      ) : null}
      <SummaryBlock analysis={analysis} minutes={minutes} editable={editable} />
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
                <CandidateCard
                  key={candidate.key}
                  candidate={candidate}
                  minutes={minutes}
                  names={names}
                  editable={editable}
                  editing={editingKey === candidate.key}
                  pending={update.isPending}
                  myId={me.employeeId}
                  onJump={onJump}
                  onEdit={setEditingKey}
                  onDecide={(key, decision) => update.mutate({ key, input: { decision } })}
                  onSave={(key, input) => update.mutate({ key, input })}
                />
              ))}
            </ul>
          </section>
        ))
      )}
      {editable ? <RegisterBar minutes={minutes} analysis={analysis} /> : null}
      <p className="text-cap text-ink-3">
        {confirmed
          ? '허가한 후보는 등록됐고, 제외한 후보는 등록하지 않았어요.'
          : editable
            ? '후보는 AI가 제안한 것이고, 허가한 것만 등록돼요. 담당자·날짜·품목은 서버가 확인한 값이고, 고치면 서버가 다시 확인해요.'
            : `후보는 AI가 제안한 것이에요. 회의록을 만든 사람(${minutes.creator.name})이 허가해야 등록돼요.`}
      </p>
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
  const showResult = (status === MEETING_MINUTES_STATUS.REVIEW || status === MEETING_MINUTES_STATUS.CONFIRMED) && minutes.analysisResult !== null;

  return (
    <Card>
      <CardHead
        title="AI 분석"
        meta="요약·결정사항·등록 후보"
        actions={
          availability.ok ? (
            <Button
              size="sm"
              variant="ai"
              icon={rerun || retry ? 'refresh' : undefined}
              disabled={analyze.isPending}
              title={status === MEETING_MINUTES_STATUS.REVIEW ? '다시 정리하면 지금까지 고친 내용과 허가·제외가 사라져요' : undefined}
              onClick={() => analyze.mutate(minutes.id)}
            >
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
        ) : showResult && minutes.analysisResult ? (
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
            {availability.ok && minutes.speakers.length > 0 ? <p className="text-cap text-ai-strong">화자를 연결하면 AI가 누가 말했는지 알고 정리해요</p> : null}
            <p className="text-cap text-ink-3">원본 전사는 AI가 고치지 않아요. AI가 만든 내용은 &quot;AI 정리&quot; 표시가 붙어요.</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
