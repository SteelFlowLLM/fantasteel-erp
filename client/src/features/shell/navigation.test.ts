import { describe, expect, it } from 'vitest';
import { PERMISSIONS, type Permission, type PermissionLevel, type RoleCode } from '@/codes';
import { activeNavHref, buildNavigation, type NavEntry } from '@/features/shell/navigation';
import { routeTitleOf } from '@/features/shell/routeTitles';
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

describe('buildNavigation', () => {
  it('영업: 대시보드 · 수주 · 등록 · 출하요청 · 재고 + 공통', () => {
    const nav = hrefs(buildNavigation({ roleCode: 'SALES', permissions: permissionsOf('SALES'), headDepartmentIds: [] }));
    expect(nav.slice(0, 5)).toEqual(['/dashboard', '/sales-orders', '/sales-orders/new', '/shipment-requests', '/inventories']);
    expect(nav).not.toContain('/approvals');
    expect(nav.slice(-7)).toEqual(['/lots/trace', '/business-events', '/tasks', '/messenger', '/agent', '/meetings', '/past-cases']);
  });

  it('다른 영역의 조회 권한은 메뉴를 늘리지 않는다 (영업은 밀시트 조회가 있어도 메뉴 없음)', () => {
    const nav = hrefs(buildNavigation({ roleCode: 'SALES', permissions: permissionsOf('SALES'), headDepartmentIds: [] }));
    expect(nav).not.toContain('/mill-sheets');
    expect(nav).not.toContain('/production/plans');
  });

  it('권한이 없으면 그 메뉴를 숨긴다', () => {
    const permissions: PermissionMap = { ...permissionsOf('PURCHASE') };
    delete permissions.PURCHASE_ORDER_CONFIRM;
    const nav = hrefs(buildNavigation({ roleCode: 'PURCHASE', permissions, headDepartmentIds: [] }));
    expect(nav).toContain('/mrp');
    expect(nav).not.toContain('/purchase-orders');
  });

  it('승인함은 부서장에게만 보인다', () => {
    const nav = hrefs(buildNavigation({ roleCode: 'PURCHASE', permissions: permissionsOf('PURCHASE'), headDepartmentIds: [2] }));
    expect(nav).toContain('/approvals');
  });

  it('관리자: 사원 · 부서·직급·권한 · 기준정보', () => {
    const all: PermissionMap = Object.fromEntries(PERMISSIONS.map((p: Permission): [Permission, PermissionLevel] => [p, 'VIEW']));
    const nav = hrefs(buildNavigation({ roleCode: 'ADMIN', permissions: { ...all, ...permissionsOf('ADMIN') }, headDepartmentIds: [] }));
    expect(nav.slice(0, 4)).toEqual(['/dashboard', '/admin/employees', '/admin/organization', '/admin/master-data']);
  });

  it('품질: 검사 입력 · 불합격 관리 · 검사 기준 · 재고', () => {
    const nav = hrefs(buildNavigation({ roleCode: 'QUALITY', permissions: permissionsOf('QUALITY'), headDepartmentIds: [] }));
    expect(nav.slice(1, 5)).toEqual(['/quality/inspections', '/quality/rejected', '/quality/standards', '/inventories']);
  });
});

describe('activeNavHref · routeTitleOf', () => {
  const nav = buildNavigation({ roleCode: 'SALES', permissions: permissionsOf('SALES'), headDepartmentIds: [] });

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
