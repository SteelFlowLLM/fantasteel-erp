import { describe, expect, it } from 'vitest';
import { isQualityExcluded, productEligibility } from '@/lib/eligibility';

describe('제품 적격 (4.3)', () => {
  it('제품 합격 + 상위 히트 합격 + 미소진', () => {
    expect(productEligibility({ lotStatus: 'AVAILABLE', isPassed: true }, { isPassed: true })).toBe('ELIGIBLE');
    expect(productEligibility({ lotStatus: 'AVAILABLE', isPassed: true }, { isPassed: null })).toBe('PENDING');
    expect(productEligibility({ lotStatus: 'AVAILABLE', isPassed: null }, { isPassed: true })).toBe('PENDING');
    expect(productEligibility({ lotStatus: 'AVAILABLE', isPassed: true }, { isPassed: false })).toBe('HEAT_FAILED');
    expect(productEligibility({ lotStatus: 'AVAILABLE', isPassed: false }, { isPassed: false })).toBe('FAILED');
    expect(productEligibility({ lotStatus: 'SHIPPED', isPassed: true }, { isPassed: true })).toBe('NOT_AVAILABLE');
    expect(productEligibility({ lotStatus: 'AVAILABLE', isPassed: true }, undefined)).toBe('PENDING');
    expect(isQualityExcluded({ isPassed: true }, { isPassed: false })).toBe(true);
    expect(isQualityExcluded({ isPassed: null }, { isPassed: null })).toBe(false);
  });
});
