import type { MeetingCandidate, MeetingMinutesView } from '@fantasteel/shared';

/** Notion 페이지 제목 상한 (Notion은 2000자까지 받지만 목록에서 읽히는 길이로 자른다) */
const TITLE_MAX = 200;

/** 목록 한 줄 안에 줄바꿈이 들어가면 목록이 끊기므로 공백으로 바꾼다 */
function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}

/** +09:00 ISO의 날짜·시각을 그대로 읽는다 (`2026-10-21 14:00`) */
function seoulDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** UTC ISO → 서울 `YYYY-MM-DD HH:mm` */
function seoulFromUtc(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
}

function nameOf(view: MeetingMinutesView, employeeId: number | null, spoken: string | null): string | null {
  if (employeeId !== null) {
    const attendee = view.attendees.find((a) => a.employeeId === employeeId);
    if (attendee) return attendee.employeeName;
  }
  return spoken;
}

function taskLine(view: MeetingMinutesView, c: MeetingCandidate): string {
  const assignee = nameOf(view, c.assigneeId, c.assigneeName);
  const meta = [assignee ? `담당 ${assignee}` : null, c.dueDate ? `마감 ${c.dueDate}` : null].filter(Boolean).join(' · ');
  return `- [ ] ${oneLine(c.title)}${meta ? ` — ${meta}` : ''}`;
}

function eventLine(view: MeetingMinutesView, c: MeetingCandidate): string {
  const when = c.startAt ? `${seoulDateTime(c.startAt)}${c.endAt ? `~${c.endAt.slice(11, 16)}` : ''}` : null;
  const names = c.attendeeIds.map((id) => nameOf(view, id, null)).filter((n): n is string => n !== null);
  const others = c.attendeeIds.length - names.length;
  const who = names.length === 0 ? (others > 0 ? `참석 ${others}명` : null) : `참석 ${names.join(', ')}${others > 0 ? ` 외 ${others}명` : ''}`;
  const meta = [when, who].filter(Boolean).join(' · ');
  return `- ${oneLine(c.title)}${meta ? ` — ${meta}` : ''}`;
}

function purchaseLine(c: MeetingCandidate): string {
  const p = c.purchase;
  const meta = [c.itemName, p?.requestedTon ? `${p.requestedTon}톤` : null, p?.desiredReceiptDate ? `희망 입고 ${p.desiredReceiptDate}` : null].filter(Boolean).join(' · ');
  return `- ${oneLine(c.title)}${meta ? ` — ${meta}` : ''}`;
}

/** 내보낼 페이지 제목. 비면 회의일로 채운다 */
export function meetingNotionTitle(view: MeetingMinutesView): string {
  const title = oneLine(view.meetingMinutesTitle) || `${view.meetingDate} 회의`;
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

/**
 * 확정된 회의록을 Notion 마크다운으로 만든다. 제목은 페이지 속성으로 따로 넣으므로 본문에 쓰지 않는다.
 * 후보는 확정 때 허가해 실제로 등록한 것만 싣는다(제외한 후보는 회의에서 정한 일이 아니다). 원본 전사는 싣지 않는다.
 */
export function buildMeetingNotionMarkdown(view: MeetingMinutesView): string {
  const attendees = view.attendees.map((a) => `${a.employeeName}(${a.departmentName})`).join(', ');
  const lines: string[] = [
    `**회의일** ${view.meetingDate}`,
    `**참석자** ${attendees || '없음'}`,
    `**작성자** ${view.creator.name}${view.confirmedAt ? ` · **확정** ${seoulFromUtc(view.confirmedAt)}` : ''}`,
    '',
    '## 요약',
    view.summary?.trim() || '요약이 없어요.',
  ];

  const analysis = view.analysisResult;
  if (analysis && analysis.decisions.length > 0) {
    lines.push('', '## 결정사항', ...analysis.decisions.map((d) => `- ${oneLine(d.text)}`));
  }
  const approved = (analysis?.candidates ?? []).filter((c) => c.decision === 'APPROVED');
  const tasks = approved.filter((c) => c.kind === 'TASK');
  const events = approved.filter((c) => c.kind === 'EVENT');
  const purchases = approved.filter((c) => c.kind === 'PURCHASE');
  if (tasks.length > 0) lines.push('', '## 할 일', ...tasks.map((c) => taskLine(view, c)));
  if (events.length > 0) lines.push('', '## 일정', ...events.map((c) => eventLine(view, c)));
  if (purchases.length > 0) lines.push('', '## 구매요청 초안', ...purchases.map(purchaseLine));

  lines.push('', '---', `FantaSteel ERP 회의록 #${view.id}에서 내보냈어요.`);
  return lines.join('\n');
}
