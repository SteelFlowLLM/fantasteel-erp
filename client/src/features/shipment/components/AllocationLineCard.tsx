'use client';
// 출하요청 품목 하나의 배정 카드 (REQ-INV-006, BP-INV-02, 보고서 1 A-7 AllocationItemCard).
// - 배정 대기가 있으면 FIFO 추천을 바로 펼친다(SHP-001). 추천대로 또는 직접 골라 확정 → CONFIRMED.
// - 변경 = 기존 해제 + 새 배정 한 번에, 사유 필수(ALLOCATION_CHANGE). 해제는 사유 선택.
// - 생산완료일은 날짜로 보인다(C-5-12). 추천은 저장하지 않고, 확정할 때 작업 로그(ALLOCATION_RECOMMENDED)에 남는다.
import { useState } from 'react';
import { PERMISSION, PRODUCT_QTY_UNIT } from '@/codes';
import type { ShipmentLineDetail, ShipmentLotOption } from '@/api/shipmentRequests';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardFoot, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { Textarea } from '@/components/Input';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Tag } from '@/components/Tag';
import { AllocationStatusBadge, ItemTypeTag, SalesOrderItemStatusBadge, SalesOrderLink, TraceLink } from '@/features/shipment/components/ShipmentBadges';
import { isSameAsRecommendation, toggleLot } from '@/features/shipment/lib/shipmentForm';
import { useChangeShipmentAllocation, useConfirmShipmentAllocations, useReleaseShipmentAllocation } from '@/hooks/useShipmentRequests';
import { fmtMDHM, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

const REASON_MAX = 500;

type Mode = { kind: 'closed' } | { kind: 'recommend' } | { kind: 'change'; allocationId: number; lotNo: string };

export interface AllocationLineCardProps {
  shipmentRequestId: number;
  line: ShipmentLineDetail;
  /** 요청 상태가 배정 대기·배정 확정인지 */
  editable: boolean;
  canEdit: boolean;
}

export function AllocationLineCard({ shipmentRequestId, line, editable, canEdit }: AllocationLineCardProps) {
  const unit = PRODUCT_QTY_UNIT[line.itemType];
  const waiting = line.waitingAllocationQty;
  const [mode, setMode] = useState<Mode>(editable && waiting > 0 ? { kind: 'recommend' } : { kind: 'closed' });
  const [selected, setSelected] = useState<number[]>(() => line.recommendedLots.map((l) => l.lotId));
  const [changeLotId, setChangeLotId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [releaseTarget, setReleaseTarget] = useState<{ allocationId: number; lotNo: string } | null>(null);
  const [releaseReason, setReleaseReason] = useState('');

  const recommendedIds = line.recommendedLots.map((l) => l.lotId);
  const closePanel = () => {
    setMode({ kind: 'closed' });
    setChangeLotId(null);
    setReason('');
  };
  const confirm = useConfirmShipmentAllocations(closePanel);
  const change = useChangeShipmentAllocation(closePanel);
  const release = useReleaseShipmentAllocation(() => {
    setReleaseTarget(null);
    setReleaseReason('');
  });
  const busy = confirm.isPending || change.isPending || release.isPending;
  const lockTitle = canEdit ? undefined : permissionNeedText([PERMISSION.SHIPMENT_REQUEST_MANAGE]);

  const openRecommend = () => {
    setSelected(recommendedIds);
    setMode({ kind: 'recommend' });
  };
  const reasonError = mode.kind === 'change' && reason.trim().length > REASON_MAX ? `${REASON_MAX}자 이하로 입력해 주세요` : null;
  const shortage = Math.max(0, waiting - line.candidateLots.length);

  return (
    <Card>
      <CardHead
        title={
          <span className="flex items-center gap-2">
            품목 {line.lineNo}
            <ItemTypeTag itemType={line.itemType} />
            <span className="font-mono text-mono font-medium">{line.itemCode}</span>
          </span>
        }
        meta={
          <span className="flex items-center gap-1.5">
            <SalesOrderLink salesOrderId={line.salesOrderId} salesOrderNo={line.salesOrderNo} lineNo={line.salesOrderLineNo} />
            <span>
              · 요청 {line.requestQty}
              {unit} · {fmtTon(line.requestTon)}
            </span>
            <SalesOrderItemStatusBadge status={line.salesOrderItemStatus} />
          </span>
        }
        actions={
          mode.kind === 'closed' ? (
            editable && waiting > 0 ? (
              <Button size="sm" icon="flow" disabled={!canEdit} title={lockTitle} onClick={openRecommend}>
                FIFO 추천
              </Button>
            ) : null
          ) : (
            <Button size="sm" variant="ghost" onClick={closePanel}>
              닫기
            </Button>
          )
        }
      />
      {line.allocations.length === 0 ? (
        <EmptyNote>{editable ? '아직 배정된 LOT이 없어요. FIFO 추천으로 후보를 확인해 주세요.' : '배정된 LOT이 없어요.'}</EmptyNote>
      ) : (
        <div className="overflow-auto">
          <Table compact>
            <thead>
              <tr>
                <Th align="center" className="w-10">
                  No
                </Th>
                <Th>배정 LOT</Th>
                <Th>히트</Th>
                <Th>생산완료일</Th>
                <Th>야드</Th>
                <Th>배정 확정</Th>
                <Th>상태</Th>
                <Th aria-label="동작" />
              </tr>
            </thead>
            <tbody>
              {line.allocations.map((a, index) => {
                const changing = mode.kind === 'change' && mode.allocationId === a.allocationId;
                return (
                  <tr key={a.allocationId} data-selected={changing}>
                    <Td align="center">{index + 1}</Td>
                    <Td>
                      <TraceLink no={a.lotNo} />
                    </Td>
                    <Td className="font-mono text-mono">{a.heatLotNo ?? '-'}</Td>
                    <Td>{a.producedDate}</Td>
                    <Td>{a.yardName ?? '-'}</Td>
                    <Td className="text-xs text-ink-2">
                      {a.confirmedEmployeeName ?? '-'} · {fmtMDHM(a.confirmedAt)}
                    </Td>
                    <Td>
                      <AllocationStatusBadge status={a.allocationStatus} />
                    </Td>
                    <Td align="right">
                      {editable && a.allocationStatus === 'CONFIRMED' ? (
                        <span className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!canEdit || busy}
                            title={lockTitle}
                            onClick={() => (changing ? closePanel() : (setMode({ kind: 'change', allocationId: a.allocationId, lotNo: a.lotNo }), setChangeLotId(null), setReason('')))}
                          >
                            {changing ? '변경 취소' : '변경'}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={!canEdit || busy} title={lockTitle} onClick={() => setReleaseTarget({ allocationId: a.allocationId, lotNo: a.lotNo })}>
                            배정 해제
                          </Button>
                        </span>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {mode.kind !== 'closed' ? (
        <div className="flex flex-col gap-2.5 border-t border-line bg-surface-2 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-ink-2">
            <Badge tone="run">FIFO 추천</Badge>
            {mode.kind === 'change' ? (
              <span>
                <b className="font-mono">{mode.lotNo}</b> 대신 배정할 LOT을 1개 골라 주세요.
              </span>
            ) : (
              <span>
                생산완료일 오래된 순, 같으면 LOT 번호 순 · 필요 {waiting}
                {unit} (확정 {line.allocatedQty} / 요청 {line.requestQty})
              </span>
            )}
            {mode.kind === 'recommend' && !isSameAsRecommendation(selected, recommendedIds) ? (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(recommendedIds)}>
                추천대로
              </Button>
            ) : null}
          </div>
          {mode.kind === 'recommend' && shortage > 0 ? (
            <Banner tone="wait">
              적격 LOT이 {shortage}
              {unit} 모자라요. 지금 있는 LOT만 먼저 확정하고, 검사 합격 뒤 다시 배정할 수 있어요.
            </Banner>
          ) : null}
          {line.candidateLots.length === 0 ? (
            <EmptyNote>강종·규격이 같은 합격·미배정 LOT이 아직 없어요.</EmptyNote>
          ) : (
            <div className="max-h-[340px] overflow-auto rounded-md border border-line bg-surface">
              <Table compact>
                <thead>
                  <tr>
                    <Th className="w-10" aria-label="선택" />
                    <Th align="center">FIFO 순위</Th>
                    <Th>LOT</Th>
                    <Th>히트</Th>
                    <Th>생산완료일</Th>
                    <Th>야드</Th>
                    <Th>추천</Th>
                  </tr>
                </thead>
                <tbody>
                  {line.candidateLots.map((lot, index) => (
                    <CandidateRow
                      key={lot.lotId}
                      lot={lot}
                      rank={index + 1}
                      recommended={recommendedIds.includes(lot.lotId)}
                      kind={mode.kind === 'change' ? 'radio' : 'checkbox'}
                      checked={mode.kind === 'change' ? changeLotId === lot.lotId : selected.includes(lot.lotId)}
                      onToggle={() => (mode.kind === 'change' ? setChangeLotId(lot.lotId) : setSelected(toggleLot(selected, lot.lotId, waiting)))}
                      name={`line-${line.shipmentRequestItemId}`}
                    />
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          {mode.kind === 'change' ? (
            <Field label="변경 사유" required htmlFor={`reason-${line.shipmentRequestItemId}`} error={reasonError} hint="작업 로그에 남아요">
              <Textarea id={`reason-${line.shipmentRequestItemId}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 야드 작업 순서" />
            </Field>
          ) : null}
        </div>
      ) : null}

      <CardFoot>
        {mode.kind === 'recommend' ? (
          <>
            <span className="text-xs text-ink-2">
              선택 <b>{selected.length}</b> / 필요 {waiting}
              {unit} ·{' '}
              {isSameAsRecommendation(selected, recommendedIds) ? 'FIFO 추천과 같아요' : '추천과 다르게 골랐어요 — 확정하면 추천·선택 LOT이 함께 작업 로그에 남아요'}
            </span>
            <Button
              variant="primary"
              size="sm"
              className="ml-auto"
              disabled={!canEdit || busy || selected.length === 0 || selected.length > waiting}
              title={lockTitle}
              onClick={() => confirm.mutate({ shipmentRequestId, lines: [{ shipmentRequestItemId: line.shipmentRequestItemId, lotIds: selected }] })}
            >
              {confirm.isPending ? '확정하는 중…' : '배정 확정'}
            </Button>
          </>
        ) : mode.kind === 'change' ? (
          <>
            <span className="text-xs text-ink-2">기존 배정은 해제되고 새 LOT이 배정 확정돼요 (한 번에 처리).</span>
            <Button
              variant="primary"
              size="sm"
              className="ml-auto"
              disabled={!canEdit || busy || changeLotId === null || reason.trim() === '' || reasonError !== null}
              title={lockTitle}
              onClick={() => changeLotId !== null && change.mutate({ allocationId: mode.allocationId, newLotId: changeLotId, reasonText: reason.trim() })}
            >
              {change.isPending ? '바꾸는 중…' : '배정 변경 확정'}
            </Button>
          </>
        ) : (
          <span className="text-xs text-ink-2">
            배정 {line.allocatedQty} / 요청 {line.requestQty}
            {unit} ·{' '}
            {!editable
              ? line.allocations.some((a) => a.allocationStatus === 'CONSUMED')
                ? '출고 완료 — 배정 LOT이 소진됐어요'
                : '배정을 바꿀 수 없는 상태예요'
              : waiting > 0
                ? `${waiting}${unit} 더 배정해야 해요`
                : '출고 확정 전까지 배정을 바꿀 수 있어요'}
          </span>
        )}
      </CardFoot>

      {releaseTarget ? (
        <ConfirmDialog
          title="배정 해제"
          confirmLabel="배정 해제"
          tone="danger"
          pending={release.isPending}
          onCancel={() => setReleaseTarget(null)}
          onConfirm={() => release.mutate({ allocationId: releaseTarget.allocationId, reasonText: releaseReason.trim() || null })}
        >
          <p className="text-sm">
            <b className="font-mono">{releaseTarget.lotNo}</b> 배정을 해제할까요? 품목은 배정 대기로 돌아가고, 예약은 그대로 남아요.
          </p>
          <Field label="사유 (선택)" htmlFor="release-reason" className="mt-3" error={releaseReason.length > REASON_MAX ? `${REASON_MAX}자 이하로 입력해 주세요` : null}>
            <Textarea id="release-reason" rows={2} value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} placeholder="작업 로그에 남아요" />
          </Field>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

function CandidateRow({
  lot,
  rank,
  recommended,
  kind,
  checked,
  onToggle,
  name,
}: {
  lot: ShipmentLotOption;
  rank: number;
  recommended: boolean;
  kind: 'radio' | 'checkbox';
  checked: boolean;
  onToggle: () => void;
  name: string;
}) {
  return (
    <tr data-selected={checked} className="cursor-pointer" onClick={onToggle}>
      <Td align="center">
        <input type={kind} name={name} checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label={`${lot.lotNo} 선택`} />
      </Td>
      <Td align="center">{rank}</Td>
      <Td className="font-mono text-mono">{lot.lotNo}</Td>
      <Td className="font-mono text-mono">{lot.heatLotNo ?? '-'}</Td>
      <Td>{lot.producedDate}</Td>
      <Td>{lot.yardName ?? '-'}</Td>
      <Td>
        {recommended ? (
          <Badge tone="run">추천</Badge>
        ) : (
          <Tag tone="outline" size="sm">
            대안
          </Tag>
        )}
      </Td>
    </tr>
  );
}
