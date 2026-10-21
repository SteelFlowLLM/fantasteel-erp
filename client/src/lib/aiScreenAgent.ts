// 철강맨AI ERP 화면 조작 (이슈 #382, 문서에 없는 기능·시험 중). 서버가 보낸 ui_action을 지금 화면(DOM)에서 실행하고 결과 글을 만든다.
// 데이터를 바꾸는 버튼(저장·등록·확정…·submit·data-ai-block)은 누르지 않고, 비밀번호 칸에는 넣지 않는다. 서버도 같은 낱말로 한 번 더 막는다.
// 화면 글은 [data-ai-capture] 안에서 [data-ai-skip](철강맨AI 패널·조작 배너)을 빼고 만든다.
import { aiScreenBlockedWord, aiScreenPathAllowed, isAiScreenDismissLabel, type AiAssistantStreamEvent, type AiScreenActionResultInput, type AiScreenMapEntry } from '@fantasteel/shared';
import { create } from 'zustand';
import { moveAiCursorTo } from '@/lib/aiCursor';

type UiAction = Extract<AiAssistantStreamEvent, { type: 'ui_action' }>;

/** 화면 글 상한 (결정값): 6,000자, 3,000개 노드 */
export const SCREEN_SNAPSHOT_MAX_CHARS = 6000;
export const SCREEN_SNAPSHOT_MAX_NODES = 3000;
const TABLE_ROWS = 5;
const OPTIONS_MAX = 15;
const TEXT_MAX = 120;
const LABEL_MAX = 60;
const NAVIGATION_WAIT_MS = 5000;
const SETTLE_MS = 700;
const HIGHLIGHT_MS = 1200;

/** 화면 글을 만들 때 쓰는 DOM의 작은 부분. 실제 Element와 시험용 가짜가 같이 맞는다 */
export interface AgentNode {
  nodeType: number;
  textContent: string | null;
  childNodes: ArrayLike<AgentNode>;
  parentNode?: AgentNode | null;
  tagName?: string;
  getAttribute?(name: string): string | null;
}

const ELEMENT = 1;
const TEXT = 3;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO']);
const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'number', 'email', 'tel', 'url', 'date', 'datetime-local', 'month', 'time', 'week']);

const tagOf = (node: AgentNode): string => (node.tagName ?? '').toUpperCase();
const attr = (node: AgentNode, name: string): string | null => node.getAttribute?.(name) ?? null;
const clean = (text: string | null | undefined, max = TEXT_MAX): string => {
  const one = (text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
};
const quote = (text: string): string => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
function prop<T>(node: AgentNode, key: string): T | undefined {
  return (node as unknown as Record<string, T | undefined>)[key];
}

/** 이 요소의 뜻 (button·link·textbox·checkbox·combobox·tab). 누르거나 넣을 수 없으면 null */
export function roleOf(node: AgentNode): string | null {
  const tag = tagOf(node);
  const role = attr(node, 'role');
  if (role === 'tab' || role === 'menuitem' || role === 'option' || role === 'switch' || role === 'checkbox') return role;
  if (role === 'button') return 'button';
  if (tag === 'A' && attr(node, 'href') !== null) return 'link';
  if (tag === 'BUTTON') return 'button';
  if (tag === 'SELECT') return 'combobox';
  if (tag === 'TEXTAREA') return 'textbox';
  if (tag === 'INPUT') {
    const type = (attr(node, 'type') ?? '').toLowerCase();
    if (type === 'hidden' || type === 'file') return null;
    if (type === 'checkbox' || type === 'radio') return type;
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
    if (type === 'password') return 'password';
    return TEXT_INPUT_TYPES.has(type) ? 'textbox' : null;
  }
  return null;
}

const isControl = (node: AgentNode): boolean => ['INPUT', 'SELECT', 'TEXTAREA'].includes(tagOf(node));

/** 필수 표시(*)를 뗀 label 이름 */
const labelName = (text: string | null | undefined): string => clean(text, LABEL_MAX).replace(/\s*\*$/, '');

/** 입력칸을 감싼 label의 이름 (입력칸·고르기 칸의 글은 빼고) */
function wrappingLabelText(node: AgentNode): string {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (tagOf(parent) !== 'LABEL') continue;
    const parts: string[] = [];
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === TEXT || (child.nodeType === ELEMENT && !isControl(child) && !containsControl(child))) parts.push(child.textContent ?? '');
    }
    return labelName(parts.join(' '));
  }
  return '';
}

