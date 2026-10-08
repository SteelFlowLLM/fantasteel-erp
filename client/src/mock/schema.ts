// 가짜 데이터 DB의 테이블 모양. 이름은 ERD 최종본(docs/rework/erd-final.txt)의 테이블·컬럼을 camelCase로 옮겼다.
// 값 규칙: decimal은 문자열(예: "23.550", 컨벤션 5장 "Decimal은 문자열"), date는 "YYYY-MM-DD", timestamptz는 ISO 문자열, jsonb는 JsonValue.
// 행 타입은 interface가 아니라 type으로 둔다 (작업 로그 before/after에 그대로 넣을 수 있게).
import type {
  ActionType,
  ActorType,
  AllocationPurpose,
  AllocationStatus,
  BusinessEventType,
  CaseCategory,
  ChatRoomType,
  DispositionStatus,
  DraftStatus,
  EventReasonCode,
  InspectionResult,
  ItemType,
  LotRelationEvidence,
  LotStatus,
  LotType,
  NotificationType,
  Permission,
  PermissionLevel,
  ProcessType,
  ProductItemType,
  ProductionPlanStatus,
  PurchaseOrderStatus,
  PurchaseRequisitionStatus,
  RawMaterialType,
  ReservationStatus,
  RoleCode,
  SalesOrderItemStatus,
  ShipmentRequestStatus,
  TaskStatus,
  UnitType,
  YardType,
} from '@/codes';

export type DecimalString = string;
export type DateString = string;
export type IsoDateTime = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type Timestamps = { createdAt: IsoDateTime; updatedAt: IsoDateTime };

// ── org_auth ─────────────────────────────────────────────
export type DepartmentRow = Timestamps & {
  id: number;
  departmentCode: string;
  departmentName: string;
  parentId: number | null;
  headEmployeeId: number | null;
  sortOrder: number;
};

export type JobGradeRow = Timestamps & {
  id: number;
  jobGradeCode: string;
  jobGradeName: string;
  sortOrder: number;
};

export type RoleRow = Timestamps & {
  id: number;
  roleCode: RoleCode;
  roleName: string;
};

export type RolePermissionRow = Timestamps & {
  id: number;
  roleId: number;
  permission: Permission;
  permissionLevel: PermissionLevel;
};

export type EmployeeRow = Timestamps & {
  id: number;
  employeeNo: string;
  employeeName: string;
  /** 로그인 작업 전까지 비워 둔다 (SPEC 5장 결정 1). 응답에 넣지 않는다. */
  passwordHash: string;
  departmentId: number;
  jobGradeId: number;
  roleId: number;
  isActive: boolean;
  lastLoginAt: IsoDateTime | null;
};

// ── master_data ──────────────────────────────────────────
export type SteelGradeRow = Timestamps & {
  id: number;
  steelGradeCode: string;
  steelGradeName: string;
  standardNo: string | null;
};

export type ItemRow = Timestamps & {
  id: number;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  unitType: UnitType;
  rawMaterialType: RawMaterialType | null;
  steelGradeId: number | null;
  thicknessMm: DecimalString | null;
  widthMm: DecimalString | null;
  lengthMm: DecimalString | null;
  theoreticalWeightTon: DecimalString | null;
  defaultYardId: number;
  defaultSupplierId: number | null;
};

export type SpecMappingRow = Timestamps & {
  id: number;
  slabItemId: number;
  coilItemId: number;
};

export type RoutingRow = Timestamps & {
  id: number;
  itemType: ProductItemType;
  processType: ProcessType;
  processSeq: number;
  /** 열연은 입력하지 않는다 (규격 매핑에서 계산) */
  plannedYieldRate: DecimalString | null;
};

export type SpecificConsumptionRow = Timestamps & {
  id: number;
  itemId: number;
  /** 합금철만 강종별. 철광석·석탄·석회석은 null(공통) */
  steelGradeId: number | null;
  consumptionRate: DecimalString;
};

export type CustomerRow = Timestamps & {
  id: number;
  customerCode: string;
  customerName: string;
};

export type SupplierRow = Timestamps & {
  id: number;
  supplierCode: string;
  supplierName: string;
};

export type YardRow = Timestamps & {
  id: number;
  yardCode: string;
  yardName: string;
  yardType: YardType;
};

export type ProductionSettingRow = Timestamps & {
  id: number;
  heatCapacityTon: DecimalString;
  deliveryRiskDays: number;
};

export type InspectionStandardRow = Timestamps & {
  id: number;
  inspectionStandardCode: string;
  version: number;
  processType: ProcessType;
  steelGradeId: number | null;
  isCurrent: boolean;
};

