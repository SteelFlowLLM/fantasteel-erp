// 테스트 전용 고정 데이터: 원료 → 용선 → 히트(+합금철) → 슬래브 3매 → 코일 2개, 수주 1건, 출하요청 2건(출고 완료 1·배정 확정 1), 밀시트 1장, 작업 로그.
// 이 영역 작업 중에는 거래 시드가 없어서(core-domain이 병렬로 만든다) 테스트가 직접 넣는다. 화면 시드가 아니다.
import { recordBusinessEvent } from '@/mock/businessEvents';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { seedTxAt } from '@/mock/seeds';
import {
  coilNoOf,
  issueBusinessNo,
  issueHeatNo,
  issueHotMetalNo,
  issueMillSheetNo,
  issueRawMaterialLotNo,
  issueSlabNo,
} from '@/mock/sequence';
import { insertRow, type MockTx } from '@/mock/store';
import { resetToMasterSeed } from '@/test/masterSeed';

export interface TraceFixture {
  salesOrderId: number;
  salesOrderNo: string;
  oreLotId: number;
  oreLotNo: string;
  alloyLotId: number;
  hotMetalLotId: number;
  heatLotId: number;
  heatNo: string;
  slabLotIds: [number, number, number];
  slabNos: [string, string, string];
  coilLotIds: [number, number];
  coilNos: [string, string];
  issuedRequestId: number;
  issuedRequestNo: string;
  allocatedRequestId: number;
  allocatedRequestNo: string;
  millSheetNo: string;
  /** 같은 시각에 기록한 두 이벤트 (id 순 확인용) */
  tiedEventIds: [number, number];
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`테스트 데이터 준비 실패: ${what}`);
  return value;
}

const byNo = (tables: MockTables, employeeNo: string) => need(tables.employee.find((e) => e.employeeNo === employeeNo), employeeNo).id;

