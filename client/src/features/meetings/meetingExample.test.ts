import { describe, expect, it } from 'vitest';
import { ROLE_LABEL } from '@/codes';
import { collectTexts, findForbiddenWords, findMalformedNumbers } from '@/features/agent/lib/exampleTextCheck';
import {
  ATTENDEES,
  DECISIONS,
  EXAMPLE_NO,
  EXTRACTED_TASKS,
  MEETING_MINUTES_LIST,
  PURCHASE_ITEM,
  SELECTED_MEETING_MINUTES,
  SUMMARY,
  TRANSCRIPT,
  isTaskReady,
} from '@/features/meetings/meetingExample';
import { SEED_EMPLOYEES } from '@/mock/seed';

describe('Voice2ERP 회의록 예시 (BP-VOC-01)', () => {
  it('참석자·작성자·요청자는 시드 사원이고, 역할 표시가 맞다', () => {
    for (const attendee of ATTENDEES) {
      const employee = SEED_EMPLOYEES.find((item) => item.employeeName === attendee.employeeName);
      expect(employee).toBeDefined();
      expect(attendee.roleCode).toBe(employee?.roleCode);
      expect(Object.keys(ROLE_LABEL)).toContain(attendee.roleCode);
    }
    const names = ATTENDEES.map((attendee) => attendee.employeeName);
    expect(names).toContain(SELECTED_MEETING_MINUTES.createdEmployeeName);
    expect(names).toContain(PURCHASE_ITEM.requesterName);
    for (const line of TRANSCRIPT) expect(names).toContain(line.speaker);
  });

  it('원본 전사는 시간순이고, 구매 관련 발언은 구매 항목의 원문 시각과 같다', () => {
    const times = TRANSCRIPT.map((line) => line.at);
    expect([...times].sort()).toEqual(times);
    expect(TRANSCRIPT.filter((line) => line.purchaseRelated).map((line) => line.at)).toEqual([PURCHASE_ITEM.at]);
  });

  it('결정사항·할 일의 원문 시각은 전사에 있는 발언이다', () => {
    const times = new Set(TRANSCRIPT.map((line) => line.at));
    for (const decision of DECISIONS) expect(times.has(decision.at)).toBe(true);
    for (const task of EXTRACTED_TASKS) expect(times.has(task.at)).toBe(true);
  });

  it('담당자·마감일이 모호한 할 일은 확인 전 등록하지 않는다', () => {
    expect(isTaskReady({ key: 'a', assigneeName: '서민지', title: 't', dueDate: '10-02', at: '00:00' })).toBe(true);
    expect(isTaskReady({ key: 'b', assigneeName: null, title: 't', dueDate: '10-02', at: '00:00' })).toBe(false);
    expect(isTaskReady({ key: 'c', assigneeName: '서민지', title: 't', dueDate: null, at: '00:00' })).toBe(false);
    expect(EXTRACTED_TASKS.filter(isTaskReady)).toHaveLength(3);
    expect(EXTRACTED_TASKS.find((task) => !isTaskReady(task))?.key).toBe('inspection-report');
  });

  it('결정사항·요약은 히트 LOT이 아니라 생산계획으로 편성하고, 히트 LOT 번호는 검사 발언에만 나온다 (BP-PRD-01·02)', () => {
    const planTexts = [...SUMMARY, ...DECISIONS.map((decision) => decision.text)];
    expect(planTexts.some((text) => text.includes(EXAMPLE_NO.productionPlan))).toBe(true);
    for (const text of planTexts) expect(text).not.toContain(EXAMPLE_NO.heat);
    const heatLines = TRANSCRIPT.filter((line) => line.text.includes(EXAMPLE_NO.heat));
    expect(heatLines.map((line) => line.at)).toEqual(['17:45']);
  });

  it('화면에 보이는 결정사항은 해라체로 끝나지 않는다 (해요체·명사형)', () => {
    for (const decision of DECISIONS) expect(decision.text).not.toMatch(/다$/);
    for (const line of SUMMARY) expect(line).toMatch(/요\.$/);
  });

  it('회의록 목록에는 문서에 없는 상태 값이 없다 (meeting_minutes에 상태 열 없음)', () => {
    for (const item of MEETING_MINUTES_LIST.flatMap((group) => group.items)) expect(Object.keys(item).sort()).toEqual(['key', 'meta', 'sub', 'title']);
  });

  it('목록의 선택한 회의 요약 건수가 정리 결과와 맞다', () => {
    const weekly = MEETING_MINUTES_LIST.flatMap((group) => group.items).find((item) => item.key === 'weekly');
    expect(weekly?.sub).toBe(`할 일 ${EXTRACTED_TASKS.length} · 구매 관련 1`);
    expect(weekly?.title).toBe(SELECTED_MEETING_MINUTES.title);
  });

  it('예시 번호는 9.1·9.2 형식이고, 금지어·단독 SM355가 없다', () => {
    const texts = collectTexts({ ATTENDEES, DECISIONS, EXAMPLE_NO, EXTRACTED_TASKS, MEETING_MINUTES_LIST, PURCHASE_ITEM, SELECTED_MEETING_MINUTES, SUMMARY, TRANSCRIPT });
    expect(findMalformedNumbers(texts)).toEqual([]);
    expect(findForbiddenWords(texts)).toEqual([]);
    expect(EXAMPLE_NO).toEqual({
      salesOrder: 'SO-2609-014',
      productionPlan: 'PP-2610-0003',
      heat: 'HT-BOF1-260929-015',
      slab: 'HT-BOF1-260929-015-03',
      coil: 'CBOF1-260929-015-03',
    });
  });
});
