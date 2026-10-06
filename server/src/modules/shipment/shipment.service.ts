import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  PERMISSION,
  RESERVATION_STATUS,
  SALES_ORDER_ITEM_STATUS,
  SHIPMENT_REQUEST_STATUS,
  type AuthUser,
  type ItemType,
  type MillSheetDetail,
  type MillSheetSummary,
  millSheetPdfFileName,
  type PageResult,
  type ShipmentRequestDetail,
  type ShipmentRequestStatus,
  type ShipmentRequestSummary,
  type ShippableSalesOrderItem,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { StorageService } from '../../common/storage/storage.service';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import type { CreateShipmentRequestDto } from './dto/create-shipment-request.dto';
import type { ListMillSheetsQuery } from './dto/list-mill-sheets.query';
import type { ListShipmentRequestsQuery } from './dto/list-shipment-requests.query';
import { renderMillSheetPdf } from './mill-sheet-pdf';
import { buildMillSheetSnapshot } from './mill-sheet-snapshot';
import { toMillSheetDetail, toMillSheetSummary, toShipmentRequestDetail, toShipmentRequestSummary, toSnapshotLotInput } from './shipment.mapper';
import { ShipmentRepository } from './shipment.repository';

/** 배정 대기·배정 확정. 출하 가능 매수에서 빼는 진행 중 출하요청 */
const PENDING_STATUSES: ShipmentRequestStatus[] = [SHIPMENT_REQUEST_STATUS.REQUESTED, SHIPMENT_REQUEST_STATUS.ALLOCATED];

