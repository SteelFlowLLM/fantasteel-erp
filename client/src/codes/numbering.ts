// 업무 번호(업무 프로세스 9.1)·LOT 번호(9.2, REQ-LOT-003)·규격 코드(REQ-MST-003) 형식.
// 공통 코드가 아니다 (공통 코드 정의서 4장). 날짜 부분은 Asia/Seoul 기준이다.
// 자리수를 넘는 일련번호는 9.2에서 TBD라 자리를 늘려 그대로 붙인다.

import type { ProductItemType } from '@/codes/masterData';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

function assertSequence(seq: number): void {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`일련번호는 1 이상의 정수여야 해요: ${seq}`);
}

/** 업무 번호 종류별 접두어와 일련번호 자리수 (9.1) */
export const BUSINESS_NO_FORMAT = {
  SALES_ORDER: { prefix: 'SO', digits: 3 },
  PRODUCTION_PLAN: { prefix: 'PP', digits: 4 },
  PURCHASE_REQUISITION: { prefix: 'PR', digits: 4 },
  PURCHASE_ORDER: { prefix: 'PO', digits: 4 },
  GOODS_RECEIPT: { prefix: 'GR', digits: 4 },
  SHIPMENT_REQUEST: { prefix: 'DR', digits: 4 },
} as const;
export type BusinessNoKind = keyof typeof BUSINESS_NO_FORMAT;

/** SO-2610-001 · PP-2610-0001 · PR-/PO-/GR-2610-0012 · DR-2610-0017 */
export function formatBusinessNo(kind: BusinessNoKind, yymm: string, seq: number): string {
  assertSequence(seq);
  const { prefix, digits } = BUSINESS_NO_FORMAT[kind];
  return `${prefix}-${yymm}-${pad(seq, digits)}`;
}

/** 일련번호 카운터 키 (ERD number_sequence.sequence_key 예: SO-2610) */
export function businessNoSequenceKey(kind: BusinessNoKind, yymm: string): string {
  return `${BUSINESS_NO_FORMAT[kind].prefix}-${yymm}`;
}

/** MS-{출하요청 일련}-N, N = 출하요청 안의 수주별 순번 (예: DR-2610-0028 → MS-2610-0028-1) */
export function formatMillSheetNo(shipmentRequestNo: string, seq: number): string {
  assertSequence(seq);
  return `MS-${shipmentRequestNo.replace(/^DR-/, '')}-${seq}`;
}

/** EV-YYMMDD-NNN (예: EV-261004-023) */
export function formatEventNo(yymmdd: string, seq: number): string {
  assertSequence(seq);
  return `EV-${yymmdd}-${pad(seq, 3)}`;
}

/** 고로·전로 코드 (PLAN 4장). 설비 관리는 범위 밖이라 마스터 없이 상수로 둔다. */
export const BLAST_FURNACE_CODES = ['BF2'] as const;
export const CONVERTER_CODES = ['BOF1'] as const;
export type BlastFurnaceCode = (typeof BLAST_FURNACE_CODES)[number];
export type ConverterCode = (typeof CONVERTER_CODES)[number];

/** 원료 LOT: RM-원료코드-YYMMDD-NNN (예: RM-ORE01-260929-001) */
export function formatRawMaterialLotNo(rawMaterialCode: string, yymmdd: string, seq: number): string {
  assertSequence(seq);
  return `RM-${rawMaterialCode}-${yymmdd}-${pad(seq, 3)}`;
}

/** 용선 LOT: HM-고로-YYMMDD-NN (예: HM-BF2-260929-03) */
export function formatHotMetalNo(blastFurnaceCode: string, yymmdd: string, seq: number): string {
  assertSequence(seq);
  return `HM-${blastFurnaceCode}-${yymmdd}-${pad(seq, 2)}`;
}

/** 히트 LOT: HT-전로-YYMMDD-NNN (예: HT-BOF1-260929-015) */
export function formatHeatNo(converterCode: string, yymmdd: string, seq: number): string {
  assertSequence(seq);
  return `HT-${converterCode}-${yymmdd}-${pad(seq, 3)}`;
}

/** 슬래브 LOT: 히트번호-SS (예: HT-BOF1-260929-015-03) */
export function formatSlabNo(heatNo: string, seq: number): string {
  assertSequence(seq);
  return `${heatNo}-${pad(seq, 2)}`;
}

/** 코일 LOT: C + 슬래브번호(HT- 제외) (예: CBOF1-260929-015-03) */
export function formatCoilNo(slabNo: string): string {
  return `C${slabNo.replace(/^HT-/, '')}`;
}

/** 원료 코드: 영문 3자 + 숫자 2자리 (REQ-MST-001, 예: ORE01) */
export const RAW_MATERIAL_CODE_PATTERN = /^[A-Z]{3}\d{2}$/;

const trimDecimal = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

/** 규격 코드: 유형(SL 슬래브 / CL 코일)-강종-두께x폭x길이 (REQ-MST-003, 예: SL-SS275-250x1500x10000) */
export function formatSpecCode(
  itemType: ProductItemType,
  steelGradeCode: string,
  thicknessMm: string,
  widthMm: string,
  lengthMm: string,
): string {
  const prefix = itemType === 'SLAB' ? 'SL' : 'CL';
  return `${prefix}-${steelGradeCode}-${trimDecimal(thicknessMm)}x${trimDecimal(widthMm)}x${trimDecimal(lengthMm)}`;
}
