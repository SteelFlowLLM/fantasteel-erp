// 로그인·로그아웃·내 정보 (REQ-AUTH-001, BP-AUTH-01)를 실제 앱과 DB(fs_common)로 확인한다 (auth.md 7장: 성공·실패·퇴사 계정).
// 쿠키·가드·입력 검증까지 보려고 HTTP로 부른다. 사원은 시드(seed.md)를 쓴다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { LOGIN_FAIL_LIMIT_PER_EMPLOYEE, LoginAttemptLimiter } from './login-attempt.limiter';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;

const PASSWORD = process.env.SEED_PASSWORD!;
/** 구매 사원 정다은 */
const PURCHASE = '2207005';
/** 물류 사원 권예진: 퇴사 처리를 시험하고 되돌린다 */
const LOGISTICS = '2304015';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

async function login(employeeNo: string, password: string) {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password }) });
  return { status: res.status, setCookie: res.headers.get('set-cookie'), body: (await res.json()) as Envelope<AuthUser> };
}

async function call<T>(method: 'GET' | 'POST', path: string, cookie?: string) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: cookie ? { cookie } : {} });
  return { status: res.status, setCookie: res.headers.get('set-cookie'), body: (await res.json()) as Envelope<T> };
}

const cookieOf = (setCookie: string | null) => (setCookie ?? '').split(';')[0];

const setActive = (employeeNo: string, isActive: boolean) => prisma.employee.update({ where: { employeeNo }, data: { isActive } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
}, 60_000);

afterAll(async () => {
  // 같은 DB를 쓰는 다음 테스트 파일을 위해 퇴사 처리를 되돌린다
  if (prisma) await setActive(LOGISTICS, true);
  await app?.close();
});

