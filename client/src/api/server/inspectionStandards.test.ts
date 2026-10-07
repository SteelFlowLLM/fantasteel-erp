// 검사 기준 화면의 서버 모드 (api/server/inspectionStandards.ts): 서버 응답을 화면 모양으로 바꾸고, 강종 id는 코드로 맞춘다.
import type { InspectionStandardListItem } from '@fantasteel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputError } from '@/api/errors';
import { resetServerSessionForTest } from '@/api/http';
import { inspectionStandardApi, type InspectionStandardItemInput } from '@/api/inspectionStandards';
import { resetMasterIdCacheForTest } from '@/api/server/masterIds';
import { getMockDb } from '@/mock/db';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown) => json(200, { success: true, data });
const fail = (status: number, code: string, message: string) => json(status, { success: false, error: { code, message } });

let calls: Call[];

/** 로그인은 늘 성공시키고, 나머지 요청은 respond가 답한다 */
function useServer(respond: (call: Call) => Response) {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call: Call = { method: init.method ?? 'GET', path: url.replace(/^.*\/api\/v1/, ''), body: init.body ? JSON.parse(String(init.body)) : undefined };
    if (call.path === '/auth/login') return ok({});
    calls.push(call);
    return respond(call);
  });
}

const page = (items: InspectionStandardListItem[]) => ok({ items, page: 1, size: 100, total: items.length });
const mockGradeId = (code: string) => getMockDb().read((t) => t.steelGrade.find((g) => g.steelGradeCode === code)?.id ?? 0);

/** 서버 시드 id는 가짜 DB id와 다르다 (강종 SM355A = 902) */
function serverStandard(overrides: Partial<InspectionStandardListItem> = {}): InspectionStandardListItem {
  return {
    inspectionStandardId: 501,
    inspectionStandardCode: 'QS-SM355A-HR',
    versionNo: 1,
    processType: 'HOT_ROLLING',
    steelGradeId: 902,
    steelGradeCode: 'SM355A',
    createdAt: '2026-09-01T00:00:00.000Z',
    items: [
      {
        inspectionStandardItemId: 7001,
        inspectionItemCode: 'YIELD_STRENGTH',
        inspectionItemName: '항복강도',
        unit: 'N/mm²',
        minValue: '355.0000',
        maxValue: null,
        thicknessOverMm: null,
        thicknessUptoMm: '16.00',
        isRequired: true,
      },
      {
        inspectionStandardItemId: 7002,
        inspectionItemCode: 'YIELD_STRENGTH',
        inspectionItemName: '항복강도',
        unit: 'N/mm²',
        minValue: '345.0000',
        maxValue: null,
        thicknessOverMm: '16.00',
        thicknessUptoMm: '40.00',
        isRequired: true,
      },
    ],
    ...overrides,
  };
}

