// AI Factory Agent (P2 준비 중). 옛 B안 화면의 구성을 남기고 내용은 고정 예시다. 기능·데이터 변경 없음.
// 고친 점 (reports/6 C-5, PLAN 7장): 대응 후보는 담당 부서원이 확정(확정자 = 요청자), 구매요청이면 요청자 소속 부서장이 최종 승인.
// 작업 로그 주체는 사용자/시스템만, 번호는 9.1·9.2 형식, 강종은 SM355A~D, 코드 원문 대신 공통 코드 표시명.
import { Fragment } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ComingSoonArea, SoonButton } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { KvList } from '@/components/KvList';
import { PageHead } from '@/components/Page';
import { Steps } from '@/components/Steps';
import { Tag } from '@/components/Tag';
import { Timeline } from '@/components/Timeline';
import { ACTION_TYPE_LABEL, DRAFT_STATUS_LABEL, PERMISSION_LABEL, PERMISSION_LEVEL, PERMISSION_LEVEL_LABEL } from '@/codes';
import {
  ActorTag,
  AiBrief,
  AiCard,
  DaySeparator,
  EventName,
  ExampleNotice,
  Figure,
  LockHint,
  MasterItem,
  OriginLine,
  SourceList,
} from '@/features/agent/components/SoonExampleParts';
import {
  AGENT_DETECTIONS,
  AGENT_HISTORY,
  AGENT_RESOLVED_EXAMPLE,
  AGENT_RISK_NAME,
  AGENT_RULES,
  AGENT_TRIGGER_NAME,
  CANDIDATE_FLOW,
  DRAFT_FLOW,
  EXAMPLE_NO,
  RAW_SHORTAGE_CANDIDATE,
  RAW_SHORTAGE_METRICS,
  agentRuleOf,
  draftStepState,
} from '@/features/agent/agentExample';
import { businessEventLabelOf } from '@/features/agent/lib/businessEventLabel';

