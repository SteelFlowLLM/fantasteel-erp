'use client';

// 정합성 보정 (REQ-INV-010, BP-INV-02 P2, TRM-062): ACTIVE 예약 매수 합계와 재고의 예약 매수(inventory.reserved_qty)를 비교해 재고 쪽을 맞춘다.
// 창을 열면 바로 점검(바꾸지 않음)하고, 관리자만 [보정 실행]을 누를 수 있다(2026-10-19 사용자 결정). 예약은 지우지 않아서
// ACTIVE 합계가 재고 − 열연 배정을 넘는 규격은 '보정 불가'로 남는다. 서버도 하루 한 번 같은 보정을 돈다.
import { RECONCILIATION_STATUS, RECONCILIATION_STATUS_LABEL, type ReconciliationStatus, type ReservationReconciliationView } from '@fantasteel/shared';
import { useState } from 'react';
import { inventoryApi, inventoryKeys } from '@/api/inventories';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { ROLE } from '@/codes';
import { Qty } from '@/features/inventory/components/InventoryParts';
import { useAction } from '@/hooks/useAction';
import { useReservationReconciliation } from '@/hooks/useInventories';
import { useMe } from '@/hooks/useMe';
import { fmtDateTime, fmtInt } from '@/lib/format';

const STATUS_TONE: Record<ReconciliationStatus, BadgeTone> = { MATCHED: 'ok', MISMATCHED: 'wait', CORRECTED: 'ok', UNFIXABLE: 'danger' };

export function ReconciliationModal({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const isAdmin = me.roleCode === ROLE.ADMIN;
  const query = useReservationReconciliation();
  // 보정을 실행하면 그 결과를 보인다 (다시 점검하면 점검 결과로 돌아간다)
  const [applied, setApplied] = useState<ReservationReconciliationView | null>(null);
  const reconcile = useAction(() => inventoryApi.reconcile(), {
    invalidate: [inventoryKeys.all],
    success: (r) => (r.correctedCount ? `예약 매수 ${r.correctedCount}개 규격을 맞췄어요` : '맞출 규격이 없었어요'),
    onSuccess: (r) => setApplied(r),
  });
  const recheck = () => {
    setApplied(null);
    void query.refetch();
  };
  const fixable = (applied ?? query.data)?.rows.filter((r) => r.status === RECONCILIATION_STATUS.MISMATCHED).length ?? 0;

  return (
    <Modal
      title="정합성 보정"
      onClose={onClose}
      width={760}
      footer={
        <>
          {!isAdmin ? (
            <span className="mr-auto inline-flex items-center gap-1 self-center text-cap text-ink-3">
              <Icon name="lock" size="sm" />
              점검만 할 수 있어요 · 보정은 관리자만 실행해요
            </span>
          ) : null}
          <Button onClick={recheck} disabled={query.isFetching || reconcile.isPending}>
            다시 점검
          </Button>
          {isAdmin ? (
            <Button variant="primary" onClick={() => reconcile.mutate(undefined)} disabled={fixable === 0 || reconcile.isPending || query.isFetching}>
              {reconcile.isPending ? '보정하는 중…' : `보정 실행${fixable ? ` (${fixable}개 규격)` : ''}`}
            </Button>
          ) : null}
        </>
      }
    >
      <Banner tone="run">
        규격마다 <b>유효(ACTIVE) 예약 매수 합계</b>와 <b>재고의 예약 매수</b>를 비교해요. 다르면 재고의 예약 매수를 예약 합계로 맞추고, <b>예약은 지우지 않아요</b>. 서버가 하루에 한 번 자동으로도 보정하고,
        보정하면 관리자에게 알려요.
      </Banner>
      <QueryBoundary query={query} loadingLabel="예약 매수를 점검하는 중…">
        {(checked) => {
          const result = applied ?? checked;
          return (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
                <span>
                  {result.applied ? '보정 결과' : '점검 결과'} · {fmtDateTime(result.checkedAt)}
                </span>
                <span>규격 {fmtInt(result.checkedItemCount)}개 점검</span>
                <span>불일치 {fmtInt(result.mismatchCount)}개</span>
                {result.applied ? <span>보정 {fmtInt(result.correctedCount)}개</span> : null}
                {result.unfixableCount ? <span className="text-danger">보정 불가 {fmtInt(result.unfixableCount)}개</span> : null}
              </div>
              <div className="overflow-x-auto rounded-md border border-line">
                <Table compact>
                  <thead>
                    <tr>
                      <Th>규격</Th>
                      <Th>강종</Th>
                      <Th align="right" title="보정 전 재고 행의 예약 매수 (inventory.reserved_qty)">
                        재고의 예약
                      </Th>
                      <Th align="right" title="이 규격의 유효(ACTIVE) 예약 매수 합계">
                        예약 합계
                      </Th>
                      <Th align="right" title="재고의 예약 − 예약 합계">
                        차이
                      </Th>
                      <Th align="right" title="재고 매수 − 열연 배정 매수: 예약 합계가 이보다 크면 예약을 지우지 않고는 맞출 수 없어요">
                        재고 − 열연 배정
                      </Th>
                      <Th>상태</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.itemId}>
                        <Td className="font-mono text-mono">{r.itemCode}</Td>
                        <Td className="font-mono text-mono">{r.steelGradeCode ?? '—'}</Td>
                        <Td align="right">{r.inventoryReservedQty === null ? <span className="text-ink-3">재고 행 없음</span> : <Qty value={r.inventoryReservedQty} unit="매" />}</Td>
                        <Td align="right">
                          <Qty value={r.activeReservedQty} unit="매" strong />
                        </Td>
                        <Td align="right" className={r.differenceQty === 0 ? undefined : 'text-danger'}>
                          {r.differenceQty > 0 ? '+' : ''}
                          {fmtInt(r.differenceQty)}
                          <small className="ml-0.5 text-cap font-normal text-ink-3">매</small>
                        </Td>
                        <Td align="right">
                          <Qty value={r.onHandQty - r.rollingAllocatedQty} unit="매" />
                        </Td>
                        <Td>
                          <Badge tone={STATUS_TONE[r.status]}>{RECONCILIATION_STATUS_LABEL[r.status]}</Badge>
                          {r.reason ? <div className="mt-1 max-w-[260px] text-cap text-ink-3">{r.reason}</div> : null}
                        </Td>
                      </tr>
                    ))}
                    {result.rows.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <EmptyNote>모든 규격의 예약 매수가 예약 합계와 맞아요</EmptyNote>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </Table>
              </div>
            </>
          );
        }}
      </QueryBoundary>
    </Modal>
  );
}
