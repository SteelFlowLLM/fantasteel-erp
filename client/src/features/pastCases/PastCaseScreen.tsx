'use client';

// 과거 사례 검색 (REQ-CASE-003·004, BP-CASE-01, API-267). 서버가 예시 사례 5건(실제 사례 아님)과 등록 사례를 핵심어·구분·기간으로 찾아 준다.
// AI 요약은 철강맨AI(API-262)의 과거 사례 검색 도구로 받는다. 오래 걸려(수십 초) 누를 때만 부르고, 실패하면 이유만 보인다.
// 부르는 곳은 REQ-CASE-004(AI 패널·@AI·품질 관리 버튼). 품질 관리의 '비슷한 사례 찾기'는 ?q=검색어로 이 화면을 연다.
import { PERMISSION, type PastCaseCategory, type PastCaseView } from '@fantasteel/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { aiAssistantApi } from '@/api/aiAssistant';
import { pastCaseApi, pastCaseKeys } from '@/api/pastCases';
import { Badge } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { PageHead } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, StateView } from '@/components/StateView';
import { Steps } from '@/components/Steps';
import { Timeline } from '@/components/Timeline';
import { CASE_CATEGORY_LABEL } from '@/codes';
import { ActorTag, AiAssistedTag, AiCard, EventName, ExampleNotice } from '@/features/agent/components/SoonExampleParts';
import { businessEventLabelOf } from '@/features/agent/lib/businessEventLabel';
import { lotTraceHref } from '@/features/businessEvents/lib/eventTargets';
import { PastCaseEditModal } from '@/features/pastCases/PastCaseEditModal';
import { CASE_CALL_SITES, CASE_PERIOD_DAYS, CASE_REGISTER_STEPS, exampleHistoryOf, sameCategoryCases, summaryQuestion } from '@/features/pastCases/pastCaseExample';
import { sourceText } from '@/features/shell/AiPanel';
import { useAction } from '@/hooks/useAction';
import { useDebouncedValue } from '@/hooks/useGlobalSearch';
import { useCanUse } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';
import { errorMessageOf } from '@/stores/useToastStore';

type CategoryFilter = PastCaseCategory | 'ALL';
const CATEGORY_FILTERS: readonly CategoryFilter[] = ['ALL', 'QUALITY', 'EQUIPMENT'];
const EXAMPLE_LOT_HINT = '예시 사례의 LOT이라 열 수 없어요';

function CategoryBadge({ category }: { category: PastCaseCategory }) {
  return <Badge tone={category === 'QUALITY' ? 'run' : 'wait'}>{CASE_CATEGORY_LABEL[category]}</Badge>;
}

function ExampleBadge() {
  return (
    <span title="화면 구성을 보여 주는 예시 사례예요. 실제 사례가 아니에요." className="inline-flex">
      <Badge tone="outline">예시</Badge>
    </span>
  );
}

interface ResultListProps {
  query: string;
  category: CategoryFilter;
  recent: boolean;
  results: readonly PastCaseView[] | undefined;
  loading: boolean;
  selectedNo: string | null;
  onQueryChange: (query: string) => void;
  onCategoryChange: (category: CategoryFilter) => void;
  onRecentChange: (recent: boolean) => void;
  onSelect: (caseNo: string) => void;
}

