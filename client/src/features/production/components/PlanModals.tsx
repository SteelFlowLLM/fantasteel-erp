'use client';

// 생산계획 화면의 창: 계획 취소 (PLANNED일 때만) · 재생산 계획 (여재·진행 계획을 먼저 확인, 14.1-6)
import { useState } from 'react';
import { PRODUCT_QTY_UNIT, PRODUCTION_PLAN_STATUS_LABEL, RESERVATION_STATUS_LABEL, type ProductItemType } from '@/codes';
import { productionPlanApi, type ReproductionCheck } from '@/api/production';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { SoonButton } from '@/components/ComingSoon';
import { Field } from '@/components/Field';
import { Textarea } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { Modal } from '@/components/Modal';
import { Table, Td, Th } from '@/components/Table';
import { useAction } from '@/hooks/useAction';
import { withEulReul } from '@/lib/josa';

export function CancelPlanModal({ planId, planNo, updatedAt, onClose }: { planId: number; planNo: string; updatedAt: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const cancel = useAction(productionPlanApi.cancel, { success: `${planNo} 생산계획을 취소했어요`, onSuccess: onClose });
  return (
    <Modal
      title={`생산계획 취소 · ${planNo}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose} disabled={cancel.isPending}>
            닫기
          </Button>
          <Button
            variant="danger"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate({ productionPlanId: planId, reasonText: reason, expectedUpdatedAt: updatedAt })}
          >
            {cancel.isPending ? '취소하는 중…' : '계획 취소'}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-normal text-ink-2">
        작업 실적이 하나도 없는 <b className="font-semibold">계획</b> 상태에서만 취소할 수 있어요. 열연 투입 배정이 있으면 함께 해제돼요. 수주 품목은 그대로 남아 부족분이 다시
        &lsquo;추가 계획 필요&rsquo;로 보여요.
      </p>
      <Field label="사유" hint="작업 로그에 남아요 (선택, 500자 이내)">
        <Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="예: 설비 점검으로 다시 편성" />
      </Field>
    </Modal>
  );
}

export function ReproductionModal({ check, itemType, onClose }: { check: ReproductionCheck; itemType: ProductItemType; onClose: () => void }) {
  const unit = PRODUCT_QTY_UNIT[itemType];
  const create = useAction(productionPlanApi.createReproduction, {
    success: (r) =>
      r.plan
        ? `재생산 계획 ${withEulReul(r.plan.productionPlanNo)} 만들었어요 (${r.plan.shortageQty}${unit}${r.reservedFromSurplusQty > 0 ? ` · 여재 ${r.reservedFromSurplusQty}${unit} 먼저 예약` : ''})`
        : `여재 ${r.reservedFromSurplusQty}${unit}를 예약해서 새 계획 없이 채웠어요`,
    onSuccess: onClose,
  });
  // 먼저 예약하는 여재 = min(현재 미확보, 예약 가용): core createReproductionPlan이 실제로 예약하는 수와 같다
  const surplusFirst = check.surplusReserveQty;
  return (
    <Modal
      title={`재생산 계획 · ${check.salesOrderNo} 품목 ${check.lineNo}`}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            닫기
          </Button>
          <Button variant="primary" disabled={create.isPending || check.additionalPlanQty <= 0} onClick={() => create.mutate({ salesOrderItemId: check.salesOrderItemId })}>
            {create.isPending ? '만드는 중…' : check.reproductionNeedQty > 0 ? `재생산 계획 만들기 (${check.reproductionNeedQty}${unit})` : `여재로 채우기 (${surplusFirst}${unit})`}
          </Button>
        </>
      }
    >
      <KvList
        columns={3}
        items={[
          { label: '수주 매수', value: `${check.orderedQty}${unit}` },
          { label: '출고 누계', value: `${check.shippedQty}${unit}` },
          { label: '미출하', value: `${check.unshippedQty}${unit}` },
          { label: `예약 (${RESERVATION_STATUS_LABEL.ACTIVE})`, value: `${check.activeReservedQty}${unit}` },
          { label: '현재 미확보', value: `${check.unsecuredQty}${unit}` },
          { label: '진행 계획 잔여 목표', value: `${check.openPlanRemainingQty}${unit}` },
          { label: '추가 계획 필요', value: `${check.additionalPlanQty}${unit}` },
          { label: '같은 규격 예약 가용 (여재 포함)', value: `${check.reservationAvailableQty}${unit}` },
          { label: '재생산 필요', value: <b className="text-danger">{`${check.reproductionNeedQty}${unit}`}</b> },
        ]}
      />
      <span className="text-cap text-ink-3">
        현재 미확보 = max(0, 미출하 − 예약) · 추가 계획 필요 = max(0, 현재 미확보 − 진행 계획 잔여 목표) · 재생산 필요 = max(0, 추가 계획 필요 − 예약 가용) · 먼저
        예약하는 여재 = min(현재 미확보, 예약 가용)
      </span>
      {check.openPlans.length > 0 ? (
        <Table compact>
          <thead>
            <tr>
              <Th>이 품목의 생산계획</Th>
              <Th>상태</Th>
              <Th align="right">부족 매수</Th>
              <Th align="right">잔여 목표</Th>
            </tr>
          </thead>
          <tbody>
            {check.openPlans.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono text-mono">
                  {p.productionPlanNo}
                  {p.isReproduction ? <span className="ml-1.5 text-cap text-wait">재생산</span> : null}
                </Td>
                <Td>{PRODUCTION_PLAN_STATUS_LABEL[p.productionPlanStatus]}</Td>
                <Td align="right">
                  {p.shortageQty}
                  {unit}
                </Td>
                <Td align="right">
                  {p.remainingTargetQty}
                  {unit}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {check.additionalPlanQty <= 0 ? (
        <Banner tone="ok">진행 중인 계획과 예약으로 채울 수 있어요. 재생산 계획을 만들지 않아도 돼요.</Banner>
      ) : (
        <Banner tone="run">
          먼저 현재 미확보 {check.unsecuredQty}
          {unit} 가운데 같은 규격 여재로 {surplusFirst}
          {unit}를 예약하고{check.reproductionNeedQty > 0 ? `, 그래도 모자란 ${check.reproductionNeedQty}${unit}만 재생산 계획(히트 편성 포함)으로 만들어요.` : ' 새 계획은 만들지 않아요.'}
          {surplusFirst > check.additionalPlanQty ? ` 진행 계획 잔여 목표로 덮인 몫도 재고로 먼저 잡으므로, 그 계획의 산출은 뒤에 여재로 남을 수 있어요.` : ''}
        </Banner>
      )}
      <div className="flex items-center gap-2 text-cap text-ink-3">
        <SoonButton size="sm">재생산 자동 초안</SoonButton>
        AI Factory Agent의 재생산 초안은 담당 부서원이 확정하는 2등급 기능이에요.
      </div>
    </Modal>
  );
}
