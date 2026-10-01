// 검사·불합격·재생산·히트 불합격 연쇄 (REQ-QC-001~004, REQ-INV-004·007, REQ-PRD-006, BP-QC-01)
import { describe, expect, it } from 'vitest';
import { insertRow, updateRow } from '@/mock/store';
import {
  confirmShipmentAllocations,
  createReproductionPlan,
  inspectionFormOf,
  inspectionQueue,
  itemShortageOf,
  rejectedLots,
  registerInspection,
  setDisposition,
  shipmentRecommendation,
} from '@/mock/services';
import { createKit, expectCode, expectInputError } from '@/mock/services/tests/kit';

const findSoItem = (k: ReturnType<typeof createKit>, salesOrderNo: string, lineNo = 1) => {
  const so = k.tables.salesOrder.find((s) => s.salesOrderNo === salesOrderNo);
  const item = k.tables.salesOrderItem.find((i) => i.salesOrderId === so?.id && i.lineNo === lineNo);
  if (!item) throw new Error(salesOrderNo);
  return item;
};

describe('검사 입력·자동 판정', () => {
  it('코일: 두께 구간(초과~이하) 항목만, 샤르피는 6mm 이하 코일에 없다. 경계값은 합격, 벗어나면 불합격', () => {
    const k = createKit();
    const coil = k.tables.lot.find((l) => l.lotType === 'COIL');
    if (!coil) throw new Error('코일 없음');
    const form = inspectionFormOf(k.tables, coil.id);
    expect(form.standard?.inspectionStandardCode).toBe('QS-SM355B-HR');
    expect(form.items.map((i) => i.inspectionItemCode)).toEqual(['YIELD_STRENGTH', 'TENSILE_STRENGTH', 'ELONGATION', 'THICKNESS_TOL', 'WIDTH_TOL', 'CAMBER']);
    expect(form.items.find((i) => i.inspectionItemCode === 'THICKNESS_TOL')).toMatchObject({ minValue: '-0.28', maxValue: '0.28' });
    const so3Coil = findSoItem(k, 'SO-2609-003', 1);
    expect(itemShortageOf(k.tables, so3Coil).activeReservedQty).toBe(3);

    k.inspect('2026-10-01T09:00:00+09:00', coil.id, { YIELD_STRENGTH: '355', TENSILE_STRENGTH: '630' });
    expect(k.tables.qualityInspection.find((q) => q.lotId === coil.id)?.inspectionResult).toBe('PASS');
    const failed = k.inspect('2026-10-01T09:10:00+09:00', coil.id, { YIELD_STRENGTH: '354.9' });
    expect(k.tables.lot.find((l) => l.id === coil.id)?.isPassed).toBe(false);
    expect(failed.excludedLotQty).toBe(1);
    // 예약 가용이 음수가 되므로 그 계획의 수주 예약만 1매 줄인다 (QUALITY_FAILURE·SYSTEM)
    expect(itemShortageOf(k.tables, so3Coil).activeReservedQty).toBe(2);
    const released = k.tables.businessEvent.filter((e) => e.businessEventType === 'RESERVATION_RELEASED' && e.reasonCode === 'QUALITY_FAILURE');
    expect(released).toHaveLength(1);
    expect(released[0].actorType).toBe('SYSTEM');
    // 전후 값이 작업 로그에 남는다
    const edit = k.tables.businessEvent.filter((e) => e.businessEventType === 'INSPECTION_REGISTERED' && e.targetNo === coil.lotNo).at(-1);
    expect(JSON.stringify(edit?.beforeData)).toContain('"inspectionResult":"PASS"');
    expect(JSON.stringify(edit?.afterData)).toContain('"inspectionResult":"FAIL"');
    k.expectClean();
  });

  it('필수 항목이 비면 PENDING(판정 대기), 기준에 없는 항목은 입력 오류', () => {
    const k = createKit();
    const pending = k.tables.lot.find((l) => l.lotType === 'SLAB' && l.isPassed === null && l.lotStatus === 'AVAILABLE');
    if (!pending) throw new Error('판정 대기 슬래브 없음');
    const form = inspectionFormOf(k.tables, pending.id);
    registerInspection(k.at('2026-10-01T09:00:00+09:00'), k.actor('quality'), {
      lotId: pending.id,
      values: form.items.slice(0, 2).map((i) => ({ inspectionStandardItemId: i.inspectionStandardItemId, measuredValue: '0' })),
    });
    expect(k.tables.qualityInspection.find((q) => q.lotId === pending.id)?.inspectionResult).toBe('PENDING');
    expect(k.tables.lot.find((l) => l.id === pending.id)?.isPassed).toBeNull();
    expectInputError(() => registerInspection(k.at('2026-10-01T09:01:00+09:00'), k.actor('quality'), { lotId: pending.id, values: [{ inspectionStandardItemId: 99999, measuredValue: '1' }] }));
    expectInputError(() => registerInspection(k.at('2026-10-01T09:01:00+09:00'), k.actor('quality'), { lotId: pending.id, values: [{ inspectionStandardItemId: form.items[0].inspectionStandardItemId, measuredValue: '1.23456' }] }));
    // 화면을 연 뒤 다른 곳에서 바뀌었으면 COM-001
    expectCode(
      () => registerInspection(k.at('2026-10-01T09:02:00+09:00'), k.actor('quality'), { lotId: pending.id, values: [], expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }),
      'COM-001',
    );
  });

  it('기준 버전: 값을 넣은 검사는 그때 버전을 유지하고, 값 없는 판정 대기는 현재 버전으로 판정한다', () => {
    const k = createKit();
    const t = k.tables;
    const old = t.inspectionStandard.find((s) => s.inspectionStandardCode === 'QS-SM355B-CC' && s.isCurrent);
    if (!old) throw new Error('기준 없음');
    // 검사 기준 화면이 새 버전을 만든 상황
    const tx = k.at('2026-10-01T08:00:00+09:00');
    updateRow(tx, 'inspectionStandard', old.id, { isCurrent: false });
    const v2 = insertRow(tx, 'inspectionStandard', { inspectionStandardCode: old.inspectionStandardCode, version: 2, processType: old.processType, steelGradeId: old.steelGradeId, isCurrent: true });
    for (const item of t.inspectionStandardItem.filter((i) => i.inspectionStandardId === old.id)) {
      insertRow(tx, 'inspectionStandardItem', { ...item, inspectionStandardId: v2.id, maxValue: item.inspectionItemCode === 'SURFACE_DEFECT_DEPTH' ? '1.50' : item.maxValue });
    }
    const judged = t.lot.find((l) => l.lotType === 'SLAB' && l.isPassed === true && l.steelGradeId === old.steelGradeId && l.lotStatus === 'AVAILABLE');
    const pending = t.lot.find((l) => l.lotType === 'SLAB' && l.isPassed === null && l.steelGradeId === old.steelGradeId);
    if (!judged || !pending) throw new Error('시드 LOT 없음');
    expect(inspectionFormOf(t, judged.id).standard).toMatchObject({ version: 1, isCurrent: false });
    expect(inspectionFormOf(t, pending.id).standard).toMatchObject({ version: 2, isCurrent: true });
    k.inspect('2026-10-01T09:00:00+09:00', pending.id, { SURFACE_DEFECT_DEPTH: '1.80' });
    expect(t.qualityInspection.find((q) => q.lotId === pending.id)).toMatchObject({ inspectionStandardId: v2.id, inspectionResult: 'FAIL' });
  });

  it('검사 대상 목록: 판정 대기 먼저, 밀시트에 들어간 LOT은 잠김', () => {
    const k = createKit();
    const queue = inspectionQueue(k.tables);
    const firstJudged = queue.findIndex((r) => r.inspectionResult !== 'PENDING');
    expect(queue.slice(0, firstJudged).every((r) => r.inspectionResult === 'PENDING')).toBe(true);
    expect(queue.filter((r) => r.inspectionResult === 'PENDING').map((r) => r.lotType).sort()).toEqual(['HEAT', 'SLAB', 'SLAB']);
    const shippedHeat = queue.find((r) => r.lotNo === 'HT-BOF1-260905-001');
    expect(shippedHeat?.locked).toBe(true);
    expectInputError(() => k.inspect('2026-10-01T09:00:00+09:00', shippedHeat?.lotId ?? 0), 'lotId');
  });
});

