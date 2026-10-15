import type { MeetingCandidate, MeetingCandidateKind, MeetingDecision } from '@fantasteel/shared';

/**
 * 모델이 돌려준 JSON을 서버 규칙으로 걸러 후보로 바꾼다 (REQ-AST-005·009).
 * 순수 함수만 둔다: 사원·품목·수주는 부르는 쪽이 DB에서 읽어 넘기고, 모델이 쓴 id·숫자는 쓰지 않는다.
 * 전사는 신뢰할 수 없는 입력이라 프롬프트 주입으로 모델이 어떤 값을 내도 아래 규칙을 넘는 결과는 나오지 않는다.
 */

export interface AnalysisContext {
  /** YYYY-MM-DD */
  meetingDate: string;
  /** 전사 구간 글. 배열 위치가 발언 번호(0부터)다 */
  segments: string[];
  attendees: { employeeId: number; employeeName: string }[];
  rawMaterials: { itemId: number; itemName: string; itemCode: string }[];
  /** DB에 있는 수주번호(대문자) → id */
  salesOrders: ReadonlyMap<string, number>;
}

export interface ValidatedAnalysis {
  summary: string;
  decisions: MeetingDecision[];
  candidates: MeetingCandidate[];
}

export const ISSUE = {
  assignee: '담당자를 참석자에서 찾지 못했어요',
  dueDate: '마감일을 확인해 주세요',
  eventAttendees: '일정 참석자를 확인해 주세요',
  eventStart: '일정 시각을 확인해 주세요',
  eventEndAssumed: '끝 시각은 말이 없어 1시간으로 가정했어요',
  rawMaterial: '원료 품목을 확인해 주세요',
  quantityTon: '수량(톤)을 확인해 주세요',
  desiredReceiptDate: '희망 입고일을 확인해 주세요',
  sameDay: '마감일이 회의 당일이에요. 요일만 말했다면 다음 주일 수 있어요',
} as const;

const KINDS: readonly MeetingCandidateKind[] = ['TASK', 'EVENT', 'PURCHASE'];
const TITLE_MAX = 200;
const TEXT_MAX = 1000;
const SUMMARY_MAX = 3000;
const LIST_MAX = 30;
const RANGE_DAYS = 365;
const DAY_MS = 86_400_000;
const SALES_ORDER_NO = /^SO-\d{4,8}-\d{3,}$/;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD'가 실제 있는 날짜인지. 아니면 null */
function parseDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
}

