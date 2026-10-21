import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';

/**
 * 로그인 실패 횟수 제한 (이슈 #485, 가정값). 한 창(5분) 안에 사원번호마다 5번, IP마다 20번 틀리면 창이 지날 때까지 로그인을 받지 않는다.
 * 서버 한 대를 가정해 메모리에만 둔다(재시작하면 비워지고, 서버가 여러 대면 대수만큼 허용된다). 성공하면 그 사원번호의 실패를 지운다(IP는 그대로).
 * 남의 사원번호로 일부러 틀려 5분간 막을 수는 있다(IP 제한이 있어 한 곳에서 여러 사원을 막기는 어렵다).
 */
export const LOGIN_FAIL_WINDOW_MS = 5 * 60_000;
export const LOGIN_FAIL_LIMIT_PER_EMPLOYEE = 5;
export const LOGIN_FAIL_LIMIT_PER_IP = 20;
/** 기록해 두는 키 수 상한. 없는 사원번호를 마구 보내도 메모리가 무한히 늘지 않게 한다 */
const MAX_KEYS = 10_000;
const EMPLOYEE_NO_KEY_MAX = 40;

@Injectable()
export class LoginAttemptLimiter {
  /** 시험이 시간을 바꿀 수 있게 둔다 */
  clock: () => number = Date.now;
  private readonly failures = new Map<string, number[]>();

  /** 한도를 넘었으면 AUTH-003(429). 비밀번호 확인(bcrypt)을 하기 전에 부른다 */
  assertAllowed(employeeNo: string, ip: string | undefined): void {
    if (this.recent(employeeKey(employeeNo)).length >= LOGIN_FAIL_LIMIT_PER_EMPLOYEE || this.recent(ipKey(ip)).length >= LOGIN_FAIL_LIMIT_PER_IP) {
      throw new AppException('AUTH-003');
    }
  }

  recordFailure(employeeNo: string, ip: string | undefined): void {
    const now = this.clock();
    for (const key of [employeeKey(employeeNo), ipKey(ip)]) this.failures.set(key, [...this.recent(key), now]);
    if (this.failures.size > MAX_KEYS) this.prune();
  }

  recordSuccess(employeeNo: string): void {
    this.failures.delete(employeeKey(employeeNo));
  }

  /** 시험·운영 중 비우기 */
  reset(): void {
    this.failures.clear();
  }

  /** 지금 기록해 둔 키 수 (시험) */
  size(): number {
    return this.failures.size;
  }

  private recent(key: string): number[] {
    const since = this.clock() - LOGIN_FAIL_WINDOW_MS;
    return (this.failures.get(key) ?? []).filter((at) => at > since);
  }

  /** 창이 지난 키를 지우고, 그래도 많으면 오래된 키부터 지운다 */
  private prune(): void {
    for (const key of [...this.failures.keys()]) if (this.recent(key).length === 0) this.failures.delete(key);
    let excess = this.failures.size - MAX_KEYS;
    for (const key of this.failures.keys()) {
      if (excess-- <= 0) break;
      this.failures.delete(key);
    }
  }
}

const employeeKey = (employeeNo: string) => `e:${employeeNo.trim().toLowerCase().slice(0, EMPLOYEE_NO_KEY_MAX)}`;
const ipKey = (ip: string | undefined) => `i:${ip ?? 'unknown'}`;
