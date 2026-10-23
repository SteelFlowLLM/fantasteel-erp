// 접힌 '생각 과정' 요약 문구.
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { agentControlText, AiLiveView, aiStepsSummary, shownBrowserFrame, toolTitleOf } from '@/features/shell/AiAnswerTrace';
import type { AiBrowserFrame } from '@/lib/aiBrowser';
import { emptyAiChatLive, type AiAgentControlState } from '@/stores/useAiChatStore';

describe('aiStepsSummary', () => {
  it('생각한 초와 조회한 횟수를 보인다', () => {
    expect(
      aiStepsSummary([
        { kind: 'thinking', text: '음', startedAt: 1000, endedAt: 9000 },
        { kind: 'tool', id: 'a', name: 'get_inventory', arguments: '{}', result: null },
        { kind: 'note', text: '조회할게요' },
        { kind: 'tool', id: 'b', name: 'trace_lot', arguments: '{}', result: null },
      ]),
    ).toBe('생각 과정 보기 · 생각 8초 · 조회 2번');
  });

  it('생각 시간을 모르면 생략하고, 조회가 없으면 조회를 생략한다', () => {
    expect(aiStepsSummary([{ kind: 'thinking', text: '음', startedAt: 0, endedAt: 0 }])).toBe('생각 과정 보기');
    expect(aiStepsSummary([{ kind: 'thinking', text: '음', startedAt: 0, endedAt: 400 }])).toBe('생각 과정 보기 · 생각 1초');
  });
});

describe('toolTitleOf', () => {
  it('한글 제목이 있으면 그것을, 모르는 도구는 이름 그대로 보인다', () => {
    expect(toolTitleOf('get_inventory')).toBe('재고 조회');
    expect(toolTitleOf('new_tool')).toBe('new_tool');
  });
});

describe('shownBrowserFrame (이슈 #425)', () => {
  const frame = (url: string, at: string, title = ''): AiBrowserFrame => ({ url, title, imageBase64: 'QUJD', at });

  it('아무 화면도 없으면 null이다', () => {
    expect(shownBrowserFrame([], null)).toBeNull();
  });

  it('실시간 화면이 없으면 가장 최근 동작 사진을 보인다', () => {
    const old = frame('a.kr', '2026-10-20T00:00:00.000Z', '옛');
    const latest = frame('b.kr', '2026-10-20T00:00:05.000Z', '새');
    expect(shownBrowserFrame([old, latest], null)).toEqual({ frame: latest, live: false });
  });

  it('동작 사진이 없고 실시간 화면만 있으면 그것을 (제목 없이) 보인다', () => {
    const live = frame('a.kr', '2026-10-20T00:00:00.000Z');
    expect(shownBrowserFrame([], live)).toEqual({ frame: live, live: true });
  });

  it('실시간 화면이 마지막 동작 사진과 같은 때(>=)나 더 새것이면 실시간 화면이 이긴다', () => {
    const shot = frame('a.kr', '2026-10-20T00:00:05.000Z', '시세');
    expect(shownBrowserFrame([shot], frame('a.kr', '2026-10-20T00:00:05.000Z'))?.live).toBe(true);
    expect(shownBrowserFrame([shot], frame('a.kr', '2026-10-20T00:00:06.000Z'))?.live).toBe(true);
  });

  it('동작 사진이 더 새것이면 동작 사진을 보인다 (옛 실시간 사진이 새 동작 결과를 덮지 않게)', () => {
    const shot = frame('a.kr', '2026-10-20T00:00:05.000Z', '시세');
    expect(shownBrowserFrame([shot], frame('a.kr', '2026-10-20T00:00:04.999Z'))).toEqual({ frame: shot, live: false });
  });

  it('주소가 같을 때만 동작 사진의 제목을 빌리고, 주소가 다르면 제목을 비운다', () => {
    const shot = frame('a.kr/x', '2026-10-20T00:00:00.000Z', '시세');
    expect(shownBrowserFrame([shot], frame('a.kr/x', '2026-10-20T00:00:01.000Z'))?.frame.title).toBe('시세');
    expect(shownBrowserFrame([shot], frame('a.kr/y', '2026-10-20T00:00:01.000Z'))?.frame.title).toBe('');
  });
});

