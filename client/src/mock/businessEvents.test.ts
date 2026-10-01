import { describe, expect, it } from 'vitest';
import type { EventReasonCode } from '@/codes';
import { recordBusinessEvent } from '@/mock/businessEvents';
import { createSeedTables } from '@/mock/seed';
import { issueBusinessNo, issueHeatLotNo, issueSlabLotNo } from '@/mock/sequence';
import type { MockTx } from '@/mock/store';

function createTx(nowIso: string): MockTx {
  return { tables: createSeedTables(), now: new Date(nowIso), nowIso };
}

describe('recordBusinessEvent', () => {
  it('EV-YYMMDD-NNN 번호를 날짜(서울)마다 1부터 매긴다', () => {
    const tx = createTx('2026-10-01T01:00:00.000Z');
    const base = { businessEventType: 'SALES_ORDER_CREATED', actor: { actorType: 'USER', employeeId: 2 }, targetType: 'sales_order', targetId: 1 } as const;
    expect(recordBusinessEvent(tx, base).eventNo).toBe('EV-261001-001');
    expect(recordBusinessEvent(tx, base).eventNo).toBe('EV-261001-002');
    // UTC 15시 이후 = 서울 다음 날
    expect(recordBusinessEvent(tx, { ...base, occurredAt: '2026-10-01T15:10:00.000Z' }).eventNo).toBe('EV-261002-001');
  });

  it('SYSTEM 주체는 사원 없이, 사유 코드와 전후 값을 남긴다', () => {
    const tx = createTx('2026-10-01T01:00:00.000Z');
    const after = { reservedQty: 6 };
    const row = recordBusinessEvent(tx, {
      businessEventType: 'RESERVATION_CREATED',
      actor: { actorType: 'SYSTEM' },
      targetType: 'reservation',
      targetId: 7,
      salesOrderId: 3,
      afterData: after,
      reasonCode: 'STOCK_FIRST',
      reasonText: '합격 재고 우선 예약',
    });
    after.reservedQty = 99;
    expect(row).toMatchObject({ actorType: 'SYSTEM', actorEmployeeId: null, reasonCode: 'STOCK_FIRST', salesOrderId: 3, isAiAssisted: false });
    expect(row.afterData).toEqual({ reservedQty: 6 });
  });

  it('LOT 연결은 LOT마다 한 줄씩 만든다', () => {
    const tx = createTx('2026-10-01T01:00:00.000Z');
    const row = recordBusinessEvent(tx, {
      businessEventType: 'GOODS_ISSUE_CONFIRMED',
      actor: { actorType: 'USER', employeeId: 15 },
      targetType: 'shipment_request',
      targetId: 1,
      lotIds: [10, 11, 10],
    });
    expect(tx.tables.businessEventLot.filter((l) => l.businessEventId === row.id).map((l) => l.lotId)).toEqual([10, 11]);
  });

  it('없는 사원·허용되지 않은 사유 코드는 거부한다', () => {
    const tx = createTx('2026-10-01T01:00:00.000Z');
    expect(() =>
      recordBusinessEvent(tx, { businessEventType: 'SALES_ORDER_CREATED', actor: { actorType: 'USER', employeeId: 999 }, targetType: 'sales_order', targetId: 1 }),
    ).toThrow();
    expect(() =>
      recordBusinessEvent(tx, {
        businessEventType: 'SALES_ORDER_CANCELLED',
        actor: { actorType: 'SYSTEM' },
        targetType: 'sales_order',
        targetId: 1,
        reasonCode: 'CUSTOMER_REQUEST' as EventReasonCode,
      }),
    ).toThrow();
    expect(tx.tables.businessEvent).toHaveLength(0);
  });
});

describe('채번 카운터', () => {
  it('업무 번호는 월마다, 슬래브는 히트마다 1부터', () => {
    const tx = createTx('2026-10-01T01:00:00.000Z');
    expect(issueBusinessNo(tx, 'SALES_ORDER')).toBe('SO-2610-001');
    expect(issueBusinessNo(tx, 'SALES_ORDER')).toBe('SO-2610-002');
    expect(issueBusinessNo(tx, 'SALES_ORDER', new Date('2026-11-02T00:00:00.000Z'))).toBe('SO-2611-001');
    expect(issueBusinessNo(tx, 'PURCHASE_REQUISITION')).toBe('PR-2610-0001');
    const heatNo = issueHeatLotNo(tx, 'BOF1');
    expect(heatNo).toBe('HT-BOF1-261001-001');
    expect(issueSlabLotNo(tx, heatNo)).toBe('HT-BOF1-261001-001-01');
    expect(issueSlabLotNo(tx, heatNo)).toBe('HT-BOF1-261001-001-02');
    expect(tx.tables.numberSequence.find((s) => s.sequenceKey === 'SO-2610')?.lastValue).toBe(2);
  });
});
