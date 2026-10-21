import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthUser } from '@fantasteel/shared';
import { AuthSessionEvents } from '../../common/auth/auth-sessions';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_COOKIE_OPTIONS, readCookie } from '../../common/auth/auth-token.service';
import { CurrentUser, Public } from '../../common/auth/auth.decorators';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

/** API 명세서: 로그인 · 로그아웃 · 내 정보·권한 조회 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: AuthSessionEvents,
  ) {}

  /** 토큰은 httpOnly 쿠키로만 내려주고 응답 본문에는 넣지 않는다 (컨벤션 6·9장) */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<AuthUser> {
    const { token, user } = await this.auth.login(dto.employeeNo, dto.password);
    res.cookie(ACCESS_TOKEN_COOKIE, token, ACCESS_TOKEN_COOKIE_OPTIONS);
    return user;
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): null {
    // 이 브라우저의 메신저 소켓도 끊는다 (이슈 #488). 토큰 자체는 만료 때까지 유효하다(토큰 무효화 목록 없음)
    const token = readCookie(req.headers.cookie, ACCESS_TOKEN_COOKIE);
    if (token) this.sessions.revokeToken(token);
    res.clearCookie(ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_COOKIE_OPTIONS);
    return null;
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
