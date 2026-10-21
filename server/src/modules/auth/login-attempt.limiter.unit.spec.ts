// 로그인 실패 횟수 제한 (이슈 #485): 사원번호별 5번·IP별 20번, 5분 창, 성공하면 사원번호 실패 삭제, 메모리 상한. DB 없음
import { LOGIN_FAIL_LIMIT_PER_EMPLOYEE, LOGIN_FAIL_LIMIT_PER_IP, LOGIN_FAIL_WINDOW_MS, LoginAttemptLimiter } from './login-attempt.limiter';

let now = 1_000_000;
const limiter = () => {
  const l = new LoginAttemptLimiter();
  l.clock = () => now;
  return l;
};
const fail = (l: LoginAttemptLimiter, employeeNo: string, ip = '10.0.0.1', times = 1) => {
  for (let i = 0; i < times; i++) l.recordFailure(employeeNo, ip);
};

beforeEach(() => {
  now = 1_000_000;
});

describe('LoginAttemptLimiter', () => {
  it('한 사원번호가 한도만큼 틀리면 AUTH-003(429), 한도 전까지는 받는다', () => {
    const l = limiter();
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1);
    expect(() => l.assertAllowed('2103003', '10.0.0.1')).not.toThrow();
    fail(l, '2103003');
    expect(() => l.assertAllowed('2103003', '10.0.0.1')).toThrow(expect.objectContaining({ code: 'AUTH-003', status: 429 }));
    // 다른 IP에서도 같은 사원번호는 막힌다 (사원번호가 기준)
    expect(() => l.assertAllowed('2103003', '10.0.0.9')).toThrow();
    // 다른 사원번호는 영향 없다
    expect(() => l.assertAllowed('2207005', '10.0.0.9')).not.toThrow();
  });

  it('사원번호는 대소문자·앞뒤 공백을 무시해 같은 키로 센다', () => {
    const l = limiter();
    for (const no of [' AB1 ', 'ab1', 'Ab1', 'aB1', 'AB1']) fail(l, no, `10.0.0.${no.length}`);
    expect(() => l.assertAllowed('ab1', '10.1.1.1')).toThrow();
  });

  it('한 IP가 사원번호를 바꿔 가며 한도만큼 틀리면 그 IP를 막는다', () => {
    const l = limiter();
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_IP; i++) l.recordFailure(`no-${i}`, '10.0.0.5');
    expect(() => l.assertAllowed('새사원', '10.0.0.5')).toThrow(expect.objectContaining({ code: 'AUTH-003' }));
    expect(() => l.assertAllowed('새사원', '10.0.0.6')).not.toThrow();
  });

  it('창(5분)이 지나면 다시 받는다: 실패가 하나씩 창 밖으로 나간다', () => {
    const l = limiter();
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
    expect(() => l.assertAllowed('2103003', '10.0.0.1')).toThrow();
    now += LOGIN_FAIL_WINDOW_MS - 1;
    expect(() => l.assertAllowed('2103003', '10.0.0.1')).toThrow();
    now += 2;
    expect(() => l.assertAllowed('2103003', '10.0.0.1')).not.toThrow();
  });

  it('성공하면 그 사원번호의 실패를 지우지만 IP의 실패는 남긴다', () => {
    const l = limiter();
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1);
    l.recordSuccess('2103003');
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE - 1);
    expect(() => l.assertAllowed('2103003', '10.0.0.1')).not.toThrow();
    // IP 실패는 그대로라 IP 한도에는 계속 쌓인다
    const ip = limiter();
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_IP - 1; i++) ip.recordFailure(`n${i}`, '10.0.0.7');
    ip.recordSuccess('n0');
    ip.recordFailure('nx', '10.0.0.7');
    expect(() => ip.assertAllowed('아무', '10.0.0.7')).toThrow();
  });

  it('IP를 모르면(undefined) 한 칸으로 묶어 센다', () => {
    const l = limiter();
    for (let i = 0; i < LOGIN_FAIL_LIMIT_PER_IP; i++) l.recordFailure(`n${i}`, undefined);
    expect(() => l.assertAllowed('아무', undefined)).toThrow();
  });

  it('없는 사원번호를 마구 보내도 기록해 두는 키 수에 상한이 있다', () => {
    const l = limiter();
    for (let i = 0; i < 12_000; i++) l.recordFailure(`ghost-${i}`, `10.${i % 250}.0.1`);
    expect(l.size()).toBeLessThanOrEqual(10_000 + 2);
  });

  it('reset은 모든 기록을 지운다', () => {
    const l = limiter();
    fail(l, '2103003', '10.0.0.1', LOGIN_FAIL_LIMIT_PER_EMPLOYEE);
    l.reset();
    expect(() => l.assertAllowed('2103003', '10.0.0.1')).not.toThrow();
  });
});
