/**
 * 브라우저 페이지 안에서 도는 함수 (이슈 #373). Playwright가 함수 글을 페이지로 보내 실행하므로
 * 바깥 변수·import를 쓰지 않는다(이 파일의 타입만 쓴다). 한 함수로 두 일을 한다:
 * - snapshot: 보이는 요소를 문서 순서로 모으고 누를 수 있는 요소에 번호 속성을 붙인다
 * - describe: 누르기·입력 직전에 그 요소를 다시 읽는다(번호를 붙인 뒤 페이지가 바꿨을 수 있어 규칙은 이 값으로 본다)
 * 비밀번호 칸의 값은 페이지 밖으로 꺼내지 않고 채워졌는지만 돌려준다.
 */

/** 누르기·입력 규칙에 쓰는 요소 정보 */
export interface ElementInfo {
  tag: string;
  role: string;
  name: string;
  text: string;
  /** 비밀번호 칸은 늘 '' */
  value: string;
  filled: boolean;
  /** input의 type (소문자). input이 아니면 '' */
  type: string;
  href: string | null;
  autocomplete: string;
  /** name·id·placeholder·aria-label·label 글 */
  hints: string;
  inForm: boolean;
  formMethod: string | null;
  isSubmitter: boolean;
  submitterMethod: string | null;
  download: boolean;
  editable: boolean;
  disabled: boolean;
  checked: boolean | null;
}

/** 화면 글 한 줄. ref가 null이면 글(text·heading) */
export interface SnapshotItem extends Pick<ElementInfo, 'role' | 'name' | 'value' | 'filled' | 'href' | 'type' | 'autocomplete' | 'hints' | 'checked' | 'disabled'> {
  ref: number | null;
}

export interface PageSnapshot {
  title: string;
  url: string;
  items: SnapshotItem[];
  nodesWalked: number;
  stoppedAtNodeLimit: boolean;
  scrollY: number;
  scrollMax: number;
  /** 다음에 붙일 번호 */
  next: number;
}

/*
 * 서버 tsconfig에는 DOM 타입(lib dom)이 없어서(서버 코드 전체에 document·window가 생기지 않게) 이 함수가 쓰는 만큼만 적는다.
 * 실행할 때는 페이지의 진짜 DOM이다.
 */
export interface DomNode {
  nodeType: number;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
}
export interface DomElement extends DomNode {
  tagName: string;
  id: string;
  ownerDocument: DomDocument;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): { top: number; bottom: number; width: number; height: number };
  contains(other: DomElement): boolean;
  closest(selector: string): DomElement | null;
  querySelector(selector: string): DomElement | null;
  innerText?: string;
  isContentEditable?: boolean;
  type?: string;
  value?: string;
  placeholder?: string;
  alt?: string;
  href?: string;
  disabled?: boolean;
  checked?: boolean;
  form?: DomElement | null;
  labels?: ArrayLike<DomElement> | null;
  selectedOptions?: ArrayLike<DomElement>;
}
interface DomWindow {
  scrollY: number;
  innerHeight: number;
  location: { href: string };
  getComputedStyle(el: DomElement): { visibility: string; opacity: string };
}
interface DomDocument {
  title: string;
  defaultView: DomWindow | null;
  body: DomElement | null;
  documentElement: DomElement & { scrollHeight: number };
  scrollingElement: (DomElement & { scrollHeight: number }) | null;
  getElementById(id: string): DomElement | null;
  createTreeWalker(root: DomElement, whatToShow: number, filter: { acceptNode(node: DomElement): number }): { currentNode: DomElement; nextNode(): DomElement | null };
}

export type PageScriptArg = { op: 'describe' } | { op: 'snapshot'; attr: string; docStart: number; next: number; maxNodes: number; maxItems: number };

