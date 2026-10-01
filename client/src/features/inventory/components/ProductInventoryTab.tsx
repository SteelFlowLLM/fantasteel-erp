// 제품 탭 (REQ-INV-001·003·007, 4.2): 규격별 재고 매수 · 합격 · 판정 대기 · 불합격 · 예약 · 열연 배정 · 가용재고 · 톤
import { ITEM_TYPE_LABEL, PRODUCT_QTY_UNIT, type ProductItemType } from '@/codes';
import type { ProductInventoryView } from '@/api/inventories';
import { Card, CardFoot } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Kpi, StatBar } from '@/components/Kpi';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Segmented } from '@/components/Tabs';
import { Qty, SteelGradeSelect, TableCaption } from '@/features/inventory/components/InventoryParts';
import { isEmptyProductRow, productTotalsOf } from '@/features/inventory/lib/inventoryDisplay';
import { useProductInventory } from '@/hooks/useInventories';
import { fmtDims, fmtInt, fmtTon } from '@/lib/format';

export type ProductTypeFilter = ProductItemType | '';

const TYPE_ITEMS: readonly { key: ProductTypeFilter | 'ALL'; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'SLAB', label: ITEM_TYPE_LABEL.SLAB },
  { key: 'COIL', label: ITEM_TYPE_LABEL.COIL },
];

export interface ProductInventoryTabProps {
  itemType: ProductTypeFilter;
  steelGrade: string;
  onItemTypeChange: (type: ProductTypeFilter) => void;
  onSteelGradeChange: (code: string) => void;
}

export function ProductInventoryTab({ itemType, steelGrade, onItemTypeChange, onSteelGradeChange }: ProductInventoryTabProps) {
  const query = useProductInventory();
  return (
    <>
      <div className="flex flex-none flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="품목 유형"
          items={TYPE_ITEMS}
          active={itemType || 'ALL'}
          onChange={(key) => onItemTypeChange(key === 'ALL' ? '' : key)}
        />
        <SteelGradeSelect value={steelGrade} onChange={onSteelGradeChange} />
        {query.isFetching && query.data ? <span className="text-cap text-ink-3">새로 불러오는 중…</span> : null}
      </div>
      <QueryBoundary query={query} loadingLabel="재고를 불러오는 중…">
        {(data) => {
          const rows = data.filter((r) => (!itemType || r.itemType === itemType) && (!steelGrade || r.steelGradeCode === steelGrade));
          const types = (['SLAB', 'COIL'] as const).filter((t) => !itemType || itemType === t);
          return (
            <>
              <StatBar className="flex-none">
                {types.map((t) => {
                  const total = productTotalsOf(rows, t);
                  const unit = PRODUCT_QTY_UNIT[t];
                  return (
                    <Kpi
                      key={t}
                      flat
                      icon={t === 'COIL' ? 'coil' : 'slab'}
                      label={`${ITEM_TYPE_LABEL[t]} 가용재고 · 규격 ${total.specCount}개`}
                      value={fmtInt(total.availableQty)}
                      unit={unit}
                      sub={`합격 ${fmtInt(total.passedQty)}${unit} − 예약 ${fmtInt(total.reservedQty)}${unit} − 열연 배정 ${fmtInt(total.hotRollingAllocatedQty)}${unit} · 재고 ${fmtInt(total.onHandQty)}${unit}`}
                    />
                  );
                })}
              </StatBar>
              <Card className="flex-none overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>규격</Th>
                      <Th>유형</Th>
                      <Th>강종</Th>
                      <Th>치수 (두께 × 폭 × 길이 mm)</Th>
                      <Th align="right" title="1매 이론중량">
                        1매 이론중량
                      </Th>
                      <Th align="right" title="투입·출고되지 않은 LOT 매수 (판정 대기·불합격 포함)">
                        재고
                      </Th>
                      <Th align="right" title="재고 매수 × 1매 이론중량">
                        재고 톤
                      </Th>
                      <Th align="right" title="슬래브 = 히트 성분 합격 + 슬래브 검사 합격, 코일 = 상위 히트 성분 합격 + 코일 검사 합격 (여재 포함)">
                        합격
                      </Th>
                      <Th align="right" title="제품 또는 상위 히트 판정 전">
                        판정 대기
                      </Th>
                      <Th align="right" title="제품 불합격 또는 상위 히트 불합격 — 예약·배정 대상에서 빠져요">
                        불합격
                      </Th>
                      <Th align="right" title="수주에 예약된 매수 (유효)">
                        예약
                      </Th>
                      <Th align="right" title="열연 투입으로 확정된 배정 (슬래브)">
                        열연 배정
                      </Th>
                      <Th align="right" title="합격 − 예약 − 열연 배정 (새로 예약·배정할 수 있는 매수)">
                        가용재고
                      </Th>
                      <Th align="right" title="가용재고 매수 × 1매 이론중량">
                        가용재고 톤
                      </Th>
                      <Th>기본 야드</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <ProductRow key={r.itemId} row={r} />
                    ))}
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={15}>
                          <EmptyNote>조건에 맞는 제품 규격이 없어요</EmptyNote>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </Table>
                <CardFoot>
                  <TableCaption>
                    가용재고 = 합격 − 예약(유효) − 예약 밖 열연 배정(확정) · 여재(수주에 쓰이지 않고 남은 미배정 합격 슬래브)는 가용재고에 들어 있어요 · 판정 대기·불합격은 합격에 들어가지 않아요 ·
                    톤 = 매수 × 1매 이론중량 계산값 · 단위: 슬래브 매, 코일 개
                  </TableCaption>
                </CardFoot>
              </Card>
            </>
          );
        }}
      </QueryBoundary>
    </>
  );
}

