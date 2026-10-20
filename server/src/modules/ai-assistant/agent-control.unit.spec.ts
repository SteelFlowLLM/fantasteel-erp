import { AI_AGENT_PAUSE_MAX_MS } from '@fantasteel/shared';
import { LlmAbortedError } from '../llm/llm.client';
import { AgentControlRegistry, AgentGate, type AgentGateResult } from './agent-control';

/** 비동기로 멈춘 beforeAction이 아직 끝나지 않았는지 보려고, 마이크로태스크를 몇 번 흘려보낸다 */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

/** onWait가 불린 횟수와 풀린(release) 횟수를 센다 */
const waitProbe = () => {
  const probe = { waits: 0, releases: 0 };
  const onWait = () => {
    probe.waits += 1;
    return () => {
      probe.releases += 1;
    };
  };
  return { probe, onWait };
};

/** 끝났는지 확인하면서 기다릴 수 있게 결과를 묶는다 */
const track = (promise: Promise<AgentGateResult>) => {
  const state: { done: boolean; value: AgentGateResult | null } = { done: false, value: null };
  void promise.then((value) => {
    state.done = true;
    state.value = value;
  });
  return state;
};

describe('AgentGate (이슈 #425)', () => {
  it('멈추지 않았으면 기다리지 않고 바로 go이고 onWait도 부르지 않는다', async () => {
    const gate = new AgentGate();
    const { probe, onWait } = waitProbe();
    await expect(gate.beforeAction(undefined, onWait)).resolves.toBe('go');
    await expect(gate.beforeAction(undefined, onWait)).resolves.toBe('go');
    expect(probe).toEqual({ waits: 0, releases: 0 });
    expect(gate.paused).toBe(false);
  });

  it('멈추면 다음 동작 앞에서 기다리며 onWait를 한 번 부르고, 계속하면 go와 함께 풀림 함수를 부른다', async () => {
    const gate = new AgentGate();
    const { probe, onWait } = waitProbe();
    gate.command('pause');
    expect(gate.paused).toBe(true);

    const waiting = track(gate.beforeAction(undefined, onWait));
    await flush();
    expect(waiting.done).toBe(false);
    expect(probe).toEqual({ waits: 1, releases: 0 });

    gate.command('resume');
    await flush();
    expect(waiting.value).toBe('go');
    expect(probe).toEqual({ waits: 1, releases: 1 });
    // 계속한 뒤에는 다시 막지 않는다
    await expect(gate.beforeAction(undefined, onWait)).resolves.toBe('go');
    expect(probe.waits).toBe(1);
  });

  it('한 단계(step)는 기다리던 동작 하나만 보내고, 그다음 동작 앞에서 다시 기다린다', async () => {
    const gate = new AgentGate();
    const { probe, onWait } = waitProbe();
    gate.command('pause');

    const first = track(gate.beforeAction(undefined, onWait));
    await flush();
    gate.command('step');
    await flush();
    expect(first.value).toBe('go');

    const second = track(gate.beforeAction(undefined, onWait));
    await flush();
    expect(second.done).toBe(false);
    expect(gate.paused).toBe(true);
    expect(probe).toEqual({ waits: 2, releases: 1 });

    gate.command('resume');
    await flush();
    expect(second.value).toBe('go');
    expect(probe).toEqual({ waits: 2, releases: 2 });
  });

  it('멈춘 적 없이 step만 눌러도 다음 동작 하나는 지나가고 그다음부터 멈춘다', async () => {
    const gate = new AgentGate();
    const { probe, onWait } = waitProbe();
    gate.command('step');

    await expect(gate.beforeAction(undefined, onWait)).resolves.toBe('go');
    expect(probe.waits).toBe(0);

    const next = track(gate.beforeAction(undefined, onWait));
    await flush();
    expect(next.done).toBe(false);
    expect(probe.waits).toBe(1);
    gate.command('resume');
    await flush();
    expect(next.value).toBe('go');
  });

  it(`멈춘 채 maxPauseMs가 지나면 timeout이고 풀림 함수도 부르며, 그 뒤 동작은 기다리지 않고 timeout이다`, async () => {
    const gate = new AgentGate(20);
    const { probe, onWait } = waitProbe();
    gate.command('pause');

    await expect(gate.beforeAction(undefined, onWait)).resolves.toBe('timeout');
    expect(probe).toEqual({ waits: 1, releases: 1 });

    // 이미 그만둔 답이라 이어 가라는 명령도 먹지 않는다
    gate.command('resume');
    gate.command('step');
    expect(gate.paused).toBe(false);
    await expect(gate.beforeAction(undefined, onWait)).resolves.toBe('timeout');
    await expect(gate.beforeAction(undefined, onWait)).resolves.toBe('timeout');
    expect(probe.waits).toBe(1);
  });

  it('기본 상한은 AI_AGENT_PAUSE_MAX_MS(10분)다', async () => {
    jest.useFakeTimers();
    try {
      const gate = new AgentGate();
      const { onWait } = waitProbe();
      gate.command('pause');
      const waiting = track(gate.beforeAction(undefined, onWait));
      await flush();

      jest.advanceTimersByTime(AI_AGENT_PAUSE_MAX_MS - 1);
      await flush();
      expect(waiting.done).toBe(false);

      jest.advanceTimersByTime(1);
      await flush();
      expect(waiting.value).toBe('timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('기다리는 중 답을 멈추면(abort) LlmAbortedError로 끝나고 풀림 함수는 그래도 부른다', async () => {
    const gate = new AgentGate();
    const { probe, onWait } = waitProbe();
    const abort = new AbortController();
    gate.command('pause');

    const waiting = gate.beforeAction(abort.signal, onWait);
    await flush();
    abort.abort();
    await expect(waiting).rejects.toBeInstanceOf(LlmAbortedError);
    expect(probe).toEqual({ waits: 1, releases: 1 });
  });

  it('이미 멈춘 신호로 멈춘 문 앞에 서면 기다리기 시작하지 않고 바로 LlmAbortedError다', async () => {
    const gate = new AgentGate();
    const { probe, onWait } = waitProbe();
    const abort = new AbortController();
    abort.abort();
    gate.command('pause');
    await expect(gate.beforeAction(abort.signal, onWait)).rejects.toBeInstanceOf(LlmAbortedError);
    expect(probe.waits).toBe(0);
  });

  it('신호가 이미 멈췄어도 문이 열려 있으면(running) 동작은 막지 않는다 (멈춤 확인은 부르는 쪽이 한다)', async () => {
    const gate = new AgentGate();
    const abort = new AbortController();
    abort.abort();
    await expect(gate.beforeAction(abort.signal, waitProbe().onWait)).resolves.toBe('go');
  });
});

describe('AgentControlRegistry (이슈 #425)', () => {
  const ID = '3f2b8c1e-5d4a-4b7e-9a10-2c6d8e0f1a23';

  it('연 문에 명령을 보내고, 열려 있지 않은 열쇠는 false다', () => {
    const registry = new AgentControlRegistry();
    expect(registry.command(1, ID, 'pause')).toBe(false);

    const { gate } = registry.open(1, ID);
    expect(registry.size).toBe(1);
    expect(registry.command(1, ID, 'pause')).toBe(true);
    expect(gate.paused).toBe(true);
    expect(registry.command(1, ID, 'resume')).toBe(true);
    expect(gate.paused).toBe(false);
  });

  it('열쇠는 사원 번호와 묶여 있어 다른 사원은 남의 답을 멈출 수 없다', () => {
    const registry = new AgentControlRegistry();
    const { gate } = registry.open(1, ID);
    expect(registry.command(2, ID, 'pause')).toBe(false);
    expect(gate.paused).toBe(false);
    expect(registry.command(1, '00000000-0000-4000-8000-000000000000', 'pause')).toBe(false);
  });

  it('close()를 부르면 문이 사라져 명령이 false가 된다', () => {
    const registry = new AgentControlRegistry();
    const { close } = registry.open(1, ID);
    close();
    expect(registry.size).toBe(0);
    expect(registry.command(1, ID, 'pause')).toBe(false);
  });

  it('같은 열쇠로 새 문을 열었으면 옛 문의 close()가 새 문을 지우지 않는다', () => {
    const registry = new AgentControlRegistry();
    const old = registry.open(1, ID);
    const fresh = registry.open(1, ID);
    old.close();
    expect(registry.size).toBe(1);
    expect(registry.command(1, ID, 'pause')).toBe(true);
    expect(fresh.gate.paused).toBe(true);
    expect(old.gate.paused).toBe(false);
    fresh.close();
    expect(registry.size).toBe(0);
  });
});
