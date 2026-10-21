import { PAST_CASE_EXAMPLES, type PastCaseView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { formOfCase, formOfDraft, lotIdsOf, missingFieldsOf } from '@/features/pastCases/pastCaseForm';

const registered: PastCaseView = {
  ...PAST_CASE_EXAMPLES[0],
  id: 7,
  caseNo: 'CASE-0007',
  isExample: false,
  lots: [
    { lotId: 11, lotNo: 'HT-BOF1-261014-001' },
    { lotId: 12, lotNo: 'HT-BOF1-261014-002' },
  ],
};

describe('사례 입력값', () => {
  it('사례·초안에서 입력칸 값만 뽑는다 (번호·등록자·LOT은 빠진다)', () => {
    const form = formOfCase(registered);
    expect(Object.keys(form).sort()).toEqual(['actionTaken', 'caseCategory', 'cause', 'equipmentText', 'occurredDate', 'phenomenon', 'title']);
    expect(form).toMatchObject({ title: registered.title, caseCategory: registered.caseCategory, occurredDate: registered.occurredDate });
    expect(formOfDraft({ lot: { lotId: 1, lotNo: 'L', lotType: 'HEAT', steelGradeCode: null }, ...form, aiWritten: false, aiNotice: null, referenceCaseNos: [] })).toEqual(form);
  });

  it('제목·현상·발생일이 비면 저장할 수 없다', () => {
    const form = formOfCase(registered);
    expect(missingFieldsOf(form)).toEqual([]);
    expect(missingFieldsOf({ ...form, title: '  ', phenomenon: '', occurredDate: '' })).toEqual(['제목', '현상', '발생일']);
  });

  it('수정 때 보낼 관련 LOT은 실제 LOT id만이다', () => {
    expect(lotIdsOf(registered)).toEqual([11, 12]);
    expect(lotIdsOf({ ...registered, lots: [{ lotId: null, lotNo: '예시' }] })).toEqual([]);
  });
});
