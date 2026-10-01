import { describe, expect, it } from 'vitest';
import { fitTitle, NOTIFICATION_TITLE_MAX, taskAssignedNotice } from '@/features/tasks/lib/taskNotice';

describe('업무 지정 알림 문구', () => {
  it('짧은 제목은 그대로 붙인다', () => {
    expect(taskAssignedNotice({ id: 3, title: '입고 확인', dueDate: '2026-10-02' }, '정다은')).toEqual({
      title: '업무 지정 · 입고 확인',
      body: '정다은님이 업무를 맡겼어요 · 마감 2026-10-02',
      linkPath: '/tasks?tab=tasks&task=3',
    });
  });

  it('업무 제목이 200자면 알림 제목을 200자에 맞춰 자르고 …를 붙인다 (ERD notification.title varchar(200))', () => {
    const notice = taskAssignedNotice({ id: 1, title: '가'.repeat(200), dueDate: null }, '정다은');
    expect(notice.title).toHaveLength(NOTIFICATION_TITLE_MAX);
    expect(notice.title).toBe(`업무 지정 · ${'가'.repeat(NOTIFICATION_TITLE_MAX - '업무 지정 · '.length - 1)}…`);
  });

  it('딱 200자에 맞으면 자르지 않는다', () => {
    const text = '나'.repeat(NOTIFICATION_TITLE_MAX - 3);
    expect(fitTitle('앞 ·', text)).toBe(`앞 ·${text}`);
  });
});
