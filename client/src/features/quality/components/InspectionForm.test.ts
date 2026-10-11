// 측정값 폼 그리기 점검 (dev 서버 없이): 시연용 '기준 안 값으로 채우기'는 채울 빈 칸이 있을 때만, 점선 테두리로 보인다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { inspectionApi, type InspectionDetail } from '@/api/inspections';
import { sessionApi } from '@/api/session';
import { InspectionForm } from '@/features/quality/components/InspectionForm';
import { MeContext } from '@/hooks/useMe';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/quality/inspections' }));

async function render(edit: (detail: InspectionDetail) => InspectionDetail): Promise<string> {
  const me = await sessionApi.getSessionUser(actAs(SEED_EMPLOYEE_NO.quality));
  const judged = (await inspectionApi.queue()).find((r) => r.inspectionResult !== 'PENDING' && !r.locked);
  if (!judged) throw new Error('판정이 끝난, 잠기지 않은 LOT이 시드에 없어요');
  const detail = edit(await inspectionApi.detail(judged.lotId));
  const form = createElement(InspectionForm, { detail, canEdit: true, onSaved: () => undefined });
  return renderToString(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MeContext.Provider, { value: me }, form)));
}

describe('측정값 폼 시연용 채우기', () => {
  it('판정이 끝나 칸이 다 차 있으면 보이지 않는다', async () => {
    const html = await render((d) => d);
    expect(html).not.toContain('기준 안 값으로 채우기');
    expect(html).not.toContain('시연용 도우미');
  });

  it('빈 칸이 있으면 점선 테두리 버튼으로 보인다', async () => {
    const html = await render((d) => ({ ...d, items: d.items.map((item, i) => (i === 0 ? { ...item, measuredValue: null, isPassed: null } : item)) }));
    const button = html.slice(html.lastIndexOf('<button', html.indexOf('기준 안 값으로 채우기')), html.indexOf('기준 안 값으로 채우기'));
    expect(button).toContain('border-dashed');
    expect(html).toContain('시연용 도우미');
  });
});
