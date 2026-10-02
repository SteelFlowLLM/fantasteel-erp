import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '@fantasteel/shared';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_COOKIE_OPTIONS } from '../../common/auth/auth-token.service';
import { CurrentUser, Public } from '../../common/auth/auth.decorators';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

/** API 명세서: 로그인 · 로그아웃 · 내 정보·권한 조회 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
  logout(@Res({ passthrough: true }) res: Response): null {
    res.clearCookie(ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_COOKIE_OPTIONS);
    return null;
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
