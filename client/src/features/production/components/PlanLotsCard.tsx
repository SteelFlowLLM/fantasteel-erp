'use client';

// 생산계획에서 나온 LOT (용선·히트·슬래브·코일). 생산완료일은 날짜로 보인다 (컨벤션 5장).
// 판정 대기 LOT은 검사 입력(/quality/inspections?lot=<LOT id>)으로 간다. 자기는 합격이고 히트만 판정 대기면 히트의 검사로 간다.
import Link from 'next/link';
import { useState } from 'react';
import { LOT_TYPE_LABEL, type LotType } from '@/codes';
import type { PlanLotRow } from '@/api/production';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { LotQualityBadge, lotStateText } from '@/features/production/components/PlanBadges';
import { fmtTon } from '@/lib/format';

const TYPES: LotType[] = ['HOT_METAL', 'HEAT', 'SLAB', 'COIL'];
const SHOW_LIMIT = 40;

/** 검사 입력 화면 주소 (quality InspectionWorkspace의 inspectionHref와 같은 모양: 숫자 LOT id) */
export function inspectionHrefOf(lot: Pick<PlanLotRow, 'id' | 'quality' | 'heatLotId'>): string | null {
  if (lot.quality === 'PENDING') return `/quality/inspections?lot=${lot.id}`;
  if (lot.quality === 'HEAT_PENDING' && lot.heatLotId !== null) return `/quality/inspections?lot=${lot.heatLotId}`;
  return null;
}

function tonText(lot: PlanLotRow): string {
  if (lot.lotType === 'HOT_METAL') return `${fmtTon(lot.initialTon)} · 잔량 ${fmtTon(lot.remainingTon)}`;
  if (lot.lotType === 'HEAT') return fmtTon(lot.initialTon);
  return lot.itemCode ?? '-';
}

export function PlanLotsCard({ lots }: { lots: readonly PlanLotRow[] }) {
  const present = TYPES.filter((t) => lots.some((l) => l.lotType === t));
  const [picked, setPicked] = useState<LotType | null>(null);
  const [showAll, setShowAll] = useState(false);
  const type = picked && present.includes(picked) ? picked : (present[present.length - 1] ?? 'SLAB');
  const rows = lots.filter((l) => l.lotType === type);
  const visible = showAll ? rows : rows.slice(0, SHOW_LIMIT);
  return (
    <Card>
      <CardHead
        title="생산 LOT"
        meta={`${lots.length}개`}
        actions={TYPES.map((t) => (
          <Chip key={t} on={t === type} onClick={() => setPicked(t)} disabled={!present.includes(t)}>
            {LOT_TYPE_LABEL[t]} <b>{lots.filter((l) => l.lotType === t).length}</b>
          </Chip>
        ))}
      />
      <CardBody flush>
        {rows.length === 0 ? (
          <EmptyNote>아직 만든 {LOT_TYPE_LABEL[type]} LOT이 없어요</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <Table compact>
              <thead>
                <tr>
                  <Th>LOT</Th>
                  {type === 'SLAB' || type === 'COIL' ? <Th>히트</Th> : null}
                  <Th>{type === 'HOT_METAL' ? '용선량 · 잔량' : type === 'HEAT' ? '히트 톤' : '규격'}</Th>
                  <Th>품질</Th>
                  <Th>상태</Th>
                  <Th>야드</Th>
                  <Th>생산완료일</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((lot) => (
                  <tr key={lot.id} data-risk={lot.quality === 'FAIL' || lot.quality === 'HEAT_FAILED' ? true : undefined}>
                    <Td>
                      <Link href={`/lots/trace?lot=${encodeURIComponent(lot.lotNo)}`} className="font-mono text-mono text-run hover:underline">
                        {lot.lotNo}
                      </Link>
                    </Td>
                    {type === 'SLAB' || type === 'COIL' ? <Td className="font-mono text-mono text-ink-2">{lot.heatLotNo ?? '-'}</Td> : null}
                    <Td className={type === 'SLAB' || type === 'COIL' ? 'font-mono text-mono' : undefined}>{tonText(lot)}</Td>
                    <Td>
                      {inspectionHrefOf(lot) ? (
                        <Link href={inspectionHrefOf(lot) ?? ''} title={lot.quality === 'HEAT_PENDING' ? '히트 검사 입력으로 가기' : '검사 입력으로 가기'}>
                          <LotQualityBadge quality={lot.quality} />
                        </Link>
                      ) : (
                        <LotQualityBadge quality={lot.quality} />
                      )}
                    </Td>
                    <Td>{lotStateText(lot)}</Td>
                    <Td>{lot.yardName ?? '-'}</Td>
                    <Td>{lot.producedDate}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {rows.length > SHOW_LIMIT ? (
          <button type="button" className="h-9 border-t border-line text-xs font-medium text-run hover:bg-surface-2" onClick={() => setShowAll((v) => !v)}>
            {showAll ? '접기' : `모두 보기 (${rows.length}개)`}
          </button>
        ) : null}
      </CardBody>
    </Card>
  );
}