export type InspectionStandardItemRow = Timestamps & {
  id: number;
  inspectionStandardId: number;
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  minValue: DecimalString | null;
  maxValue: DecimalString | null;
  minThicknessMm: DecimalString | null;
  maxThicknessMm: DecimalString | null;
  isRequired: boolean;
  sortOrder: number;
};

// ── sales_inventory ──────────────────────────────────────
export type SalesOrderRow = Timestamps & {
  id: number;
  salesOrderNo: string;
  customerId: number;
  ownerEmployeeId: number;
  cancelledAt: IsoDateTime | null;
  cancelReason: string | null;
};

export type SalesOrderItemRow = Timestamps & {
  id: number;
  salesOrderId: number;
  lineNo: number;
  itemId: number;
  orderedQty: number;
  shippedQty: number;
  dueDate: DateString;
  salesOrderItemStatus: SalesOrderItemStatus;
};

export type InventoryRow = Timestamps & {
  id: number;
  itemId: number;
  onHandQty: number;
  reservedQty: number;
};

export type ReservationRow = Timestamps & {
  id: number;
  salesOrderItemId: number;
  itemId: number;
  reservedQty: number;
  reservationStatus: ReservationStatus;
};

export type AllocationRow = Timestamps & {
  id: number;
  lotId: number;
  allocationPurpose: AllocationPurpose;
  salesOrderItemId: number | null;
  shipmentRequestItemId: number | null;
  productionPlanId: number | null;
  allocationStatus: AllocationStatus;
  confirmedEmployeeId: number;
  confirmedAt: IsoDateTime;
  consumedAt: IsoDateTime | null;
  releasedAt: IsoDateTime | null;
};

// ── production_lot ───────────────────────────────────────
export type ProductionPlanRow = Timestamps & {
  id: number;
  productionPlanNo: string;
  salesOrderItemId: number | null;
  itemId: number;
  shortageQty: number;
  cumulativeYieldRate: DecimalString;
  requiredSteelTon: DecimalString;
  heatCount: number;
  productionPlanStatus: ProductionPlanStatus;
  isReproduction: boolean;
  isSurplusOnCompletion: boolean;
  createdEmployeeId: number;
  cancelledAt: IsoDateTime | null;
};

export type ProductionResultRow = Timestamps & {
  id: number;
  productionPlanId: number | null;
  processType: ProcessType;
  blastFurnaceCode: string | null;
  converterCode: string | null;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  inputTon: DecimalString | null;
  outputTon: DecimalString | null;
  outputQty: number | null;
  lossQty: number | null;
  sampleLossRate: DecimalString | null;
  randomSeed: number | null;
  isSimulated: boolean;
  operatorEmployeeId: number | null;
};

export type LotRow = Timestamps & {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  itemId: number | null;
  steelGradeId: number | null;
  heatLotId: number | null;
  initialTon: DecimalString | null;
  remainingTon: DecimalString | null;
  blastFurnaceCode: string | null;
  converterCode: string | null;
  yardId: number | null;
  goodsReceiptId: number | null;
  productionResultId: number | null;
  productionPlanId: number | null;
  isPassed: boolean | null;
  dispositionStatus: DispositionStatus | null;
  dispositionReason: string | null;
  dispositionAt: IsoDateTime | null;
  surplusAt: IsoDateTime | null;
  producedDate: DateString;
  consumedAt: IsoDateTime | null;
  shippedAt: IsoDateTime | null;
};

export type LotRelationRow = Timestamps & {
  id: number;
  parentLotId: number;
  childLotId: number;
  lotRelationEvidence: LotRelationEvidence;
  inputTon: DecimalString | null;
  periodStartedAt: IsoDateTime | null;
  periodEndedAt: IsoDateTime | null;
};

// ── purchasing ───────────────────────────────────────────
/** ERD purchase_requisition: 구매요청 1건 = 원료 1품목. 요청 부서는 저장하지 않고 요청자의 소속 부서로 본다 */
export type PurchaseRequisitionRow = Timestamps & {
  id: number;
  purchaseRequisitionNo: string;
  itemId: number;
  /** required_ton(MRP 소요량)과 구분 */
  requestedTon: DecimalString;
  desiredReceiptDate: DateString;
  requesterId: number;
  /** 승인·반려한 부서장 */
  approverId: number | null;
  approvedAt: IsoDateTime | null;
  rejectReason: string | null;
  requestReason: string | null;
  /** 근거 생산계획 (MRP 중복 요청 방지) */
  productionPlanId: number | null;
  actionDraftId: number | null;
  purchaseRequisitionStatus: PurchaseRequisitionStatus;
};

