'use client';

// 불합격 LOT의 영향과 시스템이 같이 처리한 것 + 영향받는 수주 품목의 부족과 재생산 (BP-QC-01, 4.5, REQ-PRD-006, 14.1-6).
// 재생산은 자동으로 만들지 않는다. 여재와 진행 중인 계획으로도 부족할 때만 '재생산 필요 N매'와 만들기 버튼을 보인다(생산계획·히트 편성 사용 권한).
import Link from 'next/link';
import { useState } from 'react';
import type { LinkedPlan, RejectedLotDetail } from '@/api/dispositions';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { KvList } from '@/components/KvList';
import { Tag } from '@/components/Tag';
import { PERMISSION, PRODUCTION_PLAN_STATUS_LABEL } from '@/codes';
import { lotTraceHref } from '@/features/quality/components/LotHeader';
import { useCreateReproductionPlan } from '@/hooks/useDispositions';
import { useCanUse } from '@/hooks/usePermission';
import { permissionNeedText } from '@/lib/permissions';

function PlanChip({ plan }: { plan: LinkedPlan }) {
  return (
    <Link
      href={`/production/plans?plan=${plan.productionPlanId}`}
      className="inline-flex h-7 items-center gap-1.5 rounded-[14px] border border-line-strong bg-surface px-2.5 text-xs font-medium text-run hover:bg-surface-2"
    >
      <span className="font-mono">{plan.productionPlanNo}</span>
      {plan.isReproduction ? <Tag size="sm" tone="run">재생산</Tag> : null}
      <span className="text-ink-2">
        {PRODUCTION_PLAN_STATUS_LABEL[plan.productionPlanStatus]} · 부족 {plan.shortageQty}매
      </span>
    </Link>
  );
}

export function ImpactCard({ detail }: { detail: RejectedLotDetail }) {
  const { row, plans } = detail;
  const soItem = row.salesOrderItem;
  const shortage = soItem?.shortage ?? null;
  const canPlan = useCanUse(PERMISSION.PRODUCTION_PLAN_CONFIRM);
  const reproduce = useCreateReproductionPlan();
  const [confirming, setConfirming] = useState(false);

  return (
    <Card className="flex-none">
      <CardHead title="영향과 자동 처리" meta="불합격 판정 때 시스템이 처리한 것" />
      <CardBody className="gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone="run">시스템</Tag>
          <span className="inline-flex h-[26px] items-center gap-1.5 rounded-[13px] border border-line-strong bg-surface px-2.5 text-xs text-ink-2">
            <Icon name="lock" size="sm" />
            예약·배정·출고 대상에서 제외
          </span>
          {row.lotType === 'HEAT' ? (
            <span className="inline-flex h-[26px] items-center gap-1.5 rounded-[13px] border border-line-strong bg-surface px-2.5 text-xs text-ink-2">
              <Icon name="link" size="sm" />
              하위 슬래브·코일 사용 불가
            </span>
          ) : null}
        </div>

        {soItem && shortage ? (
          <div className="flex flex-col gap-2">
            <span className="text-cap text-ink-3">
              영향받는 수주 품목 {soItem.salesOrderNo} 품목 {soItem.lineNo} · {soItem.itemCode}
            </span>
            <KvList
              items={[
                { label: '미출하', value: `${shortage.unshippedQty}매` },
                { label: '예약', value: `${shortage.activeReservedQty}매` },
                { label: '미확보', value: `${shortage.unsecuredQty}매` },
                { label: '진행 계획 잔여 목표', value: `${shortage.openPlanRemainingQty}매` },
                { label: '같은 규격 예약 가용 (여재 포함)', value: `${shortage.reservationAvailableQty}매` },
                {
                  label: '재생산 필요',
                  value: shortage.reproductionNeedQty > 0 ? <b className="font-semibold text-danger">{shortage.reproductionNeedQty}매</b> : '없음',
                },
              ]}
            />
            {plans.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {plans.map((plan) => (
                  <PlanChip key={plan.productionPlanId} plan={plan} />
                ))}
              </div>
            ) : null}
            {shortage.reproductionNeedQty > 0 ? (
              <Banner
                tone="danger"
                actions={
                  <Button
                    size="sm"
                    variant="primary"
                    icon="refresh"
                    disabled={!canPlan || reproduce.isPending}
                    title={canPlan ? undefined : permissionNeedText([PERMISSION.PRODUCTION_PLAN_CONFIRM])}
                    onClick={() => setConfirming(true)}
                  >
                    재생산 계획 만들기
                  </Button>
                }
              >
                <b>재생산 필요 {shortage.reproductionNeedQty}매</b> · 여재와 진행 중인 계획으로도 부족해요. 생산 담당이 재생산 계획을 만들어요.
              </Banner>
            ) : shortage.additionalPlanQty > 0 ? (
              <span className="text-cap text-ink-3">같은 규격 예약 가용(여재 포함) {shortage.reservationAvailableQty}매로 부족분을 채울 수 있어 재생산이 필요 없어요.</span>
            ) : (
              <span className="text-cap text-ink-3">예약과 진행 중인 계획으로 수주 매수를 채울 수 있어 재생산할 매수가 없어요.</span>
            )}
          </div>
        ) : (
          <span className="text-cap text-ink-3">연결된 수주 품목이 없어 재생산 대상이 아니에요</span>
        )}

        <div className="flex flex-wrap gap-2">
          <ButtonLink href={lotTraceHref(row.lotNo, 'forward')} size="sm" icon="trace">
            정추적으로 영향 범위 보기
          </ButtonLink>
        </div>
      </CardBody>

      {confirming && soItem && shortage ? (
        <ConfirmDialog
          title="재생산 계획 만들기"
          confirmLabel="만들기"
          pending={reproduce.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            reproduce.mutate({ salesOrderItemId: soItem.salesOrderItemId }, { onSettled: () => setConfirming(false) })
          }
        >
          수주 {soItem.salesOrderNo} 품목 {soItem.lineNo}의 부족분으로 재생산 계획을 만들어요. 같은 규격 여재가 있으면 먼저 예약하고, 그래도 남는 {shortage.reproductionNeedQty}매만 계획해요.
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}
