import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ERROR_CODE, type AuthUser } from '@fantasteel/shared';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_FAILED_LOGINS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly authUsers: AuthUserService,
  ) {}

  /** 사원번호·비밀번호 로그인 → 서버 발급 JWT (REQ-AUTH-001). */
  async login(employeeNo: string, password: string): Promise<{ accessToken: string; user: AuthUser }> {
    const fail = () => new AppException(ERROR_CODE.AUTH_001, '사원번호 또는 비밀번호가 올바르지 않습니다', HttpStatus.UNAUTHORIZED);
    const e = await this.prisma.employee.findUnique({ where: { employeeNo: employeeNo.trim() } });
    if (!e) throw fail();
    if (e.employeeStatus === 'LOCKED') throw new AppException(ERROR_CODE.AUTH_003, '로그인 실패가 반복되어 잠긴 계정입니다. 관리자에게 문의해 주세요', HttpStatus.UNAUTHORIZED);
    if (e.employeeStatus !== 'ACTIVE') throw new AppException(ERROR_CODE.AUTH_003, '사용 중지된 계정입니다', HttpStatus.UNAUTHORIZED);
    if (!(await bcrypt.compare(password, e.passwordHash))) {
      const failed = e.failedLoginCount + 1;
      await this.prisma.employee.update({
        where: { id: e.id },
        data: { failedLoginCount: failed, employeeStatus: failed >= MAX_FAILED_LOGINS ? 'LOCKED' : e.employeeStatus },
      });
      throw fail();
    }
    await this.prisma.employee.update({ where: { id: e.id }, data: { failedLoginCount: 0, lastLoginAt: new Date() } });
    const user = (await this.authUsers.load(e.id))!;
    return { accessToken: await this.jwt.signAsync({ sub: e.id }), user };
  }
}
