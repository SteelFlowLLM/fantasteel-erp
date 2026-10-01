// 검사 입력 조회·변경 훅 (화면은 이 훅으로만 검사 API에 접근한다, 컨벤션 9장)
import { useQuery } from '@tanstack/react-query';
import { inspectionApi, inspectionKeys, type RegisterInspectionOutcome } from '@/api/inspections';
import { INSPECTION_RESULT_LABEL } from '@/codes';
import { useAction } from '@/hooks/useAction';
import type { RegisterInspectionInput } from '@/mock/services';

export function useInspectionQueue() {
  return useQuery({ queryKey: inspectionKeys.queue(), queryFn: inspectionApi.queue });
}

export function useInspectionDetail(lotId: number | null) {
  return useQuery({
    queryKey: inspectionKeys.detail(lotId ?? 0),
    queryFn: () => inspectionApi.detail(lotId ?? 0),
    enabled: lotId !== null,
  });
}

/** 측정값 저장. 성공 토스트에 시스템 판정을 함께 보인다. 입력칸 오류는 화면이 직접 보이므로 InputError도 토스트로 요약만 띄운다. */
export function useRegisterInspection(onSaved?: (outcome: RegisterInspectionOutcome) => void) {
  return useAction((input: RegisterInspectionInput) => inspectionApi.register(input), {
    success: (outcome) => `${outcome.lotNo} 검사를 저장했어요 · 시스템 판정 ${INSPECTION_RESULT_LABEL[outcome.inspectionResult]}`,
    invalidate: [inspectionKeys.all],
    onSuccess: (outcome) => onSaved?.(outcome),
  });
}
