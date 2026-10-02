// 불합격 관리 조회·변경 훅 (불합격 상태 지정, 재생산 계획 만들기)
import { useQuery } from '@tanstack/react-query';
import { dispositionApi, dispositionKeys, type ReproductionOutcome, type SetDispositionInput } from '@/api/dispositions';
import { DISPOSITION_STATUS_LABEL } from '@/codes';
import { useAction } from '@/hooks/useAction';
import { withEulReul } from '@/lib/josa';

export function useRejectedLots() {
  return useQuery({ queryKey: dispositionKeys.list(), queryFn: dispositionApi.list });
}

export function useRejectedLotDetail(lotId: number | null) {
  return useQuery({
    queryKey: dispositionKeys.detail(lotId ?? 0),
    queryFn: () => dispositionApi.detail(lotId ?? 0),
    enabled: lotId !== null,
  });
}

export function useSetDisposition(onSaved?: () => void) {
  return useAction((input: SetDispositionInput) => dispositionApi.set(input), {
    // 보류·격하·폐기 모두 받침이 없어 '로'를 붙인다
    success: (lot) => `${lot.lotNo} 불합격 상태를 ${lot.dispositionStatus ? DISPOSITION_STATUS_LABEL[lot.dispositionStatus] : '-'}로 지정했어요`,
    invalidate: [dispositionKeys.all],
    onSuccess: () => onSaved?.(),
  });
}

const reproductionMessage = (outcome: ReproductionOutcome): string => {
  const surplus = outcome.reservedFromSurplusQty > 0 ? `여재 ${outcome.reservedFromSurplusQty}매를 먼저 예약했어요` : '';
  const plan = outcome.productionPlanNo ? `재생산 계획 ${withEulReul(outcome.productionPlanNo)} 만들었어요 (${outcome.shortageQty ?? 0}매)` : '';
  return [surplus, plan].filter(Boolean).join(' · ');
};

export function useCreateReproductionPlan() {
  return useAction((input: { salesOrderItemId: number }) => dispositionApi.createReproductionPlan(input), {
    success: reproductionMessage,
    invalidate: [dispositionKeys.all],
  });
}
