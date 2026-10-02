import {
  formatCoilNumber,
  formatDocumentNumber,
  formatLotNumber,
  formatMillSheetNumber,
  formatSlabNumber,
  documentNumberPrefix,
  nextSequence,
} from './number-format';

// 2026-10-04 09:30 서울 = 2026-10-04 00:30 UTC
const at = new Date('2026-10-04T00:30:00.000Z');

describe('업무 번호 (업무 프로세스 정의서 9.1)', () => {
  it('정의서 예시 형식으로 만든다', () => {
    expect(formatDocumentNumber('SALES_ORDER', 1, at)).toBe('SO-2610-001');
    expect(formatDocumentNumber('PRODUCTION_PLAN', 1, at)).toBe('PP-2610-0001');
    expect(formatDocumentNumber('PURCHASE_REQUISITION', 12, at)).toBe('PR-2610-0012');
    expect(formatDocumentNumber('PURCHASE_ORDER', 3, at)).toBe('PO-2610-0003');
    expect(formatDocumentNumber('GOODS_RECEIPT', 3, at)).toBe('GR-2610-0003');
    expect(formatDocumentNumber('SHIPMENT_REQUEST', 17, at)).toBe('DR-2610-0017');
    expect(formatDocumentNumber('BUSINESS_EVENT', 23, at)).toBe('EV-261004-023');
  });

  it('날짜는 서울 기준이다 (UTC로는 전날이어도 서울 날짜를 쓴다)', () => {
    expect(documentNumberPrefix('BUSINESS_EVENT', new Date('2026-09-30T15:00:00.000Z'))).toBe('EV-261001-');
  });

  it('밀시트는 출하요청 일련 + 수주별 순번', () => {
    expect(formatMillSheetNumber('DR-2610-0028', 1)).toBe('MS-2610-0028-1');
  });

  it('자리수를 넘는 순번은 거부한다', () => {
    expect(() => formatDocumentNumber('SALES_ORDER', 1000, at)).toThrow();
  });
});

describe('LOT 번호 (REQ-LOT-003, 정의서 9.2)', () => {
  const day = new Date('2026-09-29T03:00:00.000Z');
  it('원료·용선·히트', () => {
    expect(formatLotNumber('RAW_MATERIAL', 'ORE01', 1, day)).toBe('RM-ORE01-260929-001');
    expect(formatLotNumber('HOT_METAL', 'BF2', 3, day)).toBe('HM-BF2-260929-03');
    expect(formatLotNumber('HEAT', 'BOF1', 15, day)).toBe('HT-BOF1-260929-015');
  });
  it('슬래브 = 히트번호-SS, 코일 = C + 슬래브번호(HT- 제외)', () => {
    const slab = formatSlabNumber('HT-BOF1-260929-015', 3);
    expect(slab).toBe('HT-BOF1-260929-015-03');
    expect(formatCoilNumber(slab)).toBe('CBOF1-260929-015-03');
  });
});

describe('다음 순번', () => {
  it('없으면 1, 있으면 최댓값 + 1', () => {
    expect(nextSequence('SO-2610-', null)).toBe(1);
    expect(nextSequence('SO-2610-', 'SO-2610-007')).toBe(8);
  });
});
