import { AI_RESEARCH_STATUS_LABEL, type AiResearchStatus } from '@fantasteel/shared';
import { Badge, type BadgeTone } from '@/components/Badge';

const TONE: Record<AiResearchStatus, BadgeTone> = {
  PLANNING: 'ai',
  AWAITING_APPROVAL: 'wait',
  QUEUED: 'run',
  RUNNING: 'run',
  COMPLETED: 'ok',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

/** incompleteReason: 다 마치지 못하고(LLM 실패·시간 상한) 대신 정리한 완료면 그 이유. 초록 '완료'로 보이면 온전한 보고서로 읽힌다 (#519) */
export function AiResearchStatusBadge({ status, incompleteReason = null }: { status: AiResearchStatus; incompleteReason?: string | null }) {
  if (status === 'COMPLETED' && incompleteReason) {
    return (
      <Badge tone="wait" title={incompleteReason}>
        {AI_RESEARCH_STATUS_LABEL[status]} · 다 마치지 못함
      </Badge>
    );
  }
  return <Badge tone={TONE[status]}>{AI_RESEARCH_STATUS_LABEL[status]}</Badge>;
}