function ResultList({ query, category, recent, results, loading, selectedNo, onQueryChange, onCategoryChange, onRecentChange, onSelect }: ResultListProps) {
  return (
    <section aria-label="검색 결과 목록" data-pet-target="card:pastCases.results" data-pet-perch="" className="flex min-h-0 w-80 flex-none flex-col rounded-md border border-line bg-surface shadow-1">
      <div className="flex flex-col gap-2.5 border-b border-line px-4 pt-3.5 pb-2.5">
        <Input type="search" leadingIcon="search" value={query} placeholder="예: 성분 불합격, SM355A, 가열로" aria-label="검색어" onChange={(e) => onQueryChange(e.target.value)} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="구분">
          {CATEGORY_FILTERS.map((key) => (
            <Chip key={key} on={category === key} onClick={() => onCategoryChange(key)} data-pet-term="구분">
              {key === 'ALL' ? '구분 전체' : CASE_CATEGORY_LABEL[key]}
            </Chip>
          ))}
          <Chip on={recent} onClick={() => onRecentChange(!recent)} data-pet-term="기간">
            최근 {CASE_PERIOD_DAYS}일
          </Chip>
        </div>
        <span className="text-cap text-ink-3">{results ? `사례 ${results.length}건 · ${query.trim() ? '많이 맞는 순' : '최신순'}` : '찾는 중…'}</span>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-auto', loading && 'opacity-60')}>
        {(results ?? []).map((item) => {
          const active = item.caseNo === selectedNo;
          return (
            <button
              key={item.caseNo}
              type="button"
              aria-current={active || undefined}
              data-pet-item="pastCase"
              data-pet-item-title={item.caseNo}
              onClick={() => onSelect(item.caseNo)}
              className={cn(
                'flex w-full flex-col gap-1 border-b border-line px-4 py-2.5 text-left hover:bg-surface-2',
                active && 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint-hover',
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-cap text-ink-3 tabular-nums">{item.occurredDate.slice(5)}</span>
                <span className="truncate font-mono text-xs">{item.lots[0]?.lotNo}</span>
                <span className="ml-auto flex flex-none items-center gap-1">
                  {item.isExample ? <ExampleBadge /> : null}
                  <CategoryBadge category={item.caseCategory} />
                </span>
              </span>
              <span className="text-xs leading-snug">
                <span className="font-mono text-ink-3">{item.caseNo}</span> · {item.title}
              </span>
            </button>
          );
        })}
        {results && results.length === 0 ? <EmptyNote>맞는 사례가 없어요. 핵심어를 줄이거나 구분·기간을 풀어 보세요.</EmptyNote> : null}
      </div>
      <div className="flex flex-none flex-col gap-1 border-t border-line bg-surface-2 px-4 py-3 text-cap text-ink-3">
        <span>핵심어로 제목·현상·원인·조치·설비·LOT을 찾아요.</span>
        <span>사례 번호 형식(CASE-NNNN)은 가정값이에요.</span>
      </div>
    </section>
  );
}

/** 검색 결과 요약: 결과 사례의 원인·조치를 바로 보이고, 누르면 AI가 요약한다 (REQ-CASE-003) */
function ResultSummary({ query, results, onSelect }: { query: string; results: readonly PastCaseView[]; onSelect: (caseNo: string) => void }) {
  const ai = useMutation({ mutationFn: (question: string) => aiAssistantApi.ask({ question, screen: { path: '/past-cases', title: '과거 사례 검색', label: query || null } }) });
  const quality = results.filter((item) => item.caseCategory === 'QUALITY').length;
  // 검색어가 바뀌면 이전 검색의 AI 요약을 지운다 (다른 결과의 요약이 남지 않게)
  const { reset } = ai;
  useEffect(() => reset(), [query, reset]);

  return (
    <AiCard
      title="검색 결과 요약"
      meta={`결과 ${results.length}건 · 품질 ${quality} · 설비 ${results.length - quality}`}
      actions={
        <Button size="sm" disabled={ai.isPending || results.length === 0} onClick={() => ai.mutate(summaryQuestion(query))}>
          {ai.isPending ? 'AI가 요약하는 중…' : ai.data ? '다시 요약' : 'AI로 요약'}
        </Button>
      }
      className="flex-none"
      petKey="card:pastCases.summary"
    >
      {ai.data ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-normal whitespace-pre-wrap">{ai.data.answer}</p>
          {ai.data.sources.length ? <span className="text-cap text-ink-3">출처 · {ai.data.sources.map(sourceText).join(', ')}</span> : null}
        </div>
      ) : ai.isPending ? (
        <p className="text-sm text-ink-3">AI가 사례를 찾아 요약하고 있어요. 수십 초 걸릴 수 있어요.</p>
      ) : ai.error ? (
        <p className="text-sm text-danger">AI가 요약하지 못했어요. {errorMessageOf(ai.error)} 아래 사례별 원인·조치를 확인해 주세요.</p>
      ) : null}
      <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-ink-2">
        {results.map((item) => (
          <li key={item.caseNo} className="flex gap-2">
            <button type="button" className="flex-none font-mono text-run hover:underline" onClick={() => onSelect(item.caseNo)}>
              {item.caseNo}
            </button>
            <span className="min-w-0">
              <b className="font-semibold text-ink">원인</b> {item.cause || '기록 없음'} <b className="font-semibold text-ink">조치</b> {item.actionTaken || '기록 없음'}
            </span>
          </li>
        ))}
      </ul>
      <span className="inline-flex items-center gap-1 text-cap text-ink-3">
        <Icon name="info" size="sm" />
        AI 요약은 참고용이에요. 판단은 원본 사례로 확인해요.
      </span>
    </AiCard>
  );
}

function CaseHistory({ item }: { item: PastCaseView }) {
  if (!item.isExample) {
    const lot = item.lots[0];
    return (
      <Card petKey="card:pastCases.history">
        <CardHead title="사례 등록" meta={item.createdAt ? fmtDateTime(item.createdAt) : undefined} />
        <CardBody>
          <KvList
            items={[
              { label: '등록한 사람', value: item.createdEmployeeName ?? '—' },
              { label: '등록 시각', value: item.createdAt ? fmtDateTime(item.createdAt) : '—' },
            ]}
          />
          <span className="text-cap text-ink-3">검사·불합격 처리 이력은 LOT의 작업 로그에서 봐요.</span>
          {lot?.lotId ? (
            <ButtonLink href={`/business-events?lotId=${lot.lotId}`} icon="history" size="sm" className="self-start">
              {lot.lotNo} 작업 로그
            </ButtonLink>
          ) : null}
        </CardBody>
      </Card>
    );
  }
  const history = exampleHistoryOf(item);
  return (
    <Card petKey="card:pastCases.history">
      <CardHead title="사례 작업 로그" meta={`${item.lots[0]?.lotNo ?? ''} · ${history.length}건 · 예시`} />
      <CardBody className="pb-1">
        <Timeline
          items={history.map((entry) => ({
            key: entry.key,
            tone: entry.key === 'inspection' ? 'danger' : entry.key === 'disposition' ? 'wait' : 'ok',
            title: (
              <span className="flex flex-wrap items-center gap-1.5">
                <ActorTag actorType={entry.actorType} />
                <EventName>{businessEventLabelOf(entry.businessEventType)}</EventName>
                {entry.isAiAssisted ? <AiAssistedTag /> : null}
                <b className="font-semibold">{entry.head}</b>
              </span>
            ),
            time: `${entry.time} · ${entry.eventNo}`,
            body: <span className="text-cap text-ink-3">{entry.detail}</span>,
          }))}
        />
      </CardBody>
      <div className="mt-auto flex flex-col gap-2 border-t border-line px-4 py-3">
        <span className="text-cap text-ink-3">사례가 쌓이는 순서</span>
        {/* 글자를 키우면 단계 줄이 카드보다 길어져 카드 밖으로 삐져나오므로 카드 안에서 가로로 넘긴다 */}
        <Steps items={CASE_REGISTER_STEPS.map((label) => ({ key: label, label, state: 'done' as const }))} className="overflow-x-auto" />
      </div>
    </Card>
  );
}

/** 등록 사례의 수정·삭제 (예시 사례는 DB에 없어 못 고친다). 등록과 같은 권한(불합격 처리 상태 지정)이 있는 사원만 */
function CaseEditActions({ item }: { item: PastCaseView }) {
  const canEdit = useCanUse(PERMISSION.DISPOSITION_SET);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove = useAction(() => pastCaseApi.remove(item.id), {
    success: (removed) => `${removed.caseNo}를 지웠어요`,
    invalidate: [pastCaseKeys.all],
    onSuccess: () => setRemoving(false),
  });
  if (item.isExample || !canEdit) return null;
  return (
    <>
      <Button icon="edit" onClick={() => setEditing(true)}>
        수정
      </Button>
      <Button icon="trash" variant="danger-outline" onClick={() => setRemoving(true)}>
        삭제
      </Button>
      {editing ? <PastCaseEditModal item={item} onClose={() => setEditing(false)} /> : null}
      {removing ? (
        <ConfirmDialog title={`${item.caseNo}를 지울까요?`} confirmLabel="삭제" tone="danger" pending={remove.isPending} onConfirm={() => remove.mutate(undefined)} onCancel={() => setRemoving(false)}>
          <p>사례와 관련 LOT 연결이 사라지고 되돌릴 수 없어요. 등록할 때 남은 작업 로그는 그대로 있어요.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function CaseDetail({ item, query, results, onSelect }: { item: PastCaseView; query: string; results: readonly PastCaseView[]; onSelect: (caseNo: string) => void }) {
  const others = sameCategoryCases(item, results);
  const lot = item.lots[0];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-auto">
      <PageHead
        crumb={
          <>
            과거 사례 검색
            <Icon name="chevron-right" size="sm" />
            사례 상세
          </>
        }
        title={
          <span className="flex items-center gap-2.5">
            {item.caseNo} · {item.title}
            <CategoryBadge category={item.caseCategory} />
            {item.isExample ? <ExampleBadge /> : null}
          </span>
        }
        actions={
          <>
            <CaseEditActions item={item} />
            {lot?.lotId ? (
              <ButtonLink href={lotTraceHref(lot.lotNo, 'forward')} icon="trace">
                LOT 추적
              </ButtonLink>
            ) : (
              <Button icon="trace" disabled title={EXAMPLE_LOT_HINT}>
                LOT 추적
              </Button>
            )}
          </>
        }
      />

      <ResultSummary query={query} results={results} onSelect={onSelect} />

      <div className="grid min-h-0 flex-none grid-cols-[1.1fr_1fr] gap-3.5">
        <CaseHistory item={item} />

        <Card petKey="card:pastCases.detail">
          <CardHead title="이 사례" meta={`작성 ${item.createdEmployeeName ?? '품질 담당(예시)'} · ${item.occurredDate}`} />
          <CardBody>
            <div data-pet-item="pastCase" data-pet-item-title={item.caseNo}>
              <KvList
                items={[
                  { label: '구분', value: CASE_CATEGORY_LABEL[item.caseCategory] },
                  { label: '관련 LOT', value: <span className="font-mono text-sm">{item.lots.map((l) => l.lotNo).join(', ')}</span> },
                  { label: '관련 설비', value: item.equipmentText || '—' },
                  { label: '발생일', value: item.occurredDate },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-xs leading-relaxed text-ink-2">
              <p>
                <b data-pet-term="현상" className="font-semibold text-ink">
                  현상
                </b> {item.phenomenon}
              </p>
              <p>
                <b data-pet-term="원인" className="font-semibold text-ink">
                  원인
                </b> {item.cause || '기록 없음'}
              </p>
              <p>
                <b data-pet-term="조치" className="font-semibold text-ink">
                  조치
                </b> {item.actionTaken || '기록 없음'}
              </p>
            </div>
            {others.length ? (
              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <span className="text-xs font-semibold">같은 구분의 다른 사례</span>
                {others.map((other) => (
                  <button
                    key={other.caseNo}
                    type="button"
                    data-pet-item="pastCase"
                    data-pet-item-title={other.caseNo}
                    onClick={() => onSelect(other.caseNo)}
                    className="flex items-center gap-1.5 text-left text-xs text-ink-2 hover:text-ink"
                  >
                    <Icon name="link" size="sm" className="text-ink-3" />
                    <span className="font-mono">{other.caseNo}</span>
                    <span className="truncate">{other.title}</span>
                    <em className="ml-auto text-cap text-ink-3 not-italic">{other.occurredDate.slice(5)}</em>
                  </button>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card className="flex-none">
        <CardHead title="과거 사례를 찾는 곳" meta="이 화면 밖에서도 같은 사례를 찾아요" />
        <CardBody>
          <ul className="grid grid-cols-3 gap-2.5">
            {CASE_CALL_SITES.map((site) => (
              <li key={site.key} className="flex flex-col gap-1 rounded-sm border border-line bg-surface-2 px-3 py-2.5">
                <b className="text-sm font-semibold">{site.place}</b>
                <span className="text-cap text-ink-3">{site.how}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

export function PastCaseScreen() {
  const params = useSearchParams();
  const initialQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [recent, setRecent] = useState(false);
  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim());

  // 품질 화면의 '비슷한 사례 찾기'·등록 직후 이동으로 이 화면에 있는 채 다시 오면 주소의 검색어로 바꾼다
  useEffect(() => {
    setQuery(initialQuery);
    setSelectedNo(null);
  }, [initialQuery]);

  const input = { q: debouncedQuery || undefined, category: category === 'ALL' ? undefined : category, days: recent ? CASE_PERIOD_DAYS : undefined };
  const search = useQuery({ queryKey: pastCaseKeys.search(input), queryFn: () => pastCaseApi.search(input), placeholderData: (previous) => previous });
  const results = search.data;
  // 고른 사례가 결과에서 빠지면 결과의 첫 사례를 보인다
  const selected = results?.find((item) => item.caseNo === selectedNo) ?? results?.[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ExampleNotice text="예시 사례 5건(실제 사례 아님, '예시' 표시)과 품질 담당이 등록한 사례에서 찾아요." />
      <div className="flex min-h-0 flex-1 gap-4">
        <ResultList
          query={query}
          category={category}
          recent={recent}
          results={results}
          loading={search.isFetching}
          selectedNo={selected?.caseNo ?? null}
          onQueryChange={setQuery}
          onCategoryChange={setCategory}
          onRecentChange={setRecent}
          onSelect={setSelectedNo}
        />
        <div className="flex min-w-0 flex-1">
          <QueryBoundary query={search} loadingLabel="과거 사례를 찾는 중…">
            {(data) =>
              selected ? (
                <CaseDetail item={selected} query={debouncedQuery} results={data} onSelect={setSelectedNo} />
              ) : (
                <StateView kind="empty" title="맞는 사례가 없어요" text="핵심어를 줄이거나 구분·기간을 풀어 보세요." />
              )
            }
          </QueryBoundary>
        </div>
      </div>
    </div>
  );
}
