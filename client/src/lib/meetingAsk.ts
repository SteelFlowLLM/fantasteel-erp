// 회의 질문하기 도우미: 답 속 근거 발언 "#3"을 눌러 이동할 조각으로 나누고, 질문 가능 조건·추천 질문을 정한다 (Voice2ERP 묶음 3)
import { MEETING_MINUTES_STATUS, type MeetingMinutesView } from '@fantasteel/shared';

export type AnswerPart = { kind: 'text'; text: string } | { kind: 'cite'; text: string; segmentIndex: number };

/** 이 회의록에 질문할 수 있는지: 전사가 있어야 한다 (음성을 글로 바꾸는 중이거나 전사가 없으면 안 된다) */
export function canAskAboutMeeting(minutes: Pick<MeetingMinutesView, 'meetingMinutesStatus' | 'transcriptSegments'>): boolean {
  return minutes.meetingMinutesStatus !== MEETING_MINUTES_STATUS.TRANSCRIBING && minutes.transcriptSegments.length > 0;
}

/**
 * 답에 적힌 #n(1부터, 화면의 발언 번호와 같다)을 눌러서 이동할 조각으로 나눈다.
 * 전사 길이를 벗어난 번호나 0은 모델이 지어낸 값이라 이동 조각으로 만들지 않고 글 그대로 둔다.
 */
export function splitCitations(answer: string, segmentCount: number): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of answer.matchAll(/#(\d{1,5})(?!\d)/g)) {
    const number = Number(match[1]);
    if (number < 1 || number > segmentCount) continue;
    if (match.index > last) parts.push({ kind: 'text', text: answer.slice(last, match.index) });
    parts.push({ kind: 'cite', text: match[0], segmentIndex: number - 1 });
    last = match.index + match[0].length;
  }
  if (last < answer.length) parts.push({ kind: 'text', text: answer.slice(last) });
  return parts;
}

export const MEETING_SUGGESTED_QUESTIONS = ['내가 맡은 일은?', '결정 안 된 안건은?', '누가 무엇을 언제까지 하기로 했어?', '회의 요약을 3줄로'] as const;

/** 서버로 보내는 보고 있는 화면 (REQ-AST-007). 라벨은 서버 상한(200자)에 맞춘다 */
export function meetingScreenContext(minutes: Pick<MeetingMinutesView, 'id' | 'meetingMinutesTitle'>) {
  return { path: `/meetings?id=${minutes.id}`, title: '회의록', label: minutes.meetingMinutesTitle.slice(0, 200) };
}
