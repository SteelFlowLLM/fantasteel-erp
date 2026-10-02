import { Injectable } from '@nestjs/common';
import { compare } from 'bcryptjs';
import type { AuthUser } from '@fantasteel/shared';
import { AuthTokenService } from '../../common/auth/auth-token.service';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRepository } from './auth.repository';

/** 로그인·로그아웃 (REQ-AUTH-001, BP-AUTH-01) */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AuthRepository,
    private readonly tokens: AuthTokenService,
    private readonly authUsers: AuthUserService,
  ) {}

  /** 사원번호·비밀번호 확인 → access token. 없는 사원·틀린 비밀번호·퇴사는 같은 오류로 답한다 */
  async login(employeeNo: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const credential = await this.repository.findCredentialByEmployeeNo(this.prisma, employeeNo);
    const ok = credential?.isActive === true && (await compare(password, credential.passwordHash));
    if (!credential || !ok) throw new AppException('AUTH-001');
    const user = await this.authUsers.load(credential.id);
    if (!user) throw new AppException('AUTH-001');
    return { token: await this.tokens.sign(user.employeeId), user };
  }
}
