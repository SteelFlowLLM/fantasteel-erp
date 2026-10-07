// 대시보드 출하 실적·공정별 수율·여재 보유 위젯(GET dashboard/widgets/shipment-result·process-yield·surplus-age)을 실제 앱과 DB(fs_sales)로 확인한다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { ProcessYieldWidget, ShipmentResultWidget, SurplusAgeWidget } from '@fantasteel/shared';
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

describe('GET dashboard/widgets/process-yield', () => {
  it('작업 실적 조회 권한이 있으면 공정 4개를 주고, 완료 실적이 없으면 수율은 비어 있다', async () => {
    const { status, body } = await get<ProcessYieldWidget>('/dashboard/widgets/process-yield', await login('1401006'));
    expect(status).toBe(200);
    expect(body.data.processes.map((p) => p.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING']);
    for (const p of body.data.processes) {
      expect(p.inputTon).toMatch(/^\d+\.\d{3}$/);
      if (p.resultCount === 0) expect(p).toMatchObject({ actualYieldRate: null, plannedYieldRate: null });
    }
    expect(body.data.processes[0]).toMatchObject({ actualYieldRate: null, plannedYieldRate: null });
  });

  it('작업 실적 조회 권한이 없으면 COM-002', async () => {
    const { body } = await get('/dashboard/widgets/process-yield', await login('1610014'));
    expect(body.error?.code).toBe('COM-002');
  });
});

describe('GET dashboard/widgets/surplus-age', () => {
  it('모든 사원이 읽고, 여재가 없으면 빈 목록과 0 t', async () => {
    const { status, body } = await get<SurplusAgeWidget>('/dashboard/widgets/surplus-age', await login('2304015'));
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ today: seoulToday() });
    expect(body.data.totalQty).toBe(body.data.items.reduce((s, r) => s + r.surplusQty, 0));
    expect(body.data.totalTon).toMatch(/^\d+\.\d{3}$/);
    for (const row of body.data.items) expect(row.surplusQty).toBeGreaterThan(0);
  });
});
