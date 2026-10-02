// 저장된 검사값 표 (읽기 전용): 항목 · 기준 · 측정값 · 판정 · 기준 안 위치. 불합격 항목은 붉게 강조한다.
import { Badge } from '@/components/Badge';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { ResultBadge } from '@/features/quality/components/QualityBadges';
import { MiniGauge } from '@/features/quality/components/LimitGauge';
import { limitText, thicknessBandText, trimNum } from '@/features/quality/lib/qualityDisplay';
import type { InspectionFormItem } from '@/mock/services';

export function InspectionValuesTable({ items }: { items: readonly InspectionFormItem[] }) {
  if (items.length === 0) return <EmptyNote>검사값이 없어요</EmptyNote>;
  return (
    <div className="overflow-auto">
      <Table>
        <thead>
          <tr>
            <Th>항목</Th>
            <Th>기준</Th>
            <Th align="right">측정값</Th>
            <Th>판정</Th>
            <Th>기준 안 위치</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const bad = item.isPassed === false;
            const band = thicknessBandText(item.minThicknessMm, item.maxThicknessMm);
            return (
              <tr key={item.inspectionStandardItemId} data-risk={bad || undefined}>
                <Td className={bad ? 'font-semibold' : undefined}>
                  {item.inspectionItemName}
                  {item.isRequired ? null : <span className="ml-1.5 text-cap text-ink-3">선택</span>}
                </Td>
                <Td className="tabular-nums">
                  {limitText(item)}
                  {band ? <span className="ml-1.5 text-cap text-ink-3">{band}</span> : null}
                </Td>
                <Td align="right" className={bad ? 'font-semibold text-danger' : undefined}>
                  {item.measuredValue === null ? '—' : `${trimNum(item.measuredValue)}${item.unit ? ` ${item.unit}` : ''}`}
                </Td>
                <Td>{item.isPassed === null ? <Badge>미입력</Badge> : <ResultBadge result={item.isPassed ? 'PASS' : 'FAIL'} />}</Td>
                <Td>
                  <MiniGauge item={item} value={item.measuredValue} bad={bad} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
