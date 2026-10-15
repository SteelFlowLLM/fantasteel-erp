import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScreenLink } from '@/features/shell/ScreenLink';
import { MeContext } from '@/hooks/useMe';
import type { PermissionMap } from '@/lib/permissions';
import { SEED_EMPLOYEE_NO } from '@/test/actors';
import { sessionUserOf } from '@/test/sessionUsers';

function render(permissions?: PermissionMap): string {
  const me = { ...sessionUserOf(SEED_EMPLOYEE_NO.sales), ...(permissions ? { permissions } : {}) };
  // data-* 속성은 JSX에서만 객체 리터럴 검사를 비켜 가서, 변수로 넘긴다
  const props = { href: '/production/plans?plan=3', className: 'text-run', textClassName: 'font-mono', 'data-pet-item': 'productionPlan' };
  const link = createElement(ScreenLink, props, 'PP-2610-0003');
  return renderToStaticMarkup(createElement(MeContext.Provider, { value: me }, link));
}

describe('ScreenLink', () => {
  it('열 수 있는 화면이면 링크로 그린다 (업무 조회는 모든 역할)', () => {
    const html = render();
    expect(html).toContain('href="/production/plans?plan=3"');
    expect(html).toContain('class="text-run"');
  });

  it('열 수 없으면 링크 없이 글자만 그리고, 화면 도우미 펫 표시는 남긴다', () => {
    const html = render({ SALES_ORDER_CREATE: 'USE' });
    expect(html).not.toContain('href=');
    expect(html).toBe('<span class="font-mono" data-pet-item="productionPlan">PP-2610-0003</span>');
  });
});
