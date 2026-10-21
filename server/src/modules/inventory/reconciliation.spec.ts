import { Test } from '@nestjs/testing';
import { ITEM_TYPE, NOTIFICATION_TYPE, RECONCILIATION_STATUS, RESERVATION_STATUS, ROLE, type AuthUser, type ReservationReconciliationRow } from '@fantasteel/shared';
import { CommonModule } from '../../common/common.module';
import { AppException } from '../../common/errors/app.exception';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryModule } from './inventory.module';
import { reconciliationRows } from './reconciliation.calculator';
import { alertContent, ReconciliationService } from './reconciliation.service';

const item = (id: number, itemCode: string) => [id, { id, itemCode, itemName: itemCode, itemType: ITEM_TYPE.SLAB, steelGradeCode: 'SS275' }] as const;

describe('정합성 보정 판단 (REQ-INV-010)', () => {
  const items = new Map([item(1, 'SL-B'), item(2, 'SL-A'), item(3, 'SL-C'), item(4, 'SL-D')]);

  it('같으면 일치, 다르면 불일치, 예약을 지워야만 맞출 수 있거나 재고 행이 없으면 보정 불가', () => {
    const rows = reconciliationRows(
      [
        { itemId: 1, onHandQty: 10, reservedQty: 5, rollingAllocatedQty: 0 },
        { itemId: 2, onHandQty: 10, reservedQty: 3, rollingAllocatedQty: 0 },
        { itemId: 3, onHandQty: 4, reservedQty: 1, rollingAllocatedQty: 2 },
      ],
      new Map([
        [1, 3],
        [2, 3],
        [3, 3],
        [4, 2],
      ]),
      items,
    );
    expect(rows.map((r) => [r.itemCode, r.status, r.differenceQty])).toEqual([
      ['SL-A', RECONCILIATION_STATUS.MATCHED, 0],
      ['SL-B', RECONCILIATION_STATUS.MISMATCHED, 2],
      ['SL-C', RECONCILIATION_STATUS.UNFIXABLE, -2],
      ['SL-D', RECONCILIATION_STATUS.UNFIXABLE, -2],
    ]);
    expect(rows[2].reason).toContain('재고 4매 − 열연 배정 2매(2매)를 넘어요');
    expect(rows[3]).toMatchObject({ inventoryReservedQty: null, reason: expect.stringContaining('재고 행이 없어요') });
  });

  it('ACTIVE 예약이 0인 규격은 재고 행이 없으면 보지 않는다', () => {
    expect(reconciliationRows([], new Map([[1, 0]]), items)).toEqual([]);
  });

  it('알림 문구: 보정·보정 불가가 없으면 보내지 않고, 규격은 앞 3개만 적는다', () => {
    const row = (itemCode: string, status: ReservationReconciliationRow['status']): ReservationReconciliationRow => ({
      itemId: 1,
      itemCode,
      itemName: '',
      itemType: ITEM_TYPE.SLAB,
      steelGradeCode: null,
      inventoryReservedQty: 5,
      activeReservedQty: 3,
      differenceQty: 2,
      onHandQty: 10,
      rollingAllocatedQty: 0,
      status,
      reason: null,
    });
    expect(alertContent([row('SL-A', RECONCILIATION_STATUS.MATCHED)])).toBeNull();
    expect(alertContent(['SL-A', 'SL-B', 'SL-C', 'SL-D'].map((c) => row(c, RECONCILIATION_STATUS.CORRECTED)).concat(row('SL-E', RECONCILIATION_STATUS.UNFIXABLE)))).toBe(
      '재고 정합성 보정: 예약 매수 4개 규격을 맞췄어요 (SL-A 5→3매, SL-B 5→3매, SL-C 5→3매 외 1개). 1개 규격은 맞추지 못해 확인이 필요해요 (SL-E).',
    );
  });
});

