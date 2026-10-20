'use client';

// 조사 계획 고치기 (AWAITING_APPROVAL). [계획 저장]은 시작하지 않고 저장만, [조사 시작]은 고친 것이 있으면 저장한 뒤 시작한다.
// 둘 다 판(revision)과 함께 보내고, 그 사이 다른 곳에서 바뀌었으면 서버가 막는다 (RES-003).
// [말로 고치기](이슈 #416)는 지금 계획(저장하지 않은 고침 포함)과 부탁을 보내 AI가 고친 계획을 칸에 채운다. 서버는 저장하지 않고, 새·바뀐·빠진 단계를 표시한다.
import { AI_RESEARCH_LIMITS, type AiResearchPlan, type AiResearchRunView } from '@fantasteel/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { aiResearchApi, aiResearchKeys } from '@/api/aiResearch';
import { errorCodeOf } from '@/api/http';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { IconButton } from '@/components/IconButton';
import { Input, Textarea } from '@/components/Input';
import { useAction } from '@/hooks/useAction';
import { addPlanStep, isPlanChanged, movePlanStep, normalizePlan, planBlockReason, planSuggestionDiff, planSuggestionSummary, removePlanStep, validatePlan, type PlanStepMark } from '@/lib/aiResearch';
import { toast } from '@/stores/useToastStore';

