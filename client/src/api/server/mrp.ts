// MRP 화면 ↔ 서버 API (server/src/modules/mrp, GET mrp/requirements). 저장 없이 서버가 계산한다.
// 생산계획 id는 서버 id를 그대로 쓴다(MRP에서 만드는 구매요청의 근거 계획으로 그대로 보낸다).
// 원료 id만 화면(가짜 DB) id로 맞춘다: 구매요청 등록 창의 원료 선택이 화면 id를 쓴다(api/server/masterIds.ts).
import type { MrpRequirementsView } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';
import { mockItemOf } from '@/api/server/masterIds';

const mockItemIdOf = (itemCode: string, serverItemId: number) => mockItemOf(itemCode)?.id ?? serverItemId;

export async function serverMrpRequirements(period: { from: string; to: string }): Promise<MrpRequirementsView> {
  const view = await serverRequest<MrpRequirementsView>('GET', '/mrp/requirements', { query: { from: period.from, to: period.to } });
  return {
    ...view,
    plans: view.plans.map((p) => ({ ...p, materials: p.materials.map((m) => ({ ...m, itemId: mockItemIdOf(m.itemCode, m.itemId) })) })),
    materials: view.materials.map((m) => ({ ...m, itemId: mockItemIdOf(m.itemCode, m.itemId) })),
    requisitionLines: view.requisitionLines.map((l) => ({ ...l, itemId: mockItemIdOf(l.itemCode, l.itemId) })),
  };
}
