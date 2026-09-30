// @nestjs/common 12는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (testing/nest-common.shim.ts 참고)
jest.mock('@nestjs/common', () => require('./testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.service', () => ({ RealtimeService: class {} }));
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

import type { AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { SpecMappingService } from './spec-mapping.service';

const D = (v: string) => new Prisma.Decimal(v);
const user = { employeeId: 1 } as AuthUser;

const spec = (id: number, itemType: string, weight: string, steelGradeId = 1) => ({
  id, specCode: `${itemType}-${id}`, steelGradeId, theoreticalWeightTon: D(weight), thicknessMm: D('1'), widthMm: D('1'), lengthMm: D('1'), isActive: true,
  item: { itemType }, steelGrade: { steelGradeCode: 'SS275' },
});

function setup(specs: Record<number, ReturnType<typeof spec>>, mapped: { slab?: string; coil?: string } = {}) {
  const tx = {};
  const prisma = { tx: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    findSpec: jest.fn(async (_t: unknown, id: number) => specs[id] ?? null),
    findBySlab: jest.fn(async () => (mapped.slab ? { coilSpec: { specCode: mapped.slab } } : null)),
    findByCoil: jest.fn(async () => (mapped.coil ? { slabSpec: { specCode: mapped.coil } } : null)),
    create: jest.fn(async (_t: unknown, slabSpecId: number, coilSpecId: number) => ({ id: 1, slabSpecId, coilSpecId, slabSpec: specs[slabSpecId], coilSpec: specs[coilSpecId], createdAt: new Date(), updatedAt: new Date() })),
  };
  const specsRepo = { usedSpecIds: jest.fn().mockResolvedValue(new Set()) };
  const changes = { record: jest.fn() };
  return { service: new SpecMappingService(prisma as never, repo as never, specsRepo as never, changes as never), repo, changes };
}

describe('SpecMappingService.create (REQ-MST-004)', () => {
  it('코일 이론중량이 슬래브보다 크면 거부하고 저장하지 않는다', async () => {
    const { service, repo } = setup({ 1: spec(1, 'SLAB', '23.550'), 2: spec(2, 'COIL', '30.000') });
    await expect(service.create({ slabSpecId: 1, coilSpecId: 2 }, user)).rejects.toThrow(/보다 클 수 없습니다/);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('정상 매핑은 열연 계획 수율(코일 ÷ 슬래브, 소수 4자리)을 계산해 돌려준다', async () => {
    const { service, changes } = setup({ 1: spec(1, 'SLAB', '23.550'), 2: spec(2, 'COIL', '22.975') });
    const view = await service.create({ slabSpecId: 1, coilSpecId: 2 }, user);
    expect(view.hotRollingPlannedYieldRate).toBe('0.9756');
    expect(changes.record).toHaveBeenCalledTimes(1);
  });

  it('이미 매핑된 슬래브 규격은 거부한다', async () => {
    const { service } = setup({ 1: spec(1, 'SLAB', '23.550'), 2: spec(2, 'COIL', '22.975') }, { slab: 'COIL-9' });
    await expect(service.create({ slabSpecId: 1, coilSpecId: 2 }, user)).rejects.toThrow(/이미 코일 규격 COIL-9/);
  });

  it('강종이 다르면 거부한다', async () => {
    const { service } = setup({ 1: spec(1, 'SLAB', '23.550'), 2: spec(2, 'COIL', '20.000', 2) });
    await expect(service.create({ slabSpecId: 1, coilSpecId: 2 }, user)).rejects.toThrow(/강종이 다른/);
  });
});
