'use client';

// Message → ERP 구매요청 초안 /action-drafts/[id] (REQ-ACT-001~004, BP-ACT-01, 14.1 10단계)
// 왼쪽 = 내 초안(내가 요청자인 초안), 오른쪽 = 초안 확인·확정. 확정하면 구매요청이 만들어지고 부서장 승인을 따로 거친다.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DRAFT_STATUS_LABEL } from '@/codes';
import type { DraftDetailView } from '@/api/actionDrafts';
import { ApiError } from '@/api/client';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { StateView } from '@/components/StateView';
import { Steps } from '@/components/Steps';
import { Tag } from '@/components/Tag';
import { ActionTypeCard, ConfirmGuideCard, OriginMessageCard } from '@/features/actionDrafts/components/DraftAside';
import { DraftFormCard, type ConfirmFailure } from '@/features/actionDrafts/components/DraftFormCard';
import { MyDraftList } from '@/features/actionDrafts/components/MyDraftList';
import { getConfirmFailureTitle, DRAFT_STATUS_TONE, buildDraftFlowSteps, getExecutionFailure, getRequisitionStatusDisplay } from '@/features/actionDrafts/lib/draftDisplay';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useActionDraft } from '@/hooks/useActionDrafts';
import { fmtMDHM } from '@/lib/format';
import { withEulReul } from '@/lib/josa';

const parseDraftId = (value: string | string[] | undefined): number | null => {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export function ActionDraftScreen() {
  const params = useParams<{ id: string }>();
  const id = parseDraftId(params.id);
  const draft = useActionDraft(id);
  const notFound = id === null || (draft.error instanceof ApiError && draft.error.code === 'COM-003');

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <MyDraftList activeId={id} />
      <PageMain>
        {notFound ? (
          <StateView
            kind="empty"
            title="초안을 찾을 수 없어요"
            text="지워졌거나 잘못된 주소예요. 왼쪽 내 초안이나 메신저 메시지에서 다시 열어 주세요."
            actions={
              <ButtonLink href="/purchase-requisitions" size="sm" icon="cart">
                구매요청 목록
              </ButtonLink>
            }
          />
        ) : (
          <QueryBoundary query={draft} loadingLabel="초안을 불러오는 중…">
            {(view) => <DraftDetail key={view.id} draft={view} />}
          </QueryBoundary>
        )}
      </PageMain>
    </div>
  );
}

