import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODE } from '@fantasteel/shared';
import { AppException, forbidden } from '../errors/app.exception';
import { AuthUserService } from './auth-user.service';
import { IS_PUBLIC, REQUIRED_PERMISSION, type RequiredPermission } from './auth.decorators';

/** 전역 가드: access token 검증 → 사원·권한 조회 → 필요한 권한 확인 (REQ-AUTH-001·003). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly authUsers: AuthUserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query?.access_token as string | undefined);
    if (!token) throw new AppException(ERROR_CODE.AUTH_002, '로그인이 필요합니다', HttpStatus.UNAUTHORIZED);
    let employeeId: number;
    try {
      employeeId = Number((await this.jwt.verifyAsync<{ sub: number }>(token)).sub);
    } catch {
      throw new AppException(ERROR_CODE.AUTH_002, '로그인이 만료되었습니다. 다시 로그인해 주세요', HttpStatus.UNAUTHORIZED);
    }
    const user = await this.authUsers.load(employeeId);
    if (!user) throw new AppException(ERROR_CODE.AUTH_003, '사용할 수 없는 계정입니다', HttpStatus.UNAUTHORIZED);
    req.user = user;

    const need = this.reflector.getAllAndOverride<RequiredPermission | undefined>(REQUIRED_PERMISSION, targets);
    if (!need) return true;
    const ok = need.anyOf.some((code) => {
      const level = user.permissions[code];
      return need.level === 'VIEW' ? !!level : level === 'USE';
    });
    if (!ok) throw forbidden();
    return true;
  }
}
