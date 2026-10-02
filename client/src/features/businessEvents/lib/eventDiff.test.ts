import { describe, expect, it } from 'vitest';
import { diffRows, flattenJson, formatDiffValue } from '@/features/businessEvents/lib/eventDiff';
import { eventTone, isFailureEvent } from '@/features/businessEvents/lib/eventTone';
import { targetHref, targetTableLabel } from '@/features/businessEvents/lib/eventTargets';

describe('변경 전·후 비교', () => {
  it('중첩 객체를 경로로 편다', () => {
    expect([...flattenJson({ inventory: { onHandQty: 6, reservedQty: 2 }, lotNos: ['A', 'B'] })]).toEqual([
      ['inventory.onHandQty', '6'],
      ['inventory.reservedQty', '2'],
      ['lotNos', 'A, B'],
    ]);
  });

  it('값 표시: null은 -, 참거짓은 예/아니오, 빈 문자열은 (빈 값)', () => {
    expect(formatDiffValue(null)).toBe('-');
    expect(formatDiffValue(true)).toBe('예');
    expect(formatDiffValue('')).toBe('(빈 값)');
    expect(formatDiffValue([])).toBe('(없음)');
  });

  it('바뀐 줄만 changed', () => {
    const rows = diffRows({ shipmentRequestStatus: 'ALLOCATED', customerId: 1 }, { shipmentRequestStatus: 'ISSUED', customerId: 1 });
    expect(rows).toEqual([
      { key: 'shipmentRequestStatus', before: '배정 확정', after: '출고 완료', changed: true },
      { key: 'customerId', before: '1', after: '1', changed: false },
    ]);
  });

  it('공통 코드 값은 표시명으로 (배정·예약·검사·불합격 상태)', () => {
    expect(diffRows({ allocationStatus: 'CONFIRMED', allocationPurpose: 'HOT_ROLLING' }, { allocationStatus: 'RELEASED', allocationPurpose: 'HOT_ROLLING' })).toEqual([
      { key: 'allocationStatus', before: '배정 확정', after: '해제', changed: true },
      { key: 'allocationPurpose', before: '열연 투입', after: '열연 투입', changed: false },
    ]);
    expect(flattenJson({ reservationStatus: 'CONVERTED', dispositionStatus: 'HOLD', inspectionResult: 'FAIL', items: [{ lineNo: 1, salesOrderItemStatus: 'CANCELLED' }] })).toEqual(
      new Map([
        ['reservationStatus', '출고 전환'],
        ['dispositionStatus', '보류'],
        ['inspectionResult', '불합격'],
        ['items.1.salesOrderItemStatus', '취소'],
      ]),
    );
    // 코드 칸이 아닌 키는 그대로
    expect(formatDiffValue('CONFIRMED', 'note')).toBe('CONFIRMED');
  });

  it('객체 배열(검사 값)은 항목 코드별로 펴서 줄 단위로 비교한다', () => {
    const rows = diffRows(
      { inspectionResult: 'FAIL', values: [{ inspectionItemCode: 'C', measuredValue: '0.25', isPassed: false }, { inspectionItemCode: 'TS', measuredValue: '450', isPassed: true }] },
      { inspectionResult: 'PASS', values: [{ inspectionItemCode: 'C', measuredValue: '0.15', isPassed: true }, { inspectionItemCode: 'TS', measuredValue: '450', isPassed: true }] },
    );
    expect(rows).toEqual([
      { key: 'inspectionResult', before: '불합격', after: '합격', changed: true },
      { key: 'values.C.measuredValue', before: '0.25', after: '0.15', changed: true },
      { key: 'values.C.isPassed', before: '아니오', after: '예', changed: true },
      { key: 'values.TS.measuredValue', before: '450', after: '450', changed: false },
      { key: 'values.TS.isPassed', before: '예', after: '예', changed: false },
    ]);
    expect(rows.some((r) => (r.before ?? '').includes('{') || (r.after ?? '').includes('{'))).toBe(false);
  });

  it('변경 전만 있거나 둘 다 없으면', () => {
    expect(diffRows(null, { a: 1 })).toEqual([{ key: 'a', before: undefined, after: '1', changed: true }]);
    expect(diffRows(null, null)).toEqual([]);
  });
});

describe('점 색 (화면 공통)', () => {
  it('불합격 판정·불합격 처리 상태 지정은 빨강, 그 밖은 주체로', () => {
    expect(eventTone({ businessEventType: 'INSPECTION_REGISTERED', actorType: 'USER', afterData: { inspectionResult: 'FAIL' } })).toBe('danger');
    expect(eventTone({ businessEventType: 'DISPOSITION_SET', actorType: 'USER', afterData: null })).toBe('danger');
    expect(eventTone({ businessEventType: 'INSPECTION_REGISTERED', actorType: 'USER', afterData: { inspectionResult: 'PASS' } })).toBe('run');
    expect(eventTone({ businessEventType: 'RESERVATION_CREATED', actorType: 'SYSTEM', afterData: null })).toBe('neutral');
    expect(isFailureEvent({ businessEventType: 'SALES_ORDER_CREATED', actorType: 'USER', afterData: { inspectionResult: 'FAIL' } })).toBe(false);
  });
});

describe('대상', () => {
  it('테이블 이름은 용어 사전 한글명, 없는 테이블은 DB명', () => {
    expect(targetTableLabel('production_result')).toBe('작업 실적');
    expect(targetTableLabel('quality_inspection')).toBe('품질검사');
    expect(targetTableLabel('number_sequence')).toBe('number_sequence');
  });

  it('이동 화면', () => {
    expect(targetHref({ targetType: 'sales_order', targetId: 3, targetNo: 'SO-2610-001', salesOrderId: 3 })).toBe('/sales-orders/3');
    expect(targetHref({ targetType: 'lot', targetId: 9, targetNo: 'HT-BOF1-261001-001', salesOrderId: null })).toBe('/lots/trace?lot=HT-BOF1-261001-001');
    expect(targetHref({ targetType: 'reservation', targetId: 1, targetNo: null, salesOrderId: null })).toBeNull();
    expect(targetHref({ targetType: 'shipment_request', targetId: 2, targetNo: 'DR-2610-0001', salesOrderId: 1 })).toBe('/shipment-requests/2');
    expect(targetHref({ targetType: 'shipment_request_item', targetId: 5, targetNo: 'DR-2610-0001', salesOrderId: 1, shipmentRequestId: 2 })).toBe('/shipment-requests/2');
    expect(targetHref({ targetType: 'shipment_request_item', targetId: 5, targetNo: 'DR-2610-0001', salesOrderId: 1 })).toBeNull();
  });
});
