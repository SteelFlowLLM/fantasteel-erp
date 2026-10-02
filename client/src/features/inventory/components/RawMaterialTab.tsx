// 원료 탭 (REQ-INV-001): 원료는 톤(소수)으로 관리. 원료별 LOT 잔량 합계 + 입고예정, 원료 LOT 목록(잔량)
import { useState } from 'react';
import { LOT_STATUS_LABEL, RAW_MATERIAL_TYPE_LABEL } from '@/codes';
import type { RawMaterialInventoryView } from '@/api/inventories';
import { Badge } from '@/components/Badge';
import { Card, CardFoot, CardHead } from '@/components/Card';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { LotNoLink, TableCaption } from '@/features/inventory/components/InventoryParts';
import { lotStatusTone } from '@/features/inventory/lib/inventoryDisplay';
import { useRawMaterialInventory } from '@/hooks/useInventories';
import { fmtDate, fmtTon } from '@/lib/format';
import { decCmp } from '@/lib/decimal';

export function RawMaterialTab() {
  const query = useRawMaterialInventory();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  return (
    <QueryBoundary query={query} loadingLabel="원료 재고를 불러오는 중…">
      {(data) => {
        const selected = data.find((r) => r.itemId === selectedId) ?? data[0] ?? null;
        return (
          <>
            <Card className="flex-none overflow-x-auto">
              <CardHead title="원료별 재고" meta={`${data.length}종 · 줄을 누르면 아래에 원료 LOT이 보여요`} />
              <Table>
                <thead>
                  <tr>
                    <Th>원료</Th>
                    <Th>원료 코드</Th>
                    <Th>원료 유형</Th>
                    <Th align="right" title="원료 LOT 잔량 합계">
                      잔량
                    </Th>
                    <Th align="right" title="확정된 발주 가운데 아직 입고되지 않은 양">
                      입고예정
                    </Th>
                    <Th align="right">잔량 있는 LOT</Th>
                    <Th>기본 야드</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr
                      key={r.itemId}
                      data-selected={selected?.itemId === r.itemId || undefined}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(r.itemId)}
                    >
                      <Td>
                        <button type="button" className="font-semibold text-ink hover:underline" onClick={() => setSelectedId(r.itemId)}>
                          {r.itemName}
                        </button>
                      </Td>
                      <Td className="font-mono text-mono">{r.itemCode}</Td>
                      <Td>{r.rawMaterialType ? RAW_MATERIAL_TYPE_LABEL[r.rawMaterialType] : '—'}</Td>
                      <Td align="right" className="font-semibold">
                        {fmtTon(r.remainingTon)}
                      </Td>
                      <Td align="right" className={decCmp(r.scheduledReceiptTon, 0) > 0 ? 'text-run' : 'text-ink-3'}>
                        {fmtTon(r.scheduledReceiptTon)}
                      </Td>
                      <Td align="right">{r.availableLotCount}개</Td>
                      <Td>{r.defaultYardName ?? '—'}</Td>
                    </tr>
                  ))}
                  {data.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <EmptyNote>등록된 원료가 없어요</EmptyNote>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </Table>
              <CardFoot>
                <TableCaption>원료는 톤(소수)으로 관리해요 · 잔량 = 원료 LOT 잔량 합계 · 입고예정 = 확정된 발주 가운데 아직 입고되지 않은 양</TableCaption>
              </CardFoot>
            </Card>
            {selected ? <RawMaterialLots row={selected} /> : null}
          </>
        );
      }}
    </QueryBoundary>
  );
}

function RawMaterialLots({ row }: { row: RawMaterialInventoryView }) {
  return (
    <Card className="flex-none overflow-x-auto">
      <CardHead title={`${row.itemName} LOT`} meta={`${row.lots.length}건 · 입고일 오래된 순 (선입선출 순)`} />
      <Table compact>
        <thead>
          <tr>
            <Th>LOT 번호</Th>
            <Th>입고일</Th>
            <Th>입고 번호</Th>
            <Th>공급업체</Th>
            <Th align="right">입고량</Th>
            <Th align="right">잔량</Th>
            <Th>야드</Th>
            <Th>상태</Th>
          </tr>
        </thead>
        <tbody>
          {row.lots.map((lot) => (
            <tr key={lot.lotId} data-muted={lot.lotStatus !== 'AVAILABLE' || undefined}>
              <Td>
                <LotNoLink lotNo={lot.lotNo} />
              </Td>
              <Td>{fmtDate(lot.receiptDate)}</Td>
              <Td className="font-mono text-mono">{lot.goodsReceiptNo ?? '—'}</Td>
              <Td>{lot.supplierName ?? '—'}</Td>
              <Td align="right" className="text-ink-2">
                {fmtTon(lot.initialTon)}
              </Td>
              <Td align="right" className="font-semibold">
                {fmtTon(lot.remainingTon)}
              </Td>
              <Td>{lot.yardName ?? '—'}</Td>
              <Td>
                <Badge tone={lotStatusTone(lot.lotStatus)}>{LOT_STATUS_LABEL[lot.lotStatus]}</Badge>
              </Td>
            </tr>
          ))}
          {row.lots.length === 0 ? (
            <tr>
              <td colSpan={8}>
                <EmptyNote>이 원료의 LOT이 없어요</EmptyNote>
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </Card>
  );
}
