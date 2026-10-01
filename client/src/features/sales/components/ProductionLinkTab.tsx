'use client';

// 수주 상세 · 생산 연결 탭 (REQ-PRD-001·002): 연결된 생산계획의 편성표와 편성 히트.
// 수주 취소로 연결이 풀린 진행 계획도 '연결 해제'로 함께 보인다(작업 로그 기준).
import Link from 'next/link';
import { INSPECTION_RESULT_LABEL } from '@/codes';
import type { SalesOrderPlanLink } from '@/api/salesOrders';
import { Badge } from '@/components/Badge';
import { ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { KvList } from '@/components/KvList';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Tag } from '@/components/Tag';
import { useSalesOrderProductionLinks } from '@/hooks/useSalesOrders';
import { fmtDate, fmtNum, fmtTon } from '@/lib/format';
import { INSPECTION_RESULT_TONE } from '@/lib/statusTone';
import { PlanLink, PlanStatusBadge } from '@/features/sales/components/SalesOrderParts';
import { qtyUnitOf } from '@/features/sales/lib/salesOrderForm';

function PlanCard({ link }: { link: SalesOrderPlanLink }) {
  const { plan } = link;
  const unit = qtyUnitOf([plan.item.itemType]);
  const f = plan.formation;
  return (
    <Card>
      <CardHead
        title={<PlanLink productionPlanId={plan.id} productionPlanNo={plan.productionPlanNo} />}
        meta={link.lineNo !== null ? `품목 ${link.lineNo} · ${plan.item.itemName}` : `${plan.item.itemName} · 수주 연결 해제`}
        actions={
          <span className="flex items-center gap-1">
            {plan.isReproduction ? <Tag tone="outline">재생산</Tag> : null}
            {plan.isSurplusOnCompletion ? <Tag tone="outline">완료 후 여재</Tag> : null}
            <PlanStatusBadge status={plan.productionPlanStatus} />
            {plan.productionPlanStatus === 'CANCELLED' ? null : (
              <ButtonLink href={`/production/results?plan=${plan.id}`} size="sm" icon="factory">
                작업 실적
              </ButtonLink>
            )}
          </span>
        }
      />
      <CardBody>
        {f ? (
          <KvList
            columns={3}
            items={[
              { label: '부족 매수', value: `${f.shortageQty}${unit}` },
              { label: '수주 목표', value: fmtTon(f.targetWeightTon) },
              { label: '누적 계획수율', value: fmtNum(f.cumulativeYieldRate, 4) },
              { label: '필요 용강량', value: fmtTon(f.requiredSteelTon) },
              { label: '히트 수', value: `${f.heatCount}개 × ${fmtTon(f.heatCapacityTon)}` },
              { label: '히트 전체 톤', value: fmtTon(f.heatTon) },
              { label: '히트당 슬래브', value: `${f.slabQtyPerHeat}매` },
              { label: '계획 슬래브', value: `${f.plannedSlabQty}매` },
              { label: '예상 슬래브 여재', value: `${f.expectedSurplusSlabQty}매` },
            ]}
          />
        ) : (
          <EmptyNote className="py-2">편성표를 계산할 수 없어요 (계획 수율·배합 원단위·규격 매핑 확인 필요)</EmptyNote>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-cap text-ink-2 tabular-nums">
          <span>
            제강 {plan.progress.heatsMadeQty}/{plan.progress.heatCount} 히트
          </span>
          <span>
            연주 {plan.progress.heatsCastQty}/{plan.progress.heatCount} 히트
          </span>
          <span>슬래브 {plan.progress.slabQty}매</span>
          {plan.item.itemType === 'COIL' ? <span>코일 {plan.progress.coilQty}개</span> : null}
          <span className="text-ok">
            합격 {plan.progress.passedQty}
            {unit}
          </span>
          <span className="text-wait">
            판정 대기 {plan.progress.pendingQty}
            {unit}
          </span>
          <span className="text-danger">
            불합격 {plan.progress.failedQty}
            {unit}
          </span>
          <b className="font-semibold text-ink">
            잔여 목표 {plan.progress.remainingTargetQty}
            {unit}
          </b>
        </div>
        <Table compact>
          <thead>
            <tr>
              <Th align="right">순번</Th>
              <Th>히트 번호</Th>
              <Th>전로</Th>
              <Th>생산일</Th>
              <Th align="right">히트 톤</Th>
              <Th>성분 판정</Th>
              <Th>연주</Th>
              <Th align="right">슬래브</Th>
            </tr>
          </thead>
          <tbody>
            {plan.heats.map((heat) => (
              <tr key={heat.seq}>
                <Td align="right" className="tabular-nums">
                  {heat.seq}
                </Td>
                <Td>
                  {heat.heatLotNo ? (
                    <Link href={`/lots/trace?lot=${encodeURIComponent(heat.heatLotNo)}`} className="font-mono text-xs font-medium text-run hover:underline">
                      {heat.heatLotNo}
                    </Link>
                  ) : (
                    <span className="text-cap text-ink-3">제강 전</span>
                  )}
                </Td>
                <Td className="font-mono text-xs">{heat.converterCode ?? '-'}</Td>
                <Td className="tabular-nums">{heat.producedDate ? fmtDate(heat.producedDate) : '-'}</Td>
                <Td align="right" className="tabular-nums">
                  {heat.heatTon ? fmtTon(heat.heatTon) : '-'}
                </Td>
                <Td>
                  {heat.inspectionResult ? (
                    <Badge tone={INSPECTION_RESULT_TONE[heat.inspectionResult]}>
                      {INSPECTION_RESULT_LABEL[heat.inspectionResult]}
                    </Badge>
                  ) : (
                    '-'
                  )}
                </Td>
                <Td>{heat.castDone ? <Badge tone="ok">완료</Badge> : <span className="text-cap text-ink-3">전</span>}</Td>
                <Td align="right" className="tabular-nums">
                  {heat.slabQty}매
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}

export function ProductionLinkTab({ salesOrderId }: { salesOrderId: number }) {
  const links = useSalesOrderProductionLinks(salesOrderId);
  return (
    <QueryBoundary query={links} loadingLabel="생산 연결을 불러오는 중…">
      {(rows) =>
        rows.length === 0 ? (
          <EmptyNote className="py-8">연결된 생산계획이 없어요 · 재고로 모두 예약됐거나 부족 매수가 없어요</EmptyNote>
        ) : (
          <div className="flex flex-col gap-4">
            {rows.map((link) => (
              <PlanCard key={link.plan.id} link={link} />
            ))}
            <p className="text-cap text-ink-3">작업 실적과 실적 시뮬레이션은 작업 실적 화면에서 해요. 예약은 LOT을 정하지 않고, LOT은 출하요청 때 배정해요.</p>
          </div>
        )
      }
    </QueryBoundary>
  );
}