export function buildTraceFixture(): TraceFixture {
  // 거래 시드가 없는 상태에서 만든 고정 데이터라, 조직·기준정보만 남기고 시작한다
  resetToMasterSeed();
  return getMockDb().transact((root) => {
    const t = root.tables;
    const at = (iso: string): MockTx => seedTxAt(root, iso);
    const item = (code: string) => need(t.item.find((i) => i.itemCode === code), code);
    const sales = byNo(t, '2103003');
    const steelmaking = byNo(t, '2402011');
    const quality = byNo(t, '2205013');
    const logistics = byNo(t, '2304015');
    const purchase = byNo(t, '2207005');
    const customer = need(t.customer.find((c) => c.customerCode === 'CUS-01'), 'CUS-01');
    const supplier = need(t.supplier.find((s) => s.supplierCode === 'SUP-01'), 'SUP-01');
    const rmYard = need(t.yard.find((y) => y.yardType === 'RAW_MATERIAL'), 'yard').id;
    const grade = need(t.steelGrade.find((g) => g.steelGradeCode === 'SS275'), 'SS275');
    const slabItem = need(t.item.find((i) => i.itemType === 'SLAB' && i.steelGradeId === grade.id), 'slab item');
    const coilItem = need(
      t.item.find((i) => i.id === t.specMapping.find((m) => m.slabItemId === slabItem.id)?.coilItemId),
      'coil item',
    );
    const ore = item('ORE01');
    const alloy = item('SMN01');

    // 수주 (09-28)
    const tSo = at('2026-09-28T09:00:00+09:00');
    const salesOrder = insertRow(tSo, 'salesOrder', {
      salesOrderNo: issueBusinessNo(tSo, 'SALES_ORDER'),
      customerId: customer.id,
      ownerEmployeeId: sales,
      cancelledAt: null,
      cancelReason: null,
    });
    const soItem = insertRow(tSo, 'salesOrderItem', {
      salesOrderId: salesOrder.id,
      lineNo: 1,
      itemId: coilItem.id,
      orderedQty: 2,
      shippedQty: 1,
      dueDate: '2026-10-20',
      salesOrderItemStatus: 'PARTIALLY_SHIPPED',
    });
    const slabSoItem = insertRow(tSo, 'salesOrderItem', {
      salesOrderId: salesOrder.id,
      lineNo: 2,
      itemId: slabItem.id,
      orderedQty: 1,
      shippedQty: 0,
      dueDate: '2026-10-15',
      salesOrderItemStatus: 'OPEN',
    });
    recordBusinessEvent(tSo, {
      businessEventType: 'SALES_ORDER_CREATED',
      actor: { actorType: 'USER', employeeId: sales },
      targetType: 'sales_order',
      targetId: salesOrder.id,
      targetNo: salesOrder.salesOrderNo,
      salesOrderId: salesOrder.id,
      afterData: { salesOrderNo: salesOrder.salesOrderNo, customerId: customer.id },
    });
    const plan = insertRow(tSo, 'productionPlan', {
      productionPlanNo: issueBusinessNo(tSo, 'PRODUCTION_PLAN'),
      salesOrderItemId: soItem.id,
      itemId: coilItem.id,
      shortageQty: 2,
      cumulativeYieldRate: '0.860',
      requiredSteelTon: '60.000',
      heatCount: 1,
      productionPlanStatus: 'COMPLETED',
      isReproduction: false,
      isSurplusOnCompletion: false,
      createdEmployeeId: sales,
      cancelledAt: null,
    });

    // 원료 입고 (09-29): 공급업체는 입고 → 발주 품목 → 발주에서 읽는다
    const tRm = at('2026-09-29T08:00:00+09:00');
    const pr = insertRow(tRm, 'purchaseRequisition', {
      purchaseRequisitionNo: issueBusinessNo(tRm, 'PURCHASE_REQUISITION'),
      itemId: ore.id,
      requestedTon: '500.000',
      desiredReceiptDate: '2026-09-29',
      requesterId: purchase,
      approverId: null,
      approvedAt: tRm.nowIso,
      rejectReason: null,
      requestReason: null,
      productionPlanId: null,
      actionDraftId: null,
      purchaseRequisitionStatus: 'APPROVED',
    });
    const po = insertRow(tRm, 'purchaseOrder', {
      purchaseOrderNo: issueBusinessNo(tRm, 'PURCHASE_ORDER'),
      supplierId: supplier.id,
      purchaseOrderStatus: 'RECEIVED',
      dueDate: null,
      orderedEmployeeId: purchase,
    });
    const poItem = insertRow(tRm, 'purchaseOrderItem', {
      purchaseOrderId: po.id,
      lineNo: 1,
      itemId: ore.id,
      purchaseRequisitionId: pr.id,
      orderedTon: '500.000',
      receivedTon: '500.000',
      scheduledReceiptTon: '0.000',
    });
    const receipt = insertRow(tRm, 'goodsReceipt', {
      goodsReceiptNo: issueBusinessNo(tRm, 'GOODS_RECEIPT'),
      purchaseOrderItemId: poItem.id,
      receivedTon: '500.000',
      receiptDate: '2026-09-29',
      yardId: rmYard,
      confirmedEmployeeId: purchase,
      confirmedAt: tRm.nowIso,
    });
    const baseLot = {
      lotStatus: 'AVAILABLE' as const,
      steelGradeId: null,
      heatLotId: null,
      blastFurnaceCode: null,
      converterCode: null,
      yardId: null,
      goodsReceiptId: null,
      productionResultId: null,
      productionPlanId: null,
      isPassed: null,
      dispositionStatus: null,
      dispositionReason: null,
      dispositionAt: null,
      surplusAt: null,
      consumedAt: null,
      shippedAt: null,
      initialTon: null,
      remainingTon: null,
    };
    const oreLot = insertRow(tRm, 'lot', {
      ...baseLot,
      lotNo: issueRawMaterialLotNo(tRm, 'ORE01'),
      lotType: 'RAW_MATERIAL',
      itemId: ore.id,
      initialTon: '500.000',
      remainingTon: '120.000',
      yardId: rmYard,
      goodsReceiptId: receipt.id,
      producedDate: '2026-09-29',
    });
    const alloyLot = insertRow(tRm, 'lot', {
      ...baseLot,
      lotNo: issueRawMaterialLotNo(tRm, 'SMN01'),
      lotType: 'RAW_MATERIAL',
      itemId: alloy.id,
      initialTon: '20.000',
      remainingTon: '17.500',
      yardId: rmYard,
      producedDate: '2026-09-29',
    });

    // 제선 → 제강 → 연주 → 열연 (10-01)
    const tPr = at('2026-10-01T10:00:00+09:00');
    const hotMetal = insertRow(tPr, 'lot', {
      ...baseLot,
      lotNo: issueHotMetalNo(tPr, 'BF2'),
      lotType: 'HOT_METAL',
      itemId: null,
      initialTon: '300.000',
      remainingTon: '70.000',
      blastFurnaceCode: 'BF2',
      producedDate: '2026-10-01',
    });
    insertRow(tPr, 'lotRelation', {
      parentLotId: oreLot.id,
      childLotId: hotMetal.id,
      lotRelationEvidence: 'PERIOD_BASED',
      inputTon: null,
      periodStartedAt: '2026-10-01T00:00:00.000Z',
      periodEndedAt: '2026-10-01T06:00:00.000Z',
    });
    const heatNo = issueHeatNo(tPr, 'BOF1');
    const heat = insertRow(tPr, 'lot', {
      ...baseLot,
      lotNo: heatNo,
      lotType: 'HEAT',
      itemId: null,
      steelGradeId: grade.id,
      initialTon: '230.000',
      remainingTon: '0.000',
      converterCode: 'BOF1',
      productionPlanId: plan.id,
      isPassed: true,
      lotStatus: 'CONSUMED',
      consumedAt: tPr.nowIso,
      producedDate: '2026-10-01',
    });
    insertRow(tPr, 'lotRelation', { parentLotId: hotMetal.id, childLotId: heat.id, lotRelationEvidence: 'ACTUAL_INPUT', inputTon: '230.000', periodStartedAt: null, periodEndedAt: null });
    insertRow(tPr, 'lotRelation', { parentLotId: alloyLot.id, childLotId: heat.id, lotRelationEvidence: 'ACTUAL_INPUT', inputTon: '2.500', periodStartedAt: null, periodEndedAt: null });
    recordBusinessEvent(tPr, {
      businessEventType: 'PRODUCTION_RESULT_REGISTERED',
      actor: { actorType: 'USER', employeeId: steelmaking },
      targetType: 'production_plan',
      targetId: plan.id,
      targetNo: plan.productionPlanNo,
      salesOrderId: salesOrder.id,
      lotIds: [heat.id],
    });

    const slabs = [1, 2, 3].map(() =>
      insertRow(tPr, 'lot', {
        ...baseLot,
        lotNo: issueSlabNo(tPr, heatNo),
        lotType: 'SLAB',
        itemId: slabItem.id,
        steelGradeId: grade.id,
        heatLotId: heat.id,
        productionPlanId: plan.id,
        isPassed: true,
        producedDate: '2026-10-01',
      }),
    );
    const [slab1, slab2, slab3] = [need(slabs[0], 'slab1'), need(slabs[1], 'slab2'), need(slabs[2], 'slab3')];
    for (const slab of slabs) {
      insertRow(tPr, 'lotRelation', { parentLotId: heat.id, childLotId: slab.id, lotRelationEvidence: 'ACTUAL_INPUT', inputTon: null, periodStartedAt: null, periodEndedAt: null });
    }
    const coils = [slab1, slab2].map((slab) => {
      slab.lotStatus = 'CONSUMED';
      slab.consumedAt = tPr.nowIso;
      const coil = insertRow(tPr, 'lot', {
        ...baseLot,
        lotNo: coilNoOf(slab.lotNo),
        lotType: 'COIL',
        itemId: coilItem.id,
        steelGradeId: grade.id,
        heatLotId: heat.id,
        productionPlanId: plan.id,
        isPassed: true,
        producedDate: '2026-10-01',
      });
      insertRow(tPr, 'lotRelation', { parentLotId: slab.id, childLotId: coil.id, lotRelationEvidence: 'ACTUAL_INPUT', inputTon: null, periodStartedAt: null, periodEndedAt: null });
      return coil;
    });
    const [coil1, coil2] = [need(coils[0], 'coil1'), need(coils[1], 'coil2')];

    // 품질검사: 히트 합격, 코일2 불합격 (10-01 12:00, 같은 시각 두 건)
    const tQc = at('2026-10-01T12:00:00+09:00');
    const standard = insertRow(tQc, 'inspectionStandard', {
      inspectionStandardCode: 'QS-SS275-HR',
      version: 1,
      processType: 'HOT_ROLLING',
      steelGradeId: grade.id,
      isCurrent: true,
    });
    const tensile = insertRow(tQc, 'inspectionStandardItem', {
      inspectionStandardId: standard.id,
      inspectionItemCode: 'TS',
      inspectionItemName: '인장강도',
      unit: 'N/mm²',
      minValue: '410',
      maxValue: '550',
      minThicknessMm: null,
      maxThicknessMm: null,
      isRequired: true,
      sortOrder: 1,
    });
    const failed = insertRow(tQc, 'qualityInspection', {
      lotId: coil2.id,
      inspectionStandardId: standard.id,
      processType: 'HOT_ROLLING',
      inspectionResult: 'FAIL',
      inspectorEmployeeId: quality,
      inspectedAt: tQc.nowIso,
    });
    insertRow(tQc, 'qualityInspectionValue', { qualityInspectionId: failed.id, inspectionStandardItemId: tensile.id, measuredValue: '395', isPassed: false });
    coil2.isPassed = false;
    const passed = insertRow(tQc, 'qualityInspection', {
      lotId: coil1.id,
      inspectionStandardId: standard.id,
      processType: 'HOT_ROLLING',
      inspectionResult: 'PASS',
      inspectorEmployeeId: quality,
      inspectedAt: tQc.nowIso,
    });
    insertRow(tQc, 'qualityInspectionValue', { qualityInspectionId: passed.id, inspectionStandardItemId: tensile.id, measuredValue: '450', isPassed: true });
    const failEvent = recordBusinessEvent(tQc, {
      businessEventType: 'INSPECTION_REGISTERED',
      actor: { actorType: 'USER', employeeId: quality },
      targetType: 'quality_inspection',
      targetId: failed.id,
      targetNo: coil2.lotNo,
      salesOrderId: salesOrder.id,
      afterData: { inspectionResult: 'FAIL' },
      reasonCode: 'QUALITY_FAILURE',
      lotIds: [coil2.id],
    });
    const passEvent = recordBusinessEvent(tQc, {
      businessEventType: 'INSPECTION_REGISTERED',
      actor: { actorType: 'USER', employeeId: quality },
      targetType: 'quality_inspection',
      targetId: passed.id,
      targetNo: coil1.lotNo,
      salesOrderId: salesOrder.id,
      afterData: { inspectionResult: 'PASS' },
      lotIds: [coil1.id],
    });

    // 출하요청 1: 코일1 출고 완료 + 밀시트 (10-02)
    const tShip = at('2026-10-02T15:00:00+09:00');
    const issued = insertRow(tShip, 'shipmentRequest', {
      shipmentRequestNo: issueBusinessNo(tShip, 'SHIPMENT_REQUEST'),
      customerId: customer.id,
      requestedShipDate: '2026-10-02',
      shipmentRequestStatus: 'ISSUED',
      requesterId: sales,
      issuedAt: tShip.nowIso,
      issuedEmployeeId: logistics,
      cancelledAt: null,
    });
    const issuedItem = insertRow(tShip, 'shipmentRequestItem', { shipmentRequestId: issued.id, lineNo: 1, salesOrderItemId: soItem.id, requestQty: 1 });
    insertRow(tShip, 'allocation', {
      lotId: coil1.id,
      allocationPurpose: 'SHIPMENT',
      salesOrderItemId: soItem.id,
      shipmentRequestItemId: issuedItem.id,
      productionPlanId: null,
      allocationStatus: 'CONSUMED',
      confirmedEmployeeId: logistics,
      confirmedAt: tShip.nowIso,
      consumedAt: tShip.nowIso,
      releasedAt: null,
    });
    coil1.lotStatus = 'SHIPPED';
    coil1.shippedAt = tShip.nowIso;
    recordBusinessEvent(tShip, {
      businessEventType: 'GOODS_ISSUE_CONFIRMED',
      actor: { actorType: 'USER', employeeId: logistics },
      targetType: 'shipment_request',
      targetId: issued.id,
      targetNo: issued.shipmentRequestNo,
      salesOrderId: salesOrder.id,
      beforeData: { shipmentRequestStatus: 'ALLOCATED' },
      afterData: { shipmentRequestStatus: 'ISSUED' },
      lotIds: [coil1.id],
    });
    const millSheetNo = issueMillSheetNo(tShip, issued.shipmentRequestNo);
    const millSheet = insertRow(tShip, 'millSheet', {
      millSheetNo,
      shipmentRequestId: issued.id,
      salesOrderId: salesOrder.id,
      issuedAt: tShip.nowIso,
      snapshot: { millSheetNo },
      pdfPath: null,
    });
    recordBusinessEvent(tShip, {
      businessEventType: 'MILL_SHEET_ISSUED',
      actor: { actorType: 'SYSTEM' },
      targetType: 'mill_sheet',
      targetId: millSheet.id,
      targetNo: millSheetNo,
      salesOrderId: salesOrder.id,
      lotIds: [coil1.id],
    });

    // 출하요청 2: 슬래브3 배정 확정 (슬래브 출하는 코일 단계가 없다)
    const tShip2 = at('2026-10-03T09:00:00+09:00');
    const allocated = insertRow(tShip2, 'shipmentRequest', {
      shipmentRequestNo: issueBusinessNo(tShip2, 'SHIPMENT_REQUEST'),
      customerId: customer.id,
      requestedShipDate: '2026-10-10',
      shipmentRequestStatus: 'ALLOCATED',
      requesterId: sales,
      issuedAt: null,
      issuedEmployeeId: null,
      cancelledAt: null,
    });
    const allocatedItem = insertRow(tShip2, 'shipmentRequestItem', { shipmentRequestId: allocated.id, lineNo: 1, salesOrderItemId: slabSoItem.id, requestQty: 1 });
    insertRow(tShip2, 'allocation', {
      lotId: slab3.id,
      allocationPurpose: 'SHIPMENT',
      salesOrderItemId: slabSoItem.id,
      shipmentRequestItemId: allocatedItem.id,
      productionPlanId: null,
      allocationStatus: 'CONFIRMED',
      confirmedEmployeeId: logistics,
      confirmedAt: tShip2.nowIso,
      consumedAt: null,
      releasedAt: null,
    });
    recordBusinessEvent(tShip2, {
      businessEventType: 'ALLOCATION_CONFIRMED',
      actor: { actorType: 'USER', employeeId: logistics },
      targetType: 'allocation',
      targetId: slab3.id,
      targetNo: slab3.lotNo,
      salesOrderId: salesOrder.id,
      reasonCode: 'FIFO_RECOMMENDATION',
      lotIds: [slab3.id],
    });

    return {
      salesOrderId: salesOrder.id,
      salesOrderNo: salesOrder.salesOrderNo,
      oreLotId: oreLot.id,
      oreLotNo: oreLot.lotNo,
      alloyLotId: alloyLot.id,
      hotMetalLotId: hotMetal.id,
      heatLotId: heat.id,
      heatNo: heat.lotNo,
      slabLotIds: [slab1.id, slab2.id, slab3.id],
      slabNos: [slab1.lotNo, slab2.lotNo, slab3.lotNo],
      coilLotIds: [coil1.id, coil2.id],
      coilNos: [coil1.lotNo, coil2.lotNo],
      issuedRequestId: issued.id,
      issuedRequestNo: issued.shipmentRequestNo,
      allocatedRequestId: allocated.id,
      allocatedRequestNo: allocated.shipmentRequestNo,
      millSheetNo,
      tiedEventIds: [failEvent.id, passEvent.id],
    };
  });
}
