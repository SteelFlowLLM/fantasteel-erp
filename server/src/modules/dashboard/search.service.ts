import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardRepository } from './dashboard.repository';

const MAX_RESULTS = 10;
const PER_KIND = 10;

export interface SearchHit {
  kind: 'SALES_ORDER' | 'LOT' | 'PRODUCTION_PLAN' | 'PURCHASE_REQUISITION' | 'SHIPMENT_REQUEST' | 'MILL_SHEET';
  kindLabel: string;
  label: string;
  linkPath: string;
}

/** 통합 검색 (SERVER-GUIDE 7장 dashboard): 번호 일부로 수주·LOT·계획·구매요청·출하요청·밀시트를 찾아 이동 경로를 준다. */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: DashboardRepository,
  ) {}

  async search(q: string | undefined): Promise<SearchHit[]> {
    const text = q?.trim();
    if (!text) return [];
    const r = await this.repo.searchNo(this.prisma, text, PER_KIND);
    const hits: { hit: SearchHit; exact: boolean; prefix: boolean }[] = [];
    const lower = text.toLowerCase();
    const push = (hit: SearchHit) => {
      const no = hit.label.toLowerCase();
      hits.push({ hit, exact: no === lower, prefix: no.startsWith(lower) });
    };
    // 종류별로 정확 일치 + 일부 일치를 합치고 id로 중복 제거한다.
    const merge = <T extends { id: number }>(pair: [T[], T[]]): T[] => {
      const seen = new Set<number>();
      return [...pair[0], ...pair[1]].filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
    };
    for (const x of merge(r.so)) push({ kind: 'SALES_ORDER', kindLabel: '수주', label: x.salesOrderNo, linkPath: `/sales-orders/${x.id}` });
    for (const x of merge(r.lot)) push({ kind: 'LOT', kindLabel: 'LOT', label: x.lotNo, linkPath: `/lots/trace?lot=${encodeURIComponent(x.lotNo)}` });
    for (const x of merge(r.plan)) push({ kind: 'PRODUCTION_PLAN', kindLabel: '생산계획', label: x.productionPlanNo, linkPath: `/production/plans?plan=${x.id}` });
    for (const x of merge(r.pr)) push({ kind: 'PURCHASE_REQUISITION', kindLabel: '구매요청', label: x.purchaseRequisitionNo, linkPath: `/purchase-requisitions/${x.id}` });
    for (const x of merge(r.shp)) push({ kind: 'SHIPMENT_REQUEST', kindLabel: '출하요청', label: x.shipmentRequestNo, linkPath: `/shipment-requests/${x.id}` });
    for (const x of merge(r.ms)) push({ kind: 'MILL_SHEET', kindLabel: '밀시트', label: x.millSheetNo, linkPath: `/mill-sheets?id=${x.id}` });
    // 정확 일치를 맨 앞에 두고, 나머지는 종류별로 (앞부분 일치 → 그 밖) 정렬한 뒤 종류를 번갈아 채운다.
    // 한 종류(예: LOT)가 결과를 다 차지하지 않게 하려는 것이다.
    const rank = (h: (typeof hits)[number]) => (h.prefix ? 0 : 1);
    const exact = hits.filter((h) => h.exact);
    const perKind = new Map<string, typeof hits>();
    for (const h of hits.filter((x) => !x.exact)) perKind.set(h.hit.kind, [...(perKind.get(h.hit.kind) ?? []), h]);
    const queues = [...perKind.values()].map((list) => list.map((h, i) => ({ h, i })).sort((a, b) => rank(a.h) - rank(b.h) || a.i - b.i).map((x) => x.h));
    const out = [...exact];
    for (let round = 0; out.length < MAX_RESULTS && queues.some((q) => q.length > round); round += 1) {
      for (const q of queues) if (q[round] && out.length < MAX_RESULTS) out.push(q[round]);
    }
    return out.slice(0, MAX_RESULTS).map((x) => x.hit);
  }
}
