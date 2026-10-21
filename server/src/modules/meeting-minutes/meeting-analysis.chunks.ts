import type { MeetingCandidate, MeetingDecision, MeetingTraceChange } from '@fantasteel/shared';
import { isObject, LIST_MAX, squash, type ValidatedAnalysis } from './meeting-analysis.validator';

/**
 * 긴 회의 전사를 조각으로 나눠 분석하고(1차·2차 모두 조각마다) 결과를 하나로 합친다. 순수 함수만 둔다.
 * 발언 번호는 조각마다 다시 세지 않고 전체 회의 기준을 그대로 쓴다: 근거(evidence)가 원문 위치를 그대로 가리킨다.
 */

/** 이 길이 이하의 전사는 나누지 않고 한 번에 분석한다 (이 기능 전 상한과 같다) */
export const SINGLE_PASS_MAX_CHARS = 40_000;
/**
 * 🟡 조각 하나의 글자 수 목표와 앞 조각에서 다시 보여 주는 겹침. 가정값: 한국어는 대략 글자 1개가 토큰 1개라,
 * 32K 문맥 모델에서도 지시·출력(8천 토큰)을 더해 넘치지 않게 잡았다. 겹침은 조각 경계에 걸친 말을 양쪽에서 보게 한다
 */
export const CHUNK_CHARS = 24_000;
export const CHUNK_OVERLAP_CHARS = 2_000;

/** 모델에 보여 줄 전사 한 줄. number는 전체 회의 기준 발언 번호(1부터). 너무 긴 발언은 같은 번호로 여러 줄이 된다 */
export interface TranscriptLine {
  number: number;
  text: string;
}

export interface TranscriptChunk {
  /** 1부터 */
  index: number;
  total: number;
  lines: TranscriptLine[];
  /** 이 조각에 들어 있는 발언 번호 (1부터) */
  numbers: ReadonlySet<number>;
  firstNumber: number;
  lastNumber: number;
}

/** 프롬프트에서 한 줄이 차지하는 길이: "[번호] 글" + 줄바꿈 */
const lineLength = (line: TranscriptLine) => String(line.number).length + 3 + line.text.length + 1;

/** 문장 끝(마침표·물음표·느낌표 뒤 공백)에서 나눈다. 그래도 긴 문장은 글자 수로 자른다 */
export function splitLongText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.split(/(?<=[.!?。！？…])\s+/).filter((s) => s !== '');
  const pieces: string[] = [];
  let current = '';
  const flush = () => {
    if (current !== '') pieces.push(current);
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      flush();
      for (let at = 0; at < sentence.length; at += max) pieces.push(sentence.slice(at, at + max));
      continue;
    }
    if (current !== '' && current.length + 1 + sentence.length > max) flush();
    current = current === '' ? sentence : `${current} ${sentence}`;
  }
  flush();
  return pieces;
}

/**
 * 번호 붙은 전사를 조각으로 나눈다. 발언(화자 줄) 경계에서 나누고, 한 발언이 조각보다 길면 문장 경계에서 나눠 같은 번호로 둔다.
 * 다음 조각은 앞 조각 끝의 발언을 겹침 길이만큼 다시 담아 시작한다. 전체가 singlePassMax 이하면 조각 하나다(줄이 없어도 빈 조각 하나).
 */
export function splitTranscript(
  lines: readonly TranscriptLine[],
  options: { singlePassMax?: number; chunkChars?: number; overlapChars?: number } = {},
): TranscriptChunk[] {
  const singlePassMax = options.singlePassMax ?? SINGLE_PASS_MAX_CHARS;
  const size = options.chunkChars ?? CHUNK_CHARS;
  const overlap = Math.min(options.overlapChars ?? CHUNK_OVERLAP_CHARS, Math.floor(size / 2));
  // 구간 없이 글만 있는 전사도 이 기능 전처럼 한 번은 모델에 보낸다 (근거를 댈 수 없어 후보는 나오지 않는다)
  if (lines.length === 0) return [{ index: 1, total: 1, lines: [], numbers: new Set(), firstNumber: 0, lastNumber: 0 }];

  const total = lines.reduce((sum, line) => sum + lineLength(line), 0);
  const groups: TranscriptLine[][] = [];
  if (total <= singlePassMax) {
    groups.push([...lines]);
  } else {
    // 머리말([번호] )을 뺀 글 길이로 긴 발언을 나눈다
    const units = lines.flatMap((line) => splitLongText(line.text, Math.max(1, size - 16)).map((text) => ({ number: line.number, text })));
    let current: TranscriptLine[] = [];
    let length = 0;
    for (const unit of units) {
      const unitLength = lineLength(unit);
      if (current.length > 0 && length + unitLength > size) {
        groups.push(current);
        // 겹침: 앞 조각 끝의 줄을 겹침 길이 안에서 다시 담되, 앞 조각 전체를 되풀이하지 않고 새 줄이 들어갈 자리는 남긴다
        const carried: TranscriptLine[] = [];
        let carriedLength = 0;
        for (let i = current.length - 1; i > 0; i -= 1) {
          const next = lineLength(current[i]);
          if (carriedLength + next > overlap || carriedLength + next + unitLength > size) break;
          carried.unshift(current[i]);
          carriedLength += next;
        }
        current = carried;
        length = carriedLength;
      }
      current.push(unit);
      length += unitLength;
    }
    if (current.length > 0) groups.push(current);
  }

  return groups.map((group, i) => {
    const numbers = new Set(group.map((line) => line.number));
    return { index: i + 1, total: groups.length, lines: group, numbers, firstNumber: group[0].number, lastNumber: group[group.length - 1].number };
  });
}

