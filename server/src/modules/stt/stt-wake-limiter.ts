import { Injectable } from '@nestjs/common';
import { STT_WAKE_CLIP_LIMITS } from '@fantasteel/shared';

/**
 * 철강맨 부르기 조각의 사원별 1분 횟수 (이슈 #457). 서버 한 대라 메모리에 둔다: 다시 켜면 비지만 1분 창이라 상관없다.
 * 한도를 넘은 요청은 세지 않는다 (계속 보내도 창이 밀리지 않게).
 */
@Injectable()
export class SttWakeLimiter {
  private readonly sent = new Map<number, number[]>();
  perMinute: number = STT_WAKE_CLIP_LIMITS.perMinute;

  take(employeeId: number, now = Date.now()): boolean {
    const recent = (this.sent.get(employeeId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= this.perMinute) {
      this.sent.set(employeeId, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(employeeId, recent);
    return true;
  }
}
