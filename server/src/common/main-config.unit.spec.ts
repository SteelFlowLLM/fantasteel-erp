// main.ts의 운영 설정이 빠지지 않게 지킨다 (이슈 #485): 종료 훅, 루프백 proxy 신뢰. 서버를 띄우지 않는 문자열 확인이다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');

describe('main.ts 운영 설정', () => {
  it('종료 신호에 모듈 종료 훅(일꾼·소켓·DB 연결 정리)이 돌도록 enableShutdownHooks를 켠다', () => {
    expect(main).toMatch(/app\.enableShutdownHooks\(\)/);
  });

  it('같은 서버의 프록시(루프백)가 준 X-Forwarded-For만 믿는다: 로그인 실패 제한이 사용자 IP로 센다', () => {
    expect(main).toMatch(/app\.set\('trust proxy', 'loopback'\)/);
  });
});
