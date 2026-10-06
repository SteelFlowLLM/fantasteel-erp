'use client';

// 구매요청 한 건 (목록 미리보기·상세 화면·승인함이 같이 쓴다).
// 진행 단계 · 반려 사유 · 요청 내용 · 출처(계산값) · 연결 발주 · 동작(요청자: 고쳐 다시 요청 / 요청 부서 부서장: 승인·반려).
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { PERMISSION } from '@/codes';
import { InputError } from '@/api/client';
import type { RequisitionDetail } from '@/api/purchasing';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Textarea } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { PageHead } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Steps, type StepItem } from '@/components/Steps';
import { Table, Td, Th } from '@/components/Table';
import { PurchaseOrderStatusBadge, RequisitionSourceTag, RequisitionStatusBadge } from '@/features/purchasing/components/PurchasingParts';
import { RequisitionFormModal } from '@/features/purchasing/components/RequisitionFormModal';
import { REQUISITION_SOURCE_LABEL, trimTonText } from '@/features/purchasing/lib/purchasingView';
import { useApproveRequisition, useRejectRequisition } from '@/hooks/useApprovals';
import { useCanUse, useCanView } from '@/hooks/usePermission';
import { usePurchaseRequisitionDetail } from '@/hooks/usePurchaseRequisitions';
import { fmtDate, fmtDateTime, fmtTon } from '@/lib/format';
import { decCmp, decSum } from '@/lib/decimal';
import { permissionNeedText } from '@/lib/permissions';
import { errorMessageOf } from '@/stores/useToastStore';

export interface RequisitionPanelProps {
  requisitionId: number;
  crumb?: ReactNode;
  /** 머리 오른쪽에 더 붙일 버튼 (상세 열기·다음 등) */
  extraActions?: ReactNode;
  /** 승인·반려가 끝났을 때 (승인함: 다음 요청으로) */
  onDecided?: () => void;
}

export function RequisitionPanel(props: RequisitionPanelProps) {
  const detail = usePurchaseRequisitionDetail(props.requisitionId);
  return <QueryBoundary query={detail} loadingLabel="구매요청을 불러오는 중…">{(data) => <RequisitionPanelBody {...props} detail={data} />}</QueryBoundary>;
}

function stepsOf(detail: RequisitionDetail): StepItem[] {
  const status = detail.purchaseRequisitionStatus;
  return [
    { key: 'registered', label: '등록', state: 'done' },
    { key: 'approval', label: status === 'REJECTED' ? '부서장 승인 · 반려' : '부서장 승인', state: status === 'WAITING_APPROVAL' || status === 'REJECTED' ? 'run' : 'done' },
    { key: 'ordered', label: '발주', state: status === 'ORDERED' ? 'done' : status === 'APPROVED' ? 'run' : 'todo' },
  ];
}

function stageText(detail: RequisitionDetail): string {
  switch (detail.purchaseRequisitionStatus) {
    case 'WAITING_APPROVAL':
      return `${detail.departmentHeadName ? `${detail.departmentName} 부서장 ${detail.departmentHeadName}` : '부서장'} 승인 대기 · 승인되면 구매 담당이 발주해요`;
    case 'APPROVED':
      return `${detail.approverName ?? '부서장'} 승인 ${fmtDateTime(detail.approvedAt)} · 발주 대기`;
    case 'REJECTED':
      return `${detail.approverName ?? '부서장'} 반려 ${fmtDateTime(detail.rejectedAt)} · 요청자가 고쳐 다시 요청할 수 있어요`;
    case 'ORDERED':
      return `발주 완료 · ${[...new Set(detail.purchaseOrderLines.map((l) => l.purchaseOrderNo))].join(', ')}`;
  }
}

