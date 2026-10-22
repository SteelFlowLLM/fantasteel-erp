import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { errorMessageOf, errorTitleOf } from '@/stores/useToastStore';

describe('오류 안내 제목 (#531)', () => {
  it('원료 부족에 빌려 쓴 INV-001은 원료 재고 부족으로, 나머지는 9.3 문구 그대로', () => {
    const raw = new ApiError('INV-001', '원료 LOT 잔량이 부족해요: 철광석 166.675t');
    expect(errorTitleOf(raw)).toBe('원료 재고 부족');
    expect(errorMessageOf(raw)).toBe('원료 재고 부족 · 원료 LOT 잔량이 부족해요: 철광석 166.675t (INV-001)');
    expect(errorTitleOf(new ApiError('INV-001', '미배정 매수는 2매예요'))).toBe('예약·배정 가능한 매수 부족');
    expect(errorTitleOf(new ApiError('SO-002'))).toBe('수량은 1 이상의 정수로 입력해 주세요');
  });
});
