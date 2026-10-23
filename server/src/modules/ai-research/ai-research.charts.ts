import { AI_RESEARCH_LIMITS, type AiResearchChart, type AiResearchChartSeries } from '@fantasteel/shared';
import { cutText, stripInvisible } from '../ai-assistant/web/web-text';
import { isRecord, type StoredSource } from './ai-research.rules';

/** 숫자 뒤의 단위 → 배수. 긴 것부터 맞춰 본다 */
const UNIT_SCALE: readonly [string, number][] = [
  ['천만', 1e7],
  ['백만', 1e6],
  ['조', 1e12],
  ['억', 1e8],
  ['만', 1e4],
  ['천', 1e3],
];
/** 1,234 · 1234 · 1,234.5 · 0.75 (앞뒤가 다른 숫자에 붙어 있으면 그 숫자의 일부다) */
const NUMBER = /(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\d])\s*(천만|백만|조|억|만|천)?/g;
const SCAN_MAX = 60_000;

/**
 * 출처 글에 적힌 숫자들. 쉼표를 빼고, 단위(만·억 등)가 붙었으면 그 배수를 곱한 값도 넣는다(1.2만 → 1.2와 12000).
 * %는 숫자만 본다(56.7% → 56.7).
 */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.slice(0, SCAN_MAX).matchAll(NUMBER)) {
    const value = Number(`${m[1].replace(/,/g, '')}${m[2] ?? ''}`);
    if (!Number.isFinite(value)) continue;
    out.push(value);
    const scale = UNIT_SCALE.find(([unit]) => unit === m[3])?.[1];
    if (scale) out.push(value * scale);
  }
  return out;
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** y가 그 출처 글(제목·요약·읽은 본문)에 있는 숫자인지. 부호는 보지 않는다("3.5% 감소" → -3.5도 허용) */
export function numberAppearsIn(y: number, numbers: readonly number[]): boolean {
  const target = Math.abs(y);
  return numbers.some((n) => same(n, target));
}

const label = (value: unknown, max: number): string => (typeof value === 'string' ? cutText(stripInvisible(value).replace(/\s+/g, ' ').trim(), max) : '');

export interface CheckedCharts {
  charts: AiResearchChart[];
  /** 출처 글에서 찾지 못했거나 모양이 틀려 뺀 점 수 */
  droppedPoints: number;
}

/**
 * 모델이 제안한 차트 확인: 점마다 sourceId가 모은 출처이고 y가 그 출처 글에 실제로 있는 숫자일 때만 남긴다.
 * 점이 없는 계열은 빼고, 남은 점이 2개 미만인 차트는 버린다. 차트 2개·계열 4개·점 24개까지.
 */
export function checkCharts(value: unknown, sources: readonly StoredSource[]): CheckedCharts {
  const raw = isRecord(value) && Array.isArray(value.charts) ? value.charts : [];
  const numbers = new Map<number, number[]>();
  const numbersOf = (id: number): number[] | null => {
    const source = sources.find((s) => s.id === id);
    if (!source) return null;
    let found = numbers.get(id);
    if (!found) {
      found = numbersIn([source.title, source.snippet, source.readText ?? ''].join('\n'));
      numbers.set(id, found);
    }
    return found;
  };
  const charts: AiResearchChart[] = [];
  let droppedPoints = 0;
  for (const item of raw) {
    if (charts.length >= AI_RESEARCH_LIMITS.maxCharts) break;
    if (!isRecord(item) || !Array.isArray(item.series)) continue;
    const series: AiResearchChartSeries[] = [];
    for (const s of item.series.slice(0, AI_RESEARCH_LIMITS.maxChartSeries)) {
      if (!isRecord(s) || !Array.isArray(s.points)) continue;
      const points: AiResearchChartSeries['points'] = [];
      for (const p of s.points.slice(0, AI_RESEARCH_LIMITS.maxChartPoints)) {
        const sourceId = isRecord(p) && typeof p.sourceId === 'number' && Number.isInteger(p.sourceId) ? p.sourceId : null;
        const y = isRecord(p) && typeof p.y === 'number' && Number.isFinite(p.y) ? p.y : null;
        const x = isRecord(p) ? label(typeof p.x === 'number' ? String(p.x) : p.x, 40) : '';
        const known = sourceId === null ? null : numbersOf(sourceId);
        if (sourceId === null || y === null || !x || !known || !numberAppearsIn(y, known)) {
          droppedPoints += 1;
          continue;
        }
        points.push({ x, y, sourceId });
      }
      if (points.length) series.push({ name: label(s.name, 60) || '값', points });
    }
    if (series.reduce((n, s) => n + s.points.length, 0) < 2) continue;
    charts.push({
      title: label(item.title, 100) || '차트',
      type: item.type === 'bar' ? 'bar' : 'line',
      unit: label(item.unit, 20),
      xLabel: label(item.xLabel, 40),
      series,
    });
  }
  return { charts, droppedPoints };
}

/** DB의 charts jsonb (서버가 확인해 저장한 값이라 모양만 본다) */
export function storedCharts(value: unknown): AiResearchChart[] {
  if (!Array.isArray(value)) return [];
  return value.filter((c): c is AiResearchChart => isRecord(c) && typeof c.title === 'string' && Array.isArray(c.series) && (c.type === 'line' || c.type === 'bar'));
}