function RequisitionPanelBody({ detail, crumb, extraActions, onDecided }: RequisitionPanelProps & { detail: RequisitionDetail }) {
  const canCreate = useCanUse(PERMISSION.PURCHASE_REQUISITION_CREATE);
  const canConfirmPurchaseOrder = useCanUse(PERMISSION.PURCHASE_ORDER_CONFIRM);
  const canSeeOrders = useCanView(PERMISSION.PURCHASE_ORDER_CONFIRM, PERMISSION.GOODS_RECEIPT_CONFIRM, PERMISSION.PURCHASE_REQUISITION_CREATE);
  // 발주 화면(/purchase-orders)은 발주 확정 조회 이상만 열린다(shell screens.ts). 그 밖에는 발주번호를 글자로만 보인다.
  const canOpenPurchaseOrders = useCanView(PERMISSION.PURCHASE_ORDER_CONFIRM);
  const canSeeMrp = useCanView(PERMISSION.PURCHASE_REQUISITION_CREATE);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const approve = useApproveRequisition({ onSuccess: () => onDecided?.() });
  const reject = useRejectRequisition({
    onSuccess: () => {
      setRejecting(false);
      setRejectReason('');
      onDecided?.();
    },
    onError: (error) => {
      if (error instanceof InputError) setRejectError(error.fieldErrors.rejectReason ?? error.message);
      else setRejectError(errorMessageOf(error));
    },
  });

  const status = detail.purchaseRequisitionStatus;
  const orderedTotal = decSum(detail.purchaseOrderLines.map((l) => l.orderedTon));
  const receivedTotal = decSum(detail.purchaseOrderLines.map((l) => l.receivedTon));

  const submitReject = () => {
    if (!rejectReason.trim()) {
      setRejectError('반려하려면 사유를 입력해 주세요');
      return;
    }
    setRejectError(null);
    reject.mutate({ purchaseRequisitionId: detail.id, rejectReason, expectedUpdatedAt: detail.updatedAt });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={crumb}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{detail.purchaseRequisitionNo}</span>
            <RequisitionStatusBadge status={status} />
            <RequisitionSourceTag source={detail.source} />
          </span>
        }
        actions={
          <>
            {detail.sourceDraft ? (
              <ButtonLink href={`/action-drafts/${detail.sourceDraft.id}`} icon="chat" size="sm">
                초안 #{detail.sourceDraft.id} 보기
              </ButtonLink>
            ) : null}
            {status === 'APPROVED' && detail.purchaseOrderNo === null ? (
              canConfirmPurchaseOrder ? (
                <ButtonLink href={`/purchase-orders?pr=${detail.id}`} variant="primary" icon="building" size="sm">
                  발주 만들기
                </ButtonLink>
              ) : (
                <Button size="sm" icon="lock" disabled title={permissionNeedText([PERMISSION.PURCHASE_ORDER_CONFIRM])}>
                  발주 만들기
                </Button>
              )
            ) : null}
            {extraActions}
          </>
        }
      />
      <p className="-mt-2 text-sm text-ink-2">
        {detail.itemName} · <b className="font-semibold tabular-nums">{fmtTon(detail.requestedTon)}</b> · {detail.requesterName ?? '-'} · {fmtDateTime(detail.createdAt)} 등록
      </p>

      <Card>
        <CardBody className="gap-2">
          <Steps items={stepsOf(detail)} />
          <span className="text-xs text-ink-2">{stageText(detail)}</span>
        </CardBody>
      </Card>

      {status === 'REJECTED' ? (
        <Banner tone="danger">
          <b>반려 사유</b> · {detail.rejectReason ?? '사유가 기록되지 않았어요'}
        </Banner>
      ) : null}

      <Card>
        <CardHead title="요청 내용" meta={REQUISITION_SOURCE_LABEL[detail.source]} />
        <CardBody>
          <KvList
            items={[
              {
                label: '원료',
                value: (
                  <>
                    {detail.itemName} <span className="font-mono text-cap text-ink-3">{detail.itemCode}</span>
                  </>
                ),
              },
              { label: '수량(톤)', value: <span className="tabular-nums">{fmtTon(detail.requestedTon)}</span> },
              { label: '근거 생산계획', value: detail.productionPlanNo ? <span className="font-mono">{detail.productionPlanNo}</span> : <span className="text-ink-3">-</span> },
              { label: '발주', value: detail.purchaseOrderNo ? <span className="font-mono">{detail.purchaseOrderNo}</span> : <span className="text-ink-3">미발주</span> },
              { label: '희망 입고일', value: detail.desiredReceiptDate ? fmtDate(detail.desiredReceiptDate) : '-' },
              { label: '요청자', value: `${detail.requesterName ?? '-'}${detail.requesterJobGradeName ? ` ${detail.requesterJobGradeName}` : ''} · ${detail.departmentName ?? '-'}` },
              {
                label: '승인권자',
                value:
                  status === 'WAITING_APPROVAL'
                    ? detail.departmentHeadName
                      ? `${detail.departmentHeadName} (${detail.departmentName} 부서장)`
                      : '부서장이 지정되지 않았어요 (PUR-001)'
                    : (detail.approverName ?? '-'),
              },
              { label: '요청 근거', value: detail.requestReason ? <span className="whitespace-pre-wrap">{detail.requestReason}</span> : <span className="text-ink-3">-</span> },
              ...(detail.approvedAt ? [{ label: '승인 일시', value: fmtDateTime(detail.approvedAt) }] : []),
              ...(detail.rejectedAt ? [{ label: '반려 일시', value: fmtDateTime(detail.rejectedAt) }] : []),
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHead title="출처" meta={REQUISITION_SOURCE_LABEL[detail.source]} />
        <CardBody>
          {detail.source === 'MESSAGE' ? (
            detail.sourceDraft?.message ? (
              <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 px-3.5 py-3">
                <span className="text-cap text-ink-3">
                  {detail.sourceDraft.message.chatRoomName ?? '채팅방'} · {detail.sourceDraft.message.senderName ?? '-'} · {fmtDateTime(detail.sourceDraft.message.createdAt)}
                </span>
                <p className="text-sm whitespace-pre-wrap text-ink">“{detail.sourceDraft.message.content ?? ''}”</p>
                <span className="flex flex-wrap items-center gap-2 text-cap text-ink-3">
                  Message → ERP 초안 #{detail.sourceDraft.id} · 요청자 확정 {fmtDateTime(detail.sourceDraft.confirmedAt)}
                  <Link className="text-run hover:underline" href={`/messenger?room=${detail.sourceDraft.message.chatRoomId}`}>
                    채팅방으로 이동
                  </Link>
                </span>
              </div>
            ) : (
              <EmptyNote>Message → ERP 초안에서 만든 요청이에요. 원본 메시지를 불러올 수 없어요.</EmptyNote>
            )
          ) : detail.source === 'MRP' ? (
            <p className="text-sm text-ink-2">
              MRP 순소요로 등록한 요청이에요 · 근거 생산계획 <span className="font-mono">{detail.productionPlanNo}</span>
              {canSeeMrp ? (
                <>
                  {' · '}
                  <Link className="text-run hover:underline" href="/mrp">
                    MRP 보기
                  </Link>
                </>
              ) : null}
            </p>
          ) : (
            <p className="text-sm text-ink-2">요청자가 직접 등록한 요청이에요.</p>
          )}
        </CardBody>
      </Card>

      {canSeeOrders ? (
        <Card>
          <CardHead title="연결 발주" meta={detail.purchaseOrderLines.length > 0 ? `입고 ${fmtTon(receivedTotal)} / 발주 ${fmtTon(orderedTotal)}` : undefined} />
          <CardBody flush>
            {detail.purchaseOrderLines.length === 0 ? (
              <EmptyNote>{status === 'APPROVED' ? '아직 발주하지 않았어요. 구매 담당이 발주 화면에서 발주해요' : '승인된 뒤에 발주할 수 있어요'}</EmptyNote>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>발주번호</Th>
                    <Th>원료</Th>
                    <Th>공급업체</Th>
                    <Th align="right">발주</Th>
                    <Th align="right">입고</Th>
                    <Th align="right">입고예정</Th>
                    <Th>납기</Th>
                    <Th>상태</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.purchaseOrderLines.map((line) => (
                    <tr key={line.purchaseOrderId}>
                      <Td>
                        {canOpenPurchaseOrders ? (
                          <Link className="font-mono text-run hover:underline" href={`/purchase-orders?po=${line.purchaseOrderId}`}>
                            {line.purchaseOrderNo}
                          </Link>
                        ) : (
                          <span className="font-mono">{line.purchaseOrderNo}</span>
                        )}
                      </Td>
                      <Td>{line.itemName}</Td>
                      <Td>{line.supplierName}</Td>
                      <Td align="right">{fmtTon(line.orderedTon)}</Td>
                      <Td align="right">{fmtTon(line.receivedTon)}</Td>
                      <Td align="right" className={decCmp(line.scheduledReceiptTon, 0) > 0 ? 'font-semibold' : 'text-ink-3'}>
                        {fmtTon(line.scheduledReceiptTon)}
                      </Td>
                      <Td>{line.dueDate ? fmtDate(line.dueDate) : '-'}</Td>
                      <Td>
                        <PurchaseOrderStatusBadge status={line.purchaseOrderStatus} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHead title="처리" />
        <CardBody>
          {detail.canApprove ? (
            <div className="flex flex-col gap-3">
              <span className="text-sm text-ink-2">
                {detail.departmentName} 부서장으로 승인권자예요 · 요청자 {detail.requesterName ?? '-'} · 등록 {fmtDateTime(detail.createdAt)}
              </span>
              {rejecting ? (
                <Field label="반려 사유 (요청자에게 전달돼요)" required htmlFor={`reject-${detail.id}`} error={rejectError} hint={`${rejectReason.length} / 500자`}>
                  <Textarea id={`reject-${detail.id}`} rows={3} maxLength={500} value={rejectReason} invalid={Boolean(rejectError)} onChange={(event) => setRejectReason(event.target.value)} />
                </Field>
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-ink-2">{lockText(detail, canCreate)}</span>
          )}
        </CardBody>
        {detail.canApprove ? (
          <CardFoot className="justify-end">
            {rejecting ? (
              <>
                <Button
                  onClick={() => {
                    setRejecting(false);
                    setRejectError(null);
                  }}
                  disabled={reject.isPending}
                >
                  취소
                </Button>
                <Button variant="danger" onClick={submitReject} disabled={reject.isPending}>
                  {reject.isPending ? '처리하는 중…' : '반려 확정'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="danger-outline" icon="x" onClick={() => setRejecting(true)} disabled={approve.isPending}>
                  반려
                </Button>
                <Button
                  variant="primary"
                  icon="approve"
                  onClick={() => approve.mutate({ purchaseRequisitionId: detail.id, expectedUpdatedAt: detail.updatedAt })}
                  disabled={approve.isPending}
                >
                  {approve.isPending ? '처리하는 중…' : '승인'}
                </Button>
              </>
            )}
          </CardFoot>
        ) : detail.isRequester && status === 'REJECTED' ? (
          <CardFoot className="justify-end">
            <Button
              variant="primary"
              icon="edit"
              onClick={() => setEditing(true)}
              disabled={!canCreate}
              title={canCreate ? undefined : permissionNeedText([PERMISSION.PURCHASE_REQUISITION_CREATE])}
            >
              고쳐 다시 요청
            </Button>
          </CardFoot>
        ) : null}
      </Card>

      {editing ? (
        <RequisitionFormModal
          mode="resubmit"
          requisition={{ id: detail.id, purchaseRequisitionNo: detail.purchaseRequisitionNo, updatedAt: detail.updatedAt, rejectReason: detail.rejectReason }}
          initial={{
            itemId: detail.itemId,
            requestedTon: trimTonText(detail.requestedTon),
            productionPlanId: detail.productionPlanId,
            productionPlanNo: detail.productionPlanNo,
            desiredReceiptDate: detail.desiredReceiptDate ?? '',
            requestReason: detail.requestReason ?? '',
          }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

function lockText(detail: RequisitionDetail, canCreate: boolean): string {
  switch (detail.purchaseRequisitionStatus) {
    case 'WAITING_APPROVAL':
      return `승인·반려는 요청 부서의 부서장(${detail.departmentHeadName ?? '지정 안 됨'})만 할 수 있어요`;
    case 'REJECTED':
      if (!detail.isRequester) return `고쳐 다시 요청하는 것은 요청자(${detail.requesterName ?? '-'})만 할 수 있어요`;
      return canCreate ? '반려 사유를 확인하고 고쳐 다시 요청해 주세요' : permissionNeedText([PERMISSION.PURCHASE_REQUISITION_CREATE]);
    case 'APPROVED':
      return '승인된 구매요청이에요 · 구매 담당 발주 대기';
    case 'ORDERED':
      return '발주까지 끝난 요청이에요';
  }
}
