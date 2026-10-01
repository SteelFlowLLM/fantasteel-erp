// 업무 번호·LOT 번호 채번 (업무 프로세스 9.1·9.2). 종류·날짜·고로·전로·원료별 카운터(number_sequence)를 쓴다.
// 날짜 부분은 Asia/Seoul 기준이다 (컨벤션 5장).
import {
  businessNoSequenceKey,
  formatBusinessNo,
  formatCoilNo,
  formatEventNo,
  formatHeatNo,
  formatHotMetalNo,
  formatMillSheetNo,
  formatRawMaterialLotNo,
  formatSlabNo,
  type BusinessNoKind,
} from '@/codes';
import { toSeoulYyMm, toSeoulYyMmDd } from '@/lib/seoulDate';
import { insertRow, type MockTx } from '@/mock/store';

/** 카운터를 1 올리고 새 값을 돌려준다. 카운터가 없으면 1부터 시작한다. */
export function nextSequenceValue(tx: MockTx, sequenceKey: string): number {
  const row = tx.tables.numberSequence.find((r) => r.sequenceKey === sequenceKey);
  if (row) {
    row.lastValue += 1;
    row.updatedAt = tx.nowIso;
    return row.lastValue;
  }
  insertRow(tx, 'numberSequence', { sequenceKey, lastValue: 1 });
  return 1;
}

/** SO-YYMM-NNN · PP-YYMM-NNNN · PR-/PO-/GR-YYMM-NNNN · DR-YYMM-NNNN */
export function issueBusinessNo(tx: MockTx, kind: BusinessNoKind, at: Date = tx.now): string {
  const yymm = toSeoulYyMm(at);
  return formatBusinessNo(kind, yymm, nextSequenceValue(tx, businessNoSequenceKey(kind, yymm)));
}

/** EV-YYMMDD-NNN */
export function issueEventNo(tx: MockTx, at: Date = tx.now): string {
  const yymmdd = toSeoulYyMmDd(at);
  return formatEventNo(yymmdd, nextSequenceValue(tx, `EV-${yymmdd}`));
}

/** MS-{출하요청 일련}-N (출하요청 안의 수주별 순번) */
export function issueMillSheetNo(tx: MockTx, shipmentRequestNo: string): string {
  const key = `MS-${shipmentRequestNo.replace(/^DR-/, '')}`;
  return formatMillSheetNo(shipmentRequestNo, nextSequenceValue(tx, key));
}

/** RM-원료코드-YYMMDD-NNN */
export function issueRawMaterialLotNo(tx: MockTx, rawMaterialCode: string, at: Date = tx.now): string {
  const yymmdd = toSeoulYyMmDd(at);
  return formatRawMaterialLotNo(rawMaterialCode, yymmdd, nextSequenceValue(tx, `RM-${rawMaterialCode}-${yymmdd}`));
}

/** HM-고로-YYMMDD-NN */
export function issueHotMetalNo(tx: MockTx, blastFurnaceCode: string, at: Date = tx.now): string {
  const yymmdd = toSeoulYyMmDd(at);
  return formatHotMetalNo(blastFurnaceCode, yymmdd, nextSequenceValue(tx, `HM-${blastFurnaceCode}-${yymmdd}`));
}

/** HT-전로-YYMMDD-NNN */
export function issueHeatNo(tx: MockTx, converterCode: string, at: Date = tx.now): string {
  const yymmdd = toSeoulYyMmDd(at);
  return formatHeatNo(converterCode, yymmdd, nextSequenceValue(tx, `HT-${converterCode}-${yymmdd}`));
}

/** 히트번호-SS (히트 안 순번) */
export function issueSlabNo(tx: MockTx, heatNo: string): string {
  return formatSlabNo(heatNo, nextSequenceValue(tx, heatNo));
}

/** C + 슬래브번호(HT- 제외). 슬래브 1매 = 코일 1개라 카운터가 없다. */
export const coilNoOf = (slabNo: string): string => formatCoilNo(slabNo);
