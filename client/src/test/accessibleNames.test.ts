// 접근성 이름: 같은 이름이 여러 개 겹치거나 이름이 없던 입력칸·단추에 화면 낭독기용 이름이 붙었는지 본다.
// 서버 렌더(renderToString) 결과의 태그를 읽어 확인한다 (브라우저 없이 Vitest node 환경).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerView, ProductSpecView } from '@/api/lookups';
import type { PurchaseOrderCandidateItem } from '@/api/purchasing';
import { queryKeys } from '@/api/queryKeys';
import { PurchaseOrderForm } from '@/features/purchasing/PurchaseOrderScreen';
import { MasterItem } from '@/features/purchasing/components/PurchasingParts';
import { groupBySupplier } from '@/features/purchasing/lib/purchasingView';
import { SalesOrderCreateScreen } from '@/features/sales/SalesOrderCreateScreen';
import { UserMenu } from '@/features/shell/UserMenu';
import { MeContext } from '@/hooks/useMe';
import { SEED_EMPLOYEE_NO } from '@/test/actors';
import { sessionUserOf } from '@/test/sessionUsers';

// 수주 등록 화면은 목록으로 돌아가려고 next/navigation을 쓴다. 서버 렌더에는 라우터가 없어서 비워 둔다.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }), usePathname: () => '/' }));

function render(employeeNo: string, element: ReactElement, prepare: (client: QueryClient) => void = () => undefined): string {
  const me = sessionUserOf(employeeNo);
  const client = new QueryClient();
  prepare(client);
  return renderToString(createElement(QueryClientProvider, { client }, createElement(MeContext.Provider, { value: me }, element)));
}

/** 이 id를 가진 태그 한 개의 글자 (예: `<select id="so-customer" aria-label="고객사" …>`) */
const tagWithId = (html: string, id: string): string => {
  const tag = new RegExp(`<(?:input|select|textarea)[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0];
  if (!tag) throw new Error(`id가 ${id}인 입력칸이 없어요`);
  return tag;
};

/** 모든 입력칸·단추 태그에서 aria-label을 모은다 */
const ariaLabelsOf = (html: string, tagName: string): string[] =>
  [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'g'))].flatMap((m) => {
    const label = /aria-label="([^"]*)"/.exec(m[0])?.[1];
    return label === undefined ? [] : [label];
  });

/** 승인된 구매요청 (발주 후보): 공급업체 둘, 공급업체 없는 것 하나 */
const candidate = (id: number, supplierId: number | null, supplierName: string | null): PurchaseOrderCandidateItem => ({
  id,
  purchaseRequisitionNo: `PR-2610-000${id}`,
  purchaseRequisitionStatus: 'APPROVED',
  source: 'MRP',
  itemId: 4,
  itemCode: 'SMN01',
  itemName: '실리코망가니즈',
  requestedTon: '1.500',
  productionPlanId: null,
  productionPlanNo: null,
  purchaseOrderNo: null,
  requesterId: 5,
  requesterName: '정다은',
  departmentId: 2,
  departmentName: '구매부',
  approverName: '최준혁',
  desiredReceiptDate: '2026-10-20',
  requestReason: null,
  rejectReason: null,
  actionDraftId: null,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  approvedAt: '2026-10-11T00:00:00.000Z',
  rejectedAt: null,
  supplierId,
  supplierName,
});

describe('발주 작성: 공급업체별 전체 선택', () => {
  it('공급업체 이름이 들어간 이름이 붙는다 (카드마다 같은 "전체 선택"으로 겹치지 않는다)', () => {
    const items = [candidate(1, 1, '한국합금'), candidate(2, 2, '대한광업'), candidate(3, 1, '한국합금'), candidate(4, null, null)];
    const groups = groupBySupplier(items);
    const html = render(SEED_EMPLOYEE_NO.purchase, createElement(PurchaseOrderForm, { groups, initialIds: [], canConfirmPurchaseOrder: true, onDone: () => undefined }));
    const labels = ariaLabelsOf(html, 'input');
    for (const group of groups.filter((g) => g.supplierId !== null)) expect(labels).toContain(`${group.supplierName} 품목 전체 선택`);
    // 구매요청마다 고르는 칸도 이름이 있다
    for (const item of items) expect(labels).toContain(`${item.purchaseRequisitionNo} 고르기`);
  });
});

describe('수주 입력: 고객사·규격 선택', () => {
  it('고객사와 품목 줄(규격·매수·납기) 입력칸에 이름이 붙는다', () => {
    const customers: CustomerView[] = [{ id: 1, customerCode: 'C001', customerName: '한빛조선' }];
    const specs: ProductSpecView[] = [
      {
        id: 11,
        itemCode: 'SL-SS275-250x1200x10000',
        itemName: 'SS275 슬래브 250×1200×10000',
        itemType: 'SLAB',
        steelGradeId: 1,
        steelGradeCode: 'SS275',
        thicknessMm: '250.00',
        widthMm: '1200.00',
        lengthMm: '10000.00',
        theoreticalWeightTon: '23.550',
        defaultYardId: 2,
        defaultYardName: '슬래브 야드',
        mappedItemId: null,
        mappedItemCode: null,
        hotRollingPlannedYieldRate: null,
      },
    ];
    const html = render(SEED_EMPLOYEE_NO.sales, createElement(SalesOrderCreateScreen), (client) => {
      client.setQueryData(queryKeys.customers(), customers);
      client.setQueryData(queryKeys.productSpecs({}), specs);
    });
    expect(tagWithId(html, 'so-customer')).toContain('aria-label="고객사"');
    expect(html).toMatch(/<label[^>]*for="so-customer"/);
    const labels = [...ariaLabelsOf(html, 'select'), ...ariaLabelsOf(html, 'input')];
    for (const label of ['1번째 품목 유형', '1번째 강종', '1번째 규격', '1번째 매수', '1번째 납기']) expect(labels).toContain(label);
  });
});

describe('상단 바 사원 메뉴 단추', () => {
  it('사원 이름이 들어간 이름이 붙는다', () => {
    const html = render(SEED_EMPLOYEE_NO.admin, createElement(UserMenu));
    expect(html).toContain('aria-label="사원 메뉴 · 이현정"');
    expect(html).toContain('aria-haspopup="menu"');
  });
});

describe('입고예정 목록 줄 단추', () => {
  it('label을 이름으로 쓰고, 없으면 안의 글자가 이름이 된다', () => {
    const label = '입고 PO-2609-0001 1번 품목';
    const named = renderToString(createElement(MasterItem, { selected: false, onClick: () => undefined, label, children: '본문' }));
    expect(named).toContain(`aria-label="${label}"`);
    const plain = renderToString(createElement(MasterItem, { selected: true, onClick: () => undefined, children: '본문' }));
    expect(plain).not.toContain('aria-label');
    expect(plain).toContain('aria-pressed="true"');
  });
});
