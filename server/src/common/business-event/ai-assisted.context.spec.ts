import { isInAiAssistedRun, runAsAiAssisted } from './ai-assisted.context';

describe('AI 경유 실행 범위', () => {
  it('밖에서는 꺼져 있고, 안에서는 await 뒤에도 켜져 있다', async () => {
    expect(isInAiAssistedRun()).toBe(false);
    const inside = await runAsAiAssisted(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return isInAiAssistedRun();
    });
    expect(inside).toBe(true);
    expect(isInAiAssistedRun()).toBe(false);
  });

  it('동시에 도는 다른 요청에는 번지지 않는다', async () => {
    const other = new Promise<boolean>((resolve) => setTimeout(() => resolve(isInAiAssistedRun()), 5));
    await runAsAiAssisted(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(await other).toBe(false);
  });
});