// 실제 DB(fs_sales)에서 보정을 확인한다. 이 파일이 만든 규격만 본다(같은 DB를 다른 테스트 파일도 쓴다)
describe('ReconciliationService (REQ-INV-010, BP-INV-02 P2)', () => {
  let prisma: PrismaService;
  let service: ReconciliationService;
  let admin: AuthUser;
  let sales: AuthUser;
  let fixItemId: number;
  let stuckItemId: number;
  const tag = `${Date.now() % 100000}`;

  const authUser = (employee: { id: number; employeeNo: string; employeeName: string; departmentId: number; jobGradeId: number }, roleCode: AuthUser['roleCode']): AuthUser => ({
    employeeId: employee.id,
    employeeNo: employee.employeeNo,
    employeeName: employee.employeeName,
    roleCode,
    departmentId: employee.departmentId,
    jobGradeId: employee.jobGradeId,
    headDepartmentIds: [],
    permissions: {},
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, CommonModule, InventoryModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(ReconciliationService);
    const employeeSelect = { id: true, employeeNo: true, employeeName: true, departmentId: true, jobGradeId: true } as const;
    admin = authUser(await prisma.employee.findFirstOrThrow({ where: { isActive: true, role: { roleCode: ROLE.ADMIN } }, select: employeeSelect }), ROLE.ADMIN);
    sales = authUser(await prisma.employee.findFirstOrThrow({ where: { isActive: true, role: { roleCode: ROLE.SALES } }, select: employeeSelect }), ROLE.SALES);

    // 제품 규격은 강종·치수·이론중량이 있어야 하고(item_type_columns_check) 같은 강종·치수는 하나뿐이라 시드 슬래브 값에 길이만 바꾼다
    const base = await prisma.item.findFirstOrThrow({
      where: { itemType: ITEM_TYPE.SLAB },
      select: { steelGradeId: true, defaultYardId: true, unitType: true, thicknessMm: true, widthMm: true, theoreticalWeightTon: true },
    });
    let length = 1000 + (Number(tag) % 7000);
    const newItem = (code: string) =>
      prisma.item.create({
        data: {
          itemCode: `SL-TREC${tag}-${code}`,
          itemName: `보정 시험 ${code}`,
          itemType: ITEM_TYPE.SLAB,
          unitType: base.unitType,
          steelGradeId: base.steelGradeId,
          defaultYardId: base.defaultYardId,
          thicknessMm: base.thicknessMm,
          widthMm: base.widthMm,
          lengthMm: String((length += 1)),
          theoreticalWeightTon: base.theoreticalWeightTon,
        },
      });
    const customer = await prisma.customer.findFirstOrThrow({ select: { id: true } });
    const order = await prisma.salesOrder.create({ data: { salesOrderNo: `T-REC-${tag}`, customerId: customer.id, ownerEmployeeId: sales.employeeId } });
    const reserve = async (itemId: number, qty: number) => {
      const line = await prisma.salesOrderItem.create({ data: { salesOrderId: order.id, itemId, orderedQty: qty, dueDate: new Date('2026-12-31T00:00:00.000Z') } });
      await prisma.reservation.create({ data: { salesOrderItemId: line.id, itemId, reservedQty: qty } });
    };

    // 고칠 수 있는 규격: 재고 행 예약 5, ACTIVE 3 (재고 10)
    fixItemId = (await newItem('FIX')).id;
    await prisma.inventory.create({ data: { itemId: fixItemId, onHandQty: 10, reservedQty: 5 } });
    await reserve(fixItemId, 3);
    // 고칠 수 없는 규격: ACTIVE 3인데 재고 2 → 맞추면 가용이 음수
    stuckItemId = (await newItem('STUCK')).id;
    await prisma.inventory.create({ data: { itemId: stuckItemId, onHandQty: 2, reservedQty: 0 } });
    await reserve(stuckItemId, 3);
  });

  const mine = (rows: readonly ReservationReconciliationRow[]) => rows.filter((r) => r.itemId === fixItemId || r.itemId === stuckItemId);
  const reservedOf = async (itemId: number) => (await prisma.inventory.findUniqueOrThrow({ where: { itemId } })).reservedQty;

  it('점검은 아무것도 바꾸지 않는다', async () => {
    const result = await service.check();
    expect(result.applied).toBe(false);
    expect(mine(result.rows).map((r) => [r.itemId, r.status])).toEqual([
      [fixItemId, RECONCILIATION_STATUS.MISMATCHED],
      [stuckItemId, RECONCILIATION_STATUS.UNFIXABLE],
    ]);
    expect(await reservedOf(fixItemId)).toBe(5);
  });

  it('관리자가 아니면 보정할 수 없다', async () => {
    await expect(service.reconcile(sales)).rejects.toMatchObject({ code: 'COM-002' } satisfies Partial<AppException>);
    expect(await reservedOf(fixItemId)).toBe(5);
  });

  it('관리자가 보정하면 예약 매수만 ACTIVE 합계로 맞추고, 예약은 지우지 않으며, 관리자에게 알린다', async () => {
    const result = await service.reconcile(admin);
    expect(result.applied).toBe(true);
    expect(mine(result.rows).map((r) => [r.itemId, r.status])).toEqual([
      [fixItemId, RECONCILIATION_STATUS.CORRECTED],
      [stuckItemId, RECONCILIATION_STATUS.UNFIXABLE],
    ]);
    expect(await reservedOf(fixItemId)).toBe(3);
    expect(await reservedOf(stuckItemId)).toBe(0);
    expect(await prisma.reservation.count({ where: { itemId: stuckItemId, reservationStatus: RESERVATION_STATUS.ACTIVE } })).toBe(1);

    // 같은 DB(fs_sales)의 다른 테스트가 만든 불일치 규격도 함께 보정되어, 이 규격이 문구의 앞 3개 밖("외 N개")일 수 있다.
    // 문구 형식은 위 alertContent 단위 테스트가 보고, 여기서는 보정 결과 그대로 알렸는지 본다
    const content = alertContent(result.rows);
    expect(content).toContain('예약 매수');
    const notice = await prisma.notification.findFirstOrThrow({ where: { recipientId: admin.employeeId, notificationType: NOTIFICATION_TYPE.TASK_ASSIGNED, notificationContent: content ?? '' }, orderBy: { id: 'desc' } });
    expect(notice.linkPath).toBe('/inventories');
  });

  it('다시 보정하면 맞춘 규격은 일치로 빠지고, 같은 보정 불가 알림을 읽지 않았으면 또 보내지 않는다', async () => {
    const second = await service.reconcile(admin);
    expect(mine(second.rows).map((r) => r.itemId)).toEqual([stuckItemId]);
    const count = () => prisma.notification.count({ where: { recipientId: admin.employeeId, notificationType: NOTIFICATION_TYPE.TASK_ASSIGNED } });
    const before = await count();
    await service.reconcile(admin);
    expect(await count()).toBe(before);
  });
});
