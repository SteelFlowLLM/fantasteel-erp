import { describe, expect, it } from 'vitest';
import { ACTOR_TYPE, CASE_CATEGORY, CASE_CATEGORY_LABEL, PROPOSED_BUSINESS_EVENT_TYPE } from '@/codes';
import { collectTexts, findForbiddenWords, findMalformedNumbers } from '@/features/agent/lib/exampleTextCheck';
import {
  CASE_CALL_SITES,
  CASE_REGISTER_STEPS,
  PAST_CASES,
  SELECTED_CASE,
  SELECTED_CASE_HISTORY,
  caseHistoryOf,
  caseKeywords,
  sameCategoryCases,
  searchPastCases,
  similarCaseHref,
  similarCaseQuery,
  similarCaseQuestion,
} from '@/features/pastCases/pastCaseExample';

describe('과거 사례 검색 (REQ-CASE-003, 예시 사례를 화면에서 거름)', () => {
  const TODAY = '2026-10-16';
  const nos = (query: string, category: 'ALL' | 'QUALITY' | 'EQUIPMENT' = 'ALL', period: 'ALL' | 'DAYS_90' = 'ALL') =>
    searchPastCases({ query, category, period, today: TODAY }).map((item) => item.caseNo);

  it('핵심어: 두 글자 이상, 조사·질문마다 붙는 말은 뺀다', () => {
    expect(caseKeywords('성분 불합격 원인')).toEqual(['성분', '불합격']);
    expect(caseKeywords('SM355A 히트 불합격과 비슷한 과거 사례 찾아줘')).toEqual(['SM355A', '히트', '불합격']);
    expect(caseKeywords('  ')).toEqual([]);
    // 설비 이름 끝의 '로'는 조사가 아니다
    expect(caseKeywords('가열로 온도')).toEqual(['가열로', '온도']);
  });

  it('검색어가 없으면 전체 최신순, 있으면 많이 맞는 순(같으면 최신순)이고 하나도 안 맞으면 뺀다', () => {
    expect(nos('')).toEqual(['CASE-0005', 'CASE-0004', 'CASE-0003', 'CASE-0002', 'CASE-0001']);
    expect(nos('SM355A 히트 불합격')[0]).toBe('CASE-0005');
    expect(nos('가열로')).toEqual(['CASE-0001']);
    expect(nos('스케일')).toEqual(['CASE-0004']);
    expect(nos('없는말')).toEqual([]);
  });

  it('LOT 번호·사례 번호·영문 강종은 대소문자 없이 찾는다', () => {
    expect(nos('ht-bof1-260912-004')).toEqual(['CASE-0005']);
    expect(nos('case-0003')).toEqual(['CASE-0003']);
    expect(nos('sphc')).toEqual(['CASE-0004']);
  });

  it('구분과 최근 90일로 거른다 (발생일 MM-DD는 오늘 기준 연도)', () => {
    expect(nos('', 'EQUIPMENT')).toEqual(['CASE-0003', 'CASE-0001']);
    expect(nos('불합격', 'QUALITY')).toEqual(['CASE-0005', 'CASE-0004', 'CASE-0002']);
    // 10-16 기준 90일 = 07-18부터: 07-19는 들고 06-30은 빠진다
    expect(nos('', 'ALL', 'DAYS_90')).toEqual(['CASE-0005', 'CASE-0004', 'CASE-0003', 'CASE-0002']);
  });

  it("품질 화면 '비슷한 사례 찾기'는 강종·LOT 종류로 검색어를 만들어 주소로 넘긴다", () => {
    expect(similarCaseQuery('SM355A', 'HEAT')).toBe('SM355A 히트 불합격');
    expect(similarCaseQuery(null, 'COIL')).toBe('코일 불합격');
    expect(similarCaseHref('SM355A', 'HEAT')).toBe(`/past-cases?q=${encodeURIComponent('SM355A 히트 불합격')}`);
  });
});

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

  it('부르는 곳은 REQ-CASE-004의 셋이다 (AI 패널·@AI·품질 관리 버튼). 지금 동작하는 곳은 품질 관리 버튼뿐', () => {
    expect(CASE_CALL_SITES.map((site) => site.key)).toEqual(['panel', 'chat', 'quality']);
    expect(CASE_CALL_SITES.filter((site) => site.ready).map((site) => site.key)).toEqual(['quality']);
    expect(CASE_CALL_SITES[2]?.how).toContain('이 화면이 열리고 검색어가');
  });

  it('고른 사례의 작업 로그: CASE-0005는 자세한 예시, 나머지도 검사 → 처리 상태 → 사례 등록 세 단계', () => {
    expect(caseHistoryOf(SELECTED_CASE)).toBe(SELECTED_CASE_HISTORY);
    const other = caseHistoryOf(PAST_CASES[3] as (typeof PAST_CASES)[number]);
    expect(other.map((entry) => entry.businessEventType)).toEqual(['INSPECTION_REGISTERED', 'DISPOSITION_SET', 'CASE_REGISTERED']);
    expect(other[2]?.detail).toContain('CASE-0002');
    expect(findMalformedNumbers(collectTexts(PAST_CASES.map(caseHistoryOf)))).toEqual([]);
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
