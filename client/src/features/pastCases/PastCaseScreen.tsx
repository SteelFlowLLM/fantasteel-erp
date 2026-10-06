// 과거 사례 검색 (EX 준비 중). 옛 B안 화면의 구성을 남기고 내용은 고정 예시다. 기능·검색·데이터 변경 없음.
// 고친 점 (reports/6 C-1·C-5, PLAN 7장): 부르는 곳을 REQ-CASE-004(AI 패널·@AI·품질 관리 버튼)로 맞추고, '비슷한 사례 찾기'는 품질 관리 몫으로 옮김.
// 작업 로그 주체는 사용자만(AI 주체 없음), 이벤트는 REQ-LOG-002 목록만, LOT 번호는 9.2 형식, 같은 종류 사례는 같은 구분끼리.
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ComingSoon, ComingSoonArea } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { PageHead } from '@/components/Page';
import { Steps } from '@/components/Steps';
import { Timeline } from '@/components/Timeline';
import { CASE_CATEGORY_LABEL, type CaseCategory } from '@/codes';
import {
  ActorTag,
  AiAssistedTag,
  AiCard,
  EventName,
  ExampleNotice,
  MasterItem,
  SourceList,
} from '@/features/agent/components/SoonExampleParts';
import {
  CASE_CALL_SITES,
  CASE_REGISTER_STEPS,
  EXAMPLE_QUERY,
  PAST_CASES,
  SELECTED_CASE,
  SELECTED_CASE_HISTORY,
  sameCategoryCases,
} from '@/features/pastCases/pastCaseExample';
import { businessEventLabelOf } from '@/features/agent/lib/businessEventLabel';

function CategoryBadge({ category }: { category: CaseCategory }) {
  return <Badge tone={category === 'QUALITY' ? 'run' : 'wait'}>{CASE_CATEGORY_LABEL[category]}</Badge>;
}

function ResultList() {
  return (
    <section aria-label="검색 결과 목록" className="flex min-h-0 w-80 flex-none flex-col rounded-md border border-line bg-surface shadow-1">
      <div className="flex flex-col gap-2.5 border-b border-line px-4 pt-3.5 pb-2.5">
        <Input type="search" leadingIcon="search" defaultValue={EXAMPLE_QUERY} aria-label="검색어" disabled />
        <div className="flex flex-wrap gap-1.5">
          <Chip on>
            기간 90일 <Icon name="chevron-down" size="sm" />
          </Chip>
          <Chip>
            구분 전체 <Icon name="chevron-down" size="sm" />
          </Chip>
        </div>
        <span className="text-cap text-ink-3">비슷한 사례 {PAST_CASES.length}건 · 최신순</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {PAST_CASES.map((item) => (
          <MasterItem key={item.caseNo} active={item.caseNo === SELECTED_CASE.caseNo}>
            <div className="flex items-center gap-2">
              <span className="text-cap text-ink-3 tabular-nums">{item.occurredDate}</span>
              <span className="truncate font-mono text-xs">{item.lotNos[0]}</span>
              <CategoryBadge category={item.caseCategory} />
            </div>
            <span className="text-xs leading-snug">
              <span className="font-mono text-ink-3">{item.caseNo}</span> · {item.title}
            </span>
          </MasterItem>
        ))}
      </div>
      <div className="flex flex-none flex-col gap-1 border-t border-line bg-surface-2 px-4 py-3 text-cap text-ink-3">
        <span>한국어 전문검색으로 비슷한 사례를 찾고 AI가 요약해요.</span>
        <span>사례 번호 형식은 아직 정하지 않았어요 (예시 표기).</span>
      </div>
    </section>
  );
}

