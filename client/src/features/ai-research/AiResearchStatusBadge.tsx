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

export function AiResearchStatusBadge({ status }: { status: AiResearchStatus }) {
  return <Badge tone={TONE[status]}>{AI_RESEARCH_STATUS_LABEL[status]}</Badge>;
}
