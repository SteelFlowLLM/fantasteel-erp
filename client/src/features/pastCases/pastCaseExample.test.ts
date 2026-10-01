import { describe, expect, it } from 'vitest';
import { ACTOR_TYPE, CASE_CATEGORY, CASE_CATEGORY_LABEL, PROPOSED_BUSINESS_EVENT_TYPE } from '@/codes';
import { collectTexts, findForbiddenWords, findMalformedNumbers } from '@/features/agent/lib/exampleTextCheck';
import {
  CASE_CALL_SITES,
  CASE_REGISTER_STEPS,
  PAST_CASES,
  SELECTED_CASE,
  SELECTED_CASE_HISTORY,
  sameCategoryCases,
  similarCaseQuestion,
} from '@/features/pastCases/pastCaseExample';

describe('과거 사례 검색 예시 (BP-CASE-01)', () => {
  it('사례는 REQ-CASE-001 항목을 모두 갖고, 구분은 CASE_CATEGORY 값이다', () => {
    for (const item of PAST_CASES) {
      expect(Object.values(CASE_CATEGORY)).toContain(item.caseCategory);
      expect(CASE_CATEGORY_LABEL[item.caseCategory]).toMatch(/^(품질|설비)$/);
      for (const text of [item.title, item.phenomenon, item.cause, item.actionTaken, item.equipmentText, item.occurredDate]) expect(text.length).toBeGreaterThan(0);
      expect(item.lotNos.length).toBeGreaterThan(0);
    }
    const categories = new Set(PAST_CASES.map((item) => item.caseCategory));
    expect(categories).toEqual(new Set(['QUALITY', 'EQUIPMENT']));
  });

  it('최신순으로 놓인다', () => {
    const dates = PAST_CASES.map((item) => item.occurredDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('같은 구분의 다른 사례는 같은 구분만, 자기 자신은 빼고 고른다', () => {
    const others = sameCategoryCases(SELECTED_CASE);
    expect(others.length).toBeGreaterThan(0);
    for (const item of others) {
      expect(item.caseCategory).toBe(SELECTED_CASE.caseCategory);
      expect(item.caseNo).not.toBe(SELECTED_CASE.caseNo);
    }
    expect(sameCategoryCases(PAST_CASES[2] ?? SELECTED_CASE).map((item) => item.caseNo)).toEqual(['CASE-0001']);
  });

  it('사례 작업 로그의 주체는 사용자뿐이고(AI 주체 없음), 등록은 AI 경유로 표시한다', () => {
    for (const entry of SELECTED_CASE_HISTORY) expect(entry.actorType).toBe(ACTOR_TYPE.USER);
    const registered = SELECTED_CASE_HISTORY.find((entry) => entry.businessEventType === PROPOSED_BUSINESS_EVENT_TYPE.CASE_REGISTERED);
    expect(registered?.isAiAssisted).toBe(true);
    expect(SELECTED_CASE_HISTORY.map((entry) => entry.businessEventType)).toEqual(['INSPECTION_REGISTERED', 'DISPOSITION_SET', 'CASE_REGISTERED']);
    expect(CASE_REGISTER_STEPS.at(-1)).toBe('품질 담당 확인·저장');
  });

  it('부르는 곳은 REQ-CASE-004의 셋이다 (AI 패널·@AI·품질 관리 버튼)', () => {
    expect(CASE_CALL_SITES.map((site) => site.key)).toEqual(['panel', 'chat', 'quality']);
    expect(CASE_CALL_SITES[2]?.how).toContain('AI 패널이 열리고 질문이 자동으로');
  });

  it("'비슷한 사례 찾기'가 넣을 질문에 LOT과 강종이 들어간다", () => {
    expect(similarCaseQuestion('HT-BOF1-260912-004', 'SM355A')).toBe('SM355A HT-BOF1-260912-004 불합격과 비슷한 과거 사례 찾아줘');
  });

  it('LOT 번호는 9.2 형식이고, 금지어·단독 SM355가 없다', () => {
    const texts = collectTexts({ PAST_CASES, SELECTED_CASE_HISTORY, CASE_CALL_SITES, CASE_REGISTER_STEPS });
    expect(findMalformedNumbers(texts)).toEqual([]);
    expect(findForbiddenWords(texts)).toEqual([]);
    expect(SELECTED_CASE.lotNos).toEqual(['HT-BOF1-260912-004']);
    expect(PAST_CASES[1]?.lotNos).toEqual(['CBOF1-260825-011-02']);
  });
});