describe('로그인 (POST /auth/login)', () => {
  it('성공: 내 정보를 돌려주고 토큰은 httpOnly 쿠키로만 준다. 그 쿠키로 /auth/me를 읽는다', async () => {
    const res = await login(PURCHASE, PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ employeeNo: PURCHASE, employeeName: '정다은', roleCode: 'PURCHASE' });
    expect(JSON.stringify(res.body)).not.toContain('token');
    expect(res.setCookie).toMatch(/^access_token=[^;]+;/);
    expect(res.setCookie).toMatch(/HttpOnly/i);

    const me = await call<AuthUser>('GET', '/auth/me', cookieOf(res.setCookie));
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ employeeNo: PURCHASE, employeeId: res.body.data.employeeId });
  });

  it('실패: 틀린 비밀번호와 없는 사원번호는 같은 AUTH-001(401)이고 쿠키를 주지 않는다', async () => {
    const wrongPassword = await login(PURCHASE, `${PASSWORD}-wrong`);
    const unknownEmployee = await login('9999999', PASSWORD);

    for (const res of [wrongPassword, unknownEmployee]) {
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('AUTH-001');
      expect(res.setCookie).toBeNull();
    }
    // 어느 쪽이 틀렸는지 알려 주지 않는다 (사원번호 존재 여부가 드러나지 않게)
    expect(wrongPassword.body.error?.message).toBe(unknownEmployee.body.error?.message);
  });

  it('실패 횟수 제한: 같은 사원번호로 5번 틀리면 맞는 비밀번호도 AUTH-003(429)이고, 다른 사원은 영향이 없다 (이슈 #485)', async () => {
    const limiter = app.get(LoginAttemptLimiter);
    limiter.reset();
    try {
      for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_EMPLOYEE; i++) expect((await login(PURCHASE, `${PASSWORD}-wrong`)).body.error?.code).toBe('AUTH-001');
      const blocked = await login(PURCHASE, PASSWORD);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error?.code).toBe('AUTH-003');
      expect(blocked.setCookie).toBeNull();
      // 다른 사원은 로그인된다
      expect((await login(LOGISTICS, PASSWORD)).status).toBe(200);
      // 막힌 뒤 창이 지나면(여기서는 기록 비우기) 다시 된다
      limiter.reset();
      expect((await login(PURCHASE, PASSWORD)).status).toBe(200);
    } finally {
      limiter.reset();
    }
  });

  it('동시에 보낸 틀린 요청도 한도를 넘지 못한다: 한도 밖은 비밀번호 확인 없이 AUTH-003 (이슈 #497)', async () => {
    const limiter = app.get(LoginAttemptLimiter);
    limiter.reset();
    try {
      const total = LOGIN_FAIL_LIMIT_PER_EMPLOYEE + 7;
      const results = await Promise.all(Array.from({ length: total }, () => login(PURCHASE, `${PASSWORD}-wrong`)));
      const codes = results.map((r) => r.body.error?.code);
      expect(codes.filter((code) => code === 'AUTH-001')).toHaveLength(LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
      expect(codes.filter((code) => code === 'AUTH-003')).toHaveLength(7);
      expect((await login(PURCHASE, PASSWORD)).status).toBe(429);
    } finally {
      limiter.reset();
    }
  });

  it('성공하면 그 사원번호의 실패 횟수가 지워진다', async () => {
    const limiter = app.get(LoginAttemptLimiter);
    limiter.reset();
    try {
      for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1; i++) await login(PURCHASE, `${PASSWORD}-wrong`);
      expect((await login(PURCHASE, PASSWORD)).status).toBe(200);
      for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1; i++) expect((await login(PURCHASE, `${PASSWORD}-wrong`)).body.error?.code).toBe('AUTH-001');
      expect((await login(PURCHASE, PASSWORD)).status).toBe(200);
    } finally {
      limiter.reset();
    }
  });

  it('없는 사원번호도 비밀번호 비교(bcrypt)를 해서 응답 시간으로 사원번호가 있는지 알 수 없다', async () => {
    const limiter = app.get(LoginAttemptLimiter);
    limiter.reset();
    const timeOf = async (employeeNo: string) => {
      const started = process.hrtime.bigint();
      await login(employeeNo, `${PASSWORD}-wrong`);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    try {
      await timeOf(PURCHASE); // 첫 요청의 연결·준비 시간은 뺀다
      const known: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < 3; i++) {
        known.push(await timeOf(PURCHASE));
        unknown.push(await timeOf(`9${i}99999`));
        limiter.reset();
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      // bcrypt(비용 10)은 수십 ms라 건너뛰면 몇 ms로 끝난다. 없는 사원도 있는 사원의 절반 이상은 걸려야 한다
      expect(mean(unknown)).toBeGreaterThan(mean(known) * 0.5);
    } finally {
      limiter.reset();
    }
  });

  it('퇴사 계정: 비밀번호가 맞아도 AUTH-001, 퇴사 전에 받은 쿠키도 더는 통하지 않는다(AUTH-002)', async () => {
    const before = await login(LOGISTICS, PASSWORD);
    expect(before.status).toBe(200);
    const cookie = cookieOf(before.setCookie);

    await setActive(LOGISTICS, false);
    try {
      const res = await login(LOGISTICS, PASSWORD);
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('AUTH-001');

      const me = await call<AuthUser>('GET', '/auth/me', cookie);
      expect(me.status).toBe(401);
      expect(me.body.error?.code).toBe('AUTH-002');
    } finally {
      await setActive(LOGISTICS, true);
    }
  });

  it('입력 형식이 틀리면 COM-004(400)', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo: PURCHASE }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope<null>).error?.code).toBe('COM-004');
  });
});

describe('로그인 필요·로그아웃', () => {
  it('쿠키 없이 /auth/me를 부르면 AUTH-002(401)', async () => {
    const me = await call<AuthUser>('GET', '/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error?.code).toBe('AUTH-002');
  });

  it('로그아웃하면 쿠키를 지우라고 응답한다', async () => {
    const cookie = cookieOf((await login(PURCHASE, PASSWORD)).setCookie);
    const res = await call<null>('POST', '/auth/logout', cookie);
    expect(res.status).toBe(200);
    expect(res.setCookie).toMatch(/^access_token=;/);
  });
});
