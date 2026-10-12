// 공정 흐름 현황 (REQ-DSH-001): 수주 → 생산계획 → 검사 → 재고 → 출하요청 → 출고 단계별 건수.
// 모든 사원이 6단계 건수를 본다. 눌러서 화면으로 가는 것은 그 화면을 열 권한이 있을 때만이고, 없으면 안내만 띄운다.
// (값이 null인 단계는 예전 서버 응답과의 호환용으로 잠금 표시를 남겨 둔다)
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import type { ProcessFlowData } from '@/api/dashboard';
import type { RoleCode } from '@/codes';
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
  /** 화면 도우미 펫이 이 칸을 읽을 때 쓰는 항목 종류 (용어 사전 변수명) */
  petItem: string;
  /** null = 볼 권한 없음 */
  value: ReactNode | null;
  detail?: string;
  /** 내 업무 단계가 0건일 때 보여 줄 말 (할 일이 없다는 것을 바로 알게) */
  emptyText?: string;
  /** 0건인지 보려고 두는 건수 (emptyText가 있는 단계만) */
  total?: number;
}

const count = (n: number, unit: string) => (
  <>
    {fmtInt(n)}
    <small className="ml-0.5 text-xs font-semibold text-ink-2">{unit}</small>
  </>
);

/** 역할마다 자기 업무 단계를 강조한다 (품질 = 판정 대기). 강조 칸은 누르면 그 업무 화면으로 간다 */
const MY_STAGE: Partial<Record<RoleCode, Stage['key']>> = {
  QUALITY: 'inspections',
};

function stagesOf(data: ProcessFlowData): Stage[] {
  const { salesOrders, productionPlans, inspections, inventories, shipmentRequests, goodsIssues } = data;
  return [
    { key: 'salesOrders', label: '진행 중 수주', screen: SCREEN.salesOrders, petItem: 'salesOrder', value: salesOrders && count(salesOrders.openCount, '건'), detail: salesOrders ? `납기 위험 ${salesOrders.dueRiskCount}건` : undefined },
    {
      key: 'productionPlans',
      label: '생산계획',
      screen: SCREEN.productionPlans,
      petItem: 'productionPlan',
      value: productionPlans && count(productionPlans.plannedCount + productionPlans.inProgressCount, '건'),
      detail: productionPlans ? `계획 ${productionPlans.plannedCount} · 진행중 ${productionPlans.inProgressCount}` : undefined,
    },
    {
      key: 'inspections',
      label: '판정 대기',
      screen: SCREEN.inspections,
      petItem: 'inspection',
      value: inspections && count(inspections.pendingCount, 'LOT'),
      detail: inspections ? `히트 ${inspections.heatCount} · 슬래브 ${inspections.slabCount} · 코일 ${inspections.coilCount}` : undefined,
      emptyText: '판정할 LOT 없음',
      total: inspections?.pendingCount,
    },
    {
      key: 'inventories',
      label: '제품 가용재고',
      screen: SCREEN.inventories,
      petItem: 'inventory',
      value: (
        <>
          {count(inventories.slabAvailableQty, '매')} <span className="text-ink-2">·</span> {count(inventories.coilAvailableQty, '개')}
        </>
      ),
      detail: '슬래브 · 코일',
    },
    {
      key: 'shipmentRequests',
      label: '출하요청',
      screen: SCREEN.shipmentRequests,
      petItem: 'shipmentRequest',
      value: shipmentRequests && count(shipmentRequests.requestedCount + shipmentRequests.allocatedCount, '건'),
      detail: shipmentRequests ? `배정 대기 ${shipmentRequests.requestedCount} · 배정 확정 ${shipmentRequests.allocatedCount}` : undefined,
    },
    {
      key: 'goodsIssues',
      label: '오늘 출고 확정',
      screen: SCREEN.goodsIssues,
      petItem: 'goodsIssue',
      value: goodsIssues && count(goodsIssues.issuedRequestCount, '건'),
      detail: goodsIssues ? `LOT ${goodsIssues.issuedLotCount}개` : undefined,
    },
  ];
}

