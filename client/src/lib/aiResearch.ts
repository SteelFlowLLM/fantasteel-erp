// 철강맨AI 심층 조사 화면의 순수 도우미 (이슈 #378): 진행 타임라인, 보고서 인용 연결, 계획 고치기 확인, 폴링 조건.
// 출처 제목·요약·보고서는 웹에서 온 글이다. 여기서는 글 조각으로만 나누고 HTML로 바꾸지 않는다.
import {
  AI_RESEARCH_LIMITS,
  type AiResearchEventView,
  type AiResearchPlan,
  type AiResearchPlanStep,
  type AiResearchReportVersionSummary,
  type AiResearchRunView,
  type AiResearchSourceView,
  type AiResearchStatus,
} from '@fantasteel/shared';
import { safeWebHref, tokenizeAnswerLinks, webHostOf, webSourceTitle } from '@/lib/aiWebLinks';

// ── 폴링 ──

/** 서버가 계속 바꾸는 상태 (계획 중·대기·조사 중). 계획 확인 대기와 끝난 상태는 사용자가 움직여야 바뀐다 */
export function isRunActive(status: AiResearchStatus): boolean {
  return status === 'PLANNING' || status === 'QUEUED' || status === 'RUNNING';
}

/** 화면이 계속 다시 읽어야 하는지. 끝났거나 사용자의 확인을 기다리면 멈춘다 */
export function shouldPollRun(status: AiResearchStatus | undefined): boolean {
  return status !== undefined && isRunActive(status);
}

/** 조사를 취소할 수 있는지 (끝나지 않은 조사) */
export function canCancelRun(status: AiResearchStatus): boolean {
  return status !== 'COMPLETED' && status !== 'FAILED' && status !== 'CANCELLED';
}

/** 다시 조사(질문·계획을 복사한 새 조사)를 만들 수 있는지: 끝난(완료·실패·취소) 조사 */
export function canRerunRun(status: AiResearchStatus): boolean {
  return !canCancelRun(status);
}

/** 머리의 제목 바꾸기를 보일지: 계획이 있고, 계획 확인 대기가 아닐 때 (그때는 계획 고치기 칸에서 제목을 고친다) */
export function canRenameRun(run: Pick<AiResearchRunView, 'status' | 'plan'>): boolean {
  return run.plan !== null && run.status !== 'PLANNING' && run.status !== 'AWAITING_APPROVAL';
}

export const RUN_POLL_MS = 2500;

/** 서버가 한 번에 주는 이벤트 수. 이만큼 받았으면 더 있을 수 있어 afterSeq를 마지막 받은 순번으로 잇는다 */
export function nextAfterSeq(events: readonly AiResearchEventView[]): number {
  return events.reduce((max, event) => Math.max(max, event.seq), 0);
}

/** 앞서 받은 조사에 새로 받은 것을 이어 붙인다: 이벤트는 순번 기준으로 겹치지 않게 쌓고, 나머지는 새 값을 쓴다 */
export function mergeRunView(previous: AiResearchRunView | undefined, next: AiResearchRunView): AiResearchRunView {
  if (!previous || previous.id !== next.id) return next;
  const known = new Set(previous.events.map((event) => event.seq));
  const added = next.events.filter((event) => !known.has(event.seq));
  return { ...next, events: [...previous.events, ...added].sort((a, b) => a.seq - b.seq) };
}

// ── 타임라인 ──

export type TimelineLineTone = 'neutral' | 'ok' | 'run' | 'danger' | 'wait' | 'ai';

