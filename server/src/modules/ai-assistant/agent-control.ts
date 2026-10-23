import { AI_AGENT_NOTES_MAX, AI_AGENT_PAUSE_MAX_MS, type AiAgentControlCommand, type AiAgentInput } from '@fantasteel/shared';
import { LlmAbortedError } from '../llm/llm.client';

/** 멈춘 동작 앞에서 기다린 결과: go = 해도 된다, timeout = 너무 오래 멈춰 이 답은 브라우저·화면 조작을 그만둔다 */
export type AgentGateResult = 'go' | 'timeout';

/**
 * 한 답의 브라우저·화면 동작 문 (이슈 #425). 사용자가 멈추면 다음 동작 앞에서 기다리고,
 * 한 단계(step)면 하나만 지나가게 한 뒤 다시 닫고, 계속(resume)이면 연다. 이미 시작한 동작은 끊지 않는다
 */
export class AgentGate {
  private state: 'running' | 'paused' | 'stepping' | 'stopped' = 'running';
  private wake: (() => void) | null = null;
  private isWaiting = false;

  constructor(private readonly maxPauseMs = AI_AGENT_PAUSE_MAX_MS) {}

  get paused(): boolean {
    return this.state === 'paused';
  }

  /** 동작 앞에서 실제로 기다리는 중인지. 사람이 직접 조작할 수 있는 때다 (이슈 #433). 멈추기만 눌렀고 하던 동작이 아직 끝나지 않았으면 false */
  get waiting(): boolean {
    return this.isWaiting;
  }

  /** 한 단계면 이번 동작 하나만 지나가고 다음 동작 앞에서 다시 멈춘다 */
  private closeAfterStep() {
    if (this.state === 'stepping') this.state = 'paused';
  }

  command(command: AiAgentControlCommand): void {
    if (this.state === 'stopped') return;
    if (command === 'pause') this.state = 'paused';
    else this.state = command === 'step' ? 'stepping' : 'running';
    if (command !== 'pause') this.wake?.();
  }

  /**
   * 동작 앞에서 부른다. 멈춰 있으면 풀릴 때까지 기다리며, 기다리기 시작할 때 onWait를 부르고 그 돌려준 함수를 다시 갈 때 부른다.
   * 답을 멈추면(signal) LlmAbortedError
   */
  async beforeAction(signal: AbortSignal | undefined, onWait: () => () => void): Promise<AgentGateResult> {
    if (this.state === 'stopped') return 'timeout';
    if (this.state === 'running') return 'go';
    if (this.state === 'stepping') {
      this.closeAfterStep();
      return 'go';
    }
    if (signal?.aborted) throw new LlmAbortedError();
    let resumed: () => void = () => undefined;
    this.isWaiting = true;
    try {
      const woke = await new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(() => done(false), this.maxPauseMs);
        timer.unref();
        const onAbort = () => {
          clearTimeout(timer);
          this.wake = null;
          reject(new LlmAbortedError());
        };
        const done = (value: boolean) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          this.wake = null;
          resolve(value);
        };
        this.wake = () => done(true);
        signal?.addEventListener('abort', onAbort, { once: true });
        // 깨우는 함수를 단 뒤에 알린다: 알리는 중에 바로 계속을 보내도 놓치지 않게
        resumed = onWait();
      });
      if (!woke) {
        this.state = 'stopped';
        return 'timeout';
      }
      this.closeAfterStep();
      return 'go';
    } finally {
      this.isWaiting = false;
      resumed();
    }
  }
}

/**
 * 답하는 동안 사용자가 덧붙인 말 (이슈 #430). 서비스가 다음 모델 호출 앞에서 꺼내 간다.
 * 질문과 같은 사용자의 말이라 따로 거르지 않고, 개수·길이만 묶는다
 */
export class AgentNotes {
  private queue: string[] = [];
  private accepted = 0;

  /** 쌓는다. 한 답에 받을 수 있는 수를 넘으면 false */
  add(text: string): boolean {
    if (this.accepted >= AI_AGENT_NOTES_MAX) return false;
    this.accepted += 1;
    this.queue.push(text);
    return true;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** 쌓인 말을 오래된 것부터 꺼낸다 */
  drain(): string[] {
    const notes = this.queue;
    this.queue = [];
    return notes;
  }
}

/**
 * 사람이 보낸 조작을 서버 Chrome에 넣은 결과 (이슈 #433): blocked = 열 수 없는 주소로 가서 탭을 비웠다,
 * reverted = 막은 이동이라 이전 페이지로 돌아왔다, busy = 아직 넣지 못한 조작이 너무 많다, closed = 탭이 이미 닫혔다
 */
export type HumanInputOutcome = 'ok' | 'blocked' | 'reverted' | 'busy' | 'closed';
export type HumanInputHandler = (input: AiAgentInput) => Promise<HumanInputOutcome>;

/** 한 답의 문과 덧붙인 말, 사람이 직접 조작하는 길(브라우저를 쓰는 답만) */
export interface AgentControl {
  gate: AgentGate;
  notes: AgentNotes;
  human: HumanInputHandler | null;
}

/** 답하는 동안의 문 모음 (서버 메모리). 열쇠는 사원 번호 + 화면이 답마다 만든 열쇠라 남의 답은 멈출 수 없다 */
export class AgentControlRegistry {
  private readonly controls = new Map<string, AgentControl>();

  /** 답을 시작할 때 문을 만든다. 끝나면 돌려준 함수로 지운다 */
  open(owner: number, controlId: string, gate = new AgentGate()): Omit<AgentControl, 'human'> & { close: () => void; setHuman: (handler: HumanInputHandler | null) => void } {
    const key = `${owner}:${controlId}`;
    const control: AgentControl = { gate, notes: new AgentNotes(), human: null };
    this.controls.set(key, control);
    return {
      gate: control.gate,
      notes: control.notes,
      setHuman: (handler) => {
        control.human = handler;
      },
      close: () => {
        if (this.controls.get(key) === control) this.controls.delete(key);
      },
    };
  }

  /** 명령을 보낸다. 그 사원의 답하는 중인 열쇠가 없으면 false */
  command(owner: number, controlId: string, command: AiAgentControlCommand): boolean {
    const control = this.controls.get(`${owner}:${controlId}`);
    if (!control) return false;
    control.gate.command(command);
    return true;
  }

  /** 말을 덧붙인다. 답하는 중인 열쇠가 없으면 'none', 한 답에 받는 수를 넘으면 'full' */
  addNote(owner: number, controlId: string, text: string): 'ok' | 'none' | 'full' {
    const control = this.controls.get(`${owner}:${controlId}`);
    if (!control) return 'none';
    return control.notes.add(text) ? 'ok' : 'full';
  }

  /**
   * 멈춰 기다리는 동안 사람이 보낸 조작을 브라우저에 넣는다 (이슈 #433). 답하는 중인 열쇠가 없으면 'none',
   * 브라우저를 쓰는 답이 아니면 'no_browser', 동작 앞에서 멈춰 기다리는 중이 아니면 'not_paused'.
   * 입력한 글은 이 함수도, 부르는 쪽도 저장하거나 기록하지 않는다
   */
  async humanInput(owner: number, controlId: string, input: AiAgentInput): Promise<'none' | 'no_browser' | 'not_paused' | HumanInputOutcome> {
    const control = this.controls.get(`${owner}:${controlId}`);
    if (!control) return 'none';
    if (!control.human) return 'no_browser';
    if (!control.gate.waiting) return 'not_paused';
    return control.human(input);
  }

  get size(): number {
    return this.controls.size;
  }
}