/** ERD purchase_order: 공급업체 1곳당 발주 1건. 발주자는 작업 로그로 본다 */
export type PurchaseOrderRow = Timestamps & {
  id: number;
  purchaseOrderNo: string;
  supplierId: number;
  purchaseOrderStatus: PurchaseOrderStatus;
};

/** ERD purchase_order_item. 입고 누계·미입고량(입고예정)은 저장하지 않고 입고 기록으로 계산한다 */
export type PurchaseOrderItemRow = Timestamps & {
  id: number;
  purchaseOrderId: number;
  /** 발주 품목 1행 = 구매요청 1건 */
  purchaseRequisitionId: number;
  itemId: number;
  orderedTon: DecimalString;
  /** MRP 입고예정 필요일 판단용 */
  expectedReceiptDate: DateString | null;
};

export type GoodsReceiptRow = Timestamps & {
  id: number;
  goodsReceiptNo: string;
  purchaseOrderItemId: number;
  receivedTon: DecimalString;
  /** 원료 FIFO 기준일. 야드는 원료 LOT에, 확정자는 작업 로그에 있다 */
  receivedDate: DateString;
};

// ── quality_shipment ─────────────────────────────────────
export type QualityInspectionRow = Timestamps & {
  id: number;
  lotId: number;
  inspectionStandardId: number;
  processType: ProcessType;
  inspectionResult: InspectionResult;
  inspectorEmployeeId: number | null;
  inspectedAt: IsoDateTime | null;
};

export type QualityInspectionValueRow = Timestamps & {
  id: number;
  qualityInspectionId: number;
  inspectionStandardItemId: number;
  measuredValue: DecimalString | null;
  isPassed: boolean | null;
};

export type ShipmentRequestRow = Timestamps & {
  id: number;
  shipmentRequestNo: string;
  customerId: number;
  requestedShipDate: DateString;
  shipmentRequestStatus: ShipmentRequestStatus;
  requesterId: number;
  issuedAt: IsoDateTime | null;
  issuedEmployeeId: number | null;
  cancelledAt: IsoDateTime | null;
};

export type ShipmentRequestItemRow = Timestamps & {
  id: number;
  shipmentRequestId: number;
  lineNo: number;
  salesOrderItemId: number;
  requestQty: number;
};

export type MillSheetRow = Timestamps & {
  id: number;
  millSheetNo: string;
  shipmentRequestId: number;
  salesOrderId: number;
  issuedAt: IsoDateTime;
  snapshot: JsonValue;
  pdfPath: string | null;
};

// ── log_collab ───────────────────────────────────────────
export type BusinessEventRow = Timestamps & {
  id: number;
  eventNo: string;
  businessEventType: BusinessEventType;
  actorType: ActorType;
  actorEmployeeId: number | null;
  /** 대상 테이블명 (용어 사전 DB명, 예: sales_order, lot) */
  targetType: DbTableName;
  targetId: number;
  targetNo: string | null;
  salesOrderId: number | null;
  beforeData: JsonValue | null;
  afterData: JsonValue | null;
  reasonCode: EventReasonCode | null;
  reasonText: string | null;
  /** AI 경유 (P2). 지금은 늘 false */
  isAiAssisted: boolean;
  actionDraftId: number | null;
  messageId: number | null;
  occurredAt: IsoDateTime;
};

export type BusinessEventLotRow = Timestamps & {
  id: number;
  businessEventId: number;
  lotId: number;
};

export type TaskRow = Timestamps & {
  id: number;
  title: string;
  description: string | null;
  assigneeId: number;
  creatorId: number;
  dueDate: DateString | null;
  taskStatus: TaskStatus;
  linkPath: string | null;
  completedAt: IsoDateTime | null;
  /** 메신저 메시지에서 등록한 업무의 원본 메시지 (16번, 선택 값) */
  messageId?: number | null;
};

export type NotificationRow = Timestamps & {
  id: number;
  recipientId: number;
  departmentId: number | null;
  businessEventId: number | null;
  notificationType: NotificationType;
  title: string;
  body: string | null;
  linkPath: string | null;
  isRead: boolean;
  readAt: IsoDateTime | null;
};

export type ChatRoomRow = Timestamps & {
  id: number;
  chatRoomType: ChatRoomType;
  chatRoomName: string | null;
  salesOrderId: number | null;
  createdEmployeeId: number;
  /** 방 위에 고정한 공지 메시지 (스키마 2차) */
  pinnedMessageId?: number | null;
};