export interface TimelineLine {
  key: number;
  tone: TimelineLineTone;
  title: string;
  /** 웹에서 온 글이 들어 있을 수 있다 (글로만 그린다) */
  detail?: string;
  at: string;
}

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** 이벤트 하나를 타임라인 한 줄로. 웹에서 온 제목은 webSourceTitle로 정리해 글로만 쓴다 */
export function timelineLineOf(event: AiResearchEventView): TimelineLine {
  const base = { key: event.seq, at: event.createdAt };
  switch (event.type) {
    case 'plan.ready': {
      const p = event.payload;
      const title = p.copiedFrom ? `조사 #${p.copiedFrom}의 계획을 가져왔어요 · ${p.stepCount}단계` : p.fallback ? '질문 그대로 한 단계로 계획을 세웠어요' : `계획을 세웠어요 · ${p.stepCount}단계`;
      return { ...base, tone: 'ai', title, detail: cut(webSourceTitle(p.title, ''), 100) };
    }
    case 'step.started': {
      const p = event.payload;
      const what = p.action === 'search' ? `검색 “${cut(p.query ?? '', 80)}”` : `출처 [${p.sourceId ?? '?'}] 읽기`;
      return { ...base, tone: 'run', title: `${p.step}단계 · ${what}`, detail: p.fallback ? '모델이 고른 행동을 쓸 수 없어 계획의 다음 검색어로 바꿨어요' : undefined };
    }
    case 'search.done': {
      const p = event.payload;
      if (p.error) return { ...base, tone: 'wait', title: `검색 “${cut(p.query, 80)}” 실패`, detail: cut(p.error, 200) };
      return { ...base, tone: 'neutral', title: `검색 “${cut(p.query, 80)}” · 결과 ${p.resultCount}개`, detail: `새 출처 ${p.added}개${p.engine ? ` · ${p.engine}` : ''}` };
    }
    case 'source.added': {
      const p = event.payload;
      const host = webHostOf(p.url);
      return { ...base, tone: 'neutral', title: `출처 [${p.sourceId}] ${webSourceTitle(p.title, p.url)}`, detail: host ?? undefined };
    }
    case 'page.read': {
      const p = event.payload;
      if (p.error) return { ...base, tone: 'wait', title: `출처 [${p.sourceId}] 읽지 못했어요`, detail: cut(p.error, 200) };
      return { ...base, tone: 'neutral', title: `출처 [${p.sourceId}] 읽었어요`, detail: `${p.chars.toLocaleString('ko-KR')}자` };
    }
    case 'state.updated': {
      const p = event.payload;
      const counts = [p.gapCount > 0 ? `아직 모르는 것 ${p.gapCount}개` : '', p.unsupportedCount > 0 ? `근거 없는 주장 ${p.unsupportedCount}개` : ''].filter(Boolean).join(' · ');
      return { ...base, tone: 'ai', title: '조사 메모를 고쳤어요', detail: [cut(p.summary, 300), counts].filter(Boolean).join('\n') || undefined };
    }
    case 'charts.ready': {
      const p = event.payload;
      return { ...base, tone: 'ai', title: p.count > 0 ? `차트를 ${p.count}개 만들었어요` : '출처의 숫자로 만들 차트가 없어요', detail: p.droppedPoints > 0 ? `출처 글에서 찾지 못한 숫자 ${p.droppedPoints}개는 뺐어요` : undefined };
    }
    case 'budget.exhausted': {
      const p = event.payload;
      return { ...base, tone: 'wait', title: `정해 둔 ${p.maxSteps}단계를 다 썼어요`, detail: p.gapCount > 0 ? `아직 모르는 것 ${p.gapCount}개가 남았어요` : undefined };
    }
    case 'audit.ready': {
      const p = event.payload;
      if (!p.ok) return { ...base, tone: 'wait', title: '점검을 읽지 못해 조사 메모로 대신했어요' };
      return { ...base, tone: 'ai', title: '보고서 쓰기 전 점검을 마쳤어요', detail: `뒷받침된 주장 ${p.claimCount}개 · 엇갈리는 내용 ${p.contradictionCount}개 · 빠진 관점 ${p.missingCount}개` };
    }
    case 'report.ready': {
      const p = event.payload;
      return { ...base, tone: 'ok', title: '보고서를 썼어요', detail: `${p.chars.toLocaleString('ko-KR')}자 · 인용한 출처 ${p.citedCount}개${p.truncated ? ' · 길이 한도에 걸려 끝까지 쓰지 못했어요' : ''}` };
    }
    case 'failed':
      return { ...base, tone: 'danger', title: '조사에 실패했어요', detail: cut(event.payload.reason, 300) };
    case 'cancelled':
      return { ...base, tone: 'neutral', title: '조사를 취소했어요' };
    case 'revision.requested': {
      const p = event.payload;
      const how = !p.search ? '검색 없이 모은 출처로 다시 써요' : p.addedSteps > 0 ? `필요하면 ${p.addedSteps}단계까지 더 찾아요` : '단계를 다 써서 모은 출처로 다시 써요';
      return { ...base, tone: 'ai', title: `보고서 고치기 요청 · ${p.version}판`, detail: `${cut(p.instruction, 200)}\n${how}` };
    }
    case 'revision.ready': {
      const p = event.payload;
      return { ...base, tone: 'ok', title: `${p.version}판 보고서를 썼어요`, detail: `${p.chars.toLocaleString('ko-KR')}자` };
    }
  }
}