describe('agentControlText (이슈 #425)', () => {
  const control = (patch: Partial<AiAgentControlState>): AiAgentControlState => ({ id: 'id', requested: false, pausedBefore: null, ...patch });

  it('평소·멈추기를 누른 직후·멈춘 뒤 안내가 다르다', () => {
    expect(agentControlText(control({}))).toBe('브라우저·화면 조작 중');
    expect(agentControlText(control({ requested: true }))).toBe('다음 브라우저·화면 동작 앞에서 멈춰요…');
    expect(agentControlText(control({ pausedBefore: 'browser_click' }))).toBe('멈췄어요 · 다음 동작: 브라우저 누르기');
  });

  it('멈춘 뒤에는 멈추기 요청이 남아 있어도 멈춘 안내가 먼저고, 모르는 도구는 이름 그대로 보인다', () => {
    expect(agentControlText(control({ requested: true, pausedBefore: 'ui_click' }))).toBe('멈췄어요 · 다음 동작: 화면 누르기');
    expect(agentControlText(control({ pausedBefore: 'new_tool' }))).toBe('멈췄어요 · 다음 동작: new_tool');
  });
});

/** 화면 없이 요소 나무를 훑는다: 함수 컴포넌트는 불러서 펼친다 (훅을 쓰는 컴포넌트는 펼치지 않고 건너뛴다) */
function flatten(node: ReactNode, out: ReactElement<{ children?: ReactNode; [key: string]: unknown }>[] = []): ReactElement<{ children?: ReactNode; [key: string]: unknown }>[] {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out);
    return out;
  }
  if (!isValidElement<{ children?: ReactNode; [key: string]: unknown }>(node)) return out;
  out.push(node);
  if (typeof node.type === 'function') {
    try {
      flatten((node.type as (props: unknown) => ReactNode)(node.props), out);
    } catch {
      // 훅을 쓰는 컴포넌트는 렌더러 없이 부를 수 없다
    }
  } else {
    flatten(node.props.children, out);
  }
  return out;
}
const textOf = (node: ReactNode): string => (Array.isArray(node) ? node.map(textOf).join('') : isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '');

describe('AiLiveView 멈춤 줄 (이슈 #425)', () => {
  const liveWith = (control: Partial<AiAgentControlState> | null) => ({ ...emptyAiChatLive(null, control ? 'id' : null), control: control ? { id: 'id', requested: false, pausedBefore: null, ...control } : null });
  const buttonsOf = (element: ReactElement) => flatten(element).filter((e) => e.type === 'button');
  const groupOf = (element: ReactElement) => flatten(element).find((e) => e.props.role === 'group');

  it('멈춤 줄은 접근 가능한 이름이 붙은 그룹이다 (HTML)', () => {
    const html = renderToStaticMarkup(createElement(AiLiveView, { live: liveWith({}), onControl: () => undefined }));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="브라우저·화면 조작 멈춤"');
    expect(html).toContain('브라우저·화면 조작 중');
    expect(html).toContain('일시정지');
    expect(html).not.toContain('한 단계');
  });

  it('조작 중에는 일시정지 단추만 있고, 누르면 pause를 보낸다', () => {
    const onControl = vi.fn();
    const view = createElement(AiLiveView, { live: liveWith({}), onControl });
    expect(groupOf(view)?.props['aria-label']).toBe('브라우저·화면 조작 멈춤');
    const buttons = buttonsOf(view);
    expect(buttons.map((b) => textOf(b.props.children))).toEqual(['일시정지']);
    (buttons[0].props.onClick as () => void)();
    expect(onControl).toHaveBeenCalledWith('pause');
  });

  it('멈추기를 눌러 기다리는 중에는 계속 단추만 있고(누른 멈추기를 취소), 누르면 resume을 보낸다', () => {
    const onControl = vi.fn();
    const buttons = buttonsOf(createElement(AiLiveView, { live: liveWith({ requested: true }), onControl }));
    expect(buttons.map((b) => textOf(b.props.children))).toEqual(['계속']);
    (buttons[0].props.onClick as () => void)();
    expect(onControl).toHaveBeenCalledWith('resume');
  });

  it('서버가 멈췄으면 한 단계와 계속 단추가 있고 각각 step·resume을 보낸다', () => {
    const onControl = vi.fn();
    const view = createElement(AiLiveView, { live: liveWith({ pausedBefore: 'browser_open' }), onControl });
    const buttons = buttonsOf(view);
    expect(buttons.map((b) => textOf(b.props.children))).toEqual(['한 단계', '계속']);
    (buttons[0].props.onClick as () => void)();
    (buttons[1].props.onClick as () => void)();
    expect(onControl.mock.calls).toEqual([['step'], ['resume']]);
    expect(renderToStaticMarkup(view)).toContain('멈췄어요 · 다음 동작: 브라우저 열기');
  });

  it('멈출 수 없는 답(control 없음)이나 onControl이 없으면 멈춤 줄이 없다', () => {
    expect(renderToStaticMarkup(createElement(AiLiveView, { live: liveWith(null), onControl: () => undefined }))).not.toContain('브라우저·화면 조작 멈춤');
    expect(renderToStaticMarkup(createElement(AiLiveView, { live: liveWith({}) }))).not.toContain('브라우저·화면 조작 멈춤');
  });

  it('실시간 화면만 와도 "답을 만들고 있어요"가 아니라 브라우저 화면을 실시간 표시와 함께 보인다', () => {
    const live = { ...liveWith({}), liveFrame: { url: 'example.kr/a', title: '', imageBase64: 'QUJD', at: '2026-10-20T00:00:00.000Z' } };
    const html = renderToStaticMarkup(createElement(AiLiveView, { live, onControl: () => undefined }));
    expect(html).not.toContain('답을 만들고 있어요');
    expect(html).toContain('aria-label="브라우저 화면"');
    expect(html).toContain('실시간');
    expect(html).toContain('data:image/jpeg;base64,QUJD');
  });
});

