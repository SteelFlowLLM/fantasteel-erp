// 3주 운영 이력 시드 (발표·시연용). 조직·기준정보 시드(prisma/seed.ts)가 들어 있는 DB에서 실행한다.
//   npm run seed:history -w @fantasteel/server              ← 거래 데이터가 없는 DB에만 넣는다
//   npm run seed:history -w @fantasteel/server -- --wipe    ← 거래·협업 데이터를 지우고 넣는다 (조직·기준정보·AI 관련 표는 그대로)
// 실제 서비스(수주 등록·실적 시뮬레이션·검사·구매·출하·업무·메신저)를 가상 시계(virtual-clock.ts) 아래에서 날짜 순서대로 불러서,
// 번호·작업 로그·재고·예약·알림이 화면에서 직접 한 것과 같다. 날짜·사람·수량·대화는 모두 시연용 가정값이다 (docs/backend/seed.md).
// 시간은 10/1(목) ~ 10/21(수) Asia/Seoul. 사무 업무는 평일 근무 시간, 공장 작업(시뮬레이션)은 요일과 상관없이 돈다.
import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ACTION_TYPE, ALLOCATION_PURPOSE, CHAT_ROOM_TYPE, LOT_TYPE, NOTIFICATION_TYPE, PROCESS_TYPE, type AuthUser, type DispositionStatus, type ProcessType } from '@fantasteel/shared';
import { AppModule } from '../app.module';
import { AuthUserService } from '../common/auth/auth-user.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FactoryAgentService } from '../modules/factory-agent/factory-agent.service';
import { InventoryService } from '../modules/inventory/inventory.service';
import { ReconciliationService } from '../modules/inventory/reconciliation.service';
import { MessageActionService } from '../modules/message-action/message-action.service';
import { MessengerService } from '../modules/messenger/messenger.service';
import { NotificationService } from '../modules/notification/notification.service';
import { TaskService } from '../modules/notification/task.service';
import { ProductionSimulationService } from '../modules/production/production-simulation.service';
import { ProductionService } from '../modules/production/production.service';
import { PurchasingService } from '../modules/purchasing/purchasing.service';
import { isItemApplicable } from '../modules/quality/inspection-judge';
import { QualityService } from '../modules/quality/quality.service';
import { RejectedLotService } from '../modules/quality/rejected-lot.service';
import { SalesOrderService } from '../modules/sales-order/sales-order.service';
import { ShipmentService } from '../modules/shipment/shipment.service';
import { installVirtualClock } from './virtual-clock';

const logger = new Logger('SeedHistoryDemo');
const WIPE = process.argv.includes('--wipe');

/** 지우는 표 (거래·협업). 조직·권한·기준정보·검사 기준·생산 설정값과 AI 관련 표(past_case·meeting_minutes·schedule_event·integration_connection·ai_*)는 남긴다 */
const TRANSACTION_TABLES = [
  'sales_order', 'sales_order_item', 'inventory', 'reservation', 'allocation',
  'shipment_request', 'shipment_request_item', 'mill_sheet',
  'production_plan', 'production_result', 'lot', 'lot_relation',
  'quality_inspection', 'quality_inspection_value',
  'purchase_requisition', 'purchase_order', 'purchase_order_item', 'goods_receipt',
  'business_event', 'business_event_lot', 'task', 'notification',
  'chat_room', 'chat_room_member', 'message', 'action_draft', 'message_reaction', 'message_attachment',
];

const INSPECTED_PROCESS: Record<string, ProcessType> = {
  [LOT_TYPE.HEAT]: PROCESS_TYPE.STEELMAKING,
  [LOT_TYPE.SLAB]: PROCESS_TYPE.CONTINUOUS_CASTING,
  [LOT_TYPE.COIL]: PROCESS_TYPE.HOT_ROLLING,
};

/** 사원 (docs/backend/seed.md 테스트 계정) */
const EMP = {
  admin: '1503001', // 이현정 경영지원부장
  salesHead: '1608002', // 김도윤 영업부장
  sales: '2103003', // 박서영 영업 대리
  purchaseHead: '1702004', // 최준혁 구매부장
  purchase: '2207005', // 정다은 구매 사원
  prodHead: '1401006', // 강민석 생산부장
  iron: '1709007', // 윤성호 제선파트장
  steel: '1804008', // 장혜린 제강파트장
  cast: '1906009', // 임재원 연주파트장
  roll: '2001010', // 한승우 열연파트장
  steelStaff: '2402011', // 조은서 제강 사원
  qcHead: '1802012', // 오지훈 품질부장
  qc: '2205013', // 서민지 품질 대리
  logiHead: '1610014', // 신현우 물류부장
  logi: '2304015', // 권예진 물류 사원
} as const;

type Ctx = {
  prisma: PrismaService;
  clock: ReturnType<typeof installVirtualClock>;
  user: (key: keyof typeof EMP) => AuthUser;
  salesOrders: SalesOrderService;
  production: ProductionService;
  simulation: ProductionSimulationService;
  quality: QualityService;
  rejected: RejectedLotService;
  purchasing: PurchasingService;
  shipment: ShipmentService;
  inventory: InventoryService;
  messenger: MessengerService;
  drafts: MessageActionService;
  tasks: TaskService;
  notifications: NotificationService;
  itemId: (code: string) => Promise<number>;
  customerId: (name: string) => Promise<number>;
};

