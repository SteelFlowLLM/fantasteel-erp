// ERP 화면 조작 (이슈 #382): 화면 글 만들기(작은 가짜 DOM), 번호 장부(지난 번호 거절), 누르지 않는 버튼, 넣지 않는 칸, React가 알아채는 값 넣기.
import { describe, expect, it } from 'vitest';
import { buildScreenSnapshot, clickRefusal, fillRefusal, findOption, nameOf, roleOf, ScreenRefBook, setNativeValue, type AgentNode } from '@/lib/aiScreenAgent';
import { parseAiScreenControlPreference } from '@/lib/aiScreenControl';

/** 화면 글에 필요한 만큼만 흉내 낸 요소 */
class FakeElement implements AgentNode {
  readonly nodeType = 1;
  childNodes: AgentNode[] = [];
  parentNode: AgentNode | null = null;
  value?: string;
  checked?: boolean;
  selected?: boolean;
  readOnly?: boolean;
  constructor(
    readonly tagName: string,
    private readonly attrs: Record<string, string> = {},
  ) {}
  getAttribute(name: string): string | null {
    return name in this.attrs ? this.attrs[name] : null;
  }
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent ?? '').join('');
  }
}

type Child = AgentNode | string;
function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): FakeElement {
  const element = new FakeElement(tag.toUpperCase(), attrs);
  for (const child of children) {
    const node: AgentNode = typeof child === 'string' ? { nodeType: 3, textContent: child, childNodes: [], parentNode: element } : child;
    if (typeof child !== 'string') (child as FakeElement).parentNode = element;
    element.childNodes.push(node);
  }
  return element;
}
const withProps = <T extends FakeElement>(element: T, props: Partial<FakeElement>): T => Object.assign(element, props);

function salesOrderScreen() {
  const quantity = withProps(h('input', { type: 'number' }), { value: '10' });
  const steel = h('select', { id: 'steel' }, withProps(h('option', { value: 'SS275' }, 'SS275'), {}), withProps(h('option', { value: 'SM355A' }, 'SM355A'), { selected: true }));
  return h(
    'div',
    { 'data-ai-capture': '' },
    h('h1', {}, '수주 등록'),
    h('label', {}, h('span', {}, '수량', h('span', { 'aria-hidden': 'true' }, '*')), quantity),
    h('label', { for: 'steel' }, '강종'),
    steel,
    h('input', { type: 'password', 'aria-label': '비밀번호' }),
    h('input', { type: 'hidden', value: 'x' }),
    h('a', { href: '/sales-orders' }, '수주 목록'),
    h('button', { type: 'button' }, '검색'),
    h('button', { type: 'button' }, '저장 "초안"'),
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, '수주번호'), h('th', {}, '고객사'))),
      h('tbody', {}, ...Array.from({ length: 7 }, (_, i) => h('tr', {}, h('td', {}, h('a', { href: `/sales-orders/${i + 1}` }, `SO-00${i + 1}`)), h('td', {}, '포스코')))),
    ),
    h('div', { 'data-ai-skip': '' }, h('button', { type: 'button' }, '철강맨AI 보내기')),
    h('div', { hidden: '' }, '숨은 글'),
  );
}

describe('화면 글 (buildScreenSnapshot)', () => {
  it('제목·입력칸(label·label[for]·값)·고르기 칸·비밀번호(값 감춤)·링크·버튼·표 머리글과 앞 줄을 [r번호]로 적는다', () => {
    const book = new ScreenRefBook();
    const text = buildScreenSnapshot(salesOrderScreen(), book, { title: '수주 등록', path: '/sales-orders/new', labelFor: (id) => (id === 'steel' ? '강종 *' : null) });
    expect(text.split('\n')).toEqual([
      '[화면] 수주 등록 (/sales-orders/new)',
      'heading "수주 등록"',
      '[r1] textbox "수량" value="10"',
      '[r2] combobox "강종" value="SM355A" options="SS275|SM355A"',
      '[r3] password "비밀번호" (비어 있음)',
      '[r4] link "수주 목록" → /sales-orders',
      '[r5] button "검색"',
      '[r6] button "저장 \\"초안\\""',
      'table "수주번호 | 고객사"',
      '  row "SO-001 | 포스코"',
      '[r7] link "SO-001" → /sales-orders/1',
      '  row "SO-002 | 포스코"',
      '[r8] link "SO-002" → /sales-orders/2',
      '  row "SO-003 | 포스코"',
      '[r9] link "SO-003" → /sales-orders/3',
      '  row "SO-004 | 포스코"',
      '[r10] link "SO-004" → /sales-orders/4',
      '  row "SO-005 | 포스코"',
      '[r11] link "SO-005" → /sales-orders/5',
      '  (표에 2줄 더 있어요)',
    ]);
  });

  it('글 길이 상한을 넘으면 거기서 멈추고 알린다', () => {
    const text = buildScreenSnapshot(salesOrderScreen(), new ScreenRefBook(), { maxChars: 120 });
    expect(text.length).toBeLessThan(200);
    expect(text).toContain('(화면 글이 길어 여기까지만 읽었어요)');
  });
});

