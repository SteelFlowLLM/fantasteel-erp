// LOT 목록 탭 (REQ-INV-001·003·006·007·008, LOT-001): LOT 번호 · 유형 · 규격 · 생산완료일(날짜) · 품질 결과(검사 결과) · 배정 여부(배정 확정·소진) · 야드 · 상태
import { useMemo, useState } from 'react';
import { LOT_STATUS, LOT_STATUS_LABEL, LOT_TYPE, LOT_TYPE_LABEL, type LotStatus, type LotType } from '@/codes';
import type { LotListView } from '@/api/inventories';
import { Badge } from '@/components/Badge';
import { Card, CardFoot, CardHead } from '@/components/Card';
import { Input, Select } from '@/components/Input';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Segmented } from '@/components/Tabs';
import { LotNoLink, PlanLink, TableCaption } from '@/features/inventory/components/InventoryParts';
import { allocationLabelOf, lotStatusTone, matchesLotNo, qualityDisplayOf } from '@/features/inventory/lib/inventoryDisplay';
import { DispositionBadge } from '@/features/quality/components/QualityBadges';
import { useLotList } from '@/hooks/useInventories';
import { fmtDate, fmtInt, fmtTon } from '@/lib/format';
import { ALLOCATION_STATUS_TONE } from '@/lib/statusTone';

export type LotTypeFilter = LotType | '';
export type LotStatusFilter = LotStatus | '';

const TYPE_ITEMS: readonly { key: LotType | 'ALL'; label: string }[] = [
  { key: 'ALL', label: '전체' },
  ...Object.values(LOT_TYPE).map((t) => ({ key: t, label: LOT_TYPE_LABEL[t] })),
];

export interface LotListTabProps {
  lotType: LotTypeFilter;
  lotStatus: LotStatusFilter;
  onLotTypeChange: (type: LotTypeFilter) => void;
  onLotStatusChange: (status: LotStatusFilter) => void;
}

export function LotListTab({ lotType, lotStatus, onLotTypeChange, onLotStatusChange }: LotListTabProps) {
  const [search, setSearch] = useState('');
  const filter = useMemo(() => ({ ...(lotType ? { lotType } : {}), ...(lotStatus ? { lotStatus } : {}) }), [lotType, lotStatus]);
  const query = useLotList(filter);
  return (
    <>
      <div className="flex flex-none flex-wrap items-center gap-3">
        <Segmented ariaLabel="LOT 유형" items={TYPE_ITEMS} active={lotType || 'ALL'} onChange={(key) => onLotTypeChange(key === 'ALL' ? '' : key)} />
        <label className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-ink-2">상태</span>
          <Select aria-label="LOT 상태" className="w-[120px]" value={lotStatus} onChange={(e) => onLotStatusChange(e.target.value as LotStatusFilter)}>
            <option value="">전체</option>
            {Object.values(LOT_STATUS).map((s) => (
              <option key={s} value={s}>
                {LOT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
        <Input
          aria-label="LOT 번호 검색"
          leadingIcon="search"
          className="w-[220px] font-mono text-mono"
          placeholder="LOT 번호"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {query.isFetching && query.data ? <span className="text-cap text-ink-3">새로 불러오는 중…</span> : null}
      </div>
      <QueryBoundary query={query} loadingLabel="LOT 목록을 불러오는 중…">
        {(data) => {
          const rows = data.filter((r) => matchesLotNo(r.lotNo, search));
          return (
            <Card className="min-h-0 flex-1">
              <CardHead title="LOT" meta={`${fmtInt(rows.length)}건 · 생산완료일 최근 순`} />
              <div className="min-h-0 flex-1 overflow-auto">
                <Table compact>
                  <thead className="sticky top-0 z-[1]">
                    <tr>
                      <Th>LOT 번호</Th>
                      <Th>유형</Th>
                      <Th>규격</Th>
                      <Th>강종</Th>
                      <Th>히트</Th>
                      <Th>생산완료일</Th>
                      <Th>품질 결과</Th>
                      <Th>배정 여부</Th>
                      <Th align="right" title="원료·용선 LOT 잔량">
                        잔량
                      </Th>
                      <Th>야드</Th>
                      <Th>생산계획</Th>
                      <Th>상태</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <LotRow key={r.lotId} row={r} />
                    ))}
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={12}>
                          <EmptyNote>조건에 맞는 LOT이 없어요</EmptyNote>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </Table>
              </div>
              <CardFoot>
                <TableCaption>
                  품질 결과: 슬래브·코일은 자기 검사와 상위 히트 성분 판정을 함께 봐요(투입 소진·출고된 LOT도) · 히트는 성분 판정 · 원료·용선은 검사 대상이 아니에요 ·
                  생산완료일은 원료면 입고일이에요 · 배정 여부는 해제되지 않은 마지막 배정의 목적과 상태(배정 확정·소진)예요 · 여재 꼬리표는 여재 탭과 같은 기준이에요
                </TableCaption>
              </CardFoot>
            </Card>
          );
        }}
      </QueryBoundary>
    </>
  );
}

function LotRow({ row }: { row: LotListView }) {
  const quality = qualityDisplayOf(row.inspectionResult);
  const isProduct = row.lotType === 'SLAB' || row.lotType === 'COIL';
  return (
    <tr data-muted={row.lotStatus !== 'AVAILABLE' || undefined}>
      <Td>
        <LotNoLink lotNo={row.lotNo} />
      </Td>
      <Td>{LOT_TYPE_LABEL[row.lotType]}</Td>
      <Td className="font-mono text-mono">{row.itemCode ?? '—'}</Td>
      <Td className="font-mono text-mono">{row.steelGradeCode ?? '—'}</Td>
      <Td>{row.heatLotNo && row.heatLotNo !== row.lotNo ? <LotNoLink lotNo={row.heatLotNo} /> : <span className="text-ink-3">—</span>}</Td>
      <Td>{fmtDate(row.producedDate)}</Td>
      <Td>
        {quality ? (
          <span className="inline-flex items-center gap-1">
            <Badge tone={quality.tone} title={quality.note}>
              {quality.label}
            </Badge>
            {row.dispositionStatus ? <DispositionBadge status={row.dispositionStatus} /> : null}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </Td>
      <Td>
        {isProduct && row.allocationPurpose ? (
          <Badge tone={row.allocationStatus ? ALLOCATION_STATUS_TONE[row.allocationStatus] : 'neutral'} plain>
            {allocationLabelOf(row.allocationPurpose, row.allocationStatus)}
          </Badge>
        ) : isProduct && row.lotStatus === 'AVAILABLE' ? (
          <span className="inline-flex items-center gap-1 text-ink-2">
            {allocationLabelOf(null)}
            {row.isSurplus ? (
              <Badge tone="neutral" plain title={row.surplusAt ? `여재 전환 ${fmtDate(row.surplusAt)}` : undefined}>
                여재
              </Badge>
            ) : null}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </Td>
      <Td align="right">{row.lotType === 'RAW_MATERIAL' || row.lotType === 'HOT_METAL' ? fmtTon(row.remainingTon) : <span className="text-ink-3">—</span>}</Td>
      <Td>{row.yardName ?? '—'}</Td>
      <Td>
        <PlanLink planId={row.productionPlanId} planNo={row.productionPlanNo} />
      </Td>
      <Td>
        <Badge tone={lotStatusTone(row.lotStatus)}>{LOT_STATUS_LABEL[row.lotStatus]}</Badge>
      </Td>
    </tr>
  );
}