const buildItem = (overrides: Partial<InspectionStandardItemInput> = {}): InspectionStandardItemInput => ({
  inspectionItemCode: 'YIELD_STRENGTH',
  inspectionItemName: '항복강도',
  unit: 'N/mm²',
  minValue: '355',
  maxValue: '',
  minThicknessMm: '',
  maxThicknessMm: '16',
  isRequired: true,
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', 'server');
  resetMasterIdCacheForTest();
  actAs(SEED_EMPLOYEE_NO.quality);
  resetServerSessionForTest(SEED_EMPLOYEE_NO.quality);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('검사 기준 서버 모드: 조회', () => {
  it('목록은 공정으로 서버에서 거르고, 강종은 화면 id의 코드로 거른다. 강종 id는 화면 id로 바꾼다', async () => {
    const ss = serverStandard({ inspectionStandardId: 502, inspectionStandardCode: 'QS-SS275-HR', steelGradeId: 903, steelGradeCode: 'SS275' });
    useServer(() => page([serverStandard({ versionNo: 3 }), ss]));
    const rows = await inspectionStandardApi.list({ processType: 'HOT_ROLLING', steelGradeId: mockGradeId('SM355A') });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /inspection-standards?processType=HOT_ROLLING&page=1&size=100']);
    expect(rows).toEqual([
      {
        id: 501,
        inspectionStandardCode: 'QS-SM355A-HR',
        version: 3,
        processType: 'HOT_ROLLING',
        steelGradeId: mockGradeId('SM355A'),
        steelGradeCode: 'SM355A',
        itemCount: 2,
        versionCount: 3,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
  });

  it('목록이 100건을 넘으면 다음 쪽도 읽는다', async () => {
    useServer((c) =>
      c.path.includes('page=1')
        ? ok({ items: [serverStandard()], page: 1, size: 100, total: 2 })
        : ok({ items: [serverStandard({ inspectionStandardId: 502, inspectionStandardCode: 'QS-SS275-HR', steelGradeId: 903, steelGradeCode: 'SS275' })], page: 2, size: 100, total: 2 }),
    );
    expect((await inspectionStandardApi.list()).map((r) => r.inspectionStandardCode)).toEqual(['QS-SM355A-HR', 'QS-SS275-HR']);
    expect(calls).toHaveLength(2);
  });

  it('옛 버전 상세: 항목 두께 구간을 화면 이름으로 바꾸고, 버전 이력·판정한 검사 수는 상세 응답으로 채운다 (새 버전이 위)', async () => {
    const versions = [
      { inspectionStandardId: 501, versionNo: 1, createdAt: '2026-09-01T00:00:00.000Z', itemCount: 2, inspectionCount: 3 },
      { inspectionStandardId: 520, versionNo: 2, createdAt: '2026-10-01T00:00:00.000Z', itemCount: 0, inspectionCount: 0 },
    ];
    useServer((c) => (c.path === '/inspection-standards/501' ? ok({ ...serverStandard(), inspectionCount: 3, versions }) : fail(404, 'COM-003', '없음')));
    const detail = await inspectionStandardApi.get(501);
    // 목록을 다시 읽지 않는다 (버전 1이라 앞 버전도 없다)
    expect(calls.map((c) => c.path)).toEqual(['/inspection-standards/501']);
    expect(detail).toMatchObject({
      id: 501,
      version: 1,
      isCurrent: false,
      currentId: 520,
      versionCount: 2,
      steelGradeId: mockGradeId('SM355A'),
      standardNo: 'KS D 3515:2018',
      previousItems: null,
      inspectionCount: 3,
    });
    expect(detail?.items.map((i) => [i.id, i.minThicknessMm, i.maxThicknessMm, i.sortOrder])).toEqual([
      [7001, null, '16.00', 1],
      [7002, '16.00', '40.00', 2],
    ]);
    expect(detail?.versions.map((v) => [v.id, v.version, v.isCurrent, v.itemCount, v.inspectionCount])).toEqual([
      [520, 2, true, 0, 0],
      [501, 1, false, 2, 3],
    ]);
  });

  it('지금 버전 상세: 바로 앞 버전 항목(바뀐 항목 표시용)은 그 버전 상세에서 읽는다', async () => {
    const versions = [
      { inspectionStandardId: 501, versionNo: 1, createdAt: '2026-09-01T00:00:00.000Z', itemCount: 2, inspectionCount: 3 },
      { inspectionStandardId: 520, versionNo: 2, createdAt: '2026-10-01T00:00:00.000Z', itemCount: 0, inspectionCount: 0 },
    ];
    useServer((c) => {
      if (c.path === '/inspection-standards/520') return ok({ ...serverStandard({ inspectionStandardId: 520, versionNo: 2, items: [] }), inspectionCount: 0, versions });
      if (c.path === '/inspection-standards/501') return ok({ ...serverStandard(), inspectionCount: 3, versions });
      return fail(404, 'COM-003', '없음');
    });
    const detail = await inspectionStandardApi.get(520);
    expect(detail).toMatchObject({ id: 520, isCurrent: true, currentId: 520, inspectionCount: 0 });
    expect(detail?.previousItems?.map((i) => i.id)).toEqual([7001, 7002]);
  });

  it('없는 기준(COM-003)은 null', async () => {
    useServer(() => fail(404, 'COM-003', '검사 기준을 찾을 수 없어요'));
    await expect(inspectionStandardApi.get(999)).resolves.toBeNull();
  });
});

describe('검사 기준 서버 모드: 변경', () => {
  it('새 기준: 서버 강종 id는 검사 기준 목록의 같은 강종 코드에서 찾고, 항목은 서버 이름으로 보낸다', async () => {
    useServer((c) => {
      if (c.method === 'POST') return ok(serverStandard({ inspectionStandardId: 610, processType: 'STEELMAKING', inspectionStandardCode: 'QS-SM355A-ST' }));
      return page([serverStandard()]);
    });
    const id = await inspectionStandardApi.create({ processType: 'STEELMAKING', steelGradeId: mockGradeId('SM355A'), items: [buildItem({ minThicknessMm: '6' })] });
    expect(id).toBe(610);
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toEqual({
      method: 'POST',
      path: '/inspection-standards',
      body: {
        processType: 'STEELMAKING',
        steelGradeId: 902,
        items: [{ inspectionItemCode: 'YIELD_STRENGTH', inspectionItemName: '항복강도', unit: 'N/mm²', minValue: '355.0000', maxValue: null, thicknessOverMm: '6.00', thicknessUptoMm: '16.00', isRequired: true }],
      },
    });
  });

  it('검사 기준 목록에 없는 강종은 규격 목록(/items)에서 찾고, 거기도 없으면(권한 없음 포함) COM-003', async () => {
    useServer((c) => {
      if (c.path === '/items') return ok([{ id: 1, itemCode: 'X', steelGradeId: 904, steelGradeCode: 'SM355B' }]);
      if (c.method === 'POST') return ok(serverStandard({ inspectionStandardId: 611 }));
      return page([serverStandard()]);
    });
    await inspectionStandardApi.create({ processType: 'HOT_ROLLING', steelGradeId: mockGradeId('SM355B'), items: [buildItem()] });
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ steelGradeId: 904 });

    resetMasterIdCacheForTest();
    useServer((c) => (c.path === '/items' ? fail(403, 'COM-002', '권한이 없어요') : page([serverStandard()])));
    await expect(inspectionStandardApi.create({ processType: 'HOT_ROLLING', steelGradeId: mockGradeId('SS275'), items: [buildItem()] })).rejects.toMatchObject({ code: 'COM-003' });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('공통 기준과 잘못된 항목은 서버를 부르지 않고 입력 오류', async () => {
    useServer(() => page([]));
    const common = await inspectionStandardApi.create({ processType: 'HOT_ROLLING', steelGradeId: 'COMMON', items: [buildItem()] }).catch((e: unknown) => e);
    expect(common).toBeInstanceOf(InputError);
    expect((common as InputError).fieldErrors.steelGradeId).toContain('공통 기준');
    await expect(inspectionStandardApi.createVersion({ baseStandardId: 501, items: [] })).rejects.toBeInstanceOf(InputError);
    expect(calls).toHaveLength(0);
  });

  it('새 버전은 POST /:id/versions, 최신이 아니면 서버의 COM-001을 그대로 보인다', async () => {
    useServer((c) => (c.path === '/inspection-standards/501/versions' ? ok(serverStandard({ inspectionStandardId: 530, versionNo: 2 })) : fail(409, 'COM-001', '그 사이 새 버전이 만들어졌어요')));
    await expect(inspectionStandardApi.createVersion({ baseStandardId: 501, items: [buildItem({ minValue: '360' })] })).resolves.toBe(530);
    expect(calls[0].body).toMatchObject({ items: [{ minValue: '360.0000', thicknessUptoMm: '16.00' }] });
    await expect(inspectionStandardApi.createVersion({ baseStandardId: 400, items: [buildItem()] })).rejects.toMatchObject({ code: 'COM-001' });
  });

  it('삭제는 DELETE /:id로 모든 버전을 지우고, 검사가 쓴 기준이면 서버의 COM-004를 입력 오류로 보인다', async () => {
    useServer((c) =>
      c.path === '/inspection-standards/501'
        ? ok({ inspectionStandardCode: 'QS-SM355A-HR', deletedVersionNos: [1, 2] })
        : fail(400, 'COM-004', '검사 3건이 판정에 쓴 기준이라 삭제할 수 없어요 (QS-SS275-HR). 바꾸려면 새 버전으로 고쳐 주세요'),
    );
    await expect(inspectionStandardApi.remove(501)).resolves.toEqual({ inspectionStandardCode: 'QS-SM355A-HR', deletedVersions: [1, 2] });
    expect(calls[0].method).toBe('DELETE');
    const used = await inspectionStandardApi.remove(502).catch((e: unknown) => e);
    expect(used).toBeInstanceOf(InputError);
    expect((used as InputError).message).toContain('검사 3건');
  });
});