export function AiResearchPlanEditor({ run }: { run: AiResearchRunView }) {
  const queryClient = useQueryClient();
  const original: AiResearchPlan = run.plan ?? { title: run.question.slice(0, AI_RESEARCH_LIMITS.planTitleMax), steps: [] };
  const [plan, setPlan] = useState<AiResearchPlan>(original);
  const problems = validatePlan(plan);
  const blockReason = planBlockReason(problems);
  const changed = isPlanChanged(original, plan);
  const reasonId = useId();
  const [instruction, setInstruction] = useState('');
  /** 마지막 말로 고치기: 고치기 전 계획(표시·되돌리기 기준)과 서버가 뺀 단계 수 */
  const [suggested, setSuggested] = useState<{ base: AiResearchPlan; dropped: number } | null>(null);
  const diff = suggested ? planSuggestionDiff(suggested.base, plan) : null;
  const summary = diff ? planSuggestionSummary(diff) : null;

  // 다른 곳에서 계획이 바뀌었거나 상태가 달라졌으면 서버의 최신 상태로 다시 읽는다
  const onConflict = (verb: '저장' | '시작') => (error: unknown) => {
    const code = errorCodeOf(error);
    if (code === 'RES-003' || code === 'RES-002') {
      toast.error(code === 'RES-003' ? `다른 곳에서 계획이 바뀌었어요. 새 계획을 불러왔으니 확인하고 다시 ${verb}해 주세요` : `지금 상태에서는 ${verb}할 수 없어요. 최신 상태를 불러왔어요`);
      void queryClient.invalidateQueries({ queryKey: aiResearchKeys.all });
    } else {
      toast.apiError(error);
    }
  };

  // 저장하면 판이 올라 이 칸은 새 계획으로 다시 그려진다 (상위의 key가 판을 포함)
  const save = useAction(() => aiResearchApi.updatePlan(run.id, run.planRevision, normalizePlan(plan)), { success: '계획을 저장했어요', toastOnError: false, onError: onConflict('저장') });
  const start = useAction(
    async () => {
      let revision = run.planRevision;
      if (changed) revision = (await aiResearchApi.updatePlan(run.id, revision, normalizePlan(plan))).planRevision;
      return aiResearchApi.start(run.id, revision);
    },
    { success: '조사를 시작했어요', toastOnError: false, onError: onConflict('시작') },
  );
  const suggest = useMutation({
    mutationFn: () => aiResearchApi.suggestPlan(run.id, instruction, plan),
    onSuccess: (result) => {
      if (!isPlanChanged(plan, result.plan)) {
        toast.info(result.dropped > 0 ? `AI가 낸 단계 ${result.dropped}개는 규칙에 맞지 않아 뺐고, 계획은 그대로예요` : 'AI가 고칠 곳을 찾지 못해 계획이 그대로예요. 부탁을 더 구체적으로 써 주세요');
        return;
      }
      setSuggested({ base: plan, dropped: result.dropped });
      setPlan(result.plan);
      setInstruction('');
    },
    onError: (error) => {
      if (errorCodeOf(error) !== 'RES-002') return toast.apiError(error);
      toast.error('지금 상태에서는 계획을 고칠 수 없어요. 최신 상태를 불러왔어요');
      void queryClient.invalidateQueries({ queryKey: aiResearchKeys.all });
    },
  });
  const busy = save.isPending || start.isPending || suggest.isPending;
  const instructionText = instruction.trim();
  const askSuggest = () => {
    if (instructionText && !busy) suggest.mutate();
  };
  // Enter로 보내고 Shift+Enter는 줄바꿈 (한글 조합 중 Enter는 보내지 않는다)
  const onInstructionKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    askSuggest();
  };

  // 저장하지 않은 고침이 있으면 창을 닫거나 새로 고치기 전에 브라우저가 묻는다
  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);

  const setStep = (index: number, field: 'title' | 'query', value: string) =>
    setPlan((current) => ({ ...current, steps: current.steps.map((step, i) => (i === index ? { ...step, [field]: value } : step)) }));

  return (
    <Card className="flex-none">
      <CardHead title="조사 계획" meta="고쳐서 저장해 두거나 그대로 시작해도 돼요" />
      <CardBody className="gap-3">
        <div className="flex flex-col gap-1.5 rounded-md border border-line bg-ai-bg p-2.5">
          <Field label="말로 고치기" htmlFor="research-plan-instruction" hint="화면의 지금 계획을 AI가 부탁대로 고쳐 칸에 채워요. 저장하거나 시작해야 반영돼요">
            <Textarea
              id="research-plan-instruction"
              rows={2}
              value={instruction}
              maxLength={AI_RESEARCH_LIMITS.instructionMax}
              placeholder="예: 2단계 빼고 가격 전망 넣어 줘"
              disabled={suggest.isPending}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={onInstructionKey}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ai-outline" icon="edit" disabled={!instructionText || busy} aria-busy={suggest.isPending} onClick={askSuggest}>
              {suggest.isPending ? 'AI가 고치는 중…' : '고치기'}
            </Button>
            <span className="text-cap text-ink-3 tabular-nums">
              {instruction.length}/{AI_RESEARCH_LIMITS.instructionMax}자{suggest.isPending ? ' · 수십 초 걸릴 수 있어요' : ''}
            </span>
          </div>
          {suggested && diff ? (
            <div role="status" className="flex flex-wrap items-center gap-2 text-cap text-ink-2">
              <span>AI가 고친 계획이에요 · {summary ?? '고치기 전과 같아요'}</span>
              {suggested.dropped > 0 ? <span className="text-wait">규칙에 맞지 않는 단계 {suggested.dropped}개는 뺐어요</span> : null}
              <Button
                size="sm"
                variant="ghost"
                icon="history"
                disabled={busy}
                onClick={() => {
                  setPlan(suggested.base);
                  setSuggested(null);
                }}
              >
                고치기 전으로
              </Button>
            </div>
          ) : null}
        </div>
        <Field label="제목" htmlFor="research-plan-title" error={problems?.title}>
          <Input id="research-plan-title" value={plan.title} maxLength={AI_RESEARCH_LIMITS.planTitleMax} invalid={!!problems?.title} onChange={(event) => setPlan({ ...plan, title: event.target.value })} />
        </Field>
        <ol className="flex flex-col gap-2.5">
          {plan.steps.map((step, index) => (
            // 순서를 바꾸는 목록이라 입력칸 상태가 따라가게 index를 키로 쓰되, 값은 모두 plan에서 읽는다
            <li key={index} className="flex items-start gap-2 rounded-md border border-line bg-surface-2 p-2.5">
              <span className="mt-1.5 w-5 flex-none text-center text-cap font-semibold text-ink-3 tabular-nums">{index + 1}</span>
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                {diff && diff.marks[index] !== 'same' ? (
                  <div className="sm:col-span-2">
                    <StepMark mark={diff.marks[index]} />
                  </div>
                ) : null}
                <Field label="단계 이름" error={problems?.steps[index]?.title}>
                  <Input aria-label={`${index + 1}단계 이름`} value={step.title} maxLength={AI_RESEARCH_LIMITS.stepTitleMax} invalid={!!problems?.steps[index]?.title} onChange={(event) => setStep(index, 'title', event.target.value)} />
                </Field>
                <Field label="검색어" error={problems?.steps[index]?.query}>
                  <Input aria-label={`${index + 1}단계 검색어`} value={step.query} maxLength={AI_RESEARCH_LIMITS.queryMax} invalid={!!problems?.steps[index]?.query} onChange={(event) => setStep(index, 'query', event.target.value)} />
                </Field>
              </div>
              <div className="mt-5 flex flex-none items-center">
                <IconButton icon="chevron-up" label="위로" size="sm" disabled={index === 0} onClick={() => setPlan({ ...plan, steps: movePlanStep(plan.steps, index, -1) })} />
                <IconButton icon="chevron-down" label="아래로" size="sm" disabled={index === plan.steps.length - 1} onClick={() => setPlan({ ...plan, steps: movePlanStep(plan.steps, index, 1) })} />
                <IconButton icon="trash" label="단계 지우기" size="sm" disabled={plan.steps.length <= 1} onClick={() => setPlan({ ...plan, steps: removePlanStep(plan.steps, index) })} />
              </div>
            </li>
          ))}
        </ol>
        {diff && diff.removed.length ? (
          <div className="flex flex-col gap-1 rounded-md border border-dashed border-line p-2.5">
            <span className="text-cap font-semibold text-ink-3">빠진 단계</span>
            <ul className="flex flex-col gap-0.5">
              {diff.removed.map((step, i) => (
                <li key={i} className="text-cap text-ink-3 line-through">
                  {step.title || '(이름 없음)'} — {step.query || '(검색어 없음)'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {problems?.general ? (
          <p role="alert" className="text-cap text-danger">
            {problems.general}
          </p>
        ) : null}
        <div>
          <Button size="sm" icon="plus" disabled={plan.steps.length >= AI_RESEARCH_LIMITS.maxPlanSteps} onClick={() => setPlan({ ...plan, steps: addPlanStep(plan.steps) })}>
            단계 추가
          </Button>
          <span className="ml-2 text-cap text-ink-3">
            {plan.steps.length}/{AI_RESEARCH_LIMITS.maxPlanSteps}단계 · 검색어에는 회사 안 정보를 넣지 마세요
          </span>
        </div>
      </CardBody>
      <CardFoot className="flex-wrap">
        <Button variant="primary" icon="arrow-right" disabled={problems !== null || busy} aria-describedby={blockReason ? reasonId : undefined} onClick={() => start.mutate(undefined)}>
          {changed ? '저장하고 조사 시작' : '조사 시작'}
        </Button>
        <Button icon="check" disabled={!changed || problems !== null || busy} aria-busy={save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending ? '저장하는 중…' : '계획 저장'}
        </Button>
        {blockReason ? (
          <span id={reasonId} className="text-cap text-danger">
            고칠 곳이 있어 시작할 수 없어요 · {blockReason}
          </span>
        ) : changed ? (
          <span className="text-cap text-ink-3">저장하지 않은 고침이 있어요. 저장하지 않고 다른 조사로 옮기면 사라져요</span>
        ) : (
          <span className="text-cap text-ink-3">저장된 계획이에요</span>
        )}
      </CardFoot>
    </Card>
  );
}

function StepMark({ mark }: { mark: Exclude<PlanStepMark, 'same'> }) {
  return mark === 'new' ? <Badge tone="ai">새 단계</Badge> : <Badge tone="run">바뀐 단계</Badge>;
}
