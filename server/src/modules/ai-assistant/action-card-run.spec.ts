// 실행 카드를 한 번만 실행하는지(이슈 #479) 실제 앱과 DB(fs_collab)로 확인한다
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { AiActionCardExecuteResult } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { AiActionCardRunLedger, CARD_RUN_STALE_MS, cardRunKeyOf } from './action-card-run';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let ownerCookie: string;
let otherCookie: string;
let ownerId: number;
let startTaskId = 0;

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function execute(cookie: string, payload: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/ai-assistant/action-cards/execute`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const body = (await res.json()) as { data?: AiActionCardExecuteResult; error?: { code: string; message: string } };
  return { status: res.status, data: body.data, code: body.error?.code, message: body.error?.message };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  startTaskId = (await prisma.task.aggregate({ _max: { id: true } }))._max.id ?? 0;
  ownerCookie = await login('2207005');
  otherCookie = await login('1702004');
  ownerId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } })).id;
}, 60_000);

afterAll(async () => {
  await prisma?.task.deleteMany({ where: { id: { gt: startTaskId } } });
  await prisma?.aiActionCardRun.deleteMany({});
  await app?.close();
});

const taskCard = (title: string, cardId: string = randomUUID()) => ({ kind: 'TASK', cardId, title, assigneeId: ownerId, dueDate: seoulToday() });
const tasksTitled = (title: string) => prisma.task.count({ where: { id: { gt: startTaskId }, taskTitle: title } });

describe('실행 카드 한 번만 실행 (이슈 #479)', () => {
  it('같은 카드를 동시에 두 번 보내도 업무는 하나이고, 끝난 뒤 다시 보내면 처음 결과를 그대로 돌려준다', async () => {
    const card = taskCard('더블클릭 시험 업무');
    const [a, b] = await Promise.all([execute(ownerCookie, card), execute(ownerCookie, card)]);
    const ok = [a, b].filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    // 늦게 온 쪽은 실행 중이면 COM-001, 이미 끝났으면 같은 결과
    for (const r of [a, b]) if (r.status !== 201) expect([r.status, r.code]).toEqual([409, 'COM-001']);
    if (ok.length === 2) expect(ok[0].data?.registered.id).toBe(ok[1].data?.registered.id);

    const again = await execute(ownerCookie, card);
    expect(again.status).toBe(201);
    expect(again.data?.registered.id).toBe(ok[0].data?.registered.id);
    expect(await tasksTitled('더블클릭 시험 업무')).toBe(1);

    // 다른 카드 번호면 새로 만든다
    expect((await execute(ownerCookie, taskCard('더블클릭 시험 업무'))).status).toBe(201);
    expect(await tasksTitled('더블클릭 시험 업무')).toBe(2);
  });

  it('실행이 거절되면 잡기를 풀어 같은 카드를 고쳐 다시 실행할 수 있다', async () => {
    const cardId = randomUUID();
    const rejected = await execute(ownerCookie, { ...taskCard('거절 뒤 다시', cardId), assigneeId: 2147483000 });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.aiActionCardRun.count({ where: { cardId } })).toBe(0);
    const retried = await execute(ownerCookie, taskCard('거절 뒤 다시', cardId));
    expect(retried.status).toBe(201);
    expect(await prisma.aiActionCardRun.findFirstOrThrow({ where: { cardId } })).toMatchObject({ runStatus: 'DONE', cardKind: 'TASK' });
  });

  it('같은 번호로 다른 종류의 카드를 보내면 COM-001, 다른 사원은 자기 실행으로 따로 센다', async () => {
    const cardId = randomUUID();
    expect((await execute(ownerCookie, taskCard('종류 시험', cardId))).status).toBe(201);
    const otherKind = await execute(ownerCookie, { kind: 'RESEARCH', cardId, question: '다른 종류 카드 번호 재사용' });
    expect([otherKind.status, otherKind.code]).toEqual([409, 'COM-001']);
    // 남의 대화 카드 자리를 보내 본인 실행을 막지 못하게 사원별로 센다
    expect(await prisma.aiActionCardRun.count({ where: { cardId } })).toBe(1);
    const otherEmployee = await execute(otherCookie, { ...taskCard('종류 시험 2', cardId) });
    expect(otherEmployee.status).toBe(201);
  });

  it('카드 번호도 저장한 대화 자리도 없으면 COM-004, 카드 번호가 UUID가 아니면 400', async () => {
    const { cardId: _omit, ...noId } = taskCard('번호 없음');
    const missing = await execute(ownerCookie, noId);
    expect([missing.status, missing.code]).toEqual([400, 'COM-004']);
    expect((await execute(ownerCookie, { ...noId, cardId: 'not-a-uuid' })).status).toBe(400);
    expect(await tasksTitled('번호 없음')).toBe(0);
  });

  it(`실행 중으로 ${CARD_RUN_STALE_MS / 60_000}분 넘게 남은 카드는 실행과 기록이 한 트랜잭션인 카드만 다시 잡는다`, async () => {
    const ledger = app.get(AiActionCardRunLedger);
    const cardId = randomUUID();
    expect(await ledger.claim(cardId, ownerId, 'TASK', true)).toEqual({ state: 'claimed' });
    expect(await ledger.claim(cardId, ownerId, 'TASK', true)).toEqual({ state: 'running' });
    const later = new Date(Date.now() + CARD_RUN_STALE_MS + 1000);
    expect(await ledger.claim(cardId, ownerId, 'TASK', true, later)).toEqual({ state: 'claimed' });
    expect(await ledger.claim(cardId, ownerId, 'TASK', true, later)).toEqual({ state: 'running' });
    // 수주처럼 다른 모듈의 트랜잭션으로 실행한 카드는 실행됐는지 몰라 다시 실행하지 않는다
    const order = randomUUID();
    expect(await ledger.claim(order, ownerId, 'SALES_ORDER', false)).toEqual({ state: 'claimed' });
    // 잡은 뒤에 시각을 정한다 (위 later는 이 행보다 먼저 정해져, 느린 DB에서 1초 여유를 넘기면 아직 '실행 중'으로 보였다)
    const orderLater = new Date(Date.now() + CARD_RUN_STALE_MS + 1000);
    expect(await ledger.claim(order, ownerId, 'SALES_ORDER', false, orderLater)).toEqual({ state: 'unknown' });
  });

  it('업무 카드의 실행 기록은 업무와 같은 트랜잭션에 남는다 (업무가 롤백되면 기록도 없다)', async () => {
    const cardId = randomUUID();
    const done = await execute(ownerCookie, taskCard('한 트랜잭션 시험', cardId));
    expect(done.status).toBe(201);
    const row = await prisma.aiActionCardRun.findFirstOrThrow({ where: { cardId } });
    expect(row).toMatchObject({ runStatus: 'DONE', result: { kind: 'TASK', registered: { type: 'task', id: done.data?.registered.id } } });
    // 업무 트랜잭션이 거절되면 RUNNING도 지워져 다시 실행할 수 있다
    const rejectedId = randomUUID();
    expect((await execute(ownerCookie, { ...taskCard('거절 시험', rejectedId), assigneeId: 2147483000 })).status).toBeGreaterThanOrEqual(400);
    expect(await prisma.aiActionCardRun.count({ where: { cardId: rejectedId } })).toBe(0);
  });

  it('열쇠는 카드 번호 → Notion 카드 번호 → 저장한 대화 자리 순으로 고른다', () => {
    expect(cardRunKeyOf({ cardId: 'id-1', nonce: 'n', chat: { messageId: 3, cardKey: 'a1' } })).toBe('id-1');
    expect(cardRunKeyOf({ nonce: 'n', chat: { messageId: 3, cardKey: 'a1' } })).toBe('notion:n');
    expect(cardRunKeyOf({ chat: { messageId: 3, cardKey: 'a1' } })).toBe('chat:3:a1');
    expect(cardRunKeyOf({})).toBeNull();
  });
});
