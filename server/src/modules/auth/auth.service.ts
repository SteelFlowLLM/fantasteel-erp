import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import type { AuthUser } from '@fantasteel/shared';
import { AuthTokenService } from '../../common/auth/auth-token.service';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRepository } from './auth.repository';
import { LoginAttemptLimiter } from './login-attempt.limiter';

/** 사원 비밀번호와 같은 비용(시드·사원 등록은 10)으로 만든 가짜 해시. 없는 사원번호도 같은 시간 동안 비교한다 */
const BCRYPT_ROUNDS = 10;

/** 로그인·로그아웃 (REQ-AUTH-001, BP-AUTH-01) */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AuthRepository,
    private readonly tokens: AuthTokenService,
    private readonly authUsers: AuthUserService,
    private readonly limiter: LoginAttemptLimiter,
  ) {}

  private readonly dummyHash: Promise<string> = hash('fantasteel-no-such-employee', BCRYPT_ROUNDS);

  /**
   * 사원번호·비밀번호 확인 → access token. 없는 사원·틀린 비밀번호·퇴사는 같은 오류로 답한다.
   * 없는 사원번호·퇴사자도 가짜 해시와 비교해 응답 시간으로 사원번호가 있는지 알아내지 못하게 하고,
   * 사원번호·IP별 실패 횟수가 한도를 넘으면 비밀번호를 확인하기 전에 AUTH-003으로 막는다 (이슈 #485).
   * 한도 확인과 시도 자리 잡기는 비밀번호 확인 전에 한 번에 한다: 동시에 보낸 요청이 한도 전에 모두 통과하지 못하게 (이슈 #497).
   */
  async login(employeeNo: string, password: string, ip?: string): Promise<{ token: string; user: AuthUser }> {
    const attempt = this.limiter.begin(employeeNo, ip);
    try {
      const credential = await this.repository.findCredentialByEmployeeNo(this.prisma, employeeNo);
      const matches = await compare(password, credential?.passwordHash ?? (await this.dummyHash));
      const user = credential && credential.isActive === true && matches ? await this.authUsers.load(credential.id) : null;
      if (!user) {
        attempt.fail();
        throw new AppException('AUTH-001');
      }
      attempt.succeed();
      return { token: await this.tokens.sign(user.employeeId), user };
    } finally {
      // DB 오류 같은 서버 쪽 문제로 결과를 정하지 못한 시도는 세지 않는다 (succeed·fail 뒤에는 아무 일도 하지 않는다)
      attempt.cancel();
    }
  }
}
