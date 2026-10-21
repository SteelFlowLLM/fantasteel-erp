import { describe, expect, it } from 'vitest';
import { ferroalloyTonFor, rawMaterialTonFor } from '@/lib/mrp';

describe('실적 입력 원료 투입 예정량 (업무 프로세스 4.4)', () => {
  it('원료 = 용선 × t/t, 합금철 = 히트 톤 × kg/t ÷ 1,000', () => {
    expect(rawMaterialTonFor('277.778', '1.600')).toBe('444.445');
    expect(rawMaterialTonFor('277.778', '0.150')).toBe('41.667');
    expect(ferroalloyTonFor('250.000', '10.000')).toBe('2.500');
    expect(ferroalloyTonFor('500.000', '20.000')).toBe('10.000');
  });
});