/** 출하요청·출고 확정·밀시트 (REQ-SHP-001~004, BP-SHP-01) */
@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ShipmentRepository,
    private readonly numbering: NumberingService,
    private readonly businessEventRecorder: BusinessEventRecorder,
    private readonly storage: StorageService,
    // 취소하면 배정을 해제하고(inventory), 배정이 바뀌면 inventory가 refreshAllocationStatus를 부른다 → 서로 부른다
    @Inject(forwardRef(() => InventoryService)) private readonly inventory: InventoryService,
    // 출고하면 수주 품목 상태를 다시 계산한다. sales-order → inventory → shipment 순환이라 forwardRef
    @Inject(forwardRef(() => SalesOrderService)) private readonly salesOrders: SalesOrderService,
  ) {}

  /**
   * 출하요청 등록 (REQ-SHP-001). 출하 가능 매수 = ACTIVE 예약 매수 − 진행 중 출하요청 매수 (API-132 설명).
   * 수주 품목을 먼저 잠그고 합계를 읽어서, 같은 품목을 동시에 요청해도 가능 매수를 두 번 쓰지 않는다.
   */
  async create(user: AuthUser, dto: CreateShipmentRequestDto): Promise<ShipmentRequestDetail> {
    const ids = dto.items.map((i) => i.salesOrderItemId);
    if (new Set(ids).size !== ids.length) throw new AppException('COM-004', '같은 수주 품목이 두 번 들어 있어요. 한 줄로 합쳐 주세요');

    const id = await this.prisma.$transaction(async (tx) => {
      const sortedIds = [...ids].sort((a, b) => a - b);
      const lockedItems = await this.repository.lockSalesOrderItems(tx, sortedIds);
      if (lockedItems.length !== ids.length) throw new AppException('COM-003', '없는 수주 품목이 들어 있어요');

      if (lockedItems.some((i) => i.customerId !== dto.customerId)) {
        // 정의서 9.3에 고객사 불일치 코드가 없어 입력 오류로 돌려준다 (shipment.md 8장)
        throw new AppException('COM-004', '다른 고객사의 수주 품목은 같은 출하요청에 묶을 수 없어요. 별도 출하요청으로 만들어 주세요');
      }
      const cancelled = lockedItems.find((i) => i.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED);
      if (cancelled) throw new AppException('SHP-002', `취소된 수주 품목(id ${cancelled.id})은 출하요청할 수 없어요`);

      const shippable = await this.repository.findShippableQty(tx, sortedIds, RESERVATION_STATUS.ACTIVE, PENDING_STATUSES);
      const shippableById = new Map(shippable.map((s) => [s.salesOrderItemId, (s.activeReservedQty ?? 0) - (s.pendingRequestQty ?? 0)]));
      for (const item of dto.items) {
        const available = Math.max(0, shippableById.get(item.salesOrderItemId) ?? 0);
        if (item.requestQty > available) {
          throw new AppException('SHP-002', `수주 품목(id ${item.salesOrderItemId})의 출하 가능 매수는 ${available}매예요`);
        }
      }

      const shipmentRequestNo = await this.numbering.nextDocumentNumber(tx, 'SHIPMENT_REQUEST');
      const created = await this.repository.create(tx, {
        shipmentRequestNo,
        customerId: dto.customerId,
        shipDate: dto.shipDate ? new Date(`${dto.shipDate}T00:00:00.000Z`) : null,
        items: dto.items.map((i) => ({ salesOrderItemId: i.salesOrderItemId, requestQty: i.requestQty })),
      });

      // business_event.sales_order_id가 하나라서 수주마다 한 건씩 남긴다 (수주 타임라인 REQ-LOG-003)
      const salesOrderIdByItem = new Map(lockedItems.map((i) => [i.id, i.salesOrderId]));
      const salesOrderIds = [...new Set(lockedItems.map((i) => i.salesOrderId))];
      for (const salesOrderId of salesOrderIds) {
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.SHIPMENT_REQUEST_CREATED,
          actor: user,
          target: { table: 'shipment_request', id: created.id },
          salesOrderId,
          after: {
            shipmentRequestNo,
            customerId: dto.customerId,
            shipDate: dto.shipDate ?? null,
            items: dto.items.filter((i) => salesOrderIdByItem.get(i.salesOrderItemId) === salesOrderId),
          },
        });
      }
      return created.id;
    });
    return this.findOne(user, id);
  }

  async list(user: AuthUser, query: ListShipmentRequestsQuery): Promise<PageResult<ShipmentRequestSummary>> {
    this.assertCanView(user);
    const where: Prisma.ShipmentRequestWhereInput = {
      ...(query.shipmentRequestStatus ? { shipmentRequestStatus: query.shipmentRequestStatus } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.repository.findMany(this.prisma, where, (query.page - 1) * query.size, query.size),
      this.repository.count(this.prisma, where),
    ]);
    return { items: rows.map(toShipmentRequestSummary), page: query.page, size: query.size, total };
  }

  async findOne(user: AuthUser, id: number): Promise<ShipmentRequestDetail> {
    this.assertCanView(user);
    const row = await this.repository.findDetail(this.prisma, id);
    if (!row) throw new AppException('COM-003', '출하요청을 찾을 수 없어요');
    return toShipmentRequestDetail(row);
  }

  /** 출하 가능 품목 (API 목록 초안 행 GET /shipment-requests/shippable): 진행중·부분출하 수주 품목 중 출하 가능 매수가 남은 것 */
  async listShippable(customerId?: number): Promise<ShippableSalesOrderItem[]> {
    const items = await this.repository.findOpenSalesOrderItems(this.prisma, customerId);
    if (items.length === 0) return [];
    const qty = await this.repository.findShippableQty(this.prisma, items.map((i) => i.id), RESERVATION_STATUS.ACTIVE, PENDING_STATUSES);
    const qtyById = new Map(qty.map((q) => [q.salesOrderItemId, q]));
    return items
      .map((i) => {
        const activeReservedQty = qtyById.get(i.id)?.activeReservedQty ?? 0;
        const pendingRequestQty = qtyById.get(i.id)?.pendingRequestQty ?? 0;
        return {
          salesOrderId: i.salesOrderId,
          salesOrderNo: i.salesOrder.salesOrderNo,
          salesOrderItemId: i.id,
          customerId: i.salesOrder.customerId,
          customerName: i.salesOrder.customer.customerName,
          itemId: i.itemId,
          itemCode: i.item.itemCode,
          itemName: i.item.itemName,
          itemType: i.item.itemType as ItemType,
          orderedQty: i.orderedQty,
          dueDate: i.dueDate.toISOString().slice(0, 10),
          activeReservedQty,
          pendingRequestQty,
          shippableQty: Math.max(0, activeReservedQty - pendingRequestQty),
        };
      })
      .filter((i) => i.shippableQty > 0);
  }

  /** 출하요청 취소: 출고 전(배정 대기·배정 확정)만. 확정 배정을 모두 해제한다. 출고 확정 후면 SHP-003 */
  async cancel(user: AuthUser, id: number): Promise<ShipmentRequestDetail> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.repository.lockShipmentRequest(tx, id);
      if (!locked) throw new AppException('COM-003', '출하요청을 찾을 수 없어요');
      if (locked.shipment_request_status === SHIPMENT_REQUEST_STATUS.ISSUED) throw new AppException('SHP-003');
      // 이미 취소된 요청의 재취소용 코드가 정의서 9.3에 없다 (shipment.md 8장)
      if (locked.shipment_request_status === SHIPMENT_REQUEST_STATUS.CANCELLED) throw new AppException('COM-001', '이미 취소된 출하요청이에요');
      // 출하요청 취소용 작업 로그 유형은 공통 코드에 없다(shipment.md 8장 🟡). 배정 해제는 ALLOCATION_RELEASED로 남는다
      await this.inventory.releaseShipmentAllocationsOfRequest(tx, { shipmentRequestId: id, actor: user, reason: `출하요청 ${locked.shipment_request_no} 취소로 배정 해제` });
      await this.repository.updateStatus(tx, id, SHIPMENT_REQUEST_STATUS.CANCELLED);
    });
    return this.findOne(user, id);
  }

  /**
   * 출고 확정 (API-112, REQ-SHP-002·003, 업무 프로세스 13.3). 한 트랜잭션에서 끝낸다:
   * 출하요청·수주 품목 잠금 → 재검증(배정·LOT·예약) → 배정 소진·LOT 출고·예약 전환·재고 차감 → 수주 품목 상태 → ISSUED → 수주별 밀시트 스냅샷 → 작업 로그.
   * 하나라도 어긋나면 아무것도 바뀌지 않는다. 이미 출고했으면 COM-001이라 다시 눌러도 출고·문서가 중복되지 않는다.
   */
  async issue(user: AuthUser, id: number): Promise<ShipmentRequestDetail> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.repository.lockShipmentRequest(tx, id);
      if (!locked) throw new AppException('COM-003', '출하요청을 찾을 수 없어요');
      if (locked.shipment_request_status === SHIPMENT_REQUEST_STATUS.ISSUED) throw new AppException('COM-001', '이미 출고 확정된 출하요청이에요');
      if (locked.shipment_request_status === SHIPMENT_REQUEST_STATUS.CANCELLED) throw new AppException('COM-001', '취소된 출하요청이에요');

      // 출하요청 등록·수주 취소와 같은 수주 품목 잠금: 출고하는 사이 수주가 취소되거나 같은 품목이 또 출고되지 않게.
      // 잠금 뒤에 다시 읽어야 그사이 바뀐 수주 품목 상태·예약을 본다
      const first = await this.repository.findIssueContext(tx, id);
      if (!first) throw new AppException('COM-003', '출하요청을 찾을 수 없어요');
      await this.repository.lockSalesOrderItems(tx, first.shipmentRequestItems.map((i) => i.salesOrderItem.id).sort((a, b) => a - b));
      const request = await this.repository.findIssueContext(tx, id);
      if (!request) throw new AppException('COM-003', '출하요청을 찾을 수 없어요');

      // 재고 행 잠금 순서(규격 id 오름차순)와 맞추려고 규격 순으로 처리한다
      const lines = [...request.shipmentRequestItems].sort((a, b) => a.salesOrderItem.itemId - b.salesOrderItem.itemId || a.id - b.id);
      const reservations = await this.inventory.listReservations(tx, lines.map((l) => l.salesOrderItem.id));
      const reservedQty = (soItemId: number, status: string) =>
        reservations.filter((r) => r.salesOrderItemId === soItemId && r.reservationStatus === status).reduce((sum, r) => sum + r.reservedQty, 0);

      for (const line of lines) {
        const soItem = line.salesOrderItem;
        if (soItem.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED) throw new AppException('SHP-002', `취소된 수주 품목(id ${soItem.id})은 출고할 수 없어요`);
        if (line.allocations.length < line.requestQty) {
          throw new AppException('INV-001', `${soItem.item.itemCode}은 배정 대기가 ${line.requestQty - line.allocations.length}매 남아 있어요`);
        }
        const unshipped = soItem.orderedQty - reservedQty(soItem.id, RESERVATION_STATUS.CONVERTED);
        if (line.requestQty > unshipped || line.requestQty > reservedQty(soItem.id, RESERVATION_STATUS.ACTIVE)) {
          throw new AppException('SHP-002', `수주 품목(id ${soItem.id})의 미출하·예약 매수보다 많이 출고할 수 없어요`);
        }
        for (const allocation of line.allocations) await this.inventory.assertIssuableLot(tx, allocation.lotId, soItem.itemId);
      }

      const issuedAt = new Date();
      const allLotIds = lines.flatMap((l) => l.allocations.map((a) => a.lotId));
      await this.inventory.consumeShipmentAllocations(tx, lines.flatMap((l) => l.allocations.map((a) => a.id)));
      if (!(await this.repository.markLotsShipped(tx, allLotIds))) {
        // 위에서 AVAILABLE을 확인했으므로 잠금 밖에서 상태가 바뀐 경우다. 서버 오류로 남기고 전부 되돌린다
        throw new Error(`출고할 LOT 일부가 AVAILABLE이 아닙니다 (출하요청 ${id})`);
      }
      for (const line of lines) {
        const soItem = line.salesOrderItem;
        await this.inventory.convertReservations(tx, {
          salesOrderId: soItem.salesOrderId,
          salesOrderItemId: soItem.id,
          itemId: soItem.itemId,
          qty: line.requestQty,
          lotIds: line.allocations.map((a) => a.lotId),
          actor: user,
        });
        await this.salesOrders.recalcItemStatus(tx, soItem.id);
      }
      await this.repository.markIssued(tx, id, issuedAt, user.employeeId);

      // 수주마다 작업 로그 한 건(수주 타임라인)과 밀시트 한 장 (ERD: 출하요청 × 수주당 1장)
      const lotRows = new Map((await this.repository.findLotsForSnapshot(tx, allLotIds)).map((l) => [l.id, l]));
      const salesOrderIds = [...new Set(lines.map((l) => l.salesOrderItem.salesOrderId))].sort((a, b) => a - b);
      for (const salesOrderId of salesOrderIds) {
        const ofOrder = lines.filter((l) => l.salesOrderItem.salesOrderId === salesOrderId);
        const salesOrder = ofOrder[0].salesOrderItem.salesOrder;
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.GOODS_ISSUE_CONFIRMED,
          actor: user,
          target: { table: 'shipment_request', id },
          salesOrderId,
          lotIds: ofOrder.flatMap((l) => l.allocations.map((a) => a.lotId)),
          before: { shipmentRequestStatus: request.shipmentRequestStatus },
          after: {
            shipmentRequestNo: request.shipmentRequestNo,
            salesOrderNo: salesOrder.salesOrderNo,
            shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.ISSUED,
            issuedAt: issuedAt.toISOString(),
            items: ofOrder.map((l) => ({ salesOrderItemId: l.salesOrderItem.id, qty: l.allocations.length, lotNos: l.allocations.map((a) => lotRows.get(a.lotId)?.lotNo) })),
          },
        });

        const millSheetNo = await this.numbering.nextMillSheetNumber(tx, id, request.shipmentRequestNo);
        const snapshot = buildMillSheetSnapshot({
          millSheetNo,
          issuedAt,
          customer: request.customer,
          salesOrder,
          shipmentRequest: { id, shipmentRequestNo: request.shipmentRequestNo, shipDate: request.shipDate, issuedEmployeeName: user.employeeName },
          items: ofOrder.map((l) => {
            const item = l.salesOrderItem.item;
            return {
              salesOrderItemId: l.salesOrderItem.id,
              item: {
                id: item.id,
                itemCode: item.itemCode,
                itemName: item.itemName,
                itemType: item.itemType,
                steelGradeCode: item.steelGrade?.steelGradeCode ?? null,
                standardNo: item.steelGrade?.standardNo ?? null,
                thicknessMm: item.thicknessMm?.toFixed(2) ?? null,
                widthMm: item.widthMm?.toFixed(2) ?? null,
                lengthMm: item.lengthMm?.toFixed(2) ?? null,
                theoreticalWeightTon: item.theoreticalWeightTon?.toFixed(3) ?? null,
              },
              lots: l.allocations.map((a) => toSnapshotLotInput(lotRows.get(a.lotId)!)),
            };
          }),
        });
        const millSheet = await this.repository.createMillSheet(tx, {
          millSheetNo,
          shipmentRequestId: id,
          salesOrderId,
          snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
          issuedAt,
        });
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.MILL_SHEET_ISSUED,
          actor: user,
          target: { table: 'mill_sheet', id: millSheet.id },
          salesOrderId,
          lotIds: snapshot.lotIds,
          after: { millSheetNo, shipmentRequestNo: request.shipmentRequestNo, salesOrderNo: salesOrder.salesOrderNo, heatNos: snapshot.heats.map((h) => h.heatNo), totalQty: snapshot.totalQty },
        });
      }
    });
    return this.findOne(user, id);
  }

  /**
   * inventory가 출하 배정을 확정·해제한 같은 tx에서 부른다.
   * 모든 품목의 미배정 매수가 0이면 ALLOCATED, 아니면 REQUESTED. 출고·취소된 요청은 바꾸지 않는다.
   */
  async refreshAllocationStatus(tx: Tx, shipmentRequestId: number): Promise<ShipmentRequestStatus> {
    const progress = await this.repository.findAllocationProgress(tx, shipmentRequestId);
    if (!progress) throw new AppException('COM-003', '출하요청을 찾을 수 없어요');
    const current = progress.shipmentRequestStatus as ShipmentRequestStatus;
    if (!PENDING_STATUSES.includes(current)) return current;

    const allAllocated = progress.shipmentRequestItems.every((i) => i.requestQty - i._count.allocations <= 0);
    const next = allAllocated ? SHIPMENT_REQUEST_STATUS.ALLOCATED : SHIPMENT_REQUEST_STATUS.REQUESTED;
    if (next !== current) await this.repository.updateStatus(tx, shipmentRequestId, next);
    return next;
  }

  /** 밀시트 목록 (API-232). 권한 MILL_SHEET_READ VIEW는 컨트롤러 데코레이터가 본다 */
  async listMillSheets(query: ListMillSheetsQuery): Promise<PageResult<MillSheetSummary>> {
    const where: Prisma.MillSheetWhereInput = {
      ...(query.shipmentRequestId ? { shipmentRequestId: query.shipmentRequestId } : {}),
      ...(query.salesOrderId ? { salesOrderId: query.salesOrderId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.repository.findMillSheets(this.prisma, where, (query.page - 1) * query.size, query.size),
      this.repository.countMillSheets(this.prisma, where),
    ]);
    return { items: rows.map(toMillSheetSummary), page: query.page, size: query.size, total };
  }

  /** 밀시트 조회 (API-233, REQ-SHP-004). 저장된 스냅샷만 돌려주고 현재 고객사·검사값을 다시 읽지 않는다 */
  async findMillSheet(id: number): Promise<MillSheetDetail> {
    const row = await this.repository.findMillSheet(this.prisma, id);
    if (!row) throw new AppException('COM-003', '밀시트를 찾을 수 없어요');
    return toMillSheetDetail(row);
  }

  /**
   * 밀시트 PDF 생성 (API-115, REQ-SHP-004). 저장된 스냅샷으로만 그리고 출고·스냅샷은 건드리지 않는다.
   * 이미 만들었으면 그 경로를 그대로 돌려준다. 렌더링·저장이 실패하면 SHP-001이고 스냅샷은 그대로라 다시 누르면 PDF만 다시 만든다.
   */
  async generateMillSheetPdf(id: number): Promise<MillSheetDetail> {
    const row = await this.repository.findMillSheet(this.prisma, id);
    if (!row) throw new AppException('COM-003', '밀시트를 찾을 수 없어요');
    if (row.pdfPath) return toMillSheetDetail(row);
    const { snapshot } = toMillSheetDetail(row);
    try {
      const pdf = await renderMillSheetPdf(snapshot);
      const pdfPath = await this.storage.save('mill-sheets', millSheetPdfFileName(snapshot), pdf);
      await this.repository.setPdfPath(this.prisma, id, pdfPath);
    } catch (error) {
      this.logger.error(`밀시트 PDF 생성 실패 (${row.millSheetNo})`, error instanceof Error ? error.stack : String(error));
      throw new AppException('SHP-001');
    }
    return this.findMillSheet(id);
  }

  /** 목록·상세는 영업(SHIPMENT_REQUEST_MANAGE)과 물류(GOODS_ISSUE_CONFIRM) 중 하나의 VIEW면 된다. 데코레이터는 OR를 못 써서 여기서 본다 */
  private assertCanView(user: AuthUser) {
    const ok =
      hasPermission(user, { permission: PERMISSION.SHIPMENT_REQUEST_MANAGE, level: 'VIEW' }) ||
      hasPermission(user, { permission: PERMISSION.GOODS_ISSUE_CONFIRM, level: 'VIEW' });
    if (!ok) throw new AppException('COM-002');
  }
}
