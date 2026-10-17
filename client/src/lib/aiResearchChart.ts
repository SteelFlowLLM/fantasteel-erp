// 심층 조사 차트와 조사 범위의 순수 도우미 (이슈 #384). 차트는 SVG를 직접 그리므로 눈금·좌표 계산만 여기서 한다.
import { AI_RESEARCH_LIMITS, type AiResearchBudget, type AiResearchChart, type AiResearchSourceView } from '@fantasteel/shared';
import { webSourceTitle } from '@/lib/aiWebLinks';

// ── 조사 범위 ──

export type ResearchScope = 'default' | 'wide' | 'max';

export const RESEARCH_SCOPE_OPTIONS: readonly { value: ResearchScope; label: string }[] = [
  { value: 'default', label: '기본' },
  { value: 'wide', label: '넓게' },
  { value: 'max', label: '최대' },
];

/** 조사 범위 → 서버에 보낼 예산. 기본은 보내지 않는다(서버 기본값). 서버가 상한으로 자른다 */
export function budgetOfScope(scope: ResearchScope): Partial<AiResearchBudget> | undefined {
  if (scope === 'wide') return { maxSteps: Math.min(16, AI_RESEARCH_LIMITS.maxStepsCap), maxSources: Math.min(60, AI_RESEARCH_LIMITS.maxSourcesCap) };
  if (scope === 'max') return { maxSteps: Math.min(30, AI_RESEARCH_LIMITS.maxStepsCap), maxSources: Math.min(100, AI_RESEARCH_LIMITS.maxSourcesCap) };
  return undefined;
}

// ── 차트 ──

export interface ChartScale {
  min: number;
  max: number;
  ticks: number[];
}

/** 눈금 간격을 1·2·5 × 10^n 으로 맞춘다. 막대는 0부터 시작한다 */
export function niceScale(values: readonly number[], includeZero: boolean, targetTicks = 5): ChartScale {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const rough = (hi - lo) / Math.max(1, targetTicks - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 1e6; value += step) ticks.push(Number(value.toPrecision(12)));
  return { min: Number(min.toPrecision(12)), max: Number(max.toPrecision(12)), ticks };
}

/** 값을 [from, to] 구간 좌표로. 위로 갈수록 값이 커지게 하려면 from > to 로 부른다 */
export function scaleLinear(value: number, min: number, max: number, from: number, to: number): number {
  if (max === min) return (from + to) / 2;
  return from + ((value - min) / (max - min)) * (to - from);
}

/** x 라벨 목록: 계열마다 다른 라벨을 처음 나온 순서로 합친다 */
export function chartXLabels(chart: AiResearchChart): string[] {
  const labels: string[] = [];
  for (const series of chart.series) for (const point of series.points) if (!labels.includes(point.x)) labels.push(point.x);
  return labels;
}

/** 숫자 표시: 천 단위 쉼표, 소수는 3자리까지 */
export function fmtChartValue(value: number): string {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
}

/** 점의 툴팁: "계열 · x: 값 단위 · 출처 [n] 제목". 출처 제목은 웹에서 온 글이라 글로만 쓴다 */
export function pointTitle(
  seriesName: string,
  point: { x: string; y: number; sourceId: number },
  unit: string,
  sources: readonly Pick<AiResearchSourceView, 'id' | 'title' | 'url'>[],
): string {
  const source = sources.find((item) => item.id === point.sourceId);
  const from = source ? `출처 [${source.id}] ${webSourceTitle(source.title, source.url)}` : `출처 [${point.sourceId}]`;
  return `${seriesName} · ${point.x}: ${fmtChartValue(point.y)}${unit ? ` ${unit}` : ''} · ${from}`;
}

// ── 보고서로 묻기 칩 ──

export interface ResearchChipRef {
  id: number;
  title: string;
}

const CHIP_TITLE_MAX = 24;

export function researchChipLabel(ref: ResearchChipRef): string {
  const title = ref.title.trim();
  return `보고서: ${title.length > CHIP_TITLE_MAX ? `${title.slice(0, CHIP_TITLE_MAX)}…` : title}`;
}

/** 질문에 붙일 필드. 칩이 없으면 보내지 않는다 */
export function researchIdField(ref: ResearchChipRef | null): { researchRunId: number } | Record<string, never> {
  return ref ? { researchRunId: ref.id } : {};
}