function containsControl(node: AgentNode): boolean {
  return Array.from(node.childNodes).some((child) => child.nodeType === ELEMENT && (isControl(child) || containsControl(child)));
}

/** 요소의 이름: aria-label → label[for] → 감싼 label → placeholder·title·name → 글 */
export function nameOf(node: AgentNode, labelFor: (id: string) => string | null = () => null): string {
  const aria = clean(attr(node, 'aria-label'), LABEL_MAX);
  if (aria) return aria;
  if (isControl(node)) {
    const id = attr(node, 'id');
    const byFor = id ? labelName(labelFor(id)) : '';
    return byFor || wrappingLabelText(node) || clean(attr(node, 'placeholder') ?? attr(node, 'title') ?? attr(node, 'name'), LABEL_MAX);
  }
  return clean(node.textContent, LABEL_MAX) || clean(attr(node, 'title'), LABEL_MAX);
}

/** 누르면 안 되는 이유 (데이터를 바꾸는 버튼·제출 버튼·data-ai-block). 괜찮으면 null */
export function clickRefusal(node: AgentNode, name: string): string | null {
  for (let at: AgentNode | null | undefined = node; at; at = at.parentNode) {
    if (attr(at, 'data-ai-block') !== null) return `막았어요: '${name}'은(는) AI가 누르지 않는 곳이에요. 사용자가 직접 눌러야 해요`;
  }
  const tag = tagOf(node);
  const type = (attr(node, 'type') ?? '').toLowerCase();
  const insideForm = (() => {
    for (let at = node.parentNode; at; at = at.parentNode) if (tagOf(at) === 'FORM') return true;
    return false;
  })();
  if ((tag === 'INPUT' && type === 'submit') || (tag === 'BUTTON' && (type === 'submit' || (type === '' && insideForm)))) return `막았어요: '${name}'은(는) 제출 버튼이에요. 사용자가 직접 눌러야 해요`;
  // 이름이 "취소" 하나뿐이면 창 닫기일 때만 누른다: 목록 줄의 "취소"는 출하요청 취소처럼 데이터를 바꾼다 (이슈 #479)
  const labels = [name, clean(attr(node, 'aria-label')), clean(node.textContent)].filter((label) => label !== '');
  if (labels.length > 0 && labels.every(isAiScreenDismissLabel)) {
    return insideDialog(node) ? null : `막았어요: '${name}'은(는) 대화상자 밖의 취소 버튼이라 데이터를 바꿀 수 있어요. 사용자가 직접 눌러야 해요`;
  }
  const word = aiScreenBlockedWord(`${name} ${clean(attr(node, 'aria-label'))} ${clean(node.textContent)}`, roleOf(node));
  return word ? `막았어요: '${name}' 버튼은 데이터를 바꿔요(${word}). 사용자가 직접 눌러야 해요` : null;
}

/** 대화상자(창) 안의 요소인지: dialog 태그, role=dialog·alertdialog, aria-modal */
function insideDialog(node: AgentNode): boolean {
  for (let at: AgentNode | null | undefined = node; at; at = at.parentNode) {
    const role = attr(at, 'role');
    if (tagOf(at) === 'DIALOG' || role === 'dialog' || role === 'alertdialog' || attr(at, 'aria-modal') === 'true') return true;
  }
  return false;
}

/** 값을 넣으면 안 되는 이유. 괜찮으면 null */
export function fillRefusal(node: AgentNode, role: string | null): string | null {
  if (role === 'password') return '막았어요: 비밀번호 칸에는 넣지 않아요';
  if (role !== 'textbox') return '입력칸이 아니에요. ui_select·ui_click을 써요';
  if (prop<boolean>(node, 'disabled') || prop<boolean>(node, 'readOnly') || attr(node, 'readonly') !== null) return '읽기 전용 칸이에요';
  return null;
}

/** 한 번의 화면 글에서 준 번호 범위. 이전 화면 글의 번호는 받지 않는다 */
export class ScreenRefBook<T = AgentNode> {
  private next = 1;
  private from = 1;
  private elements = new Map<number, T>();

  begin(): void {
    this.from = this.next;
    this.elements = new Map();
  }

  add(element: T): string {
    const n = this.next++;
    this.elements.set(n, element);
    return `r${n}`;
  }

