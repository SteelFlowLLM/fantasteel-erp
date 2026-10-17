'use client';

// 조사 계획 고치기 (AWAITING_APPROVAL). 시작을 누르면 고친 계획을 판(revision)과 함께 보내고, 그 사이 다른 곳에서 바뀌었으면 서버가 막는다 (RES-003).
import { AI_RESEARCH_LIMITS, type AiResearchPlan, type AiResearchRunView } from '@fantasteel/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { aiResearchApi, aiResearchKeys } from '@/api/aiResearch';
import { errorCodeOf } from '@/api/http';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { IconButton } from '@/components/IconButton';
import { Input } from '@/components/Input';
import { useAction } from '@/hooks/useAction';
import { addPlanStep, isPlanChanged, movePlanStep, normalizePlan, removePlanStep, validatePlan } from '@/lib/aiResearch';
import { toast } from '@/stores/useToastStore';

export function AiResearchPlanEditor({ run }: { run: AiResearchRunView }) {
  const queryClient = useQueryClient();
  const original: AiResearchPlan = run.plan ?? { title: run.question.slice(0, AI_RESEARCH_LIMITS.planTitleMax), steps: [] };
  const [plan, setPlan] = useState<AiResearchPlan>(original);
  const problems = validatePlan(plan);
  const changed = isPlanChanged(original, plan);

  const start = useAction(
    async () => {
      let revision = run.planRevision;
      if (changed) revision = (await aiResearchApi.updatePlan(run.id, revision, normalizePlan(plan))).planRevision;
      return aiResearchApi.start(run.id, revision);
    },
    {
      success: '조사를 시작했어요',
      toastOnError: false,
      onError: (error) => {
        // 다른 곳에서 계획이 바뀌었거나 상태가 달라졌으면 서버의 최신 상태로 다시 읽는다
        const code = errorCodeOf(error);
        if (code === 'RES-003' || code === 'RES-002') {
          toast.error(code === 'RES-003' ? '다른 곳에서 계획이 바뀌었어요. 새 계획을 불러왔으니 확인하고 다시 시작해 주세요' : '지금 상태에서는 시작할 수 없어요. 최신 상태를 불러왔어요');
          void queryClient.invalidateQueries({ queryKey: aiResearchKeys.all });
        } else {
          toast.apiError(error);
        }
      },
    },
  );

  const setStep = (index: number, field: 'title' | 'query', value: string) =>
    setPlan((current) => ({ ...current, steps: current.steps.map((step, i) => (i === index ? { ...step, [field]: value } : step)) }));

  return (
    <Card className="flex-none">
      <CardHead title="조사 계획" meta="고쳐도 되고 그대로 시작해도 돼요" />
      <CardBody className="gap-3">
        <Field label="제목" htmlFor="research-plan-title" error={problems?.title}>
          <Input id="research-plan-title" value={plan.title} maxLength={AI_RESEARCH_LIMITS.planTitleMax} invalid={!!problems?.title} onChange={(event) => setPlan({ ...plan, title: event.target.value })} />
        </Field>
        <ol className="flex flex-col gap-2.5">
          {plan.steps.map((step, index) => (
            // 순서를 바꾸는 목록이라 입력칸 상태가 따라가게 index를 키로 쓰되, 값은 모두 plan에서 읽는다
            <li key={index} className="flex items-start gap-2 rounded-md border border-line bg-surface-2 p-2.5">
              <span className="mt-1.5 w-5 flex-none text-center text-cap font-semibold text-ink-3 tabular-nums">{index + 1}</span>
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
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
      <CardFoot>
        <Button variant="primary" icon="arrow-right" disabled={problems !== null || start.isPending} onClick={() => start.mutate(undefined)}>
          조사 시작
        </Button>
      </CardFoot>
    </Card>
  );
}
