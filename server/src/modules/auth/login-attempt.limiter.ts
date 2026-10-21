import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';

/**
 * 로그인 실패 횟수 제한 (이슈 #485, 가정값). 한 창(5분) 안에 사원번호마다 5번, IP마다 20번 틀리면 창이 지날 때까지 로그인을 받지 않는다.
 * 서버 한 대를 가정해 메모리에만 둔다(재시작하면 비워지고, 서버가 여러 대면 대수만큼 허용된다). 성공하면 그 사원번호의 실패를 지운다(IP는 그대로).
 * 남의 사원번호로 일부러 틀려 5분간 막을 수는 있다(IP 제한이 있어 한 곳에서 여러 사원을 막기는 어렵다).
 *
 * 한도 확인과 시도 자리 잡기를 비밀번호 확인(bcrypt, 수십 ms) 전에 한 번에 한다 (이슈 #497).
 * 실패를 비교 뒤에 적으면 한꺼번에 N개를 보낸 요청이 모두 한도 전 상태를 보고 통과한다.
 * 그래서 시도는 시작할 때 실패로 먼저 적고, 성공하면 지운다. 같은 사원번호·IP로 한꺼번에 한도 넘게 오는 요청은 (맞는 비밀번호여도) 한도 밖부터 AUTH-003이다.
 */
export const LOGIN_FAIL_WINDOW_MS = 5 * 60_000;
export const LOGIN_FAIL_LIMIT_PER_EMPLOYEE = 5;
export const LOGIN_FAIL_LIMIT_PER_IP = 20;
/** 기록해 두는 키 수 상한. 없는 사원번호를 마구 보내도 메모리가 무한히 늘지 않게 한다 */
const MAX_KEYS = 10_000;
const EMPLOYEE_NO_KEY_MAX = 40;

/** 로그인 시도 하나. 시작할 때 이미 실패로 세어 두었고, 결과가 정해지면 succeed·fail로 알린다 */
export interface LoginAttempt {
  /** 비밀번호가 맞았다: 이 시도를 지우고, 그 사원번호가 이미 틀렸던 기록도 지운다(아직 확인 중인 다른 시도는 남긴다) */
  succeed(): void;
  /** 틀렸다: 시작할 때 세어 둔 그대로 둔다 */
  fail(): void;
  /** 결과를 정하지 못하고 끝났다(DB 오류 등 서버 쪽 문제): 이 시도는 세지 않는다. succeed·fail 뒤에는 아무것도 안 한다 */
  cancel(): void;
}

interface Entry {
  at: number;
  /** 아직 맞았는지 틀렸는지 모른다 */
  pending: boolean;
}

@Injectable()
export class LoginAttemptLimiter {
  /** 시험이 시간을 바꿀 수 있게 둔다 */
  clock: () => number = Date.now;
  private readonly entries = new Map<string, Entry[]>();

  /** 한도를 넘었으면 AUTH-003(429). 아니면 시도 자리를 잡아 돌려준다. 비밀번호 확인(bcrypt)을 하기 전에 부르고, 확인과 자리 잡기 사이에 await이 없다 */
  begin(employeeNo: string, ip: string | undefined): LoginAttempt {
    const employee = employeeKey(employeeNo);
    const address = ipKey(ip);
    if (this.recent(employee).length >= LOGIN_FAIL_LIMIT_PER_EMPLOYEE || this.recent(address).length >= LOGIN_FAIL_LIMIT_PER_IP) throw new AppException('AUTH-003');
    const entry: Entry = { at: this.clock(), pending: true };
    for (const key of [employee, address]) this.entries.set(key, [...this.recent(key), entry]);
    if (this.entries.size > MAX_KEYS) this.prune();

    let settled = false;
    const once = (apply: () => void) => () => {
      if (settled) return;
      settled = true;
      apply();
    };
    return {
      succeed: once(() => {
        this.remove(address, (e) => e === entry);
        this.remove(employee, (e) => e === entry || !e.pending);
      }),
      fail: once(() => {
        entry.pending = false;
      }),
      cancel: once(() => {
        this.remove(employee, (e) => e === entry);
        this.remove(address, (e) => e === entry);
      }),
    };
  }

  /** 시험·운영 중 비우기 */
  reset(): void {
    this.entries.clear();
  }

  /** 지금 기록해 둔 키 수 (시험) */
  size(): number {
    return this.entries.size;
  }

  private recent(key: string): Entry[] {
    const since = this.clock() - LOGIN_FAIL_WINDOW_MS;
    return (this.entries.get(key) ?? []).filter((entry) => entry.at > since);
  }

  private remove(key: string, drop: (entry: Entry) => boolean): void {
    const left = this.recent(key).filter((entry) => !drop(entry));
    if (left.length === 0) this.entries.delete(key);
    else this.entries.set(key, left);
  }

  /** 창이 지난 키를 지우고, 그래도 많으면 오래된 키부터 지운다 */
  private prune(): void {
    for (const key of [...this.entries.keys()]) if (this.recent(key).length === 0) this.entries.delete(key);
    let excess = this.entries.size - MAX_KEYS;
    for (const key of this.entries.keys()) {
      if (excess-- <= 0) break;
      this.entries.delete(key);
    }
  }
}

const employeeKey = (employeeNo: string) => `e:${employeeNo.trim().toLowerCase().slice(0, EMPLOYEE_NO_KEY_MAX)}`;
const ipKey = (ip: string | undefined) => `i:${ip ?? 'unknown'}`;
