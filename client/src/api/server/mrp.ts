// MRP 화면 ↔ 서버 API (server/src/modules/mrp, GET mrp/requirements). 저장 없이 서버가 계산한다.
// 생산계획·원료 id는 서버 id를 그대로 쓴다(MRP에서 만드는 구매요청의 근거 계획·원료로 그대로 보낸다).
import type { MrpRequirementsView } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';
export function serverMrpRequirements(period: { from: string; to: string }): Promise<MrpRequirementsView> {
  return serverRequest<MrpRequirementsView>('GET', '/mrp/requirements', { query: { from: period.from, to: period.to } });
}
