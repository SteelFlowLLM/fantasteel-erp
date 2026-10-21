// 로그인 실패 횟수 제한 (이슈 #485·#497): 사원번호별 5번·IP별 20번, 5분 창, 성공하면 사원번호 실패 삭제, 메모리 상한.
// 한도 확인과 자리 잡기를 한 번에 하므로 결과가 나오기 전의(확인 중인) 시도도 센다. DB 없음
import { LOGIN_FAIL_LIMIT_PER_EMPLOYEE, LOGIN_FAIL_LIMIT_PER_IP, LOGIN_FAIL_WINDOW_MS, LoginAttemptLimiter } from './login-attempt.limiter';

let now = 1_000_000;
const limiter = () => {
  const l = new LoginAttemptLimiter();
  l.clock = () => now;
  return l;
};
/** 틀린 시도를 times번 한다 */
const fail = (l: LoginAttemptLimiter, employeeNo: string, ip = '10.0.0.1', times = 1) => {
  for (let i = 0; i < times; i++) l.begin(employeeNo, ip).fail();
};
const allowed = (l: LoginAttemptLimiter, employeeNo: string, ip = '10.0.0.1') => l.begin(employeeNo, ip).cancel();

beforeEach(() => {
  now = 1_000_000;
});

describe('LoginAttemptLimiter', () => {
  it('한 사원번호가 한도만큼 틀리면 AUTH-003(429), 한도 전까지는 받는다', () => {
    const l = limiter();
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1);
    expect(() => allowed(l, '2103003')).not.toThrow();
    fail(l, '2103003');
    expect(() => l.begin('2103003', '10.0.0.1')).toThrow(expect.objectContaining({ code: 'AUTH-003', status: 429 }));
    // 다른 IP에서도 같은 사원번호는 막힌다 (사원번호가 기준)
    expect(() => l.begin('2103003', '10.0.0.9')).toThrow();
    // 다른 사원번호는 영향 없다
    expect(() => allowed(l, '2207005', '10.0.0.9')).not.toThrow();
  });

  it('동시에 보낸 요청: 결과가 나오기 전에도 시도 자리를 잡아서, 한도를 넘는 요청은 비밀번호를 확인하기 전에 막힌다 (이슈 #497)', () => {
    const l = limiter();
    // 비밀번호 확인(bcrypt)이 끝나기 전에 12개가 한꺼번에 들어온 상황: 아무도 succeed·fail을 부르지 않았다
    const results = Array.from({ length: 12 }, () => {
      try {
        return l.begin('2103003', '10.0.0.1');
      } catch (error) {
        return error;
      }
    });
    const accepted = results.filter((r) => !(r instanceof Error));
    const rejected = results.filter((r) => r instanceof Error);
    expect(accepted).toHaveLength(LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
    expect(rejected).toHaveLength(12 - LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
    expect(rejected.every((r) => (r as { code?: string }).code === 'AUTH-003')).toBe(true);
  });

  it('IP별 한도도 같다: 사원번호를 바꿔 한꺼번에 보내도 IP 한도 밖은 막힌다 (이슈 #497)', () => {
    const l = limiter();
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_IP; i++) l.begin(`no-${i}`, '10.0.0.5');
    expect(() => l.begin('새사원', '10.0.0.5')).toThrow(expect.objectContaining({ code: 'AUTH-003' }));
    expect(() => l.begin('새사원', '10.0.0.6')).not.toThrow();
  });

  it('막힌 요청은 시도로 세지 않는다: 막힌 뒤 계속 보내도 창이 지나면 풀린다', () => {
    const l = limiter();
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
    for (let i = 0; i < 20; i++) expect(() => l.begin('2103003', '10.0.0.1')).toThrow();
    now += LOGIN_FAIL_WINDOW_MS + 1;
    expect(() => allowed(l, '2103003')).not.toThrow();
  });

  it('사원번호는 대소문자·앞뒤 공백을 무시해 같은 키로 센다', () => {
    const l = limiter();
    for (const no of [' AB1 ', 'ab1', 'Ab1', 'aB1', 'AB1']) fail(l, no, `10.0.0.${no.length}`);
    expect(() => l.begin('ab1', '10.1.1.1')).toThrow();
  });

  it('한 IP가 사원번호를 바꿔 가며 한도만큼 틀리면 그 IP를 막는다', () => {
    const l = limiter();
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_IP; i++) fail(l, `no-${i}`, '10.0.0.5');
    expect(() => l.begin('새사원', '10.0.0.5')).toThrow(expect.objectContaining({ code: 'AUTH-003' }));
    expect(() => allowed(l, '새사원', '10.0.0.6')).not.toThrow();
  });

  it('창(5분)이 지나면 다시 받는다: 실패가 하나씩 창 밖으로 나간다', () => {
    const l = limiter();
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
    expect(() => l.begin('2103003', '10.0.0.1')).toThrow();
    now += LOGIN_FAIL_WINDOW_MS - 1;
    expect(() => l.begin('2103003', '10.0.0.1')).toThrow();
    now += 2;
    expect(() => allowed(l, '2103003')).not.toThrow();
  });

  it('성공하면 그 사원번호의 실패를 지우지만 IP의 실패는 남긴다', () => {
    const l = limiter();
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1);
    l.begin('2103003', '10.0.0.1').succeed();
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1);
    expect(() => allowed(l, '2103003')).not.toThrow();
    // IP 실패는 그대로라 IP 한도에는 계속 쌓인다
    const ip = limiter();
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_IP - 1; i++) fail(ip, `n${i}`, '10.0.0.7');
    ip.begin('n0', '10.0.0.7').succeed();
    fail(ip, 'nx', '10.0.0.7');
    expect(() => ip.begin('아무', '10.0.0.7')).toThrow();
  });

  it('성공한 시도 자체는 세지 않는다: IP 한도만큼 성공해도 막히지 않는다', () => {
    const l = limiter();
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_IP * 2; i++) l.begin(`ok-${i}`, '10.0.0.8').succeed();
    expect(() => allowed(l, '아무', '10.0.0.8')).not.toThrow();
    expect(l.size()).toBe(0);
  });

  it('성공해도 아직 확인 중인 다른 시도는 지우지 않는다 (그 시도가 틀리면 세어진다)', () => {
    const l = limiter();
    const others = Array.from({ length: LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1 }, () => l.begin('2103003', '10.0.0.2'));
    const mine = l.begin('2103003', '10.0.0.1');
    mine.succeed();
    // 확인 중인 4개가 자리를 차지하고 있다: 하나 더는 받고(5번째), 그다음은 막는다
    const fifth = l.begin('2103003', '10.0.0.3');
    expect(() => l.begin('2103003', '10.0.0.3')).toThrow();
    fifth.cancel();
    others.forEach((attempt) => attempt.fail());
    fail(l, '2103003', '10.0.0.3');
    expect(() => l.begin('2103003', '10.0.0.3')).toThrow();
  });

  it('cancel: 결과를 정하지 못한 시도(서버 오류)는 세지 않는다. 틀렸거나 성공한 뒤에는 아무 일도 하지 않는다', () => {
    const l = limiter();
    for (let i = 0; i < 20; i++) l.begin('2103003', '10.0.0.1').cancel();
    expect(l.size()).toBe(0);
    const failed = l.begin('2103003', '10.0.0.1');
    failed.fail();
    failed.cancel();
    failed.succeed();
    // fail 뒤 succeed·cancel은 무시된다: 실패 1번이 남아 있다
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 2);
    expect(() => allowed(l, '2103003')).not.toThrow();
    fail(l, '2103003');
    expect(() => l.begin('2103003', '10.0.0.1')).toThrow();
    const done = limiter();
    const ok = done.begin('2103003', '10.0.0.1');
    ok.succeed();
    ok.fail();
    expect(done.size()).toBe(0);
  });

  it('IP를 모르면(undefined) 한 칸으로 묶어 센다', () => {
    const l = limiter();
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_IP; i++) l.begin(`n${i}`, undefined).fail();
    expect(() => l.begin('아무', undefined)).toThrow();
    expect(() => l.begin('아무', '10.0.0.1')).not.toThrow();
  });

  it('없는 사원번호를 마구 보내도 기록해 두는 키 수에 상한이 있다', () => {
    const l = limiter();
    // IP도 모두 다르다(한 IP에서 보내면 IP 한도에서 먼저 막힌다)
    for (let i = 0; i < 12_000; i++) fail(l, `ghost-${i}`, `10.${i >> 8}.${i & 255}.1`);
    expect(l.size()).toBeLessThanOrEqual(10_000 + 2);
  });

  it('reset은 모든 기록을 지운다', () => {
    const l = limiter();
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
    l.reset();
    expect(() => allowed(l, '2103003')).not.toThrow();
  });
});
