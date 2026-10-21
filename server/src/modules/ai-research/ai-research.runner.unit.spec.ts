// 심층 조사 일꾼의 찾기 간격과 깨우기 (이슈 #462). 가짜 저장소만 쓴다: DB·LLM 없음
import { AiResearchRunner, DEFAULT_RUNNER_CONFIG } from './ai-research.runner';

function setup(claimable: () => Promise<unknown[]>) {
  const findClaimable = jest.fn(claimable);
  const repository = { findClaimable, claim: jest.fn(async () => false) };
  // 일꾼이 쓰는 것은 저장소의 찾기·맡기뿐이다 (맡을 조사가 없는 경우만 시험)
  const runner = new AiResearchRunner({} as never, repository as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { runner, findClaimable };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('AiResearchRunner 찾기 간격', () => {
  afterEach(() => jest.useRealTimers());

  it('할 일이 없을 때 평소 간격은 30초이고 2초마다 조회하지 않는다', async () => {
    expect(DEFAULT_RUNNER_CONFIG.pollMs).toBe(30_000);
    jest.useFakeTimers();
    const { runner, findClaimable } = setup(async () => []);
    runner.start();
    await flush();
    expect(findClaimable).toHaveBeenCalledTimes(1); // 켤 때 바로 한 번
    await jest.advanceTimersByTimeAsync(29_000);
    expect(findClaimable).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(findClaimable).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it('wake()하면 간격을 기다리지 않고 바로 찾는다', async () => {
    jest.useFakeTimers();
    const { runner, findClaimable } = setup(async () => []);
    runner.start();
    await flush();
    runner.wake();
    await flush();
    expect(findClaimable).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it('찾는 중에 깨우면 끝난 뒤 한 번 더 찾아 직전에 만든 조사를 간격까지 놓치지 않는다', async () => {
    jest.useFakeTimers();
    let release: () => void = () => undefined;
    let first = true;
    const { runner, findClaimable } = setup(() =>
      first
        ? new Promise<unknown[]>((resolve) => {
            first = false;
            release = () => resolve([]);
          })
        : Promise.resolve([]),
    );
    runner.start();
    await flush();
    expect(findClaimable).toHaveBeenCalledTimes(1);
    runner.wake(); // 첫 찾기가 끝나기 전
    await flush();
    expect(findClaimable).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(findClaimable).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it('멈춘 일꾼은 wake()해도 찾지 않는다 (AI_RESEARCH_WORKER=off)', async () => {
    const { runner, findClaimable } = setup(async () => []);
    runner.wake();
    await flush();
    expect(findClaimable).not.toHaveBeenCalled();
  });
});
