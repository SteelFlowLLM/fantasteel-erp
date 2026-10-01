'use client';

// 구매요청 목록 (REQ-PUR-001): 왼쪽 목록 | 오른쪽 선택한 요청. ?pr=로 고른다(승인 결과 알림 링크).
// 상태 칩은 공통 코드 PURCHASE_REQUISITION_STATUS 4개(작성 중 없음), 출처는 계산값(MRP 계획 / Message → ERP / 직접).
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PERMISSION, PURCHASE_REQUISITION_STATUS_LABEL, type PurchaseRequisitionStatus } from '@/codes';
import type { RequisitionSource, RequisitionView } from '@/api/purchasing';
import { Button, ButtonLink } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { MasterPane, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { MasterItem, MasterNote, RequisitionSourceTag, RequisitionStatusBadge } from '@/features/purchasing/components/PurchasingParts';
import { RequisitionFormModal } from '@/features/purchasing/components/RequisitionFormModal';
import { RequisitionPanel } from '@/features/purchasing/components/RequisitionPanel';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { REQUISITION_SOURCE_LABEL, REQUISITION_SOURCES, summarizeItemNames } from '@/features/purchasing/lib/purchasingView';
import { useMe } from '@/hooks/useMe';
import { useCanUse } from '@/hooks/usePermission';
import { usePurchaseRequisitionList } from '@/hooks/usePurchaseRequisitions';
import { fmtMD, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

const STATUS_FILTERS: readonly PurchaseRequisitionStatus[] = ['WAITING_APPROVAL', 'APPROVED', 'REJECTED', 'ORDERED'];

function statusLine(pr: RequisitionView): string {
  switch (pr.purchaseRequisitionStatus) {
    case 'WAITING_APPROVAL':
      return `${pr.departmentName ?? ''} 부서장 승인 대기`;
    case 'APPROVED':
      return `승인 ${pr.approverName ?? ''} ${fmtMD(pr.approvedAt)} · 발주 대기`;
    case 'REJECTED':
      return `반려 · ${pr.approverName ?? ''} · 고쳐 다시 요청 필요`;
    case 'ORDERED':
      return `승인 ${pr.approverName ?? ''} · 발주 완료`;
  }
}

export function RequisitionListScreen() {
  const me = useMe();
  const router = useRouter();
  const url = useUrlParams();
  const selectedId = url.getNumber('pr');
  const canCreate = useCanUse(PERMISSION.PURCHASE_REQUISITION_CREATE);
  const list = usePurchaseRequisitionList();
  const [status, setStatus] = useState<PurchaseRequisitionStatus | null>(null);
  const [source, setSource] = useState<RequisitionSource | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const filtered = useMemo(() => {
    const word = keyword.trim().toLowerCase();
    return rows.filter(
      (pr) =>
        (status === null || pr.purchaseRequisitionStatus === status) &&
        (source === null || pr.source === source) &&
        (!mineOnly || pr.requesterId === me.employeeId) &&
        (word === '' ||
          pr.purchaseRequisitionNo.toLowerCase().includes(word) ||
          (pr.requesterName ?? '').includes(word) ||
          pr.items.some((i) => i.itemName.includes(word) || i.itemCode.toLowerCase().includes(word))),
    );
  }, [rows, status, source, mineOnly, keyword, me.employeeId]);
  const activeId = selectedId ?? filtered[0]?.id ?? null;
  const countOf = (value: PurchaseRequisitionStatus) => rows.filter((pr) => pr.purchaseRequisitionStatus === value).length;

  return (
    <>
      <MasterPane
        head={
          <>
            <div className="flex items-center gap-2">
              <b className="text-base font-semibold">구매요청</b>
              <span className="text-xs text-ink-3">
                {filtered.length} / {rows.length}
              </span>
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                className="ml-auto"
                disabled={!canCreate}
                title={canCreate ? '원료·톤·희망 입고일을 입력해 등록해요' : permissionNeedText([PERMISSION.PURCHASE_REQUISITION_CREATE])}
                onClick={() => setCreating(true)}
              >
                구매요청 등록
              </Button>
            </div>
            <Input leadingIcon="search" placeholder="요청번호·원료·요청자 검색" value={keyword} onChange={(event) => setKeyword(event.target.value)} aria-label="구매요청 검색" />
            <div className="flex flex-wrap gap-1.5">
              <Chip on={status === null} onClick={() => setStatus(null)}>
                전체 <b>{rows.length}</b>
              </Chip>
              {STATUS_FILTERS.map((value) => (
                <Chip key={value} on={status === value} onClick={() => setStatus(status === value ? null : value)}>
                  {PURCHASE_REQUISITION_STATUS_LABEL[value]} <b>{countOf(value)}</b>
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-cap text-ink-3">출처</span>
              {REQUISITION_SOURCES.map((value) => (
                <Chip key={value} on={source === value} onClick={() => setSource(source === value ? null : value)}>
                  {REQUISITION_SOURCE_LABEL[value]} <b>{rows.filter((pr) => pr.source === value).length}</b>
                </Chip>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={mineOnly} onChange={(event) => setMineOnly(event.target.checked)} />내 요청만 보기
            </label>
            {canCreate ? null : <ReadOnlyHint permissions={[PERMISSION.PURCHASE_REQUISITION_CREATE]} />}
          </>
        }
      >
        <QueryBoundary query={list} loadingLabel="구매요청을 불러오는 중…">
          {() =>
            filtered.length === 0 ? (
              <EmptyNote>{rows.length === 0 ? '등록된 구매요청이 없어요' : mineOnly ? '내가 등록한 구매요청이 없어요' : '조건에 맞는 구매요청이 없어요'}</EmptyNote>
            ) : (
              <>
                {filtered.map((pr) => (
                  <MasterItem
                    key={pr.id}
                    selected={pr.id === activeId}
                    onClick={() => url.set({ pr: pr.id })}
                    onDoubleClick={() => router.push(`/purchase-requisitions/${pr.id}`)}
                    title="두 번 누르면 상세 화면이 열려요"
                  >
                    <span className="flex items-center gap-2">
                      <b className="font-mono text-sm font-semibold">{pr.purchaseRequisitionNo}</b>
                      <RequisitionStatusBadge status={pr.purchaseRequisitionStatus} />
                      <span className="ml-auto text-cap text-ink-3">{pr.desiredReceiptDate ? `희망 ${fmtMD(pr.desiredReceiptDate)}` : ''}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-sm text-ink">
                      {summarizeItemNames(pr.items)}
                      <span className="text-ink-3">· {fmtTon(pr.totalTon)}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-cap text-ink-3">
                      {pr.requesterName ?? '-'}
                      <RequisitionSourceTag source={pr.source} />
                      <span className="truncate">{statusLine(pr)}</span>
                    </span>
                  </MasterItem>
                ))}
                <MasterNote>구매요청은 등록하면 바로 승인 대기가 되고, 요청자 소속 부서의 부서장이 승인해요.</MasterNote>
              </>
            )
          }
        </QueryBoundary>
      </MasterPane>
      <PageMain>
        {activeId !== null ? (
          <RequisitionPanel
            key={activeId}
            requisitionId={activeId}
            crumb="구매요청"
            extraActions={
              <ButtonLink href={`/purchase-requisitions/${activeId}`} size="sm" icon="chevron-right">
                상세 열기
              </ButtonLink>
            }
          />
        ) : list.data ? (
          <StateView
            kind="empty"
            icon="cart"
            title={rows.length === 0 ? '구매요청이 없어요' : '조건에 맞는 구매요청이 없어요'}
            text="MRP의 순소요를 보고 등록하거나, 메신저 메시지에서 초안을 만들 수 있어요"
            actions={
              <ButtonLink href="/mrp" size="sm" icon="calc">
                MRP 보기
              </ButtonLink>
            }
          />
        ) : null}
      </PageMain>
      {creating ? <RequisitionFormModal mode="create" onClose={() => setCreating(false)} onDone={(view) => url.set({ pr: view.id })} /> : null}
    </>
  );
}
