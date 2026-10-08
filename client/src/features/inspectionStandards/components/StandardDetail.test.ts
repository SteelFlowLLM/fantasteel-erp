// 검사 기준 상세 (서버 렌더 결과의 태그를 읽어 확인, 브라우저 없이)
// 거의 모든 줄이 같은 필수·KS는 배지 대신 글자, 다른 값(선택·가정값·바뀜)만 배지. 기준 삭제는 테두리 없는 빨간 글자 버튼.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { inspectionStandardApi, inspectionStandardKeys, type InspectionStandardDetailView } from '@/api/inspectionStandards';
import { sessionApi } from '@/api/session';
import { StandardDetail } from '@/features/inspectionStandards/components/StandardDetail';
import { MeContext } from '@/hooks/useMe';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/quality/standards' }));

async function render(pick: (detail: InspectionStandardDetailView) => InspectionStandardDetailView = (d) => d): Promise<string> {
  const me = await sessionApi.getSessionUser(actAs(SEED_EMPLOYEE_NO.quality));
  const steelmaking = (await inspectionStandardApi.list()).find((s) => s.processType === 'STEELMAKING' && s.steelGradeCode !== null);
  if (!steelmaking) throw new Error('제강 검사 기준이 시드에 없어요');
  const detail = await inspectionStandardApi.get(steelmaking.id);
  if (!detail) throw new Error('검사 기준 상세를 못 읽었어요');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(inspectionStandardKeys.detail(steelmaking.id), pick(detail));
  const noop = () => undefined;
  const element = createElement(StandardDetail, { id: steelmaking.id, canEdit: true, onSelectVersion: noop, onNewVersion: noop, onDeleted: noop });
  return renderToString(createElement(QueryClientProvider, { client }, createElement(MeContext.Provider, { value: me }, element))).replace(/<!-- -->/g, '');
}

const tableOf = (html: string) => html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));

describe('검사 기준 상세', () => {
  it('필수·KS는 배지 없이 글자로 보인다', async () => {
    const table = tableOf(await render());
    expect(table).toContain('<span class="text-ink-2">필수</span>');
    expect(table).toMatch(/<span class="text-cap text-ink-3" title="KS 값[^"]*">KS<\/span>/);
    expect(table).not.toContain('bg-ok-bg');
    expect(table).not.toContain('bg-brand-tint');
  });

  it('선택 항목은 그 줄만 배지로 다르게 보인다', async () => {
    const table = tableOf(await render((d) => ({ ...d, items: d.items.map((item, i) => (i === 0 ? { ...item, isRequired: false } : item)) })));
    expect(table).toMatch(/<span[^>]*>선택<\/span>/);
    expect(table.match(/>필수</g)?.length).toBeGreaterThan(0);
  });

  it('기준 삭제는 테두리 없는 빨간 글자 버튼, 새 버전 만들기만 진한 버튼', async () => {
    const html = await render();
    const del = html.slice(html.lastIndexOf('<button', html.indexOf('기준 삭제')), html.indexOf('기준 삭제'));
    expect(del).toContain('border-transparent bg-transparent text-danger');
    const add = html.slice(html.lastIndexOf('<button', html.indexOf('새 버전 만들기')), html.indexOf('새 버전 만들기'));
    expect(add).toContain('bg-brand');
  });
});
