import { describe, expect, it } from 'vitest';
import { formatEventNo, formatSpecCode } from '@/codes';

describe('작업 로그 번호 (업무 프로세스 9.1 예시)', () => {
  it('EV-YYMMDD-NNN', () => {
    expect(formatEventNo('261004', 23)).toBe('EV-261004-023');
  });

  it('일련번호는 1 이상의 정수', () => {
    expect(() => formatEventNo('261004', 0)).toThrow(RangeError);
    expect(() => formatEventNo('261004', 1.5)).toThrow(RangeError);
  });
});

describe('규격 코드 (REQ-MST-003)', () => {
  it('SL-/CL-강종-두께x폭x길이, 소수 끝 0은 지운다', () => {
    expect(formatSpecCode('SLAB', 'SS275', '250.00', '1500.00', '10000.00')).toBe('SL-SS275-250x1500x10000');
    expect(formatSpecCode('COIL', 'SM355A', '2.30', '1200.00', '1065000.00')).toBe('CL-SM355A-2.3x1200x1065000');
  });
});
