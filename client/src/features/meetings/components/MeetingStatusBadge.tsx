import { MEETING_MINUTES_STATUS_LABEL, type MeetingMinutesStatus } from '@fantasteel/shared';
import { Badge, type BadgeTone } from '@/components/Badge';

const TONE: Record<MeetingMinutesStatus, BadgeTone> = {
  TRANSCRIBING: 'run',
  TRANSCRIBED: 'neutral',
  ANALYZING: 'ai',
  REVIEW: 'wait',
  CONFIRMED: 'ok',
  FAILED: 'danger',
};

export function MeetingStatusBadge({ status }: { status: MeetingMinutesStatus }) {
  return <Badge tone={TONE[status]}>{MEETING_MINUTES_STATUS_LABEL[status]}</Badge>;
}
