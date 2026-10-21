import { Injectable } from '@nestjs/common';

/** 끊어야 할 로그인: 사원 전체(퇴사 처리) 또는 토큰 하나(그 브라우저의 로그아웃) */
export type AuthRevocation = { employeeId: number } | { token: string };

/**
 * 로그인이 끝났음을 알린다 (이슈 #488). HTTP 요청은 매번 토큰과 사원 상태를 확인하지만, 메신저 소켓은 접속 때만 확인하므로
 * 로그아웃·퇴사 처리 때 이 알림을 받아 그 소켓을 끊는다. 서버 메모리 안의 알림이라 서버를 여러 대로 늘리면 공유 채널이 필요하다.
 */
@Injectable()
export class AuthSessionEvents {
  private readonly listeners = new Set<(revocation: AuthRevocation) => void>();

  /** 알림을 받는다. 돌려준 함수를 부르면 그만 받는다 */
  on(listener: (revocation: AuthRevocation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 퇴사 처리: 이 사원의 모든 로그인 */
  revokeEmployee(employeeId: number): void {
    this.emit({ employeeId });
  }

  /** 로그아웃: 이 토큰을 쓰는 소켓만 (같은 사원의 다른 브라우저는 그대로) */
  revokeToken(token: string): void {
    this.emit({ token });
  }

  private emit(revocation: AuthRevocation): void {
    for (const listener of this.listeners) listener(revocation);
  }
}
