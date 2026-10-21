// 납기 위험·불합격률 상승 알림을 실제 DB(fs_prod)로 확인한다 (REQ-AGT-004).
import { Test, type TestingModule } from '@nestjs/testing';
import type { AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays } from './agent-rules';
import { FactoryAgentService } from './factory-agent.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let agent: FactoryAgentService;
let authUsers: AuthUserService;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  agent = moduleRef.get(FactoryAgentService);
  authUsers = moduleRef.get(AuthUserService);
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('납기 위험 알림 (REQ-AGT-004)', () => {
  it('납기가 기준일 이내이고 출하 전인 수주 품목의 담당 영업에게 알리고, 안 읽은 같은 알림은 다시 보내지 않는다', async () => {
    const owner = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const slab = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
    const setting = await prisma.productionSetting.findFirstOrThrow();
    const salesOrder = await prisma.salesOrder.create({
      data: {
        salesOrderNo: 'T-SO-AGT-DUE',
        customerId: customer.id,
        ownerEmployeeId: owner.id,
        salesOrderItems: { create: [{ itemId: slab.id, orderedQty: 3, dueDate: new Date(`${addDays(seoulToday(), setting.deliveryRiskDays)}T00:00:00.000Z`) }] },
      },
    });

    await agent.scanAll();
    await agent.scanAll();

    const alerts = await prisma.notification.findMany({ where: { recipientId: owner.id, notificationContent: { contains: 'T-SO-AGT-DUE' } } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ notificationType: 'TASK_ASSIGNED', linkPath: `/sales-orders/${salesOrder.id}` });

    // 읽으면 다음 감지에서 다시 알린다
    await prisma.notification.update({ where: { id: alerts[0].id }, data: { readAt: new Date() } });
    await agent.scanAll();
    expect(await prisma.notification.count({ where: { recipientId: owner.id, notificationContent: { contains: 'T-SO-AGT-DUE' } } })).toBe(2);
  });

  it('출하를 마친 수주 품목은 알리지 않는다', async () => {
    const owner = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const slab = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
    await prisma.salesOrder.create({
      data: { salesOrderNo: 'T-SO-AGT-DONE', customerId: customer.id, ownerEmployeeId: owner.id, salesOrderItems: { create: [{ itemId: slab.id, orderedQty: 3, dueDate: new Date(`${seoulToday()}T00:00:00.000Z`), salesOrderItemStatus: 'SHIPPED' }] } },
    });
    await agent.scanAll();
    expect(await prisma.notification.count({ where: { notificationContent: { contains: 'T-SO-AGT-DONE' } } })).toBe(0);
  });
});

describe('불합격률 상승 알림 (REQ-AGT-004)', () => {
  it('강종별 불합격률이 기준을 넘으면 품질 부서원에게 알린다', async () => {
    const grade = await prisma.steelGrade.findUniqueOrThrow({ where: { steelGradeCode: 'SPHC' } });
    const standard = await prisma.inspectionStandard.findFirstOrThrow();
    const inspector = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } });
    const now = new Date();
    for (let n = 0; n < 6; n++) {
      const result = await prisma.productionResult.create({ data: { processType: 'STEELMAKING', converterCode: 'BOF5', startedAt: now, completedAt: now } });
      const lot = await prisma.lot.create({ data: { lotNo: `T-HT-AGT-QR-${n}`, lotType: 'HEAT', steelGradeId: grade.id, productionResultId: result.id, initialTon: '250' } });
      await prisma.qualityInspection.create({ data: { lotId: lot.id, inspectionStandardId: standard.id, inspectorEmployeeId: inspector.id, inspectedAt: now, inspectionResult: n < 4 ? 'FAIL' : 'PASS' } });
    }

    await agent.scanAll();

    const qc = await prisma.department.findUniqueOrThrow({ where: { departmentCode: 'QC' } });
    const members = await prisma.employee.findMany({ where: { departmentId: qc.id, isActive: true } });
    const alerts = await prisma.notification.findMany({ where: { notificationContent: { contains: '강종 SPHC' }, recipientId: { in: members.map((m) => m.id) } } });
    expect(alerts.length).toBe(members.length);
    expect(alerts[0].notificationContent).toContain('불합격률');
  });
});

describe('관리자 지금 감지 (API-283, 이슈 #477)', () => {
  const load = async (employeeNo: string): Promise<AuthUser> => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };

  it('관리자가 아니면 COM-002', async () => {
    await expect(agent.scanNow(await load('2207005'))).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('관리자가 돌리면 스케줄과 같은 규칙 4개를 돌려 결과를 주고, 다시 돌려도 같은 알림을 또 보내지 않는다', async () => {
    const admin = await load('1503001');
    const owner = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const slab = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
    const setting = await prisma.productionSetting.findFirstOrThrow();
    await prisma.salesOrder.create({
      data: { salesOrderNo: 'T-SO-AGT-NOW', customerId: customer.id, ownerEmployeeId: owner.id, salesOrderItems: { create: [{ itemId: slab.id, orderedQty: 2, dueDate: new Date(`${addDays(seoulToday(), setting.deliveryRiskDays)}T00:00:00.000Z`) }] } },
    });

    const first = await agent.scanNow(admin);
    expect(first.results.map((r) => r.riskType).sort()).toEqual(['AGED_SURPLUS', 'DUE_RISK', 'QUALITY_RATE_RISE', 'RAW_SHORTAGE']);
    expect(first.results.every((r) => r.error === null)).toBe(true);
    expect(new Date(first.ranAt).getTime()).toBeGreaterThan(0);
    expect(first.results.find((r) => r.riskType === 'DUE_RISK')?.created).toBeGreaterThanOrEqual(1);
    const count = () => prisma.notification.count({ where: { recipientId: owner.id, notificationContent: { contains: 'T-SO-AGT-NOW' } } });
    expect(await count()).toBe(1);

    await agent.scanNow(admin);
    expect(await count()).toBe(1);
  });
});
