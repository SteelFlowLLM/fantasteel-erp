import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { CurrentUser, Public } from '../../common/auth/auth.decorators';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.employeeNo, dto.password);
  }

  /** 현재 로그인 사원과 권한 (화면 메뉴·버튼 제어용). */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  /** 서버는 상태를 갖지 않는다. 클라이언트가 토큰을 버린다. */
  @Post('logout')
  @HttpCode(200)
  logout() {
    return { loggedOut: true };
  }
}
