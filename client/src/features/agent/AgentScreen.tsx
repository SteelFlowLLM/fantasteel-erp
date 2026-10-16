'use client';

// AI Factory Agent (REQ-AGT-001~006, BP-AGT-01). 규칙이 감지해 만든 대응 후보를 담당 부서원이 후보별로 확정·반려한다.
// AI는 상황 설명만 하고 후보를 정하지 않는다. 납기 위험·불합격률 상승은 후보 없이 알림만 보내므로 이 목록에 없다.
import { Fragment, useMemo, useState } from 'react';
import type { AgentCandidateView, AgentExplainView, AgentRiskType } from '@fantasteel/shared';
import { ACTION_TYPE_LABEL, DRAFT_STATUS_LABEL, ERROR_MESSAGE, isErrorCode, PERMISSION_LABEL } from '@/codes';
import { agentCandidateApi } from '@/api/agentCandidates';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Textarea } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { Modal } from '@/components/Modal';
import { PageHead } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { StateView } from '@/components/StateView';
import { Tag } from '@/components/Tag';
import { AiCard, MasterItem } from '@/features/agent/components/SoonExampleParts';
import {
  CANDIDATE_RISKS,
  CONFIRM_PERMISSION,
  RISK_NAME,
  STATUS_TONE,
  evidenceLabelOf,
  isConfirmable,
  isOpenCandidate,
  recommendationsOf,
  sortCandidates,
} from '@/features/agent/lib/agentDisplay';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useAction } from '@/hooks/useAction';
import { useAgentCandidates } from '@/hooks/useAgentCandidates';
import { useCanUse } from '@/hooks/usePermission';
import { fmtMDHM } from '@/lib/format';

const REASON_MAX = 500;

export function AgentScreen() {
  useShellTitle('AI Factory Agent', '위험 감지 · 대응 후보');
  const query = useAgentCandidates();
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <QueryBoundary query={query} loadingLabel="대응 후보를 불러오는 중…">
        {(list) => <AgentBoard candidates={sortCandidates(list)} />}
      </QueryBoundary>
    </div>
  );
}

function AgentBoard({ candidates }: { candidates: AgentCandidateView[] }) {
  const [risk, setRisk] = useState<AgentRiskType | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const visible = useMemo(() => candidates.filter((c) => risk === null || c.riskType === risk), [candidates, risk]);
  const selected = visible.find((c) => c.id === selectedId) ?? visible[0] ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-4">
      <CandidateList candidates={candidates} visible={visible} risk={risk} onRisk={setRisk} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-auto">
        {selected ? <CandidateDetail key={selected.id} candidate={selected} onSelect={setSelectedId} /> : <EmptyDetail hasAny={candidates.length > 0} />}
      </div>
    </div>
  );
}

