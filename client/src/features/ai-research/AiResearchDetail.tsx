'use client';

// 심층 조사 상세: 상태마다 다른 모습 (계획 중 · 계획 확인 · 진행 · 완료 · 실패/취소).
// 계획을 세운 뒤에는 제목을 언제든 바꾸고, 끝난 조사는 [다시 조사]로 질문·계획을 복사한 새 조사를 만들어 고친 뒤 시작한다.
// 완료한 보고서는 말로 고쳐 판(1판·2판…)으로 남기고, 판을 골라 앞 판을 다시 본다 (이슈 #418).
import { AI_RESEARCH_LIMITS, AI_RESEARCH_STATUS_LABEL, type AiResearchRunView, type AiResearchSeed } from '@fantasteel/shared';
import { useState } from 'react';
import { useShellStore } from '@/stores/useShellStore';
import { useIntegrations } from '@/hooks/useIntegrations';
import { isNotionExportReady, notionConnection, safeExternalUrl } from '@/lib/integrations';
import { aiResearchApi } from '@/api/aiResearch';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { PageHead } from '@/components/Page';
import { Progress } from '@/components/Progress';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Timeline } from '@/components/Timeline';
import { AiResearchPlanEditor } from '@/features/ai-research/AiResearchPlanEditor';
import { AiResearchReport } from '@/features/ai-research/AiResearchReport';
import { AiResearchStatusBadge } from '@/features/ai-research/AiResearchStatusBadge';
import { AiResearchCharts } from '@/features/ai-research/AiResearchCharts';
import { AiResearchRevisions, AiResearchVersionPicker } from '@/features/ai-research/AiResearchRevisions';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { errorCodeOf } from '@/api/http';
import { useAction } from '@/hooks/useAction';
import { useAiResearchRun, useAiResearchVersion } from '@/hooks/useAiResearch';
import { canCancelRun, canRenameRun, canRerunRun, planTitleProblem, progressText, timelineLines, versionLabel } from '@/lib/aiResearch';
import { openableWebSources } from '@/lib/aiWebLinks';
import { AiAnswerText } from '@/features/shell/AiWebAnswer';
import { toast } from '@/stores/useToastStore';
import { fmtDateTime, fmtHM } from '@/lib/format';