/** 근거 번호를 조각 안의 번호로만 남긴다. 조각에 없는 번호는 모델이 지어낸 것이다 */
function evidenceIn(value: unknown, numbers: ReadonlySet<number>): unknown {
  return Array.isArray(value) ? value.filter((n) => typeof n === 'number' && numbers.has(n)) : value;
}

/** 조각 분석 답의 근거(결정사항·후보)를 조각 범위로 거른다. 빈 근거가 된 항목은 검증기가 이유와 함께 버린다 */
export function restrictToChunk(raw: unknown, numbers: ReadonlySet<number>, listKeys: readonly string[] = ['decisions', 'items']): unknown {
  if (!isObject(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };
  for (const key of listKeys) {
    const list = raw[key];
    if (Array.isArray(list)) out[key] = list.map((item) => (isObject(item) ? { ...item, evidence: evidenceIn(item.evidence, numbers) } : item));
  }
  return out;
}

export const CHUNK_MERGE = {
  duplicate: '앞 조각 후보와 같은 일이라 근거를 합쳤어요',
  overLimit: (count: number) => `조각을 합친 후보가 ${LIST_MAX}개를 넘어 뒤의 ${count}개는 넣지 않았어요`,
} as const;

const intersects = (a: readonly number[], b: readonly number[]) => a.some((n) => b.includes(n));
const conflicts = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && a !== b;

/**
 * 같은 일인지: 종류가 같고 제목이 같거나, 다른 조각에서 같은 발언을 근거로 댔으며(겹침 구간) 담당자·원료가 서로 다르지 않을 때.
 * 같은 발언에서 다른 사람의 일을 둘 뽑은 경우는 담당자가 달라 합치지 않는다
 */
function sameWork(a: MeetingCandidate, b: MeetingCandidate, differentChunk: boolean): boolean {
  if (a.kind !== b.kind) return false;
  if (squash(a.title) === squash(b.title)) return true;
  if (!differentChunk || !intersects(a.evidence, b.evidence)) return false;
  return !conflicts(a.assigneeId, b.assigneeId) && !conflicts(a.purchase?.itemId, b.purchase?.itemId);
}

/**
 * 조각마다 검증한 1차 결과를 합친다. 요약은 부르는 쪽이 모델로 합친다(여기서는 조각 요약을 차례로 둔다).
 * - 결정사항: 글이 같으면 하나로 (근거는 합친다).
 * - 후보: 같은 일이면 앞 조각 후보에 근거만 더한다. 키는 c1…로 다시 붙이고 LIST_MAX개까지.
 * 근거는 원문 위치(0부터) 그대로라 어느 조각에서 왔는지와 상관없이 원본 발언을 가리킨다.
 */
export function mergeChunkResults(parts: readonly ValidatedAnalysis[]): { summaries: string[]; decisions: MeetingDecision[]; candidates: MeetingCandidate[]; changes: MeetingTraceChange[] } {
  const decisions: MeetingDecision[] = [];
  for (const part of parts) {
    for (const decision of part.decisions) {
      const same = decisions.find((d) => squash(d.text) === squash(decision.text));
      if (same) same.evidence = [...new Set([...same.evidence, ...decision.evidence])].sort((a, b) => a - b);
      else decisions.push({ text: decision.text, evidence: [...decision.evidence] });
    }
  }

  const merged: { candidate: MeetingCandidate; chunk: number; absorbed: Set<number> }[] = [];
  const changes: MeetingTraceChange[] = [];
  parts.forEach((part, chunk) => {
    for (const candidate of part.candidates) {
      // 한 후보는 다른 조각마다 하나씩만 흡수한다 (같은 발언에서 나온 두 일을 하나로 뭉치지 않게)
      const target = merged.find((m) => !m.absorbed.has(chunk) && sameWork(m.candidate, candidate, m.chunk !== chunk));
      if (target) {
        target.candidate = { ...target.candidate, evidence: [...new Set([...target.candidate.evidence, ...candidate.evidence])].sort((a, b) => a - b) };
        target.absorbed.add(chunk);
        changes.push({ action: 'DROPPED', title: candidate.title, reason: CHUNK_MERGE.duplicate });
        continue;
      }
      merged.push({ candidate, chunk, absorbed: new Set([chunk]) });
    }
  });
  if (merged.length > LIST_MAX) {
    for (const extra of merged.slice(LIST_MAX)) changes.push({ action: 'DROPPED', title: extra.candidate.title, reason: CHUNK_MERGE.overLimit(merged.length - LIST_MAX) });
  }
  const candidates = merged.slice(0, LIST_MAX).map((m, i) => ({ ...m.candidate, key: `c${i + 1}` }));
  return { summaries: parts.map((p) => p.summary).filter((s) => s !== ''), decisions: decisions.slice(0, LIST_MAX), candidates, changes };
}

/** 요약 합치기에 실패했을 때: 조각 요약을 차례로 이어 상한까지 */
export function joinSummaries(summaries: readonly string[], max: number): string {
  const joined = summaries.join('\n');
  return joined.length > max ? joined.slice(0, max) : joined;
}
