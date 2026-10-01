// 공정별 수율 (REQ-DSH-001): 완료된 작업 실적의 실적 수율(산출 ÷ 투입) 막대 + 계획 수율 눈금.
// 제선은 계획 수율을 쓰지 않아(원료 → 용선은 원단위) 수율 대신 실적 수·산출량만 보인다.
import { PROCESS_TYPE_LABEL } from '@/codes';
import type { ProcessYieldData } from '@/api/dashboard';
import { LegendItem, WidgetBody, WidgetEmpty, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { useDashboardWidget, useDashboardWidgetAccess } from '@/hooks/useDashboardWidget';
import { fmtPct, fmtTon } from '@/lib/format';
import { cn } from '@/lib/cn';

const rate = (text: string | null): number | null => (text === null ? null : Number(text));

function YieldBody({ data }: { data: ProcessYieldData }) {
  if (data.processes.every((p) => p.resultCount === 0)) return <WidgetEmpty>완료된 작업 실적이 아직 없어요</WidgetEmpty>;
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      {data.processes.map((p) => {
        const actual = rate(p.actualYieldRate);
        const planned = rate(p.plannedYieldRate);
        const below = actual !== null && planned !== null && actual < planned;
        const label = PROCESS_TYPE_LABEL[p.processType];
        const sub =
          p.resultCount === 0
            ? `완료 실적 없음${planned !== null ? ` · 계획 수율 ${fmtPct(planned, 1)}` : ''}`
            : p.processType === 'IRONMAKING'
              ? `실적 ${p.resultCount}건 · 용선 ${fmtTon(p.outputTon)} · 계획 수율을 쓰지 않아요`
              : `실적 ${p.resultCount}건 · 투입 ${fmtTon(p.inputTon)} → 산출 ${fmtTon(p.outputTon)} · 계획 ${fmtPct(planned, 1)}${p.qtyAttainmentRate ? ` · 계획 대비 매수 ${fmtPct(rate(p.qtyAttainmentRate))}` : ''}`;
        return (
          <div key={p.processType} className="grid grid-cols-[48px_minmax(0,1fr)_max-content] items-center gap-x-2.5 gap-y-0.5 text-xs">
            <b className="font-semibold">{label}</b>
            <div className="relative" title={`실적 수율 ${fmtPct(actual, 1)} · 계획 수율 ${fmtPct(planned, 1)}`}>
              <div className="flex h-3.5 overflow-hidden rounded-xs bg-surface-3">
                {actual !== null ? <span className={below ? 'bg-[#c9731a]' : 'bg-ok'} style={{ width: `${Math.min(100, actual * 100)}%` }} /> : null}
              </div>
              {planned !== null ? <i className="absolute -top-[3px] -bottom-[3px] -ml-px w-0.5 rounded-[1px] bg-ink" style={{ left: `${Math.min(100, planned * 100)}%` }} /> : null}
            </div>
            <b className={cn('text-right font-semibold tabular-nums', below && 'text-wait')}>{fmtPct(actual, 1)}</b>
            <span className="col-start-2 col-end-4 truncate text-cap text-ink-3" title={sub}>
              {sub}
            </span>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-3">
        <LegendItem colorClass="bg-ok" label="실적 수율" />
        <LegendItem colorClass="bg-[#c9731a]" label="계획보다 낮음" />
        <LegendItem colorClass="bg-ink" label="계획 수율" />
      </div>
      <span className="text-cap text-ink-3">실적 수율 = 산출 ÷ 투입 (톤) · 연주는 슬래브 매수 내림·손실로 계획보다 낮을 수 있어요</span>
    </div>
  );
}

export function ProcessYieldWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('PROCESS_YIELD');
  const query = useDashboardWidget('PROCESS_YIELD', access.allowed);
  return (
    <WidgetFrame widgetKey="PROCESS_YIELD" {...props} meta="완료된 작업 실적 기준">
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <YieldBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}
