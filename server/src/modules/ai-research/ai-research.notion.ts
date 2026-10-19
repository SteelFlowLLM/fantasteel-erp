import type { AiResearchChart, AiResearchRunView } from '@fantasteel/shared';
import { escapeNotionText } from '../meeting-minutes/meeting-notion.markdown';
import { urlKey } from '../ai-assistant/web/web-text';

const TITLE_MAX = 200;

const oneLine = (text: string): string => text.replace(/\s*\r?\n\s*/g, ' ').trim();
/** 한 줄 글 그대로 (태그·링크 글자를 막는다, 회의록 내보내기와 같은 이스케이프) */
const inline = (text: string): string => escapeNotionText(oneLine(text));

const HEADING = /^(#{1,6})[ \t]+(.*)$/;
const BULLET = /^[-*+][ \t]+(.*)$/;
const ORDERED = /^(\d{1,3})[.)][ \t]+(.*)$/;
const QUOTE = /^>[ \t]?(.*)$/;
/** 서버가 붙인 출처 목록 제목 (Notion에는 다시 만들어 넣는다) */
const SOURCE_HEADING = /^##[ \t]*출처[ \t]*$/m;

/** 내보낼 페이지 제목: 계획 제목, 없으면 질문 */
export function researchNotionTitle(view: AiResearchRunView): string {
  const title = oneLine(view.title ?? '') || oneLine(view.question) || `심층 조사 #${view.id}`;
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

/**
 * 보고서 마크다운 → Notion 마크다운. 보고서는 웹 내용을 보고 모델이 쓴 글이라 제목(###까지)·목록·번호 목록·인용만 살리고
 * 줄 안의 태그·링크 글자(`<page>`·`<mention-user>`·`[..](..)`)는 회의록 내보내기와 같이 막는다. 표·코드 같은 다른 블록 표시는 글로 보인다.
 */
export function reportToNotion(report: string): string {
  const cut = report.search(SOURCE_HEADING);
  const body = cut >= 0 ? report.slice(0, cut) : report;
  return body
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return '';
      const heading = HEADING.exec(line);
      if (heading) return `${'#'.repeat(Math.min(heading[1].length, 3))} ${inline(heading[2])}`;
      const bullet = BULLET.exec(line);
      if (bullet) return `- ${inline(bullet[1])}`;
      const ordered = ORDERED.exec(line);
      if (ordered) return `${ordered[1]}. ${inline(ordered[2])}`;
      const quote = QUOTE.exec(line);
      if (quote) return `> ${inline(quote[1])}`;
      return inline(line);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 표 칸 글. 태그 글자를 막고, 표를 깨는 줄바꿈을 지운다 */
const cell = (text: string): string => inline(text) || ' ';

/** 차트 → Notion 표 (Notion 마크다운의 <table>, 가로축 한 줄에 계열마다 한 칸). 숫자 뒤에 출처 번호 */
export function chartToNotionTable(chart: AiResearchChart): string {
  const xs: string[] = [];
  for (const s of chart.series) for (const p of s.points) if (!xs.includes(p.x)) xs.push(p.x);
  const header = [chart.xLabel || '항목', ...chart.series.map((s) => (chart.unit ? `${s.name} (${chart.unit})` : s.name))];
  const rows = xs.map((x) => [
    x,
    ...chart.series.map((s) => {
      const point = s.points.find((p) => p.x === x);
      return point ? `${point.y.toLocaleString('ko-KR')} [${point.sourceId}]` : '';
    }),
  ]);
  const tr = (cells: string[]) => `<tr>${cells.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`;
  return [`### ${inline(chart.title)}`, '<table header-row="true">', tr(header), ...rows.map(tr), '</table>'].join('\n');
}

/** 출처 제목은 웹에서 온 글이라 링크 문법이 되는 글자를 뺀다 */
const linkLabel = (title: string): string => oneLine(title).replace(/[[\]()<>`*_\\|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || '출처';
const linkUrl = (url: string): string => url.replace(/[()\s<>]/g, (c) => encodeURIComponent(c).replace('(', '%28').replace(')', '%29'));

/**
 * 완료한 조사를 Notion 마크다운으로: 보고서(줄 안 태그·링크 막음) → 차트 표 → 출처 목록(http·https만, 서버가 모은 주소만 링크) → 내보낸 곳.
 * 제목은 페이지 속성으로 따로 넣으므로 본문에 쓰지 않는다.
 */
export function buildResearchNotionMarkdown(view: AiResearchRunView): string {
  const lines: string[] = [`**질문** ${inline(view.question)}`, '', reportToNotion(view.report ?? '') || '보고서가 없어요.'];
  if (view.charts.length) lines.push('', '## 차트', ...view.charts.flatMap((c) => ['', chartToNotionTable(c)]));
  const sources = view.sources.filter((s) => urlKey(s.url) !== null);
  if (sources.length) lines.push('', '## 출처', ...sources.map((s) => `- \\[${s.id}\\] [${linkLabel(s.title)}](${linkUrl(s.url)})`));
  lines.push('', '---', `FantaSteel ERP 심층 조사 #${view.id}에서 내보냈어요.`);
  return lines.join('\n');
}
