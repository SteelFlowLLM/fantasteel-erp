// 작업 로그 대상의 화면 이름·이동할 화면: 대상 테이블마다 화면 주소 약속을 따르고, 갈 화면이 없으면 링크를 만들지 않는다.
import { describe, expect, it } from 'vitest';
import { isTargetFilterTable, targetHref, targetTableLabel } from './eventTargets';

const ref = (targetType: string, extra: Partial<Parameters<typeof targetHref>[0]> = {}) => ({ targetType, targetId: 5, targetNo: null, salesOrderId: null, ...extra });

describe('작업 로그 대상 링크', () => {
  it('출하요청은 상세로, 출하요청 품목은 그 출하요청 상세로 가고 출하요청을 모르면 링크가 없다', () => {
    expect(targetHref(ref('shipment_request'))).toBe('/shipment-requests/5');
    expect(targetHref(ref('shipment_request_item', { shipmentRequestId: 71 }))).toBe('/shipment-requests/71');
    expect(targetHref(ref('shipment_request_item'))).toBeNull();
  });

  it('LOT은 번호로 추적 화면을 열고(번호가 없으면 링크 없음), 수주 품목·예약·배정은 수주 상세로 간다', () => {
    expect(targetHref(ref('lot', { targetNo: 'SL-2610 001' }))).toBe('/lots/trace?lot=SL-2610%20001');
    expect(targetHref(ref('lot'))).toBeNull();
    for (const targetType of ['sales_order_item', 'reservation', 'allocation']) {
      expect(targetHref(ref(targetType, { salesOrderId: 9 }))).toBe('/sales-orders/9');
      expect(targetHref(ref(targetType))).toBeNull();
    }
  });

  it('작업 실적·품질검사·입고는 아는 계획·LOT·발주로 화면을 열고, 모르면 목록 화면으로 간다', () => {
    expect(targetHref(ref('production_result', { productionPlanId: 300 }))).toBe('/production/results?plan=300');
    expect(targetHref(ref('production_result'))).toBe('/production/results');
    expect(targetHref(ref('quality_inspection', { lotId: 501 }))).toBe('/quality/inspections?lot=501');
    expect(targetHref(ref('goods_receipt', { purchaseOrderId: 40 }))).toBe('/goods-receipts?po=40');
    expect(targetHref(ref('mill_sheet'))).toBe('/mill-sheets?id=5');
    expect(targetHref(ref('item'))).toBeNull();
  });

  it('대상 이름은 용어 사전의 한글명, 없는 테이블은 DB명 그대로. 대상 필터에는 이벤트가 기록되는 업무 테이블만', () => {
    expect(targetTableLabel('shipment_request_item')).toBe('출하요청 품목');
    expect(targetTableLabel('mill_sheet')).toBe('밀시트');
    expect(targetTableLabel('chat_room')).toBe('chat_room');
    expect(isTargetFilterTable('mill_sheet')).toBe(true);
    expect(isTargetFilterTable('item')).toBe(false);
    // Agent 위험 감지(불합격률 상승)·과거 사례 등록·삭제가 기록되는 테이블 (#509)
    expect(isTargetFilterTable('steel_grade')).toBe(true);
    expect(isTargetFilterTable('past_case')).toBe(true);
  });

  it('초안은 초안 상세로, Agent 대응 후보는 메시지 초안 상세(COM-002)가 아니라 Agent 화면으로 간다 (#509)', () => {
    expect(targetHref(ref('action_draft'))).toBe('/action-drafts/5');
    expect(targetHref(ref('action_draft', { isAgentCandidate: true }))).toBe('/agent');
  });
});
