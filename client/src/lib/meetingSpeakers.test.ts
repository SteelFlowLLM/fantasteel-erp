// 화자 도우미: 배지 문구·색, 선택값 → 저장할 값, 연결 카드 표시 조건.
import type { MeetingMinutesView, MeetingSpeakerSummary, TranscriptSegment } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { SPEAKER_TONE_CLASSES, canLinkSpeakers, duplicatePickedIds, initialSpeakerSelection, speakerBadge, speakerMappingToSave, speakerOrder } from '@/lib/meetingSpeakers';

const seg = (text: string, speaker?: string, speakerName?: string): TranscriptSegment => ({ start: 0, end: 1, text, ...(speaker ? { speaker, speakerEmployeeId: null, speakerName: speakerName ?? null } : {}) });
const speakers: MeetingSpeakerSummary[] = [
  { label: 'SPEAKER_1', employeeId: null, employeeName: null, segmentCount: 2, firstTexts: ['가', '나'] },
  { label: 'SPEAKER_2', employeeId: 7, employeeName: '최준혁', segmentCount: 1, firstTexts: ['다'] },
];

describe('speakerBadge', () => {
  const segments = [seg('가', 'SPEAKER_2', '최준혁'), seg('나', 'SPEAKER_1'), seg('다')];
  const order = speakerOrder(segments);

  it('이름이 연결됐으면 이름, 아니면 "화자 N", 화자가 없으면 null', () => {
    expect(speakerBadge(segments[0], order)?.text).toBe('최준혁');
    expect(speakerBadge(segments[1], order)?.text).toBe('화자 1');
    expect(speakerBadge(segments[2], order)).toBeNull();
  });

  it('색은 처음 나온 순서로 정하고 같은 화자는 같은 색이다', () => {
    expect(speakerBadge(segments[0], order)?.toneIndex).toBe(0);
    expect(speakerBadge(segments[1], order)?.toneIndex).toBe(1);
    const many = Array.from({ length: SPEAKER_TONE_CLASSES.length + 1 }, (_, i) => seg('x', `SPEAKER_${i + 1}`));
    expect(speakerBadge(many[SPEAKER_TONE_CLASSES.length], speakerOrder(many))?.toneIndex).toBe(0);
  });
});

describe('화자 연결 선택값', () => {
  it('처음 선택값은 연결된 사원 id, 없으면 빈 문자열(모름)', () => {
    expect(initialSpeakerSelection(speakers)).toEqual({ SPEAKER_1: '', SPEAKER_2: '7' });
  });

  it('달라진 이름표만 보내고 모름은 null, 달라진 게 없으면 null', () => {
    expect(speakerMappingToSave(speakers, { SPEAKER_1: '', SPEAKER_2: '7' })).toBeNull();
    expect(speakerMappingToSave(speakers, { SPEAKER_1: '5', SPEAKER_2: '7' })).toEqual({ SPEAKER_1: 5 });
    expect(speakerMappingToSave(speakers, { SPEAKER_1: '5', SPEAKER_2: '' })).toEqual({ SPEAKER_1: 5, SPEAKER_2: null });
  });

  it('같은 사원을 두 화자에 고르면 알려 준다', () => {
    expect(duplicatePickedIds({ A: '5', B: '5', C: '' })).toEqual(['5']);
    expect(duplicatePickedIds({ A: '5', B: '6', C: '' })).toEqual([]);
  });
});

describe('canLinkSpeakers', () => {
  const minutes = { meetingMinutesStatus: 'TRANSCRIBED', transcript: '글', speakers, creator: { id: 3, name: '정다은' } } as MeetingMinutesView;

  it('작성자가 확정 전 전사를 볼 때만', () => {
    expect(canLinkSpeakers(minutes, 3)).toBe(true);
    expect(canLinkSpeakers(minutes, 4)).toBe(false);
    expect(canLinkSpeakers({ ...minutes, meetingMinutesStatus: 'CONFIRMED' }, 3)).toBe(false);
    expect(canLinkSpeakers({ ...minutes, meetingMinutesStatus: 'ANALYZING' }, 3)).toBe(false);
    expect(canLinkSpeakers({ ...minutes, speakers: [] }, 3)).toBe(false);
    expect(canLinkSpeakers({ ...minutes, meetingMinutesStatus: 'REVIEW' }, 3)).toBe(true);
  });
});
