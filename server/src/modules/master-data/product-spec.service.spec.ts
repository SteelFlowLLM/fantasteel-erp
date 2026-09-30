// @nestjs/common 12는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (testing/nest-common.shim.ts 참고)
jest.mock('@nestjs/common', () => require('./testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.service', () => ({ RealtimeService: class {} }));
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { ERROR_CODE } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/errors/app.exception';
import type { AuthUser } from '@fantasteel/shared';
import { ProductSpecService } from './product-spec.service';
import { USED_SPEC_MESSAGE } from './product-spec.rules';

jest.mock('../../common/concurrency/locks', () => ({ lockProductInventory: jest.fn().mockResolvedValue({ id: 1, onHandQty: 0, reservedQty: 0 }) }));

const D = (v: string | number) => new Prisma.Decimal(v);
const user = { employeeId: 1 } as AuthUser;

const slabItem = { id: 1, itemCode: 'SLAB', itemType: 'SLAB', isActive: true };
const grade = { id: 1, steelGradeCode: 'SS275', isActive: true };

function existingSpec(over: Record<string, unknown> = {}) {
  return {
    id: 10, specCode: 'SL-SS275-250x1200x10000', itemId: 1, steelGradeId: 1,
    thicknessMm: D('250.00'), widthMm: D('1200.00'), lengthMm: D('10000.00'), theoreticalWeightTon: D('23.550'), yardId: null, isActive: true,
    createdAt: new Date(), updatedAt: new Date(), item: slabItem, steelGrade: grade, yard: null, slabMapping: null, coilMapping: null, ...over,
  };
}

function setup(opts: { used?: boolean; current?: ReturnType<typeof existingSpec>; combinationOwner?: { id: number; specCode: string } | null } = {}) {
  const tx = {
    item: { findUnique: jest.fn().mockResolvedValue(slabItem), findFirst: jest.fn().mockResolvedValue(slabItem) },
    steelGrade: { findUnique: jest.fn().mockResolvedValue(grade) },
    yard: { findUnique: jest.fn() },
  };
  const prisma = { tx: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const created: Record<string, unknown>[] = [];
  const repo = {
    findById: jest.fn().mockResolvedValue(opts.current ?? null),
    findByCombination: jest.fn().mockResolvedValue(opts.combinationOwner ?? null),
    findBySpecCode: jest.fn().mockResolvedValue(null),
    usedSpecIds: jest.fn().mockResolvedValue(new Set(opts.used ? [10] : [])),
    create: jest.fn(async (_tx: unknown, data: Record<string, unknown>) => { created.push(data); return existingSpec({ id: 99, ...data }); }),
    update: jest.fn(async (_tx: unknown, id: number, data: Record<string, unknown>) => existingSpec({ id, ...data })),
  };
  const changes = { record: jest.fn() };
  const service = new ProductSpecService(prisma as never, repo as never, changes as never);
  return { service, repo, changes, created };
}

describe('ProductSpecService.create', () => {
  it('250 × 1200 × 10000 → 이론중량 23.550을 서버가 계산해 저장한다', async () => {
    const { service, created, changes } = setup();
    const view = await service.create({ itemType: 'SLAB', steelGradeId: 1, thicknessMm: 250, widthMm: 1200, lengthMm: 10000 }, user);
    expect((created[0].theoreticalWeightTon as Prisma.Decimal).toFixed(3)).toBe('23.550');
    expect(created[0].specCode).toBe('SL-SS275-250x1200x10000');
    expect(view.theoreticalWeightTon.toFixed(3)).toBe('23.550');
    expect(view.isUsed).toBe(false);
    expect(changes.record).toHaveBeenCalledTimes(1);
  });

  it('클라이언트가 보낸 이론중량 값은 쓰지 않는다 (DTO에 없는 값은 무시되고 계산값만 저장)', async () => {
    const { service, created } = setup();
    await service.create({ itemType: 'SLAB', steelGradeId: 1, thicknessMm: 250, widthMm: 1200, lengthMm: 10000, theoreticalWeightTon: 1 } as never, user);
    expect((created[0].theoreticalWeightTon as Prisma.Decimal).toFixed(3)).toBe('23.550');
  });

  it('강종·두께·폭·길이 조합이 이미 있으면 친절한 메시지로 거부한다', async () => {
    const { service, repo } = setup({ combinationOwner: { id: 5, specCode: 'SL-SS275-250x1200x10000' } });
    await expect(service.create({ itemType: 'SLAB', steelGradeId: 1, thicknessMm: 250, widthMm: 1200, lengthMm: 10000 }, user)).rejects.toThrow(/이미 등록된 강종·두께·폭·길이 조합입니다 \(SL-SS275-250x1200x10000\)/);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('ProductSpecService.update (MST-002)', () => {
  it('사용된 규격의 치수를 바꾸면 MST-002로 거부한다', async () => {
    const { service, repo } = setup({ used: true, current: existingSpec() });
    const err = await service.update(10, { thicknessMm: 260 }, user).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe(ERROR_CODE.MST_002);
    expect((err as AppException).message).toBe(USED_SPEC_MESSAGE);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('사용된 규격이라도 값이 그대로면 치수를 바꾼 것이 아니다 (야드만 수정 가능)', async () => {
    const { service, repo } = setup({ used: true, current: existingSpec() });
    await expect(service.update(10, { thicknessMm: 250, widthMm: 1200, lengthMm: 10000 }, user)).resolves.toMatchObject({ isUsed: true });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('아직 쓰이지 않은 규격은 치수를 고치고 이론중량·규격 코드를 다시 계산한다', async () => {
    const { service, repo } = setup({ used: false, current: existingSpec() });
    await service.update(10, { thicknessMm: 260 }, user);
    const data = repo.update.mock.calls[0][2] as { theoreticalWeightTon: Prisma.Decimal; specCode: string };
    expect(data.theoreticalWeightTon.toFixed(3)).toBe('24.492'); // 260 × 1200 × 10000 × 7.85 ÷ 1e9
    expect(data.specCode).toBe('SL-SS275-260x1200x10000');
  });

  it('바꾼 치수가 다른 규격과 겹치면 거부한다', async () => {
    const { service } = setup({ used: false, current: existingSpec(), combinationOwner: { id: 11, specCode: 'SL-SS275-260x1200x10000' } });
    await expect(service.update(10, { thicknessMm: 260 }, user)).rejects.toThrow(/이미 등록된 강종·두께·폭·길이 조합/);
  });

  it('매핑된 규격의 치수를 바꿔 코일이 슬래브보다 무거워지면 거부한다', async () => {
    const coil = existingSpec({ id: 20, specCode: 'CL', item: { itemType: 'COIL' }, theoreticalWeightTon: D('22.975') });
    const current = existingSpec({ slabMapping: { id: 1, coilSpec: coil } });
    const { service } = setup({ used: false, current });
    await expect(service.update(10, { thicknessMm: 200 }, user)).rejects.toThrow(/보다 클 수 없습니다/);
  });
});
