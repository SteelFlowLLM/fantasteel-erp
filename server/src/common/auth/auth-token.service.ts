import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions } from 'express';

/** access token을 담는 httpOnly 쿠키 이름 (컨벤션 6장) */
export const ACCESS_TOKEN_COOKIE = 'access_token';

/** httpOnly · Secure · SameSite=Lax (컨벤션 6장). localhost는 브라우저가 secure context로 봐서 http에서도 쿠키가 저장된다. */
export const ACCESS_TOKEN_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

/** 요청 헤더의 Cookie 문자열에서 값 하나를 꺼낸다 */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

/** 토큰 발급·검증. HTTP 가드와 메신저 WebSocket handshake가 함께 쓴다. */
@Injectable()
export class AuthTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(employeeId: number): Promise<string> {
    return this.jwt.signAsync({ sub: employeeId });
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
}