export type ChatRoomMemberRow = Timestamps & {
  id: number;
  chatRoomId: number;
  employeeId: number;
  lastReadMessageId: number | null;
  /** 내 방 설정 (14번): 알림 끄기·목록 위 고정. 선택 값이라 저장된 가짜 DB를 지우지 않는다 */
  muted?: boolean;
  pinnedAt?: string | null;
};

/** 메시지 첨부 파일 하나 (가짜 DB). path는 저장소 경로 chat/{방}/{메시지}/{순번}-{파일명} */
export type MessageFileValues = {
  name: string;
  size: number;
  mimeType: string;
  path: string;
};

export type MessageRow = Timestamps & {
  id: number;
  chatRoomId: number;
  senderId: number;
  content: string | null;
  /** 파일 1개짜리 옛 모양 (시드·이미 저장된 가짜 DB). 새 메시지는 files를 쓰고 이 칸은 비운다 */
  fileName: string | null;
  filePath: string | null;
  fileSize: number | null;
  mimeType: string | null;
  /** 첨부 여러 개 (서버 스키마 3차 message_attachment와 같은 뜻). 올린 순서 */
  files?: MessageFileValues[];
  /** 답글 대상 (없으면 비움, #151 스키마 1차와 같은 뜻) */
  parentMessageId?: number | null;
  /** 본문을 고친 시각 */
  editedAt?: string | null;
  /** 삭제 표시 (행은 남김) */
  deletedAt?: string | null;
  /** 이모지 반응. 서버는 message_reaction 테이블이지만, 가짜 DB에 표를 더하면 저장된 데이터가 시드로 돌아가서 메시지 행에 둔다 */
  reactions?: { employeeId: number; emoji: string }[];
};

export type ActionDraftRow = Timestamps & {
  id: number;
  actionType: ActionType;
  draftStatus: DraftStatus;
  payload: JsonValue;
  requesterId: number;
  messageId: number | null;
  executionResult: JsonValue | null;
  rejectReason: string | null;
  confirmedAt: IsoDateTime | null;
  executedAt: IsoDateTime | null;
  rejectedAt: IsoDateTime | null;
};

// ── system_support ───────────────────────────────────────
export type NumberSequenceRow = Timestamps & {
  id: number;
  sequenceKey: string;
  lastValue: number;
};

export type IdempotencyKeyRow = Timestamps & {
  id: number;
  requestKey: string;
  employeeId: number;
};

// ── p2_ex_placeholder (P2·EX는 화면만 '준비 중'이라 지금은 비어 있다) ──
export type MeetingMinutesRow = Timestamps & {
  id: number;
  meetingDate: DateString;
  title: string;
  transcript: string | null;
  summary: string | null;
  createdEmployeeId: number;
};

export type MeetingAttendeeRow = Timestamps & {
  id: number;
  meetingMinutesId: number;
  employeeId: number;
};

export type PastCaseRow = Timestamps & {
  id: number;
  caseNo: string;
  caseCategory: CaseCategory;
  title: string;
  phenomenon: string;
  cause: string | null;
  actionTaken: string | null;
  equipmentText: string | null;
  occurredDate: DateString;
  createdEmployeeId: number;
};

export type PastCaseLotRow = Timestamps & {
  id: number;
  pastCaseId: number;
  lotId: number;
};

/** ERD 테이블 49개 */
export type MockTables = {
  department: DepartmentRow[];
  jobGrade: JobGradeRow[];
  role: RoleRow[];
  rolePermission: RolePermissionRow[];
  employee: EmployeeRow[];
  steelGrade: SteelGradeRow[];
  item: ItemRow[];
  specMapping: SpecMappingRow[];
  routing: RoutingRow[];
  specificConsumption: SpecificConsumptionRow[];
  customer: CustomerRow[];
  supplier: SupplierRow[];
  yard: YardRow[];
  productionSetting: ProductionSettingRow[];
  inspectionStandard: InspectionStandardRow[];
  inspectionStandardItem: InspectionStandardItemRow[];
  salesOrder: SalesOrderRow[];
  salesOrderItem: SalesOrderItemRow[];
  inventory: InventoryRow[];
  reservation: ReservationRow[];
  allocation: AllocationRow[];
  productionPlan: ProductionPlanRow[];
  productionResult: ProductionResultRow[];
  lot: LotRow[];
  lotRelation: LotRelationRow[];
  purchaseRequisition: PurchaseRequisitionRow[];
  purchaseOrder: PurchaseOrderRow[];
  purchaseOrderItem: PurchaseOrderItemRow[];
  goodsReceipt: GoodsReceiptRow[];
  qualityInspection: QualityInspectionRow[];
  qualityInspectionValue: QualityInspectionValueRow[];
  shipmentRequest: ShipmentRequestRow[];
  shipmentRequestItem: ShipmentRequestItemRow[];
  millSheet: MillSheetRow[];
  businessEvent: BusinessEventRow[];
  businessEventLot: BusinessEventLotRow[];
  task: TaskRow[];
  notification: NotificationRow[];
  chatRoom: ChatRoomRow[];
  chatRoomMember: ChatRoomMemberRow[];
  message: MessageRow[];
  actionDraft: ActionDraftRow[];
  numberSequence: NumberSequenceRow[];
  idempotencyKey: IdempotencyKeyRow[];
  meetingMinutes: MeetingMinutesRow[];
  meetingAttendee: MeetingAttendeeRow[];
  pastCase: PastCaseRow[];
  pastCaseLot: PastCaseLotRow[];
};

