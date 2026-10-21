// 로그인과 실패 횟수 제한의 만남 (이슈 #497): 동시에 보낸 요청이 비밀번호를 확인하기 전에 한도에서 막히는지 가짜 저장소로 확인한다. DB 없음
import { hash } from 'bcryptjs';
import type { AuthTokenService } from '../../common/auth/auth-token.service';
import type { AuthUserService } from '../../common/auth/auth-user.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { LOGIN_FAIL_LIMIT_PER_EMPLOYEE, LoginAttemptLimiter } from './login-attempt.limiter';

const PASSWORD = 'right-password';

async function setup(findCredential?: () => Promise<unknown>) {
  const passwordHash = await hash(PASSWORD, 4);
  const repository = {
    // DB가 조금 걸리는 것처럼: 그 사이 다른 요청이 들어온다
    findCredentialByEmployeeNo: jest.fn(findCredential ?? (async () => (await new Promise((resolve) => setTimeout(resolve, 5)), { id: 1, passwordHash, isActive: true }))),
  };
  const authUsers = { load: jest.fn(async () => ({ employeeId: 1 })) };
  const tokens = { sign: jest.fn(async () => 'token') };
  const limiter = new LoginAttemptLimiter();
  const service = new AuthService({} as PrismaService, repository as unknown as AuthRepository, tokens as unknown as AuthTokenService, authUsers as unknown as AuthUserService, limiter);
  const codeOf = (result: PromiseSettledResult<unknown>) => (result.status === 'rejected' ? (result.reason as { code?: string }).code : 'OK');
  return { service, repository, limiter, codeOf };
}

describe('AuthService.login 실패 횟수 제한', () => {
  it('동시에 틀린 비밀번호를 한도 넘게 보내도 한도만큼만 확인하고 나머지는 AUTH-003이다', async () => {
    const { service, repository, codeOf } = await setup();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => service.login('2103003', 'wrong-password', '10.0.0.1')));
    const codes = results.map(codeOf);
    expect(codes.filter((code) => code === 'AUTH-001')).toHaveLength(LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
    expect(codes.filter((code) => code === 'AUTH-003')).toHaveLength(12 - LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
    // 한도 밖 요청은 DB 조회·비밀번호 비교(bcrypt)까지 가지 않는다
    expect(repository.findCredentialByEmployeeNo).toHaveBeenCalledTimes(LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
    // 한도가 찬 뒤에는 맞는 비밀번호도 막힌다
    await expect(service.login('2103003', PASSWORD, '10.0.0.1')).rejects.toMatchObject({ code: 'AUTH-003' });
  });

  it('IP 한도도 마찬가지다: 사원번호를 바꿔 한꺼번에 보내도 IP 한도(20번) 밖은 막힌다', async () => {
    const { service, repository, codeOf } = await setup();
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => service.login(`no-${i}`, 'wrong-password', '10.0.0.9')));
    const codes = results.map(codeOf);
    expect(codes.filter((code) => code === 'AUTH-001')).toHaveLength(20);
    expect(codes.filter((code) => code === 'AUTH-003')).toHaveLength(10);
    expect(repository.findCredentialByEmployeeNo).toHaveBeenCalledTimes(20);
  });

  it('맞는 비밀번호를 순서대로 보내면 몇 번이든 성공하고 기록이 남지 않는다', async () => {
    const { service, limiter } = await setup();
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_EMPLOYEE * 3; i++) await expect(service.login('2103003', PASSWORD, '10.0.0.1')).resolves.toMatchObject({ token: 'token' });
    expect(limiter.size()).toBe(0);
  });

  it('성공하면 그 사원번호가 앞서 틀린 기록이 지워진다', async () => {
    const { service } = await setup();
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1; i++) await expect(service.login('2103003', 'wrong-password', '10.0.0.1')).rejects.toMatchObject({ code: 'AUTH-001' });
    await expect(service.login('2103003', PASSWORD, '10.0.0.1')).resolves.toMatchObject({ token: 'token' });
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1; i++) await expect(service.login('2103003', 'wrong-password', '10.0.0.1')).rejects.toMatchObject({ code: 'AUTH-001' });
  });

  it('DB 오류 같은 서버 쪽 문제로 끝난 시도는 틀린 시도로 세지 않는다', async () => {
    const { service, limiter } = await setup(async () => {
      throw new Error('db down');
    });
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_EMPLOYEE * 3; i++) await expect(service.login('2103003', PASSWORD, '10.0.0.1')).rejects.toThrow('db down');
    expect(limiter.size()).toBe(0);
  });

  it('없는 사원·퇴사자도 틀린 시도로 센다', async () => {
    const { service } = await setup(async () => null);
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_EMPLOYEE; i++) await expect(service.login('9999999', 'x', '10.0.0.1')).rejects.toMatchObject({ code: 'AUTH-001' });
    await expect(service.login('9999999', 'x', '10.0.0.1')).rejects.toMatchObject({ code: 'AUTH-003' });
  });
});
