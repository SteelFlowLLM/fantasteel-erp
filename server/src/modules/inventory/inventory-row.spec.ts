// 재고 행 만들기가 동시 거래에서 unique 위반 없이 끝나는지 실제 DB(fs_sales)로 확인한다 (#499).
import { Test, type TestingModule } from '@nestjs/testing';
import { ITEM_TYPE } from '@fantasteel/shared';
import { CommonModule } from '../../common/common.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryModule } from './inventory.module';
import { InventoryRepository } from './inventory.repository';

let moduleRef: TestingModule;
let prisma: PrismaService;
let repository: InventoryRepository;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [PrismaModule, CommonModule, InventoryModule] }).compile();
  prisma = moduleRef.get(PrismaService);
  repository = moduleRef.get(InventoryRepository);
});

afterAll(async () => {
  await moduleRef?.close();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('재고 행 만들기', () => {
  it('재고 행이 없는 제품을 두 거래가 동시에 처음 쓰면 둘 다 성공하고 행은 하나만 생긴다', async () => {
    const tag = `${Date.now() % 100000}`;
    // 제품 규격은 강종·치수·이론중량이 있어야 하고 같은 강종·치수는 하나뿐이라 시드 슬래브 값에 길이만 바꾼다
    const base = await prisma.item.findFirstOrThrow({
      where: { itemType: ITEM_TYPE.SLAB },
      select: { steelGradeId: true, defaultYardId: true, unitType: true, thicknessMm: true, widthMm: true, theoreticalWeightTon: true },
    });
    const item = await prisma.item.create({
      data: {
        itemCode: `SL-TROW${tag}`,
        itemName: `재고 행 시험 ${tag}`,
        itemType: ITEM_TYPE.SLAB,
        unitType: base.unitType,
        steelGradeId: base.steelGradeId,
        defaultYardId: base.defaultYardId,
        thicknessMm: base.thicknessMm,
        widthMm: base.widthMm,
        lengthMm: String(9000 + (Number(tag) % 900)),
        theoreticalWeightTon: base.theoreticalWeightTon,
      },
    });

    // 첫 거래가 행을 넣고 커밋하기 전에 두 번째 거래가 같은 행을 넣으려 한다
    const ensureAndHold = () =>
      prisma.$transaction(async (tx) => {
        await repository.ensureInventory(tx, item.id);
        await sleep(300);
      });
    await expect(Promise.all([ensureAndHold(), ensureAndHold()])).resolves.toHaveLength(2);
    expect(await prisma.inventory.count({ where: { itemId: item.id } })).toBe(1);
  }, 30_000);
});
