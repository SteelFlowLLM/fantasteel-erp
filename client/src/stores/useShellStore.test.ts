// AI 패널 맥락 (REQ-AST-007): 위젯에서 열면 맥락을 들고 열리고, 상단 버튼으로 열거나 닫으면 맥락을 지운다.
import { beforeEach, describe, expect, it } from 'vitest';
import { useShellStore } from '@/stores/useShellStore';

const context = { label: '강종별 불합격률 · SM355A · 최근 30일', question: 'SM355A 최근 30일 불합격 원인 알려줘' };

beforeEach(() => useShellStore.setState({ aiPanelOpen: false, aiContext: null }));

describe('AI 패널 맥락', () => {
  it('맥락을 들고 열면 패널이 열리고 맥락이 남는다', () => {
    useShellStore.getState().openAiPanel(context);
    expect(useShellStore.getState()).toMatchObject({ aiPanelOpen: true, aiContext: context });
  });

  it('닫으면 맥락을 지운다', () => {
    useShellStore.getState().openAiPanel(context);
    useShellStore.getState().closeAiPanel();
    expect(useShellStore.getState()).toMatchObject({ aiPanelOpen: false, aiContext: null });
  });

  it('상단 버튼(토글)으로 열면 맥락 없이 연다', () => {
    useShellStore.getState().openAiPanel(context);
    useShellStore.getState().closeAiPanel();
    useShellStore.getState().toggleAiPanel();
    expect(useShellStore.getState()).toMatchObject({ aiPanelOpen: true, aiContext: null });
  });
});
