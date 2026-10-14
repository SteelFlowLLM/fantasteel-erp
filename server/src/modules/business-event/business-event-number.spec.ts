import { Test } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE } from '@fantasteel/shared';
import { CommonModule } from '../../common/common.module';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 실제 DB(fs_log)에서 두 거래가 겹쳐 작업 로그를 남길 때 번호(EV-)가 겹치지 않는지 본다 (business-event.md 8장 이벤트 번호 경합).
describe('작업 로그 번호 채번 (동시 거래)', () => {
  let prisma: PrismaService;
  let recorder: BusinessEventRecorder;
  const createdIds: number[] = [];

  const record = (tx: Parameters<BusinessEventRecorder['record']>[0]) =>
    recorder.record(tx, { type: BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED, actor: 'SYSTEM', target: { table: 'sales_order', id: 0 } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, CommonModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    recorder = moduleRef.get(BusinessEventRecorder);
  });

  afterAll(async () => {
    await prisma.businessEvent.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  it('앞 거래가 커밋하기 전에 뒤 거래가 기록해도 두 거래 모두 저장되고 번호가 이어진다', async () => {
    // 앞 거래는 기록한 뒤 잠시 커밋하지 않는다. 뒤 거래는 그 사이에 같은 앞부분의 최댓값을 읽는다
    const first = prisma.$transaction(async (tx) => {
      const event = await record(tx);
      await sleep(400);
      return event;
    });
    await sleep(100);
    const second = prisma.$transaction((tx) => record(tx));

    const [a, b] = await Promise.all([first, second]);
    createdIds.push(a.id, b.id);
    expect(b.businessEventNo).not.toBe(a.businessEventNo);
    expect(b.businessEventNo > a.businessEventNo).toBe(true);
  });
});
