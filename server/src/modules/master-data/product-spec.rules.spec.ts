// @nestjs/common 12는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (testing/nest-common.shim.ts 참고)
jest.mock('@nestjs/common', () => require('./testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.service', () => ({ RealtimeService: class {} }));
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { assertMappable, buildSpecCode, computeSpecWeight, type MappableSpec } from './product-spec.rules';
import { yieldText } from './master-data.util';

const D = (v: string) => new Prisma.Decimal(v);
const spec = (over: Partial<MappableSpec> & { theoreticalWeightTon: Prisma.Decimal }): MappableSpec => ({ id: 1, specCode: 'X', itemType: 'SLAB', steelGradeId: 1, ...over });

describe('이론중량 계산 (REQ-MST-003)', () => {
  it('250 × 1200 × 10000 mm = 23.550 t', () => {
    expect(computeSpecWeight(250, 1200, 10000).toFixed(3)).toBe('23.550');
  });
  it('코일 규격(4.5 × 1200 × 542000)은 소수 3자리로 반올림한다', () => {
    expect(computeSpecWeight(4.5, 1200, 542000).toFixed(3)).toBe('22.975');
  });
  it('0.01mm 치수처럼 이론중량이 0.000이 되면 거부한다', () => {
    expect(() => computeSpecWeight(0.01, 0.01, 0.01)).toThrow(AppException);
  });
});

describe('규격 코드', () => {
  it('슬래브는 SL-, 코일은 CL- 접두사, 소수 치수는 불필요한 0을 뺀다', () => {
    expect(buildSpecCode('SLAB', 'SS275', D('250.00'), D('1200.00'), D('10000.00'))).toBe('SL-SS275-250x1200x10000');
    expect(buildSpecCode('COIL', 'SPHC', D('3.20'), D('1000.00'), D('632000.00'))).toBe('CL-SPHC-3.2x1000x632000');
  });
});

describe('슬래브·코일 매핑 규칙 (REQ-MST-004)', () => {
  const slab = spec({ id: 1, specCode: 'SL-A', itemType: 'SLAB', theoreticalWeightTon: D('23.550') });

  it('코일 이론중량이 슬래브보다 크면 거부한다', () => {
    const coil = spec({ id: 2, specCode: 'CL-A', itemType: 'COIL', theoreticalWeightTon: D('23.551') });
    expect(() => assertMappable(slab, coil, {})).toThrow(/보다 클 수 없습니다/);
  });
  it('코일 이론중량이 슬래브와 같으면 허용한다 (수율 1.0000)', () => {
    const coil = spec({ id: 2, specCode: 'CL-A', itemType: 'COIL', theoreticalWeightTon: D('23.550') });
    expect(() => assertMappable(slab, coil, {})).not.toThrow();
    expect(yieldText(coil.theoreticalWeightTon, slab.theoreticalWeightTon)).toBe('1.0000');
  });
  it('강종이 다르면 거부한다', () => {
    const coil = spec({ id: 2, specCode: 'CL-A', itemType: 'COIL', steelGradeId: 2, theoreticalWeightTon: D('20.000') });
    expect(() => assertMappable(slab, coil, {})).toThrow(/강종이 다른/);
  });
  it('이미 매핑된 슬래브·코일은 거부한다', () => {
    const coil = spec({ id: 2, specCode: 'CL-A', itemType: 'COIL', theoreticalWeightTon: D('20.000') });
    expect(() => assertMappable(slab, coil, { slabMappedCoilCode: 'CL-B' })).toThrow(/이미 코일 규격 CL-B/);
    expect(() => assertMappable(slab, coil, { coilMappedSlabCode: 'SL-B' })).toThrow(/이미 슬래브 규격 SL-B/);
  });
  it('슬래브·코일 유형이 뒤바뀌면 거부한다', () => {
    const coil = spec({ id: 2, specCode: 'CL-A', itemType: 'COIL', theoreticalWeightTon: D('20.000') });
    expect(() => assertMappable(coil, slab, {})).toThrow(/슬래브 규격이 아닙니다/);
  });
  it('열연 계획 수율 = 코일 ÷ 슬래브, 소수 4자리', () => {
    expect(yieldText(D('22.975'), D('23.550'))).toBe('0.9756');
  });
});
