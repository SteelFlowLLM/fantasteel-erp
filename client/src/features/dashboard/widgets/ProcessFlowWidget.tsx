// 공정 흐름 현황 (REQ-DSH-001): 수주 → 생산계획 → 검사 → 재고 → 출하요청 → 출고 단계별 건수.
// 볼 수 없는 단계는 숫자 대신 잠금으로 보인다(PROCESS_FLOW_STAGE_VIEW). 바로가기는 열 수 있는 화면만.
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import type { ProcessFlowData } from '@/api/dashboard';
import { Icon } from '@/components/Icon';
import { WidgetBody, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { SCREEN, canOpenScreen, type ScreenDef } from '@/features/shell/screens';
import { useDashboardWidget, useDashboardWidgetAccess } from '@/hooks/useDashboardWidget';
import { useMe } from '@/hooks/useMe';
import { fmtInt } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Stage {
  key: string;
  label: string;
  screen: ScreenDef;
  /** null = 볼 권한 없음 */
  value: ReactNode | null;
  detail?: string;
}

const count = (n: number, unit: string) => (
  <>
    {fmtInt(n)}
    <small className="ml-0.5 text-xs font-medium text-ink-3">{unit}</small>
  </>
);

function stagesOf(data: ProcessFlowData): Stage[] {
  const { salesOrders, productionPlans, inspections, inventories, shipmentRequests, goodsIssues } = data;
  return [
    { key: 'salesOrders', label: '진행 중 수주', screen: SCREEN.salesOrders, value: salesOrders && count(salesOrders.openCount, '건'), detail: salesOrders ? `납기 위험 ${salesOrders.dueRiskCount}건` : undefined },
    {
      key: 'productionPlans',
      label: '생산계획',
      screen: SCREEN.productionPlans,
      value: productionPlans && count(productionPlans.plannedCount + productionPlans.inProgressCount, '건'),
      detail: productionPlans ? `계획 ${productionPlans.plannedCount} · 진행중 ${productionPlans.inProgressCount}` : undefined,
    },
    {
      key: 'inspections',
      label: '판정 대기',
      screen: SCREEN.inspections,
      value: inspections && count(inspections.pendingCount, 'LOT'),
      detail: inspections ? `히트 ${inspections.heatCount} · 슬래브 ${inspections.slabCount} · 코일 ${inspections.coilCount}` : undefined,
    },
    {
      key: 'inventories',
      label: '제품 가용재고',
      screen: SCREEN.inventories,
      value: (
        <>
          {count(inventories.slabAvailableQty, '매')} <span className="text-ink-3">·</span> {count(inventories.coilAvailableQty, '개')}
        </>
      ),
      detail: '슬래브 · 코일',
    },
    {
      key: 'shipmentRequests',
      label: '출하요청',
      screen: SCREEN.shipmentRequests,
      value: shipmentRequests && count(shipmentRequests.requestedCount + shipmentRequests.allocatedCount, '건'),
      detail: shipmentRequests ? `배정 대기 ${shipmentRequests.requestedCount} · 배정 확정 ${shipmentRequests.allocatedCount}` : undefined,
    },
    {
      key: 'goodsIssues',
      label: '오늘 출고 확정',
      screen: SCREEN.goodsIssues,
      value: goodsIssues && count(goodsIssues.issuedRequestCount, '건'),
      detail: goodsIssues ? `LOT ${goodsIssues.issuedLotCount}개` : undefined,
    },
  ];
}

function FlowBody({ data }: { data: ProcessFlowData }) {
  const me = useMe();
  return (
    <div className="flex min-h-full items-stretch gap-1.5 px-4 py-3">
      {stagesOf(data).map((stage, index) => {
        const inner = (
          <>
            <span className="truncate text-cap font-medium text-ink-2" title={stage.label}>
              {stage.label}
            </span>
            {stage.value === null ? (
              <span className="flex items-center gap-1 text-xs text-ink-3" title="이 단계를 볼 권한이 없어요">
                <Icon name="lock" size="sm" />
                권한 없음
              </span>
            ) : (
              <span className="text-2xl font-semibold whitespace-nowrap tabular-nums">{stage.value}</span>
            )}
            {stage.value !== null && stage.detail ? (
              <span className="truncate text-cap text-ink-3" title={stage.detail}>
                {stage.detail}
              </span>
            ) : null}
          </>
        );
        const boxClass = 'flex min-w-[104px] flex-1 flex-col justify-center gap-1 rounded-md border border-line bg-surface-2 px-3 py-2';
        const canOpen = stage.value !== null && canOpenScreen(me, stage.screen.access);
        return (
          <Fragment key={stage.key}>
            {index > 0 ? <Icon name="chevron-right" size="sm" className="flex-none self-center text-ink-3" /> : null}
            {canOpen ? (
              <Link href={stage.screen.href} className={cn(boxClass, 'text-ink no-underline hover:border-run hover:bg-surface')}>
                {inner}
              </Link>
            ) : (
              <div className={boxClass}>{inner}</div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

export function ProcessFlowWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('PROCESS_FLOW');
  const query = useDashboardWidget('PROCESS_FLOW', access.allowed);
  return (
    <WidgetFrame widgetKey="PROCESS_FLOW" {...props} meta={query.data ? `${query.data.today} 기준` : null}>
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <FlowBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}
