// 공통 코드 (공통 코드 정의서 그대로, PLAN 4장). 상수 이름은 코드 그룹 ID와 같다 (코드 컨벤션 4장).
// 문서에 없는 그룹(EMPLOYEE_STATUS, CONSUMPTION_UNIT, PRODUCTION_RESULT_STATUS, GOODS_RECEIPT_STATUS,
// SHIPMENT_REQUEST_ITEM_STATUS, GOODS_ISSUE_STATUS, PDF_STATUS, MESSAGE_TYPE, REQUISITION_SOURCE_TYPE,
// LOT_RELATION_TYPE, EVENT_TARGET_TYPE, EVENT_REASON_CODE, WIDGET_CODE)은 두지 않는다.
export * from '@/codes/auth';
export * from '@/codes/businessEvent';
export * from '@/codes/collaboration';
export * from '@/codes/errors';
export * from '@/codes/inventory';
export * from '@/codes/lot';
export * from '@/codes/masterData';
export * from '@/codes/numbering';
export * from '@/codes/workflow';