function inRange(date: string, meetingDate: string): boolean {
  const diff = (Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${meetingDate}T00:00:00.000Z`)) / DAY_MS;
  return diff >= 0 && diff <= RANGE_DAYS;
}

function validDate(v: unknown, meetingDate: string): string | null {
  const date = parseDate(v);
  return date !== null && inRange(date, meetingDate) ? date : null;
}

interface LocalDateTime {
  date: string;
  hour: number;
  minute: number;
}

function parseDateTime(v: unknown, meetingDate: string): LocalDateTime | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(v.trim());
  if (!m) return null;
  const date = validDate(m[1], meetingDate);
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (date === null || hour > 23 || minute > 59) return null;
  return { date, hour, minute };
}

const isoOf = (t: LocalDateTime) => `${t.date}T${pad(t.hour)}:${pad(t.minute)}:00+09:00`;

function plusOneHour(t: LocalDateTime): LocalDateTime {
  const d = new Date(Date.parse(`${t.date}T${pad(t.hour)}:${pad(t.minute)}:00.000Z`) + 3_600_000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** 모델이 센 발언 번호(1부터)를 0부터의 위치로 바꾸고, 범위 밖·정수가 아닌 값·중복을 버린다 */
function evidenceOf(v: unknown, segmentCount: number): number[] {
  if (!Array.isArray(v)) return [];
  const picked = new Set<number>();
  for (const n of v) {
    if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= segmentCount) picked.add(n - 1);
  }
  return [...picked].sort((a, b) => a - b);
}

function matchEmployee(name: string, attendees: AnalysisContext['attendees']): number | null {
  const find = (candidate: string) => attendees.filter((a) => a.employeeName.trim() === candidate);
  let found = find(name);
  // "박서영 대리"처럼 직급을 붙여 말한 경우: 첫 낱말이 참석자 이름과 정확히 같을 때만 인정한다
  if (found.length === 0 && /\s/.test(name)) found = find(name.split(/\s+/)[0]);
  return found.length === 1 ? found[0].employeeId : null;
}

function matchItem(name: string, items: AnalysisContext['rawMaterials']): number | null {
  const q = name.trim().toLowerCase();
  if (q === '') return null;
  const exact = items.filter((i) => i.itemName.trim().toLowerCase() === q || i.itemCode.trim().toLowerCase() === q);
  if (exact.length === 1) return exact[0].itemId;
  if (exact.length > 1 || q.length < 2) return null;
  const partial = items.filter((i) => i.itemName.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0].itemId : null;
}

function quantityOf(v: unknown): string | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const fixed = n.toFixed(3);
  return Number(fixed) > 0 ? fixed : null;
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** 수주번호 후보를 모아 DB에서 확인할 수 있게 한다 */
export function collectSalesOrderNos(raw: unknown): string[] {
  const items = isObject(raw) && Array.isArray(raw.items) ? raw.items : [];
  const nos = new Set<string>();
  for (const item of items.slice(0, LIST_MAX)) {
    const no = isObject(item) ? text(item.relatedSalesOrderNo, 40)?.toUpperCase() : undefined;
    if (no && SALES_ORDER_NO.test(no)) nos.add(no);
  }
  return [...nos];
}

function toCandidate(item: Json, ctx: AnalysisContext): Omit<MeetingCandidate, 'key'> | null {
  const kind = KINDS.find((k) => k === item.kind);
  const title = text(item.title, TITLE_MAX);
  const evidence = evidenceOf(item.evidence, ctx.segments.length);
  if (!kind || !title || evidence.length === 0) return null;

  const issues: string[] = [];
  const evidenceText = evidence.map((i) => ctx.segments[i]);
  const quoted = text(item.sourceText, 200);
  // 원문이라며 전사에 없는 글을 내면 지어낸 것이므로 버린다
  const sourceText = quoted !== null && squash(evidenceText.join('')).includes(squash(quoted)) ? quoted : null;
  const assigneeName = text(item.assigneeName, 50);
  const assigneeId = assigneeName === null ? null : matchEmployee(assigneeName, ctx.attendees);

  let dueDate: string | null = null;
  let startAt: string | null = null;
  let endAt: string | null = null;
  let endAssumed = false;
  let attendeeIds: number[] = [];
  let purchase: MeetingCandidate['purchase'] = null;
  let itemName: string | null = null;

  if (kind === 'TASK') {
    if (assigneeId === null) issues.push(ISSUE.assignee);
    dueDate = validDate(item.dueDate, ctx.meetingDate);
    if (dueDate === null) issues.push(ISSUE.dueDate);
    // 회의 요일과 같은 요일("목요일까지")은 오늘인지 다음 주인지 모호해 모델이 자주 당일로 푼다
    else if (dueDate === ctx.meetingDate) issues.push(ISSUE.sameDay);
  } else if (kind === 'EVENT') {
    const names = [assigneeName, ...(Array.isArray(item.attendeeNames) ? item.attendeeNames.slice(0, 20).map((n) => text(n, 50)) : [])].filter((n): n is string => n !== null);
    const matched = names.map((n) => matchEmployee(n, ctx.attendees));
    const named = [...new Set(matched.filter((id): id is number => id !== null))];
    if (named.length > 0 && matched.every((id) => id !== null)) {
      attendeeIds = named;
    } else {
      attendeeIds = named.length > 0 ? named : ctx.attendees.map((a) => a.employeeId);
      issues.push(ISSUE.eventAttendees);
    }
    const start = parseDateTime(item.startAt, ctx.meetingDate);
    if (start === null) {
      issues.push(ISSUE.eventStart);
    } else {
      startAt = isoOf(start);
      const given = parseDateTime(item.endAt, ctx.meetingDate);
      const end = given !== null && isoOf(given) > startAt ? given : null;
      if (end === null) {
        endAssumed = true;
        issues.push(ISSUE.eventEndAssumed);
      }
      endAt = isoOf(end ?? plusOneHour(start));
    }
  } else {
    itemName = text(item.itemName, 100);
    const itemId = itemName === null ? null : matchItem(itemName, ctx.rawMaterials);
    const requestedTon = quantityOf(item.quantityTon);
    const desiredReceiptDate = validDate(item.dueDate, ctx.meetingDate);
    if (itemId === null) issues.push(ISSUE.rawMaterial);
    if (requestedTon === null) issues.push(ISSUE.quantityTon);
    if (desiredReceiptDate === null) issues.push(ISSUE.desiredReceiptDate);
    purchase = { itemId, requestedTon, desiredReceiptDate, requestReason: title, sourceText: evidenceText.join('\n') };
  }

  const orderNo = text(item.relatedSalesOrderNo, 40)?.toUpperCase() ?? null;
  const salesOrderId = orderNo !== null && SALES_ORDER_NO.test(orderNo) ? (ctx.salesOrders.get(orderNo) ?? null) : null;

  return {
    kind,
    title,
    description: text(item.description, TEXT_MAX),
    evidence,
    sourceText,
    assigneeId,
    assigneeName,
    dueDate,
    startAt,
    endAt,
    endAssumed,
    attendeeIds,
    purchase,
    itemName,
    relatedSalesOrderNo: salesOrderId === null ? null : orderNo,
    salesOrderId,
    issues,
    decision: 'PENDING',
  };
}

/** 모델 JSON이 객체가 아니면 null (부르는 쪽이 분석 실패로 처리한다) */
export function validateAnalysis(raw: unknown, ctx: AnalysisContext): ValidatedAnalysis | null {
  if (!isObject(raw)) return null;
  const decisions: MeetingDecision[] = [];
  for (const d of (Array.isArray(raw.decisions) ? raw.decisions : []).slice(0, LIST_MAX)) {
    if (!isObject(d)) continue;
    const decisionText = text(d.text, TEXT_MAX);
    const evidence = evidenceOf(d.evidence, ctx.segments.length);
    if (decisionText && evidence.length > 0) decisions.push({ text: decisionText, evidence });
  }
  const candidates = (Array.isArray(raw.items) ? raw.items : [])
    .slice(0, LIST_MAX)
    .flatMap((item) => (isObject(item) ? [toCandidate(item, ctx)] : []))
    .filter((c): c is Omit<MeetingCandidate, 'key'> => c !== null)
    .map((c, index) => ({ key: `c${index + 1}`, ...c }));
  return { summary: text(raw.summary, SUMMARY_MAX) ?? '', decisions, candidates };
}
