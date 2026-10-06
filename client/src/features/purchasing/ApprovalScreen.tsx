'use client';

// 승인함 (REQ-PUR-002, REQ-AUTH-004): 부서장만 연다(셸 화면 표). 내가 부서장인 부서의 승인 대기 구매요청을 승인·반려한다.
// 승인권자 = 요청 시점 요청자 소속 부서의 부서장. 부서장 본인 요청·부재 때의 경로는 문서에서 정해지지 않아(16장 TBD) 안내하지 않는다.
// Agent 대응 후보는 담당 부서원이 확정하는 것이라(REQ-AGT-006) 여기에 두지 않는다.
import { PERMISSION } from '@/codes';
import { Button, ButtonLink } from '@/components/Button';
import { MasterPane, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, StateView } from '@/components/StateView';
import { MasterItem, MasterNote, RequisitionSourceTag, RequisitionStatusBadge } from '@/features/purchasing/components/PurchasingParts';
import { RequisitionPanel } from '@/features/purchasing/components/RequisitionPanel';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { useApprovalInbox } from '@/hooks/useApprovals';
import { useMe } from '@/hooks/useMe';
import { useCanView } from '@/hooks/usePermission';
import { fmtMD, fmtMDHM, fmtTon } from '@/lib/format';

export function ApprovalScreen() {
  const me = useMe();
  const url = useUrlParams();
  const selectedId = url.getNumber('pr');
  const inbox = useApprovalInbox();
  // 상세 화면은 구매요청 조회 권한으로 연다(셸 화면 표). 권한이 없는 부서장은 이 화면 안에서 본다.
  const canOpenDetail = useCanView(PERMISSION.PURCHASE_REQUISITION_CREATE);
  const rows = inbox.data ?? [];
  const activeId = selectedId ?? rows[0]?.id ?? null;
  const activeIndex = rows.findIndex((purchaseRequisition) => purchaseRequisition.id === activeId);
  const next = activeIndex >= 0 ? rows[activeIndex + 1] : undefined;

  // 승인·반려한 요청은 목록에서 빠지므로 다음 요청으로 넘어간다 (주소에 없으면 첫 요청)
  const goNext = () => url.set({ pr: next?.id ?? null });

  return (
    <>
      <MasterPane
        head={
          <div className="flex items-center gap-2">
            <b className="text-base font-semibold">승인 대기</b>
            <span className="text-xs text-ink-3">{rows.length}건</span>
            <span className="ml-auto text-cap text-ink-3">{me.headDepartmentNames.join(', ')} 부서장</span>
          </div>
        }
      >
        <QueryBoundary query={inbox} loadingLabel="승인 대기 구매요청을 불러오는 중…">
          {(data) =>
            data.length === 0 ? (
              <EmptyNote>승인 대기 구매요청이 없어요</EmptyNote>
            ) : (
              <>
                {data.map((purchaseRequisition) => (
                  <MasterItem key={purchaseRequisition.id} selected={purchaseRequisition.id === activeId} onClick={() => url.set({ pr: purchaseRequisition.id })}>
                    <span className="flex items-center gap-2">
                      <b className="font-mono text-sm font-semibold">{purchaseRequisition.purchaseRequisitionNo}</b>
                      <RequisitionStatusBadge status={purchaseRequisition.purchaseRequisitionStatus} />
                      <span className="ml-auto text-cap text-ink-3">{purchaseRequisition.desiredReceiptDate ? `희망 ${fmtMD(purchaseRequisition.desiredReceiptDate)}` : ''}</span>
                    </span>
                    <span className="text-sm text-ink">
                      {purchaseRequisition.itemName} <span className="text-ink-3">· {fmtTon(purchaseRequisition.requestedTon)}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-cap text-ink-3">
                      {purchaseRequisition.requesterName ?? '-'} · {purchaseRequisition.departmentName ?? '-'} · 등록 {fmtMDHM(purchaseRequisition.createdAt)}
                      <RequisitionSourceTag source={purchaseRequisition.source} />
                    </span>
                  </MasterItem>
                ))}
              </>
            )
          }
        </QueryBoundary>
        <MasterNote>승인 요청은 요청자 소속 부서의 부서장에게 와요. 승인하면 구매 담당이 발주하고, 반려하면 요청자가 고쳐 다시 요청할 수 있어요.</MasterNote>
      </MasterPane>
      <PageMain>
        {activeId !== null ? (
          <RequisitionPanel
            key={activeId}
            requisitionId={activeId}
            crumb="승인함"
            onDecided={goNext}
            extraActions={
              <>
                {next ? (
                  <Button size="sm" icon="chevron-right" onClick={() => url.set({ pr: next.id })}>
                    다음 {next.purchaseRequisitionNo}
                  </Button>
                ) : null}
                {canOpenDetail ? (
                  <ButtonLink href={`/purchase-requisitions/${activeId}`} size="sm">
                    요청서 보기
                  </ButtonLink>
                ) : null}
              </>
            }
          />
        ) : inbox.data ? (
          <StateView
            kind="empty"
            icon="approve"
            title="승인할 항목이 없어요"
            text={`${me.headDepartmentNames.join(', ')} 부서장으로 지정돼 있어요. 부서원이 구매요청을 등록하면 여기에 올라와요`}
          />
        ) : null}
      </PageMain>
    </>
  );
}
