// 화면 도우미 펫 엔진(public/pet/pet-engine.js)이 window에 두는 것
interface FantaPetMountOptions {
  characters?: unknown[];
  guide?: unknown;
  defaultCharacter?: string;
  character?: string | null;
  storageKey?: string;
  firstVisit?: boolean;
  /** 사원이 꺼내기 전까지 숨겨 둔다 (숨기거나 꺼낸 선택은 사원별로 기억) */
  startHidden?: boolean;
  hint?: string | false;
  zIndex?: number;
  container?: HTMLElement;
  /** 인사에 쓰는 로그인 사원 */
  user?: { name: string; gradeName: string; departmentName: string; roleCode: string };
  /** 처음 붙을 때의 화면(SCREEN 키) */
  screen?: string | null;
  /** 그 화면을 열 권한이 없으면(잠금 화면) true */
  screenLocked?: boolean;
  /** SCREEN 키 → 주소 */
  screenHrefs?: Record<string, string>;
  /** '이 화면으로 가기'를 누르면 부른다 */
  navigate?: (href: string) => void;
  /** 있으면 대화 창에 AI 연결 ON·OFF가 생기고, ON일 때 질문을 이 함수로 보낸다. 실패하면 Error(이유)를 던진다 */
  askAi?: (question: string, history: { role: 'user' | 'assistant'; content: string }[]) => Promise<{ text: string; sources: string[] }>;
}
interface FantaPetApi {
  mount(options?: FantaPetMountOptions): FantaPetApi;
  destroy(): void;
  say(text: string): Promise<string>;
  show(): Promise<unknown>;
  hide(): Promise<unknown>;
  setCharacter(id: string): Promise<boolean>;
  goTo(targetKey: string): Promise<boolean>;
  explain(targetKey: string): Promise<boolean>;
  startTour(): Promise<boolean>;
  /**
   * 화면이 바뀌면 부른다(SCREEN 키, 모르는 화면이면 null). 처음 온 화면이면 그 화면 안내를 한다.
   * locked면 안쪽 기능 대신 어떤 화면인지만 안내한다.
   */
  setScreen?(screenKey: string | null, locked?: boolean): void;
  /** 그 화면(기본: 지금 화면)의 안내를 다시 한다 */
  startScreenTour?(screenKey?: string): Promise<boolean>;
}
interface Window {
  FantaPet?: FantaPetApi;
}
