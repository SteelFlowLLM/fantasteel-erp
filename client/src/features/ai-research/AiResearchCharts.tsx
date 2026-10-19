'use client';

// 보고서의 차트 (이슈 #384): 라인·막대를 SVG로 직접 그린다. 점의 숫자는 서버가 출처 글에서 확인한 것이고,
// 점마다 title에 출처 번호를 달고 누르면 출처 목록으로 간다. 제목·단위·라벨은 웹에서 온 글이라 React 글로만 쓴다.
import type { AiResearchChart, AiResearchRunView } from '@fantasteel/shared';
import { Card, CardBody, CardHead } from '@/components/Card';
import { chartXLabels, fmtChartValue, niceScale, pointTitle, scaleLinear } from '@/lib/aiResearchChart';

const COLORS = ['#2563eb', '#d97706', '#059669', '#9333ea'];
const W = 560;
const H = 260;
const PAD = { left: 56, right: 12, top: 12, bottom: 44 };

function jumpToSource(id: number) {
  const element = document.getElementById(`research-source-${id}`);
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element?.focus({ preventScroll: true });
}

function ChartSvg({ chart, sources }: { chart: AiResearchChart; sources: AiResearchRunView['sources'] }) {
  const labels = chartXLabels(chart);
  const values = chart.series.flatMap((s) => s.points.map((p) => p.y));
  const scale = niceScale(values, chart.type === 'bar');
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (value: number) => scaleLinear(value, scale.min, scale.max, PAD.top + innerH, PAD.top);
  const band = innerW / Math.max(1, labels.length);
  const cx = (label: string) => PAD.left + band * (labels.indexOf(label) + 0.5);
  const barW = Math.min(36, (band * 0.8) / chart.series.length);
  const step = Math.ceil(labels.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title} className="h-auto w-full max-w-[640px]">
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" className="text-line" />
          <text x={PAD.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="currentColor" className="text-ink-3">
            {fmtChartValue(tick)}
          </text>
        </g>
      ))}
      {labels.map((label, i) =>
        i % step === 0 ? (
          <text key={label} x={cx(label)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize="11" fill="currentColor" className="text-ink-3">
            {label.length > 10 ? `${label.slice(0, 10)}…` : label}
          </text>
        ) : null,
      )}
      <text x={PAD.left + innerW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="currentColor" className="text-ink-2">
        {chart.xLabel}
      </text>
      {chart.series.map((series, si) => {
        const color = COLORS[si % COLORS.length];
        const dots = series.points.map((point, pi) => {
          const title = pointTitle(series.name, point, chart.unit, sources);
          const px = chart.type === 'bar' ? cx(point.x) - (barW * chart.series.length) / 2 + barW * (si + 0.5) : cx(point.x);
          const common = { onClick: () => jumpToSource(point.sourceId), className: 'cursor-pointer' };
          return chart.type === 'bar' ? (
            <rect key={pi} x={px - barW / 2} y={Math.min(y(point.y), y(0))} width={barW} height={Math.max(1, Math.abs(y(point.y) - y(0)))} fill={color} {...common}>
              <title>{title}</title>
            </rect>
          ) : (
            <circle key={pi} cx={px} cy={y(point.y)} r={4} fill={color} {...common}>
              <title>{title}</title>
            </circle>
          );
        });
        const line =
          chart.type === 'line' ? (
            <polyline fill="none" stroke={color} strokeWidth={2} points={series.points.map((p) => `${cx(p.x)},${y(p.y)}`).join(' ')} />
          ) : null;
        return (
          <g key={si}>
            {line}
            {dots}
          </g>
        );
      })}
    </svg>
  );
}

function ChartCard({ chart, sources }: { chart: AiResearchChart; sources: AiResearchRunView['sources'] }) {
  const cited = [...new Set(chart.series.flatMap((s) => s.points.map((p) => p.sourceId)))].sort((a, b) => a - b);
  return (
    <Card className="flex-none">
      <CardHead title={chart.title} meta={chart.unit ? `단위: ${chart.unit}` : undefined} />
      <CardBody className="gap-2">
        <ChartSvg chart={chart} sources={sources} />
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-cap text-ink-2">
          {chart.series.map((series, i) => (
            <li key={i} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
              {series.name}
            </li>
          ))}
        </ul>
        <p className="text-cap text-ink-3">
          점에 마우스를 올리면 출처 번호가 보이고, 누르면 출처 목록으로 가요. 출처:{' '}
          {cited.map((id) => (
            <button key={id} type="button" aria-label={`출처 ${id}번으로 가기`} onClick={() => jumpToSource(id)} className="mr-1 font-semibold text-run hover:underline">
              [{id}]
            </button>
          ))}
        </p>
        <details>
          <summary className="cursor-pointer text-cap text-ink-2">값 표로 보기</summary>
          <table className="mt-1.5 w-full text-cap">
            <tbody>
              {chart.series.map((series, si) =>
                series.points.map((point, pi) => (
                  <tr key={`${si}:${pi}`} className="border-b border-line">
                    <td className="py-0.5 pr-2">{series.name}</td>
                    <td className="py-0.5 pr-2">{point.x}</td>
                    <td className="py-0.5 pr-2 tabular-nums">
                      {fmtChartValue(point.y)}
                      {chart.unit ? ` ${chart.unit}` : ''}
                    </td>
                    <td className="py-0.5">[{point.sourceId}]</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </details>
      </CardBody>
    </Card>
  );
}

export function AiResearchCharts({ run }: { run: AiResearchRunView }) {
  if (run.charts.length === 0) return null;
  return (
    <>
      {run.charts.map((chart, index) => (
        <ChartCard key={index} chart={chart} sources={run.sources} />
      ))}
    </>
  );
}
