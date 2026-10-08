// 검사 입력 목록 머리와 빈 화면 (서버 렌더 결과의 태그를 읽어 확인, 브라우저 없이)
// 판정 결과 칩은 한 줄, 공정 탭 숫자는 판정 대기가 있을 때만, 판정할 LOT이 없으면 "할 일 없음"과 판정 끝난 LOT으로 가는 버튼.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { inspectionApi, inspectionKeys } from '@/api/inspections';
import { sessionApi } from '@/api/session';
import { InspectionWorkspace } from '@/features/quality/components/InspectionWorkspace';
import { MeContext } from '@/hooks/useMe';
import type { InspectionQueueRow } from '@/mock/services';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/quality/inspections' }));

async function render(edit: (rows: InspectionQueueRow[]) => InspectionQueueRow[] = (rows) => rows): Promise<{ html: string; rows: InspectionQueueRow[] }> {
  const employeeId = actAs(SEED_EMPLOYEE_NO.quality);
  const me = await sessionApi.getSessionUser(employeeId);
  const rows = edit(await inspectionApi.queue());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(inspectionKeys.queue(), rows);
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(MeContext.Provider, { value: me }, createElement(InspectionWorkspace))));
  return { html, rows };
}

/** 판정 결과 칩 묶음의 태그 */
const resultGroupOf = (html: string) => html.match(/<div[^>]*role="group"[^>]*aria-label="판정 결과"[^>]*>/)?.[0] ?? '';
/** 공정 탭 묶음 */
const processGroupOf = (html: string) => html.slice(html.indexOf('aria-label="공정별 보기"'), html.indexOf('aria-label="판정 결과"'));

describe('검사 입력 목록 머리·빈 화면', () => {
  it('판정 결과 칩은 줄바꿈 없이 한 줄이고, 순서는 전체 · 합격 · 불합격 · 판정 대기', async () => {
    const { html } = await render();
    expect(resultGroupOf(html)).toContain('flex-nowrap');
    const group = html.slice(html.indexOf('aria-label="판정 결과"'));
    const order = ['>전체 ', '>합격', '>불합격', '>판정 대기'].map((label) => group.indexOf(label));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('공정 탭 숫자는 판정 대기 수이고, 판정 대기가 없는 공정은 숫자를 붙이지 않는다', async () => {
    const { html, rows } = await render();
    const pending = rows.filter((r) => r.inspectionResult === 'PENDING').length;
    expect(pending).toBeGreaterThan(0);
    const tabs = processGroupOf(html);
    expect(tabs).toContain(`title="판정 대기 ${pending}개"`);
    expect(tabs).not.toMatch(/>\s*0\s*</);
    expect(html).toContain('탭 숫자 = 판정 대기');
  });

  it('판정할 LOT이 없으면(모두 판정 끝) "판정할 LOT이 없어요"와 판정 끝난 LOT 보기 버튼, 왼쪽 안내 상자는 빼고 한 줄', async () => {
    const { html, rows } = await render((all) => all.map((r) => ({ ...r, inspectionResult: 'PASS' as const })));
    expect(html).toContain('판정할 LOT이 없어요');
    expect(html).toContain(`판정 끝난 LOT 보기 (전체 <!-- -->${rows.length}<!-- -->)`);
    expect(html).toContain('판정 대기 LOT 없음');
    expect(html).not.toContain('검사 대상 LOT이 없어요');
    expect(html).not.toContain('LOT이 이 목록에 올라와요');
    // 탭에는 숫자가 하나도 없다
    expect(processGroupOf(html)).not.toContain('title="판정 대기');
  });

  it('목록 한 줄은 두 줄(LOT·판정 / 규격·생산일)이고, 계획·검사 일시·기준은 마우스를 올리면 보인다', async () => {
    const { html, rows } = await render();
    const first = rows.find((r) => r.inspectionResult === 'PENDING');
    if (!first) throw new Error('판정 대기 LOT이 시드에 없어요');
    const item = html.slice(html.indexOf(`href="/quality/inspections?lot=${first.lotId}"`));
    const row = item.slice(0, item.indexOf('</a>'));
    const visible = row.replace(/title="[^"]*"/g, '');
    expect(visible).toContain('생산 ');
    expect(visible).not.toContain('계획 ');
    expect(visible).not.toContain('생산완료일');
    expect(row).toMatch(/title="[^"]*생산완료일[^"]*"/);
  });

  it('상위 히트가 합격이 아니면 두 번째 줄 끝에 잘리지 않게 따로 보인다', async () => {
    const { html } = await render((all) => {
      const slab = all.find((r) => r.lotType !== 'HEAT');
      return slab ? [{ ...slab, heatResult: 'FAIL' as const, inspectionResult: 'PENDING' as const }] : [];
    });
    expect(html).toMatch(/text-danger[^>]*>· 상위 히트 <!-- -->불합격/);
  });

  it('검사 대상 LOT이 하나도 없으면 지금처럼 "검사 대상 LOT이 없어요"', async () => {
    const { html } = await render(() => []);
    expect(html).toContain('검사 대상 LOT이 없어요');
    expect(html).not.toContain('판정할 LOT이 없어요');
  });
});