function DraftDetail({ draft }: { draft: DraftDetailView }) {
  useShellTitle(`초안 #${draft.id}`, `${draft.actionTypeLabel} · 요청자 ${draft.requester.employeeName}`);
  const [confirmFailure, setConfirmFailure] = useState<ConfirmFailure | null>(null);
  const status = draft.draftStatus;
  const failure = status === 'APPROVED' ? getExecutionFailure(draft.executionResult) : null;
  const purchaseRequisition = draft.purchaseRequisition;
  const purchaseRequisitionStatusView = purchaseRequisition ? getRequisitionStatusDisplay(purchaseRequisition.purchaseRequisitionStatus) : null;
  const name = draft.requester.employeeName;

  return (
    <>
      <PageHead
        crumb={
          <>
            {draft.message ? (
              <Link href={`/messenger?room=${draft.message.chatRoomId}`} className="hover:text-brand hover:underline">
                메신저
              </Link>
            ) : (
              <Link href="/purchase-requisitions" className="hover:text-brand hover:underline">
                구매요청
              </Link>
            )}
            <Icon name="chevron-right" size="sm" />
            Message → ERP
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            초안 #{draft.id}
            <Tag tone="brand">{draft.actionTypeLabel}</Tag>
            <Badge tone={DRAFT_STATUS_TONE[status]}>{DRAFT_STATUS_LABEL[status]}</Badge>
            <span className="text-cap font-normal text-ink-3">Message → ERP · {fmtMDHM(draft.createdAt)} 생성</span>
          </span>
        }
        actions={
          <>
            <ButtonLink href="/purchase-requisitions" icon="cart">
              구매요청 목록
            </ButtonLink>
            {draft.message ? (
              <ButtonLink href={`/messenger?room=${draft.message.chatRoomId}`} icon="chat">
                원본 메시지로 이동
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <Card className="flex-none">
        <div className="flex flex-wrap items-center gap-4 px-4 py-3">
          <Steps items={buildDraftFlowSteps(status)} className="min-w-[320px] flex-1" />
          <span aria-hidden="true" className="hidden h-6 w-px bg-line md:block" />
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-cap text-ink-3">{status === 'WAITING_APPROVAL' || status === 'AI_GENERATED' ? '다음' : '경로'}</span>
            <Avatar name={name} size="sm" />
            {name} 확정
            <Icon name="chevron-right" size="sm" className="text-ink-3" />
            구매요청 생성
            <Icon name="chevron-right" size="sm" className="text-ink-3" />
            <Avatar name="부" size="sm" tone="neutral" />
            부서장 승인
            <Icon name="chevron-right" size="sm" className="text-ink-3" />
            <Avatar name="구" size="sm" tone="neutral" />
            구매 발주
          </div>
        </div>
      </Card>

      {status === 'EXECUTED' && purchaseRequisition && purchaseRequisitionStatusView ? (
        <Banner
          tone="ok"
          actions={
            <ButtonLink href={`/purchase-requisitions/${purchaseRequisition.id}`} size="sm">
              구매요청 보기 <Icon name="chevron-right" size="sm" />
            </ButtonLink>
          }
        >
          <b>
            구매요청{' '}
            <Link href={`/purchase-requisitions/${purchaseRequisition.id}`} className="font-mono underline">
              {purchaseRequisition.purchaseRequisitionNo}
            </Link>
            {withEulReul(purchaseRequisition.purchaseRequisitionNo).slice(purchaseRequisition.purchaseRequisitionNo.length)} 만들었어요
          </b>{' '}
          <Badge tone={purchaseRequisitionStatusView.tone}>{purchaseRequisitionStatusView.label}</Badge>
          <div>
            {purchaseRequisition.purchaseRequisitionStatus === 'WAITING_APPROVAL'
              ? '이제 부서장 승인을 기다려요. 초안 확정과 구매요청 승인은 따로예요.'
              : '초안 확정은 끝났어요. 구매요청의 진행 상태는 구매요청 화면에서 볼 수 있어요.'}
          </div>
        </Banner>
      ) : null}
      {status === 'REJECTED' ? (
        <Banner tone="danger">
          <b>반려된 초안이에요</b> · {draft.rejectReason ?? '사유가 기록되지 않았어요'}
          <div className="text-cap">
            {name} · {fmtMDHM(draft.rejectedAt)} · 구매요청은 만들어지지 않았어요
          </div>
        </Banner>
      ) : null}
      {failure ? (
        <Banner tone="danger">
          <b>{getConfirmFailureTitle(failure.errorCode)}</b>
          <div>
            {failure.message}
            {failure.errorCode ? ` (${failure.errorCode})` : ''}
          </div>
          <div className="text-cap">
            시도 {failure.attempts}회 · 마지막 {fmtMDHM(draft.updatedAt)} · 원인을 고친 뒤 다시 실행할 수 있어요
          </div>
        </Banner>
      ) : null}
      {confirmFailure && !failure ? (
        <Banner tone="danger">
          <b>{confirmFailure.code === 'ACT-001' ? getConfirmFailureTitle('ACT-001') : confirmFailure.code === 'PUR-001' ? getConfirmFailureTitle('PUR-001') : '확정하지 못했어요'}</b>
          <div>
            {confirmFailure.message}
            {confirmFailure.code ? ` (${confirmFailure.code})` : ''}
            {confirmFailure.code === 'ACT-001' && confirmFailure.detail ? ` · 채워야 할 칸: ${confirmFailure.detail}` : confirmFailure.detail ? ` · ${confirmFailure.detail}` : ''}
          </div>
        </Banner>
      ) : null}

      <div className="grid flex-none grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <DraftFormCard draft={draft} failure={failure} onConfirmFailure={setConfirmFailure} />
        <div className="flex min-w-0 flex-col gap-4">
          <OriginMessageCard draft={draft} />
          <ConfirmGuideCard draft={draft} />
          <ActionTypeCard current={draft.actionType} />
        </div>
      </div>
    </>
  );
}
