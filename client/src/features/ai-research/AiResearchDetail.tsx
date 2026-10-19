'use client';

// 심층 조사 상세: 상태마다 다른 모습 (계획 중 · 계획 확인 · 진행 · 완료 · 실패/취소).
import { AI_RESEARCH_STATUS_LABEL, type AiResearchRunView } from '@fantasteel/shared';
import { aiResearchApi } from '@/api/aiResearch';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { PageHead } from '@/components/Page';
import { Progress } from '@/components/Progress';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Timeline } from '@/components/Timeline';
import { AiResearchPlanEditor } from '@/features/ai-research/AiResearchPlanEditor';
import { AiResearchReport } from '@/features/ai-research/AiResearchReport';
import { AiResearchStatusBadge } from '@/features/ai-research/AiResearchStatusBadge';
import { useAction } from '@/hooks/useAction';
import { useAiResearchRun } from '@/hooks/useAiResearch';
import { canCancelRun, progressText, timelineLines } from '@/lib/aiResearch';
import { fmtDateTime, fmtHM } from '@/lib/format';

function RunTimeline({ run }: { run: AiResearchRunView }) {
  const lines = timelineLines(run.events);
  if (lines.length === 0) return <p className="text-sm text-ink-3">아직 기록이 없어요</p>;
  return (
    <Timeline
      items={lines.map((line) => ({
        key: line.key,
        tone: line.tone,
        title: <span className="break-words">{line.title}</span>,
        time: fmtHM(line.at),
        body: line.detail ? <span className="text-cap whitespace-pre-line break-words text-ink-2">{line.detail}</span> : undefined,
      }))}
    />
  );
}

function Gaps({ run }: { run: AiResearchRunView }) {
  const gaps = run.researchState?.gaps ?? [];
  if (gaps.length === 0) return null;
  return (
    <div>
      <b className="text-cap font-semibold text-ink-2">아직 모르는 것</b>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm">
        {gaps.map((gap, index) => (
          <li key={index}>{gap}</li>
        ))}
      </ul>
    </div>
  );
}

function ProgressCard({ run }: { run: AiResearchRunView }) {
  const percent = run.budget.maxSteps > 0 ? (run.stepsUsed / run.budget.maxSteps) * 100 : 0;
  return (
    <Card className="flex-none">
      <CardHead title={run.status === 'QUEUED' ? '차례를 기다리는 중' : '조사 중'} meta={progressText(run)} />
      <CardBody className="gap-3">
        <Progress value={percent} label={progressText(run)} showLabel={false} />
        {run.researchState?.summary ? (
          <div>
            <b className="text-cap font-semibold text-ink-2">지금까지 알아낸 것</b>
            <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{run.researchState.summary}</p>
          </div>
        ) : null}
        <Gaps run={run} />
        <RunTimeline run={run} />
      </CardBody>
    </Card>
  );
}

function Body({ run }: { run: AiResearchRunView }) {
  const cancel = useAction(() => aiResearchApi.cancel(run.id), { success: '조사를 취소했어요' });
  const extend = useAction(() => aiResearchApi.extend(run.id), { success: '더 조사를 시작했어요' });
  const gaps = run.researchState?.gaps ?? [];
  const incomplete = run.reportTruncated || (run.stepsUsed >= run.budget.maxSteps && gaps.length > 0);

  return (
    <>
      <PageHead
        crumb={<>심층 조사<Icon name="chevron-right" size="sm" />{fmtDateTime(run.createdAt)}</>}
        title={run.title ?? run.question}
        actions={
          <>
            <AiResearchStatusBadge status={run.status} />
            {canCancelRun(run.status) ? (
              <Button size="sm" variant="danger-outline" icon="x-circle" disabled={cancel.isPending} onClick={() => cancel.mutate(undefined)}>
                취소
              </Button>
            ) : null}
          </>
        }
      />
      <Card className="flex-none">
        <CardBody>
          <b className="text-cap font-semibold text-ink-2">질문</b>
          <p className="text-sm leading-relaxed whitespace-pre-line">{run.question}</p>
        </CardBody>
      </Card>

      {run.status === 'PLANNING' ? (
        <Banner tone="run" icon="clock">
          <b>계획 세우는 중…</b> 끝나면 저절로 바뀌어요.
        </Banner>
      ) : null}

      {run.status === 'AWAITING_APPROVAL' ? <AiResearchPlanEditor key={`${run.id}:${run.planRevision}`} run={run} /> : null}

      {run.status === 'QUEUED' || run.status === 'RUNNING' ? <ProgressCard run={run} /> : null}

      {run.status === 'COMPLETED' ? (
        <>
          {incomplete ? (
            <Banner
              tone="wait"
              actions={
                run.canExtend ? (
                  <Button size="sm" icon="plus" disabled={extend.isPending} onClick={() => extend.mutate(undefined)}>
                    더 조사(+4단계)
                  </Button>
                ) : undefined
              }
            >
              <b>{run.reportTruncated ? '보고서가 길이 한도에 걸려 끝까지 쓰지 못했어요' : '정해 둔 단계를 다 써서 아직 다 알아내지 못했어요'}</b>
              <div className="mt-0.5 text-cap">{progressText(run)}</div>
              {gaps.length ? (
                <ul className="mt-1 flex list-disc flex-col pl-5 text-cap">
                  {gaps.map((gap, index) => (
                    <li key={index}>{gap}</li>
                  ))}
                </ul>
              ) : null}
            </Banner>
          ) : null}
          {!incomplete && run.canExtend ? (
            <div>
              <Button size="sm" icon="plus" disabled={extend.isPending} onClick={() => extend.mutate(undefined)}>
                더 조사(+4단계)
              </Button>
            </div>
          ) : null}
          <AiResearchReport run={run} />
        </>
      ) : null}

      {run.status === 'FAILED' || run.status === 'CANCELLED' ? (
        <Banner tone={run.status === 'FAILED' ? 'danger' : 'neutral'}>
          <b>{run.status === 'FAILED' ? (run.failureReason ?? '조사에 실패했어요') : '조사를 취소했어요'}</b>
          <div className="mt-0.5 text-cap">
            {AI_RESEARCH_STATUS_LABEL[run.status]} · {progressText(run)}
          </div>
        </Banner>
      ) : null}

      {run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED' ? (
        <Card className="flex-none">
          <CardBody>
            <details open={run.status !== 'COMPLETED'}>
              <summary className="cursor-pointer text-sm font-semibold">조사 과정 ({run.events.length})</summary>
              <div className="mt-3">
                <RunTimeline run={run} />
              </div>
            </details>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}

export function AiResearchDetail({ id }: { id: number }) {
  const query = useAiResearchRun(id);
  return (
    <QueryBoundary query={query} loadingLabel="조사를 불러오는 중…">
      {(run) => <Body run={run} />}
    </QueryBoundary>
  );
}
