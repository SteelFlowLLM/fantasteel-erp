// 확장 유형(REQ-ACT-005) 추출값 검증·미확정 칸·저장값 읽기를 DB 없이 확인한다.
import { AppException } from '../../../common/errors/app.exception';
import { extractTimeoutMs } from '../draft-extractor';
import { allocationPayloadOf, allocationUnresolvedFields } from './allocation.action';
import { datePatch, extractedQtyOf, idPatch, linesPatch, matchOne, qtyPatch } from './draft-values';
import { reproductionPlanPayloadOf, reproductionPlanUnresolvedFields } from './reproduction-plan.action';
import { salesOrderFromExtraction, salesOrderPayloadOf, salesOrderUnresolvedFields } from './sales-order.action';
import { shipmentRequestPayloadOf, shipmentRequestUnresolvedFields } from './shipment-request.action';

const customers = [
  { id: 1, customerCode: 'CUS-01', customerName: '가람중공업' },
  { id: 2, customerCode: 'CUS-02', customerName: '나래조선' },
];
const items = [
  { id: 11, itemCode: 'SL-SS275-250x1200x10000', itemName: 'SS275 슬래브 250×1200×10000', itemType: 'SLAB' },
  { id: 12, itemCode: 'CL-SS275-6x1200x10000', itemName: 'SS275 코일 6×1200×10000', itemType: 'COIL' },
];

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

describe('LLM 값 읽기', () => {
  it('매수는 1 이상 정수만 받고 톤·소수·0은 버린다', () => {
    expect(extractedQtyOf(20)).toBe(20);
    expect(extractedQtyOf(' 1,200매 ')).toBe(1200);
    expect(extractedQtyOf('10.5')).toBeNull();
    expect(extractedQtyOf(0)).toBeNull();
    expect(extractedQtyOf('6t')).toBeNull();
    expect(extractedQtyOf(null)).toBeNull();
  });

  it('이름·코드는 후보 하나와 정확히 맞을 때만 고른다 (대소문자·공백 무시, 여럿이면 null)', () => {
    expect(matchOne(customers, ' 가람중공업 ', (c) => [c.customerName, c.customerCode])?.id).toBe(1);
    expect(matchOne(customers, 'cus-02', (c) => [c.customerName, c.customerCode])?.id).toBe(2);
    expect(matchOne(customers, '가람', (c) => [c.customerName, c.customerCode])).toBeNull();
    expect(matchOne([...customers, { id: 3, customerCode: 'X', customerName: '나래조선' }], '나래조선', (c) => [c.customerName])).toBeNull();
  });
});

describe('수주 등록 초안 (SALES_ORDER_CREATE)', () => {
  it('맞는 고객사·규격·매수·납기만 채우고 채운 칸을 남긴다. 빈 줄은 버린다', () => {
    const payload = salesOrderFromExtraction(
      {
        customerName: '가람중공업',
        items: [
          { itemCode: 'SL-SS275-250x1200x10000', orderedQty: '20', dueDate: '2026-10-30' },
          { itemCode: 'SS275', orderedQty: 6, dueDate: '2026-02-30' },
          { itemCode: 'SS275', orderedQty: 6.5, dueDate: null },
          { itemCode: null, orderedQty: null, dueDate: null },
        ],
      },
      customers,
      items,
      '가람중공업 SS275 슬래브 20매',
    );
    expect(payload).toEqual({
      customerId: 1,
      items: [
        { itemId: 11, orderedQty: 20, dueDate: '2026-10-30' },
        { itemId: null, orderedQty: 6, dueDate: null },
      ],
      sourceText: '가람중공업 SS275 슬래브 20매',
      aiFilledFields: ['customerId', 'items'],
    });
  });

  it('LLM이 아무것도 못 찾으면 빈 초안이고 AI가 채운 칸도 없다', () => {
    expect(salesOrderFromExtraction({ customerName: '없는 회사', items: 'x' }, customers, items, null)).toEqual({ customerId: null, items: [], sourceText: null, aiFilledFields: [] });
  });

  it('미확정 칸: 고객사, 품목 없음, 줄마다 규격·매수·납기', () => {
    const payload = salesOrderPayloadOf({ customerId: 9, items: [{ itemId: 11, orderedQty: 3, dueDate: '2026-11-01' }, { itemId: 99, orderedQty: 0, dueDate: 'x' }] });
    expect(salesOrderUnresolvedFields(payload, false, new Set([11, 12]))).toEqual(['고객사', '품목 2 규격', '품목 2 매수', '품목 2 납기']);
    expect(salesOrderUnresolvedFields(salesOrderPayloadOf({ customerId: 1 }), true, new Set())).toEqual(['품목']);
  });

  it('저장값을 읽을 때 형식이 틀린 칸은 비운다', () => {
    expect(salesOrderPayloadOf({ customerId: '1', items: [{ itemId: 11, orderedQty: 2.5, dueDate: '2026-11-01' }, 'x'], aiFilledFields: ['customerId', 3] })).toEqual({
      customerId: null,
      items: [{ itemId: 11, orderedQty: null, dueDate: '2026-11-01' }],
      sourceText: null,
      aiFilledFields: ['customerId'],
      aiExtraction: null,
    });
  });
});

