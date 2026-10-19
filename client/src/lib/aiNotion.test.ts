// 철강맨AI Notion(이슈 #398): 켜기 설정·못 켤 때 이유·도구 줄 요약, Notion 카드와 일정·업무 고치기 카드의 실행 요청.
import type { AiNotionCreateCard, AiNotionUpdateCard, AiScheduleEventUpdateCard, AiTaskUpdateCard } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { applyScheduleChanges, CARD_RESULT, executeInputOf, isNotionCard, missingOfCard, needsConfirmation, seoulLocalOf } from '@/lib/aiActionCard';
import { AI_NOTION_OFF_REASON, AI_NOTION_UNAVAILABLE_HINT, isNotionUrl, notionDisabledReason, notionToolDoneText, notionToolRunningText, parseAiNotionPreference } from '@/lib/aiNotion';

const page = { id: 'aaaabbbbccccddddeeeeffff00001111', title: '주간 회의', url: 'https://www.notion.so/aaaabbbbccccddddeeeeffff00001111' };
const nonce = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('Notion 켜기', () => {
  it('저장된 값은 "true"만 켜짐', () => {
    expect(parseAiNotionPreference('true')).toBe(true);
    expect(parseAiNotionPreference(null)).toBe(false);
    expect(parseAiNotionPreference('1')).toBe(false);
  });

  it('서버가 쓸 수 있다고 해야 켜고, 아니면 서버가 준 이유를 보인다', () => {
    expect(notionDisabledReason({ notion: { available: true } }, false)).toBeNull();
    expect(notionDisabledReason({ notion: { available: false, reason: '관리자가 Notion 상위 페이지를 정하지 않았어요' } }, false)).toBe('관리자가 Notion 상위 페이지를 정하지 않았어요');
    expect(notionDisabledReason({ notion: { available: false } }, false)).toBe(AI_NOTION_OFF_REASON);
    expect(notionDisabledReason(undefined, false)).toBe(AI_NOTION_OFF_REASON);
    expect(notionDisabledReason({ notion: { available: true } }, true)).toBe(AI_NOTION_UNAVAILABLE_HINT);
  });

  it('도구 줄: 찾는 중·읽는 중, 끝나면 결과 수·읽음 (제목은 보이지 않는다)', () => {
    expect(notionToolRunningText('notion_search')).toBe(' … 찾는 중');
    expect(notionToolRunningText('get_inventory')).toBeNull();
    expect(notionToolDoneText('notion_search', [{ title: 'a', url: page.url }])).toBe('결과 1건');
    expect(notionToolDoneText('notion_read_page', [])).toBe('읽지 못함');
    expect(notionToolDoneText('web_search', [])).toBeNull();
  });

  it('링크는 https Notion 주소만', () => {
    expect(isNotionUrl(page.url)).toBe(true);
    expect(isNotionUrl('https://app.notion.com/p/x')).toBe(true);
    expect(isNotionUrl('javascript:alert(1)')).toBe(false);
    expect(isNotionUrl('https://notion.so.evil.example/x')).toBe(false);
    expect(isNotionUrl(undefined)).toBe(false);
  });
});

