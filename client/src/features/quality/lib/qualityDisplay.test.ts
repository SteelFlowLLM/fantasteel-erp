import { describe, expect, it } from 'vitest';
import {
  fillTypicalValues,
  gaugeEdgeLabels,
  gaugeGeometry,
  inspectionItemCodesOfHistory,
  inspectionResultOfSnapshot,
  limitText,
  measuredCardsPerRow,
  qtyUnitOfItem,
  qtyUnitOfLot,
  measuredValueChanges,
  previewOf,
  sameMeasuredValue,
  thicknessBandText,
  trimNum,
} from '@/features/quality/lib/qualityDisplay';

describe('기준 문구', () => {
  it('자리수를 정리하고 이상·이하로 쓴다', () => {
    expect(trimNum('0.2500')).toBe('0.25');
    expect(trimNum('400.0000')).toBe('400');
    expect(limitText({ minValue: '-0.28', maxValue: '0.28', unit: 'mm' })).toBe('-0.28 – 0.28 mm');
    expect(limitText({ minValue: '355', maxValue: null, unit: 'MPa' })).toBe('355 MPa 이상');
    expect(limitText({ minValue: null, maxValue: '0.045', unit: '%' })).toBe('0.045 % 이하');
    expect(limitText({ minValue: null, maxValue: null })).toBe('기준 없음');
  });

  it('게이지 눈금 글자는 단위를 붙이고, 한쪽 기준만 있으면 이상·이하를 붙인다 (카드 아래 "기준" 줄 대신)', () => {
    expect(gaugeEdgeLabels({ minValue: '-5.0000', maxValue: '5.0000', unit: 'mm' })).toEqual({ min: '-5 mm', max: '5 mm' });
    expect(gaugeEdgeLabels({ minValue: null, maxValue: '0.2500', unit: '%' })).toEqual({ min: null, max: '0.25 % 이하' });
    expect(gaugeEdgeLabels({ minValue: '355', maxValue: null, unit: 'N/mm²' })).toEqual({ min: '355 N/mm² 이상', max: null });
    expect(gaugeEdgeLabels({ minValue: '0', maxValue: '2' })).toEqual({ min: '0', max: '2' });
  });

  it('두께 구간은 초과~이하로 보인다', () => {
    expect(thicknessBandText('6', '16')).toBe('두께 6 초과 ~ 16 이하 mm');
    expect(thicknessBandText('6', null)).toBe('두께 6 초과 mm');
    expect(thicknessBandText(null, '16')).toBe('두께 16 이하 mm');
    expect(thicknessBandText(null, null)).toBeNull();
  });
});

describe('입력 중 미리보기 (판정 함수 judgeValue 사용, 경계 포함)', () => {
  const item = { minValue: '355', maxValue: '630', unit: 'MPa' };

  it('경계값은 합격, 벗어나면 얼마나 벗어났는지 알려 준다', () => {
    expect(previewOf('', item)).toEqual({ state: 'empty' });
    expect(previewOf('355', item)).toEqual({ state: 'pass' });
    expect(previewOf('630', item)).toEqual({ state: 'pass' });
    expect(previewOf('354.9', item)).toEqual({ state: 'fail', side: 'below', gap: '0.1' });
    expect(previewOf('631.25', item)).toEqual({ state: 'fail', side: 'above', gap: '1.25' });
  });

  it('숫자(정수 8자리·소수 4자리) 형식이 아니면 확인 표시', () => {
    expect(previewOf('1.23456', item)).toEqual({ state: 'invalid' });
    expect(previewOf('12a', item)).toEqual({ state: 'invalid' });
    expect(previewOf('-', item)).toEqual({ state: 'invalid' });
    expect(previewOf('-0.05', { minValue: '-0.28', maxValue: '0.28' })).toEqual({ state: 'pass' });
  });

  it('저장값과 입력값은 자리수만 다르면 같다고 본다', () => {
    expect(sameMeasuredValue('0.1800', '0.18')).toBe(true);
    expect(sameMeasuredValue('0.1800', '0.19')).toBe(false);
    expect(sameMeasuredValue(null, '')).toBe(true);
    expect(sameMeasuredValue(null, '1')).toBe(false);
    expect(sameMeasuredValue('1', '')).toBe(false);
  });
});

