import { describe, expect, it } from 'vitest';
import { compareTasksByDue, daysBetween, isScreenPath, taskDueStateOf, taskDueText } from '@/features/tasks/lib/taskDue';

const TODAY = '2026-10-01';

describe('업무 마감 표시 (REQ-NTF-001)', () => {
  it('완료·마감 지남·오늘·마감 전·마감 없음을 구분한다', () => {
    expect(taskDueStateOf({ taskStatus: 'DONE', dueDate: '2026-09-01' }, TODAY)).toBe('done');
    expect(taskDueStateOf({ taskStatus: 'OPEN', dueDate: '2026-09-30' }, TODAY)).toBe('overdue');
    expect(taskDueStateOf({ taskStatus: 'OPEN', dueDate: TODAY }, TODAY)).toBe('today');
    expect(taskDueStateOf({ taskStatus: 'OPEN', dueDate: '2026-10-03' }, TODAY)).toBe('upcoming');
    expect(taskDueStateOf({ taskStatus: 'OPEN', dueDate: null }, TODAY)).toBe('none');
  });

  it('카드 날짜 문구', () => {
    expect(taskDueText({ taskStatus: 'OPEN', dueDate: '2026-09-29' }, TODAY)).toBe('09-29 마감 지남 (D+2)');
    expect(taskDueText({ taskStatus: 'OPEN', dueDate: TODAY }, TODAY)).toBe('오늘 마감');
    expect(taskDueText({ taskStatus: 'OPEN', dueDate: '2026-10-03' }, TODAY)).toBe('마감 10-03 (D-2)');
    expect(taskDueText({ taskStatus: 'OPEN', dueDate: null }, TODAY)).toBe('마감 없음');
    expect(taskDueText({ taskStatus: 'DONE', dueDate: null, completedAt: '2026-09-30T07:20:00.000Z' }, TODAY)).toBe('완료 09-30 16:20');
  });

  it('일수 계산은 달을 넘어도 맞다', () => {
    expect(daysBetween('2026-09-30', '2026-10-02')).toBe(2);
    expect(daysBetween('2026-10-02', '2026-09-30')).toBe(-2);
  });

  it('마감일 빠른 순, 마감 없음은 뒤', () => {
    const tasks = [
      { id: 1, dueDate: null },
      { id: 2, dueDate: '2026-10-05' },
      { id: 3, dueDate: '2026-10-01' },
      { id: 4, dueDate: '2026-10-01' },
    ];
    expect([...tasks].sort(compareTasksByDue).map((t) => t.id)).toEqual([3, 4, 2, 1]);
  });

  it('연결 화면은 "/"로 시작하는 앱 안 경로만', () => {
    expect(isScreenPath('/goods-receipts')).toBe(true);
    expect(isScreenPath('/sales-orders/12?tab=items')).toBe(true);
    expect(isScreenPath('goods-receipts')).toBe(false);
    expect(isScreenPath('//evil.example.com')).toBe(false);
    expect(isScreenPath('/a b')).toBe(false);
    expect(isScreenPath(`/${'a'.repeat(300)}`)).toBe(false);
  });
});
