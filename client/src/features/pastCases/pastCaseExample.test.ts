import { describe, expect, it } from 'vitest';
import { PAST_CASE_EXAMPLES, caseKeywords, searchPastCases, type PastCaseView } from '@fantasteel/shared';
import { ACTOR_TYPE, CASE_CATEGORY, CASE_CATEGORY_LABEL, PROPOSED_BUSINESS_EVENT_TYPE } from '@/codes';
import { collectTexts, findForbiddenWords, findMalformedNumbers } from '@/features/agent/lib/exampleTextCheck';
import {
  CASE_CALL_SITES,
  CASE_REGISTER_STEPS,
  SELECTED_CASE_HISTORY,
  exampleHistoryOf,
  sameCategoryCases,
  similarCaseHref,
  similarCaseQuery,
  similarCaseQuestion,
  summaryQuestion,
} from '@/features/pastCases/pastCaseExample';

const caseOf = (caseNo: string): PastCaseView => PAST_CASE_EXAMPLES.find((c) => c.caseNo === caseNo) as PastCaseView;

describe('과거 사례 예시 (shared PAST_CASE_EXAMPLES, BP-CASE-01)', () => {
  it('사례는 REQ-CASE-001 항목을 모두 갖고, 구분은 CASE_CATEGORY 값이며 예시로 표시된다', () => {
    for (const item of PAST_CASE_EXAMPLES) {
      expect(Object.values(CASE_CATEGORY)).toContain(item.caseCategory);
      expect(CASE_CATEGORY_LABEL[item.caseCategory]).toMatch(/^(품질|설비)$/);
      for (const text of [item.title, item.phenomenon, item.cause, item.actionTaken, item.equipmentText]) expect(text.length).toBeGreaterThan(0);
      expect(item.occurredDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.lots.length).toBeGreaterThan(0);
      expect(item.lots.every((lot) => lot.lotId === null)).toBe(true);
      expect(item.isExample).toBe(true);
    }
    expect(new Set(PAST_CASE_EXAMPLES.map((item) => item.caseCategory))).toEqual(new Set(['QUALITY', 'EQUIPMENT']));
  });

  it('같은 구분의 다른 사례는 같은 구분만, 자기 자신은 빼고 고른다', () => {
    expect(sameCategoryCases(caseOf('CASE-0003'), PAST_CASE_EXAMPLES).map((item) => item.caseNo)).toEqual(['CASE-0002', 'CASE-0001']);
    expect(sameCategoryCases(caseOf('CASE-0005'), PAST_CASE_EXAMPLES).map((item) => item.caseNo)).toEqual(['CASE-0004']);
  });

  it('예시 작업 로그: 주체는 사용자뿐(AI 주체 없음), 등록은 AI 경유. CASE-0005는 자세한 예시, 나머지도 세 단계', () => {
    for (const entry of SELECTED_CASE_HISTORY) expect(entry.actorType).toBe(ACTOR_TYPE.USER);
    expect(SELECTED_CASE_HISTORY.find((entry) => entry.businessEventType === PROPOSED_BUSINESS_EVENT_TYPE.CASE_REGISTERED)?.isAiAssisted).toBe(true);
    expect(exampleHistoryOf(caseOf('CASE-0005'))).toBe(SELECTED_CASE_HISTORY);
    const other = exampleHistoryOf(caseOf('CASE-0002'));
    expect(other.map((entry) => entry.businessEventType)).toEqual(['INSPECTION_REGISTERED', 'DISPOSITION_SET', 'CASE_REGISTERED']);
    expect(other[0]?.time).toBe('07-19 09:00');
    expect(other[2]?.detail).toContain('CASE-0002');
    expect(CASE_REGISTER_STEPS.at(-1)).toBe('품질 담당 확인·저장');
  });

  it('부르는 곳은 REQ-CASE-004의 셋이다 (AI 패널·@AI·품질 관리 버튼)', () => {
    expect(CASE_CALL_SITES.map((site) => site.key)).toEqual(['panel', 'chat', 'quality']);
    expect(CASE_CALL_SITES[2]?.how).toContain('이 화면이 열리고 검색어가');
  });

  it('LOT 번호는 9.2 형식이고, 금지어·단독 SM355가 없다', () => {
    const texts = collectTexts({ PAST_CASE_EXAMPLES, history: PAST_CASE_EXAMPLES.map(exampleHistoryOf), CASE_CALL_SITES, CASE_REGISTER_STEPS });
    expect(findMalformedNumbers(texts)).toEqual([]);
    expect(findForbiddenWords(texts)).toEqual([]);
    expect(caseOf('CASE-0005').lots[0]?.lotNo).toBe('HT-BOF1-260912-004');
    expect(caseOf('CASE-0004').lots[0]?.lotNo).toBe('CBOF1-260825-011-02');
  });
});

describe('과거 사례 검색 규칙 (shared, 서버 검색 API와 같음)', () => {
  const nos = (q: string, extra: { category?: 'QUALITY' | 'EQUIPMENT'; days?: number } = {}) => searchPastCases(PAST_CASE_EXAMPLES, { q, ...extra }, '2026-10-16').map((item) => item.caseNo);

  it('핵심어: 두 글자 이상, 조사·질문마다 붙는 말은 빼고, 설비 이름 끝의 "로"는 남긴다', () => {
    expect(caseKeywords('성분 불합격 원인')).toEqual(['성분', '불합격']);
    expect(caseKeywords('SM355A 히트 불합격과 비슷한 과거 사례 찾아줘')).toEqual(['SM355A', '히트', '불합격']);
    expect(caseKeywords('가열로 온도')).toEqual(['가열로', '온도']);
  });

  it('많이 맞는 순(같으면 최신순), 대소문자 없이, 구분·최근 90일로 거른다', () => {
    expect(nos('')).toEqual(['CASE-0005', 'CASE-0004', 'CASE-0003', 'CASE-0002', 'CASE-0001']);
    expect(nos('SM355A 히트 불합격')[0]).toBe('CASE-0005');
    expect(nos('가열로')).toEqual(['CASE-0001']);
    expect(nos('ht-bof1-260912-004')).toEqual(['CASE-0005']);
    expect(nos('', { category: 'EQUIPMENT' })).toEqual(['CASE-0003', 'CASE-0002', 'CASE-0001']);
    expect(nos('', { days: 90 })).toEqual(['CASE-0005', 'CASE-0004', 'CASE-0003', 'CASE-0002']);
    expect(nos('없는말')).toEqual([]);
  });
});

describe('품질 화면·AI에서 부르는 질문', () => {
  it("'비슷한 사례 찾기'는 강종·LOT 종류로 검색어를 만들어 주소로 넘긴다", () => {
    expect(similarCaseQuery('SM355A', 'HEAT')).toBe('SM355A 히트 불합격');
    expect(similarCaseQuery(null, 'COIL')).toBe('코일 불합격');
    expect(similarCaseHref('SM355A', 'HEAT')).toBe(`/past-cases?q=${encodeURIComponent('SM355A 히트 불합격')}`);
  });

  it('AI 패널 질문과 검색 결과 요약 질문', () => {
    expect(similarCaseQuestion('HT-BOF1-260912-004', 'SM355A')).toBe('SM355A HT-BOF1-260912-004 불합격과 비슷한 과거 사례 찾아줘');
    expect(summaryQuestion('가열로')).toBe('"가열로"와 비슷한 과거 사례를 찾아 원인과 조치를 요약해 줘');
    expect(summaryQuestion('  ')).toBe('최근 과거 사례를 찾아 원인과 조치를 요약해 줘');
  });
});
