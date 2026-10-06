// 셸 화면 상태. AI 패널은 화면을 옮겨도 열린 채로 둔다.
import { create } from 'zustand';
import { applyFontSize, readFontSize, writeFontSize, type FontSize } from '@/lib/fontSize';

/** AI 패널에 질문과 함께 보낼 화면 맥락 (REQ-AST-007). 예: 불합격률 위젯의 강종·기간 */
export interface AiContext {
  /** '보고 있는 화면' 옆에 붙는 설명 */
  label: string;
  /** 이 맥락으로 먼저 보여 줄 추천 질문 */
  question: string;
}

interface ShellState {
  aiPanelOpen: boolean;
  /** 위젯 등에서 맥락을 들고 열었을 때만 있다. 상단 버튼으로 열거나 닫으면 지운다 */
  aiContext: AiContext | null;
  toggleAiPanel: () => void;
  openAiPanel: (context: AiContext) => void;
  closeAiPanel: () => void;
  /** 글자 크기. 서버 렌더링 중에는 'normal', 브라우저에서 hydrateFontSize로 읽는다. */
  fontSize: FontSize;
  hydrateFontSize: () => void;
  setFontSize: (fontSize: FontSize) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  aiPanelOpen: false,
  aiContext: null,
  toggleAiPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen, aiContext: null })),
  openAiPanel: (context) => set({ aiPanelOpen: true, aiContext: context }),
  closeAiPanel: () => set({ aiPanelOpen: false, aiContext: null }),
  fontSize: 'normal',
  hydrateFontSize: () => set({ fontSize: readFontSize() }),
  setFontSize: (fontSize) => {
    writeFontSize(fontSize);
    applyFontSize(fontSize);
    set({ fontSize });
  },
}));