function DetectionList() {
  const selectedKey = AGENT_DETECTIONS[0]?.key;
  return (
    <section aria-label="감지 목록" className="flex min-h-0 w-80 flex-none flex-col rounded-md border border-line bg-surface shadow-1">
      <div className="flex flex-col gap-2.5 border-b border-line px-4 pt-3.5 pb-2.5">
        <div className="flex items-center gap-2">
          <Icon name="radar" className="text-ai" />
          <b className="text-base font-semibold">감지 {AGENT_DETECTIONS.length}건</b>
          <span className="text-cap text-ink-3">위험 유형마다 1건 · 예시</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip on>
            전체 <b>{AGENT_DETECTIONS.length}</b>
          </Chip>
          {AGENT_DETECTIONS.map((detection) => (
            <Chip key={detection.key}>
              {AGENT_RISK_NAME[detection.riskCode]} <b>1</b>
            </Chip>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {AGENT_DETECTIONS.map((detection, index) => {
          const rule = agentRuleOf(detection.riskCode);
          return (
            <MasterItem key={detection.key} active={detection.key === selectedKey}>
              <div className="flex items-center gap-2">
                <b className="text-sm font-semibold">
                  {index + 1}. {AGENT_RISK_NAME[detection.riskCode]}
                </b>
                <Tag size="sm" tone="outline">
                  {AGENT_TRIGGER_NAME[rule.trigger]}
                </Tag>
                <span className="ml-auto text-cap text-ink-3 tabular-nums">{detection.detectedAt}</span>
              </div>
              <span className="text-xs text-ink-2">{detection.title}</span>
              <div className="flex min-w-0 items-center gap-1.5">
                {detection.candidateCount ? (
                  <Badge tone="ai" plain>
                    대응 후보 {detection.candidateCount}
                  </Badge>
                ) : (
                  <Tag size="sm">대응 후보 없음</Tag>
                )}
                <span className="truncate text-cap text-ink-3">{rule.response}</span>
              </div>
            </MasterItem>
          );
        })}
        <DaySeparator>확정 전에 해소됨</DaySeparator>
        <MasterItem muted>
          <div className="flex items-center gap-2">
            <Badge tone="ok">해소</Badge>
            <b className="text-sm font-semibold">{AGENT_RISK_NAME[AGENT_RESOLVED_EXAMPLE.riskCode]}</b>
          </div>
          <span className="text-xs text-ink-2">{AGENT_RESOLVED_EXAMPLE.title}</span>
          <span className="text-cap text-ink-3">{AGENT_RESOLVED_EXAMPLE.note}</span>
        </MasterItem>
        <div className="flex flex-col gap-2 px-4 py-3.5">
          <span className="text-cap font-semibold text-ink-3">감지 트리거 · 규칙과 대응</span>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
            {AGENT_RULES.map((rule) => (
              <Fragment key={rule.riskCode}>
                <dt className="text-ink-3">
                  {AGENT_RISK_NAME[rule.riskCode]}
                  <span className="ml-1 text-2xs">({AGENT_TRIGGER_NAME[rule.trigger]})</span>
                </dt>
                <dd className="m-0 text-ink-2">
                  {rule.condition} → <b className="font-semibold">{rule.response}</b>
                </dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function CandidateCard() {
  const rule = agentRuleOf('RAW_SHORTAGE');
  const confirmPermission = rule.confirmPermission ? PERMISSION_LABEL[rule.confirmPermission] : '';
  return (
    <AiCard
      icon="cart"
      title={`대응 후보 1 · ${ACTION_TYPE_LABEL[RAW_SHORTAGE_CANDIDATE.actionType]}`}
      meta="규칙으로 생성 · Action Draft"
      actions={<Badge tone="wait">{DRAFT_STATUS_LABEL[RAW_SHORTAGE_CANDIDATE.draftStatus]}</Badge>}
      className="flex-none"
    >
      <div className="grid grid-cols-[1.1fr_1fr] gap-4">
        <KvList
          items={[
            {
              label: '원료',
              value: (
                <>
                  {RAW_SHORTAGE_CANDIDATE.rawMaterial} <span className="font-mono text-xs text-ink-3">{RAW_SHORTAGE_CANDIDATE.rawMaterialCode}</span>
                </>
              ),
            },
            { label: '수량', value: `${RAW_SHORTAGE_CANDIDATE.requiredTon} t` },
            { label: '희망 입고일', value: RAW_SHORTAGE_CANDIDATE.desiredReceiptDate },
            { label: '확정', value: `구매 부서원 (${confirmPermission} ${PERMISSION_LEVEL_LABEL[PERMISSION_LEVEL.USE]} 권한)` },
            { label: '요청자', value: '확정한 사람' },
            { label: '최종 승인', value: '요청자 소속 부서장' },
          ]}
        />
        <div className="flex flex-col gap-2">
          <OriginLine icon="radar">Agent 감지 10-01 06:00 · 원료 부족 · 부족량 1,200 t 기준</OriginLine>
          <OriginLine icon="info">같은 대상의 미처리 초안이 있으면 새로 만들지 않아요.</OriginLine>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-sm bg-surface-2 px-3 py-2.5">
        <span className="flex-none text-cap text-ink-3">처리 순서</span>
        <Steps
          className="flex-1"
          items={CANDIDATE_FLOW.map((label, index) => ({ key: label, label, state: index === 0 ? 'run' : 'todo' }))}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="flex-none text-cap text-ink-3">초안 상태</span>
        <Steps
          items={DRAFT_FLOW.map((status) => ({
            key: status,
            label: DRAFT_STATUS_LABEL[status],
            state: draftStepState(status, RAW_SHORTAGE_CANDIDATE.draftStatus),
          }))}
        />
      </div>
      <div className="flex items-center gap-2 border-t border-ai-line pt-3">
        <SoonButton variant="primary" size="sm">
          <Icon name="check" />
          확정
        </SoonButton>
        <SoonButton size="sm">반려</SoonButton>
        <Button size="sm" icon="cart" disabled>
          구매요청 보기
        </Button>
        <LockHint className="ml-auto">AI는 데이터를 바꾸지 않아요 · 확정한 담당 부서원의 권한으로 실행돼요</LockHint>
      </div>
    </AiCard>
  );
}

function DetectionDetail() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-auto">
      <PageHead
        crumb={
          <>
            AI Factory Agent
            <Icon name="chevron-right" size="sm" />
            1. 원료 부족
          </>
        }
        title={
          <span className="flex items-center gap-2">
            원료 부족 · 철광석 (ORE01)
            <Tag tone="outline">{AGENT_TRIGGER_NAME.SCHEDULE}</Tag>
          </span>
        }
        actions={
          <SoonButton>
            <Icon name="history" />
            작업 로그
          </SoonButton>
        }
      />

      <AiBrief meta="감지 10-01 06:00 · 예시">
        <b>AI는 상황 설명만 해요.</b> 대응 후보는 규칙이 만들고, 담당 부서원이 후보별로 확정해요.
      </AiBrief>

      <AiCard title="상황 설명" meta="AI가 작성 · 데이터 변경 없음" className="flex-none">
        <p className="text-base leading-normal">
          <b className="font-semibold">철광석 1,200 t 부족 예상</b> — 생산계획{' '}
          <span className="font-mono text-sm">{EXAMPLE_NO.rawShortagePlans.join(' · ')}</span>의 소요량이 원료 잔량과 입고예정을 합친 양보다 많아요.
        </p>
        <div className="grid grid-cols-4 gap-2">
          {RAW_SHORTAGE_METRICS.map((metric) => (
            <Figure key={metric.label} label={metric.label} value={metric.value} unit={metric.unit} danger={metric.danger} />
          ))}
        </div>
        <SourceList
          caption="MRP 결과 기준 (소요량 − 원료 잔량 − 입고예정)"
          items={[
            { icon: 'calc', label: 'MRP 결과', note: '10-01 06:00' },
            { icon: 'box', label: '원료 재고', note: 'ORE01' },
            { icon: 'clipboard', label: '생산계획', note: EXAMPLE_NO.rawShortagePlans.join(' · ') },
          ]}
        />
      </AiCard>

      <CandidateCard />

      <div className="flex flex-none flex-col gap-1.5 rounded-md border border-dashed border-line-strong bg-surface-2 p-3">
        <div className="flex items-center gap-1.5">
          <Icon name="info" size="sm" className="text-ink-3" />
          <b className="text-sm font-semibold">대응 후보가 없는 유형은 이렇게 보여요 (예: 불합격률 상승)</b>
        </div>
        <span className="text-xs leading-snug text-ink-2">
          상황 설명과 함께 품질 부서에 알림만 보내요. 원인 분석과 조치는 품질 담당이 판단해요.
        </span>
      </div>

      <Card className="flex-none">
        <CardHead title="감지 이력" meta={`이 감지의 작업 로그 · 다음 단계 포함 ${AGENT_HISTORY.length}건`} />
        <CardBody className="pb-1">
          <Timeline
            items={AGENT_HISTORY.map((entry) => ({
              key: entry.key,
              tone: entry.pending ? 'neutral' : entry.key === 'detected' ? 'danger' : 'ai',
              title: (
                <span className={entry.pending ? 'flex flex-wrap items-center gap-1.5 text-ink-3' : 'flex flex-wrap items-center gap-1.5'}>
                  <ActorTag actorType={entry.actorType} />
                  <EventName>{businessEventLabelOf(entry.businessEventType)}</EventName>
                  <b className="font-semibold">{entry.head}</b>
                  {entry.eventNo ? <span className="font-mono text-cap text-ink-3">{entry.eventNo}</span> : null}
                </span>
              ),
              time: entry.time,
              body: <span className="text-cap text-ink-3">{entry.detail}</span>,
            }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}

export function AgentScreen() {
  return (
    <ComingSoonArea grade="P2" title="AI Factory Agent">
      <ExampleNotice />
      <div className="flex min-h-0 flex-1 gap-4">
        <DetectionList />
        <DetectionDetail />
      </div>
    </ComingSoonArea>
  );
}