export function timelineLines(events: readonly AiResearchEventView[]): TimelineLine[] {
  return events.map(timelineLineOf);
}

// ── 보고서 ──

export type ReportInline = { kind: 'text'; text: string } | { kind: 'cite'; id: number } | { kind: 'link'; text: string; href: string };

export type ReportBlock =
  | { kind: 'heading'; level: number; inline: ReportInline[] }
  | { kind: 'paragraph'; inline: ReportInline[] }
  | { kind: 'list'; items: ReportInline[][] };

/** `[1]`, `[1, 3]` 같은 인용. 번호가 출처에 있을 때만 연결한다 */
const CITE = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

/** 글 한 줄을 글·인용·링크 조각으로. 링크는 모은 출처의 주소일 때만 만든다 (aiWebLinks) */
export function inlineOf(text: string, sources: readonly Pick<AiResearchSourceView, 'id' | 'title' | 'url'>[]): ReportInline[] {
  const ids = new Set(sources.map((source) => source.id));
  const plain = text.replace(/\*\*|__|`/g, '');
  const result: ReportInline[] = [];
  for (const token of tokenizeAnswerLinks(plain, sources)) {
    if (token.kind === 'link') {
      result.push({ kind: 'link', text: token.text, href: token.href });
      continue;
    }
    let last = 0;
    for (const match of token.text.matchAll(CITE)) {
      const numbers = match[1].split(',').map((n) => Number(n.trim()));
      if (!numbers.every((n) => ids.has(n))) continue;
      if (match.index > last) result.push({ kind: 'text', text: token.text.slice(last, match.index) });
      numbers.forEach((n, i) => {
        if (i > 0) result.push({ kind: 'text', text: ' ' });
        result.push({ kind: 'cite', id: n });
      });
      last = match.index + match[0].length;
    }
    if (last < token.text.length) result.push({ kind: 'text', text: token.text.slice(last) });
  }
  return result;
}

/** 서버가 보고서 끝에 붙인 `## 출처` 목록을 뗀다 (화면은 sources로 출처 목록을 따로 그린다) */
export function stripSourceSection(report: string): string {
  const lines = report.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^#{1,6}\s*(출처|참고\s*문헌|references?)\s*$/i.test(lines[i].trim())) return lines.slice(0, i).join('\n').trimEnd();
  }
  return report.trimEnd();
}

/** 마크다운 보고서를 제목·문단·목록으로만 나눈다. 표·코드·HTML은 줄 그대로 글이다 */
export function reportBlocks(report: string, sources: readonly Pick<AiResearchSourceView, 'id' | 'title' | 'url'>[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', inline: inlineOf(paragraph.join('\n'), sources) });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: 'list', items: list.map((item) => inlineOf(item, sources)) });
    list = [];
  };
  for (const raw of stripSourceSection(report).split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^(?:[-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (!line || /^[-*_]{3,}$/.test(line)) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', level: Math.min(heading[1].length, 4), inline: inlineOf(heading[2], sources) });
    } else if (item) {
      flushParagraph();
      list.push(item[1]);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

export interface SourceRow {
  id: number;
  title: string;
  host: string | null;
  /** http·https만. 아니면 null(글로만 보인다) */
  href: string | null;
  read: boolean;
}

export function sourceRows(sources: readonly AiResearchSourceView[]): SourceRow[] {
  return [...sources].sort((a, b) => a.id - b.id).map((source) => ({ id: source.id, title: webSourceTitle(source.title, source.url), host: webHostOf(source.url), href: safeWebHref(source.url), read: source.read }));
}

// ── 계획 고치기 ──

export interface PlanProblems {
  title: string | null;
  /** 단계 순서대로 칸별 오류 */
  steps: { title: string | null; query: string | null }[];
  /** 단계 수 같은 전체 오류 */
  general: string | null;
}

const normalizedQuery = (query: string): string => query.trim().replace(/\s+/g, ' ').toLowerCase();

/** 계획 제목 확인 (계획 고치기·제목 바꾸기). 문제가 없으면 null */
export function planTitleProblem(value: string): string | null {
  const title = value.trim();
  if (!title) return '제목을 적어 주세요';
  if (title.length > AI_RESEARCH_LIMITS.planTitleMax) return `제목은 ${AI_RESEARCH_LIMITS.planTitleMax}자까지 쓸 수 있어요`;
  return null;
}

/** 계획을 서버 한도에 맞게 확인한다. 문제가 없으면 null */
export function validatePlan(plan: AiResearchPlan): PlanProblems | null {
  const L = AI_RESEARCH_LIMITS;
  const problems: PlanProblems = { title: planTitleProblem(plan.title), steps: [], general: null };
  if (plan.steps.length < 1) problems.general = '단계를 하나 이상 넣어 주세요';
  else if (plan.steps.length > L.maxPlanSteps) problems.general = `단계는 ${L.maxPlanSteps}개까지 넣을 수 있어요`;
  const seen = new Set<string>();
  for (const step of plan.steps) {
    const stepTitle = step.title.trim();
    const query = step.query.trim();
    const key = normalizedQuery(query);
    let titleProblem: string | null = null;
    let queryProblem: string | null = null;
    if (!stepTitle) titleProblem = '단계 이름을 적어 주세요';
    else if (stepTitle.length > L.stepTitleMax) titleProblem = `단계 이름은 ${L.stepTitleMax}자까지 쓸 수 있어요`;
    if (!query) queryProblem = '검색어를 적어 주세요';
    else if (query.length > L.queryMax) queryProblem = `검색어는 ${L.queryMax}자까지 쓸 수 있어요`;
    else if (seen.has(key)) queryProblem = '같은 검색어가 또 있어요';
    if (query) seen.add(key);
    problems.steps.push({ title: titleProblem, query: queryProblem });
  }
  const bad = problems.title !== null || problems.general !== null || problems.steps.some((s) => s.title !== null || s.query !== null);
  return bad ? problems : null;
}

/** 시작·저장 버튼이 꺼진 까닭 한 줄: 맨 앞 문제를 칸 이름과 함께, 더 있으면 남은 곳 수. 문제가 없으면 null */
export function planBlockReason(problems: PlanProblems | null): string | null {
  if (!problems) return null;
  const all: string[] = [];
  if (problems.title) all.push(problems.title);
  if (problems.general) all.push(problems.general);
  problems.steps.forEach((step, index) => {
    if (step.title) all.push(`${index + 1}단계: ${step.title}`);
    if (step.query) all.push(`${index + 1}단계: ${step.query}`);
  });
  if (all.length === 0) return null;
  return all.length === 1 ? all[0] : `${all[0]} 외 ${all.length - 1}곳`;
}

/** 서버에 보낼 모양: 앞뒤 공백을 뗀다 */
export function normalizePlan(plan: AiResearchPlan): AiResearchPlan {
  return { title: plan.title.trim(), steps: plan.steps.map((step) => ({ title: step.title.trim(), query: step.query.trim() })) };
}

export function isPlanChanged(original: AiResearchPlan, edited: AiResearchPlan): boolean {
  return JSON.stringify(normalizePlan(original)) !== JSON.stringify(normalizePlan(edited));
}

export function addPlanStep(steps: readonly AiResearchPlanStep[]): AiResearchPlanStep[] {
  return steps.length >= AI_RESEARCH_LIMITS.maxPlanSteps ? [...steps] : [...steps, { title: '', query: '' }];
}

export function removePlanStep(steps: readonly AiResearchPlanStep[], index: number): AiResearchPlanStep[] {
  return steps.filter((_, i) => i !== index);
}

/** 단계를 위(-1)·아래(+1)로 옮긴다. 끝이면 그대로 */
export function movePlanStep(steps: readonly AiResearchPlanStep[], index: number, direction: -1 | 1): AiResearchPlanStep[] {
  const target = index + direction;
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) return [...steps];
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ── 계획을 말로 고치기 (이슈 #416) ──

/** 같은 검색인지 보는 열쇠 (서버 queryKey와 같은 규칙: 글자 모양·대소문자·문장부호·낱말 순서·되풀이 무시) */
export const planQueryKey = (query: string): string =>
  [...new Set(query.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').trim().split(/\s+/).filter(Boolean))].sort().join(' ');

export type PlanStepMark = 'new' | 'changed' | 'same';

export interface PlanSuggestionDiff {
  /** 고친 계획의 단계 순서대로 */
  marks: PlanStepMark[];
  /** 고치기 전 계획에서 빠진 단계 */
  removed: AiResearchPlanStep[];
  titleChanged: boolean;
}

const sameText = (a: string, b: string): boolean => a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ');

/**
 * 고치기 전 계획(base)과 고친 계획(next)을 단계별로 맞춘다. 먼저 같은 검색어끼리(이름이 다르면 바뀜), 남은 것은 같은 이름끼리(검색어가 바뀜) 짝짓고,
 * 짝이 없는 고친 단계는 새 단계, 짝이 없는 고치기 전 단계는 빠진 단계다. 순서만 바뀐 단계는 그대로로 본다.
 */
export function planSuggestionDiff(base: AiResearchPlan, next: AiResearchPlan): PlanSuggestionDiff {
  const used = base.steps.map(() => false);
  const match = next.steps.map(() => -1);
  const claim = (i: number, same: (b: AiResearchPlanStep) => boolean) => {
    const j = base.steps.findIndex((b, k) => !used[k] && same(b));
    if (j < 0) return;
    used[j] = true;
    match[i] = j;
  };
  next.steps.forEach((step, i) => {
    const key = planQueryKey(step.query);
    if (key) claim(i, (b) => planQueryKey(b.query) === key);
  });
  next.steps.forEach((step, i) => {
    if (match[i] < 0 && step.title.trim()) claim(i, (b) => sameText(b.title, step.title));
  });
  const marks = next.steps.map((step, i): PlanStepMark => {
    const j = match[i];
    if (j < 0) return 'new';
    const before = base.steps[j];
    return sameText(before.title, step.title) && planQueryKey(before.query) === planQueryKey(step.query) ? 'same' : 'changed';
  });
  return { marks, removed: base.steps.filter((_, k) => !used[k]), titleChanged: !sameText(base.title, next.title) };
}

/** 고친 계획 위 한 줄: "새 단계 1 · 바뀐 단계 1 · 빠진 단계 1". 바뀐 것이 없으면 null */
export function planSuggestionSummary(diff: PlanSuggestionDiff): string | null {
  const count = (mark: PlanStepMark) => diff.marks.filter((m) => m === mark).length;
  const parts = [diff.titleChanged ? '제목 바뀜' : '', count('new') ? `새 단계 ${count('new')}` : '', count('changed') ? `바뀐 단계 ${count('changed')}` : '', diff.removed.length ? `빠진 단계 ${diff.removed.length}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// ── 보고서 판 (이슈 #418) ──

/** 판 이름: "1판 · 처음 보고서", "3판 · 더 조사하기", 고치기로 나온 판은 "2판" */
export function versionLabel(version: Pick<AiResearchReportVersionSummary, 'version' | 'instruction'>): string {
  if (version.instruction !== null) return `${version.version}판`;
  return version.version === 1 ? '1판 · 처음 보고서' : `${version.version}판 · 더 조사하기`;
}

export interface RevisionTurn {
  version: number;
  /** 사원이 쓴 부탁. 더 조사하기로 나온 판이면 null */
  instruction: string | null;
  search: boolean;
  /** 판이 아직 없음 (고치는 중) */
  pending: boolean;
  at: string | null;
}

/** 대화처럼 보이는 고치기 기록: 1판 뒤의 판마다 부탁 → 그 판, 고치는 중이면 맨 끝에 그 부탁 */
export function revisionTurns(run: Pick<AiResearchRunView, 'versions' | 'pendingRevision'>): RevisionTurn[] {
  const turns: RevisionTurn[] = run.versions.filter((v) => v.version > 1).map((v) => ({ version: v.version, instruction: v.instruction, search: v.search, pending: false, at: v.createdAt }));
  if (run.pendingRevision) turns.push({ version: run.pendingRevision.version, instruction: run.pendingRevision.instruction, search: run.pendingRevision.search, pending: true, at: null });
  return turns;
}

/** 보고서 고치기 칸이 꺼진 까닭. 고칠 수 있으면 null */
export function revisionBlockReason(run: Pick<AiResearchRunView, 'status' | 'canRevise' | 'versions' | 'pendingRevision'>): string | null {
  if (run.canRevise) return null;
  if (run.pendingRevision) return `${run.pendingRevision.version}판을 쓰는 중이에요. 끝나면 또 고칠 수 있어요`;
  if (run.versions.length >= AI_RESEARCH_LIMITS.maxReportVersions) return `판은 ${AI_RESEARCH_LIMITS.maxReportVersions}개까지예요. 더 고치려면 [다시 조사]로 새 조사를 만들어 주세요`;
  if (run.status !== 'COMPLETED') return '조사가 끝난 뒤에 고칠 수 있어요';
  return '보고서가 없어 고칠 수 없어요';
}

/** 진행 한 줄: "3/8 단계 · 출처 5/20" */
export function progressText(run: Pick<AiResearchRunView, 'stepsUsed' | 'budget' | 'sources'>): string {
  return `${run.stepsUsed}/${run.budget.maxSteps} 단계 · 출처 ${run.sources.length}/${run.budget.maxSources}`;
}