describe('멈춘 동안 직접 조작 (이슈 #433)', () => {
  const withFrame = (control: Partial<AiAgentControlState> | null) => ({
    ...emptyAiChatLive(null, control ? 'id' : null),
    control: control ? { id: 'id', requested: false, pausedBefore: null, ...control } : null,
    liveFrame: { url: 'example.kr/a', title: '', imageBase64: 'QUJD', at: '2026-10-20T00:00:00.000Z' },
  });

  it('서버가 멈춰 기다리는 동안에만 화면이 눌리고 직접 조작 줄이 보인다', () => {
    const onInput = vi.fn();
    const paused = renderToStaticMarkup(createElement(AiLiveView, { live: withFrame({ pausedBefore: 'browser_click' }), onControl: () => undefined, onInput }));
    expect(paused).toContain('aria-label="직접 조작"');
    expect(paused).toContain('aria-label="브라우저 화면 (눌러서 그 자리를 직접 누르기)"');
    expect(paused).toContain('aria-label="화면에 넣을 글"');
    expect(paused).toContain('입력한 글은 저장하지 않아요');
    expect(paused).toContain('화면에 보이는 내용은 철강맨AI가 읽을 수 있어요');

    // 멈추기만 눌러 아직 기다리는 중이 아니거나, 조작 중이거나, onInput이 없으면 보기만 한다
    for (const html of [
      renderToStaticMarkup(createElement(AiLiveView, { live: withFrame({ requested: true }), onControl: () => undefined, onInput })),
      renderToStaticMarkup(createElement(AiLiveView, { live: withFrame({}), onControl: () => undefined, onInput })),
      renderToStaticMarkup(createElement(AiLiveView, { live: withFrame({ pausedBefore: 'browser_click' }), onControl: () => undefined })),
    ]) {
      expect(html).not.toContain('직접 조작');
      expect(html).not.toContain('눌러서 그 자리를');
      expect(html).toContain('data:image/jpeg;base64,QUJD');
    }
  });

  it('화면을 누르면 사진의 가로·세로 비율로 click을 보낸다', () => {
    const onInput = vi.fn();
    const view = createElement(AiLiveView, { live: withFrame({ pausedBefore: 'browser_click' }), onControl: () => undefined, onInput });
    const screen = flatten(view).find((e) => e.type === 'button' && String(e.props['aria-label']).startsWith('브라우저 화면'));
    const onClick = screen?.props.onClick as (event: unknown) => void;
    onClick({ clientX: 300, clientY: 150, currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 500 }) } });
    expect(onInput).toHaveBeenCalledWith({ kind: 'click', x: 0.25, y: 0.2 });
  });
});