  /** 번호의 요소. 틀리거나 지난 번호면 이유 */
  resolve(ref: string): { element: T } | { error: string } {
    const n = Number(/^r(\d+)$/.exec(ref.replace(/^\[|\]$/g, ''))?.[1]);
    if (!Number.isInteger(n)) return { error: 'ref는 화면 글의 번호예요 (예: r12)' };
    if (n < this.from) return { error: `${ref}는 이전 화면 글의 번호예요. 가장 최근 결과의 번호를 쓰거나 ui_snapshot으로 다시 읽어요` };
    const element = this.elements.get(n);
    return element === undefined ? { error: `없는 번호예요: ${ref}` } : { element };
  }
}

export interface SnapshotOptions<T extends AgentNode = AgentNode> {
  /** 화면 제목·주소 (첫 줄) */
  title?: string;
  path?: string;
  labelFor?: (id: string) => string | null;
  isVisible?: (node: T) => boolean;
  maxChars?: number;
  maxNodes?: number;
}

/** 화면 글: `[r12] button "검색"`, `[r13] textbox "수량" value="10"`, `[r14] link "수주 목록" → /sales-orders`, 표는 머리글과 앞 줄들 */
export function buildScreenSnapshot<T extends AgentNode>(root: T, book: ScreenRefBook<T>, options: SnapshotOptions<T> = {}): string {
  const maxChars = options.maxChars ?? SCREEN_SNAPSHOT_MAX_CHARS;
  const maxNodes = options.maxNodes ?? SCREEN_SNAPSHOT_MAX_NODES;
  const visible = options.isVisible ?? (() => true);
  book.begin();
  const lines: string[] = [options.title || options.path ? `[화면] ${options.title ?? ''} (${options.path ?? ''})` : '[화면]'];
  let length = lines[0].length;
  let visited = 0;
  let cut = false;
  const push = (line: string) => {
    if (cut) return;
    if (length + line.length + 1 > maxChars) {
      cut = true;
      return;
    }
    lines.push(line);
    length += line.length + 1;
  };

  const elementLine = (node: T, role: string): string => {
    const name = nameOf(node, options.labelFor);
    const ref = book.add(node);
    if (role === 'link') {
      const href = attr(node, 'href') ?? '';
      return `[${ref}] link ${quote(name)}${href.startsWith('/') ? ` → ${href.split('#')[0]}` : ''}`;
    }
    if (role === 'textbox') return `[${ref}] textbox ${quote(name)} value=${quote(clean(String(prop<string>(node, 'value') ?? attr(node, 'value') ?? ''), TEXT_MAX))}`;
    if (role === 'password') return `[${ref}] password ${quote(name)} ${prop<string>(node, 'value') ? '(채워짐)' : '(비어 있음)'}`;
    if (role === 'checkbox' || role === 'radio' || role === 'switch') {
      const checked = prop<boolean>(node, 'checked') ?? attr(node, 'aria-checked') === 'true';
      return `[${ref}] ${role} ${quote(name)} checked=${checked ? 'true' : 'false'}`;
    }
    if (role === 'combobox') {
      const options = Array.from(prop<ArrayLike<AgentNode>>(node, 'options') ?? node.childNodes).filter((option) => tagOf(option) === 'OPTION');
      const selected = options.find((option) => prop<boolean>(option, 'selected')) ?? options[0];
      const names = options.slice(0, OPTIONS_MAX).map((option) => clean(option.textContent, 40));
      return `[${ref}] combobox ${quote(name)} value=${quote(selected ? clean(selected.textContent, 40) : '')} options=${quote(names.join('|') + (options.length > OPTIONS_MAX ? '|…' : ''))}`;
    }
    const disabled = prop<boolean>(node, 'disabled') || attr(node, 'aria-disabled') === 'true';
    return `[${ref}] ${role} ${quote(name)}${disabled ? ' (꺼짐)' : ''}`;
  };

  const cellsText = (row: AgentNode): string =>
    Array.from(row.childNodes)
      .filter((cell) => ['TD', 'TH'].includes(tagOf(cell)))
      .map((cell) => clean(cell.textContent, 30))
      .join(' | ');

  const table = (node: T) => {
    const rows: AgentNode[] = [];
    const collect = (at: AgentNode) => {
      for (const child of Array.from(at.childNodes)) {
        if (tagOf(child) === 'TR') rows.push(child);
        else if (['THEAD', 'TBODY', 'TFOOT'].includes(tagOf(child))) collect(child);
      }
    };
    collect(node);
    const head = rows.findIndex((row) => Array.from(row.childNodes).some((cell) => tagOf(cell) === 'TH'));
    if (head >= 0) push(`table ${quote(cellsText(rows[head]))}`);
    const body = rows.filter((_, index) => index !== head);
    for (const row of body.slice(0, TABLE_ROWS)) {
      push(`  row ${quote(clean(cellsText(row), TEXT_MAX * 2))}`);
      // 줄 안의 링크·버튼(상세 열기 등)은 누를 수 있게 번호를 준다
      walkInteractiveOnly(row as T);
    }
    if (body.length > TABLE_ROWS) push(`  (표에 ${body.length - TABLE_ROWS}줄 더 있어요)`);
  };

  const skip = (node: T): boolean =>
    SKIP_TAGS.has(tagOf(node)) || attr(node, 'data-ai-skip') !== null || attr(node, 'hidden') !== null || attr(node, 'aria-hidden') === 'true' || !visible(node);

  const walkInteractiveOnly = (node: T) => {
    for (const child of Array.from(node.childNodes) as T[]) {
      if (cut || ++visited > maxNodes) return;
      if (child.nodeType !== ELEMENT || skip(child)) continue;
      const role = roleOf(child);
      if (role) push(elementLine(child, role));
      else walkInteractiveOnly(child);
    }
  };

  const walk = (node: T) => {
    for (const child of Array.from(node.childNodes) as T[]) {
      if (cut || ++visited > maxNodes) {
        cut = true;
        return;
      }
      if (child.nodeType === TEXT) {
        const text = clean(child.textContent);
        if (text.length >= 2) push(`text ${quote(text)}`);
        continue;
      }
      if (child.nodeType !== ELEMENT || skip(child)) continue;
      const tag = tagOf(child);
      const role = roleOf(child);
      if (role) {
        push(elementLine(child, role));
        continue;
      }
      if (/^H[1-4]$/.test(tag)) {
        push(`heading ${quote(clean(child.textContent))}`);
        continue;
      }
      if (tag === 'TABLE') {
        table(child);
        continue;
      }
      // label의 글은 입력칸 이름으로 쓰므로 따로 적지 않는다 (label[for]는 건너뛰고, 감싼 label은 안의 입력칸만)
      if (tag === 'LABEL' && attr(child, 'for') !== null) continue;
      if (tag === 'LABEL' && containsControl(child)) {
        walkInteractiveOnly(child);
        continue;
      }
      walk(child);
    }
  };

  walk(root);
  if (cut) lines.push('(화면 글이 길어 여기까지만 읽었어요)');
  return lines.join('\n');
}