function FlowBody({ data }: { data: ProcessFlowData }) {
  const me = useMe();
  const myStage = MY_STAGE[me.roleCode];
  const stages = stagesOf(data);
  // 내 업무가 0건이면 강조를 끈다: 할 일이 없을 때 가장 눈에 띄면, 할 일이 생겼을 때 차이가 느껴지지 않는다
  const mine = stages.find((stage) => stage.key === myStage);
  const highlight = mine !== undefined && !(mine.emptyText !== undefined && mine.total === 0);
  return (
    <div className="flex min-h-full items-stretch gap-1.5 px-4 py-3">
      {stages.map((stage, index) => {
        const isMine = stage.key === myStage;
        const isStrong = isMine && highlight;
        const isEmptyMine = isMine && !highlight;
        const inner = (
          <>
            <span className="flex min-w-0 items-center gap-1">
              <span className={cn('truncate text-xs font-semibold', isStrong ? 'text-run' : 'text-ink')} title={stage.label}>
                {stage.label}
              </span>
              {isMine ? (
                // 강조 칸은 배경이 run-bg라 같은 색 태그는 묻힌다: 진한 바탕에 흰 글자로. 0건이면 흰 칸이라 옅은 태그로 둔다
                <span
                  className={cn(
                    'inline-flex min-h-4 flex-none items-center rounded-full px-1.5 text-2xs font-semibold whitespace-nowrap',
                    isStrong ? 'bg-run text-white' : 'bg-run-bg text-run',
                  )}
                >
                  내 업무
                </span>
              ) : null}
            </span>
            {stage.value === null ? (
              <span className="flex items-center gap-1 text-xs text-ink-3" title="이 단계를 볼 권한이 없어요">
                <Icon name="lock" size="sm" />
                권한 없음
              </span>
            ) : (
              <span className={cn('font-bold whitespace-nowrap tabular-nums', isStrong ? 'text-[34px] leading-none text-run' : 'text-2xl text-ink')} data-pet-field={stage.label}>
                {stage.value}
              </span>
            )}
            {stage.value !== null && stage.detail ? (
              <span className="truncate text-cap font-medium text-ink-2" title={isEmptyMine ? `${stage.emptyText} · ${stage.detail}` : stage.detail} data-pet-field="세부">
                {/* 0건이면 내역도 모두 0이라 할 일이 없다는 말만 둔다 (내역은 마우스를 올리면 보인다) */}
                {isEmptyMine ? (
                  <span className="font-semibold text-ok">
                    <Icon name="check" size="sm" className="mr-0.5 align-[-2px]" />
                    {stage.emptyText}
                  </span>
                ) : (
                  stage.detail
                )}
              </span>
            ) : null}
          </>
        );
        const boxClass = cn(
          'flex min-w-[104px] flex-col justify-center gap-1 rounded-md border px-3 py-2',
          // 테두리를 굵게 하면 칸 크기가 달라지므로 바깥 그림자로 강조한다 (입력칸 포커스와 같은 방식). 내 업무 칸은 조금 넓게
          isStrong ? 'flex-[1.35] border-run bg-run-bg shadow-[0_0_0_1px_var(--color-run),0_0_0_5px_var(--color-run-bg)]' : 'flex-1 border-line-strong bg-surface',
          // 내 업무를 강조할 때만 나머지 단계를 흐리게 (숫자·바로가기는 그대로, 올리면 또렷하게)
          highlight && !isMine && 'opacity-60 hover:opacity-100',
        );
        const canOpen = stage.value !== null && canOpenScreen(me, stage.screen.access);
        return (
          <Fragment key={stage.key}>
            {index > 0 ? <Icon name="chevron-right" size="sm" className="flex-none self-center text-ink-2" /> : null}
            {canOpen ? (
              <Link href={stage.screen.href} data-pet-perch={`stage:${stage.key}`} data-pet-item={stage.petItem} data-pet-item-title={stage.label} className={cn(boxClass, 'text-ink no-underline hover:border-run hover:bg-surface')}>
                {inner}
              </Link>
            ) : (
              <div data-pet-perch={`stage:${stage.key}`} data-pet-item={stage.petItem} data-pet-item-title={stage.label} className={boxClass} title={stage.value !== null ? `${stage.screen.label} 화면을 열 권한이 없어요` : undefined}>
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
