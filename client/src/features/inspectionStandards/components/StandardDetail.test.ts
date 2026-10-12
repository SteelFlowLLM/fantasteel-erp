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
  it('제강처럼 모든 줄이 같은 칸(최소 없음·전체 두께·필수·KS)은 표에서 접고 표 위 한 줄로 요약한다', async () => {
    const html = await render();
    expect(html).toContain('모든 항목 같음');
    expect(html).toMatch(/모든 항목 같음<\/b> · 필수 · KS 근거 · 모든 두께 · 최소 없음/);
    for (const head of ['최소 (이상)', '적용 두께 구간 (mm)', '>필수<', '>근거<']) expect(html.slice(html.indexOf('<thead'), html.indexOf('</thead>'))).not.toContain(head);
    expect(html).toContain('최대 (이하)');
    const table = tableOf(html);
    expect(table).not.toContain('>필수<');
    expect(table).not.toContain('>KS<');
  });

  it('필수·KS 칸이 남으면 배지 없이 글자로, 선택 항목만 배지로 다르게 보인다', async () => {
    const table = tableOf(await render((d) => ({ ...d, items: d.items.map((item, i) => (i === 0 ? { ...item, isRequired: false } : item)) })));
    expect(table).toMatch(/<span[^>]*>선택<\/span>/);
    expect(table).toContain('<span class="text-ink-2">필수</span>');
    expect(table).not.toContain('bg-ok-bg');
  });

  it('두께 구간마다 이어지는 같은 항목은 한 묶음: 코드·이름은 첫 줄에만, 묶음 안 줄 사이 선은 지운다', async () => {
    let code = '';
    const table = tableOf(
      await render((d) => {
        const [first, ...rest] = d.items;
        code = first.inspectionItemCode;
        const bands = [1, 2, 3].map((n) => ({ ...first, id: first.id * 100 + n, minValue: String(n) }));
        return { ...d, items: [...bands, ...rest] };
      }),
    );
    expect(table.split(`>${code}<`).length - 1).toBe(1);
    expect(table.match(/\[&amp;&gt;td\]:border-b-transparent/g)?.length).toBe(2);
  });

  it('기준 삭제는 머리에 바로 보이지 않고 더보기(⋯) 메뉴 안에 있다. 새 버전 만들기만 진한 버튼', async () => {
    const html = await render();
    expect(html).not.toContain('기준 삭제');
    expect(html).toMatch(/<button[^>]*aria-label="기준 더보기"[^>]*aria-haspopup="menu"|<button[^>]*aria-haspopup="menu"[^>]*aria-label="기준 더보기"/);
    const add = html.slice(html.lastIndexOf('<button', html.indexOf('새 버전 만들기')), html.indexOf('새 버전 만들기'));
    expect(add).toContain('bg-brand');
  });
});