describe('Notion 카드', () => {
  const create: AiNotionCreateCard = { key: 'a1', kind: 'NOTION_PAGE_CREATE', title: 'Notion 새 페이지 · 정리', nonce, parent: page, pageTitle: '정리', content: '본문', issues: [] };
  const update: AiNotionUpdateCard = { key: 'a2', kind: 'NOTION_PAGE_UPDATE', title: 'Notion 고치기 · 주간 회의', nonce, page, newTitle: null, edits: [{ oldStr: '<td>10/20</td>', newStr: '<td>10/24</td>' }], issues: [] };

  it('실행 요청에 카드 번호와 대상 페이지를 담는다. 제목을 바꾸지 않으면 보내지 않는다', () => {
    expect(isNotionCard(create)).toBe(true);
    expect(executeInputOf(create)).toEqual({ kind: 'NOTION_PAGE_CREATE', nonce, notionPageId: page.id, pageTitle: '정리', content: '본문' });
    expect(executeInputOf(update)).toEqual({ kind: 'NOTION_PAGE_UPDATE', nonce, notionPageId: page.id, edits: update.edits });
    expect(executeInputOf({ ...update, newTitle: '새 제목' })).toMatchObject({ pageTitle: '새 제목' });
  });

  it('비면 실행하지 않는다. 확인창은 거치지 않는다', () => {
    expect(missingOfCard({ ...create, content: ' ' })).toEqual(['내용']);
    expect(missingOfCard({ ...update, edits: [] })).toEqual(['바꿀 내용']);
    expect(needsConfirmation(create)).toBe(false);
  });

  it('결과는 Notion 주소로 연다 (Notion이 알린 경고를 함께 보인다)', () => {
    const registered = { type: 'notion_page' as const, id: 0, url: page.url, note: 'old_str not found: x' };
    expect(CARD_RESULT.notion_page.external).toBe(true);
    expect(CARD_RESULT.notion_page.href(registered)).toBe(page.url);
    expect(CARD_RESULT.notion_page.message(registered)).toContain('old_str not found');
    expect(CARD_RESULT.task.message({ type: 'task', id: 1, updated: true })).toBe('업무를 고쳤어요');
  });
});

describe('일정·업무 고치기 카드', () => {
  const schedule: AiScheduleEventUpdateCard = {
    key: 'a1',
    kind: 'SCHEDULE_EVENT_UPDATE',
    title: '일정 고치기 · 라인 점검',
    scheduleEventId: 11,
    before: { scheduleEventTitle: '라인 점검', scheduleEventDescription: null, startAt: '2026-10-21T14:00:00+09:00', endAt: '2026-10-21T15:00:00+09:00' },
    scheduleEventTitle: '라인 점검',
    scheduleEventDescription: null,
    startAt: '2026-10-21T16:00:00+09:00',
    endAt: '2026-10-21T17:00:00+09:00',
    issues: [],
  };
  const task: AiTaskUpdateCard = { key: 'a2', kind: 'TASK_UPDATE', title: '업무 고치기 · 견적서', taskId: 21, before: { taskTitle: '견적서', taskDescription: null, dueDate: '2026-10-24' }, taskTitle: '견적서', taskDescription: null, dueDate: '2026-10-28', complete: false, issues: [] };

  it('일정은 전체 값을, 업무는 바뀐 칸만(완료 카드는 완료만) 보낸다', () => {
    expect(executeInputOf(schedule)).toEqual({ kind: 'SCHEDULE_EVENT_UPDATE', scheduleEventId: 11, title: '라인 점검', description: null, startAt: schedule.startAt, endAt: schedule.endAt });
    expect(executeInputOf(task)).toEqual({ kind: 'TASK_UPDATE', taskId: 21, dueDate: '2026-10-28' });
    expect(executeInputOf({ ...task, complete: true })).toEqual({ kind: 'TASK_UPDATE', taskId: 21, complete: true });
  });

  it('카드에서 일정 시각을 고치면 서울 시각으로 반영하고, 끝이 시작보다 앞이면 확인 사유를 붙인다', () => {
    expect(seoulLocalOf('2026-10-21T16:00:00+09:00')).toBe('2026-10-21T16:00');
    const next = applyScheduleChanges(schedule, { title: '라인 점검 (연기)', description: ' ', startAt: '2026-10-22T09:00', endAt: '2026-10-22T10:00' });
    expect(next).toMatchObject({ title: '일정 고치기 · 라인 점검 (연기)', scheduleEventDescription: null, startAt: '2026-10-22T09:00:00+09:00', endAt: '2026-10-22T10:00:00+09:00', issues: [] });
    expect(applyScheduleChanges(schedule, { title: 'x', description: '', startAt: '2026-10-22T10:00', endAt: '2026-10-22T09:00' }).issues).toHaveLength(1);
    expect(missingOfCard({ ...schedule, scheduleEventTitle: '' })).toEqual(['제목']);
  });
});
