// 셸 화면 상태. AI 패널은 화면을 옮겨도 열린 채로 둔다.
import { create } from 'zustand';

interface ShellState {
  aiPanelOpen: boolean;
  toggleAiPanel: () => void;
  closeAiPanel: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  aiPanelOpen: false,
  toggleAiPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),
  closeAiPanel: () => set({ aiPanelOpen: false }),
}));
