// 메시지 본문 해석 (REQ-MSG-005 멘션, REQ-MSG-006 ERP 화면 이동). 순수 함수라 api와 화면이 함께 쓴다.
// - @멘션: 방 멤버 이름 또는 부서 이름 앞에 @를 붙인다. 긴 이름부터 맞춰 겹치는 이름을 구분한다.
// - ERP 번호: 수주(SO-)·구매요청(PR-)·출하요청(DR-) 번호(업무 프로세스 9.1)가 실제로 있으면 그 상세 화면 링크가 된다.

export interface NamedCandidate {
  name: string;
}

/** content의 pos 자리('@' 다음)에서 시작하는 가장 긴 후보 */
function longestAt<T extends NamedCandidate>(content: string, pos: number, candidates: readonly T[]): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (!candidate.name) continue;
    if (content.startsWith(candidate.name, pos) && (!best || candidate.name.length > best.name.length)) best = candidate;
  }
  return best;
}

/** 본문에서 멘션된 후보를 찾는다 (같은 후보는 한 번만) */
export function findMentions<T extends NamedCandidate>(content: string, candidates: readonly T[]): T[] {
  const found: T[] = [];
  for (let index = content.indexOf('@'); index >= 0; index = content.indexOf('@', index + 1)) {
    const hit = longestAt(content, index + 1, candidates);
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}

export type ErpNoKind = 'SALES_ORDER' | 'PURCHASE_REQUISITION' | 'SHIPMENT_REQUEST';

const ERP_NO_PATTERN = /\b(SO-\d{4}-\d{3,}|PR-\d{4}-\d{4,}|DR-\d{4}-\d{4,})\b/g;

const KIND_OF_PREFIX: Record<string, ErpNoKind> = {
  SO: 'SALES_ORDER',
  PR: 'PURCHASE_REQUISITION',
  DR: 'SHIPMENT_REQUEST',
};

/** 본문의 업무 번호 (같은 번호는 한 번만) */
export function findErpNos(content: string): { no: string; kind: ErpNoKind }[] {
  const result: { no: string; kind: ErpNoKind }[] = [];
  for (const match of content.matchAll(ERP_NO_PATTERN)) {
    const no = match[1];
    const kind = KIND_OF_PREFIX[no.slice(0, 2)];
    if (kind && !result.some((r) => r.no === no)) result.push({ no, kind });
  }
  return result;
}

export interface ErpLink {
  text: string;
  href: string;
}

export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; isMe: boolean }
  | { kind: 'link'; text: string; href: string };

export interface SplitOptions {
  /** 멘션으로 칠할 이름 (방 멤버·부서 이름) */
  mentionNames: readonly string[];
  /** 나를 가리키는 이름 (내 이름, 내 부서 이름) */
  myNames: readonly string[];
  links: readonly ErpLink[];
}

/** 본문을 글·멘션·링크 조각으로 나눈다 (화면 표시용) */
export function splitMessageText(content: string, options: SplitOptions): TextSegment[] {
  const names = options.mentionNames.filter(Boolean).map((name) => ({ name }));
  const links = [...options.links].sort((a, b) => b.text.length - a.text.length);
  const segments: TextSegment[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) segments.push({ kind: 'text', text: buffer });
    buffer = '';
  };
  let index = 0;
  while (index < content.length) {
    if (content[index] === '@') {
      const hit = longestAt(content, index + 1, names);
      if (hit) {
        flush();
        segments.push({ kind: 'mention', text: `@${hit.name}`, isMe: options.myNames.includes(hit.name) });
        index += hit.name.length + 1;
        continue;
      }
    }
    const link = links.find((l) => content.startsWith(l.text, index) && !/[A-Za-z0-9]/.test(content[index - 1] ?? '') && !/[0-9]/.test(content[index + l.text.length] ?? ''));
    if (link) {
      flush();
      segments.push({ kind: 'link', text: link.text, href: link.href });
      index += link.text.length;
      continue;
    }
    buffer += content[index];
    index += 1;
  }
  flush();
  return segments;
}

/** 목록·알림에 쓰는 짧은 미리보기 (줄바꿈을 공백으로, 길면 …) */
export function previewText(content: string, maxLength = 60): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat;
}
