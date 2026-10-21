import { Injectable } from '@nestjs/common';
import type { MeetingCandidate, MeetingCandidateContextLine } from '@fantasteel/shared';
import { seoulToday } from '../../common/time/seoul-date';
import type { Tx } from '../../prisma/prisma.service';
import { MeetingMinutesRepository } from './meeting-minutes.repository';

/**
 * 후보 옆에 보여 줄 ERP 현황 (수주 납기·재고·업무량·일정 겹침). 모두 DB 값으로 규칙대로 만든 글이고 AI는 관여하지 않는다 (REQ-AST-009).
 * 아래 순수 함수가 판단과 문구를, MeetingCandidateContextService가 DB 읽기를 맡는다.
 */

const DAY_MS = 86_400_000;
const WORKLOAD_WARN = 3;
const OVERLAP_LINES_MAX = 3;
const ORDER_ITEMS_SHOWN = 3;

export interface ContextResult {
  lines: MeetingCandidateContextLine[];
  /** 후보의 확인 사유로 덧붙일 문구 */
  issues: string[];
}

const info = (label: string, value: string): MeetingCandidateContextLine => ({ label, value, tone: 'info' });
const warn = (label: string, value: string): MeetingCandidateContextLine => ({ label, value, tone: 'warn' });

/** 'YYYY-MM-DD' → 'M/D' */
export function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 그 날짜가 속한 주(월~일)의 월요일 */
export function weekStartOf(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
}

/** 이 후보가 내세운 날짜: 업무는 마감일, 일정은 시작 날짜(+09:00 ISO에서 그대로 읽는다) */
export function candidateDate(c: Pick<MeetingCandidate, 'kind' | 'dueDate' | 'startAt'>): string | null {
  if (c.kind === 'TASK') return c.dueDate;
  if (c.kind === 'EVENT') return c.startAt === null ? null : c.startAt.slice(0, 10);
  return null;
}

/** 후보를 고칠 때 이전 현황이 붙인 확인 사유를 지우려고 알아본다 */
const CONTEXT_ISSUE = [/^수주 납기\(\d+\/\d+\)보다 늦어요$/, /^이번 주 업무가 많아요$/, /^.+ 일정과 겹쳐요 \(\d{2}:\d{2}\)$/];
export const withoutContextIssues = (issues: string[]): string[] => issues.filter((i) => !CONTEXT_ISSUE.some((re) => re.test(i)));

// 정수 매수·톤(소수 3자리 문자열)을 부동소수점 오차 없이 더하려고 1/1000 단위 정수로 센다
const toMilli = (ton: string): number => Math.round(Number(ton) * 1000);
export const milliToTon = (milli: number): string => (Math.max(0, milli) / 1000).toFixed(3);

export interface SalesOrderContextInput {
  customerName: string;
  items: { itemName: string; orderedQty: number; shippedQty: number; dueDate: string; open: boolean }[];
}

/** 수주 고객사·품목별 납기·진행. 후보 날짜가 가장 빠른 열린 납기보다 늦으면 경고 */
export function salesOrderContext(order: SalesOrderContextInput, date: string | null): ContextResult {
  const lines: MeetingCandidateContextLine[] = [info('수주 고객사', order.customerName)];
  const issues: string[] = [];
  const live = order.items;
  const open = live.filter((i) => i.open).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (open.length > 0) {
    const shown = open.slice(0, ORDER_ITEMS_SHOWN).map((i) => `${i.itemName} ${shortDate(i.dueDate)}`);
    const rest = open.length - shown.length;
    const earliest = open[0].dueDate;
    const late = date !== null && date > earliest;
    lines.push({ label: '수주 납기', value: `${shown.join(', ')}${rest > 0 ? ` 외 ${rest}건` : ''}${late ? ` · 후보 날짜 ${shortDate(date)}가 가장 빠른 납기보다 늦어요` : ''}`, tone: late ? 'warn' : 'info' });
    if (late) issues.push(`수주 납기(${shortDate(earliest)})보다 늦어요`);
  }
  if (live.length > 0) {
    const ordered = live.reduce((sum, i) => sum + i.orderedQty, 0);
    const shipped = live.reduce((sum, i) => sum + i.shippedQty, 0);
    lines.push(info('수주 진행', `출하 ${shipped}매 / 수주 ${ordered}매`));
  }
  return { lines, issues };
}

export interface PurchaseContextInput {
  /** 품목을 모르면 null: 재고·입고 예정은 건너뛴다 */
  stock: { onHandTon: string; incomingTon: string } | null;
  desiredReceiptDate: string | null;
  today: string;
}

export function purchaseContext(input: PurchaseContextInput): ContextResult {
  const lines: MeetingCandidateContextLine[] = [];
  if (input.stock) {
    lines.push(info('현재 재고', `${input.stock.onHandTon} 톤`), info('입고 예정', `${input.stock.incomingTon} 톤`));
  }
  if (input.desiredReceiptDate !== null && input.desiredReceiptDate < input.today) lines.push(warn('희망 입고일', `${input.desiredReceiptDate}는 이미 지난 날짜예요`));
  return { lines, issues: [] };
}

/** 발주했지만 아직 안 들어온 톤: 발주 톤 − 입고 합계, 품목 행마다 0 아래로 내려가지 않게 */
export function incomingTonOf(rows: { orderedTon: string; receivedTons: string[] }[]): string {
  const milli = rows.reduce((sum, r) => sum + Math.max(0, toMilli(r.orderedTon) - r.receivedTons.reduce((s, t) => s + toMilli(t), 0)), 0);
  return milliToTon(milli);
}

