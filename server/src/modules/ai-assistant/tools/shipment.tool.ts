import {
  PERMISSION,
  SHIPMENT_REQUEST_STATUS,
  SHIPMENT_REQUEST_STATUS_LABEL,
  type MillSheetSummary,
  type ShipmentRequestStatus,
  type ShipmentRequestSummary,
} from '@fantasteel/shared';
import type { ShipmentService } from '../../shipment/shipment.service';
import { codeLabelList, limitRows, looseIncludes, optionalEnum, optionalString, seoulDateTimeText, TOOL_ROW_LIMIT, type AssistantTool } from './assistant-tool';

/** 번호로 거를 때 한 번에 읽는 수 (API 상한 100) */
const SCAN_SIZE = 100;
const REQUEST_STATUSES = Object.values(SHIPMENT_REQUEST_STATUS) as ShipmentRequestStatus[];

/** 출하요청 (GET /shipment-requests). 권한이 "출하요청 관리 또는 출고 확정" VIEW라 service가 확인한다 */
export function shipmentRequestTool(shipments: ShipmentService): AssistantTool {
  return {
    access: { checkedBy: 'SERVICE', permissions: [PERMISSION.SHIPMENT_REQUEST_MANAGE, PERMISSION.GOODS_ISSUE_CONFIRM] },
    definition: {
      name: 'get_shipment_requests',
      description: '출하요청(고객사·출하 예정일·상태·요청 매수·출고 확정 시각)을 조회한다. 상태·출하요청 번호·고객사 이름으로 거른다.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: REQUEST_STATUSES, description: `출하요청 상태: ${codeLabelList(SHIPMENT_REQUEST_STATUS_LABEL)}` },
          shipmentRequestNo: { type: 'string', description: '출하요청 번호 일부' },
          customerName: { type: 'string', description: '고객사 이름 일부' },
        },
      },
    },
    async run(args, user) {
      const status = optionalEnum(args, 'status', REQUEST_STATUSES);
      const shipmentRequestNo = optionalString(args, 'shipmentRequestNo', 30);
      const customerName = optionalString(args, 'customerName');
      const label = `출하요청${status ? ` · ${SHIPMENT_REQUEST_STATUS_LABEL[status]}` : ''}${shipmentRequestNo ? ` · ${shipmentRequestNo}` : ''}${customerName ? ` · ${customerName}` : ''}`;
      // API는 고객사 id로만 거른다. 이름은 100건을 읽어 서버에서 거른다
      if (customerName) {
        const page = await shipments.list(user, { shipmentRequestStatus: status, shipmentRequestNo, page: 1, size: SCAN_SIZE });
        const rows = page.items.filter((r) => looseIncludes([r.customerName], customerName));
        const limited = limitRows(rows);
        return { label, data: { '출하요청 수': rows.length, 출하요청: limited.rows.map(requestRow), '생략 줄 수': limited.omitted } };
      }
      const page = await shipments.list(user, { shipmentRequestStatus: status, shipmentRequestNo, page: 1, size: TOOL_ROW_LIMIT });
      return {
        label,
        data: { '출하요청 수': page.total, 출하요청: page.items.map(requestRow), '생략 줄 수': Math.max(0, page.total - page.items.length) },
      };
    },
  };
}

/** 밀시트 (GET /mill-sheets, 밀시트 조회 VIEW) */
export function millSheetTool(shipments: ShipmentService): AssistantTool {
  return {
    access: { checkedBy: 'TOOLBOX', permissions: [PERMISSION.MILL_SHEET_READ] },
    definition: {
      name: 'get_mill_sheets',
      description: '발행된 밀시트(밀시트 번호·출하요청 번호·수주번호·발행 시각)를 최신순으로 조회한다. 수주번호·출하요청 번호 일부로 거른다.',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '밀시트 번호·출하요청 번호·수주번호 일부' } },
      },
    },
    async run(args) {
      const keyword = optionalString(args, 'keyword');
      const page = await shipments.listMillSheets({ page: 1, size: keyword ? SCAN_SIZE : TOOL_ROW_LIMIT });
      const rows = keyword ? page.items.filter((m) => looseIncludes([m.millSheetNo, m.shipmentRequestNo, m.salesOrderNo], keyword)) : page.items;
      const limited = limitRows(rows);
      return {
        label: `밀시트${keyword ? ` · ${keyword}` : ''}`,
        data: { '밀시트 수': keyword ? rows.length : page.total, 밀시트: limited.rows.map(millSheetRow), '생략 줄 수': keyword ? limited.omitted : Math.max(0, page.total - limited.rows.length) },
      };
    },
  };
}

function requestRow(r: ShipmentRequestSummary) {
  return {
    '출하요청 번호': r.shipmentRequestNo,
    고객사: r.customerName,
    '출하 예정일': r.shipDate,
    상태: SHIPMENT_REQUEST_STATUS_LABEL[r.shipmentRequestStatus],
    '요청 매수': r.totalRequestQty,
    '출고 확정 시각': r.issuedAt ? seoulDateTimeText(r.issuedAt) : null,
  };
}

function millSheetRow(m: MillSheetSummary) {
  return { '밀시트 번호': m.millSheetNo, '출하요청 번호': m.shipmentRequestNo, 수주번호: m.salesOrderNo, '발행 시각': seoulDateTimeText(m.issuedAt) };
}
