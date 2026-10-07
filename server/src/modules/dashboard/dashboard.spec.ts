// 대시보드 출하 실적 위젯(GET dashboard/widgets/shipment-result)을 실제 앱과 DB(fs_sales)로 확인한다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { ShipmentResultWidget } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { seoulToday } from '../../common/time/seoul-date';

let app: INestApplication;
let baseUrl: string;

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }) });
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function get<T>(path: string, cookie: string) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as { data: T; error?: { code: string } } };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('GET dashboard/widgets/shipment-result', () => {
  it('출고 확정 권한이 있으면 오늘 포함 최근 30일을 하루 단위로 준다', async () => {
    const { status, body } = await get<ShipmentResultWidget>('/dashboard/widgets/shipment-result', await login('1610014'));
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ to: seoulToday(), days: 30 });
    expect(body.data.series).toHaveLength(30);
    expect(body.data.series[0].date).toBe(body.data.from);
    expect(body.data.series.at(-1)?.date).toBe(seoulToday());
    expect(body.data.totalTon).toMatch(/^\d+\.\d{3}$/);
  });

  it('출고 확정 권한이 없으면 COM-002', async () => {
    const { body } = await get('/dashboard/widgets/shipment-result', await login('1709007'));
    expect(body.error?.code).toBe('COM-002');
  });
});
