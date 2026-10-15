// 회의 화자 도우미: 전사 구간의 화자 표시와 색, 화자 연결 선택값 → 서버에 보낼 값. (Voice2ERP 화자 분리)
import { MEETING_MINUTES_STATUS, speakerLabelText, type MeetingMinutesView, type MeetingSpeakerSummary, type TranscriptSegment } from '@fantasteel/shared';

/** 화자마다 돌려 쓰는 색 (배지 배경·글자) */
export const SPEAKER_TONE_CLASSES = ['bg-brand-tint text-brand', 'bg-ok-bg text-ok', 'bg-wait-bg text-wait', 'bg-ai-bg text-ai-strong', 'bg-surface-3 text-ink-2'] as const;

export interface SpeakerBadge {
  text: string;
  /** 같은 화자는 같은 색이 되게 처음 나온 순서로 센 번호 */
  toneIndex: number;
}

/** 이름표를 처음 나온 순서의 0부터 센 번호로 (색 고르기용) */
export function speakerOrder(segments: TranscriptSegment[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const s of segments) if (s.speaker && !order.has(s.speaker)) order.set(s.speaker, order.size);
  return order;
}

/** 구간 앞에 붙일 배지: 사원이 연결됐으면 이름, 아니면 "화자 1". 화자가 없는 구간은 null */
export function speakerBadge(segment: TranscriptSegment, order: Map<string, number>): SpeakerBadge | null {
  if (!segment.speaker) return null;
  return { text: segment.speakerName ?? speakerLabelText(segment.speaker), toneIndex: (order.get(segment.speaker) ?? 0) % SPEAKER_TONE_CLASSES.length };
}

/** 화자 연결 카드에서 쓰는 선택값: 사원 id 문자열, 연결 안 됐으면 '' (모름) */
export function initialSpeakerSelection(speakers: MeetingSpeakerSummary[]): Record<string, string> {
  return Object.fromEntries(speakers.map((s) => [s.label, s.employeeId === null ? '' : String(s.employeeId)]));
}

/** 서버에 저장된 연결과 달라진 이름표만 모아 보낼 값으로. 달라진 게 없으면 null */
export function speakerMappingToSave(speakers: MeetingSpeakerSummary[], selection: Record<string, string>): Record<string, number | null> | null {
  const changed: Record<string, number | null> = {};
  for (const s of speakers) {
    const picked = selection[s.label] ?? '';
    const next = picked === '' ? null : Number(picked);
    if (next !== s.employeeId) changed[s.label] = next;
  }
  return Object.keys(changed).length > 0 ? changed : null;
}

/** 같은 사원을 두 화자에 고르면 그 사원 이름들을 돌려준다 (한 사람이 두 화자일 수도 있어 막지는 않고 알려 주기만 한다) */
export function duplicatePickedIds(selection: Record<string, string>): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const value of Object.values(selection)) {
    if (value === '') continue;
    if (seen.has(value)) dup.add(value);
    seen.add(value);
  }
  return [...dup];
}

/** 화자 연결 카드를 보일지: 화자 이름표가 있고, 작성자이며, 확정 전에 전사가 끝난 상태 */
export function canLinkSpeakers(minutes: MeetingMinutesView, employeeId: number): boolean {
  const status = minutes.meetingMinutesStatus;
  const open = status === MEETING_MINUTES_STATUS.TRANSCRIBED || status === MEETING_MINUTES_STATUS.REVIEW || status === MEETING_MINUTES_STATUS.FAILED;
  return minutes.speakers.length > 0 && minutes.creator.id === employeeId && open && !!minutes.transcript;
}
