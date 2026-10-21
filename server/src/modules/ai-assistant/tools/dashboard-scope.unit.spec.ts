// 대시보드 도구의 위젯별 권한 (이슈 #506). 도구 이름 단위로 "권한 목록 중 하나라도 있으면" 통과시키면
// 출하 실적 권한만 있는 사원이 공정별 수율을 읽거나, 그 숫자가 담긴 사내 채팅 AI 답이 수율 권한이 없는 멤버에게 보인다.
import { ROLE, type AuthUser, type Permission } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AiAssistantRepository } from '../ai-assistant.repository';
import { AssistantToolbox } from './assistant-toolbox';
import { DASHBOARD_TOOL_WIDGETS, DASHBOARD_WIDGET_PERMISSIONS } from './dashboard.tool';

const user = (permissions: Partial<Record<Permission, 'VIEW' | 'USE'>>): AuthUser => ({ employeeId: 1, employeeNo: '0000001', employeeName: '사원', roleCode: ROLE.SALES, departmentId: 1, jobGradeId: 1, headDepartmentIds: [], permissions });

const calls: string[] = [];
const dashboard = {
  processFlow: async () => {
    calls.push('process_flow');
    return { today: '2026-10-22', salesOrders: null, productionPlans: null, inspections: null, inventories: { slabAvailableQty: 1, coilAvailableQty: 2 }, shipmentRequests: null, goodsIssues: null };
  },
  shipmentResult: async () => {
    calls.push('shipment_result');
    return { from: '2026-09-23', to: '2026-10-22', days: 30, issuedRequestCount: 0, totalSlabQty: 0, totalCoilQty: 0, totalTon: '0.000', series: [] };
  },
  processYield: async () => {
    calls.push('process_yield');
    return { processes: [] };
  },
  surplusAge: async () => {
    calls.push('surplus_age');
    return { today: '2026-10-22', totalQty: 0, totalTon: '0.000', maxAgeDays: null, items: [] };
  },
};
const rolesAsked: unknown[] = [];

// 대시보드 도구만 쓰는 시험이라 다른 service는 비워 둔다 (대시보드 앞 13개, 뒤 10개)
const N = {} as never;
const toolboxWith = (dashboardService: unknown, roles: AuthUser['roleCode'][]) =>
  new AssistantToolbox(
    {} as PrismaService,
    {
      findRoleCodesWithAnyPermission: async (_tx: unknown, permissions: unknown) => {
        rolesAsked.push(permissions);
        return roles;
      },
    } as unknown as AiAssistantRepository,
    N, N, N, N, N, N, N, N, N, N, N, N, N,
    dashboardService as never,
    N, N, N, N, N, N, N, N, N, N,
  );
const box = toolboxWith(dashboard, [ROLE.PRODUCTION, ROLE.ADMIN]);

const run = (u: AuthUser, widget: string | undefined) => box.run(u, { id: 'c1', name: 'get_dashboard_summary', arguments: JSON.stringify(widget === undefined ? {} : { widget }) });
const outcome = (result: Awaited<ReturnType<typeof run>>) => (JSON.parse(result.content) as { 오류?: string }).오류;

beforeEach(() => {
  calls.length = 0;
  rolesAsked.length = 0;
});

