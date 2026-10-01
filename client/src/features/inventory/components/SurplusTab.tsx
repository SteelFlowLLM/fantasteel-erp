// 여재 탭 (REQ-INV-008, 용어 사전 TRM-048·TRM-055, 업무 프로세스 4.3): 여재 = 수주에 쓰이지 않고 남은 미배정 합격 슬래브. 가용재고에 포함한다.
// 규격별로 미배정 합격·예약·가용재고·여재를 함께 보이고(4.3 구현 제안), 여재 슬래브 목록과 LOT 목록 탭의 '여재' 꼬리표는 같은 기준을 쓴다.
import { Banner } from '@/components/Banner';
import { Card, CardFoot, CardHead } from '@/components/Card';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { LotNoLink, PlanLink, Qty, SteelGradeSelect, TableCaption } from '@/features/inventory/components/InventoryParts';
import { useSurplusSlabs } from '@/hooks/useInventories';
import { fmtDate, fmtInt, fmtTon } from '@/lib/format';

export interface SurplusTabProps {
  steelGrade: string;
  onSteelGradeChange: (code: string) => void;
}

export function SurplusTab({ steelGrade, onSteelGradeChange }: SurplusTabProps) {
  const query = useSurplusSlabs();
  return (
    <>
      <div className="flex flex-none flex-wrap items-center gap-3">
        <SteelGradeSelect value={steelGrade} onChange={onSteelGradeChange} />
        {query.isFetching && query.data ? <span className="text-cap text-ink-3">새로 불러오는 중…</span> : null}
      </div>
      <QueryBoundary query={query} loadingLabel="여재를 불러오는 중…">
        {(data) => {
          const specs = data.filter((s) => !steelGrade || s.steelGradeCode === steelGrade);
          const lots = specs.flatMap((s) => s.lots.map((lot) => ({ ...lot, itemCode: s.itemCode, steelGradeCode: s.steelGradeCode, theoreticalWeightTon: s.theoreticalWeightTon })));
          const surplusSpecCount = specs.filter((s) => s.surplusQty > 0).length;
          const total = specs.reduce((acc, s) => acc + s.surplusQty, 0);
          return (
            <>
              <Banner tone="run" className="flex-none">
                여재는 수주에 쓰이지 않고 남은 미배정 합격 슬래브예요. <b>여재는 가용재고에 포함돼요</b> — 새 수주가 먼저 예약하고, 코일 계획의 열연 투입에도 쓸 수 있어요. 여재로 수주를 예약하면 그만큼 여재에서 빠져요.
              </Banner>
              <Card className="flex-none overflow-x-auto">
                <CardHead title="규격별 여재" meta={`${surplusSpecCount}개 규격 · ${fmtInt(total)}매`} />
                <Table compact>
                  <thead>
                    <tr>
                      <Th>규격</Th>
                      <Th>강종</Th>
                      <Th align="right" title="배정 확정되지 않은 합격 슬래브. 수주 예약 몫과 코일 계획의 열연 대기 슬래브도 들어 있어요">
                        미배정 합격
                      </Th>
                      <Th align="right" title="이 규격에 걸린 수주 예약 (유효). 예약은 LOT을 정하지 않고 규격 전체에 걸려요">
                        예약
                      </Th>
                      <Th align="right" title="이 규격의 가용재고 = 합격 − 예약 − 열연 배정">
                        가용재고
                      </Th>
                      <Th align="right" title="가용재고 매수 × 1매 이론중량">
                        가용재고 톤
                      </Th>
                      <Th align="right" title="여재로 전환된 미배정 합격 슬래브 중 수주 예약에 쓰이지 않은 매수 (가용재고 이하)">
                        여재
                      </Th>
                      <Th align="right" title="여재 매수 × 1매 이론중량">
                        여재 톤
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {specs.map((s) => (
                      <tr key={s.itemId} data-muted={s.surplusQty === 0 || undefined}>
                        <Td className="font-mono text-mono">{s.itemCode}</Td>
                        <Td className="font-mono text-mono">{s.steelGradeCode ?? '—'}</Td>
                        <Td align="right">
                          <Qty value={s.unallocatedPassedQty} unit="매" />
                        </Td>
                        <Td align="right">
                          <Qty value={s.reservedQty} unit="매" />
                        </Td>
                        <Td align="right">
                          <Qty value={s.availableQty} unit="매" />
                        </Td>
                        <Td align="right">{fmtTon(s.availableTon)}</Td>
                        <Td align="right">
                          <Qty value={s.surplusQty} unit="매" tone="ok" strong />
                        </Td>
                        <Td align="right">{fmtTon(s.surplusTon)}</Td>
                      </tr>
                    ))}
                    {specs.length === 0 ? (
                      <tr>
                        <td colSpan={8}>
                          <EmptyNote>여재가 없어요</EmptyNote>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </Table>
                <CardFoot>
                  <TableCaption>
                    미배정 합격에는 원래 수주의 예약 몫과 코일 계획의 열연 대기 슬래브도 들어 있어요 — 이들은 여재가 아니에요. 여재 = 여재로 전환된 미배정 합격 슬래브 중 수주
                    예약에 쓰이지 않은 매수라서 늘 가용재고 이하예요. 예약은 LOT을 정하지 않고 규격 전체에 걸려 있고 배정은 오래된 LOT부터 쓰이므로, 여재 슬래브는 여재 전환
                    LOT 중 최근 것부터 여재 매수만큼 보여요.
                  </TableCaption>
                </CardFoot>
              </Card>
              <Card className="flex-none overflow-x-auto">
                <CardHead title="여재 슬래브" meta={`${fmtInt(lots.length)}매 · 생산완료일 오래된 순 (선입선출 순)`} />
                <Table compact>
                  <thead>
                    <tr>
                      <Th>LOT 번호</Th>
                      <Th>규격</Th>
                      <Th>강종</Th>
                      <Th>히트</Th>
                      <Th>생산완료일</Th>
                      <Th title="수주에 쓰이지 않게 되어 여재로 바뀐 날">여재 전환일</Th>
                      <Th align="right">1매 이론중량</Th>
                      <Th>야드</Th>
                      <Th>생산계획</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map((lot) => (
                      <tr key={lot.lotId}>
                        <Td>
                          <LotNoLink lotNo={lot.lotNo} />
                        </Td>
                        <Td className="font-mono text-mono">{lot.itemCode}</Td>
                        <Td className="font-mono text-mono">{lot.steelGradeCode ?? '—'}</Td>
                        <Td>{lot.heatNo ? <LotNoLink lotNo={lot.heatNo} /> : <span className="text-ink-3">—</span>}</Td>
                        <Td>{fmtDate(lot.producedDate)}</Td>
                        <Td>{lot.surplusAt ? fmtDate(lot.surplusAt) : <span className="text-ink-3">—</span>}</Td>
                        <Td align="right">{fmtTon(lot.theoreticalWeightTon)}</Td>
                        <Td>{lot.yardName ?? '—'}</Td>
                        <Td>
                          <PlanLink planId={lot.productionPlanId} planNo={lot.productionPlanNo} />
                        </Td>
                      </tr>
                    ))}
                    {lots.length === 0 ? (
                      <tr>
                        <td colSpan={9}>
                          <EmptyNote>여재 슬래브가 없어요</EmptyNote>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </Table>
              </Card>
            </>
          );
        }}
      </QueryBoundary>
    </>
  );
}
