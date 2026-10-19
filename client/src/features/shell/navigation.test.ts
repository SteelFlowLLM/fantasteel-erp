import { describe, expect, it } from 'vitest';
import { PERMISSIONS, type Permission, type PermissionLevel, type RoleCode } from '@/codes';
import { activeNavHref, buildNavigation, type NavEntry } from '@/features/shell/navigation';
import { routeTitleOf } from '@/features/shell/routeTitles';
import { canOpenHref, canOpenScreen, screenOfPath, type AccessUser } from '@/features/shell/screens';
import type { PermissionMap } from '@/lib/permissions';
import { rolePermissionsOf } from '@/test/sessionUsers';

const permissionsOf = (roleCode: RoleCode): PermissionMap => rolePermissionsOf(roleCode);

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
    expect(nav.slice(-10)).toEqual(['/org-chart', '/lots/trace', '/business-events', '/tasks', '/messenger', '/meetings', '/ai-research', '/schedule', '/agent', '/past-cases']);
  });

  it('업무 조회는 모든 역할: 다른 영역 업무 화면이 모두 구분선 뒤에 영역 순서로 붙고, 관리 화면은 기준정보만 (역할별 메뉴 v2 3장 표)', () => {
    const business = ['/sales-orders', '/shipment-requests', '/mrp', '/purchase-requisitions', '/purchase-orders', '/goods-receipts', '/production/plans', '/production/results', '/production/rolling', '/quality/inspections', '/quality/rejected', '/quality/standards', '/goods-issues', '/mill-sheets', '/admin/master-data'];
    const without = (...own: string[]) => business.filter((href) => !own.includes(href));
    expect(otherAreaHrefs(navOf('SALES'))).toEqual(without('/sales-orders', '/shipment-requests'));
    expect(otherAreaHrefs(navOf('PURCHASE'))).toEqual(without('/mrp', '/purchase-requisitions', '/purchase-orders', '/goods-receipts'));
    expect(otherAreaHrefs(navOf('PRODUCTION'))).toEqual(without('/production/plans', '/production/results', '/production/rolling'));
    expect(otherAreaHrefs(navOf('QUALITY'))).toEqual(without('/quality/inspections', '/quality/rejected', '/quality/standards'));
    expect(otherAreaHrefs(navOf('LOGISTICS'))).toEqual(without('/goods-issues', '/mill-sheets'));
  });

  it('관리자: 사원 · 부서·직급·권한 · 기준정보 · AI 연결 · 외부 연결, 그 뒤에 조회 권한으로 여는 14개 화면과 재고', () => {
    const all: PermissionMap = Object.fromEntries(PERMISSIONS.map((p: Permission): [Permission, PermissionLevel] => [p, 'VIEW']));
    const nav = buildNavigation({ roleCode: 'ADMIN', permissions: { ...all, ...permissionsOf('ADMIN') }, headDepartmentIds: [] });
    expect(hrefs(nav).slice(0, 6)).toEqual(['/dashboard', '/admin/employees', '/admin/organization', '/admin/master-data', '/admin/llm', '/admin/integrations']);
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
    // 관리자가 부서·권한 화면에서 구매의 다른 권한을 모두 뺀 경우
    const permissions: PermissionMap = { PURCHASE_REQUISITION_CREATE: 'USE', GOODS_RECEIPT_CONFIRM: 'USE' };
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
  /** 관리자가 다른 영역 조회 권한을 뺀 영업 사원 */
  const salesOnly: AccessUser = { permissions: { SALES_ORDER_CREATE: 'USE', SALES_ORDER_CANCEL: 'USE', SHIPMENT_REQUEST_MANAGE: 'USE' }, headDepartmentIds: [] };
  const admin: AccessUser = {
    permissions: { ...Object.fromEntries(PERMISSIONS.map((p: Permission): [Permission, PermissionLevel] => [p, 'VIEW'])), ...permissionsOf('ADMIN') },
    headDepartmentIds: [],
  };
  const open = (user: AccessUser, path: string) => {
    const screen = screenOfPath(path);
    return screen ? canOpenScreen(user, screen.access) : true;
  };

  it('권한이 없는 화면은 잠기고, 조회 권한만 있어도 열린다', () => {
    expect(open(sales, '/admin/employees')).toBe(false);
    expect(open(admin, '/admin/employees')).toBe(true);
    expect(open(sales, '/admin/master-data')).toBe(true);
    expect(open(sales, '/mill-sheets')).toBe(true);
    expect(open(sales, '/quality/standards')).toBe(true);
    expect(open(salesOnly, '/quality/standards')).toBe(false);
  });

  it('주소로 열 수 있는지 본다: 쿼리는 떼고 보고, 표에 없는 주소는 막지 않는다', () => {
    expect(canOpenHref(sales, '/production/plans?plan=3')).toBe(true);
    expect(canOpenHref(salesOnly, '/production/plans?plan=3')).toBe(false);
    expect(canOpenHref(salesOnly, '/lots/trace?lot=HT-BOF1-261001-001')).toBe(true);
    expect(canOpenHref(salesOnly, '/unknown')).toBe(true);
  });

  it('Message → ERP 초안 화면은 구매요청 권한이 없어도 열린다 (볼 수 있는지는 서버가 요청자·방 멤버로 확인)', () => {
    expect(open(salesOnly, '/purchase-requisitions/3')).toBe(false);
    expect(open(salesOnly, '/action-drafts/3')).toBe(true);
  });

  it('등록 화면은 사용 권한이 있어야 열린다', () => {
    expect(open(sales, '/sales-orders/new')).toBe(true);
    expect(open(admin, '/sales-orders/new')).toBe(false);
    expect(open(admin, '/sales-orders/12')).toBe(true);
  });

  it('승인함은 부서장만, 조직도·업무·알림·메신저·재고는 모든 사원이 연다', () => {
    expect(open(sales, '/approvals')).toBe(false);
    expect(open({ ...sales, headDepartmentIds: [1] }, '/approvals')).toBe(true);
    for (const path of ['/dashboard', '/org-chart', '/tasks', '/messenger', '/inventories', '/lots/trace', '/business-events']) expect(open(sales, path)).toBe(true);
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
    expect(routeTitleOf('/past-cases').area).toBe('추가 기능 (EX)');
  });
});