describe('출하요청 초안 (SHIPMENT_REQUEST_CREATE)', () => {
  const soItem = (id: number, customerId: number, status = 'OPEN') => ({
    id,
    salesOrderItemStatus: status,
    salesOrder: { id: 100 + id, salesOrderNo: `SO-${id}`, customerId, customer: { customerName: '' }, salesOrderItems: [{ id }] },
  });

  it('수주 품목은 진행 중이고 고른 고객사의 것이어야 하고, 같은 품목을 두 줄에 넣을 수 없다', () => {
    const payload = shipmentRequestPayloadOf({
      customerId: 1,
      shipDate: '2026-11-03',
      items: [
        { salesOrderItemId: 1, requestQty: 3 },
        { salesOrderItemId: 2, requestQty: 2 },
        { salesOrderItemId: 3, requestQty: null },
        { salesOrderItemId: 1, requestQty: 1 },
      ],
    });
    expect(shipmentRequestUnresolvedFields(payload, true, [soItem(1, 1), soItem(2, 2), soItem(3, 1, 'SHIPPED')])).toEqual(['품목 2 수주 품목', '품목 3 수주 품목', '품목 3 매수', '품목 4 수주 품목']);
  });

  it('출하 예정일은 선택이라 비어도 미확정이 아니다', () => {
    const payload = shipmentRequestPayloadOf({ customerId: 1, items: [{ salesOrderItemId: 1, requestQty: 3 }] });
    expect(payload.shipDate).toBeNull();
    expect(shipmentRequestUnresolvedFields(payload, true, [soItem(1, 1)])).toEqual([]);
  });
});

describe('배정 확정 초안 (ALLOCATION_CONFIRM)', () => {
  it('출하요청 품목이 열려 있고 LOT이 하나 이상이어야 한다', () => {
    const open = { shipmentRequest: { id: 1, shipmentRequestNo: 'DR-1', shipmentRequestStatus: 'REQUESTED', customer: { customerName: '' }, shipmentRequestItems: [] } };
    const issued = { shipmentRequest: { ...open.shipmentRequest, shipmentRequestStatus: 'ISSUED' } };
    expect(allocationUnresolvedFields(allocationPayloadOf({ shipmentRequestItemId: 5, lotIds: [7, 8] }), open)).toEqual([]);
    expect(allocationUnresolvedFields(allocationPayloadOf({ shipmentRequestItemId: 5, lotIds: [] }), issued)).toEqual(['출하요청 품목', '배정 LOT']);
  });

  it('저장된 LOT 목록은 양의 정수만, 겹치면 하나로 읽는다', () => {
    expect(allocationPayloadOf({ shipmentRequestItemId: 5, lotIds: [3, 3, -1, '4', 2] }).lotIds).toEqual([3, 2]);
  });
});

describe('재생산 계획 초안 (REPRODUCTION_PLAN_CREATE)', () => {
  it('수주 품목이 진행 중(진행중·부분출하)이어야 한다', () => {
    expect(reproductionPlanUnresolvedFields({ salesOrderItemStatus: 'PARTIALLY_SHIPPED' })).toEqual([]);
    expect(reproductionPlanUnresolvedFields({ salesOrderItemStatus: 'CANCELLED' })).toEqual(['수주 품목']);
    expect(reproductionPlanUnresolvedFields(undefined)).toEqual(['수주 품목']);
    expect(reproductionPlanPayloadOf({ salesOrderItemId: 4, aiFilledFields: ['salesOrderItemId'] })).toEqual({ salesOrderItemId: 4, sourceText: null, aiFilledFields: ['salesOrderItemId'], aiExtraction: null });
    expect(reproductionPlanPayloadOf({ salesOrderItemId: 4, aiExtraction: 'TIMEOUT' }).aiExtraction).toBe('TIMEOUT');
    expect(reproductionPlanPayloadOf({ salesOrderItemId: 4, aiExtraction: 'SOMETHING' }).aiExtraction).toBeNull();
  });
});

describe('수정 요청 칸 검증', () => {
  it('id·매수·날짜·줄 목록 형식이 틀리면 COM-004', () => {
    expect(idPatch(undefined, '')).toBeUndefined();
    expect(idPatch(null, '')).toBeNull();
    expect(codeOf(() => idPatch('3', ''))).toBe('COM-004');
    expect(qtyPatch('', '')).toBeNull();
    expect(codeOf(() => qtyPatch(10.5, ''))).toBe('COM-004');
    expect(datePatch(' 2026-11-01 ', '')).toBe('2026-11-01');
    expect(codeOf(() => datePatch('2026-02-30', ''))).toBe('COM-004');
    expect(linesPatch(null)).toEqual([]);
    expect(codeOf(() => linesPatch([1, 2]))).toBe('COM-004');
    expect(codeOf(() => linesPatch(Array.from({ length: 21 }, () => ({}))))).toBe('COM-004');
  });
});

describe('AI 추출 제한 시간 (이슈 #472)', () => {
  it('기본 90초, MESSAGE_EXTRACT_TIMEOUT_SECONDS로 1~600초 사이에서 바꾼다', () => {
    expect(extractTimeoutMs(undefined)).toBe(90_000);
    expect(extractTimeoutMs('45')).toBe(45_000);
    expect(extractTimeoutMs('')).toBe(90_000);
    expect(extractTimeoutMs('0')).toBe(90_000);
    expect(extractTimeoutMs('9999')).toBe(90_000);
    expect(extractTimeoutMs('abc')).toBe(90_000);
  });
});
