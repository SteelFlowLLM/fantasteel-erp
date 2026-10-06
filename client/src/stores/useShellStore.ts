// 셸 화면 상태. AI 패널은 화면을 옮겨도 열린 채로 둔다.
import { create } from 'zustand';
import { applyFontSize, readFontSize, writeFontSize, type FontSize } from '@/lib/fontSize';

interface ShellState {
  aiPanelOpen: boolean;
  toggleAiPanel: () => void;
  closeAiPanel: () => void;
  /** 글자 크기. 서버 렌더링 중에는 'normal', 브라우저에서 hydrateFontSize로 읽는다. */
  fontSize: FontSize;
  hydrateFontSize: () => void;
  setFontSize: (fontSize: FontSize) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  aiPanelOpen: false,
  toggleAiPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),
  closeAiPanel: () => set({ aiPanelOpen: false }),
  fontSize: 'normal',
  hydrateFontSize: () => set({ fontSize: readFontSize() }),
  setFontSize: (fontSize) => {
    writeFontSize(fontSize);
    applyFontSize(fontSize);
    set({ fontSize });
  },
}));
