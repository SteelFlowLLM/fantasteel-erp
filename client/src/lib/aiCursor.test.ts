// 철강맨AI 보이는 마우스 (이슈 #425): 가운데 계산, 만들어지는 요소의 속성, 움직임 줄이기, 숨기기.
// 테스트 환경이 node라 요소는 필요한 만큼만 흉내 낸 가짜를 쓴다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeNode {
  id = '';
  style: Record<string, string> = {};
  innerHTML = '';
  isConnected = false;
  children: FakeNode[] = [];
  private readonly attrs = new Map<string, string>();
  animate = vi.fn();
  constructor(
    readonly tag: string,
    private readonly rect = { left: 0, top: 0, width: 0, height: 0 },
  ) {}
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }
  appendChild(node: FakeNode) {
    node.isConnected = true;
    this.children.push(node);
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

const VIEWPORT = { innerWidth: 1000, innerHeight: 800 };
let body: FakeNode;
let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  reduced = false;
  body = new FakeNode('body');
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeNode(tag), body });
  vi.stubGlobal('window', { ...VIEWPORT, matchMedia: () => ({ matches: reduced }) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const load = () => import('@/lib/aiCursor');
const target = (rect: { left: number; top: number; width: number; height: number }) => new FakeNode('button', rect) as unknown as HTMLElement;
/** 커서가 다 갈 때까지 시계를 돌린다 */
async function moveTo(element: HTMLElement, ripple?: boolean) {
  const { moveAiCursorTo, AI_CURSOR_MOVE_MS } = await load();
  const moving = moveAiCursorTo(element, ripple);
  await vi.advanceTimersByTimeAsync(AI_CURSOR_MOVE_MS);
  await moving;
}
const layerOf = () => body.children.find((c) => c.id === 'fantasteel-ai-cursor');

describe('cursorTarget', () => {
  it('요소 가운데를 반올림해 돌려준다', async () => {
    const { cursorTarget } = await load();
    expect(cursorTarget({ left: 100, top: 50, width: 80, height: 31 }, { width: 1000, height: 800 })).toEqual({ x: 140, y: 66 });
  });

  it('화면 밖이면 가장자리로 붙인다', async () => {
    const { cursorTarget } = await load();
    const viewport = { width: 1000, height: 800 };
    expect(cursorTarget({ left: -300, top: -200, width: 100, height: 100 }, viewport)).toEqual({ x: 0, y: 0 });
    expect(cursorTarget({ left: 2000, top: 1500, width: 100, height: 100 }, viewport)).toEqual({ x: 1000, y: 800 });
    expect(cursorTarget({ left: 990, top: 790, width: 100, height: 100 }, viewport)).toEqual({ x: 1000, y: 800 });
  });
});

describe('moveAiCursorTo', () => {
  it('#fantasteel-ai-cursor를 body에 한 번 만들고 화면 글에서 빼는 속성(data-ai-skip)·aria-hidden·마우스 이벤트 없음을 단다', async () => {
    await moveTo(target({ left: 100, top: 100, width: 40, height: 20 }));
    await moveTo(target({ left: 300, top: 300, width: 40, height: 20 }));
    const layers = body.children.filter((c) => c.id === 'fantasteel-ai-cursor');
    expect(layers).toHaveLength(1);
    const root = layers[0];
    expect(root.hasAttribute('data-ai-skip')).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.style.cssText).toContain('pointer-events:none');
    expect(root.style.cssText).toContain('position:fixed');
    expect(root.style.cssText).toContain('z-index:2147483647');
  });

  it('커서는 요소 가운데로 움직이고, 두 번째부터는 지난 자리에서 출발한다', async () => {
    await moveTo(target({ left: 100, top: 100, width: 40, height: 20 }));
    const cursor = layerOf()?.children[1] as FakeNode;
    expect(cursor.style.transform).toBe('translate(120px, 110px)');
    expect(cursor.style.opacity).toBe('1');
    // 두 번째 이동: 출발 자리(transform)를 지난 자리로 먼저 놓고 도착 자리로 옮긴다
    const starts: string[] = [];
    Object.defineProperty(cursor.style, 'transform', {
      configurable: true,
      get: () => starts.at(-1) ?? '',
      set: (value: string) => void starts.push(value),
    });
    await moveTo(target({ left: 300, top: 400, width: 100, height: 50 }));
    expect(starts).toEqual(['translate(120px, 110px)', 'translate(350px, 425px)']);
  });

  it('첫 이동은 화면 가운데에서 출발한다', async () => {
    const starts: string[] = [];
    const { moveAiCursorTo, AI_CURSOR_MOVE_MS } = await load();
    const original = document.createElement.bind(document);
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        const node = original(tag) as unknown as FakeNode;
        Object.defineProperty(node.style, 'transform', { configurable: true, get: () => starts.at(-1) ?? '', set: (value: string) => void starts.push(value) });
        return node;
      },
      body,
    });
    const moving = moveAiCursorTo(target({ left: 0, top: 0, width: 10, height: 10 }));
    await vi.advanceTimersByTimeAsync(AI_CURSOR_MOVE_MS);
    await moving;
    expect(starts[0]).toBe('translate(500px, 400px)');
  });

  it('다 갈 때까지(AI_CURSOR_MOVE_MS) 기다린다', async () => {
    const { moveAiCursorTo, AI_CURSOR_MOVE_MS } = await load();
    let done = false;
    const moving = moveAiCursorTo(target({ left: 10, top: 10, width: 10, height: 10 })).then(() => void (done = true));
    await vi.advanceTimersByTimeAsync(AI_CURSOR_MOVE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await moving;
    expect(done).toBe(true);
  });

  it('도착하면 물결(ripple)을 그리고, ripple=false면 그리지 않는다', async () => {
    await moveTo(target({ left: 100, top: 100, width: 40, height: 20 }));
    const ring = layerOf()?.children[0] as FakeNode;
    expect(ring.animate).toHaveBeenCalledTimes(1);
    expect(ring.style.left).toBe('120px');
    expect(ring.style.top).toBe('110px');

    await moveTo(target({ left: 200, top: 200, width: 40, height: 20 }), false);
    expect(ring.animate).toHaveBeenCalledTimes(1);
  });

  it('움직임 줄이기 설정이면 기다리지 않고 바로 그 자리에 두며 물결도 그리지 않는다', async () => {
    reduced = true;
    const { moveAiCursorTo } = await load();
    // 시계를 돌리지 않아도 끝나야 한다
    await moveAiCursorTo(target({ left: 100, top: 100, width: 40, height: 20 }));
    const cursor = layerOf()?.children[1] as FakeNode;
    expect(cursor.style.transform).toBe('translate(120px, 110px)');
    expect(cursor.style.transition).toContain('transform 0ms');
    expect((layerOf()?.children[0] as FakeNode).animate).not.toHaveBeenCalled();
  });

  it('마지막 동작 뒤 AI_CURSOR_HIDE_MS가 지나면 숨기고, 그 전에 새 동작이 오면 숨기기를 미룬다', async () => {
    const { AI_CURSOR_HIDE_MS } = await load();
    await moveTo(target({ left: 100, top: 100, width: 40, height: 20 }));
    const cursor = layerOf()?.children[1] as FakeNode;
    await vi.advanceTimersByTimeAsync(AI_CURSOR_HIDE_MS - 100);
    expect(cursor.style.opacity).toBe('1');

    await moveTo(target({ left: 200, top: 200, width: 40, height: 20 }));
    // 처음 숨기기 시각이 지나도 새 동작이 미뤘으니 아직 보인다
    await vi.advanceTimersByTimeAsync(300);
    expect(cursor.style.opacity).toBe('1');
    await vi.advanceTimersByTimeAsync(AI_CURSOR_HIDE_MS);
    expect(cursor.style.opacity).toBe('0');
  });

  it('요소가 문서에서 떨어졌으면 층을 다시 만든다', async () => {
    await moveTo(target({ left: 100, top: 100, width: 40, height: 20 }));
    const first = layerOf();
    if (first) first.isConnected = false;
    await moveTo(target({ left: 100, top: 100, width: 40, height: 20 }));
    expect(body.children.filter((c) => c.id === 'fantasteel-ai-cursor')).toHaveLength(2);
  });

  it('그리지 못해도(요소 위치를 못 읽음) 오류 없이 끝난다', async () => {
    const { moveAiCursorTo } = await load();
    const broken = { getBoundingClientRect: () => { throw new Error('분리된 요소'); } } as unknown as HTMLElement;
    await expect(moveAiCursorTo(broken)).resolves.toBeUndefined();
    expect(layerOf()).toBeUndefined();
  });
});
