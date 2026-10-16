import { PAST_CASE_EXAMPLES, caseKeywords, searchPastCases } from '@fantasteel/shared';
import { buildDraftMessages, failedItemText, parseDraft, ruleDraft, similarQueryOf, type FailureFacts } from './past-case.draft';

const facts: FailureFacts = {
  lotNo: 'HT-BOF1-261014-001',
  lotType: 'HEAT',
  steelGradeCode: 'SM355A',
  processType: 'STEELMAKING',
  inspectedDate: '2026-10-14',
  failedItems: [{ name: '망가니즈', code: 'MN', value: '1.68', unit: '%', min: null, max: '1.60' }],
  dispositionStatus: 'HOLD',
  dispositionReason: '성분 재확인',
  viaLotNo: null,
};

describe('과거 사례 검색 규칙 (shared, 서버·화면 공통)', () => {
  it('핵심어: 두 글자 이상, 조사·질문마다 붙는 말 제외, 설비 이름 끝 "로"는 남긴다', () => {
    expect(caseKeywords('SM355A 히트 불합격과 비슷한 과거 사례 찾아줘')).toEqual(['SM355A', '히트', '불합격']);
    expect(caseKeywords('가열로 온도')).toEqual(['가열로', '온도']);
  });

  it('많이 맞는 순, 같으면 최신순. 구분·기간으로 거른다', () => {
    const nos = (q: string, extra: { category?: 'QUALITY' | 'EQUIPMENT'; days?: number } = {}) => searchPastCases(PAST_CASE_EXAMPLES, { q, ...extra }, '2026-10-16').map((c) => c.caseNo);
    expect(nos('')).toEqual(['CASE-0005', 'CASE-0004', 'CASE-0003', 'CASE-0002', 'CASE-0001']);
    expect(nos('SM355A 히트 불합격')[0]).toBe('CASE-0005');
    expect(nos('', { category: 'EQUIPMENT' })).toEqual(['CASE-0003', 'CASE-0001']);
    expect(nos('', { days: 90 })).toEqual(['CASE-0005', 'CASE-0004', 'CASE-0003', 'CASE-0002']);
    expect(nos('없는말')).toEqual([]);
  });
});

describe('사례 초안 (REQ-CASE-002)', () => {
  it('검사 결과 초안: 기준을 벗어난 값과 처리 상태로 채우고 원인은 비운다', () => {
    expect(failedItemText(facts.failedItems[0]!)).toBe('망가니즈(MN) 1.68 % (기준 1.60 이하)');
    expect(failedItemText({ name: '항복강도', code: 'YIELD_STRENGTH', value: '300', unit: 'N/mm²', min: '355', max: null })).toBe('항복강도 300 N/mm² (기준 355 이상)');
    const draft = ruleDraft(facts);
    expect(draft).toMatchObject({ caseCategory: 'QUALITY', cause: '', equipmentText: '' });
    expect(draft.title).toBe('SM355A 히트 제강 검사 불합격');
    expect(draft.phenomenon).toContain('망가니즈(MN) 1.68 %');
    expect(draft.actionTaken).toContain('보류');
    expect(ruleDraft({ ...facts, lotType: 'SLAB', lotNo: 'HT-BOF1-261014-001-03', viaLotNo: 'HT-BOF1-261014-001' }).phenomenon).toContain('상위 히트 HT-BOF1-261014-001');
  });

  it('AI 답은 제목·현상이 있어야 쓰고, 구분은 EQUIPMENT가 아니면 QUALITY, 긴 글은 자른다', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft({ title: '', phenomenon: 'x' })).toBeNull();
    expect(parseDraft({ caseCategory: 'OTHER', title: ' 제목 ', phenomenon: '현상', cause: 3 })).toEqual({ caseCategory: 'QUALITY', title: '제목', phenomenon: '현상', cause: '', actionTaken: '', equipmentText: '' });
    expect(parseDraft({ caseCategory: 'EQUIPMENT', title: 't'.repeat(300), phenomenon: 'p' })?.title).toHaveLength(200);
  });

  it('AI에 넘기는 글: 불합격 사실의 숫자와 비슷한 사례(예시 표시), 숫자를 지어내지 말라는 규칙', () => {
    const [system, user] = buildDraftMessages(facts, [PAST_CASE_EXAMPLES[0]!]);
    expect(system?.content).toContain('숫자(측정값·기준)는 [불합격 사실]에 있는 값만');
    expect(user?.content).toContain('망가니즈(MN) 1.68 % (기준 1.60 이하)');
    expect(user?.content).toContain('CASE-0005');
    expect(user?.content).toContain('(예시 사례)');
    expect(similarQueryOf(facts)).toBe('SM355A 히트 망가니즈 불합격');
  });
});
