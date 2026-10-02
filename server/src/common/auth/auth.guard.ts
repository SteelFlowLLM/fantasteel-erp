import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '@fantasteel/shared';
import { AppException } from '../errors/app.exception';
import { AuthTokenService } from './auth-token.service';
import { AuthUserService } from './auth-user.service';
import { IS_PUBLIC, REQUIRED_PERMISSION, type RequiredPermission } from './auth.decorators';

/** 권한 수준 비교: VIEW가 필요하면 VIEW·USE 모두 통과, USE가 필요하면 USE만 */
export function hasPermission(user: AuthUser, need: RequiredPermission): boolean {
  const level = user.permissions[need.permission];
  return need.level === 'VIEW' ? level !== undefined : level === 'USE';
}

/**
 * 전역 가드 (app.module.ts에 등록): 쿠키의 access token 검증 → 사원·권한을 DB에서 다시 읽음 → 필요한 권한 확인.
 * 모든 API는 기본으로 로그인이 필요하다. 예외는 @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AuthTokenService,
    private readonly authUsers: AuthUserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<{ headers: { cookie?: string }; user?: AuthUser }>();
    const employeeId = await this.tokens.verifyCookieHeader(req.headers.cookie);
    if (employeeId === null) throw new AppException('AUTH-002');
    const user = await this.authUsers.load(employeeId);
    if (!user) throw new AppException('AUTH-002');
    req.user = user;

    const need = this.reflector.getAllAndOverride<RequiredPermission | undefined>(REQUIRED_PERMISSION, targets);
    if (need && !hasPermission(user, need)) throw new AppException('COM-002');
    return true;
  }
}
