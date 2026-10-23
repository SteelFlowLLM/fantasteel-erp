// 경로 충돌 방지: GET /lots/rejected(quality)가 lot 모듈의 GET /lots/:id보다 먼저 잡혀야 한다.
// Nest는 모듈을 import한 순서로 경로를 등록하므로, app.module에서 QualityModule이 LotModule 앞에 있어야 한다.
// 서비스 단위 테스트로는 경로 등록 순서를 볼 수 없어 실제 앱을 띄워 HTTP로 부른다 (실제 DB fs_prod).
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../../app.module';

let app: INestApplication;
let baseUrl: string;
let cookie: string;

/** main.ts와 같은 전역 설정으로 띄운다 (prefix가 다르면 경로 비교가 의미 없다) */
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;

  // 품질 담당 (seed.md): 불합격 LOT 목록 권한(INSPECTION_REGISTER VIEW·DISPOSITION_SET)이 있다
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employeeNo: '2205013', password: process.env.SEED_PASSWORD ?? 'fantasteel' }),
  });
  if (!login.ok) throw new Error(`로그인 실패 (HTTP ${login.status})`);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
}, 60_000);

afterAll(async () => {
  await app?.close();
});

const get = async (path: string) => {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: unknown; error?: { code: string } } };
};

describe('불합격 LOT 목록 경로 (API-123, 품질 모듈 ↔ lot 모듈)', () => {
  it('GET /lots/rejected는 불합격 LOT 목록(페이지)을 준다 — lots/:id의 정수 변환에 걸리지 않는다', async () => {
    const { status, body } = await get('/lots/rejected');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ items: expect.any(Array), page: 1, total: expect.any(Number) });
  });

  it('GET /lots/:id는 그대로 lot 모듈이 받는다 (없는 LOT이면 COM-003)', async () => {
    const { body } = await get('/lots/2000000000');
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('COM-003');
  });
});
