// 여재 장기 보유 배정 추천을 실제 DB(fs_prod)로 확인한다 (REQ-AGT-004, BP-AGT-01). 확정은 출하요청·배정 확정 권한이 있는 영업 사원, 권한이 없는 사원은 구매 사원이다.
// 이 파일 전용 슬래브 규격을 만들어 다른 테스트의 재고와 섞이지 않게 한다.
import { Test, type TestingModule } from '@nestjs/testing';
import { calcTheoreticalWeightTon, DRAFT_STATUS, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { FactoryAgentService } from './factory-agent.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let agent: FactoryAgentService;
let salesOrders: SalesOrderService;
let sales: AuthUser;
let purchaser: AuthUser;
let slabItemId: number;
let customerId: number;

/**
 * 합격 판정을 받은 슬래브 1매. 재고 반영(onLotsEligibilityChanged)은 부르지 않는다:
 * 부르면 대기 수주에 자동 예약돼 여재가 생기지 않으므로, "여재가 있는데 수주가 예약을 못 받은" 상태를 데이터로 만든다.
 */
async function passedSlab(producedDate: string, tag: string) {
  const now = new Date();
  const grade = (await prisma.item.findUniqueOrThrow({ where: { id: slabItemId } })).steelGradeId;
  const standard = await prisma.inspectionStandard.findFirstOrThrow();
  const inspector = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } });
  const steelmaking = await prisma.productionResult.create({ data: { processType: 'STEELMAKING', converterCode: 'BOF5', startedAt: now, completedAt: now } });
  const heat = await prisma.lot.create({ data: { lotNo: `T-AG-HT-${tag}`, lotType: 'HEAT', steelGradeId: grade, productionResultId: steelmaking.id, initialTon: '250', lotStatus: 'CONSUMED' } });
  await prisma.qualityInspection.create({ data: { lotId: heat.id, inspectionStandardId: standard.id, inspectorEmployeeId: inspector.id, inspectedAt: now, inspectionResult: 'PASS' } });
  const casting = await prisma.productionResult.create({ data: { processType: 'CONTINUOUS_CASTING', startedAt: now, completedAt: now } });
  const slab = await prisma.lot.create({ data: { lotNo: `T-AG-SL-${tag}`, lotType: 'SLAB', itemId: slabItemId, productionResultId: casting.id, producedDate: new Date(`${producedDate}T00:00:00Z`) } });
  await prisma.lotRelation.create({ data: { parentLotId: heat.id, childLotId: slab.id, lotRelationEvidence: 'ACTUAL_INPUT' } });
  await prisma.qualityInspection.create({ data: { lotId: slab.id, inspectionStandardId: standard.id, inspectorEmployeeId: inspector.id, inspectedAt: now, inspectionResult: 'PASS' } });
  return slab;
}

const draftsOfItem = () =>
  prisma.actionDraft.findMany({ where: { messageId: null, payload: { path: ['agent', 'targetKey'], equals: `AGED_SURPLUS:item:${slabItemId}` } }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  agent = moduleRef.get(FactoryAgentService);
  salesOrders = moduleRef.get(SalesOrderService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  sales = await load('2103003');
  purchaser = await load('2207005');
  customerId = (await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
  const base = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SS275-250x1200x10000' } });
  slabItemId = (
    await prisma.item.create({
      data: { itemCode: 'SL-AGT-AGED', itemName: 'Agent 여재 테스트 슬래브', itemType: 'SLAB', unitType: 'QTY', steelGradeId: base.steelGradeId, thicknessMm: '250', widthMm: '1200', lengthMm: '10006', theoreticalWeightTon: calcTheoreticalWeightTon('250', '1200', '10006'), defaultYardId: base.defaultYardId },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('여재 장기 보유 배정 추천 (REQ-AGT-004)', () => {
  it('오래된 여재가 있어도 대기 수주가 없으면 추천하지 않는다', async () => {
    await passedSlab('2026-08-01', 'NOWAIT');
    await agent.scanAll();
    expect(await draftsOfItem()).toEqual([]);
  });

  it('대기 수주가 생기면 추천 후보를 만들고, 다시 돌려도 하나뿐이며, 확정은 추천 확인 기록이다', async () => {
    const created = await salesOrders.create(sales, { customerId, items: [{ itemId: slabItemId, orderedQty: 2, dueDate: '2026-12-31' }] });

    await agent.scanAll();
    await agent.scanAll();

    const drafts = await draftsOfItem();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ actionType: 'ALLOCATION_CONFIRM', draftStatus: DRAFT_STATUS.WAITING_APPROVAL, requesterId: null });
    const view = (await agent.list(sales)).find((v) => v.id === drafts[0].id);
    expect(view?.riskType).toBe('AGED_SURPLUS');
    expect(JSON.stringify(view?.payload.recommendations)).toContain(created.salesOrderNo);

    // 출하요청·배정 권한이 없는 구매 사원은 확정할 수 없다 (COM-002)
    await expect(agent.confirm(purchaser, drafts[0].id)).rejects.toMatchObject({ code: 'COM-002' });
    const result = await agent.confirm(sales, drafts[0].id);
    expect(result).toMatchObject({ executed: true, errorCode: null });
    expect(result.draft).toMatchObject({ draftStatus: DRAFT_STATUS.EXECUTED, confirmerId: sales.employeeId, result: null });
  });
});
