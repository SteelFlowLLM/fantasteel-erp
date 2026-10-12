// 불합격 관리 목록 머리 (서버 렌더 결과의 태그를 읽어 확인, 브라우저 없이)
// 상태 카드는 건수가 있을 때만 색(0건은 회색), 원인 칩은 문구(용어 사전 TRM-078) 그대로 한 줄.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { dispositionApi, dispositionKeys, type RejectedLotListRow } from '@/api/dispositions';
import { sessionApi } from '@/api/session';
import { RejectedLotWorkspace } from '@/features/quality/components/RejectedLotWorkspace';
import { MeContext } from '@/hooks/useMe';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/quality/rejected' }));

async function render(edit: (rows: RejectedLotListRow[]) => RejectedLotListRow[]): Promise<string> {
  const employeeId = actAs(SEED_EMPLOYEE_NO.quality);
  const me = await sessionApi.getSessionUser(employeeId);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(dispositionKeys.list(), edit(await dispositionApi.list()));
  return renderToString(createElement(QueryClientProvider, { client }, createElement(MeContext.Provider, { value: me }, createElement(RejectedLotWorkspace))));
}

/** 상태 카드 한 개의 태그 (라벨로 찾는다) */
const tileOf = (html: string, label: string) => {
  const group = html.slice(html.indexOf('aria-label="불합격 상태"'));
  const at = group.indexOf(`>${label}<`);
  return group.slice(group.lastIndexOf('<button', at), at);
};

describe('불합격 관리 목록 머리', () => {
  it('상태 카드는 건수가 있는 것만 색을 칠하고, 0건은 회색', async () => {
    const html = await render((rows) => {
      const first = rows[0];
      if (!first) throw new Error('불합격 LOT이 시드에 없어요');
      return [{ ...first, dispositionStatus: 'HOLD' }];
    });
    expect(tileOf(html, '보류')).toContain('bg-wait-bg');
    for (const label of ['미지정', '격하', '폐기']) {
      expect(tileOf(html, label)).toContain('bg-surface-2');
      expect(tileOf(html, label)).not.toMatch(/bg-(wait|run|danger)-bg/);
    }
  });

  it('원인 칩은 줄바꿈 없이 한 줄이고 문구는 그대로', async () => {
    const html = await render((rows) => rows);
    expect(html).toMatch(/<div[^>]*flex-nowrap[^>]*aria-label="불합격 원인"|aria-label="불합격 원인"[^>]*flex-nowrap/);
    expect(html).not.toMatch(/<div[^>]*hidden[^>]*aria-label="불합격 원인"/);
    for (const label of ['모든 원인', '검사 불합격', '불합격 히트의 하위 LOT']) expect(html).toContain(`>${label}<`);
  });

  it('불합격 히트의 하위 LOT은 히트 아래로 접어 묶고, 원인·재생산 필요는 히트 줄에 한 번만', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const all = await dispositionApi.list();
    const heat = all.find((r) => r.lotType === 'HEAT' && all.some((c) => c.reason === 'HEAT_FAILED' && c.heatNo === r.lotNo));
    if (!heat) throw new Error('하위 LOT이 있는 불합격 히트가 시드에 없어요');
    const children = all.filter((c) => c.reason === 'HEAT_FAILED' && c.heatNo === heat.lotNo);
    // 히트를 맨 앞(= 처음 고른 LOT)에 두면 묶음은 접힌 채로 그린다
    const html = await render((rows) => [heat, ...rows.filter((r) => r.lotId !== heat.lotId)]);
    expect(html).toContain('하위 LOT <b class="font-semibold">' + `${children.length}개`);
    expect(html).toMatch(/aria-expanded="false"/);
    for (const c of children) expect(html).not.toContain(`>${c.lotNo}<`);
    expect(html.match(/불합격 히트의 하위 LOT<\/span>/g)).toBeNull();
    const need = heat.salesOrderItem?.shortage.reproductionNeedQty ?? 0;
    if (need > 0) expect(html.match(/재생산 필요 <!-- -->\d+<!-- -->매/g)?.length).toBe(1);

    // 하위 LOT을 고르면 그 묶음이 펼쳐져 하위 LOT 번호가 보이고, 하위 줄에는 원인 글자가 없다
    const opened = await render((rows) => [children[0], ...rows.filter((r) => r.lotId !== children[0].lotId)]);
    expect(opened).toMatch(/aria-expanded="true"/);
    for (const c of children) expect(opened).toContain(`>${c.lotNo}<`);
  });

  it('불합격 LOT이 없으면 "없어요"는 오른쪽에 한 번만, 원인 칩은 숨기고 안내 상자 문구는 오른쪽 빈 화면으로', async () => {
    const html = await render(() => []);
    expect(html.match(/불합격 LOT이 없어요/g)?.length).toBe(1);
    expect(html).toMatch(/<div[^>]*hidden[^>]*aria-label="불합격 원인"/);
    expect(html.match(/검사 기준을 충족하지 못한 LOT/g)?.length).toBe(1);
  });
});