function CaseDetail() {
  const others = sameCategoryCases(SELECTED_CASE);
  const lotNo = SELECTED_CASE.lotNos[0] ?? '';
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
            {SELECTED_CASE.caseNo} · {SELECTED_CASE.title}
            <CategoryBadge category={SELECTED_CASE.caseCategory} />
          </span>
        }
        actions={
          <>
            <Button icon="trace" disabled>
              LOT 추적
            </Button>
            <Button icon="history" disabled>
              작업 로그
            </Button>
          </>
        }
      />

      <AiCard
        title="AI 요약 · 검색 결과 전체"
        meta={`결과 ${PAST_CASES.length}건 기준 · 예시`}
        actions={
          <span className="inline-flex items-center gap-1 text-cap text-ink-3">
            <Icon name="info" size="sm" />
            AI 요약은 참고용 · 판단은 원본 사례로 확인
          </span>
        }
        className="flex-none"
      >
        <p className="text-base leading-normal">
          &ldquo;{EXAMPLE_QUERY}&rdquo;와 비슷한 사례 {PAST_CASES.length}건을 찾았어요. 성분 불합격은 합금철 투입량 편차나 온도 측정 오차가 원인인
          경우가 많았고, 투입량·측정값을 다시 확인하도록 조치했어요. 표면 결함은 열연·연주 조건과 함께 살펴본 사례가 있어요.
        </p>
        <SourceList
          label="출처 · 사례 번호"
          items={PAST_CASES.slice(0, 4).map((item) => ({ icon: 'link' as const, label: <span className="font-mono">{item.caseNo}</span> }))}
        />
      </AiCard>

      <div className="grid min-h-0 flex-none grid-cols-[1.1fr_1fr] gap-3.5">
        <Card>
          <CardHead title="사례 작업 로그" meta={`${lotNo} · ${SELECTED_CASE_HISTORY.length}건`} />
          <CardBody className="pb-1">
            <Timeline
              items={SELECTED_CASE_HISTORY.map((entry) => ({
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
            <Steps items={CASE_REGISTER_STEPS.map((label) => ({ key: label, label, state: 'done' as const }))} />
          </div>
        </Card>

        <Card>
          <CardHead title="이 사례" meta={`작성 품질 담당 · ${SELECTED_CASE.occurredDate}`} />
          <CardBody>
            <KvList
              items={[
                { label: '구분', value: CASE_CATEGORY_LABEL[SELECTED_CASE.caseCategory] },
                { label: '관련 LOT', value: <span className="font-mono text-sm">{SELECTED_CASE.lotNos.join(', ')}</span> },
                { label: '관련 설비', value: SELECTED_CASE.equipmentText },
                { label: '발생일', value: SELECTED_CASE.occurredDate },
              ]}
            />
            <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-xs leading-relaxed text-ink-2">
              <p>
                <b className="font-semibold text-ink">현상</b> {SELECTED_CASE.phenomenon}
              </p>
              <p>
                <b className="font-semibold text-ink">원인</b> {SELECTED_CASE.cause}
              </p>
              <p>
                <b className="font-semibold text-ink">조치</b> {SELECTED_CASE.actionTaken}
              </p>
            </div>
            <div className="flex flex-col gap-1.5 border-t border-line pt-3">
              <span className="text-xs font-semibold">같은 구분의 다른 사례</span>
              {others.map((item) => (
                <span key={item.caseNo} className="flex items-center gap-1.5 text-xs text-ink-2">
                  <Icon name="link" size="sm" className="text-ink-3" />
                  <span className="font-mono">{item.caseNo}</span>
                  <span className="truncate">{item.title}</span>
                  <em className="ml-auto text-cap text-ink-3 not-italic">{item.occurredDate}</em>
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="flex-none">
        <CardHead title="과거 사례를 찾는 곳" meta="이 화면 밖에서도 같은 검색을 불러요" actions={<ComingSoon grade="EX" />} />
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
  return (
    <ComingSoonArea grade="EX" title="과거 사례 검색">
      <ExampleNotice text="아래 내용은 화면 구성을 보여 주는 예시예요. 실제 사례가 아니에요." />
      <div className="flex min-h-0 flex-1 gap-4">
        <ResultList />
        <CaseDetail />
      </div>
    </ComingSoonArea>
  );
}
