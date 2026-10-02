import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

/** repository 함수의 첫 인자 (컨벤션 8장). 트랜잭션 밖에서 부를 때는 PrismaService를 그대로 넘긴다. */
export type Tx = Prisma.TransactionClient;

const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@localhost:54322/fantasteel';

/** 앱은 풀러 URL + 드라이버 어댑터 (컨벤션 7-1). 전역 PrismaModule로만 제공한다. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
