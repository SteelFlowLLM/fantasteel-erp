import { cutText, stripInvisible, UNTRUSTED_NOTE, wrapUntrusted } from '../web/web-text';
import type { ElementInfo, PageSnapshot, SnapshotItem } from './page-script';

/**
 * 브라우저 사용(이슈 #373)의 규칙. Chrome 없이 시험할 수 있게 순수 함수로 둔다:
 * 막는 버튼·칸, POST 폼 판단, 요소 번호(ref)가 지금 페이지 것인지, 화면 글 만들기.
 */

/** 한 답에서 브라우저 도구를 부르는 수 (화면 읽기 포함, 결정값) */
export const MAX_BROWSER_ACTIONS_PER_ANSWER = 15;
/** 한 답에서 브라우저를 쓰는 시간. 첫 브라우저 도구부터 센다 (결정값) */
export const BROWSER_TIME_PER_ANSWER_MS = 3 * 60_000;
/** 화면 읽기에서 도는 요소 수와 모델에 넘기는 글 길이 (결정값) */
export const SNAPSHOT_MAX_NODES = 5_000;
export const SNAPSHOT_MAX_CHARS = 8_000;
/** 누르기·입력·스크롤 뒤에 붙이는 짧은 화면 글 (가정값) */
export const ACTION_SNAPSHOT_MAX_CHARS = 3_000;
/** browser_type 한 번에 넣는 글 (가정값) */
export const BROWSER_TYPE_MAX = 200;

/** 누르지 않는 낱말: 이름·값·글에 있으면 막는다. 영어는 낱말 앞머리로 본다(payment·orders도 막힘, border는 안 막힘) */
const RISKY_KO = /로그인|결제|구매|주문|삭제|송금|이체|가입/;
const RISKY_EN = /\b(?:log[\s-]?in|sign[\s-]?in|sign[\s-]?up|buy|pay|check[\s-]?out|purchase|order|delete|transfer|subscribe)/i;

/** 넣지 않는 칸 이름 (name·id·placeholder·aria-label·label 글) */
const SENSITIVE_FIELD = /card|cvc|cvv|otp|password|passwd|주민|계좌|비밀번호/i;

/** 막힌 이유와 함께 모델에 돌려줄 안내 */
export const USER_MUST_DO_IT = '이 일은 AI가 하지 않아요. 사용자에게 직접 브라우저에서 해야 한다고 알리고, 같은 동작을 다시 시도하지 않아요';

/** 위험한 낱말이 있으면 그 낱말 */
export function riskyWordIn(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    const match = RISKY_KO.exec(text) ?? RISKY_EN.exec(text);
    if (match) return match[0];
  }
  return null;
}

/**
 * 폼을 보내면 POST인지 (순수 함수). 보내는 버튼의 formmethod가 폼의 method보다 앞서고, 없거나 틀린 값은 GET이다(HTML 규칙).
 * dialog는 네트워크로 보내지 않으니 POST가 아니다.
 */
export function isPostFormSubmission(formMethod: string | null | undefined, submitterMethod?: string | null): boolean {
  const pick = (value: string | null | undefined) => {
    const v = (value ?? '').trim().toLowerCase();
    return v === 'post' || v === 'get' || v === 'dialog' ? v : null;
  };
  return (pick(submitterMethod) ?? pick(formMethod) ?? 'get') === 'post';
}

/** 비밀번호·카드·일회용 코드처럼 값을 보이지도 넣지도 않는 칸인지 */
export function isSensitiveField(field: Pick<ElementInfo, 'type' | 'autocomplete' | 'hints'>): boolean {
  if (field.type === 'password') return true;
  const tokens = field.autocomplete.toLowerCase().split(/\s+/);
  if (tokens.some((t) => t.startsWith('cc-') || t === 'one-time-code' || t === 'current-password' || t === 'new-password')) return true;
  return SENSITIVE_FIELD.test(field.hints);
}

/** 누르면 안 되는 요소면 이유 */
export function clickBlockReason(el: ElementInfo): string | null {
  if (el.type === 'file') return '파일 올리기는 막혀 있어요';
  if (el.download) return '파일 내려받기는 막혀 있어요';
  const word = riskyWordIn(el.name, el.value, el.text);
  if (word) return `"${word}" 같은 로그인·결제·구매·주문·삭제·송금·가입 버튼·링크는 누르지 않아요`;
  if (el.isSubmitter && el.inForm && isPostFormSubmission(el.formMethod, el.submitterMethod)) return '정보를 보내는 폼(POST)은 제출하지 않아요';
  return null;
}

/** 글을 넣으면 안 되는 칸이면 이유 */
export function typeBlockReason(el: ElementInfo): string | null {
  if (el.type === 'file') return '파일 올리기는 막혀 있어요';
  if (isSensitiveField(el)) return '비밀번호·카드·계좌·주민등록번호·인증번호 칸에는 입력하지 않아요';
  return null;
}