function ProductRow({ row }: { row: ProductInventoryView }) {
  const unit = row.qtyUnit;
  return (
    <tr data-muted={isEmptyProductRow(row) || undefined}>
      <Td className="font-mono text-mono">{row.itemCode}</Td>
      <Td>
        <span className="inline-flex items-center gap-1">
          <Icon name={row.itemType === 'COIL' ? 'coil' : 'slab'} size="sm" className="text-ink-3" />
          {ITEM_TYPE_LABEL[row.itemType]}
        </span>
      </Td>
      <Td className="font-mono text-mono">{row.steelGradeCode ?? '—'}</Td>
      <Td>{row.thicknessMm && row.widthMm && row.lengthMm ? fmtDims(row.thicknessMm, row.widthMm, row.lengthMm) : '—'}</Td>
      <Td align="right">{fmtTon(row.theoreticalWeightTon)}</Td>
      <Td align="right">
        <Qty value={row.onHandQty} unit={unit} />
      </Td>
      <Td align="right" className="text-ink-2">
        {fmtTon(row.onHandTon)}
      </Td>
      <Td align="right">
        <Qty value={row.passedQty} unit={unit} />
      </Td>
      <Td align="right">
        <Qty value={row.pendingQty} unit={unit} tone="wait" />
      </Td>
      <Td align="right">
        <Qty value={row.failedQty} unit={unit} tone="danger" />
      </Td>
      <Td align="right" title={fmtTon(row.reservedTon)}>
        <Qty value={row.reservedQty} unit={unit} />
      </Td>
      <Td align="right">{row.itemType === 'SLAB' ? <Qty value={row.hotRollingAllocatedQty} unit={unit} /> : <span className="text-ink-3">—</span>}</Td>
      <Td align="right">
        <Qty value={row.availableQty} unit={unit} tone="ok" strong />
      </Td>
      <Td align="right" className="font-medium">
        {fmtTon(row.availableTon)}
      </Td>
      <Td>{row.defaultYardName ?? '—'}</Td>
    </tr>
  );
}
