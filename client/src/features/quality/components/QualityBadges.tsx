// 검사 결과·불합격 상태 배지 (공통 코드 INSPECTION_RESULT·DISPOSITION_STATUS 표시명)
import { Badge } from '@/components/Badge';
import { DISPOSITION_STATUS_LABEL, INSPECTION_RESULT_LABEL, type DispositionStatus, type InspectionResult } from '@/codes';
import { INSPECTION_RESULT_TONE } from '@/lib/statusTone';

export function ResultBadge({ result, className }: { result: InspectionResult; className?: string }) {
  return (
    <Badge tone={INSPECTION_RESULT_TONE[result]} className={className}>
      {INSPECTION_RESULT_LABEL[result]}
    </Badge>
  );
}

/** 불합격 상태: 보류 / 격하 / 폐기. 아직 지정하지 않았으면 '미지정' */
export function DispositionBadge({ status }: { status: DispositionStatus | null }) {
  if (status === 'HOLD') return <Badge tone="wait">{DISPOSITION_STATUS_LABEL.HOLD}</Badge>;
  if (status === 'DOWNGRADED') return <Badge tone="outline">{DISPOSITION_STATUS_LABEL.DOWNGRADED}</Badge>;
  if (status === 'SCRAPPED') return <Badge tone="danger">{DISPOSITION_STATUS_LABEL.SCRAPPED}</Badge>;
  return <Badge>미지정</Badge>;
}

/** 불합격 원인: 이 LOT의 검사 불합격 / 불합격 히트의 하위 LOT (용어 사전 TRM-078) */
export function RejectReasonBadge({ reason }: { reason: 'FAILED' | 'HEAT_FAILED' }) {
  return <Badge tone="outline">{reason === 'FAILED' ? '검사 불합격' : '불합격 히트의 하위 LOT'}</Badge>;
}