describe('번호 장부 (지난 화면 글의 번호는 받지 않는다)', () => {
  it('새 화면 글은 번호를 이어서 주고, 이전 범위·없는 번호·틀린 모양은 이유를 돌려준다', () => {
    const book = new ScreenRefBook<string>();
    book.begin();
    book.add('a');
    book.add('b');
    book.begin();
    expect(book.add('c')).toBe('r3');
    expect(book.resolve('r3')).toEqual({ element: 'c' });
    expect(book.resolve('[r3]')).toEqual({ element: 'c' });
    expect(book.resolve('r1')).toEqual({ error: expect.stringContaining('이전 화면 글의 번호') });
    expect(book.resolve('r9')).toEqual({ error: '없는 번호예요: r9' });
    expect(book.resolve('button')).toEqual({ error: expect.stringContaining('번호예요') });
  });
});

describe('누르지 않는 것·넣지 않는 칸', () => {
  it('데이터를 바꾸는 이름, submit 버튼, form 안의 type 없는 버튼, data-ai-block 안은 막고 조회 버튼·링크는 누른다', () => {
    const refused = (node: FakeElement) => clickRefusal(node, nameOf(node));
    expect(refused(h('button', { type: 'button' }, '출고 확정'))).toMatch(/^막았어요/);
    expect(refused(h('button', { type: 'button', 'aria-label': 'Save' }, h('span', {}, '💾')))).toMatch(/^막았어요/);
    expect(refused(h('button', { type: 'submit' }, '검색'))).toContain('제출 버튼');
    expect(refused(h('input', { type: 'submit', value: '검색' }))).toContain('제출 버튼');
    const inForm = h('button', {}, '검색');
    h('form', {}, inForm);
    expect(refused(inForm)).toContain('제출 버튼');
    const guarded = h('button', { type: 'button' }, '다음');
    h('div', { 'data-ai-block': '' }, guarded);
    expect(refused(guarded)).toContain('AI가 누르지 않는 곳');
    expect(refused(h('button', { type: 'button' }, '검색'))).toBeNull();
    expect(refused(h('a', { href: '/sales-orders' }, '수주 목록'))).toBeNull();
  });

  it('되돌리기 어려운 버튼(취소·완료·만들기·해제·사용 안 함·연결 끊기)을 막고, 이름이 "취소"뿐이면 대화상자 안일 때만 누른다 (이슈 #479)', () => {
    const refused = (node: FakeElement) => clickRefusal(node, nameOf(node));
    for (const label of ['출하요청 취소', '완료', '만들기', '해제', '사용 안 함', '연결 끊기', '작업 시작']) expect(refused(h('button', { type: 'button' }, label))).toMatch(/^막았어요/);
    const rowCancel = h('button', { type: 'button' }, '취소');
    h('tr', {}, rowCancel);
    expect(refused(rowCancel)).toContain('대화상자 밖의 취소 버튼');
    const dialogCancel = h('button', { type: 'button' }, '취소');
    h('div', { role: 'dialog' }, h('div', {}, dialogCancel));
    expect(refused(dialogCancel)).toBeNull();
    const modalCancel = h('button', { type: 'button', 'aria-label': 'Cancel' }, '취소');
    h('div', { 'aria-modal': 'true' }, modalCancel);
    expect(refused(modalCancel)).toBeNull();
  });

  it('비밀번호·고르기 칸·읽기 전용 칸에는 넣지 않는다', () => {
    const password = h('input', { type: 'password' });
    expect(fillRefusal(password, roleOf(password))).toMatch(/^막았어요/);
    const select = h('select');
    expect(fillRefusal(select, roleOf(select))).toContain('입력칸이 아니에요');
    const readOnly = withProps(h('input', { type: 'text' }), { readOnly: true });
    expect(fillRefusal(readOnly, roleOf(readOnly))).toBe('읽기 전용 칸이에요');
    const text = h('input', {});
    expect(fillRefusal(text, roleOf(text))).toBeNull();
  });
});

describe('값 넣기 (React가 알아채게)', () => {
  it('요소 자신이 덮어 둔 value가 아니라 원래 setter로 넣고 input → change를 보낸다', () => {
    const calls: string[] = [];
    class NativeInput {
      private stored = '';
      get value() {
        return this.stored;
      }
      set value(next: string) {
        calls.push(`native ${next}`);
        this.stored = next;
      }
    }
    const input = new NativeInput();
    // React는 요소 자체에 value 속성을 덮어 값 바뀜을 추적한다
    Object.defineProperty(input, 'value', { configurable: true, get: () => 'tracked', set: (next: string) => calls.push(`tracker ${next}`) });
    setNativeValue(input, '25', (type) => calls.push(type));
    expect(calls).toEqual(['native 25', 'input', 'change']);
  });

  it('고르기 칸은 보이는 글, 값, 두 글자 이상 일부 순으로 찾는다', () => {
    const options = [withProps(h('option', { value: 'C' }, '코일'), { value: 'C' }), withProps(h('option', { value: 'P' }, '후판'), { value: 'P' })];
    expect(findOption(options, '후판')).toBe(options[1]);
    expect(findOption(options, 'c')).toBe(options[0]);
    expect(findOption(options, '없음')).toBeNull();
  });

  it('켜기 설정은 "true"만 켜짐', () => {
    expect(parseAiScreenControlPreference('true')).toBe(true);
    expect(parseAiScreenControlPreference('1')).toBe(false);
    expect(parseAiScreenControlPreference(null)).toBe(false);
  });
});
