// 철강맨AI 브라우저 사용 (이슈 #373, 문서에 없는 기능)의 화면 도우미: 켜기 설정 저장, 못 켤 때 이유, 화면 사진(browser_frame) 검증.
// 켜기는 사원별이 아니라 이 브라우저에 저장한다 (계정에 저장할 컬럼이 ERD에 없다).
// 화면 사진과 제목은 웹에서 온 데이터라 사진은 base64 글자만, 제목·주소는 글로만 그린다.
import { isAiAssistantBrowserTool, LLM_START_SITE_PATTERN, type AiBrowserCapabilities } from '@fantasteel/shared';

export const AI_BROWSER_KEY = 'fantasteel.ai-browser';

/** 켜기 단추 설명 */
export const AI_BROWSER_TITLE = '켜면 철강맨AI가 웹 검색도 함께 해서 페이지를 열고 눌러 봐요. 링크가 없어도 네이버·위키백과·정부 사이트 등은 바로 열어요. 로그인·결제·입력 제출은 하지 않아요.';
export const AI_BROWSER_OFF_REASON = '서버에서 브라우저 사용이 꺼져 있어요';
export const AI_BROWSER_UNAVAILABLE_HINT = 'AI 연결을 확인하지 못해 지금은 켤 수 없어요';

/** 서버가 상한을 알려 주지 않을 때 보이는 값 (서버 DEFAULT_BROWSER_MAX_ACTIONS와 같다). 서버는 capabilities.browser.maxActions로 알린다 (이슈 #430) */
export const AI_BROWSER_MAX_ACTIONS = 40;

/** 서버가 알려 준 동작 수 상한. 모르면 기본값 */
export const browserMaxActionsOf = (capabilities: { browser?: AiBrowserCapabilities } | undefined): number => capabilities?.browser?.maxActions ?? AI_BROWSER_MAX_ACTIONS;
/** 답 하나에 모아 두는 화면 사진 수 (넘으면 오래된 것부터 버린다) */
export const AI_BROWSER_MAX_FRAMES = 10;
/** 사진 한 장의 base64 글자 수 상한. 서버는 너비 800 이하 JPEG(품질 50쯤)를 보내 보통 이보다 훨씬 작다 */
export const AI_BROWSER_MAX_IMAGE_CHARS = 1_500_000;
const TEXT_MAX = 300;

/** 화면에 두는 화면 사진 한 장. 검증을 통과한 것만 담는다 */
export interface AiBrowserFrame {
  url: string;
  title: string;
  imageBase64: string;
  at: string;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** 서버가 보낸 base64가 글자 규칙에 맞고 너무 크지 않은지 */
export function isSafeBrowserImage(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= AI_BROWSER_MAX_IMAGE_CHARS && value.length % 4 === 0 && BASE64_PATTERN.test(value);
}

/** browser_frame 이벤트를 검증한다. 사진이 규칙에 맞지 않으면 null (화면에 그리지 않는다). 제목·주소는 길이를 줄인다 */
export function toBrowserFrame(event: { url?: unknown; title?: unknown; imageBase64?: unknown; at?: unknown }): AiBrowserFrame | null {
  if (!isSafeBrowserImage(event.imageBase64)) return null;
  const text = (value: unknown): string => (typeof value === 'string' ? value.slice(0, TEXT_MAX) : '');
  return { url: text(event.url), title: text(event.title), imageBase64: event.imageBase64, at: text(event.at) };
}

/** 가장 최근 AI_BROWSER_MAX_FRAMES장만 남기며 한 장을 더한다 */
export function appendBrowserFrame(frames: readonly AiBrowserFrame[], frame: AiBrowserFrame): AiBrowserFrame[] {
  return [...frames, frame].slice(-AI_BROWSER_MAX_FRAMES);
}

export const browserFrameSrc = (frame: AiBrowserFrame): string => `data:image/jpeg;base64,${frame.imageBase64}`;

/** 저장된 글에서 켜기 설정을 읽는다. 깨졌거나 없으면 꺼짐 */
export function parseAiBrowserPreference(raw: string | null): boolean {
  return raw === 'true';
}

export function readAiBrowserPreference(): boolean {
  try {
    return parseAiBrowserPreference(window.localStorage.getItem(AI_BROWSER_KEY));
  } catch {
    return false;
  }
}

export function writeAiBrowserPreference(on: boolean): void {
  try {
    window.localStorage.setItem(AI_BROWSER_KEY, String(on));
  } catch {
    // localStorage를 쓸 수 없는 환경이면 이 화면을 열어 둔 동안만 유지한다
  }
}

/**
 * 브라우저 사용을 켤 수 없는 이유. 켤 수 있거나 아직 모르면(못 읽는 중) null.
 * 연결 정보를 못 읽었으면 연결 안내, 서버가 못 쓴다고 하면 서버가 준 이유(없으면 기본 문구)
 */
export function browserDisabledReason(capabilities: { browser?: AiBrowserCapabilities } | undefined, isError: boolean): string | null {
  if (isError) return AI_BROWSER_UNAVAILABLE_HINT;
  const browser = capabilities?.browser;
  if (!browser || browser.available) return null;
  return browser.reason?.trim() || AI_BROWSER_OFF_REASON;
}

/** 브라우저 도구가 진행 중일 때 줄에 붙는 말 */
export function browserToolRunningText(name: string): string | null {
  switch (name) {
    case 'browser_open':
      return ' … 여는 중';
    case 'browser_snapshot':
      return ' … 읽는 중';
    case 'browser_click':
      return ' … 누르는 중';
    case 'browser_type':
      return ' … 입력 중';
    case 'browser_scroll':
      return ' … 내리는 중';
    case 'browser_back':
      return ' … 돌아가는 중';
    case 'browser_read_file':
      return ' … 문서 읽는 중';
    default:
      return null;
  }
}

/**
 * 지금까지 센 브라우저 동작 수. 서버처럼 화면 읽기(browser_snapshot)와 실패한 동작({"오류":…}로 시작하는 결과)은 세지 않는다 (이슈 #430).
 * 아직 끝나지 않은 동작은 센다
 */
export function browserActionCount(steps: readonly { kind: string; name?: string; result?: { resultPreview: string } | null }[]): number {
  return steps.filter(
    (step) =>
      step.kind === 'tool' &&
      step.name !== undefined &&
      step.name !== 'browser_snapshot' &&
      isAiAssistantBrowserTool(step.name) &&
      !(step.result && step.result.resultPreview.startsWith('{"오류"')),
  ).length;
}

/** 화면 사진에서 눌린 자리를 사진의 가로·세로 비율(0~1)로. 사진 크기가 0이면 null (이슈 #433). 서버가 이 비율을 Chrome 화면 좌표로 바꾼다 */
export function pointFraction(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

/** 접힌 보기 제목: "브라우저로 본 화면 3장" */
export const browserFramesSummary = (count: number): string => `브라우저로 본 화면 ${count}장`;

/**
 * 시작 사이트 입력을 호스트로 바꾼다 (이슈 #430): 주소를 붙여 넣어도 호스트만 남기고 소문자로 바꾼다.
 * 서버 검사(소문자 도메인, 점 하나 이상)에 맞지 않으면 null
 */
export function parseStartSiteInput(raw: string): string | null {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '');
  return LLM_START_SITE_PATTERN.test(host) ? host : null;
}
