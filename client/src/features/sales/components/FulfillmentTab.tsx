'use client';

// 수주 상세 · 충족 현황 탭 (REQ-SO-004, 업무 프로세스 4.5): 품목별 예약·생산중·검사합격·출하를 지표마다 분모와 함께 보인다.
// 단계를 더해 수주보다 큰 숫자를 만들지 않는다. 재생산 필요 매수가 있으면 생산 담당이 재생산 계획을 만든다(REQ-PRD-006, 자동 없음).
import Link from 'next/link';
import { useState } from 'react';
import { PERMISSION, RESERVATION_STATUS_LABEL, SHIPMENT_REQUEST_STATUS_LABEL, type ShipmentRequestStatus } from '@/codes';
import { salesOrderApi, type ItemFulfillment, type SalesOrderDetail } from '@/api/salesOrders';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { useAction } from '@/hooks/useAction';
import { useCanUse } from '@/hooks/usePermission';
import { fmtDate, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';
import { SHIPMENT_REQUEST_STATUS_TONE } from '@/lib/statusTone';
import { sumTon } from '@/lib/weight';
import { ShipmentRequestButton, WorkRoomButton } from '@/features/sales/components/SalesOrderActions';
import { DueRiskBadge, DueText, ItemLabel, MeasureBar, PlanLink, SalesOrderStatusBadge } from '@/features/sales/components/SalesOrderParts';
import { qtyUnitOf } from '@/features/sales/lib/salesOrderForm';

const isShipmentRequestStatus = (value: string): value is ShipmentRequestStatus => value in SHIPMENT_REQUEST_STATUS_LABEL;

function ReproductionBanner({ item }: { item: ItemFulfillment }) {
  const canPlan = useCanUse(PERMISSION.PRODUCTION_PLAN_CONFIRM);
  const [confirming, setConfirming] = useState(false);
  const unit = qtyUnitOf([item.itemType]);
  const create = useAction(salesOrderApi.createReproduction, {
    success: (r) =>
      r.productionPlanNo
        ? `${r.productionPlanNo} 재생산 계획을 만들었어요 · 부족 ${r.shortageQty}${unit}${r.reservedFromSurplusQty > 0 ? ` · 여재 ${r.reservedFromSurplusQty}${unit} 먼저 예약` : ''}`
        : `여재 ${r.reservedFromSurplusQty}${unit}를 예약해 재생산이 필요 없어졌어요`,
    onSuccess: () => setConfirming(false),
  });
  const reproductionNeedQty = item.shortage.reproductionNeedQty;
  return (
    <>
      <Banner
        tone="danger"
        actions={
          <Button
            size="sm"
            variant="danger"
            icon="factory"
            disabled={!canPlan || create.isPending}
            title={canPlan ? undefined : permissionNeedText([PERMISSION.PRODUCTION_PLAN_CONFIRM])}
            onClick={() => setConfirming(true)}
          >
            재생산 계획 만들기
          </Button>
        }
      >
        <b>
          품목 {item.lineNo} · 재생산 필요 {reproductionNeedQty}
          {unit}
        </b>{' '}
        — 미확보 {item.shortage.unsecuredQty}
        {unit} 가운데 진행중인 생산계획({item.shortage.openPlanRemainingQty}
        {unit})과 같은 규격 예약 가용({item.shortage.reservationAvailableQty}
        {unit})으로도 채우지 못하는 매수예요.
      </Banner>
      {confirming ? (
        <ConfirmDialog
          title={`재생산 계획 · 품목 ${item.lineNo}`}
          confirmLabel="재생산 계획 만들기"
          pending={create.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => create.mutate({ salesOrderItemId: item.salesOrderItemId })}
        >
          같은 규격 여재가 있으면 먼저 예약하고, 그래도 모자라는 매수만 재생산 계획(히트 편성 포함)으로 만들어요. 작업 로그에 &lsquo;재생산 계획 생성&rsquo;으로
          남아요.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

export function FulfillmentTab({ detail }: { detail: SalesOrderDetail }) {
  const unit = qtyUnitOf(detail.itemTypes);
  const salesOrderCancelled = detail.status === 'CANCELLED';
  const live = detail.items.filter((i) => i.salesOrderItemStatus !== 'CANCELLED');
  const sum = (pick: (i: ItemFulfillment) => number) => detail.items.reduce((s, i) => s + pick(i), 0);
  const additional = live.filter((i) => i.shortage.additionalPlanQty > 0 && i.shortage.reproductionNeedQty === 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="overflow-auto">
          <Table>
            <thead>
              <tr>
                <Th>품목</Th>
                <Th align="right">수주 매수</Th>
                <Th align="right" title="매수 × 1매 이론중량 계산값">
                  톤 (계산값)
                </Th>
                <Th>납기</Th>
                <Th title={`${RESERVATION_STATUS_LABEL.ACTIVE} 매수 ÷ 미출하 매수`}>예약 ÷ 미출하</Th>
                <Th title="진행중·완료 생산계획의 잔여 목표 ÷ 수주 매수">생산중 ÷ 수주</Th>
                <Th title="이 품목 몫으로 확보한 합격 제품(예약 + 출하) ÷ 수주 매수">검사합격 ÷ 수주</Th>
                <Th title="출고 확정 매수 ÷ 수주 매수">출하 ÷ 수주</Th>
                <Th align="right" title="미출하 − 예약 (0 아래로 내려가지 않음)">
                  미확보
                </Th>
                <Th align="right" title="미확보 − 진행 계획 잔여 목표">
                  추가 계획 필요
                </Th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => {
                const itemUnit = qtyUnitOf([item.itemType]);
                const cancelled = item.salesOrderItemStatus === 'CANCELLED';
                return (
                  <tr key={item.salesOrderItemId} data-muted={cancelled} data-risk={item.isDueRisk}>
                    <Td className="max-w-[260px]">
                      <span className="flex flex-col gap-1 py-1.5">
                        <ItemLabel lineNo={item.lineNo} itemType={item.itemType} itemName={item.itemName} />
                        <span className="flex items-center gap-1">
                          <SalesOrderStatusBadge status={item.salesOrderItemStatus} />
                          {item.isDueRisk ? <DueRiskBadge /> : null}
                          <span className="font-mono text-[11px] text-ink-3">{item.itemCode}</span>
                        </span>
                      </span>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {item.orderedQty}
                      <small className="ml-px text-cap text-ink-3">{itemUnit}</small>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {fmtTon(item.orderedTon)}
                    </Td>
                    <Td>
                      <DueText dueDate={item.dueDate} risk={item.isDueRisk} done={cancelled || item.salesOrderItemStatus === 'SHIPPED'} />
                    </Td>
                    <Td>
                      <MeasureBar label="예약" unit={itemUnit} tone="brand" measure={item.measures.reserved} />
                    </Td>
                    <Td>
                      <MeasureBar label="생산중" unit={itemUnit} tone="muted" measure={item.measures.inProduction} />
                    </Td>
                    <Td>
                      <MeasureBar label="검사합격" unit={itemUnit} tone="ok" measure={item.measures.passed} />
                    </Td>
                    <Td>
                      <MeasureBar label="출하" unit={itemUnit} tone="run" measure={item.measures.shipped} />
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {cancelled ? '-' : `${item.shortage.unsecuredQty}${itemUnit}`}
                    </Td>
                    <Td align="right" className={item.shortage.additionalPlanQty > 0 ? 'font-semibold text-danger tabular-nums' : 'tabular-nums'}>
                      {cancelled ? '-' : `${item.shortage.additionalPlanQty}${itemUnit}`}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td>합계</Td>
                <Td align="right" className="tabular-nums">
                  {detail.totalOrderedQty}
                  {unit}
                </Td>
                <Td align="right" className="tabular-nums">
                  {fmtTon(sumTon(detail.items.map((i) => i.orderedTon)))}
                </Td>
                <Td />
                <Td className="tabular-nums">
                  {sum((i) => i.activeReservedQty)} / {sum((i) => i.shortage.unshippedQty)}
                  {unit}
                </Td>
                <Td className="tabular-nums">
                  {sum((i) => i.inProductionQty)} / {detail.totalOrderedQty}
                  {unit}
                </Td>
                <Td className="tabular-nums">
                  {sum((i) => i.securedQty)} / {detail.totalOrderedQty}
                  {unit}
                </Td>
                <Td className="tabular-nums">
                  {detail.totalShippedQty} / {detail.totalOrderedQty}
                  {unit}
                </Td>
                <Td align="right" className="tabular-nums">
                  {sum((i) => (i.salesOrderItemStatus === 'CANCELLED' ? 0 : i.shortage.unsecuredQty))}
                  {unit}
                </Td>
                <Td align="right" className="tabular-nums">
                  {sum((i) => (i.salesOrderItemStatus === 'CANCELLED' ? 0 : i.shortage.additionalPlanQty))}
                  {unit}
                </Td>
              </tr>
            </tfoot>
          </Table>
        </div>
        <div className="border-t border-line px-4 py-2.5 text-cap leading-[18px] text-ink-3">
          지표마다 분모가 달라요. 예약은 미출하 매수로, 생산중·검사합격·출하는 수주 매수로 나눠요. 검사합격은 이 품목 몫으로 확보한 합격 제품(예약 + 출하)이라
          예약과 겹쳐요 — 지표를 더하지 않아요. 미확보 = 미출하 − 예약, 추가 계획 필요 = 미확보 − 진행 계획 잔여 목표.
        </div>
      </Card>

      {live
        .filter((item) => item.shortage.reproductionNeedQty > 0)
        .map((item) => (
          <ReproductionBanner key={item.salesOrderItemId} item={item} />
        ))}
      {additional.map((item) => (
        <Banner key={item.salesOrderItemId} tone="wait">
          <b>
            품목 {item.lineNo} · 추가 계획 필요 {item.shortage.additionalPlanQty}
            {qtyUnitOf([item.itemType])}
          </b>{' '}
          — 같은 규격 예약 가용 {item.shortage.reservationAvailableQty}
          {qtyUnitOf([item.itemType])}로 채울 수 있어서 재생산은 필요 없어요. 합격 제품은 검사 뒤 자동 예약돼요.
        </Banner>
      ))}

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        <Card>
          <CardHead title="출하 준비" meta="출하요청·밀시트" actions={<ShipmentRequestButton summary={detail} />} />
          <CardBody>
            <ul className="flex flex-col gap-1 text-sm">
              {live.map((item) => (
                <li key={item.salesOrderItemId} className="flex items-center gap-2">
                  <ItemLabel lineNo={item.lineNo} itemType={item.itemType} itemName={item.itemName} />
                  <span className="ml-auto text-cap text-ink-2 tabular-nums">
                    {item.activeReservedQty > 0 ? `예약 ${item.activeReservedQty}${qtyUnitOf([item.itemType])} 출하 가능` : '확보된 매수 없음'}
                  </span>
                </li>
              ))}
            </ul>
            {salesOrderCancelled ? null : <span className="text-cap text-ink-3">LOT은 출하요청 때 FIFO(생산완료일 오래된 순)로 추천받아 확정해요.</span>}
            {detail.shipmentRequests.length === 0 ? (
              <EmptyNote className="py-2">이 수주의 출하요청이 없어요</EmptyNote>
            ) : (
              <Table compact>
                <thead>
                  <tr>
                    <Th>출하요청 번호</Th>
                    <Th>상태</Th>
                    <Th>출하 요청일</Th>
                    <Th>품목별 요청 · 배정</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.shipmentRequests.map((request) => (
                    <tr key={request.id}>
                      <Td>
                        <Link href={`/shipment-requests/${request.id}`} className="font-mono text-xs font-medium text-run hover:underline">
                          {request.shipmentRequestNo}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={isShipmentRequestStatus(request.shipmentRequestStatus) ? SHIPMENT_REQUEST_STATUS_TONE[request.shipmentRequestStatus] : 'neutral'}>
                          {isShipmentRequestStatus(request.shipmentRequestStatus)
                            ? SHIPMENT_REQUEST_STATUS_LABEL[request.shipmentRequestStatus]
                            : request.shipmentRequestStatus}
                        </Badge>
                      </Td>
                      <Td className="tabular-nums">{fmtDate(request.requestedShipDate)}</Td>
                      <Td className="text-xs text-ink-2">
                        {request.lines.map((line) => `품목 ${line.lineNo}: ${line.requestQty} · 배정 ${line.allocatedQty}`).join(' / ')}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {detail.millSheets.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-ink-3">밀시트</span>
                {detail.millSheets.map((sheet) => (
                  <Link key={sheet.id} href={`/mill-sheets?id=${sheet.id}`} className="font-mono font-medium text-run hover:underline">
                    {sheet.millSheetNo}
                  </Link>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHead title="업무방" />
          <CardBody>
            <p className="text-sm leading-5 text-ink-2">
              {detail.workRoomId !== null
                ? '이 수주의 업무방이 있어요. 함께할 사람을 더하거나 메신저로 갈 수 있어요.'
                : salesOrderCancelled
                  ? '취소된 수주라 업무방을 새로 열지 않아요.'
                  : '아직 업무방이 없어요. 열면 이 수주와 연결된 방이 만들어지고, 멤버는 조직도에서 골라요.'}
            </p>
            <div>
              <WorkRoomButton salesOrderId={detail.id} salesOrderNo={detail.salesOrderNo} hasRoom={detail.workRoomId !== null} cancelled={salesOrderCancelled} />
            </div>
          </CardBody>
        </Card>
      </div>

      {detail.items.some((i) => i.plans.length > 0) ? (
        <Card>
          <CardHead title="품목별 생산계획" meta="자세한 편성은 생산 연결 탭" />
          <CardBody>
            {detail.items.map((item) =>
              item.plans.map((plan) => (
                <div key={plan.productionPlanId} className="flex items-center gap-2 text-xs">
                  <span className="text-ink-3">품목 {item.lineNo}</span>
                  <PlanLink productionPlanId={plan.productionPlanId} productionPlanNo={plan.productionPlanNo} />
                  <span className="text-ink-2">
                    부족 {plan.shortageQty} · 잔여 목표 {plan.remainingTargetQty} · 히트 {plan.heatCount}
                  </span>
                </div>
              )),
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
