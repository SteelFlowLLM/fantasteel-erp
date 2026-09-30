import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

interface TxStore { afterCommit: (() => void)[] }
const txStorage = new AsyncLocalStorage<TxStore>();

/** 트랜잭션 안에서 부르면 커밋 뒤에, 밖에서 부르면 바로 실행한다 (실시간 알림 발송 등). */
export function runAfterCommit(fn: () => void): void {
  const store = txStorage.getStore();
  if (store) store.afterCommit.push(fn);
  else fn();
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * 업무 트랜잭션. service는 `$transaction` 대신 이 함수를 쓴다.
   * 안에서 예약된 runAfterCommit 콜백은 커밋에 성공했을 때만 실행된다.
   */
  async tx<T>(fn: (tx: Tx) => Promise<T>, options?: { timeout?: number }): Promise<T> {
    const outer = txStorage.getStore();
    if (outer) throw new Error('prisma.tx()를 중첩해서 부를 수 없습니다. 바깥 tx를 인자로 넘기세요.');
    const store: TxStore = { afterCommit: [] };
    const result = await txStorage.run(store, () =>
      this.$transaction((tx) => fn(tx), { timeout: options?.timeout ?? 20_000, maxWait: 10_000 }),
    );
    for (const cb of store.afterCommit) {
      try {
        cb();
      } catch {
        // 실시간 발송 실패가 업무 결과를 바꾸면 안 된다
      }
    }
    return result;
  }
}