describe('게이지·채우기', () => {
  it('기준 구간과 측정값 위치(%)를 0~100 안에 둔다', () => {
    const g = gaugeGeometry({ minValue: '0', maxValue: '2' }, '1');
    expect(g).toEqual({ from: 25, to: 75, mark: 50 });
    expect(gaugeGeometry({ minValue: '0', maxValue: '2' }, '99')?.mark).toBe(100);
    expect(gaugeGeometry({ minValue: null, maxValue: null }, '1')).toBeNull();
    expect(gaugeGeometry({ minValue: '27', maxValue: null }, 'abc')?.mark).toBeNull();
  });

  it("'기준 안 값으로 채우기'는 빈 칸만 기준 안 대표값으로 채운다", () => {
    const items = [
      { inspectionStandardItemId: 1, minValue: '0', maxValue: '2.00' },
      { inspectionStandardItemId: 2, minValue: '355', maxValue: null },
      { inspectionStandardItemId: 3, minValue: null, maxValue: '0.045' },
      { inspectionStandardItemId: 4, minValue: null, maxValue: null },
    ];
    const filled = fillTypicalValues(items, { 2: '400' });
    expect(filled).toEqual({ 1: '1', 2: '400', 3: '0.036' });
    for (const item of items.slice(0, 3)) expect(previewOf(filled[item.inspectionStandardItemId] ?? '', item).state).toBe('pass');
  });
});

describe('작업 로그 전후 비교 (REQ-QC-003)', () => {
  it('바뀐 측정값과 판정만 꺼낸다', () => {
    const before = {
      inspectionResult: 'FAIL',
      values: [
        { inspectionItemCode: 'SURFACE_DEFECT_DEPTH', measuredValue: '3.5000', isPassed: false },
        { inspectionItemCode: 'WIDTH_DEV', measuredValue: '1.0000', isPassed: true },
      ],
    };
    const after = {
      inspectionResult: 'PASS',
      values: [
        { inspectionItemCode: 'SURFACE_DEFECT_DEPTH', measuredValue: '1.0000', isPassed: true },
        { inspectionItemCode: 'WIDTH_DEV', measuredValue: '1.0', isPassed: true },
        { inspectionItemCode: 'LENGTH_DEV', measuredValue: '2', isPassed: true },
      ],
    };
    expect(measuredValueChanges(before, after)).toEqual([
      { inspectionItemCode: 'SURFACE_DEFECT_DEPTH', before: '3.5000', after: '1.0000' },
      { inspectionItemCode: 'LENGTH_DEV', before: null, after: '2' },
    ]);
    expect(measuredValueChanges(null, after)).toHaveLength(3);
    expect(inspectionResultOfSnapshot(before)).toBe('FAIL');
    expect(inspectionResultOfSnapshot(null)).toBeNull();
  });
});

describe('작업 로그의 검사 항목 코드', () => {
  it('검사 등록의 전후 값에 나온 코드만 모으고, 다른 종류의 작업 로그는 건너뛴다', () => {
    const values = (codes: string[]) => ({ inspectionResult: 'PASS', values: codes.map((c) => ({ inspectionItemCode: c, measuredValue: '1' })) });
    const codes = inspectionItemCodesOfHistory([
      { businessEventType: 'INSPECTION_REGISTERED', beforeData: null, afterData: values(['THICKNESS_DEV', 'WIDTH_DEV']) },
      { businessEventType: 'INSPECTION_REGISTERED', beforeData: values(['WIDTH_DEV']), afterData: values(['SURFACE_DEFECT_DEPTH']) },
      { businessEventType: 'DISPOSITION_SET', beforeData: values(['C']), afterData: null },
    ]);
    expect(codes.sort()).toEqual(['SURFACE_DEFECT_DEPTH', 'THICKNESS_DEV', 'WIDTH_DEV']);
  });
});

describe('측정값 카드 한 줄 개수 (넓은 화면)', () => {
  it('마지막 줄이 더 꽉 차는 쪽(3 또는 4)을 고른다', () => {
    // 히트 성분 5개는 3 + 2, 슬래브 4개는 한 줄, 코일 6개는 3 + 3, 열연 16개는 4줄
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 16].map(measuredCardsPerRow)).toEqual([1, 2, 3, 4, 3, 3, 4, 4, 3, 4]);
  });
});

describe('매수 단위 (슬래브 매 · 코일 개)', () => {
  it('수주 품목·LOT 종류로 단위를 고른다. 히트는 연결 수주 품목을 따른다', () => {
    expect(qtyUnitOfItem({ itemType: 'COIL' })).toBe('개');
    expect(qtyUnitOfItem({ itemType: 'SLAB' })).toBe('매');
    expect(qtyUnitOfItem(null)).toBe('매');
    expect(qtyUnitOfLot('COIL', null)).toBe('개');
    expect(qtyUnitOfLot('SLAB', { itemType: 'COIL' })).toBe('매');
    expect(qtyUnitOfLot('HEAT', { itemType: 'COIL' })).toBe('개');
  });
});