/** 담당자의 진행 중 업무와 그중 마감이 같은 주인 것. 3건 이상이면 경고 */
export function workloadContext(openDueDates: string[], dueDate: string | null): ContextResult {
  const sameWeek = dueDate === null ? 0 : openDueDates.filter((d) => weekStartOf(d) === weekStartOf(dueDate)).length;
  const heavy = sameWeek >= WORKLOAD_WARN;
  const value = dueDate === null ? `진행 중 ${openDueDates.length}건` : `진행 중 ${openDueDates.length}건 (그중 같은 주 마감 ${sameWeek}건)`;
  return { lines: [{ label: '담당자 업무', value, tone: heavy ? 'warn' : 'info' }], issues: heavy ? ['이번 주 업무가 많아요'] : [] };
}

export interface EventOverlap {
  employeeName: string;
  title: string;
  startAt: Date;
  endAt: Date;
}

/** Date → 서울 'HH:mm' */
export function seoulClock(at: Date): string {
  return new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
}

/** 참석자별로 겹치는 일정 첫 건. 없으면 겹치지 않는다는 한 줄 */
export function eventOverlapContext(overlaps: EventOverlap[]): ContextResult {
  if (overlaps.length === 0) return { lines: [info('일정 겹침', '참석자의 같은 시간대 일정이 없어요')], issues: [] };
  const firstPerPerson = new Map<string, EventOverlap>();
  for (const o of overlaps) if (!firstPerPerson.has(o.employeeName)) firstPerPerson.set(o.employeeName, o);
  const picked = [...firstPerPerson.values()];
  return {
    lines: picked.slice(0, OVERLAP_LINES_MAX).map((o) => warn('일정 겹침', `${o.employeeName} · ${seoulClock(o.startAt)}~${seoulClock(o.endAt)} ${o.title}`)),
    issues: picked.map((o) => `${o.employeeName} 일정과 겹쳐요 (${seoulClock(o.startAt)})`),
  };
}

/** DB를 읽어 후보마다 현황을 다시 계산한다. 읽기만 한다 */
@Injectable()
export class MeetingCandidateContextService {
  constructor(private readonly repository: MeetingMinutesRepository) {}

  /** 후보 하나의 현황. 날짜·담당자·품목을 고친 뒤에도 같은 규칙으로 다시 부른다 */
  async build(tx: Tx, candidate: MeetingCandidate, today: string = seoulToday()): Promise<ContextResult> {
    const parts: ContextResult[] = [];

    if (candidate.salesOrderId !== null) {
      const order = await this.repository.findSalesOrderContext(tx, candidate.salesOrderId);
      if (order) parts.push(salesOrderContext(order, candidateDate(candidate)));
    }
    if (candidate.kind === 'PURCHASE') {
      const itemId = candidate.purchase?.itemId ?? null;
      const stock = itemId === null ? null : await this.stockOf(tx, itemId);
      parts.push(purchaseContext({ stock, desiredReceiptDate: candidate.purchase?.desiredReceiptDate ?? null, today }));
    } else if (candidate.kind === 'TASK' && candidate.assigneeId !== null) {
      parts.push(workloadContext(await this.repository.findOpenTaskDueDates(tx, candidate.assigneeId), candidate.dueDate));
    } else if (candidate.kind === 'EVENT' && candidate.startAt !== null && candidate.endAt !== null && candidate.attendeeIds.length > 0) {
      const events = await this.repository.findOverlappingEvents(tx, candidate.attendeeIds, new Date(candidate.startAt), new Date(candidate.endAt));
      const overlaps = events.flatMap((e) =>
        e.attendees.filter((a) => candidate.attendeeIds.includes(a.employeeId)).map((a) => ({ employeeName: a.employee.employeeName, title: e.scheduleEventTitle, startAt: e.startAt, endAt: e.endAt })),
      );
      parts.push(eventOverlapContext(overlaps));
    }
    return { lines: parts.flatMap((p) => p.lines), issues: parts.flatMap((p) => p.issues) };
  }

  /** 현황을 후보에 반영한다: 이전 현황의 확인 사유는 지우고 새로 붙인다 */
  async apply(tx: Tx, candidate: MeetingCandidate, today?: string): Promise<MeetingCandidate> {
    const { lines, issues } = await this.build(tx, candidate, today);
    const kept = withoutContextIssues(candidate.issues);
    return { ...candidate, context: lines, issues: [...kept, ...issues.filter((i) => !kept.includes(i))] };
  }

  /** 차례로 읽는다: 같은 트랜잭션 연결에서 쿼리를 겹쳐 보내면 pg 다음 버전이 오류를 낸다 */
  async applyAll(tx: Tx, candidates: MeetingCandidate[], today?: string): Promise<MeetingCandidate[]> {
    const applied: MeetingCandidate[] = [];
    for (const candidate of candidates) applied.push(await this.apply(tx, candidate, today));
    return applied;
  }

  private async stockOf(tx: Tx, itemId: number): Promise<{ onHandTon: string; incomingTon: string }> {
    const onHandTon = await this.repository.sumRawMaterialOnHandTon(tx, itemId);
    const orderItems = await this.repository.findOpenPurchaseOrderItems(tx, itemId);
    return { onHandTon, incomingTon: incomingTonOf(orderItems) };
  }
}