describe('위젯마다 화면 권한을 따로 본다', () => {
  it('위젯 권한표: 공정 흐름·여재 보유는 모든 사원, 출하 실적은 출고 확정, 공정별 수율은 작업 실적 확정', () => {
    expect(DASHBOARD_WIDGET_PERMISSIONS).toEqual({
      process_flow: [],
      shipment_result: ['GOODS_ISSUE_CONFIRM'],
      process_yield: ['PRODUCTION_RESULT_CONFIRM'],
      surplus_age: [],
    });
    expect(Object.keys(DASHBOARD_WIDGET_PERMISSIONS).sort()).toEqual([...DASHBOARD_TOOL_WIDGETS].sort());
  });

  it('출하 실적 권한만 있으면 공정별 수율은 service를 부르지 않고 막힌다 (권한 목록 중 하나만 있어도 열리던 문제)', async () => {
    const shipmentOnly = user({ GOODS_ISSUE_CONFIRM: 'VIEW' });
    const denied = await run(shipmentOnly, 'process_yield');
    expect(outcome(denied)).toBe('권한 없음');
    expect(denied.source).toBeNull();
    expect(calls).toEqual([]);
    // 필요한 권한은 이 위젯의 것(공정 실적)만 말한다. 출고 확정은 이미 있는 권한이다
    expect(JSON.parse(denied.content).안내).toContain("'공정 실적(실적 시뮬레이션 포함)' 조회 권한이 필요해요");
    expect(JSON.parse(denied.content).안내).not.toContain("'출고 확정'");
    expect(rolesAsked.at(-1)).toEqual(['PRODUCTION_RESULT_CONFIRM']);

    const allowed = await run(shipmentOnly, 'shipment_result');
    expect(outcome(allowed)).toBeUndefined();
    expect(calls).toEqual(['shipment_result']);
  });

  it('작업 실적 확정 권한만 있으면 출하 실적이 막힌다', async () => {
    const yieldOnly = user({ PRODUCTION_RESULT_CONFIRM: 'VIEW' });
    expect(outcome(await run(yieldOnly, 'shipment_result'))).toBe('권한 없음');
    expect(outcome(await run(yieldOnly, 'process_yield'))).toBeUndefined();
    expect(calls).toEqual(['process_yield']);
  });

  it('공정 흐름 현황·여재 보유 기간은 권한이 하나도 없어도 본다', async () => {
    const nobody = user({});
    expect(outcome(await run(nobody, 'process_flow'))).toBeUndefined();
    expect(outcome(await run(nobody, 'surplus_age'))).toBeUndefined();
    expect(calls).toEqual(['process_flow', 'surplus_age']);
  });

  it('출처 id에 위젯이 붙는다: 위젯마다 따로 출처로 남는다', async () => {
    const both = user({ GOODS_ISSUE_CONFIRM: 'VIEW', PRODUCTION_RESULT_CONFIRM: 'VIEW' });
    expect((await run(both, 'process_yield')).source).toEqual({ kind: 'DATA', id: 'get_dashboard_summary:process_yield', label: '대시보드 · 공정별 수율' });
    expect((await run(both, 'shipment_result')).source?.id).toBe('get_dashboard_summary:shipment_result');
  });

  it('위젯을 빠뜨리거나 모르는 위젯이면 권한을 따지지 않고 도구 모음이 바로 인자 오류로 돌려준다 (service·도구를 부르지 않는다)', async () => {
    const nobody = user({});
    const missing = await run(nobody, undefined);
    expect(outcome(missing)).toBe('widget 값이 필요해요 (process_flow, shipment_result, process_yield, surplus_age)');
    expect(missing.source).toBeNull();
    expect(outcome(await run(nobody, 'order_fulfillment'))).toBe('widget 값은 process_flow, shipment_result, process_yield, surplus_age 중 하나예요');
    // 객체 기본 속성 이름(constructor·toString)도 모르는 값이다
    expect(outcome(await run(nobody, 'constructor'))).toContain('중 하나예요');
    expect(outcome(await run(nobody, 'toString'))).toContain('중 하나예요');
    expect(outcome(await run(user({ GOODS_ISSUE_CONFIRM: 'VIEW' }), 'process_yield_x'))).toContain('중 하나예요');
    // 위젯 값이 문자열이 아니어도 같다
    const notString = await box.run(nobody, { id: 'c1', name: 'get_dashboard_summary', arguments: '{"widget":7}' });
    expect(outcome(notString)).toContain('widget 값은');
    expect(rolesAsked).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('service가 COM-002를 던져도 이 위젯의 권한으로 안내한다 (도구 모음 확인을 지난 뒤의 이중 확인)', async () => {
    const throwing = {
      ...dashboard,
      processYield: async () => {
        throw new AppException('COM-002');
      },
    };
    const guarded = toolboxWith(throwing, [ROLE.PRODUCTION]);
    const result = await guarded.run(user({ PRODUCTION_RESULT_CONFIRM: 'VIEW' }), { id: 'c1', name: 'get_dashboard_summary', arguments: '{"widget":"process_yield"}' });
    expect(JSON.parse(result.content).오류).toBe('권한 없음');
  });
});

describe('사내 채팅 AI 답을 멤버에게 보일지 (canViewAll)', () => {
  const shipmentOnly = user({ GOODS_ISSUE_CONFIRM: 'VIEW' });
  const yieldOnly = user({ PRODUCTION_RESULT_CONFIRM: 'VIEW' });
  const nobody = user({});
  const both = user({ GOODS_ISSUE_CONFIRM: 'USE', PRODUCTION_RESULT_CONFIRM: 'VIEW' });

  it('위젯의 권한이 있는 멤버에게만 그 위젯 숫자가 보인다', () => {
    expect(box.canViewAll(shipmentOnly, ['get_dashboard_summary:shipment_result'])).toBe(true);
    expect(box.canViewAll(shipmentOnly, ['get_dashboard_summary:process_yield'])).toBe(false);
    expect(box.canViewAll(yieldOnly, ['get_dashboard_summary:process_yield'])).toBe(true);
    expect(box.canViewAll(yieldOnly, ['get_dashboard_summary:shipment_result'])).toBe(false);
  });

  it('공정 흐름·여재 보유 숫자는 권한 없는 멤버에게도 보인다 (모든 사원이 보는 위젯)', () => {
    expect(box.canViewAll(nobody, ['get_dashboard_summary:process_flow'])).toBe(true);
    expect(box.canViewAll(nobody, ['get_dashboard_summary:surplus_age'])).toBe(true);
    expect(box.canViewAll(nobody, ['get_dashboard_summary:process_yield'])).toBe(false);
  });

  it('여러 출처가 섞이면 모두 볼 수 있어야 한다', () => {
    expect(box.canViewAll(shipmentOnly, ['get_dashboard_summary:process_flow', 'get_dashboard_summary:shipment_result'])).toBe(true);
    expect(box.canViewAll(shipmentOnly, ['get_dashboard_summary:process_flow', 'get_dashboard_summary:process_yield'])).toBe(false);
    expect(box.canViewAll(both, ['get_dashboard_summary:shipment_result', 'get_dashboard_summary:process_yield'])).toBe(true);
  });

  it('위젯이 없는 옛 출처(get_dashboard_summary)는 모든 위젯을 볼 수 있어야 한다', () => {
    expect(box.canViewAll(shipmentOnly, ['get_dashboard_summary'])).toBe(false);
    expect(box.canViewAll(nobody, ['get_dashboard_summary'])).toBe(false);
    expect(box.canViewAll(both, ['get_dashboard_summary'])).toBe(true);
  });

  it('모르는 위젯·모르는 도구는 볼 수 없다고 본다', () => {
    expect(box.canViewAll(both, ['get_dashboard_summary:nothing'])).toBe(false);
    expect(box.canViewAll(both, ['get_dashboard_summary:constructor'])).toBe(false);
    expect(box.canViewAll(both, ['없는_도구'])).toBe(false);
  });
});
