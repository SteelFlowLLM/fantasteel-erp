// 셸 화면 상태. AI 패널은 화면을 옮겨도 열린 채로 둔다.
import { create } from 'zustand';
import type { ResearchChipRef } from '@/lib/aiResearchChart';
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
  /** '이 보고서로 묻기'로 붙인 심층 조사. 다음 질문에 researchRunId로 보낸다 (이슈 #384). ×로 지울 때까지 남는다 */
  aiResearchRef: ResearchChipRef | null;
  setAiResearchRef: (ref: ResearchChipRef | null) => void;
  /** 보고서를 붙여 패널을 연다 */
  askAboutResearch: (ref: ResearchChipRef) => void;
  /** 크게 펼치기 (REQ-AST-001): 본문 전체 너비로 대화를 본다. 닫으면 되돌린다 */
  aiPanelExpanded: boolean;
  toggleAiPanelExpanded: () => void;
  toggleAiPanel: () => void;
  openAiPanel: (context: AiContext) => void;
  closeAiPanel: () => void;
  /** 보던 맥락은 그대로 두고 패널만 연다 (철강맨 부르기, 이슈 #457) */
  showAiPanel: () => void;
  /** 글자 크기. 서버 렌더링 중에는 'normal', 브라우저에서 hydrateFontSize로 읽는다. */
  fontSize: FontSize;
  hydrateFontSize: () => void;
  setFontSize: (fontSize: FontSize) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  aiPanelOpen: false,
  aiContext: null,
  aiPanelExpanded: false,
  aiResearchRef: null,
  setAiResearchRef: (aiResearchRef) => set({ aiResearchRef }),
  askAboutResearch: (aiResearchRef) => set({ aiPanelOpen: true, aiContext: null, aiResearchRef }),
  toggleAiPanelExpanded: () => set((state) => ({ aiPanelExpanded: !state.aiPanelExpanded })),
  toggleAiPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen, aiContext: null, aiPanelExpanded: false })),
  openAiPanel: (context) => set({ aiPanelOpen: true, aiContext: context }),
  closeAiPanel: () => set({ aiPanelOpen: false, aiContext: null, aiPanelExpanded: false }),
  showAiPanel: () => set({ aiPanelOpen: true }),
  fontSize: 'normal',
  hydrateFontSize: () => set({ fontSize: readFontSize() }),
  setFontSize: (fontSize) => {
    writeFontSize(fontSize);
    applyFontSize(fontSize);
    set({ fontSize });
  },
}));