function CandidateList({
  candidates,
  visible,
  risk,
  onRisk,
  selectedId,
  onSelect,
}: {
  candidates: AgentCandidateView[];
  visible: AgentCandidateView[];
  risk: AgentRiskType | null;
  onRisk: (risk: AgentRiskType | null) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const openCount = candidates.filter(isOpenCandidate).length;
  return (
    <section aria-label="대응 후보 목록" data-pet-target="card:agent.detections" data-pet-perch="" className="flex min-h-0 w-80 flex-none flex-col rounded-md border border-line bg-surface shadow-1">
      <div className="flex flex-col gap-2.5 border-b border-line px-4 pt-3.5 pb-2.5">
        <div className="flex items-center gap-2">
          <Icon name="radar" className="text-steelman" />
          <b className="text-base font-semibold">대응 후보 {openCount}건</b>
          <span className="text-cap text-ink-3">확정 대기</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={risk === null} onClick={() => onRisk(null)}>
            전체 <b>{candidates.length}</b>
          </Chip>
          {CANDIDATE_RISKS.map((type) => (
            <Chip key={type} on={risk === type} onClick={() => onRisk(type)} data-pet-term={RISK_NAME[type]}>
              {RISK_NAME[type]} <b>{candidates.filter((c) => c.riskType === type).length}</b>
            </Chip>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">보여 줄 대응 후보가 없어요.</p>
        ) : (
          visible.map((c) => (
            <button key={c.id} type="button" onClick={() => onSelect(c.id)} className="block w-full text-left">
              <MasterItem active={c.id === selectedId} muted={!isOpenCandidate(c)} petItem="actionDraft" petTitle={RISK_NAME[c.riskType]}>
                <div className="flex items-center gap-2">
                  <b className="text-sm font-semibold">{RISK_NAME[c.riskType]}</b>
                  <Tag size="sm" tone="outline">
                    {ACTION_TYPE_LABEL[c.actionType]}
                  </Tag>
                  <span className="ml-auto text-cap text-ink-3 tabular-nums">{fmtMDHM(c.createdAt)}</span>
                </div>
                <span className="text-xs text-ink-2">{c.summary}</span>
                <div>
                  <Badge tone={STATUS_TONE[c.draftStatus]}>{DRAFT_STATUS_LABEL[c.draftStatus]}</Badge>
                </div>
              </MasterItem>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function EmptyDetail({ hasAny }: { hasAny: boolean }) {
  return (
    <StateView
      kind="empty"
      title={hasAny ? '이 유형의 대응 후보가 없어요' : '아직 감지된 대응 후보가 없어요'}
      text="규칙이 위험을 감지하면 대응 후보가 여기에 생겨요. 같은 대상의 처리 전 후보가 있으면 새로 만들지 않아요."
    />
  );
}

function CandidateDetail({ candidate, onSelect }: { candidate: AgentCandidateView; onSelect: (id: number) => void }) {
  const [explain, setExplain] = useState<AgentExplainView | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const permission = CONFIRM_PERMISSION[candidate.actionType];
  const canConfirm = useCanUse(...(permission ? [permission] : []));
  const confirmable = isConfirmable(candidate);
  const explainAction = useAction(agentCandidateApi.explain, { onSuccess: setExplain });
  const confirmAction = useAction(agentCandidateApi.confirm, {
    success: (result) => (result.executed ? executedMessageOf(result.draft) : '확정했지만 실행하지 못했어요'),
    onSuccess: (result) => {
      // 확정하면 목록 순서가 바뀌므로, 방금 처리한 후보를 계속 보여 결과(만들어진 업무)를 확인할 수 있게 한다
      onSelect(candidate.id);
      setFailure(result.executed ? null : `${result.errorMessage ?? '실행하지 못했어요'}${result.errorCode ? ` (${result.errorCode})` : ''}`);
    },
  });

  return (
    <>
      <PageHead
        crumb={
          <>
            AI Factory Agent
            <Icon name="chevron-right" size="sm" />
            {RISK_NAME[candidate.riskType]}
          </>
        }
        title={
          <span className="flex items-center gap-2">
            {RISK_NAME[candidate.riskType]}
            <Badge tone={STATUS_TONE[candidate.draftStatus]}>{DRAFT_STATUS_LABEL[candidate.draftStatus]}</Badge>
          </span>
        }
      />

      <AiCard tone="steelman" title="상황 설명" className="flex-none" petKey="card:agent.situation">
        <p className="text-base leading-normal">{explain?.explanation ?? candidate.summary}</p>
        <KvList columns={1} items={Object.entries(candidate.evidence).map(([key, value]) => ({ label: evidenceLabelOf(key), value: value ?? '-' }))} />
        <div className="flex items-center gap-2 border-t border-steelman-shadow pt-3">
          <Button size="sm" variant="steelman-outline" icon="info" disabled={explainAction.isPending} onClick={() => explainAction.mutate({ id: candidate.id })}>
            {explain ? '다시 설명 받기' : 'AI에게 상황 설명 받기'}
          </Button>
          {explain ? <Tag size="sm">{explain.generatedByAi ? 'AI가 작성' : '규칙 요약 (AI 연결 없음)'}</Tag> : null}
        </div>
      </AiCard>

      {failure ? (
        <Banner tone="danger" icon="alert">
          {failure}
        </Banner>
      ) : null}
      {candidate.executionErrorCode ? (
        <Banner tone="danger" icon="alert">
          확정했지만 실행하지 못했어요: {isErrorCode(candidate.executionErrorCode) ? ERROR_MESSAGE[candidate.executionErrorCode] : candidate.executionErrorCode} (시도 {candidate.executionAttemptCount}회)
        </Banner>
      ) : null}

      <AiCard tone="steelman" icon="cart" title={`대응 후보 · ${ACTION_TYPE_LABEL[candidate.actionType]}`} className="flex-none" petKey="card:agent.candidate">
        <CandidateBody candidate={candidate} />
        <KvList
          items={[
            { label: '확정', value: permission ? `${PERMISSION_LABEL[permission]} 사용 권한이 있는 부서원` : '-' },
            { label: '확정한 사람', value: candidate.confirmerName ?? '아직 없어요' },
            ...(candidate.confirmedAt ? [{ label: '확정 시각', value: fmtMDHM(candidate.confirmedAt) }] : []),
            ...(candidate.rejectReason ? [{ label: '닫은 이유', value: candidate.rejectReason }] : []),
            ...(candidate.actionType === 'PURCHASE_REQUISITION_CREATE' ? [{ label: '최종 승인', value: '확정한 사람 소속 부서장' }] : []),
          ]}
        />
        <div className="flex items-center gap-2 border-t border-steelman-shadow pt-3">
          {confirmable ? (
            <>
              <Button
                size="sm"
                variant="primary"
                icon="check"
                disabled={!canConfirm || confirmAction.isPending}
                title={canConfirm ? undefined : `${permission ? PERMISSION_LABEL[permission] : '해당 업무'} 사용 권한이 있는 부서원만 확정할 수 있어요`}
                onClick={() => confirmAction.mutate({ id: candidate.id, expectedUpdatedAt: candidate.updatedAt })}
              >
                확정
              </Button>
              <Button size="sm" disabled={!canConfirm} onClick={() => setRejecting(true)}>
                반려
              </Button>
            </>
          ) : null}
          <ResultLink candidate={candidate} />
        </div>
      </AiCard>

      {rejecting ? <RejectModal candidate={candidate} onSelect={onSelect} onClose={() => setRejecting(false)} /> : null}
    </>
  );
}

/** 확정한 뒤 안내 문구: 만들어진 업무 번호를 보인다 */
function executedMessageOf(draft: AgentCandidateView): string {
  if (draft.result?.kind === 'PURCHASE_REQUISITION') return `구매요청 ${draft.result.no}을 만들었어요. 부서장 승인을 기다려요`;
  if (draft.result?.kind === 'PRODUCTION_PLAN') return `재생산 계획 ${draft.result.no}을 만들었어요`;
  return '추천을 확인했어요. 재고·출하요청 화면에서 이어서 처리해 주세요';
}

function CandidateBody({ candidate }: { candidate: AgentCandidateView }) {
  const p = candidate.payload;
  if (candidate.actionType === 'PURCHASE_REQUISITION_CREATE') {
    return (
      <KvList
        items={[
          { label: '원료', value: String(candidate.evidence.itemCode ?? '-') },
          { label: '수량', value: `${String(p.requestedTon ?? '-')} t` },
          { label: '희망 입고일', value: String(p.desiredReceiptDate ?? '-') },
          { label: '근거 생산계획', value: String(candidate.evidence.productionPlanNo ?? '-') },
        ]}
      />
    );
  }
  if (candidate.actionType === 'REPRODUCTION_PLAN_CREATE') {
    return (
      <KvList
        items={[
          { label: '수주', value: `${String(candidate.evidence.salesOrderNo ?? '-')} · ${String(candidate.evidence.lineNo ?? '-')}번 품목` },
          { label: '추가 계획 필요', value: `${String(p.additionalPlanQty ?? '-')}매` },
        ]}
      />
    );
  }
  const recommendations = recommendationsOf(p);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-cap text-ink-3">대기 수주 (납기 빠른 순). 추천만 하고, 실제 예약·배정은 재고와 출하요청 화면에서 해요.</span>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {recommendations.map((r) => (
          <Fragment key={r.salesOrderItemId}>
            <dt className="text-ink-3">
              {r.salesOrderNo} · {r.lineNo}번 품목
            </dt>
            <dd className="m-0 text-ink-2">
              납기 {r.dueDate} · 미확보 {r.unsecuredQty}매
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function ResultLink({ candidate }: { candidate: AgentCandidateView }) {
  if (candidate.result?.kind === 'PURCHASE_REQUISITION') {
    return (
      <ButtonLink href="/purchase-requisitions" size="sm" icon="cart">
        구매요청 {candidate.result.no}
      </ButtonLink>
    );
  }
  if (candidate.result?.kind === 'PRODUCTION_PLAN') {
    return (
      <ButtonLink href="/production/plans" size="sm" icon="calendar">
        생산계획 {candidate.result.no}
      </ButtonLink>
    );
  }
  if (candidate.actionType === 'ALLOCATION_CONFIRM') {
    return (
      <ButtonLink href="/inventories" size="sm" icon="stock">
        재고에서 보기
      </ButtonLink>
    );
  }
  return null;
}

function RejectModal({ candidate, onSelect, onClose }: { candidate: AgentCandidateView; onSelect: (id: number) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const reject = useAction(agentCandidateApi.reject, {
    success: '대응 후보를 반려했어요',
    onSuccess: () => {
      onSelect(candidate.id);
      onClose();
    },
  });
  const trimmed = reason.trim();
  return (
    <Modal
      title="대응 후보 반려"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="danger" disabled={trimmed === '' || reject.isPending} onClick={() => reject.mutate({ id: candidate.id, rejectReason: trimmed, expectedUpdatedAt: candidate.updatedAt })}>
            반려
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-ink-2">{candidate.summary}</p>
      <Textarea aria-label="반려 사유" value={reason} maxLength={REASON_MAX} placeholder="반려 사유를 입력해 주세요" onChange={(e) => setReason(e.target.value)} />
      <span className="text-cap text-ink-3">
        {reason.length}/{REASON_MAX}
      </span>
    </Modal>
  );
}
