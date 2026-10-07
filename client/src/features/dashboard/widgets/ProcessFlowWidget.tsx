// 공정 흐름 현황 (REQ-DSH-001): 수주 → 생산계획 → 검사 → 재고 → 출하요청 → 출고 단계별 건수.
// 모든 사원이 6단계 건수를 본다. 눌러서 화면으로 가는 것은 그 화면을 열 권한이 있을 때만이고, 없으면 안내만 띄운다.
// (값이 null인 단계는 예전 서버 응답과의 호환용으로 잠금 표시를 남겨 둔다)
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import type { ProcessFlowData } from '@/api/dashboard';
import type { RoleCode } from '@/codes';
import { Icon } from '@/components/Icon';
import { Tag } from '@/components/Tag';
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

/** 역할마다 자기 업무 단계를 강조한다 (품질 = 판정 대기). 강조 칸은 누르면 그 업무 화면으로 간다 */
const MY_STAGE: Partial<Record<RoleCode, Stage['key']>> = {
  QUALITY: 'inspections',
};

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
  const myStage = MY_STAGE[me.roleCode];
  return (
    <div className="flex min-h-full items-stretch gap-1.5 px-4 py-3">
      {stagesOf(data).map((stage, index) => {
        const isMine = stage.key === myStage;
        const inner = (
          <>
            <span className="flex min-w-0 items-center gap-1">
              <span className={cn('truncate text-cap font-medium', isMine ? 'text-run' : 'text-ink-2')} title={stage.label}>
                {stage.label}
              </span>
              {isMine ? (
                <Tag size="sm" tone="run" className="flex-none">
                  내 업무
                </Tag>
              ) : null}
            </span>
            {stage.value === null ? (
              <span className="flex items-center gap-1 text-xs text-ink-3" title="이 단계를 볼 권한이 없어요">
                <Icon name="lock" size="sm" />
                권한 없음
              </span>
            ) : (
              <span className={cn('text-2xl font-semibold whitespace-nowrap tabular-nums', isMine && 'text-run')}>{stage.value}</span>
            )}
            {stage.value !== null && stage.detail ? (
              <span className="truncate text-cap text-ink-3" title={stage.detail}>
                {stage.detail}
              </span>
            ) : null}
          </>
        );
        const boxClass = cn(
          'flex min-w-[104px] flex-1 flex-col justify-center gap-1 rounded-md border px-3 py-2',
          // 테두리를 굵게 하면 칸 크기가 달라지므로 바깥 그림자로 강조한다 (입력칸 포커스와 같은 방식)
          isMine ? 'border-run bg-run-bg shadow-[0_0_0_1px_var(--color-run)]' : 'border-line bg-surface-2',
        );
        const canOpen = stage.value !== null && canOpenScreen(me, stage.screen.access);
        return (
          <Fragment key={stage.key}>
            {index > 0 ? <Icon name="chevron-right" size="sm" className="flex-none self-center text-ink-3" /> : null}
            {canOpen ? (
              <Link href={stage.screen.href} className={cn(boxClass, 'text-ink no-underline hover:border-run hover:bg-surface')}>
                {inner}
              </Link>
            ) : (
              <div className={boxClass} title={stage.value !== null ? `${stage.screen.label} 화면을 열 권한이 없어요` : undefined}>
                {inner}
              </div>
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