async function main() {
  // 부팅 때 도는 예약 정합성 보정·Agent 감지는 끈다 (지우는 중에 겹치면 교착, 감지 알림은 시드 끝에 가상 시각으로 한 번 돌린다)
  process.env.RESERVATION_RECONCILE_INTERVAL_HOURS = '0';
  process.env.AGENT_SCAN_INTERVAL_HOURS = '0';
  // 심층 조사 일꾼도 끈다. 공용 DB에 대기 중인 조사가 있으면 시드 도중 집어 가서 AI 표를 바꾼다
  process.env.AI_RESEARCH_WORKER = 'off';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'error', 'warn'] });
  const clock = installVirtualClock('2026-10-01 08:30', (m) => logger.warn(m));
  try {
    const prisma = app.get(PrismaService);
    extendTransactionTimeout(prisma);
    if (WIPE) await wipeTransactions(prisma);
    if ((await prisma.salesOrder.count()) > 0 || (await prisma.lot.count()) > 0 || (await prisma.chatRoom.count()) > 0) {
      logger.warn('이미 수주·LOT·채팅방이 있어 건너뜁니다. 지우고 넣으려면 -- --wipe 를 붙이세요');
      return;
    }
    const users = app.get(AuthUserService);
    const loaded = new Map<string, AuthUser>();
    for (const [key, no] of Object.entries(EMP)) {
      const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: no } });
      const user = await users.load(employee.id);
      if (!user) throw new Error(`사원 ${no}을 불러올 수 없습니다`);
      loaded.set(key, user);
    }
    const ctx: Ctx = {
      prisma,
      clock,
      user: (key) => loaded.get(key) as AuthUser,
      salesOrders: app.get(SalesOrderService),
      production: app.get(ProductionService),
      simulation: app.get(ProductionSimulationService),
      quality: app.get(QualityService),
      rejected: app.get(RejectedLotService),
      purchasing: app.get(PurchasingService),
      shipment: app.get(ShipmentService),
      inventory: app.get(InventoryService),
      messenger: app.get(MessengerService),
      drafts: app.get(MessageActionService),
      tasks: app.get(TaskService),
      notifications: app.get(NotificationService),
      itemId: async (code) => (await prisma.item.findUniqueOrThrow({ where: { itemCode: code }, select: { id: true } })).id,
      customerId: async (name) => (await prisma.customer.findFirstOrThrow({ where: { customerName: name }, select: { id: true } })).id,
    };
    await runTimeline(ctx);
    await finish(ctx);
    // 시드 데이터 기준으로 Agent 감지 1회 (원료 부족·납기 위험·여재 장기 보유·불합격률 상승 → 담당자 알림)
    clock.set('2026-10-21 09:50');
    const scanned = await app.get(FactoryAgentService).scanAll();
    logger.log(`Agent 감지: ${scanned.map((r) => `${r.riskType} ${r.created}/${r.detected}`).join(', ') || '없음'}`);
    const reconciliation = await app.get(ReconciliationService).check();
    logger.log(`예약 정합성 점검: ${JSON.stringify(reconciliation)}`);
  } finally {
    clock.uninstall();
    await app.close();
  }
}

/**
 * 서비스 트랜잭션의 제한시간을 늘린다. Prisma 기본값(5초)은 로컬 DB 기준이라, 공용 DB(풀러)처럼 왕복이 긴 곳에서는
 * 배정 추천·확정(LOT 수만큼 조회)이 5초를 넘겨 실패한다 (2026-10-21 Supabase 실행에서 5,191ms). 시드에서만 바꾼다
 */
function extendTransactionTimeout(prisma: PrismaService) {
  const original = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>;
  const patched = (arg: unknown, options?: { maxWait?: number; timeout?: number; isolationLevel?: unknown }) =>
    typeof arg === 'function' ? original(arg, { maxWait: 15_000, timeout: 120_000, ...options }) : original(arg, options);
  (prisma as unknown as { $transaction: typeof patched }).$transaction = patched;
}