export function pageScript(root: DomElement, arg: PageScriptArg): ElementInfo | PageSnapshot {
  const doc = root.ownerDocument;
  const win = doc.defaultView as DomWindow;
  const clean = (value: string | null | undefined, max: number) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const ROLES = ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'switch', 'combobox', 'textbox', 'searchbox', 'slider'];
  const NOT_TEXT = ['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'hidden', 'range', 'color'];

  const inputType = (el: DomElement) => (el.tagName.toLowerCase() === 'input' ? (el.type || 'text').toLowerCase() : '');
  const roleOf = (el: DomElement): string | null => {
    const tag = el.tagName.toLowerCase();
    const explicit = (el.getAttribute('role') ?? '').trim().split(/\s+/)[0] ?? '';
    if (explicit && ROLES.includes(explicit)) return explicit;
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = inputType(el);
      if (type === 'hidden') return null;
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button';
      if (type === 'checkbox' || type === 'radio' || type === 'file' || type === 'password') return type;
      if (type === 'search') return 'searchbox';
      if (type === 'range') return 'slider';
      return 'textbox';
    }
    if (el.hasAttribute('contenteditable') && el.isContentEditable) return 'textbox';
    return null;
  };
  const labelText = (el: DomElement): string => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const text = by
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent ?? '')
        .join(' ');
      if (text.trim()) return text;
    }
    const labels = el.labels;
    if (labels && labels.length) {
      const text = Array.from(labels)
        .map((label) => label.textContent ?? '')
        .join(' ');
      if (text.trim()) return text;
    }
    return '';
  };
  const nameOf = (el: DomElement): string => {
    const label = labelText(el);
    if (label.trim()) return clean(label, 120);
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = inputType(el);
      if (type === 'button' || type === 'submit' || type === 'reset') return clean(el.value || (type === 'submit' ? 'Submit' : ''), 120);
      if (type === 'image') return clean(el.alt, 120);
      return clean(el.placeholder || el.getAttribute('title'), 120);
    }
    if (tag === 'textarea') return clean(el.placeholder || el.getAttribute('title'), 120);
    const text = el.innerText ?? el.textContent ?? '';
    if (text.trim()) return clean(text, 120);
    const img = el.querySelector('img[alt]');
    if (img) return clean(img.getAttribute('alt'), 120);
    return clean(el.getAttribute('title'), 120);
  };
  const describe = (el: DomElement): ElementInfo => {
    const tag = el.tagName.toLowerCase();
    const type = inputType(el);
    const isField = tag === 'input' || tag === 'button' || tag === 'textarea' || tag === 'select';
    const form = isField ? (el.form ?? null) : el.closest('form');
    const isSubmitter = (tag === 'button' && (el.type || 'submit') === 'submit') || type === 'submit' || type === 'image';
    const editable = tag === 'textarea' || (tag === 'input' && !NOT_TEXT.includes(type)) || el.isContentEditable === true;
    const rawValue = tag === 'input' || tag === 'textarea' ? (el.value ?? '') : '';
    const value = type === 'password' ? '' : tag === 'select' ? (el.selectedOptions?.[0]?.textContent ?? '') : rawValue;
    const hints = [el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), labelText(el)].filter((h) => h).join(' ');
    return {
      tag,
      role: roleOf(el) ?? tag,
      name: nameOf(el),
      text: clean(el.innerText ?? el.textContent, 200),
      value: clean(value, 200),
      filled: rawValue.length > 0,
      type,
      href: tag === 'a' ? el.href || null : null,
      autocomplete: (el.getAttribute('autocomplete') ?? '').toLowerCase(),
      hints: clean(hints, 300),
      inForm: form !== null,
      formMethod: form ? form.getAttribute('method') : null,
      isSubmitter,
      submitterMethod: isSubmitter ? el.getAttribute('formmethod') : null,
      download: tag === 'a' && el.hasAttribute('download'),
      editable,
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      checked: type === 'checkbox' || type === 'radio' ? el.checked === true : null,
    };
  };

  if (arg.op === 'describe') return describe(root);

  const top = win.scrollY;
  const viewport = win.innerHeight;
  // 지금 화면과 그 아래 한 화면까지
  const bottom = top + viewport * 2;
  const visible = (el: DomElement) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom + top < top || rect.top + top > bottom) return false;
    const style = win.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0';
  };
  const SKIP = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS'];
  const start = doc.body ?? doc.documentElement;
  // 1 = NodeFilter.SHOW_ELEMENT · FILTER_ACCEPT, 2 = FILTER_REJECT(그 아래도 건너뜀)
  const walker = doc.createTreeWalker(start, 1, { acceptNode: (node) => (SKIP.includes(node.tagName.toUpperCase()) ? 2 : 1) });
  const items: SnapshotItem[] = [];
  let next = arg.next;
  let walked = 0;
  let stopped = false;
  let lastInteractive: DomElement | null = null;
  for (let node: DomElement | null = walker.currentNode; node; node = walker.nextNode()) {
    if (++walked > arg.maxNodes) {
      stopped = true;
      break;
    }
    if (items.length >= arg.maxItems) break;
    const el = node;
    // 버튼·링크 안의 글은 그 요소의 이름으로 이미 넣었다
    if (lastInteractive && lastInteractive !== el && lastInteractive.contains(el)) continue;
    const role = roleOf(el);
    if (role) {
      lastInteractive = el;
      if (!visible(el)) continue;
      const existing = Number(el.getAttribute(arg.attr));
      let ref: number;
      if (Number.isInteger(existing) && existing >= arg.docStart && existing < arg.next) ref = existing;
      else {
        ref = next;
        next += 1;
        el.setAttribute(arg.attr, String(ref));
      }
      const info = describe(el);
      items.push({ ref, role, name: info.name, value: info.value, filled: info.filled, href: info.href, type: info.type, autocomplete: info.autocomplete, hints: info.hints, checked: info.checked, disabled: info.disabled });
      continue;
    }
    let own = '';
    for (const child of Array.from(el.childNodes)) if (child.nodeType === 3) own += child.textContent ?? '';
    own = clean(own, 200);
    if (own.length < 2 || !visible(el)) continue;
    items.push({ ref: null, role: /^H[1-6]$/.test(el.tagName.toUpperCase()) ? 'heading' : 'text', name: own, value: '', filled: false, href: null, type: '', autocomplete: '', hints: '', checked: null, disabled: false });
  }
  const scrollMax = Math.max(0, (doc.scrollingElement ?? doc.documentElement).scrollHeight - viewport);
  return { title: clean(doc.title, 200), url: win.location.href, items, nodesWalked: Math.min(walked, arg.maxNodes), stoppedAtNodeLimit: stopped, scrollY: top, scrollMax, next };
}
