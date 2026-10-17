// 브라우저 사용 켜기 저장, 못 켤 때 이유, 화면 사진 검증·개수 제한, 도구 줄 글.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_BROWSER_KEY,
  AI_BROWSER_MAX_FRAMES,
  AI_BROWSER_MAX_IMAGE_CHARS,
  AI_BROWSER_OFF_REASON,
  AI_BROWSER_UNAVAILABLE_HINT,
  appendBrowserFrame,
  browserActionCount,
  browserDisabledReason,
  browserFrameSrc,
  browserFramesSummary,
  browserToolRunningText,
  isSafeBrowserImage,
  parseAiBrowserPreference,
  readAiBrowserPreference,
  toBrowserFrame,
  writeAiBrowserPreference,
} from '@/lib/aiBrowser';
import { AI_ASSISTANT_TOOL_TITLE } from '@fantasteel/shared';

afterEach(() => vi.unstubAllGlobals());

const frame = (n: number) => ({ url: `example.kr/${n}`, title: `제목 ${n}`, imageBase64: 'QUJD', at: '2026-10-17T00:00:00.000Z' });

describe('브라우저 켜기 저장', () => {
  it('저장된 값이 없거나 깨졌으면 꺼짐이다', () => {
    expect(parseAiBrowserPreference(null)).toBe(false);
    expect(parseAiBrowserPreference('on')).toBe(false);
    expect(parseAiBrowserPreference('true')).toBe(true);
  });

  it('localStorage를 못 쓰는 환경에서도 오류 없이 꺼짐으로 동작한다', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('blocked');
      },
    });
    expect(readAiBrowserPreference()).toBe(false);
    expect(() => writeAiBrowserPreference(true)).not.toThrow();
  });

  it('쓴 값을 다시 읽고, 웹 검색과 다른 키에 저장한다', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) } });
    writeAiBrowserPreference(true);
    expect(readAiBrowserPreference()).toBe(true);
    expect(data.get(AI_BROWSER_KEY)).toBe('true');
    expect(AI_BROWSER_KEY).not.toBe('fantasteel.ai-web-search');
    writeAiBrowserPreference(false);
    expect(readAiBrowserPreference()).toBe(false);
  });
});

describe('browserDisabledReason', () => {
  it('서버가 쓸 수 있다고 하거나 아직 모르면 막지 않는다', () => {
    expect(browserDisabledReason(undefined, false)).toBeNull();
    expect(browserDisabledReason({ browser: { available: true } }, false)).toBeNull();
  });

  it('서버가 준 이유를 그대로 보이고, 이유가 없거나 비었으면 기본 문구를 쓴다', () => {
    expect(browserDisabledReason({ browser: { available: false, reason: 'Chrome을 찾지 못했어요' } }, false)).toBe('Chrome을 찾지 못했어요');
    expect(browserDisabledReason({ browser: { available: false } }, false)).toBe(AI_BROWSER_OFF_REASON);
    expect(browserDisabledReason({ browser: { available: false, reason: '  ' } }, false)).toBe(AI_BROWSER_OFF_REASON);
    expect(AI_BROWSER_OFF_REASON).toBe('서버에서 브라우저 사용이 꺼져 있어요');
  });

  it('연결 정보를 못 읽었으면 연결 안내를 보인다', () => {
    expect(browserDisabledReason(undefined, true)).toBe(AI_BROWSER_UNAVAILABLE_HINT);
  });
});

describe('화면 사진 검증', () => {
  it('base64 글자만, 빈 글·길이가 맞지 않는 글·상한을 넘는 글은 받지 않는다', () => {
    expect(isSafeBrowserImage('QUJD')).toBe(true);
    expect(isSafeBrowserImage('QUI=')).toBe(true);
    expect(isSafeBrowserImage('')).toBe(false);
    expect(isSafeBrowserImage('QUJ')).toBe(false);
    expect(isSafeBrowserImage('QU"onerror=')).toBe(false);
    expect(isSafeBrowserImage('data:image/jpeg;base64,QUJD')).toBe(false);
    expect(isSafeBrowserImage('A'.repeat(AI_BROWSER_MAX_IMAGE_CHARS + 4))).toBe(false);
    expect(isSafeBrowserImage(123)).toBe(false);
  });

  it('규칙에 맞는 이벤트만 화면 사진이 되고, 제목·주소는 길이를 줄인다', () => {
    expect(toBrowserFrame({ ...frame(1), imageBase64: '<script>' })).toBeNull();
    expect(toBrowserFrame({ url: 'a.kr', title: '제목', at: 'x' })).toBeNull();
    const long = toBrowserFrame({ ...frame(1), title: '가'.repeat(1000) });
    expect(long?.title.length).toBe(300);
    expect(toBrowserFrame({ ...frame(1), title: 5 })?.title).toBe('');
    expect(browserFrameSrc(frame(1))).toBe('data:image/jpeg;base64,QUJD');
  });
});

describe('화면 사진 목록', () => {
  it('최근 10장만 남기고 오래된 것부터 버린다', () => {
    let frames: ReturnType<typeof frame>[] = [];
    for (let n = 1; n <= 13; n += 1) frames = appendBrowserFrame(frames, frame(n));
    expect(frames).toHaveLength(AI_BROWSER_MAX_FRAMES);
    expect(frames[0]?.url).toBe('example.kr/4');
    expect(frames.at(-1)?.url).toBe('example.kr/13');
  });

  it('받은 목록을 바꾸지 않는다', () => {
    const before = [frame(1)];
    appendBrowserFrame(before, frame(2));
    expect(before).toHaveLength(1);
  });
});

describe('도구 줄', () => {
  it('브라우저 도구마다 진행 글이 있고 다른 도구는 null이다', () => {
    expect(browserToolRunningText('browser_open')).toBe(' … 여는 중');
    expect(browserToolRunningText('browser_click')).toBe(' … 누르는 중');
    expect(browserToolRunningText('browser_type')).toBe(' … 입력 중');
    expect(browserToolRunningText('web_search')).toBeNull();
    expect(AI_ASSISTANT_TOOL_TITLE['browser_open']).toBe('브라우저 열기');
  });

  it('브라우저 도구 호출 수만 센다', () => {
    const steps = [{ kind: 'thinking' }, { kind: 'tool', name: 'browser_open' }, { kind: 'tool', name: 'web_search' }, { kind: 'tool', name: 'browser_click' }];
    expect(browserActionCount(steps)).toBe(2);
    expect(browserFramesSummary(3)).toBe('브라우저로 본 화면 3장');
  });
});
