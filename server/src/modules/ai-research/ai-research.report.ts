import { cutText, filterAnswerLinks, stripInvisible, urlKey } from '../ai-assistant/web/web-text';
import type { StoredAudit, StoredSource, StoredState } from './ai-research.rules';

export const REPORT_TRUNCATED_NOTICE = '> **보고서가 길이 한도에 걸려 끝까지 쓰지 못했어요.** 아래 내용은 중간에서 끊겼을 수 있어요.';
const SOURCE_HEADING = '## 출처';

/** [1] · [1, 3] · [1,3] (뒤에 `(`·`:`가 오는 링크·참조 정의는 뺀다) */
const CITATION = /\[(\d{1,3}(?:\s*[,，]\s*\d{1,3})*)\](?![(:])/g;
/** 모델이 스스로 쓴 출처 목록의 제목 (서버가 다시 만든다). 마지막 제목일 때만 뗀다 */
const SOURCE_HEADING_TEXT = /^#{1,6}[ \t]*(?:출처|참고[ \t]*(?:문헌|자료)?|참조|sources?|references?)[ \t]*:?[ \t]*$/i;
const HEADING_LINE = /^#{1,6}[ \t].*$|^#{1,6}$/gm;

export interface FinalizedReport {
  report: string;
  citedIds: number[];
}

/**
 * 보고서 다듬기: 모델이 쓴 출처 목록을 떼고 → 모은 출처에 없는 링크·사진·HTML을 지우고(웹 검색 답과 같은 거르기)
 * → 모르는 출처 번호 [n]을 지우고 → 서버가 만든 출처 목록(http·https만)을 붙인다. 길이 한도에 걸렸으면 맨 위에 알린다.
 * 출처 목록은 인용한 출처만, 하나도 인용하지 않았으면 모은 출처 모두.
 */
export function finalizeReport(raw: string, sources: readonly StoredSource[], truncated: boolean, incompleteReason: string | null = null): FinalizedReport {
  const byId = new Map(sources.filter((s) => isHttpUrl(s.url)).map((s) => [s.id, s]));
  const allowed = new Set([...byId.values()].map((s) => urlKey(s.url)).filter((k): k is string => k !== null));
  const body = withoutModelSourceSection(raw).trim();
  const { answer } = filterAnswerLinks(body, allowed);
  const cited: number[] = [];
  const withCitations = answer
    .replace(CITATION, (_whole, list: string) => {
      const ids = [...new Set(list.split(/[,，]/).map((n) => Number(n.trim())))].filter((id) => byId.has(id));
      for (const id of ids) if (!cited.includes(id)) cited.push(id);
      return ids.map((id) => `[${id}]`).join('');
    })
    .replace(/[ \t]+([.,。])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const listed = cited.length ? [...cited].sort((a, b) => a - b).map((id) => byId.get(id)).filter((s): s is StoredSource => s !== undefined) : [...byId.values()];
  const parts = [incompleteReason ? incompleteNotice(incompleteReason) : null, truncated ? REPORT_TRUNCATED_NOTICE : null, withCitations, listed.length ? sourceList(listed) : null].filter((p): p is string => Boolean(p));
  return { report: parts.join('\n\n'), citedIds: cited };
}

/** 다 마치지 못했거나 대신 쓴 보고서의 알림 (맨 위). 이유는 서버가 정한 글이다 */
export function incompleteNotice(reason: string): string {
  return `> **이 보고서는 완전하지 않아요.** ${reason.replace(/\s+/g, ' ')} 그때까지 모은 출처로 정리했어요.`;
}

/** 마지막 제목이 출처·참고 목록이면 그 제목부터 끝까지 뗀다 (가운데의 '## 참고' 절은 남긴다) */
function withoutModelSourceSection(text: string): string {
  const headings = [...text.matchAll(HEADING_LINE)];
  const last = headings.at(-1);
  if (!last || last.index === undefined || !SOURCE_HEADING_TEXT.test(last[0].trim())) return text;
  return text.slice(0, last.index);
}

/** 보고서 LLM이 빈 답을 냈을 때: 점검 결과로 만든 짧은 보고서 */
export function fallbackReportBody(question: string, audit: StoredAudit, state: StoredState): string {
  const lines = [`# ${cutText(question.replace(/\s+/g, ' '), 100)}`, '', audit.thesis || state.summary || '확인한 내용이 없어요.'];
  if (audit.supportedClaims.length) lines.push('', '## 확인한 내용', ...audit.supportedClaims.map((c) => `- ${c.claim} ${c.sourceIds.map((id) => `[${id}]`).join('')}`));
  const missing = audit.missingDimensions.length ? audit.missingDimensions : state.gaps;
  if (missing.length) lines.push('', '## 확인하지 못한 것', ...missing.map((m) => `- ${m}`));
  return lines.join('\n');
}

function sourceList(sources: readonly StoredSource[]): string {
  return [SOURCE_HEADING, ...sources.map((s) => `- [${s.id}] [${markdownLabel(s.title || hostLabel(s.url))}](${markdownUrl(s.url)})`)].join('\n');
}

/** 제목은 웹에서 온 글이라 마크다운 문법이 되는 글자를 뺀다 */
function markdownLabel(title: string): string {
  return cutText(stripInvisible(title).replace(/[[\]()<>`*_\\|]/g, ' ').replace(/\s+/g, ' ').trim(), 120) || '출처';
}

function markdownUrl(url: string): string {
  return url.replace(/[()\s<>]/g, (c) => encodeURIComponent(c).replace('(', '%28').replace(')', '%29'));
}

function isHttpUrl(url: string): boolean {
  return urlKey(url) !== null;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '출처';
  }
}
