import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { badInput, invalidState } from '../../common/errors/app.exception';
import { serialize } from '../../common/http/response.interceptor';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { IdempotencyKeyRepository } from './idempotency-key.repository';

const MAX_KEY_LENGTH = 200;

/**
 * 변경 API의 요청 고유키(`Idempotency-Key` 헤더) 처리. 같은 사원이 같은 키로 다시 부르면
 * 업무를 다시 실행하지 않고 처음 응답을 돌려준다 (업무 프로세스 정의서 13.2 claimRequestId).
 * 키 선점·업무·응답 저장이 한 트랜잭션이라, 업무가 실패하면 키도 남지 않아 재시도가 새로 실행된다.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: IdempotencyKeyRepository,
  ) {}

  /**
   * work를 업무 트랜잭션으로 실행한다. rawKey가 없으면 그냥 실행한다.
   * T는 JSON으로 그대로 저장할 수 있는 응답(문자열·숫자만)이어야 재실행 응답과 모양이 같다.
   */
  async run<T>(scope: string, rawKey: string | undefined, user: AuthUser, work: (tx: Tx) => Promise<T>): Promise<T> {
    const key = rawKey?.trim();
    if (!key) return this.prisma.tx(work);
    if (key.length > MAX_KEY_LENGTH) throw badInput(`Idempotency-Key는 ${MAX_KEY_LENGTH}자 이하로 보내 주세요`);
    const requestKey = `${scope}:${user.employeeId}:${key}`;

    const done = await this.repo.findByRequestKey(this.prisma, requestKey);
    if (done) return this.replay<T>(done.response);

    try {
      return await this.prisma.tx(async (tx) => {
        const claimed = await this.repo.claim(tx, requestKey, user.employeeId);
        const result = await work(tx);
        await this.repo.saveResponse(tx, claimed.id, serialize(result) as Prisma.InputJsonValue);
        return result;
      });
    } catch (e) {
      // 같은 키의 요청이 동시에 들어와 먼저 끝난 경우: 선점(unique)에서 막히고, 먼저 끝난 쪽의 응답을 돌려준다.
      if ((e as { code?: string })?.code === 'P2002') {
        const first = await this.repo.findByRequestKey(this.prisma, requestKey);
        if (first) return this.replay<T>(first.response);
      }
      throw e;
    }
  }

  private replay<T>(response: unknown): T {
    if (response === null || response === undefined) throw invalidState('같은 요청이 아직 처리 중입니다. 잠시 뒤 다시 확인해 주세요');
    return response as T;
  }
}