/**
 * React가 값 바뀜을 알아채게 값을 넣는다: 요소 자신의 value(React가 덮어 둔 것)가 아니라 원래 setter로 넣고 input·change를 보낸다
 */
export function setNativeValue(element: object, value: string, dispatch: (type: 'input' | 'change') => void): void {
  let setter: ((this: unknown, v: string) => void) | undefined;
  for (let proto: object | null = Object.getPrototypeOf(element); proto && !setter; proto = Object.getPrototypeOf(proto)) {
    setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  }
  if (setter) setter.call(element, value);
  else (element as { value?: string }).value = value;
  dispatch('input');
  dispatch('change');
}

/** 고르기 칸에서 보이는 글이나 값이 맞는 항목 */
export function findOption(options: ArrayLike<AgentNode>, wanted: string): AgentNode | null {
  const target = clean(wanted).toLowerCase();
  const list = Array.from(options);
  return (
    list.find((option) => clean(option.textContent).toLowerCase() === target) ??
    list.find((option) => String(prop<string>(option, 'value') ?? attr(option, 'value') ?? '').toLowerCase() === target) ??
    list.find((option) => clean(option.textContent).toLowerCase().includes(target) && target.length >= 2) ??
    null
  );
}

// ---- 화면에서 실행 (브라우저 전용) ----

/** 화면 조작이 도는 동안 위 배너를 보인다 */
export const useAiScreenControlStore = create<{ running: boolean; setRunning: (running: boolean) => void }>((set) => ({
  running: false,
  setRunning: (running) => set({ running }),
}));

interface AgentHost {
  navigate: (path: string) => void;
  screens: AiScreenMapEntry[];
  title: (pathname: string) => string;
}

let host: AgentHost | null = null;
const book = new ScreenRefBook<HTMLElement>();

/** 셸이 라우터·열 수 있는 화면을 알려 둔다 (AiScreenAgentBridge) */
export function registerScreenAgent(next: AgentHost | null): void {
  host = next;
}

