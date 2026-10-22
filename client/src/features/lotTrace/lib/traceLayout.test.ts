import { describe, expect, it } from 'vitest';
import type { TraceLotNode, TraceRelationEdge } from '@/api/lotTrace';
import { layoutTrace } from '@/features/lotTrace/lib/traceLayout';

const lot = (id: number, lotNo: string, lotType: TraceLotNode['lotType'], extra: Partial<TraceLotNode> = {}): TraceLotNode => ({
  id, lotNo, lotType, lotStatus: 'AVAILABLE', isStart: id === 1, depth: 0, itemCode: null, itemName: null, rawMaterialType: null, steelGradeCode: null,
  blastFurnaceCode: null, converterCode: null, initialTon: null, remainingTon: null, theoreticalWeightTon: null, producedDate: '2026-10-22', inspectionResult: null, ...extra,
});
const edge = (id: number, parentLotId: number, childLotId: number, lotRelationEvidence: TraceRelationEdge['lotRelationEvidence'], inputTon: string): TraceRelationEdge => ({
  id, parentLotId, childLotId, lotRelationEvidence, inputTon, periodStartedAt: '2026-10-22T00:00:00.000Z', periodEndedAt: '2026-10-22T04:00:00.000Z',
});

describe('정추적 선 라벨 (#531)', () => {
  it('원료 LOT 하나에서 용선으로 가면 기간 기반 표지에 그 원료 차감량, 용선→히트 표지는 용선 투입량임을 밝힌다', () => {
    const layout = layoutTrace({
      nodes: [lot(1, 'RM-ORE01-1', 'RAW_MATERIAL', { rawMaterialType: 'IRON_ORE' }), lot(2, 'HM-BF2-1', 'HOT_METAL'), lot(3, 'HT-BOF1-1', 'HEAT')],
      edges: [edge(10, 1, 2, 'PERIOD_BASED', '166.675'), edge(11, 2, 3, 'ACTUAL_INPUT', '277.778')],
      shipments: [],
    });
    expect(layout.periodLabels).toMatchObject([{ inputTon: '166.675' }]);
    expect(layout.edgeLabels).toMatchObject([{ inputKind: '용선', inputTon: '277.778' }]);
  });

  it('원료 LOT 여러 개가 한 용선으로 가면 기간 기반 표지에 양을 적지 않는다(하나로 말할 수 없음)', () => {
    const layout = layoutTrace({
      nodes: [lot(1, 'RM-ORE01-1', 'RAW_MATERIAL'), lot(4, 'RM-COL01-1', 'RAW_MATERIAL'), lot(2, 'HM-BF2-1', 'HOT_METAL')],
      edges: [edge(10, 1, 2, 'PERIOD_BASED', '166.675'), edge(12, 4, 2, 'PERIOD_BASED', '100.005')],
      shipments: [],
    });
    expect(layout.periodLabels.map((p) => p.inputTon)).toEqual([null]);
  });
});