describe('히트 불합격 연쇄·불합격 처리·재생산', () => {
  it('히트 불합격 → 하위 슬래브 제외, 배정 RELEASED(QUALITY_FAILURE), 부족분만 예약 조정', () => {
    const k = createKit();
    const t = k.tables;
    const so2Item = findSoItem(k, 'SO-2609-002');
    const so4Item = findSoItem(k, 'SO-2609-004');
    // 배정 대기 출하요청 DR-2609-0002에 FIFO 6매 배정
    const request = t.shipmentRequest.find((r) => r.shipmentRequestNo === 'DR-2609-0002');
    if (!request) throw new Error('출하요청 없음');
    const [line] = shipmentRecommendation(t, request.id);
    confirmShipmentAllocations(k.at('2026-10-01T09:00:00+09:00'), k.actor('sales'), { shipmentRequestId: request.id, lines: [{ shipmentRequestItemId: line.shipmentRequestItemId, lotIds: line.recommendedLots.map((l) => l.lotId) }] });
    expect(t.shipmentRequest.find((r) => r.id === request.id)?.shipmentRequestStatus).toBe('ALLOCATED');

    const plan = t.productionPlan.find((p) => p.productionPlanNo === 'PP-2609-0002');
    const heat2 = k.lotsOfPlan(plan?.id ?? 0, 'HEAT')[1];
    k.inspect('2026-10-01T10:00:00+09:00', heat2.id, { P: '0.050' });
    expect(t.lot.find((l) => l.id === heat2.id)?.isPassed).toBe(false);
    // 적격 15 → 7, ACTIVE 15(12+3) → SO-002 예약만 8매 줄어 4, SO-004는 그대로 3
    expect(itemShortageOf(t, so2Item)).toMatchObject({ activeReservedQty: 4, unsecuredQty: 8, reproductionNeedQty: 8 });
    expect(itemShortageOf(t, so4Item).activeReservedQty).toBe(3);
    // 배정된 히트2 슬래브는 RELEASED, 예약보다 많은 배정도 풀린다
    const allocations = t.allocation.filter((a) => a.shipmentRequestItemId === line.shipmentRequestItemId);
    expect(allocations.filter((a) => a.allocationStatus === 'CONFIRMED').length).toBeLessThanOrEqual(4);
    expect(t.businessEvent.filter((e) => e.businessEventType === 'ALLOCATION_RELEASED').every((e) => e.reasonCode === 'QUALITY_FAILURE')).toBe(true);
    expect(t.shipmentRequest.find((r) => r.id === request.id)?.shipmentRequestStatus).toBe('REQUESTED');
    // 불합격 관리: 히트 자체 + 히트 불합격으로 제외된 하위 슬래브
    const rejected = rejectedLots(t);
    expect(rejected.find((r) => r.lotId === heat2.id)?.reason).toBe('FAILED');
    expect(rejected.filter((r) => r.heatLotNo === heat2.lotNo && r.reason === 'HEAT_FAILED')).toHaveLength(8);
    k.expectClean();
  });

  it('불합격 처리 상태 지정: 불합격 LOT만, 사유 필수, DISPOSITION_SET', () => {
    const k = createKit();
    const failed = k.tables.lot.find((l) => l.lotType === 'SLAB' && l.isPassed === false);
    const passed = k.tables.lot.find((l) => l.lotType === 'SLAB' && l.isPassed === true && k.tables.lot.find((h) => h.id === l.heatLotId)?.isPassed === true);
    if (!failed || !passed) throw new Error('시드 LOT 없음');
    expect(failed.dispositionStatus).toBeNull();
    expectInputError(() => setDisposition(k.at('2026-10-01T09:00:00+09:00'), k.actor('quality'), { lotId: passed.id, dispositionStatus: 'HOLD', dispositionReason: '확인' }), 'lotId');
    expectInputError(() => setDisposition(k.at('2026-10-01T09:00:00+09:00'), k.actor('quality'), { lotId: failed.id, dispositionStatus: 'HOLD', dispositionReason: '' }), 'dispositionReason');
    const updated = setDisposition(k.at('2026-10-01T09:00:00+09:00'), k.actor('quality'), { lotId: failed.id, dispositionStatus: 'DOWNGRADED', dispositionReason: '표면 결함 깊이 초과, 격하 판매 검토' });
    expect(updated).toMatchObject({ dispositionStatus: 'DOWNGRADED', lotStatus: 'AVAILABLE' });
    expect(k.tables.businessEvent.at(-1)).toMatchObject({ businessEventType: 'DISPOSITION_SET', targetType: 'lot', targetNo: failed.lotNo });
    // 히트 불합격 하위 LOT도 지정할 수 있다
    const heatFailedChild = k.tables.lot.find((l) => l.lotType === 'SLAB' && k.tables.lot.find((h) => h.id === l.heatLotId)?.isPassed === false);
    expect(setDisposition(k.at('2026-10-01T09:10:00+09:00'), k.actor('quality'), { lotId: heatFailedChild?.id ?? 0, dispositionStatus: 'SCRAPPED', dispositionReason: '히트 P 초과' }).dispositionStatus).toBe('SCRAPPED');
  });

  it('재생산: 여재도 진행 계획도 없을 때만, 사람이 만든다 (REPRODUCTION_PLAN_CREATED)', () => {
    const k = createKit();
    const item = findSoItem(k, 'SO-2609-005');
    expect(itemShortageOf(k.tables, item)).toMatchObject({ unsecuredQty: 8, openPlanRemainingQty: 0, additionalPlanQty: 8, reproductionNeedQty: 8 });
    const { plan, reservedFromSurplusQty } = createReproductionPlan(k.at('2026-10-01T09:00:00+09:00'), k.actor('productionHead'), { salesOrderItemId: item.id });
    expect(reservedFromSurplusQty).toBe(0);
    expect(plan).toMatchObject({ isReproduction: true, shortageQty: 8, salesOrderItemId: item.id, productionPlanStatus: 'PLANNED' });
    expect(k.tables.businessEvent.find((e) => e.businessEventType === 'REPRODUCTION_PLAN_CREATED')).toMatchObject({ reasonCode: 'ORDER_SHORTAGE', actorType: 'USER' });
    expect(itemShortageOf(k.tables, item)).toMatchObject({ openPlanRemainingQty: 8, reproductionNeedQty: 0 });
    expectInputError(() => createReproductionPlan(k.at('2026-10-01T09:05:00+09:00'), k.actor('productionHead'), { salesOrderItemId: item.id }));
  });

  it('재생산 전에 같은 규격 여재로 먼저 채운다', () => {
    const k = createKit();
    const t = k.tables;
    // SO-2609-002 히트2 불합격 → 8매 부족, 같은 규격 여재 없음 → 재생산 8
    const plan = t.productionPlan.find((p) => p.productionPlanNo === 'PP-2609-0002');
    k.inspect('2026-10-01T10:00:00+09:00', k.lotsOfPlan(plan?.id ?? 0, 'HEAT')[1].id, { P: '0.050' });
    const item = findSoItem(k, 'SO-2609-002');
    expect(itemShortageOf(t, item).reproductionNeedQty).toBe(8);
    // 히트2를 다시 합격으로 고치면 하위 슬래브가 다시 적격 → 예약 가용 8 → 재생산이 아니라 여재 예약
    k.inspect('2026-10-01T11:00:00+09:00', k.lotsOfPlan(plan?.id ?? 0, 'HEAT')[1].id, { P: '0.020' });
    expect(itemShortageOf(t, item)).toMatchObject({ activeReservedQty: 12, reproductionNeedQty: 0 });
    k.expectClean();
  });
});
