import { describe, expect, it } from 'vitest';
import { ApiError, FieldErrors, InputError } from '@/api/client';
import { assertUnchanged, decimalText, nonNegativeInteger, optionalDate, optionalText, requiredText, requireRow } from '@/api/validation';
import { createSeedTables } from '@/mock/seed';

const errorsOf = (run: (errors: FieldErrors) => void): Readonly<Record<string, string>> => {
  const errors = new FieldErrors();
  run(errors);
  try {
    errors.throwIfAny();
  } catch (error) {
    if (error instanceof InputError) return error.fieldErrors;
    throw error;
  }
  return {};
};

describe('입력 확인 도우미', () => {
  it('필수 글자: 앞뒤 공백을 빼고, 비었거나 길면 안내 (조사는 받침에 맞춘다)', () => {
    expect(errorsOf((e) => requiredText(e, 'employeeName', '  ', '이름', 50))).toEqual({ employeeName: '이름을 입력해 주세요' });
    expect(errorsOf((e) => requiredText(e, 'employeeNo', '', '사원번호', 20))).toEqual({ employeeNo: '사원번호를 입력해 주세요' });
    expect(errorsOf((e) => requiredText(e, 'name', 'abcdef', '부서명', 5))).toEqual({ name: '부서명은 5자까지 입력할 수 있어요' });
    const errors = new FieldErrors();
    expect(requiredText(errors, 'name', ' 영업부 ', '부서명', 50)).toBe('영업부');
    expect(optionalText(errors, 'unit', '  ', '단위', 20)).toBeNull();
  });

  it('십진수: 자리수·부호·0 초과·최댓값을 확인하고 앞자리 0을 정리한다', () => {
    const rule = { label: '계획 수율', scale: 4, integerDigits: 2, positive: true, max: '1' };
    const errors = new FieldErrors();
    expect(decimalText(errors, 'y', '0.9000', rule)).toBe('0.9000');
    expect(decimalText(errors, 'y', '1', rule)).toBe('1');
    expect(decimalText(errors, 'y', '', rule)).toBeNull();
    expect(errors.isEmpty).toBe(true);
    expect(errorsOf((e) => decimalText(e, 'y', '0', rule))).toEqual({ y: '계획 수율은 0보다 커야 해요' });
    expect(errorsOf((e) => decimalText(e, 'y', '1.0001', rule))).toEqual({ y: '계획 수율은 1 이하로 입력해 주세요' });
    expect(errorsOf((e) => decimalText(e, 'y', '0.12345', rule))).toEqual({ y: '계획 수율은 소수 4자리까지 입력할 수 있어요' });
    expect(errorsOf((e) => decimalText(e, 'y', 'abc', rule))).toEqual({ y: '계획 수율은 숫자로 입력해 주세요' });
    expect(errorsOf((e) => decimalText(e, 't', '-0.20', { label: '두께', scale: 2, integerDigits: 6 }))).toEqual({ t: '두께는 0 이상으로 입력해 주세요' });
    expect(decimalText(new FieldErrors(), 't', '-0.20', { label: '두께 허용차', scale: 4, integerDigits: 8, allowNegative: true })).toBe('-0.20');
    expect(decimalText(new FieldErrors(), 't', '0250.50', { label: '두께', scale: 2, integerDigits: 6 })).toBe('250.50');
    expect(errorsOf((e) => decimalText(e, 't', '1234567', { label: '두께', scale: 2, integerDigits: 6 }))).toEqual({ t: '두께가 너무 커요' });
  });

  it('정수·날짜', () => {
    expect(nonNegativeInteger(new FieldErrors(), 's', '3', '정렬 순서')).toBe(3);
    expect(errorsOf((e) => nonNegativeInteger(e, 's', '1.5', '정렬 순서'))).toEqual({ s: '정렬 순서는 0 이상의 정수로 입력해 주세요' });
    expect(optionalDate(new FieldErrors(), 'd', '2026-10-31', '마감일')).toBe('2026-10-31');
    expect(errorsOf((e) => optionalDate(e, 'd', '2026-02-30', '마감일'))).toEqual({ d: '마감일은 YYYY-MM-DD 형식의 날짜로 입력해 주세요' });
  });

  it('없는 참조는 COM-003, 화면을 연 뒤 바뀐 행은 COM-001', () => {
    const tables = createSeedTables();
    expect(requireRow(tables, 'department', 1).departmentCode).toBe('SAL');
    expect(() => requireRow(tables, 'department', 999)).toThrow(ApiError);
    try {
      requireRow(tables, 'yard', null);
    } catch (error) {
      expect(error instanceof ApiError && error.code).toBe('COM-003');
    }
    expect(() => assertUnchanged('2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')).not.toThrow();
    expect(() => assertUnchanged('2026-10-01T00:00:00.000Z', undefined)).not.toThrow();
    try {
      assertUnchanged('2026-10-01T00:00:01.000Z', '2026-10-01T00:00:00.000Z', '부서');
    } catch (error) {
      expect(error instanceof ApiError && [error.code, error.detail]).toEqual([
        'COM-001',
        '부서가 다른 곳에서 먼저 바뀌었어요. 새로 불러온 내용을 확인하고 다시 저장해 주세요',
      ]);
    }
  });
});
