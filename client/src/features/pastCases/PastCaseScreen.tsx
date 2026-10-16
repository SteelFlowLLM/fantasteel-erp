'use client';

// 과거 사례 검색 (REQ-CASE-003·004, BP-CASE-01). 기준 ERD에 past_case 테이블이 없어(2026-10-16 결정: DB 없이 화면만 동작)
// 예시 사례 5건을 화면에서 핵심어·구분·기간으로 거른다. AI 요약·철강맨AI·@AI·사례 등록은 사례 DB가 생기면 붙인다.
// 부르는 곳은 REQ-CASE-004(AI 패널·@AI·품질 관리 버튼). 품질 관리의 '비슷한 사례 찾기'는 ?q=검색어로 이 화면을 연다.
// 작업 로그 주체는 사용자만(AI 주체 없음), 이벤트는 REQ-LOG-002 목록만, LOT 번호는 9.2 형식, 같은 종류 사례는 같은 구분끼리.
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ComingSoon } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { PageHead } from '@/components/Page';
import { EmptyNote, StateView } from '@/components/StateView';
import { Steps } from '@/components/Steps';
import { Timeline } from '@/components/Timeline';
import { CASE_CATEGORY_LABEL, type CaseCategory } from '@/codes';
import { ActorTag, AiAssistedTag, EventName, ExampleNotice } from '@/features/agent/components/SoonExampleParts';
import { businessEventLabelOf } from '@/features/agent/lib/businessEventLabel';
import {
  CASE_CALL_SITES,
  CASE_PERIOD_DAYS,
  CASE_REGISTER_STEPS,
  caseHistoryOf,
  caseKeywords,
  sameCategoryCases,
  searchPastCases,
  type CaseCategoryFilter,
  type CasePeriod,
  type PastCaseExample,
} from '@/features/pastCases/pastCaseExample';
import { cn } from '@/lib/cn';
import { todayStr } from '@/lib/format';

const CATEGORY_FILTERS: readonly CaseCategoryFilter[] = ['ALL', 'QUALITY', 'EQUIPMENT'];
const EXAMPLE_LOT_HINT = '예시 사례의 LOT이라 열 수 없어요';

function CategoryBadge({ category }: { category: CaseCategory }) {
  return <Badge tone={category === 'QUALITY' ? 'run' : 'wait'}>{CASE_CATEGORY_LABEL[category]}</Badge>;
}

interface ResultListProps {
  query: string;
  category: CaseCategoryFilter;
  period: CasePeriod;
  results: readonly PastCaseExample[];
  selectedNo: string | null;
  onQueryChange: (query: string) => void;
  onCategoryChange: (category: CaseCategoryFilter) => void;
  onPeriodChange: (period: CasePeriod) => void;
  onSelect: (caseNo: string) => void;
}

function ResultList({ query, category, period, results, selectedNo, onQueryChange, onCategoryChange, onPeriodChange, onSelect }: ResultListProps) {
  const keywords = caseKeywords(query);
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
          <Chip on={period === 'DAYS_90'} onClick={() => onPeriodChange(period === 'DAYS_90' ? 'ALL' : 'DAYS_90')} data-pet-term="기간">
            최근 {CASE_PERIOD_DAYS}일
          </Chip>
        </div>
        <span className="text-cap text-ink-3">
          {keywords.length ? `핵심어 ${keywords.join(' · ')} · ` : ''}사례 {results.length}건 · {keywords.length ? '많이 맞는 순' : '최신순'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {results.map((item) => {
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
                <span className="text-cap text-ink-3 tabular-nums">{item.occurredDate}</span>
                <span className="truncate font-mono text-xs">{item.lotNos[0]}</span>
                <span className="ml-auto">
                  <CategoryBadge category={item.caseCategory} />
                </span>
              </span>
              <span className="text-xs leading-snug">
                <span className="font-mono text-ink-3">{item.caseNo}</span> · {item.title}
              </span>
            </button>
          );
        })}
        {results.length === 0 ? <EmptyNote>맞는 사례가 없어요. 핵심어를 줄이거나 구분·기간을 풀어 보세요.</EmptyNote> : null}
      </div>
      <div className="flex flex-none flex-col gap-1 border-t border-line bg-surface-2 px-4 py-3 text-cap text-ink-3">
        <span>핵심어로 제목·현상·원인·조치·설비·LOT을 찾아요.</span>
        <span>사례 번호 형식은 아직 정하지 않았어요 (예시 표기).</span>
      </div>
    </section>
  );
}

