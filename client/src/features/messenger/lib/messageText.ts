// 메시지 본문 해석 (REQ-MSG-005 멘션, REQ-MSG-006 ERP 화면 이동). 순수 함수라 api와 화면이 함께 쓴다.
// - @멘션: 방 멤버 이름 또는 부서 이름 앞에 @를 붙인다. 긴 이름부터 맞춰 겹치는 이름을 구분한다.
// - ERP 번호: 수주(SO-)·구매요청(PR-)·출하요청(DR-) 번호(업무 프로세스 9.1)가 실제로 있으면 그 상세 화면 링크가 된다.
// - 작은 이모티콘(23번, 문서에 없는 추가 기능): ':steelman-ok:'처럼 적은 자리에 작은 그림을 그린다 (shared splitInlineEmoticons).
import { splitInlineEmoticons, type ErpLink, type MessageEmoticonKey } from '@fantasteel/shared';

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

// 업무 번호 해석은 서버와 같은 규칙을 쓰려고 shared에 둔다
export { findErpNos, type ErpLink, type ErpNoKind } from '@fantasteel/shared';

export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; isMe: boolean }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'emoticon'; text: string; key: MessageEmoticonKey };

export interface SplitOptions {
  /** 멘션으로 칠할 이름 (방 멤버·부서 이름) */
  mentionNames: readonly string[];
  /** 나를 가리키는 이름 (내 이름, 내 부서 이름) */
  myNames: readonly string[];
  links: readonly ErpLink[];
}

/** 본문을 글·멘션·링크·작은 이모티콘 조각으로 나눈다 (화면 표시용) */
export function splitMessageText(content: string, options: SplitOptions): TextSegment[] {
  // 작은 이모티콘 글(':키:')에는 '@'나 업무 번호가 들어가지 않아, 멘션·링크를 먼저 나눈 뒤 글 조각만 다시 나눠도 된다
  return splitMentionsAndLinks(content, options).flatMap((segment): TextSegment[] =>
    segment.kind === 'text' ? splitInlineEmoticons(segment.text).map((part) => (part.kind === 'text' ? part : { kind: 'emoticon', text: part.text, key: part.key })) : [segment],
  );
}

function splitMentionsAndLinks(content: string, options: SplitOptions): TextSegment[] {
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
