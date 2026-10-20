import { AI_AGENT_PAUSE_MAX_MS, type AiAgentControlCommand } from '@fantasteel/shared';
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

  constructor(private readonly maxPauseMs = AI_AGENT_PAUSE_MAX_MS) {}

  get paused(): boolean {
    return this.state === 'paused';
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
      resumed();
    }
  }
}

/** 답하는 동안의 문 모음 (서버 메모리). 열쇠는 사원 번호 + 화면이 답마다 만든 열쇠라 남의 답은 멈출 수 없다 */
export class AgentControlRegistry {
  private readonly gates = new Map<string, AgentGate>();

  /** 답을 시작할 때 문을 만든다. 끝나면 돌려준 함수로 지운다 */
  open(owner: number, controlId: string, gate = new AgentGate()): { gate: AgentGate; close: () => void } {
    const key = `${owner}:${controlId}`;
    this.gates.set(key, gate);
    return {
      gate,
      close: () => {
        if (this.gates.get(key) === gate) this.gates.delete(key);
      },
    };
  }

  /** 명령을 보낸다. 그 사원의 답하는 중인 열쇠가 없으면 false */
  command(owner: number, controlId: string, command: AiAgentControlCommand): boolean {
    const gate = this.gates.get(`${owner}:${controlId}`);
    if (!gate) return false;
    gate.command(command);
    return true;
  }

  get size(): number {
    return this.gates.size;
  }
}
