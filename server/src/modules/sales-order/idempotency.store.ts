import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';

/** 같은 키를 다시 보내면 첫 응답을 돌려주는 시간 */
const KEEP_MS = 10 * 60 * 1000;
const MAX_KEY_LENGTH = 100;

interface Entry {
  promise: Promise<unknown>;
  expiresAt: number;
}

/**
 * 저장 버튼을 두 번 눌러도 한 건만 만들기 위한 요청 키 (API 목록 "Idempotency-Key 적용 후보", 업무 프로세스 13.2 claimRequestId).
 * ERD에 요청 키 테이블이 없어 서버 메모리에 짧게 둔다(2026-10-02 결정). 서버를 다시 띄우거나 여러 대로 늘리면 보장되지 않는다.
 * 같은 사원·같은 키가 처리 중이면 그 결과를 함께 기다리고, 끝났으면 저장된 결과를 돌려준다. 실패한 요청은 키를 지워 다시 시도할 수 있다.
 */
@Injectable()
export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();

  run<T>(scope: string, key: string | undefined, work: () => Promise<T>): Promise<T> {
    if (key === undefined || key === '') return work();
    if (key.length > MAX_KEY_LENGTH) throw new AppException('COM-004', `Idempotency-Key는 ${MAX_KEY_LENGTH}자까지예요`);
    const now = Date.now();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);

    const id = `${scope}:${key}`;
    const found = this.entries.get(id);
    if (found) return found.promise as Promise<T>;
    const promise = work();
    this.entries.set(id, { promise, expiresAt: now + KEEP_MS });
    promise.catch(() => this.entries.delete(id));
    return promise;
  }
}
