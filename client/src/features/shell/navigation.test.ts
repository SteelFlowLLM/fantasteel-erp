import { describe, expect, it } from 'vitest';
import { PERMISSIONS, type Permission, type PermissionLevel, type RoleCode } from '@/codes';
import { activeNavHref, buildNavigation, type NavEntry } from '@/features/shell/navigation';
import { routeTitleOf } from '@/features/shell/routeTitles';
import { canOpenScreen, screenOfPath, type AccessUser } from '@/features/shell/screens';
import type { PermissionMap } from '@/lib/permissions';
import { SEED_ROLE_PERMISSIONS } from '@/mock/seed';

function permissionsOf(roleCode: RoleCode): PermissionMap {
  const { use, view } = SEED_ROLE_PERMISSIONS[roleCode];
  const map: PermissionMap = {};
  for (const p of view) map[p] = 'VIEW';
  for (const p of use) map[p] = 'USE';
  return map;
}

const hrefs = (entries: NavEntry[]) => entries.flatMap((e) => (e.kind === 'item' ? [e.href] : []));

/** '다른 영역 화면' 구분선과 '공통' 구분선 사이의 메뉴 */
function otherAreaHrefs(entries: NavEntry[]): string[] {
  const start = entries.findIndex((e) => e.kind === 'separator' && e.key === 'other-areas');
  if (start < 0) return [];
  const end = entries.findIndex((e) => e.kind === 'separator' && e.key === 'common');
  return hrefs(entries.slice(start + 1, end));
}

const navOf = (roleCode: RoleCode, headDepartmentIds: number[] = []) =>
  buildNavigation({ roleCode, permissions: permissionsOf(roleCode), headDepartmentIds });

describe('buildNavigation', () => {
  it('영업: 대시보드 · 수주 · 등록 · 출하요청 · 재고 + 공통', () => {
    const nav = hrefs(navOf('SALES'));
    expect(nav.slice(0, 5)).toEqual(['/dashboard', '/sales-orders', '/sales-orders/new', '/shipment-requests', '/inventories']);
    expect(nav).not.toContain('/approvals');
    expect(nav.slice(-7)).toEqual(['/lots/trace', '/business-events', '/tasks', '/messenger', '/agent', '/meetings', '/past-cases']);
  });

  it('다른 영역의 조회 권한 화면은 구분선 뒤에 영역 순서로 붙는다 (seed-assumptions 2-2 표)', () => {
    expect(otherAreaHrefs(navOf('SALES'))).toEqual(['/production/plans', '/goods-issues', '/mill-sheets']);
    expect(otherAreaHrefs(navOf('PURCHASE'))).toEqual(['/production/plans']);
    expect(otherAreaHrefs(navOf('PRODUCTION'))).toEqual(['/sales-orders', '/mrp', '/purchase-requisitions', '/quality/inspections']);
    expect(otherAreaHrefs(navOf('QUALITY'))).toEqual(['/production/results', '/mill-sheets']);
    expect(otherAreaHrefs(navOf('LOGISTICS'))).toEqual(['/shipment-requests']);
  });

  it('관리자: 사원 · 부서·직급·권한 · 기준정보, 그 뒤에 조회 권한으로 여는 14개 화면과 재고', () => {
    const all: PermissionMap = Object.fromEntries(PERMISSIONS.map((p: Permission): [Permission, PermissionLevel] => [p, 'VIEW']));
    const nav = buildNavigation({ roleCode: 'ADMIN', permissions: { ...all, ...permissionsOf('ADMIN') }, headDepartmentIds: [] });
    expect(hrefs(nav).slice(0, 4)).toEqual(['/dashboard', '/admin/employees', '/admin/organization', '/admin/master-data']);
    expect(otherAreaHrefs(nav)).toEqual([
      '/sales-orders',
      '/shipment-requests',
      '/mrp',
      '/purchase-requisitions',
      '/purchase-orders',
      '/goods-receipts',
      '/production/plans',
      '/production/results',
      '/production/rolling',
      '/quality/inspections',
      '/quality/rejected',
      '/quality/standards',
      '/goods-issues',
      '/mill-sheets',
      '/inventories',
    ]);
    // 등록 화면은 사용 권한이 있어야 메뉴에 나온다
    expect(hrefs(nav)).not.toContain('/sales-orders/new');
  });

  it('권한이 없으면 그 메뉴를 숨기고, 다른 영역 권한이 없으면 구분선도 없다', () => {
    const permissions: PermissionMap = { ...permissionsOf('PURCHASE') };
    delete permissions.PURCHASE_ORDER_CONFIRM;
    delete permissions.PRODUCTION_PLAN_CONFIRM;
    const nav = buildNavigation({ roleCode: 'PURCHASE', permissions, headDepartmentIds: [] });
    expect(hrefs(nav)).toContain('/mrp');
    expect(hrefs(nav)).not.toContain('/purchase-orders');
    expect(nav.some((e) => e.kind === 'separator' && e.key === 'other-areas')).toBe(false);
  });

  it('승인함은 부서장에게만 보인다', () => {
    expect(hrefs(navOf('PURCHASE', [2]))).toContain('/approvals');
    expect(hrefs(navOf('PURCHASE'))).not.toContain('/approvals');
  });

  it('품질: 검사 입력 · 불합격 관리 · 검사 기준 · 재고', () => {
    expect(hrefs(navOf('QUALITY')).slice(1, 5)).toEqual(['/quality/inspections', '/quality/rejected', '/quality/standards', '/inventories']);
  });
});