/** 검색 결과 요약: AI 요약 대신 결과 사례의 원인을 그대로 모은다 (사례 DB와 AI 요약은 다음 단계) */
function ResultSummary({ results, onSelect }: { results: readonly PastCaseExample[]; onSelect: (caseNo: string) => void }) {
  const quality = results.filter((item) => item.caseCategory === 'QUALITY').length;
  return (
    <Card className="flex-none" petKey="card:pastCases.summary">
      <CardHead title="검색 결과 요약" meta={`결과 ${results.length}건 · 품질 ${quality} · 설비 ${results.length - quality}`} />
      <CardBody>
        <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-ink-2">
          {results.map((item) => (
            <li key={item.caseNo} className="flex gap-2">
              <button type="button" className="flex-none font-mono text-run hover:underline" onClick={() => onSelect(item.caseNo)}>
                {item.caseNo}
              </button>
              <span className="min-w-0">
                <b className="font-semibold text-ink">원인</b> {item.cause} <b className="font-semibold text-ink">조치</b> {item.actionTaken}
              </span>
            </li>
          ))}
        </ul>
        <span className="inline-flex items-center gap-1 text-cap text-ink-3">
          <Icon name="info" size="sm" />
          사례 DB가 생기면 AI가 결과를 요약해요 (REQ-CASE-003)
        </span>
      </CardBody>
    </Card>
  );
}

function CaseDetail({ item, results, onSelect }: { item: PastCaseExample; results: readonly PastCaseExample[]; onSelect: (caseNo: string) => void }) {
  const others = sameCategoryCases(item);
  const history = caseHistoryOf(item);
  const lotNo = item.lotNos[0] ?? '';
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
          </span>
        }
        actions={
          <>
            <Button icon="trace" disabled title={EXAMPLE_LOT_HINT}>
              LOT 추적
            </Button>
            <Button icon="history" disabled title={EXAMPLE_LOT_HINT}>
              작업 로그
            </Button>
          </>
        }
      />

      <ResultSummary results={results} onSelect={onSelect} />

      <div className="grid min-h-0 flex-none grid-cols-[1.1fr_1fr] gap-3.5">
        <Card petKey="card:pastCases.history">
          <CardHead title="사례 작업 로그" meta={`${lotNo} · ${history.length}건`} />
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

        <Card petKey="card:pastCases.detail">
          <CardHead title="이 사례" meta={`작성 품질 담당 · ${item.occurredDate}`} />
          <CardBody>
            <div data-pet-item="pastCase" data-pet-item-title={item.caseNo}>
              <KvList
                items={[
                  { label: '구분', value: CASE_CATEGORY_LABEL[item.caseCategory] },
                  { label: '관련 LOT', value: <span className="font-mono text-sm">{item.lotNos.join(', ')}</span> },
                  { label: '관련 설비', value: item.equipmentText },
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
                </b> {item.cause}
              </p>
              <p>
                <b data-pet-term="조치" className="font-semibold text-ink">
                  조치
                </b> {item.actionTaken}
              </p>
            </div>
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
                  <em className="ml-auto text-cap text-ink-3 not-italic">{other.occurredDate}</em>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="flex-none">
        <CardHead title="과거 사례를 찾는 곳" meta="이 화면 밖에서도 같은 검색을 불러요" />
        <CardBody>
          <ul className="grid grid-cols-3 gap-2.5">
            {CASE_CALL_SITES.map((site) => (
              <li key={site.key} className="flex flex-col gap-1 rounded-sm border border-line bg-surface-2 px-3 py-2.5">
                <span className="flex items-center gap-1.5">
                  <b className="text-sm font-semibold">{site.place}</b>
                  {site.ready ? null : <ComingSoon grade="EX" />}
                </span>
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
  const [category, setCategory] = useState<CaseCategoryFilter>('ALL');
  const [period, setPeriod] = useState<CasePeriod>('ALL');
  const [selectedNo, setSelectedNo] = useState<string | null>(null);

  // 품질 화면의 '비슷한 사례 찾기'로 이 화면에 있는 채 다시 오면 주소의 검색어로 바꾼다
  useEffect(() => {
    setQuery(initialQuery);
    setSelectedNo(null);
  }, [initialQuery]);

  const results = useMemo(() => searchPastCases({ query, category, period, today: todayStr() }), [query, category, period]);
  // 고른 사례가 결과에서 빠지면 결과의 첫 사례를 보인다
  const selected = results.find((item) => item.caseNo === selectedNo) ?? results[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ExampleNotice text="사례 DB가 아직 없어 예시 사례 5건에서 찾아요. 실제 사례가 아니에요." />
      <div className="flex min-h-0 flex-1 gap-4">
        <ResultList
          query={query}
          category={category}
          period={period}
          results={results}
          selectedNo={selected?.caseNo ?? null}
          onQueryChange={setQuery}
          onCategoryChange={setCategory}
          onPeriodChange={setPeriod}
          onSelect={setSelectedNo}
        />
        {selected ? (
          <CaseDetail item={selected} results={results} onSelect={setSelectedNo} />
        ) : (
          <div className="flex min-w-0 flex-1">
            <StateView kind="empty" title="맞는 사례가 없어요" text="핵심어를 줄이거나 구분·기간을 풀어 보세요." />
          </div>
        )}
      </div>
    </div>
  );
}
