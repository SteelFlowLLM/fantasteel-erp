// 재고 화면 LOT 목록의 상태 배지 색: 배정 상태·불합격 처리 상태가 다른 화면과 같은 색으로 보인다 (lib/statusTone).
// 시드 LOT 목록을 캐시에 넣어 두고 목록 탭을 서버 렌더해, 줄마다 배지의 색을 본다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { inventoryApi, inventoryKeys, type LotListView } from '@/api/inventories';
import { Badge, type BadgeTone } from '@/components/Badge';
import { LotListTab } from '@/features/inventory/components/LotListTab';
import { allocationLabelOf } from '@/features/inventory/lib/inventoryDisplay';
import { ALLOCATION_STATUS_TONE } from '@/lib/statusTone';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

function lotListHtml(rows: readonly LotListView[]): string {
  const client = new QueryClient();
  client.setQueryData(inventoryKeys.lots({}), rows);
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(LotListTab, { lotType: '', lotStatus: '', onLotTypeChange: () => undefined, onLotStatusChange: () => undefined })),
  );
}

/** 이 LOT 번호의 표 줄 */
const rowOf = (html: string, lotNo: string): string => {
  const at = html.indexOf(`>${lotNo}<`);
  expect(at, `${lotNo} 줄이 목록에 있어야 해요`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
};

/** 배지 글자(label)를 담은 span의 class 속성 */
const badgeClassOf = (rowHtml: string, label: string): string | undefined => new RegExp(`class="([^"]*)">${label}</span>`).exec(rowHtml)?.[1];

const toneClass = (tone: BadgeTone, plain = false): string => /class="([^"]*)"/.exec(renderToStaticMarkup(createElement(Badge, { tone, plain, children: '라벨' })))?.[1] ?? '';

/** 시드 LOT 중 출하 배정이 소진된 슬래브 (시드에 배정 확정·불합격 처리 상태 줄은 없어서 이 줄을 바탕으로 만든다) */
async function consumedSeedRow(): Promise<LotListView> {
  actAs(SEED_EMPLOYEE_NO.admin);
  const row = (await inventoryApi.listLots({})).find((r) => r.allocationPurpose === 'SHIPMENT' && r.allocationStatus === 'CONSUMED');
  if (!row) throw new Error('시드에 출하 배정이 소진된 LOT이 있어야 해요');
  return row;
}

describe('재고 LOT 목록의 배지 색', () => {
  it('배정 상태: 소진은 초록, 배정 확정은 파랑 (출하 화면과 같다)', async () => {
    const consumed = await consumedSeedRow();
    const confirmed: LotListView = { ...consumed, lotId: -1, lotNo: 'HT-TEST-CONFIRMED-01', allocationStatus: 'CONFIRMED', lotStatus: 'AVAILABLE' };
    const html = lotListHtml([consumed, confirmed]);

    expect(badgeClassOf(rowOf(html, consumed.lotNo), allocationLabelOf('SHIPMENT', 'CONSUMED'))).toBe(toneClass(ALLOCATION_STATUS_TONE.CONSUMED, true));
    expect(badgeClassOf(rowOf(html, confirmed.lotNo), allocationLabelOf('SHIPMENT', 'CONFIRMED'))).toBe(toneClass(ALLOCATION_STATUS_TONE.CONFIRMED, true));
    expect(toneClass(ALLOCATION_STATUS_TONE.CONSUMED, true)).not.toBe(toneClass('neutral', true));
  });

  it('불합격 처리 상태: 보류는 노랑, 폐기는 빨강 (품질 화면과 같다)', async () => {
    const base = await consumedSeedRow();
    const held: LotListView = { ...base, lotId: -1, lotNo: 'HT-TEST-HOLD-01', inspectionResult: 'FAIL', dispositionStatus: 'HOLD' };
    const scrapped: LotListView = { ...base, lotId: -2, lotNo: 'HT-TEST-SCRAPPED-01', inspectionResult: 'FAIL', dispositionStatus: 'SCRAPPED' };
    const html = lotListHtml([held, scrapped]);

    expect(badgeClassOf(rowOf(html, held.lotNo), '보류')).toBe(toneClass('wait'));
    expect(badgeClassOf(rowOf(html, scrapped.lotNo), '폐기')).toBe(toneClass('danger'));
  });
});
