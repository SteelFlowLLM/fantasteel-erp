// 측정값 폼 그리기 점검 (dev 서버 없이): 시연용 '기준 안 값으로 채우기'는 채울 빈 칸이 있을 때만, 점선 테두리로 보인다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { InspectionDetail } from '@/api/inspections';
import { InspectionForm } from '@/features/quality/components/InspectionForm';
import { judgedInspectionDetail } from '@/features/quality/testing/qualityFixtures';
import { MeContext } from '@/hooks/useMe';
import { SEED_EMPLOYEE_NO } from '@/test/actors';
import { sessionUserOf } from '@/test/sessionUsers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/quality/inspections' }));

function render(edit: (detail: InspectionDetail) => InspectionDetail): string {
  const me = sessionUserOf(SEED_EMPLOYEE_NO.quality);
  const detail = edit(judgedInspectionDetail());
  const form = createElement(InspectionForm, { detail, canEdit: true, onSaved: () => undefined });
  return renderToString(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MeContext.Provider, { value: me }, form)));
}

describe('측정값 폼 시연용 채우기', () => {
  it('판정이 끝나 칸이 다 차 있으면 보이지 않는다', () => {
    const html = render((d) => d);
    expect(html).not.toContain('기준 안 값으로 채우기');
    expect(html).not.toContain('시연용 도우미');
  });

  it('빈 칸이 있으면 점선 테두리 버튼으로 보인다', () => {
    const html = render((d) => ({ ...d, items: d.items.map((item, i) => (i === 0 ? { ...item, measuredValue: null, isPassed: null } : item)) }));
    const button = html.slice(html.lastIndexOf('<button', html.indexOf('기준 안 값으로 채우기')), html.indexOf('기준 안 값으로 채우기'));
    expect(button).toContain('border-dashed');
    expect(html).toContain('시연용 도우미');
  });
});
