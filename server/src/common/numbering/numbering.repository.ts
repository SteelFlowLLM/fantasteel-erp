import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';
import type { DatedLotKind, DocumentNumberKind } from './number-format';

/** 같은 앞부분으로 시작하는 번호 중 가장 큰 값. 순번이 0으로 채워진 고정 자리수라 문자열 정렬이 곧 순번 순서다. */
@Injectable()
export class NumberingRepository {
  async findLastDocumentNumber(tx: Tx, kind: DocumentNumberKind, prefix: string): Promise<string | null> {
    switch (kind) {
      case 'SALES_ORDER':
        return (await tx.salesOrder.findFirst({ where: { salesOrderNo: { startsWith: prefix } }, orderBy: { salesOrderNo: 'desc' }, select: { salesOrderNo: true } }))?.salesOrderNo ?? null;
      case 'PRODUCTION_PLAN':
        return (await tx.productionPlan.findFirst({ where: { productionPlanNo: { startsWith: prefix } }, orderBy: { productionPlanNo: 'desc' }, select: { productionPlanNo: true } }))?.productionPlanNo ?? null;
      case 'PURCHASE_REQUISITION':
        return (await tx.purchaseRequisition.findFirst({ where: { purchaseRequisitionNo: { startsWith: prefix } }, orderBy: { purchaseRequisitionNo: 'desc' }, select: { purchaseRequisitionNo: true } }))?.purchaseRequisitionNo ?? null;
      case 'PURCHASE_ORDER':
        return (await tx.purchaseOrder.findFirst({ where: { purchaseOrderNo: { startsWith: prefix } }, orderBy: { purchaseOrderNo: 'desc' }, select: { purchaseOrderNo: true } }))?.purchaseOrderNo ?? null;
      case 'GOODS_RECEIPT':
        return (await tx.goodsReceipt.findFirst({ where: { goodsReceiptNo: { startsWith: prefix } }, orderBy: { goodsReceiptNo: 'desc' }, select: { goodsReceiptNo: true } }))?.goodsReceiptNo ?? null;
      case 'SHIPMENT_REQUEST':
        return (await tx.shipmentRequest.findFirst({ where: { shipmentRequestNo: { startsWith: prefix } }, orderBy: { shipmentRequestNo: 'desc' }, select: { shipmentRequestNo: true } }))?.shipmentRequestNo ?? null;
      case 'BUSINESS_EVENT':
        return (await tx.businessEvent.findFirst({ where: { businessEventNo: { startsWith: prefix } }, orderBy: { businessEventNo: 'desc' }, select: { businessEventNo: true } }))?.businessEventNo ?? null;
    }
  }

  /**
   * LOT 유형도 함께 거른다: 슬래브 번호(히트번호-SS)가 히트 번호로 시작해서 앞부분만 보면
   * 같은 날 두 번째 히트를 채번할 때 슬래브 번호(…-001-10)를 최댓값으로 잡는다.
   */
  async findLastLotNumber(tx: Tx, prefix: string, lotType: DatedLotKind): Promise<string | null> {
    return (await tx.lot.findFirst({ where: { lotNo: { startsWith: prefix }, lotType }, orderBy: { lotNo: 'desc' }, select: { lotNo: true } }))?.lotNo ?? null;
  }

  countMillSheets(tx: Tx, shipmentRequestId: number): Promise<number> {
    return tx.millSheet.count({ where: { shipmentRequestId } });
  }
}
