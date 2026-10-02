// 업무 번호·LOT 번호 형식 (업무 프로세스 정의서 9.1·9.2, REQ-LOT-003). DB를 쓰지 않는 순수 함수.
import { seoulDateParts } from '../time/seoul-date';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** 순번이 자리수를 넘으면 실패시킨다. 자리수 초과 처리는 정의서 9.2에서 TBD */
function seq(n: number, width: number): string {
  if (!Number.isInteger(n) || n < 1 || n >= 10 ** width) throw new Error(`채번 순번이 범위를 벗어났습니다: ${n} (${width}자리)`);
  return pad(n, width);
}

/** 업무 번호 종류: 접두어와 순번 자리수 (9.1). 순번은 YYMM(이벤트는 YYMMDD)마다 1부터 */
export const DOCUMENT_NUMBER = {
  SALES_ORDER: { prefix: 'SO', width: 3, daily: false },
  PRODUCTION_PLAN: { prefix: 'PP', width: 4, daily: false },
  PURCHASE_REQUISITION: { prefix: 'PR', width: 4, daily: false },
  PURCHASE_ORDER: { prefix: 'PO', width: 4, daily: false },
  GOODS_RECEIPT: { prefix: 'GR', width: 4, daily: false },
  SHIPMENT_REQUEST: { prefix: 'DR', width: 4, daily: false },
  BUSINESS_EVENT: { prefix: 'EV', width: 3, daily: true },
} as const;
export type DocumentNumberKind = keyof typeof DOCUMENT_NUMBER;

/** 순번을 뺀 앞부분. 예: SO-2610- / EV-261004- */
export function documentNumberPrefix(kind: DocumentNumberKind, at: Date = new Date()): string {
  const { prefix, daily } = DOCUMENT_NUMBER[kind];
  const { yy, mm, dd } = seoulDateParts(at);
  return `${prefix}-${yy}${mm}${daily ? dd : ''}-`;
}

/** 예: formatDocumentNumber('SALES_ORDER', 1) → SO-2610-001 */
export function formatDocumentNumber(kind: DocumentNumberKind, n: number, at: Date = new Date()): string {
  return `${documentNumberPrefix(kind, at)}${seq(n, DOCUMENT_NUMBER[kind].width)}`;
}

/** 밀시트: MS-{출하요청 일련}-N, 수주별 순번. 예: DR-2610-0028의 첫 밀시트 → MS-2610-0028-1 */
export function formatMillSheetNumber(shipmentRequestNo: string, n: number): string {
  if (!/^DR-\d{4}-\d{4}$/.test(shipmentRequestNo)) throw new Error(`출하요청 번호 형식이 아닙니다: ${shipmentRequestNo}`);
  if (!Number.isInteger(n) || n < 1) throw new Error(`밀시트 순번이 범위를 벗어났습니다: ${n}`);
  return `MS-${shipmentRequestNo.slice(3)}-${n}`;
}

/** LOT 번호 앞부분 (9.2). 원료 RM-원료코드-YYMMDD- / 용선 HM-고로-YYMMDD- / 히트 HT-전로-YYMMDD- */
export const LOT_NUMBER = {
  RAW_MATERIAL: { prefix: 'RM', width: 3 },
  HOT_METAL: { prefix: 'HM', width: 2 },
  HEAT: { prefix: 'HT', width: 3 },
} as const;
export type DatedLotKind = keyof typeof LOT_NUMBER;

/** code: 원료 코드(ORE01)·고로 코드(BF2)·전로 코드(BOF1) */
export function lotNumberPrefix(kind: DatedLotKind, code: string, at: Date = new Date()): string {
  const { yy, mm, dd } = seoulDateParts(at);
  return `${LOT_NUMBER[kind].prefix}-${code}-${yy}${mm}${dd}-`;
}

/** 예: formatLotNumber('HEAT', 'BOF1', 15) → HT-BOF1-260929-015 */
export function formatLotNumber(kind: DatedLotKind, code: string, n: number, at: Date = new Date()): string {
  return `${lotNumberPrefix(kind, code, at)}${seq(n, LOT_NUMBER[kind].width)}`;
}

/** 슬래브: 히트번호-SS. 예: HT-BOF1-260929-015, 3 → HT-BOF1-260929-015-03 */
export function formatSlabNumber(heatNo: string, n: number): string {
  return `${heatNo}-${seq(n, 2)}`;
}

/** 코일: C + 슬래브번호(HT- 제외). 예: HT-BOF1-260929-015-03 → CBOF1-260929-015-03 */
export function formatCoilNumber(slabNo: string): string {
  if (!slabNo.startsWith('HT-')) throw new Error(`슬래브 번호 형식이 아닙니다: ${slabNo}`);
  return `C${slabNo.slice(3)}`;
}

/** 같은 앞부분의 번호 중 가장 큰 것에서 다음 순번을 구한다 (없으면 1) */
export function nextSequence(prefix: string, lastNumber: string | null | undefined): number {
  if (!lastNumber) return 1;
  if (!lastNumber.startsWith(prefix)) throw new Error(`앞부분이 다른 번호입니다: ${lastNumber} (${prefix})`);
  return Number(lastNumber.slice(prefix.length)) + 1;
}
