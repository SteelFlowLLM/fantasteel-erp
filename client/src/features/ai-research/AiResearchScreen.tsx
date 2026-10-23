'use client';

// 철강맨AI 심층 조사 /ai-research[?id=<조사 id>|?new=1] (이슈 #378, 문서에 없는 기능).
// 왼쪽은 내 조사 목록, 오른쪽은 새 조사 질문 또는 조사 상세다. 자기 조사만 보인다 (서버가 확인).
import { AI_RESEARCH_LIMITS, type AiResearchRunSummaryView } from '@fantasteel/shared';
import { useState } from 'react';
import { aiResearchApi } from '@/api/aiResearch';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Select, Textarea } from '@/components/Input';
import { MasterPane, PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, StateView } from '@/components/StateView';
import { AiResearchDetail } from '@/features/ai-research/AiResearchDetail';
import { AiResearchStatusBadge } from '@/features/ai-research/AiResearchStatusBadge';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { useAction } from '@/hooks/useAction';
import { useAiResearchList, useAiResearchSchedules } from '@/hooks/useAiResearch';
import { fmtRunAt } from '@/lib/aiResearch';
import { Badge } from '@/components/Badge';
import { budgetOfScope, RESEARCH_SCOPE_OPTIONS, type ResearchScope } from '@/lib/aiResearchChart';
import { cn } from '@/lib/cn';
import { fmtMDHM } from '@/lib/format';

function RunMaster({ currentId, onNew }: { currentId: number | null; onNew: () => void }) {
  const { set } = useUrlParams();
  const list = useAiResearchList();
  const schedules = useAiResearchSchedules();
  // 서버가 켜진 것·다음 차례가 빠른 것부터 준다
  const enabledSchedules = (schedules.data ?? []).filter((schedule) => schedule.enabled);
  return (
    <MasterPane
      head={
        <div className="flex items-center gap-2">
          <b className="text-sm font-semibold">심층 조사</b>
          <span className="text-cap text-ink-3">{list.data?.total ?? 0}건</span>
          <Button size="sm" variant="primary" icon="plus" className="ml-auto" onClick={onNew}>
            새 조사
          </Button>
        </div>
      }
    >
      <QueryBoundary query={list} loadingLabel="조사 목록을 불러오는 중…">
        {(data) => (
          <>
            {data.items.length === 0 ? <EmptyNote>아직 조사가 없어요. 새 조사를 시작해 보세요</EmptyNote> : null}
            <ul className="flex flex-col">
              {data.items.map((row: AiResearchRunSummaryView) => (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-current={row.id === currentId ? 'page' : undefined}
                    onClick={() => set({ id: row.id, new: null })}
                    className={cn('flex w-full flex-col gap-1 border-b border-line px-4 py-2.5 text-left hover:bg-surface-2 aria-[current=page]:bg-brand-tint aria-[current=page]:hover:bg-brand-tint-hover')}
                  >
                    <span className="flex items-center gap-1.5">
                      <AiResearchStatusBadge status={row.status} />
                      {row.repeating ? (
                        <Badge tone="run" title="이 조사에 반복이 켜져 있어요">
                          반복
                        </Badge>
                      ) : row.fromSchedule ? (
                        <Badge tone="outline" title="반복이 정한 시각에 만든 조사예요">
                          반복 실행
                        </Badge>
                      ) : null}
                      <span className="ml-auto text-cap text-ink-3 tabular-nums">{fmtMDHM(row.createdAt)}</span>
                    </span>
                    <span className="line-clamp-2 text-sm font-semibold break-words">{row.title ?? row.question}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-4 py-2.5 text-cap text-ink-3">
              최근 순 · 내 조사만 보여요
              {enabledSchedules.length ? ` · 켜진 반복 ${enabledSchedules.length}/${AI_RESEARCH_LIMITS.maxSchedulesPerEmployee}` : ''}
              {enabledSchedules[0]?.nextRunAt ? ` · 다음 반복 ${fmtRunAt(enabledSchedules[0].nextRunAt)}` : ''}
            </p>
          </>
        )}
      </QueryBoundary>
    </MasterPane>
  );
}

function NewRunForm({ onCreated, onCancel }: { onCreated: (id: number) => void; onCancel: () => void }) {
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<ResearchScope>('default');
  const trimmed = question.trim();
  const create = useAction(aiResearchApi.create, { success: '조사 계획을 세우고 있어요', onSuccess: (run) => onCreated(run.id) });
  const tooShort = trimmed.length < AI_RESEARCH_LIMITS.questionMin;
  return (
    <>
      <PageHead crumb="심층 조사" title="새 조사" />
      <Field
        label="조사할 질문"
        htmlFor="research-question"
        hint="AI가 먼저 조사 계획을 세워요. 계획을 보고 고친 뒤 시작할 수 있어요. 회사 밖으로 나가는 것은 검색어뿐이고, 회사 안 정보는 검색어에서 걸러져요."
      >
        <Textarea id="research-question" rows={5} value={question} maxLength={AI_RESEARCH_LIMITS.questionMax} placeholder="예: 열연 코일 가격이 최근 왜 올랐는지, 앞으로 전망은 어떤지 조사해 줘" onChange={(event) => setQuestion(event.target.value)} />
      </Field>
      <Field label="조사 범위" htmlFor="research-scope" hint="넓게·최대는 단계와 출처를 더 많이 써서 오래 걸려요. 서버가 정한 상한을 넘지 않아요.">
        <Select id="research-scope" value={scope} onChange={(event) => setScope(event.target.value as ResearchScope)}>
          {RESEARCH_SCOPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-center gap-2">
        <Button variant="primary" icon="search" disabled={tooShort || create.isPending} onClick={() => create.mutate({ question: trimmed, budget: budgetOfScope(scope) })}>
          계획 세우기
        </Button>
        <Button onClick={onCancel}>닫기</Button>
        <span className="ml-auto text-cap text-ink-3 tabular-nums">
          {question.length}/{AI_RESEARCH_LIMITS.questionMax}
        </span>
      </div>
    </>
  );
}

export function AiResearchScreen() {
  const { get, getNumber, set } = useUrlParams();
  const id = getNumber('id');
  const creating = get('new') === '1';
  return (
    <>
      <RunMaster currentId={id} onNew={() => set({ new: 1, id: null })} />
      <PageMain>
        {creating ? (
          <NewRunForm onCreated={(runId) => set({ id: runId, new: null })} onCancel={() => set({ new: null })} />
        ) : id !== null ? (
          <AiResearchDetail id={id} />
        ) : (
          <StateView
            kind="empty"
            icon="search"
            title="조사를 골라 주세요"
            text="왼쪽 목록에서 조사를 고르거나 새 조사를 시작해 주세요. 철강맨AI가 웹을 여러 번 찾아 읽고 출처가 달린 보고서를 써 줘요."
            actions={
              <Button variant="primary" icon="plus" onClick={() => set({ new: 1, id: null })}>
                새 조사
              </Button>
            }
          />
        )}
      </PageMain>
    </>
  );
}
