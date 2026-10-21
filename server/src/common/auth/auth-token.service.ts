import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { CookieOptions } from 'express';

/** access token을 담는 httpOnly 쿠키 이름 (컨벤션 6장) */
export const ACCESS_TOKEN_COOKIE = 'access_token';

/**
 * httpOnly · Secure · SameSite=Lax (컨벤션 6장). localhost는 브라우저가 secure context로 봐서 http에서도 쿠키가 저장된다.
 * 다른 PC가 사내 IP(http)로 들어오면 Secure 쿠키를 저장하지 않아 로그인이 안 된다: 그때만 COOKIE_SECURE=false (이슈 #440).
 */
export const ACCESS_TOKEN_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: process.env.COOKIE_SECURE !== 'false', sameSite: 'lax', path: '/' };

/** 요청 헤더의 Cookie 문자열에서 값 하나를 꺼낸다. 인코딩이 깨진 값(`%` 등)은 없는 것으로 본다 */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      // 누구나 보낼 수 있는 헤더라 decodeURIComponent의 URIError가 401 대신 500(HTTP)·프로세스 종료(소켓 연결)가 되지 않게 한다
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** 토큰 발급·검증. HTTP 가드와 메신저 WebSocket handshake가 함께 쓴다. */
@Injectable()
export class AuthTokenService {
  constructor(private readonly jwt: JwtService) {}

  /** jti로 로그인마다 다른 토큰을 만든다: 같은 1초에 두 기기에서 로그인해도 한쪽 로그아웃이 다른 쪽 메신저 소켓을 끊지 않게 (이슈 #488) */
  sign(employeeId: number): Promise<string> {
    return this.jwt.signAsync({ sub: employeeId, jti: randomUUID() });
  }

  /** 유효하면 사원 id, 아니면 null */
  async verify(token: string | undefined): Promise<number | null> {
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: number }>(token);
      return Number(payload.sub);
    } catch {
      return null;
    }
  }

  /** Cookie 헤더에서 토큰을 읽어 검증한다 */
  verifyCookieHeader(cookieHeader: string | undefined): Promise<number | null> {
    return this.verify(readCookie(cookieHeader, ACCESS_TOKEN_COOKIE));
  }

  /** Cookie 헤더의 토큰을 검증하고 토큰·만료 시각(ms)도 돌려준다 (메신저 소켓이 만료 때 끊으려고, 이슈 #488). 만료가 없으면 expiresAt null */
  async verifyCookieSession(cookieHeader: string | undefined): Promise<{ employeeId: number; token: string; expiresAt: number | null } | null> {
    const token = readCookie(cookieHeader, ACCESS_TOKEN_COOKIE);
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: number; exp?: number }>(token);
      return { employeeId: Number(payload.sub), token, expiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : null };
    } catch {
      return null;
    }
  }
}