/** 거래·협업 표를 비우고 id를 1부터 다시 시작한다 (FK 제약이 없어 순서는 상관없다) */
async function wipeTransactions(prisma: PrismaService) {
  const counts = await Promise.all(TRANSACTION_TABLES.map(async (t) => {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t}"`);
    return Number(n);
  }));
  const total = counts.reduce((a, b) => a + b, 0);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TRANSACTION_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
  logger.warn(`거래·협업 ${TRANSACTION_TABLES.length}개 표의 ${total}행을 지웠습니다 (조직·기준정보·AI 관련 표는 그대로)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 (시간 순서). 각 at(...)은 그 시각으로 가상 시계를 옮긴다.
// ─────────────────────────────────────────────────────────────────────────────

async function runTimeline(c: Ctx) {
  const at = (seoul: string) => c.clock.set(seoul);
  const h = helpers(c);

  // ── 1주차 (10/1 목 ~ 10/8 목): 원료 확보 → 첫 수주 2건 → 생산·검사 → 첫 출하 ──────────────────

  at('2026-10-01 09:10');
  const firstPRs = await h.requisitions('purchase', [
    { code: 'ORE01', ton: '3000.000', desired: '2026-10-02' },
    { code: 'COL01', ton: '1200.000', desired: '2026-10-02' },
    { code: 'LIM01', ton: '300.000', desired: '2026-10-02' },
    { code: 'SMN01', ton: '30.000', desired: '2026-10-02' },
  ], '10월 상반기 생산분 원료 확보 (히트 6~7개 기준)');
  at('2026-10-01 10:05');
  for (const pr of firstPRs) await c.purchasing.approve(c.user('purchaseHead'), pr.id);
  at('2026-10-01 11:20');
  const firstPOs = await h.orderEach('purchase', firstPRs, '2026-10-02');
  at('2026-10-02 08:40');
  await h.receive('purchase', firstPOs.ORE01, '1800.000', '2026-10-02');
  await h.receive('purchase', firstPOs.COL01, '1200.000', '2026-10-02');
  await h.receive('purchase', firstPOs.LIM01, '300.000', '2026-10-02');
  await h.receive('purchase', firstPOs.SMN01, '30.000', '2026-10-02');

  at('2026-10-02 10:30');
  const so1 = await h.order('salesHead', '가람중공업', 'SL-SS275-250x1200x10000', 18, '2026-10-16');
  at('2026-10-02 10:45');
  const roomSo1 = await h.workRoom('salesHead', so1.salesOrderId, ['prodHead', 'qcHead', 'logiHead']);
  await h.say('salesHead', roomSo1, '가람중공업 SS275 슬래브 18매 수주 등록했습니다. 납기 10/16이라 이번 주 안에 제강 들어가면 여유 있을 것 같아요.');
  at('2026-10-02 11:02');
  await h.say('prodHead', roomSo1, '히트 2개 편성됐네요. 원료 입고 확인되면 월요일(10/5) 오전에 고로 투입 시작하겠습니다.');
  at('2026-10-02 14:10');
  const so2 = await h.order('sales', '나래조선', 'CL-SM355A-4.5x1500x544000', 7, '2026-10-20');
  at('2026-10-02 14:20');
  const roomSo2 = await h.workRoom('sales', so2.salesOrderId, ['prodHead', 'roll', 'qc']);
  await h.say('sales', roomSo2, '나래조선 SM355A 코일 7개, 납기 10/20입니다. 열연 일정 잡히면 공유 부탁드려요.');
  at('2026-10-02 15:05');
  await h.say('roll', roomSo2, '연주 끝나고 슬래브 검사 합격되는 대로 열연 투입하겠습니다. 10/7쯤 예상합니다.');

  at('2026-10-05 09:15');
  await h.receive('purchase', firstPOs.ORE01, '1200.000', '2026-10-05');
  at('2026-10-05 09:40');
  const roomPurchase = await h.groupRoom('purchaseHead', '구매·생산 원료 협의', ['purchase', 'prodHead', 'iron', 'steel', 'qc']);
  await h.say('purchase', roomPurchase, '철광석 잔량 1,200t 오늘 오전에 입고 확정했습니다. 석탄·석회석·합금철은 금요일에 다 들어왔어요.');
  at('2026-10-05 09:52');
  await h.say('iron', roomPurchase, '확인했습니다. BF2 오늘 오후부터 가동합니다.');

  at('2026-10-05 17:30');
  await h.simulate('prodHead', so1.planId, 20261005, 'SO-1 슬래브 2히트');
  at('2026-10-06 09:30');
  await h.inspectPlan('qc', so1.planId, [LOT_TYPE.HEAT]);
  await h.inspectPlan('qc', so1.planId, [LOT_TYPE.SLAB], { 0: { SURFACE_DEFECT_DEPTH: '2.6000' } });
  at('2026-10-06 11:00');
  await h.dispose('qcHead', so1.planId, LOT_TYPE.SLAB, 0, 'HOLD', '표면 결함 깊이 2.6mm (기준 2.0 이하) — 재측정 후 처리 결정');
  at('2026-10-06 11:12');
  await h.say('qcHead', roomSo1, '슬래브 20매 중 1매 표면 결함 깊이 2.6mm로 불합격, 보류 처리했습니다. 나머지 19매 합격이라 수주 18매는 예약 완료됐고 1매는 여재로 남습니다.');
  at('2026-10-06 11:20');
  await h.task('qcHead', 'qc', 'SO-2610-001 보류 슬래브 재측정', '표면 결함 깊이 재측정 후 격하·폐기 여부 품질부장에게 보고', '2026-10-07', '/quality/rejected', { done: '2026-10-07 10:15', read: true });
  at('2026-10-06 13:30');
  const roomShip = await h.groupRoom('logiHead', '10월 출하 조율', ['salesHead', 'sales', 'logi']);
  await h.say('logiHead', roomShip, '10월 출하 일정 여기서 맞추겠습니다. 영업에서 출하요청 올리면 다음 날 오전 출고 기준으로 잡을게요.');
  at('2026-10-06 13:41');
  await h.say('salesHead', roomShip, '가람중공업 18매는 내일 출하요청 올리겠습니다. 10/8 출고 부탁드려요.');

  at('2026-10-06 15:00');
  await h.simulate('prodHead', so2.planId, 20261006, 'SO-2 코일 1히트 (연주까지)');
  at('2026-10-07 09:40');
  await h.inspectPlan('qc', so2.planId, [LOT_TYPE.HEAT, LOT_TYPE.SLAB]);
  at('2026-10-07 09:55');
  await h.say('qc', roomSo2, '히트 1개·슬래브 8매 검사 모두 합격입니다. 열연 투입 가능해요.');
  at('2026-10-07 10:02');
  await h.say('roll', roomSo2, '오늘 오후 열연 7개 진행합니다.', ['sales']);

  at('2026-10-07 11:00');
  const dr1 = await h.shipmentRequest('sales', '가람중공업', [{ soItemId: so1.salesOrderItemId, qty: 18 }], '2026-10-08');
  at('2026-10-07 11:10');
  await h.allocate('sales', dr1);
  at('2026-10-07 11:15');
  await h.say('sales', roomShip, `${dr1.no} 가람중공업 슬래브 18매 배정 확정했습니다. 내일 출고 부탁드립니다.`, ['logi']);

  at('2026-10-07 15:30');
  await h.simulate('roll', so2.planId, 20261007, 'SO-2 코일 열연');
  at('2026-10-08 09:30');
  await h.issue('logi', dr1);
  at('2026-10-08 09:35');
  await h.say('logi', roomShip, `${dr1.no} 출고 확정, 밀시트 발행했습니다.`);
  at('2026-10-08 10:20');
  await h.inspectPlan('qcHead', so2.planId, [LOT_TYPE.COIL]);
  at('2026-10-08 10:30');
  await h.say('qc', roomSo2, '코일 7개 열연 검사 합격했습니다. 수주 7개 전량 예약됐어요.');

  // ── 2주차 (10/8 ~ 10/16): 수주 4건 + 원료 추가 구매, 불합격·재생산, 수주 취소, 출하 3건 ──────────

  at('2026-10-08 14:00');
  const so3 = await h.order('salesHead', '다온건설', 'SL-SM355B-220x1400x9500', 20, '2026-10-23');
  at('2026-10-08 14:30');
  const so4 = await h.order('sales', '보람강관', 'SL-SPHC-250x1200x10000', 9, '2026-10-27');
  at('2026-10-08 15:00');
  const so5 = await h.order('salesHead', '가람중공업', 'CL-SS275-4.5x1500x544000', 15, '2026-10-30');
  at('2026-10-08 15:10');
  const roomSo5 = await h.workRoom('salesHead', so5.salesOrderId, ['roll', 'qc', 'qcHead', 'logiHead']);
  await h.say('salesHead', roomSo5, '가람중공업 SS275 4.5t 코일 15개, 납기 10/30입니다. 지난번 슬래브 건과 같은 고객사라 품질 신경 써 주세요.');
  at('2026-10-08 16:00');
  const so6 = await h.order('sales', '나래조선', 'SL-SM355A-250x1500x10000', 8, '2026-10-29');

  at('2026-10-08 16:30');
  const secondPRs = await h.requisitions('purchase', [
    { code: 'ORE01', ton: '3500.000', desired: '2026-10-12' },
    { code: 'COL01', ton: '1200.000', desired: '2026-10-12' },
    { code: 'LIM01', ton: '300.000', desired: '2026-10-12' },
    { code: 'SMN01', ton: '30.000', desired: '2026-10-12' },
  ], 'MRP 2026-10-01 ~ 2026-11-30 · 10월 하반기 생산분(PP-2610-0003~0006) 순소요');
  at('2026-10-08 16:45');
  await h.say('purchase', roomPurchase, '10/8 등록된 수주 4건 기준으로 MRP 돌려서 철광석 3,500t·석탄 1,200t·석회석 300t·합금철 30t 구매요청 올렸습니다. 승인 부탁드립니다.', ['purchaseHead']);
  at('2026-10-08 17:00');
  for (const pr of secondPRs) await c.purchasing.approve(c.user('purchaseHead'), pr.id);
  at('2026-10-08 17:05');
  await h.say('purchaseHead', roomPurchase, '승인했습니다. 연휴 끝나고 월요일에 발주 넣어 주세요.');

  at('2026-10-09 18:00');
  await h.simulate('prodHead', so3.planId, 20261009, 'SO-3 슬래브 2히트');
  at('2026-10-10 12:00');
  await h.simulate('prodHead', so4.planId, 20261010, 'SO-4 SPHC 슬래브 1히트');

  at('2026-10-12 09:00');
  const secondPOs = await h.orderEach('purchase', secondPRs, '2026-10-12');
  at('2026-10-12 09:20');
  await h.inspectPlan('qc', so3.planId, [LOT_TYPE.HEAT]);
  await h.inspectPlan('qc', so3.planId, [LOT_TYPE.SLAB], { 3: { THICKNESS_DEV: '6.2000' }, 11: { SURFACE_DEFECT_DEPTH: '2.3000' } });
  at('2026-10-12 10:40');
  await h.inspectPlan('qc', so4.planId, [LOT_TYPE.HEAT], { 0: { P: '0.0580' } });
  at('2026-10-12 11:10');
  await h.dispose('qcHead', so3.planId, LOT_TYPE.SLAB, 3, 'SCRAPPED', '두께 편차 +6.2mm — 재압연 불가, 폐기');
  await h.dispose('qcHead', so3.planId, LOT_TYPE.SLAB, 11, 'HOLD', '표면 결함 2.3mm — 그라인딩 후 재검사 예정');
  at('2026-10-12 11:25');
  const roomSo3 = await h.workRoom('salesHead', so3.salesOrderId, ['prodHead', 'qcHead', 'qc', 'cast']);
  await h.say('qcHead', roomSo3, '다온건설 SM355B 슬래브 20매 중 2매 불합격입니다 (두께 편차 1, 표면 결함 1). 합격 18매는 예약됐고 2매 부족해요.');
  at('2026-10-12 11:31');
  await h.say('salesHead', roomSo3, '납기 10/23이면 재생산 들어가도 되나요?', ['prodHead']);
  at('2026-10-12 11:40');
  await h.say('prodHead', roomSo3, '내일 재생산 계획 올리고 수요일에 1히트 돌리겠습니다. 10매 나오니 2매 채우고 8매는 여재로 남습니다.');
  at('2026-10-12 11:48');
  await h.say('cast', roomSo3, '두께 편차 건은 연주기 2스트랜드 롤 갭 점검했습니다. 재생산분은 문제없을 겁니다.');
  at('2026-10-12 11:55');
  const dmQcCast = await h.directRoom('qc', 'cast');
  await h.say('qc', dmQcCast, '임재원 과장님, 재생산 슬래브 나오면 바로 검사하게 연주 완료 시간 알려 주세요.');
  at('2026-10-12 12:03');
  await h.say('cast', dmQcCast, '네, 수요일 저녁 완료 예정이라 목요일 아침에 보시면 됩니다.');
  at('2026-10-12 13:50');
  await h.say('qc', roomPurchase, 'SPHC 히트 인(P) 0.058%로 기준 초과 불합격 났습니다. 합금철 배합 쪽 확인 부탁드려요.', ['prodHead', 'steel']);
  at('2026-10-12 14:00');
  const dr2 = await h.shipmentRequest('salesHead', '나래조선', [{ soItemId: so2.salesOrderItemId, qty: 7 }], '2026-10-13');
  at('2026-10-12 14:10');
  await h.allocate('salesHead', dr2);
  at('2026-10-12 14:15');
  await h.say('salesHead', roomShip, `${dr2.no} 나래조선 코일 7개 배정했습니다. 내일 출고 부탁드려요.`);
  at('2026-10-12 14:30');
  await h.receive('purchase', secondPOs.ORE01, '2000.000', '2026-10-12');
  await h.receive('purchase', secondPOs.COL01, '1200.000', '2026-10-12');
  await h.receive('purchase', secondPOs.LIM01, '300.000', '2026-10-12');
  await h.receive('purchase', secondPOs.SMN01, '30.000', '2026-10-12');
  at('2026-10-12 14:50');
  await h.say('purchase', roomPurchase, '철광석은 2,000t 먼저 입고됐고 나머지 1,500t은 수요일 도착 예정입니다.');

  at('2026-10-13 09:30');
  so3.replanId = await h.reproduce('prodHead', so3.salesOrderItemId, 'SO-3 재생산');
  at('2026-10-13 09:45');
  so4.replanId = await h.reproduce('prodHead', so4.salesOrderItemId, 'SO-4 재생산 (히트 불합격)');
  at('2026-10-13 10:00');
  await h.issue('logiHead', dr2);
  at('2026-10-13 10:05');
  await h.task('salesHead', 'sales', '다온건설 SO-2610-003 재생산 일정 안내', '불합격 2매 재생산(10/14 제강) 후 10/19 출고 예정으로 고객사에 안내', '2026-10-14', `/sales-orders/${so3.salesOrderId}`, { done: '2026-10-13 15:40', read: true });
  at('2026-10-13 20:00');
  await h.simulate('prodHead', so5.planId, 20261013, 'SO-5 코일 2히트 (연주까지)');

  at('2026-10-14 09:30');
  await h.inspectPlan('qc', so5.planId, [LOT_TYPE.HEAT, LOT_TYPE.SLAB]);
  at('2026-10-14 09:45');
  await h.say('qc', roomSo5, '히트 2개·슬래브 20매 전부 합격입니다.');
  at('2026-10-14 10:30');
  await h.receive('purchase', secondPOs.ORE01, '1500.000', '2026-10-14');
  at('2026-10-14 11:00');
  await c.salesOrders.cancel(c.user('sales'), so6.salesOrderId, { reason: '고객사 요청: 나래조선 11월 발주분으로 통합' });
  logger.log(`수주 ${so6.no} 취소`);
  at('2026-10-14 16:00');
  await h.simulate('roll', so5.planId, 20261014, 'SO-5 코일 열연');
  at('2026-10-14 18:00');
  await h.simulate('prodHead', so3.replanId, 20261014, 'SO-3 재생산 1히트');

  at('2026-10-15 09:20');
  await h.inspectPlan('qc', so3.replanId, [LOT_TYPE.HEAT, LOT_TYPE.SLAB]);
  at('2026-10-15 09:35');
  await h.say('qc', roomSo3, '재생산 히트·슬래브 10매 합격. 수주 20매 예약 다 찼고 8매는 여재입니다.');
  at('2026-10-15 10:00');
  await h.inspectPlan('qcHead', so5.planId, [LOT_TYPE.COIL]);
  at('2026-10-15 10:10');
  await h.say('qcHead', roomSo5, '코일 15개 열연 검사 합격입니다. 출하 준비하셔도 됩니다.', ['logiHead']);
  at('2026-10-15 13:00');
  await h.simulate('prodHead', so4.replanId, 20261015, 'SO-4 재생산 1히트');

  at('2026-10-16 09:30');
  await h.inspectPlan('qc', so4.replanId, [LOT_TYPE.HEAT, LOT_TYPE.SLAB]);
  at('2026-10-16 10:30');
  const dr3 = await h.shipmentRequest('salesHead', '다온건설', [{ soItemId: so3.salesOrderItemId, qty: 20 }], '2026-10-19');
  at('2026-10-16 10:40');
  await h.allocate('salesHead', dr3);
  at('2026-10-16 11:00');
  const dr4 = await h.shipmentRequest('sales', '보람강관', [{ soItemId: so4.salesOrderItemId, qty: 9 }], '2026-10-20');
  at('2026-10-16 11:05');
  await h.allocate('sales', dr4);
  at('2026-10-16 11:12');
  await h.say('sales', roomShip, `${dr3.no} 다온건설 20매(10/19), ${dr4.no} 보람강관 9매(10/20) 배정 확정했습니다.`);
  at('2026-10-16 11:20');
  await h.say('logiHead', roomShip, '두 건 모두 일정대로 출고하겠습니다. 다온건설은 월요일 오전 상차입니다.');

  // ── 3주차 (10/19 월 ~ 10/21 수): 지금 진행 중인 것들 ───────────────────────────────────────

  at('2026-10-19 09:30');
  const smnPR = await h.requisitions('purchase', [{ code: 'SMN01', ton: '10.000', desired: '2026-10-21' }], '실리코망가니즈 안전 잔량 확보 (SM355 수주 증가)');
  at('2026-10-19 09:40');
  await h.issue('logi', dr3);
  at('2026-10-19 10:00');
  await c.purchasing.approve(c.user('purchaseHead'), smnPR[0].id);
  const so7 = await h.order('sales', '나래조선', 'CL-SM355A-4.5x1500x544000', 9, '2026-11-03');
  at('2026-10-19 10:15');
  const roomSo7 = await h.workRoom('sales', so7.salesOrderId, ['roll', 'qc']);
  await h.say('sales', roomSo7, '나래조선 SM355A 4.5t 코일 9개 추가 수주입니다. 납기 11/3.');
  at('2026-10-19 11:00');
  const smnPO = await h.orderEach('purchase', smnPR, '2026-10-21');
  const so8 = await h.order('salesHead', '다온건설', 'SL-SM355A-250x1500x10000', 15, '2026-11-06');
  at('2026-10-19 11:30');
  await h.task('purchaseHead', 'purchase', '11월 원료 발주 계획 초안', '11월 수주 전망 기준 원료 4종 월간 소요·입고 일정 초안 작성', '2026-10-24', '/purchase-requisitions', { read: true });
  at('2026-10-19 15:00');
  await h.simulate('prodHead', so7.planId, 20261019, 'SO-7 코일 1히트 (연주까지)');

  at('2026-10-20 09:30');
  await h.inspectPlan('qc', so7.planId, [LOT_TYPE.HEAT, LOT_TYPE.SLAB]);
  at('2026-10-20 09:40');
  await h.say('qc', roomSo7, '히트 2개·슬래브 16매 합격했습니다. 열연 투입 배정 부탁드려요.', ['roll']);
  at('2026-10-20 10:10');
  await h.issue('logi', dr4);
  at('2026-10-20 11:00');
  await h.task('prodHead', 'roll', 'SO-2610-007 열연 투입 배정', '합격 슬래브 16매 중 9매 열연 투입 배정 확정 후 10/22 열연 실적 등록', '2026-10-22', `/production/rolling?plan=${so7.planId}`);
  at('2026-10-20 14:00');
  const so9 = await h.order('salesHead', '보람강관', 'SL-SS275-250x1500x10000', 12, '2026-11-13');
  at('2026-10-20 15:30');
  const orePR = await h.requisitions('purchase', [{ code: 'ORE01', ton: '1000.000', desired: '2026-10-27', planId: so9.planId }], `MRP 2026-10-01 ~ 2026-11-30 · ${so9.planNo} 철광석 순소요 · 필요일 2026-10-27`);
  at('2026-10-20 15:40');
  const smnBigPR = await h.requisitions('purchase', [{ code: 'SMN01', ton: '40.000', desired: '2026-10-30' }], '11월 SM355 수주 대비 합금철 선확보');
  at('2026-10-20 15:50');
  const dmPurchase = await h.directRoom('purchase', 'purchaseHead');
  await h.say('purchase', dmPurchase, '부장님, 합금철 40t 요청은 11월 수주 아직 미확정이라 보수적으로 잡은 건데 어떻게 할까요?');
  at('2026-10-20 16:05');
  await h.say('purchaseHead', dmPurchase, '잔량 보고 내일 아침에 정리할게요. 철광석 1,000t 건은 승인했으니 발주 진행하세요.');
  at('2026-10-20 16:10');
  await h.task('logiHead', 'logi', 'SO-2610-005 코일 출하 준비', '가람중공업 코일 15개 10/22 출고 — 코일 야드 상차 순서와 차량 확인', '2026-10-22', '/shipment-requests');
  at('2026-10-20 16:40');
  await c.purchasing.approve(c.user('purchaseHead'), orePR[0].id);
  at('2026-10-20 18:00');
  await h.simulate('prodHead', so8.planId, 20261020, 'SO-8 슬래브 2히트');

  at('2026-10-21 08:30');
  await h.receive('purchase', smnPO.SMN01, '6.000', '2026-10-21');
  at('2026-10-21 08:50');
  await c.purchasing.reject(c.user('purchaseHead'), smnBigPR[0].id, { rejectReason: '합금철 잔량으로 11월 초까지 충분해요. 11월 수주 확정 후 수량 줄여서 다시 요청해 주세요' });
  at('2026-10-21 08:55');
  await h.inspectPlan('qc', so8.planId, [LOT_TYPE.HEAT]);
  at('2026-10-21 09:00');
  await h.task('admin', 'admin', '10월 사원 권한 점검', '역할별 메뉴·권한 표와 실제 사원 역할 대조', '2026-10-24', '/admin/employees');
  at('2026-10-21 09:05');
  const dr5 = await h.shipmentRequest('salesHead', '가람중공업', [{ soItemId: so5.salesOrderItemId, qty: 15 }], '2026-10-22');
  at('2026-10-21 09:10');
  await h.say('salesHead', roomShip, `${dr5.no} 가람중공업 코일 15개 출하요청 올렸습니다. 배정 확정은 오후에 하겠습니다.`);
  at('2026-10-21 09:15');
  const dmSalesLogi = await h.directRoom('salesHead', 'logiHead');
  await h.say('salesHead', dmSalesLogi, '가람중공업 코일 15개, 고객사에서 10/22 오전 입고 원해요. 차량 2대 가능할까요?');
  at('2026-10-21 09:20');
  await h.requisitions('purchase', [{ code: 'LIM01', ton: '150.000', desired: '2026-10-28' }], '11월 초 생산분 석회석 보충');
  at('2026-10-21 09:25');
  await h.requisitions('purchase', [{ code: 'COL01', ton: '400.000', desired: '2026-10-28' }], '11월 초 생산분 석탄 보충');
  at('2026-10-21 09:32');
  const draftMessage = await h.say('purchase', roomPurchase, '실리코망가니즈 15t 10/30까지 입고 요청합니다. 11월 첫 주 SM355 히트 3개분이에요.');
  at('2026-10-21 09:33');
  await c.drafts.create(c.user('purchase'), draftMessage.id, ACTION_TYPE.PURCHASE_REQUISITION_CREATE);
  logger.log('Message → ERP 초안 1건 (확인 대기)');
  at('2026-10-21 09:40');
  await h.say('purchaseHead', roomPurchase, '40t 건은 반려했어요. 위 15t 초안으로 정리해서 확정해 주세요.', ['purchase']);

  // 읽음 처리: 대화에 참여한 사람은 마지막 메시지까지 읽은 상태로 (방 목록의 안 읽음 표시가 현실적이게)
  at('2026-10-21 09:45');
  await h.readRooms([
    [roomSo1, ['salesHead', 'prodHead', 'qcHead', 'logiHead']],
    [roomSo2, ['sales', 'prodHead', 'roll', 'qc']],
    [roomSo3, ['salesHead', 'prodHead', 'qcHead', 'qc', 'cast']],
    [roomSo5, ['salesHead', 'roll', 'qc', 'qcHead']],
    [roomSo7, ['sales', 'qc']],
    [roomShip, ['salesHead', 'sales', 'logiHead']],
    [roomPurchase, ['purchaseHead', 'purchase', 'iron', 'steel', 'qc']],
    [dmQcCast, ['qc', 'cast']],
    [dmPurchase, ['purchase', 'purchaseHead']],
    [dmSalesLogi, ['salesHead']],
  ]);
  // 알림: 지난주 것은 읽음, 이번 주 것은 안 읽음으로
  await h.readNotificationsBefore('2026-10-19 00:00');
}

// ─────────────────────────────────────────────────────────────────────────────
// 도우미
// ─────────────────────────────────────────────────────────────────────────────

type Pr = { id: number; itemId: number; code: string; requestedTon: string };
type Dr = { id: number; no: string; itemIds: number[] };

function helpers(c: Ctx) {
  const plansOfItem = async (salesOrderItemId: number) =>
    c.prisma.productionPlan.findMany({ where: { salesOrderItemId }, orderBy: { id: 'asc' }, select: { id: true, productionPlanNo: true, isReproduction: true } });

  return {
    /** 수주 1건(품목 1줄) 등록 → 생산계획 */
    async order(who: keyof typeof EMP, customer: string, code: string, qty: number, dueDate: string) {
      const created = await c.salesOrders.create(c.user(who), { customerId: await c.customerId(customer), items: [{ itemId: await c.itemId(code), orderedQty: qty, dueDate }] });
      const item = created.items[0];
      const plan = item.productionPlanNo ? await c.prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: item.productionPlanNo }, select: { id: true } }) : null;
      logger.log(`수주 ${created.salesOrderNo} ${customer} ${code} ${qty}매 납기 ${dueDate} → 예약 ${item.reservedQty} / 생산계획 ${item.productionPlanNo ?? '없음'}`);
      return {
        salesOrderId: created.salesOrderId,
        no: created.salesOrderNo,
        salesOrderItemId: item.salesOrderItemId,
        planId: plan?.id ?? 0,
        planNo: item.productionPlanNo ?? '',
        /** 재생산 계획 id (reproduce 뒤에 채워진다) */
        replanId: 0,
      } as { salesOrderId: number; no: string; salesOrderItemId: number; planId: number; planNo: string; replanId: number };
    },

    async simulate(who: keyof typeof EMP, planId: number, randomSeed: number, label: string) {
      if (!planId) throw new Error(`${label}: 생산계획이 없습니다`);
      const result = await c.simulation.simulate(c.user(who), planId, { randomSeed });
      const steps = result.steps.map((s) => `${s.processType}${s.outputQty !== null ? `(${s.outputQty})` : ''}`).join(' → ');
      logger.log(`시뮬레이션 ${label} ${result.productionPlanNo}: ${steps} → ${result.productionPlanStatus}${result.skippedRolling ? ` / 열연 건너뜀: ${result.skippedRolling}` : ''}`);
      return result;
    },

    /** 계획의 LOT(유형별, id 순)을 검사한다. overrides는 "n번째 LOT → 항목 값" (기준 밖 값이면 불합격) */
    async inspectPlan(who: keyof typeof EMP, planId: number, lotTypes: string[], overrides: Record<number, Record<string, string>> = {}) {
      const lots = await c.prisma.lot.findMany({ where: { productionResult: { productionPlanId: planId }, lotType: { in: lotTypes } }, orderBy: { id: 'asc' }, select: { id: true, lotNo: true } });
      let pass = 0;
      let fail = 0;
      for (const [index, lot] of lots.entries()) {
        const override = overrides[index] ?? {};
        const saved = await c.quality.registerQualityInspection({ lotId: lot.id, values: await passingValues(c.prisma, lot.id, override) }, c.user(who));
        if (saved.inspectionResult === 'PASS') pass++;
        else fail++;
        if (Object.keys(override).length > 0) logger.log(`  검사 ${lot.lotNo}: ${saved.inspectionResult} (${Object.entries(override).map(([k, v]) => `${k} ${v}`).join(', ')})`);
        c.clock.advanceMinutes(0.5);
      }
      logger.log(`검사 계획 ${planId} ${lotTypes.join('·')} ${lots.length}건: 합격 ${pass} / 불합격 ${fail}`);
    },

    /** 불합격 LOT 처리 상태 (n번째 LOT) */
    async dispose(who: keyof typeof EMP, planId: number, lotType: string, index: number, status: DispositionStatus, reason: string) {
      const lots = await c.prisma.lot.findMany({ where: { productionResult: { productionPlanId: planId }, lotType }, orderBy: { id: 'asc' }, select: { id: true, lotNo: true, updatedAt: true } });
      const lot = lots[index];
      if (!lot) throw new Error(`계획 ${planId}의 ${lotType} ${index}번째 LOT이 없습니다`);
      try {
        await c.rejected.setLotDisposition(lot.id, { dispositionStatus: status, dispositionReason: reason, expectedUpdatedAt: lot.updatedAt.toISOString() }, c.user(who));
        logger.log(`  불합격 처리 ${lot.lotNo}: ${status}`);
      } catch (error) {
        logger.warn(`  불합격 처리 실패 ${lot.lotNo}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async reproduce(who: keyof typeof EMP, salesOrderItemId: number, label: string) {
      const result = await c.production.createReproductionPlan(c.user(who), salesOrderItemId);
      const plans = await plansOfItem(salesOrderItemId);
      const replan = plans.filter((p) => p.isReproduction).at(-1);
      logger.log(`재생산 ${label}: 추가 필요 ${result.check.additionalPlanQty}매, 여재 예약 ${result.reservedFromSurplusQty}매 → ${result.plan ? `${result.plan.productionPlanNo} 히트 ${result.plan.heatCount}` : '계획 없음'}`);
      return replan?.id ?? 0;
    },

    /** 구매요청 여러 건 (정다은). planId를 주면 MRP 계획 몫으로 연결한다 */
    async requisitions(who: keyof typeof EMP, lines: { code: string; ton: string; desired: string; planId?: number }[], reason: string): Promise<Pr[]> {
      const out: Pr[] = [];
      for (const line of lines) {
        const itemId = await c.itemId(line.code);
        const pr = await c.purchasing.create(c.user(who), { itemId, requestedTon: line.ton, desiredReceiptDate: line.desired, requestReason: reason, productionPlanId: line.planId ?? null });
        out.push({ id: pr.id, itemId, code: line.code, requestedTon: line.ton });
        c.clock.advanceMinutes(2);
      }
      logger.log(`구매요청 ${out.length}건: ${lines.map((l) => `${l.code} ${l.ton}t`).join(', ')}`);
      return out;
    },

    /** 승인된 요청을 원료별 기본 공급업체로 발주 (요청 1건 = 발주 1건) → 원료 코드별 발주 품목 id */
    async orderEach(who: keyof typeof EMP, prs: Pr[], expectedReceiptDate: string): Promise<Record<string, number>> {
      const out: Record<string, number> = {};
      for (const pr of prs) {
        const item = await c.prisma.item.findUniqueOrThrow({ where: { id: pr.itemId }, select: { defaultSupplierId: true } });
        if (item.defaultSupplierId === null) throw new Error(`${pr.code} 기본 공급업체가 없습니다`);
        const po = await c.purchasing.createPurchaseOrder(c.user(who), { supplierId: item.defaultSupplierId, items: [{ purchaseRequisitionId: pr.id, orderedTon: pr.requestedTon, expectedReceiptDate }] });
        out[pr.code] = po.items[0].purchaseOrderItemId;
        logger.log(`발주 ${po.purchaseOrderNo} ${pr.code} ${pr.requestedTon}t (입고 예정 ${expectedReceiptDate})`);
        c.clock.advanceMinutes(3);
      }
      return out;
    },

    async receive(who: keyof typeof EMP, purchaseOrderItemId: number, ton: string, receivedDate: string) {
      const gr = await c.purchasing.confirmGoodsReceipt(c.user(who), { purchaseOrderItemId, receivedTon: ton, receivedDate });
      logger.log(`입고 ${gr.goodsReceiptNo} ${ton}t (${receivedDate})`);
      c.clock.advanceMinutes(4);
    },

    async shipmentRequest(who: keyof typeof EMP, customer: string, items: { soItemId: number; qty: number }[], shipDate: string): Promise<Dr> {
      const dr = await c.shipment.create(c.user(who), { customerId: await c.customerId(customer), shipDate, items: items.map((i) => ({ salesOrderItemId: i.soItemId, requestQty: i.qty })) });
      logger.log(`출하요청 ${dr.shipmentRequestNo} ${customer} ${items.map((i) => `${i.qty}매`).join('+')} (출하 예정 ${shipDate})`);
      return { id: dr.id, no: dr.shipmentRequestNo, itemIds: dr.items.map((i) => i.id) };
    },

    /** 출하요청 품목마다 FIFO 추천 → 추천대로 확정 */
    async allocate(who: keyof typeof EMP, dr: Dr) {
      for (const shipmentRequestItemId of dr.itemIds) {
        const rec = await c.inventory.recommendAllocations(c.user(who), { allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT, shipmentRequestItemId });
        const lotIds = rec.candidates.filter((x) => x.isRecommended).map((x) => x.lotId);
        if (lotIds.length === 0) throw new Error(`${dr.no}: 추천 LOT이 없습니다 (미배정 ${rec.unallocatedQty})`);
        c.clock.advanceMinutes(2);
        await c.inventory.confirmAllocations(c.user(who), { allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT, shipmentRequestItemId, lotIds });
        logger.log(`배정 확정 ${dr.no}: ${lotIds.length}매`);
      }
    },

    async issue(who: keyof typeof EMP, dr: Dr) {
      const issued = await c.shipment.issue(c.user(who), dr.id);
      logger.log(`출고 확정 ${issued.shipmentRequestNo} → 밀시트 발행`);
    },

    async workRoom(who: keyof typeof EMP, salesOrderId: number, members: (keyof typeof EMP)[]) {
      const room = await c.messenger.createRoom(c.user(who), { chatRoomType: CHAT_ROOM_TYPE.WORK, salesOrderId, memberIds: members.map((m) => c.user(m).employeeId) });
      return room.id;
    },
    async groupRoom(who: keyof typeof EMP, name: string, members: (keyof typeof EMP)[]) {
      const room = await c.messenger.createRoom(c.user(who), { chatRoomType: CHAT_ROOM_TYPE.GROUP, chatRoomName: name, memberIds: members.map((m) => c.user(m).employeeId) });
      logger.log(`그룹 채팅방 '${name}'`);
      return room.id;
    },
    async directRoom(who: keyof typeof EMP, other: keyof typeof EMP) {
      const room = await c.messenger.createRoom(c.user(who), { chatRoomType: CHAT_ROOM_TYPE.DIRECT, memberIds: [c.user(other).employeeId] });
      return room.id;
    },
    async say(who: keyof typeof EMP, chatRoomId: number, content: string, mentions: (keyof typeof EMP)[] = []) {
      return c.messenger.sendMessage(c.user(who), chatRoomId, { content, mentionedEmployeeIds: mentions.map((m) => c.user(m).employeeId) });
    },
    async readRooms(rooms: [number, (keyof typeof EMP)[]][]) {
      for (const [chatRoomId, members] of rooms) {
        const last = await c.prisma.message.findFirst({ where: { chatRoomId }, orderBy: { id: 'desc' }, select: { id: true } });
        if (!last) continue;
        for (const member of members) await c.messenger.markRead(c.user(member), chatRoomId, { lastMessageId: last.id });
      }
    },

    async task(creator: keyof typeof EMP, assignee: keyof typeof EMP, title: string, description: string | null, dueDate: string, linkPath: string | null, opts: { done?: string; read?: boolean } = {}) {
      const task = await c.tasks.create(c.user(creator), { taskTitle: title, taskDescription: description, assigneeId: c.user(assignee).employeeId, dueDate, linkPath });
      if (opts.read && creator !== assignee) {
        const notice = await c.prisma.notification.findFirst({ where: { recipientId: c.user(assignee).employeeId, notificationType: NOTIFICATION_TYPE.TASK_ASSIGNED }, orderBy: { id: 'desc' }, select: { id: true } });
        if (notice) await c.notifications.read(c.user(assignee), notice.id);
      }
      if (opts.done) {
        const resume = c.clock.now();
        c.clock.set(opts.done);
        await c.tasks.complete(c.user(assignee), task.id);
        c.clock.set(seoulString(resume), true);
      }
      logger.log(`업무 '${title}' → ${c.user(assignee).employeeName}${opts.done ? ' (완료)' : ''}`);
      return task.id;
    },

    /** 기준 시각 전의 알림은 받은 사람이 읽은 것으로 */
    async readNotificationsBefore(seoul: string) {
      const before = new Date(Date.parse(seoul.replace(' ', 'T') + ':00+09:00'));
      const result = await c.prisma.notification.updateMany({ where: { createdAt: { lt: before }, readAt: null }, data: { readAt: before } });
      logger.log(`알림 ${result.count}건 읽음 처리 (${seoul} 이전)`);
    },
  };
}