/** 'r12'·'12'·12 → 12 */
export function parseRef(raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  const match = /^\[?r?(\d{1,7})\]?$/i.exec(text);
  return match ? Number(match[1]) : null;
}

export type RefCheck = { ok: true; id: number } | { ok: false; reason: string };

/**
 * 요소 번호 장부. 번호는 한 답 안에서 늘기만 하고, 페이지(문서)가 바뀌면 그 앞의 번호는 모두 못 쓴다.
 * 같은 페이지를 다시 읽으면 이미 붙인 번호는 그대로, 새 요소만 새 번호를 받는다.
 */
export class RefBook {
  private docStart = 1;
  private next = 1;

  /** 새 문서로 이동했을 때 */
  startDocument() {
    this.docStart = this.next;
  }

  /** 화면 읽기가 번호를 붙인 뒤 다음 번호 */
  advance(next: number) {
    if (Number.isInteger(next) && next > this.next) this.next = next;
  }

  get range(): { docStart: number; next: number } {
    return { docStart: this.docStart, next: this.next };
  }

  check(raw: unknown): RefCheck {
    const id = parseRef(raw);
    if (id === null) return { ok: false, reason: 'ref는 화면 읽기 결과의 [r번호] 그대로 넘겨요 (예: r12)' };
    if (id < this.docStart) return { ok: false, reason: `r${id}는 이전 페이지의 번호예요. 지금 페이지를 browser_snapshot으로 다시 읽고 새 번호를 써요` };
    if (id >= this.next) return { ok: false, reason: `r${id}는 없는 번호예요. browser_snapshot 결과의 번호를 써요` };
    return { ok: true, id };
  }
}

/** 화면 사진·출처에 보일 주소: 호스트 + 경로 (쿼리·#조각은 뺀다. 검색어·토큰이 들어 있을 수 있다) */
export function displayUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return '';
  }
}

const quote = (text: string, max: number) => `"${cutText(stripInvisible(text).replace(/\s+/g, ' ').trim(), max).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** 링크 대상: 같은 사이트면 경로, 아니면 호스트 + 경로. http(s)가 아니면 scheme만 */
function hrefLabel(href: string, pageUrl: string): string {
  let target: URL;
  try {
    target = new URL(href, pageUrl);
  } catch {
    return '';
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return `(${target.protocol.replace(':', '')})`;
  let sameHost = false;
  try {
    sameHost = new URL(pageUrl).host === target.host;
  } catch {
    sameHost = false;
  }
  return cutText(sameHost ? `${target.pathname}${target.search}` : `${target.host}${target.pathname}`, 100);
}

function itemLine(item: SnapshotItem, pageUrl: string): string {
  if (item.ref === null) return `${item.role} ${quote(item.name, 200)}`;
  const parts = [`[r${item.ref}]`, item.role, quote(item.name, 120)];
  if (isSensitiveField(item)) parts.push(item.filled ? '(채워짐)' : '(비어 있음)');
  else if (item.value) parts.push(`value=${quote(item.value, 80)}`);
  if (item.checked === true) parts.push('(선택됨)');
  if (item.disabled) parts.push('(누를 수 없음)');
  if (item.href) {
    const label = hrefLabel(item.href, pageUrl);
    if (label) parts.push(`→ ${label}`);
  }
  return parts.join(' ');
}

/**
 * 화면 글 만들기: 제목·주소·스크롤 위치와 요소 줄. maxChars를 넘는 줄은 버리고 안내를 붙인다.
 * 웹에서 온 글이라 통째로 <untrusted_web_content>로 감싼다(보이지 않는 글자 지우기·태그 이스케이프 포함).
 */
export function formatSnapshot(snapshot: PageSnapshot, maxChars: number = SNAPSHOT_MAX_CHARS): string {
  const host = displayUrl(snapshot.url).split('/')[0] || 'web';
  const percent = snapshot.scrollMax > 0 ? Math.min(100, Math.round((snapshot.scrollY / snapshot.scrollMax) * 100)) : 0;
  const head = [`제목: ${quote(snapshot.title, 200)}`, `주소: ${displayUrl(snapshot.url)}`, `스크롤: 위에서 ${percent}%${snapshot.scrollMax > 0 ? '' : ' (한 화면)'}`];
  const lines: string[] = [];
  let used = head.join('\n').length;
  let cut = false;
  for (const item of snapshot.items) {
    const line = itemLine(item, snapshot.url);
    if (used + line.length + 1 > maxChars) {
      cut = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) lines.push('(보이는 요소가 없어요)');
  const notes = [
    cut || snapshot.stoppedAtNodeLimit ? '(글이 많아 여기까지만 넘겼어요. browser_scroll로 아래를 볼 수 있어요)' : null,
  ].filter((n): n is string => n !== null);
  return [`[브라우저 화면] ${host}`, UNTRUSTED_NOTE, wrapUntrusted(`browser:${host}`, [...head, ...lines].join('\n')), ...notes].join('\n');
}
