import { describe, expect, it } from 'vitest';
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
  formatSpecCode,
  RAW_MATERIAL_CODE_PATTERN,
} from '@/codes';
import { toSeoulYyMm, toSeoulYyMmDd } from '@/lib/seoulDate';

describe('업무 번호 (업무 프로세스 9.1 예시)', () => {
  it('수주·생산계획·구매·출하요청 번호', () => {
    expect(formatBusinessNo('SALES_ORDER', '2610', 1)).toBe('SO-2610-001');
    expect(formatBusinessNo('PRODUCTION_PLAN', '2610', 1)).toBe('PP-2610-0001');
    expect(formatBusinessNo('PURCHASE_REQUISITION', '2610', 12)).toBe('PR-2610-0012');
    expect(formatBusinessNo('PURCHASE_ORDER', '2610', 12)).toBe('PO-2610-0012');
    expect(formatBusinessNo('GOODS_RECEIPT', '2610', 12)).toBe('GR-2610-0012');
    expect(formatBusinessNo('SHIPMENT_REQUEST', '2610', 17)).toBe('DR-2610-0017');
  });

  it('카운터 키는 접두어-YYMM', () => {
    expect(businessNoSequenceKey('SALES_ORDER', '2610')).toBe('SO-2610');
  });

  it('밀시트: MS-{출하요청 일련}-수주별 순번', () => {
    expect(formatMillSheetNo('DR-2610-0028', 1)).toBe('MS-2610-0028-1');
  });

  it('작업 로그 이벤트: EV-YYMMDD-NNN', () => {
    expect(formatEventNo('261004', 23)).toBe('EV-261004-023');
  });

  it('일련번호는 1 이상의 정수', () => {
    expect(() => formatBusinessNo('SALES_ORDER', '2610', 0)).toThrow(RangeError);
    expect(() => formatEventNo('261004', 1.5)).toThrow(RangeError);
  });
});

describe('LOT 번호 (업무 프로세스 9.2 예시)', () => {
  it('원료·용선·히트·슬래브·코일', () => {
    expect(formatRawMaterialLotNo('ORE01', '260929', 1)).toBe('RM-ORE01-260929-001');
    expect(formatHotMetalNo('BF2', '260929', 3)).toBe('HM-BF2-260929-03');
    const heatNo = formatHeatNo('BOF1', '260929', 15);
    expect(heatNo).toBe('HT-BOF1-260929-015');
    const slabNo = formatSlabNo(heatNo, 3);
    expect(slabNo).toBe('HT-BOF1-260929-015-03');
    expect(formatCoilNo(slabNo)).toBe('CBOF1-260929-015-03');
  });
});

describe('규격 코드·원료 코드 (REQ-MST-001·003)', () => {
  it('SL-/CL-강종-두께x폭x길이, 소수 끝 0은 지운다', () => {
    expect(formatSpecCode('SLAB', 'SS275', '250.00', '1500.00', '10000.00')).toBe('SL-SS275-250x1500x10000');
    expect(formatSpecCode('COIL', 'SM355A', '2.30', '1200.00', '1065000.00')).toBe('CL-SM355A-2.3x1200x1065000');
  });

  it('원료 코드는 영문 3자 + 숫자 2자리', () => {
    expect(RAW_MATERIAL_CODE_PATTERN.test('ORE01')).toBe(true);
    expect(RAW_MATERIAL_CODE_PATTERN.test('IO')).toBe(false);
    expect(RAW_MATERIAL_CODE_PATTERN.test('SMN001')).toBe(false);
  });
});

describe('Asia/Seoul 날짜 부분', () => {
  it('UTC 15시 이후는 서울 기준 다음 날이다', () => {
    const at = new Date('2026-09-30T15:30:00Z');
    expect(toSeoulYyMmDd(at)).toBe('261001');
    expect(toSeoulYyMm(at)).toBe('2610');
  });
});