/** Date → 'YYYY-MM-DD HH:mm:ss' (서울) */
function seoulString(date: Date): string {
  const s = new Date(date.getTime() + 9 * 3_600_000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 19)}`;
}

/**
 * 그 LOT에 적용되는 최신 검사 기준 항목마다 기준 범위 안의 값 (seed-production-demo.ts와 같은 규칙).
 * 가운데 값 그대로면 모든 LOT이 같은 값이라, 항목마다 작은 편차를 더해 측정값처럼 보이게 한다 (범위 안에 머문다).
 */
async function passingValues(prisma: PrismaService, lotId: number, overrides: Record<string, string> = {}) {
  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId }, select: { lotType: true, steelGradeId: true, item: { select: { steelGradeId: true, thicknessMm: true } } } });
  const steelGradeId = lot.lotType === LOT_TYPE.HEAT ? lot.steelGradeId : (lot.item?.steelGradeId ?? null);
  const standard = await prisma.inspectionStandard.findFirstOrThrow({
    where: { processType: INSPECTED_PROCESS[lot.lotType], steelGradeId: steelGradeId ?? 0 },
    orderBy: { versionNo: 'desc' },
    include: { inspectionStandardItems: true },
  });
  return standard.inspectionStandardItems
    .filter((item) => isItemApplicable(item, lot.item?.thicknessMm ?? null))
    .map((item, index) => {
      const override = overrides[item.inspectionItemCode];
      if (override !== undefined) return { inspectionStandardItemId: item.id, measuredValue: override };
      const min = item.minValue;
      const max = item.maxValue;
      // LOT id와 항목 순서로 정해지는 -0.15 ~ +0.15 (가운데에서 범위 폭의 15% 안)
      const wobble = (((lotId * 7 + index * 13) % 31) - 15) / 100;
      let value: Prisma.Decimal;
      if (min && max) value = min.add(max).div(2).add(max.sub(min).mul(wobble));
      else if (max) value = max.mul(new Prisma.Decimal('0.8').add(wobble / 5));
      else if (min) value = min.mul(new Prisma.Decimal('1.1').add(Math.abs(wobble) / 5));
      else value = new Prisma.Decimal(0);
      return { inspectionStandardItemId: item.id, measuredValue: value.toDecimalPlaces(4).toFixed(4) };
    });
}

/** 시드 끝: DB now()로 찍힌 재고 updated_at을 가상 시각으로 맞추고 요약을 남긴다 */
async function finish(c: Ctx) {
  const end = c.clock.now();
  await c.prisma.$executeRaw`UPDATE inventory SET updated_at = GREATEST(created_at, ${end}) WHERE updated_at > ${end}`;
  const [so, pp, lots, qi, pr, dr, ms, ev, msg, tasks, ntf] = await Promise.all([
    c.prisma.salesOrder.count(), c.prisma.productionPlan.count(), c.prisma.lot.count(), c.prisma.qualityInspection.count(),
    c.prisma.purchaseRequisition.count(), c.prisma.shipmentRequest.count(), c.prisma.millSheet.count(), c.prisma.businessEvent.count(),
    c.prisma.message.count(), c.prisma.task.count(), c.prisma.notification.count(),
  ]);
  logger.log(`완료: 수주 ${so} · 생산계획 ${pp} · LOT ${lots} · 검사 ${qi} · 구매요청 ${pr} · 출하요청 ${dr} · 밀시트 ${ms} · 작업 로그 ${ev} · 메시지 ${msg} · 업무 ${tasks} · 알림 ${ntf}`);
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exitCode = 1;
});