export const currentScreenMap = (): AiScreenMapEntry[] => host?.screens ?? [];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function captureRoot(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-ai-capture]') ?? document.body;
}

function snapshotNow(): string {
  const pathname = window.location.pathname;
  return buildScreenSnapshot<HTMLElement>(captureRoot(), book, {
    title: host?.title(pathname) ?? document.title,
    path: `${pathname}${window.location.search}`,
    labelFor: (id) => document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? null,
    isVisible: (element) => typeof element.getClientRects !== 'function' || element.getClientRects().length > 0,
  });
}

/** 칸을 화면 가운데로 옮기고 테두리를 그린 뒤, 보이는 마우스를 그 칸으로 움직인다 (이슈 #425). 커서가 정확히 가도록 바로 옮긴다 */
async function highlight(element: HTMLElement): Promise<void> {
  element.scrollIntoView({ block: 'center', behavior: 'instant' });
  const before = element.style.outline;
  const offset = element.style.outlineOffset;
  element.style.outline = '3px solid #f97316';
  element.style.outlineOffset = '2px';
  setTimeout(() => {
    element.style.outline = before;
    element.style.outlineOffset = offset;
  }, HIGHLIGHT_MS);
  await moveAiCursorTo(element);
}

function target(ref: string | undefined): HTMLElement | string {
  const found = book.resolve(ref ?? '');
  if ('error' in found) return found.error;
  if (!found.element.isConnected) return `${ref}는 화면에서 사라졌어요. ui_snapshot으로 다시 읽어요`;
  return found.element;
}

const dispatcher = (element: HTMLElement) => (type: 'input' | 'change') => element.dispatchEvent(new Event(type, { bubbles: true }));

/** 서버가 보낸 화면 동작 하나를 실행한다 */
export async function runUiAction(action: UiAction): Promise<AiScreenActionResultInput> {
  try {
    switch (action.tool) {
      case 'ui_snapshot':
        return { ok: true, result: snapshotNow() };
      case 'ui_navigate': {
        const path = action.args.path ?? '';
        if (!host || !aiScreenPathAllowed(path, host.screens)) return { ok: false, error: `열 수 있는 화면이 아니에요: ${path}` };
        const pathname = path.split('?')[0];
        host.navigate(path);
        for (let waited = 0; window.location.pathname !== pathname && waited < NAVIGATION_WAIT_MS; waited += 100) await wait(100);
        await wait(SETTLE_MS);
        return { ok: true, result: snapshotNow() };
      }
      case 'ui_click': {
        const element = target(action.args.ref);
        if (typeof element === 'string') return { ok: false, error: element };
        const name = nameOf(element);
        const refused = clickRefusal(element, name);
        if (refused) return { ok: false, error: refused };
        await highlight(element);
        element.click();
        await wait(SETTLE_MS);
        return { ok: true, result: `'${name}'을(를) 눌렀어요.\n${snapshotNow()}` };
      }
      case 'ui_fill': {
        const element = target(action.args.ref);
        if (typeof element === 'string') return { ok: false, error: element };
        const refused = fillRefusal(element, roleOf(element));
        if (refused) return { ok: false, error: refused };
        await highlight(element);
        element.focus();
        setNativeValue(element, action.args.value ?? '', dispatcher(element));
        element.blur();
        return { ok: true, result: `${action.args.ref} ${quote(nameOf(element))}에 ${quote(action.args.value ?? '')}을(를) 넣었어요. 아직 저장하지 않았어요` };
      }
      case 'ui_select': {
        const element = target(action.args.ref);
        if (typeof element === 'string') return { ok: false, error: element };
        if (!(element instanceof HTMLSelectElement)) return { ok: false, error: '고르기 칸이 아니에요' };
        if (element.disabled) return { ok: false, error: '꺼진 칸이에요' };
        const option = findOption(element.options, action.args.value ?? '') as HTMLOptionElement | null;
        if (!option) return { ok: false, error: `'${action.args.value}' 항목이 없어요` };
        await highlight(element);
        setNativeValue(element, option.value, dispatcher(element));
        return { ok: true, result: `${action.args.ref} ${quote(nameOf(element))}에서 ${quote(clean(option.textContent))}을(를) 골랐어요. 아직 저장하지 않았어요` };
      }
    }
  } catch (error) {
    return { ok: false, error: `화면에서 하지 못했어요: ${error instanceof Error ? error.message : String(error)}` };
  }
}
