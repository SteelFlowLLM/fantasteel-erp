// 납기 위험·불합격률 상승 알림을 실제 DB(fs_prod)로 확인한다 (REQ-AGT-004).
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays } from './agent-rules';
import { FactoryAgentService } from './factory-agent.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let agent: FactoryAgentService;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  agent = moduleRef.get(FactoryAgentService);
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
    expect(alerts[0]).toMatchObject({ notificationType: 'DUE_RISK', linkPath: `/sales-orders/${salesOrder.id}` });

    // 읽으면 다음 감지에서 다시 알린다
    await prisma.notification.update({ where: { id: alerts[0].id }, data: { readAt: new Date() } });
    await agent.scanAll();
    expect(await prisma.notification.count({ where: { recipientId: owner.id, notificationContent: { contains: 'T-SO-AGT-DUE' } } })).toBe(2);
  });

  it('배포 전에 TASK_ASSIGNED로 보낸 안 읽은 같은 알림이 있으면 새 유형으로 다시 보내지 않는다', async () => {
    const owner = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const slab = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
    const setting = await prisma.productionSetting.findFirstOrThrow();
    const salesOrder = await prisma.salesOrder.create({
      data: { salesOrderNo: 'T-SO-AGT-LEGACY', customerId: customer.id, ownerEmployeeId: owner.id, salesOrderItems: { create: [{ itemId: slab.id, orderedQty: 3, dueDate: new Date(`${addDays(seoulToday(), setting.deliveryRiskDays)}T00:00:00.000Z`) }] } },
    });
    const content = `[Agent 납기 위험] 수주 T-SO-AGT-LEGACY 1번 품목 납기 ${addDays(seoulToday(), setting.deliveryRiskDays)}, 출하 0/3매`;
    await prisma.notification.create({ data: { notificationType: 'TASK_ASSIGNED', recipientId: owner.id, notificationContent: content, linkPath: `/sales-orders/${salesOrder.id}` } });

    await agent.scanAll();

    expect(await prisma.notification.count({ where: { recipientId: owner.id, notificationContent: content } })).toBe(1);
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
    expect(alerts.every((a) => a.notificationType === 'QUALITY_RATE_RISE')).toBe(true);
  });
});
