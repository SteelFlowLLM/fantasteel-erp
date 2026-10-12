// 검사 기준 목록 (서버 렌더 결과의 태그를 읽어 확인, 브라우저 없이)
// 공정별 머리로 묶고, 줄마다 공정 이름·"지금" 태그를 되풀이하지 않는다. 버전은 회색 vN.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { inspectionStandardApi, inspectionStandardKeys } from '@/api/inspectionStandards';
import { sessionApi } from '@/api/session';
import { InspectionStandardScreen } from '@/features/inspectionStandards/components/InspectionStandardScreen';
import { MeContext } from '@/hooks/useMe';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/quality/standards' }));

async function render(): Promise<{ html: string; codes: { code: string; process: string }[] }> {
  const employeeId = actAs(SEED_EMPLOYEE_NO.quality);
  const me = await sessionApi.getSessionUser(employeeId);
  const standards = await inspectionStandardApi.list();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(inspectionStandardKeys.list({}), standards);
  // React가 글자 조각 사이에 넣는 <!-- -->는 빼고 본다
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(MeContext.Provider, { value: me }, createElement(InspectionStandardScreen)))).replace(/<!-- -->/g, '');
  return { html, codes: standards.map((s) => ({ code: s.inspectionStandardCode, process: s.processType })) };
}

describe('검사 기준 목록', () => {
  it('공정별 머리(제강 → 연주 → 열연) 아래에 그 공정의 기준이 온다', async () => {
    const { html, codes } = await render();
    const heads = ['제강 · 히트 성분', '연주 · 슬래브 표면·치수', '열연 · 코일 치수·기계적 성질'].map((h) => html.indexOf(`>${h}`));
    const present = heads.filter((i) => i >= 0);
    expect(present.length).toBeGreaterThan(1);
    expect([...present].sort((a, b) => a - b)).toEqual(present);
    // 기준 코드는 자기 공정 머리 뒤, 다음 공정 머리 앞
    const order = ['STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING'];
    for (const { code, process } of codes) {
      const at = html.indexOf(`>${code}<`);
      const mine = heads[order.indexOf(process)];
      const next = heads.slice(order.indexOf(process) + 1).find((i) => i >= 0) ?? Infinity;
      expect(at).toBeGreaterThan(mine);
      expect(at).toBeLessThan(next);
    }
  });

  it('줄마다 "지금 vN" 태그 대신 회색 vN, 공정 이름은 되풀이하지 않는다', async () => {
    const { html } = await render();
    const list = html.slice(html.indexOf('<ul'), html.indexOf('</ul>'));
    expect(list).not.toContain('지금 v');
    expect(list).toMatch(/title="지금 버전 v\d+"[^>]*>v\d+</);
    // 공정 이름은 머리에만 (줄 안의 "제강" 글자 없음)
    const rows = list.split('<button').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).not.toMatch(/>(제강|연주|열연)</);
  });
});