/** 철강맨AI에서 넘긴 간단 답과 출처 (이슈 #408). 웹 내용을 보고 쓴 글이라 HTML로 바꾸지 않고, 주소는 http(s)만 연다 */
function SeedDetails({ seed }: { seed: AiResearchSeed }) {
  const sources = openableWebSources(seed.sources);
  return (
    <details className="mt-2 rounded-xs border border-line bg-surface-2 px-3 py-2">
      <summary className="cursor-pointer text-cap font-semibold text-ink-2">철강맨AI에서 먼저 알아본 것 · 출처 {seed.sources.length}개</summary>
      <p className="mt-2 text-cap text-ink-3">웹 검색으로 간단히 답한 내용이에요. 계획은 이것을 참고해 모자란 부분을 중심으로 세웠어요.</p>
      {/* 채팅 답과 같이 출처에 있는 주소의 마크다운 링크만 링크로 보인다 */}
      {seed.answer ? <AiAnswerText content={seed.answer} webSources={seed.sources} className="mt-1.5 text-sm leading-relaxed break-keep whitespace-pre-line wrap-anywhere text-ink-2" /> : null}
      {sources.length ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-cap">
          {sources.map((source) => (
            <li key={source.href} className="truncate">
              <a href={source.href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                {source.title}
              </a>
              <span className="text-ink-3"> · {source.host}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

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

/** 완료된 조사의 Notion 내보내기 (회의록과 같이: 연결·상위 페이지가 준비됐을 때만 버튼, 내보냈으면 링크) */
function ResearchNotionExport({ run }: { run: AiResearchRunView }) {
  const integrations = useIntegrations();
  const exportToNotion = useAction(() => aiResearchApi.exportToNotion(run.id), { success: 'Notion으로 내보냈어요' });
  const link = safeExternalUrl(run.notionPageUrl);
  if (link) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink no-underline hover:border-[#a9b3be] hover:bg-surface-2"
      >
        <Icon name="share" size="sm" />
        Notion에서 보기
      </a>
    );
  }
  if (!isNotionExportReady(notionConnection(integrations.data))) return null;
  return (
    <Button size="sm" icon="share" onClick={() => exportToNotion.mutate(undefined)} disabled={exportToNotion.isPending} aria-busy={exportToNotion.isPending}>
      {exportToNotion.isPending ? 'Notion으로 보내는 중…' : 'Notion으로 내보내기'}
    </Button>
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

/**
 * 보고서와 판 (이슈 #418): 판이 있으면 판 고르기를 두고, 최신 판이 아닌 판을 고르면 그 판의 보고서·차트를 읽어 보인다.
 * 고치는 중(대기·조사 중)에도 지금 보고서와 고치기 기록을 보인다.
 */
const VERSION_PICKER_ID = 'research-version-picker';

function ReportWithVersions({ run }: { run: AiResearchRunView }) {
  const [picked, setPicked] = useState<number | null>(null);
  const latest = run.versions.at(-1)?.version ?? null;
  const older = picked !== null && picked !== latest ? picked : null;
  const version = useAiResearchVersion(run.id, older);
  const shown = older !== null ? run.versions.find((v) => v.version === older) : undefined;
  const select = (next: number) => {
    setPicked(next);
    document.getElementById(VERSION_PICKER_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <>
      <div id={VERSION_PICKER_ID} className="scroll-mt-4">
        <AiResearchVersionPicker run={run} selected={older ?? latest ?? 0} onSelect={select} />
      </div>
      {shown ? (
        <Banner tone="neutral" actions={<Button size="sm" onClick={() => setPicked(null)}>최신 판 보기</Button>}>
          <b>앞 판을 보고 있어요 · {versionLabel(shown)}</b>
          {shown.instruction ? <div className="mt-0.5 text-cap whitespace-pre-line break-words">부탁: {shown.instruction}</div> : null}
        </Banner>
      ) : null}
      {older !== null ? (
        version.data ? (
          <>
            <AiResearchReport run={run} report={version.data.report} title={`보고서 · ${version.data.version}판`} />
            <AiResearchCharts run={run} charts={version.data.charts} />
          </>
        ) : version.isError ? (
          <Banner tone="danger">판을 불러오지 못했어요. 다시 골라 주세요</Banner>
        ) : (
          <p className="text-sm text-ink-3">판을 불러오는 중…</p>
        )
      ) : (
        <>
          <AiResearchReport run={run} title={latest ? `보고서 · ${latest}판` : '보고서'} />
          <AiResearchCharts run={run} />
        </>
      )}
      <AiResearchRevisions run={run} onSelect={select} />
    </>
  );
}

/** 제목 바꾸기 창: 제목만 바꾸고 단계·검색어·보고서는 그대로 둔다 */
function RenameModal({ run, onClose }: { run: AiResearchRunView; onClose: () => void }) {
  const [title, setTitle] = useState(run.title ?? '');
  const problem = planTitleProblem(title);
  const unchanged = title.trim() === (run.title ?? '').trim();
  const rename = useAction(() => aiResearchApi.rename(run.id, run.planRevision, title), {
    success: '제목을 바꿨어요',
    onSuccess: onClose,
    toastOnError: false,
    onError: (error) => (errorCodeOf(error) === 'RES-003' ? toast.error('다른 곳에서 계획이 바뀌었어요. 최신 제목을 불러왔으니 다시 바꿔 주세요') : toast.apiError(error)),
  });
  const submit = () => {
    if (!problem && !unchanged && !rename.isPending) rename.mutate(undefined);
  };
  return (
    <Modal
      title="제목 바꾸기"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={problem !== null || unchanged || rename.isPending} onClick={submit}>
            {rename.isPending ? '바꾸는 중…' : '바꾸기'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="제목" htmlFor="research-rename-title" error={problem}>
          <Input id="research-rename-title" value={title} maxLength={AI_RESEARCH_LIMITS.planTitleMax} invalid={!!problem} autoFocus onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <p className="text-cap text-ink-3">제목만 바뀌어요. 단계·검색어·보고서는 그대로예요{run.notionPageUrl ? ' (이미 내보낸 Notion 페이지 제목은 그대로예요)' : ''}.</p>
      </form>
    </Modal>
  );
}

function Body({ run }: { run: AiResearchRunView }) {
  const { set } = useUrlParams();
  const [renaming, setRenaming] = useState(false);
  const cancel = useAction(() => aiResearchApi.cancel(run.id), { success: '조사를 취소했어요' });
  const rerun = useAction(() => aiResearchApi.rerun(run.id), {
    success: (created) => (created.status === 'PLANNING' ? '같은 질문으로 계획을 다시 세우고 있어요' : '질문·계획을 복사했어요. 고친 뒤 시작해 주세요'),
    onSuccess: (created) => set({ id: created.id, new: null }),
  });
  const extend = useAction(() => aiResearchApi.extend(run.id), { success: '더 조사를 시작했어요' });
  const askAboutResearch = useShellStore((state) => state.askAboutResearch);
  const gaps = run.researchState?.gaps ?? [];
  // 다 마치지 못하고(LLM 실패·30분 상한) 그때까지 모은 것으로 정리한 보고서 (#519)
  const stopped = Boolean(run.incompleteReason);
  const incomplete = stopped || run.reportTruncated || (run.stepsUsed >= run.budget.maxSteps && gaps.length > 0);

  return (
    <>
      <PageHead
        crumb={<>심층 조사<Icon name="chevron-right" size="sm" />{fmtDateTime(run.createdAt)}</>}
        title={run.title ?? run.question}
        actions={
          <>
            <AiResearchStatusBadge status={run.status} incompleteReason={run.incompleteReason} />
            {canRenameRun(run) ? (
              <Button size="sm" icon="edit" onClick={() => setRenaming(true)}>
                제목 바꾸기
              </Button>
            ) : null}
            {canRerunRun(run.status) ? (
              <Button size="sm" icon="copy" disabled={rerun.isPending} aria-busy={rerun.isPending} title="질문·계획을 복사한 새 조사를 만들어 고친 뒤 시작해요. 이 조사는 그대로 남아요" onClick={() => rerun.mutate(undefined)}>
                {rerun.isPending ? '만드는 중…' : '다시 조사'}
              </Button>
            ) : null}
            {run.status === 'COMPLETED' && run.report ? (
              <>
                <Button size="sm" icon="search" onClick={() => askAboutResearch({ id: run.id, title: run.title ?? run.question })}>
                  이 보고서로 묻기
                </Button>
                <ResearchNotionExport run={run} />
              </>
            ) : null}
            {canCancelRun(run.status) ? (
              <Button size="sm" variant="danger-outline" icon="x-circle" disabled={cancel.isPending} onClick={() => cancel.mutate(undefined)}>
                취소
              </Button>
            ) : null}
          </>
        }
      />
      {renaming ? <RenameModal run={run} onClose={() => setRenaming(false)} /> : null}
      <Card className="flex-none">
        <CardBody>
          <b className="text-cap font-semibold text-ink-2">질문</b>
          <p className="text-sm leading-relaxed whitespace-pre-line">{run.question}</p>
          {run.seed ? <SeedDetails seed={run.seed} /> : null}
        </CardBody>
      </Card>

      {run.status === 'PLANNING' ? (
        <Banner tone="run" icon="clock">
          <b>계획 세우는 중…</b> 다 세우면 이 화면에서 제목·단계·검색어를 고치고 저장하거나 시작할 수 있어요.
        </Banner>
      ) : null}

      {run.status === 'AWAITING_APPROVAL' ? <AiResearchPlanEditor key={`${run.id}:${run.planRevision}`} run={run} /> : null}

      {run.status === 'QUEUED' || run.status === 'RUNNING' ? <ProgressCard run={run} /> : null}
      {(run.status === 'QUEUED' || run.status === 'RUNNING') && run.pendingRevision && run.report ? <ReportWithVersions run={run} /> : null}

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
              <b>{run.reportTruncated ? '보고서가 길이 한도에 걸려 끝까지 쓰지 못했어요' : stopped ? '조사를 다 마치지 못하고 그때까지 모은 출처로 정리했어요' : '정해 둔 단계를 다 써서 아직 다 알아내지 못했어요'}</b>
              {stopped ? <div className="mt-0.5 text-cap">{run.incompleteReason} 다시 조사하면 처음부터 다시 찾아요.</div> : null}
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
          <ReportWithVersions run={run} />
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
      {(run) => <Body key={run.id} run={run} />}
    </QueryBoundary>
  );
}
