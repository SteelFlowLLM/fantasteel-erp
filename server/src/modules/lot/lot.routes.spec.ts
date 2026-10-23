// GET lots?withLinks=true 쿼리 변환 (이슈 #498): 문자열 'true'가 불리언으로 바뀌어 줄마다 연결 값이 붙고, 'false'·생략이면 붙지 않으며,
// 그 밖의 값은 400이다. 서비스 단위 시험으로는 ValidationPipe의 변환을 볼 수 없어 실제 앱을 띄워 HTTP로 부른다 (실제 DB fs_log).
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { LOT_NO_FILTER_MAX } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

let app: INestApplication;
let baseUrl: string;
let cookie: string;
let lotId: number;
let resultId: number;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employeeNo: '1503001', password: process.env.SEED_PASSWORD! }),
  });
  if (!login.ok) throw new Error(`로그인 실패 (HTTP ${login.status})`);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

  const prisma = app.get(PrismaService);
  const grade = await prisma.steelGrade.findFirstOrThrow({ orderBy: { id: 'asc' } });
  resultId = (await prisma.productionResult.create({ data: { processType: 'STEELMAKING', converterCode: 'BOF1', startedAt: new Date(), completedAt: new Date() } })).id;
  lotId = (await prisma.lot.create({ data: { lotNo: 'LR-HEAT-1', lotType: 'HEAT', steelGradeId: grade.id, productionResultId: resultId } })).id;
}, 60_000);

afterAll(async () => {
  const prisma = app.get(PrismaService);
  await prisma.lot.deleteMany({ where: { id: lotId } });
  await prisma.productionResult.deleteMany({ where: { id: resultId } });
  await app?.close();
});

const get = async (path: string) => {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as { success: boolean; data: { items: Record<string, unknown>[] }; error?: { code: string } } };
};

describe('LOT 목록 쿼리 (GET lots)', () => {
  it('withLinks=true면 줄마다 연결 값(상위 히트·불합격 처리·배정·원료 종류)이 붙는다', async () => {
    const { status, body } = await get('/lots?lotNo=LR-HEAT&withLinks=true');
    expect(status).toBe(200);
    expect(body.data.items).toEqual([expect.objectContaining({ id: lotId, lotNo: 'LR-HEAT-1', heat: null, disposition: null, allocation: null, rawMaterialType: null })]);
  });

  it('withLinks=false나 생략이면 붙지 않는다', async () => {
    for (const query of ['&withLinks=false', '']) {
      const { status, body } = await get(`/lots?lotNo=LR-HEAT${query}`);
      expect(status).toBe(200);
      expect(body.data.items).toHaveLength(1);
      expect('heat' in body.data.items[0]).toBe(false);
    }
  });

  it('withLinks가 true·false가 아니면 400, lotNo가 상한을 넘으면 400', async () => {
    expect((await get('/lots?withLinks=yes')).status).toBe(400);
    expect((await get(`/lots?lotNo=${'X'.repeat(LOT_NO_FILTER_MAX + 1)}`)).status).toBe(400);
    expect((await get(`/lots?lotNo=${'X'.repeat(LOT_NO_FILTER_MAX)}`)).status).toBe(200);
  });
});
