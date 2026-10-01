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
      { key: 'shipmentRequestStatus', before: 'ALLOCATED', after: 'ISSUED', changed: true },
      { key: 'customerId', before: '1', after: '1', changed: false },
    ]);
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
  });
});
