import { isInAiAssistedRun, isInVoiceApprovedRun, runAsAiAssisted, runAsVoiceApproved, withVoiceApprovedReason } from './ai-assisted.context';

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

describe('말로 승인 실행 범위 (이슈 #457)', () => {
  it('밖에서는 사유를 그대로 두고, 안에서는 사유 끝에 표시를 붙인다 (사유 코드는 앞에 그대로)', async () => {
    expect(withVoiceApprovedReason(null)).toBeNull();
    expect(withVoiceApprovedReason('STOCK_FIRST: 재고 우선')).toBe('STOCK_FIRST: 재고 우선');
    const inside = await runAsVoiceApproved(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [isInVoiceApprovedRun(), withVoiceApprovedReason(null), withVoiceApprovedReason('STOCK_FIRST: 재고 우선')];
    });
    expect(inside).toEqual([true, '철강맨 말로 승인', 'STOCK_FIRST: 재고 우선 · 철강맨 말로 승인']);
    expect(isInVoiceApprovedRun()).toBe(false);
  });

  it('AI 경유 범위와 겹쳐도 서로 따로 켜지고, 다른 요청에는 번지지 않는다', async () => {
    const other = new Promise<boolean>((resolve) => setTimeout(() => resolve(isInVoiceApprovedRun()), 5));
    const both = await runAsVoiceApproved(() => runAsAiAssisted(async () => [isInVoiceApprovedRun(), isInAiAssistedRun()]));
    expect(both).toEqual([true, true]);
    expect(await runAsAiAssisted(async () => isInVoiceApprovedRun())).toBe(false);
    expect(await other).toBe(false);
  });
});