export type TableName = keyof MockTables;
export type RowOf<K extends TableName> = MockTables[K][number];
/** insertRow에 넘기는 값: id는 자동, 생성·수정 시각은 생략하면 트랜잭션 시각 */
export type NewRowValues<K extends TableName> = Omit<RowOf<K>, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<RowOf<K>, 'createdAt' | 'updatedAt'>>;

/** 테이블의 DB명 (용어 사전 DB명 = ERD 테이블명). 작업 로그의 대상 구분(target_type)에 쓴다. */
export const DB_TABLE_NAME = {
  department: 'department',
  jobGrade: 'job_grade',
  role: 'role',
  rolePermission: 'role_permission',
  employee: 'employee',
  steelGrade: 'steel_grade',
  item: 'item',
  specMapping: 'spec_mapping',
  routing: 'routing',
  specificConsumption: 'specific_consumption',
  customer: 'customer',
  supplier: 'supplier',
  yard: 'yard',
  productionSetting: 'production_setting',
  inspectionStandard: 'inspection_standard',
  inspectionStandardItem: 'inspection_standard_item',
  salesOrder: 'sales_order',
  salesOrderItem: 'sales_order_item',
  inventory: 'inventory',
  reservation: 'reservation',
  allocation: 'allocation',
  productionPlan: 'production_plan',
  productionResult: 'production_result',
  lot: 'lot',
  lotRelation: 'lot_relation',
  purchaseRequisition: 'purchase_requisition',
  purchaseOrder: 'purchase_order',
  purchaseOrderItem: 'purchase_order_item',
  goodsReceipt: 'goods_receipt',
  qualityInspection: 'quality_inspection',
  qualityInspectionValue: 'quality_inspection_value',
  shipmentRequest: 'shipment_request',
  shipmentRequestItem: 'shipment_request_item',
  millSheet: 'mill_sheet',
  businessEvent: 'business_event',
  businessEventLot: 'business_event_lot',
  task: 'task',
  notification: 'notification',
  chatRoom: 'chat_room',
  chatRoomMember: 'chat_room_member',
  message: 'message',
  actionDraft: 'action_draft',
  numberSequence: 'number_sequence',
  idempotencyKey: 'idempotency_key',
  meetingMinutes: 'meeting_minutes',
  meetingAttendee: 'meeting_attendee',
  pastCase: 'past_case',
  pastCaseLot: 'past_case_lot',
} as const satisfies Record<TableName, string>;
export type DbTableName = (typeof DB_TABLE_NAME)[TableName];

export const TABLE_NAMES = Object.keys(DB_TABLE_NAME) as TableName[];

export function createEmptyTables(): MockTables {
  return {
    department: [],
    jobGrade: [],
    role: [],
    rolePermission: [],
    employee: [],
    steelGrade: [],
    item: [],
    specMapping: [],
    routing: [],
    specificConsumption: [],
    customer: [],
    supplier: [],
    yard: [],
    productionSetting: [],
    inspectionStandard: [],
    inspectionStandardItem: [],
    salesOrder: [],
    salesOrderItem: [],
    inventory: [],
    reservation: [],
    allocation: [],
    productionPlan: [],
    productionResult: [],
    lot: [],
    lotRelation: [],
    purchaseRequisition: [],
    purchaseOrder: [],
    purchaseOrderItem: [],
    goodsReceipt: [],
    qualityInspection: [],
    qualityInspectionValue: [],
    shipmentRequest: [],
    shipmentRequestItem: [],
    millSheet: [],
    businessEvent: [],
    businessEventLot: [],
    task: [],
    notification: [],
    chatRoom: [],
    chatRoomMember: [],
    message: [],
    actionDraft: [],
    numberSequence: [],
    idempotencyKey: [],
    meetingMinutes: [],
    meetingAttendee: [],
    pastCase: [],
    pastCaseLot: [],
  };
}