describe('화면 잠금 (screens.ts)', () => {
  const sales: AccessUser = { permissions: permissionsOf('SALES'), headDepartmentIds: [] };
  const admin: AccessUser = {
    permissions: { ...Object.fromEntries(PERMISSIONS.map((p: Permission): [Permission, PermissionLevel] => [p, 'VIEW'])), ...permissionsOf('ADMIN') },
    headDepartmentIds: [],
  };
  const open = (user: AccessUser, path: string) => {
    const screen = screenOfPath(path);
    return screen ? canOpenScreen(user, screen.access) : true;
  };

  it('권한이 없는 화면은 잠기고, 조회 권한만 있어도 열린다', () => {
    expect(open(sales, '/admin/master-data')).toBe(false);
    expect(open(admin, '/admin/master-data')).toBe(true);
    expect(open(sales, '/mill-sheets')).toBe(true);
    expect(open(sales, '/quality/standards')).toBe(false);
  });

  it('등록 화면은 사용 권한이 있어야 열린다', () => {
    expect(open(sales, '/sales-orders/new')).toBe(true);
    expect(open(admin, '/sales-orders/new')).toBe(false);
    expect(open(admin, '/sales-orders/12')).toBe(true);
  });

  it('승인함은 부서장만, 업무·알림·메신저·재고는 모든 사원이 연다', () => {
    expect(open(sales, '/approvals')).toBe(false);
    expect(open({ ...sales, headDepartmentIds: [1] }, '/approvals')).toBe(true);
    for (const path of ['/dashboard', '/tasks', '/messenger', '/inventories', '/lots/trace', '/business-events']) expect(open(sales, path)).toBe(true);
  });
});

describe('activeNavHref · routeTitleOf', () => {
  const nav = navOf('SALES');

  it('가장 길게 맞는 메뉴를 고른다', () => {
    expect(activeNavHref(nav, '/sales-orders/new')).toBe('/sales-orders/new');
    expect(activeNavHref(nav, '/sales-orders/12')).toBe('/sales-orders');
    expect(activeNavHref(nav, '/dashboard')).toBe('/dashboard');
    expect(activeNavHref(nav, '/unknown')).toBeNull();
  });

  it('상단 바 제목과 영역', () => {
    expect(routeTitleOf('/sales-orders/new')).toEqual({ title: '수주 등록', area: '영업' });
    expect(routeTitleOf('/sales-orders/3')).toEqual({ title: '수주 상세', area: '영업' });
    expect(routeTitleOf('/production/results').title).toBe('작업 실적');
    expect(routeTitleOf('/past-cases').area).toBe('준비 중 (EX)');
  });
});
