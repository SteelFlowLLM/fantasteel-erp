import { parseHTML } from 'linkedom';
import { tidyText } from './web-text';

/**
 * HTML → 읽을 글 (이슈 #367 보안 검토). 파싱한 뒤에는 HTML 문자열에 정규식을 쓰지 않는다:
 * `<script …>…</script>` 같은 정규식은 악의적인 2MB 페이지에서 몇십 초 CPU를 쓴다(서버 전체가 멈춤).
 * DOM을 스택으로 돌며(재귀 없음 — 깊게 중첩된 페이지에서 스택이 넘치지 않게) 글만 모으고 블록에서 줄을 바꾼다.
 */

/** 글이 아닌 요소: 건너뛴다 */
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'HEAD', 'TITLE', 'META', 'LINK']);
/** 페이지 전체 글을 쓸 때 더 건너뛰는 메뉴·머리말·꼬리말 */
const PAGE_CHROME = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON']);
const BLOCK = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE', 'TABLE', 'UL', 'OL', 'HEADER', 'FOOTER',
  'DD', 'DT', 'DL', 'FIGURE', 'FIGCAPTION', 'MAIN', 'ADDRESS', 'HR', 'CAPTION', 'TBODY', 'THEAD',
]);
const CELL = new Set(['TD', 'TH']);

/** 돌아볼 노드 수와 모을 글 길이 상한. 넘으면 거기서 멈춘다(모델에는 어차피 앞 6000자만 간다) */
const MAX_NODES = 200_000;
const MAX_CHARS = 200_000;

interface DomNode {
  nodeType: number;
  nodeValue?: string | null;
  tagName?: string;
  childNodes?: ArrayLike<DomNode>;
}

const NEWLINE = Symbol('newline');

export function domText(root: unknown, options: { skipPageChrome?: boolean } = {}): string {
  const out: string[] = [];
  let chars = 0;
  let visited = 0;
  const stack: (DomNode | typeof NEWLINE)[] = [root as DomNode];
  while (stack.length && visited < MAX_NODES && chars < MAX_CHARS) {
    const item = stack.pop();
    if (item === undefined) break;
    if (item === NEWLINE) {
      out.push('\n');
      continue;
    }
    visited += 1;
    if (item.nodeType === 3) {
      const value = item.nodeValue ?? '';
      out.push(value);
      chars += value.length;
      continue;
    }
    // 요소(1)·문서(9)·조각(11)만 들어간다. 주석(8) 등은 버린다
    if (item.nodeType !== 1 && item.nodeType !== 9 && item.nodeType !== 11) continue;
    const tag = item.tagName?.toUpperCase() ?? '';
    if (SKIP.has(tag) || (options.skipPageChrome && PAGE_CHROME.has(tag))) continue;
    if (tag === 'BR') {
      out.push('\n');
      continue;
    }
    if (tag === 'LI') out.push('\n- ');
    else if (BLOCK.has(tag)) out.push('\n');
    else if (CELL.has(tag)) out.push(' ');
    if (BLOCK.has(tag)) stack.push(NEWLINE);
    const children = item.childNodes;
    if (children) for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return tidyText(out.join(''));
}

/**
 * 요소 수와 가장 깊은 중첩 (스택으로, 상한에서 멈춤). Readability는 재귀로 돌아서 깊은 문서에서 스택이 넘치고,
 * linkedom에서는 getElementsByTagName('*')가 0을 돌려줘 Readability의 maxElemsToParse가 듣지 않는다. 그래서 먼저 센다.
 */
export function documentShape(root: unknown, stopAtElements: number): { elements: number; depth: number } {
  let elements = 0;
  let depth = 0;
  const stack: [DomNode, number][] = [[root as DomNode, 0]];
  while (stack.length && elements <= stopAtElements) {
    const entry = stack.pop();
    if (!entry) break;
    const [node, level] = entry;
    if (node.nodeType === 1) {
      elements += 1;
      if (level > depth) depth = level;
    }
    const children = node.childNodes;
    if (children) for (let i = children.length - 1; i >= 0; i -= 1) if (children[i].nodeType === 1 || children[i].nodeType === 9) stack.push([children[i], level + 1]);
  }
  return { elements, depth };
}

/** HTML 조각(Readability 본문, 검색 요약) → 글 */
export function htmlToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return domText(document.body);
}
