// 철강맨 부르기 (이슈 #457)의 화면 상태. 마이크·소리 처리는 features/shell/SteelmanWake.tsx가 하고, 패널이 할 일은 panelRequest로 넘긴다
// (질문은 패널에서 보낸 것과 같게 켜 둔 칩 그대로 보내야 해서 패널이 보낸다).
import { create } from 'zustand';
import type { VoiceApprovalPending } from '@/lib/steelmanWake';
import { readSteelmanWakePreference, readVoiceApprovalPreference, writeSteelmanWakePreference, writeVoiceApprovalPreference } from '@/lib/steelmanWakePreference';

/** off: 꺼짐, starting: 마이크 여는 중, listening: 듣는 중, paused: 탭이 숨겨져 쉼, error: 마이크를 못 엶 */
export type SteelmanWakeStatus = 'off' | 'starting' | 'listening' | 'paused' | 'error';

type PanelRequestInput = { kind: 'ask'; question: string } | { kind: 'screenControl'; on: boolean };
export type SteelmanPanelRequest = PanelRequestInput & { id: number };

interface SteelmanWakeState {
  /** 화면을 그린 뒤 설정을 읽었는지 (서버에서 먼저 그릴 때와 어긋나지 않게) */
  loaded: boolean;
  enabled: boolean;
  voiceApproval: boolean;
  status: SteelmanWakeStatus;
  /** 지금 말소리를 잡는 중 */
  hearing: boolean;
  /** 마이크·음성 서버 문제. 스위치 옆에 보인다 */
  problem: string | null;
  /** "철강맨"만 불러 다음 말을 기다리는 중: 대답과 마감 */
  called: { reply: string; until: number } | null;
  /** 잠깐 보일 안내 (멈췄어요, 실행할 카드가 없어요 등) */
  notice: { id: number; text: string } | null;
  approval: VoiceApprovalPending | null;
  panelRequest: SteelmanPanelRequest | null;
  /** 말로 물어 답을 기다리는 질문 id (답이 끝나면 읽어 줄 자리로 넘긴다) */
  voiceQuestionId: string | null;
  load: () => void;
  setEnabled: (on: boolean) => void;
  setVoiceApproval: (on: boolean) => void;
  setStatus: (status: SteelmanWakeStatus, problem?: string | null) => void;
  setHearing: (hearing: boolean) => void;
  setProblem: (problem: string | null) => void;
  setCalled: (called: SteelmanWakeState['called']) => void;
  notify: (text: string) => void;
  clearNotice: (id: number) => void;
  setApproval: (approval: VoiceApprovalPending | null) => void;
  requestPanel: (request: PanelRequestInput) => void;
  takePanelRequest: (id: number) => void;
  setVoiceQuestionId: (id: string | null) => void;
}

let nextId = 1;

export const useSteelmanWakeStore = create<SteelmanWakeState>((set) => ({
  loaded: false,
  enabled: false,
  voiceApproval: false,
  status: 'off',
  hearing: false,
  problem: null,
  called: null,
  notice: null,
  approval: null,
  panelRequest: null,
  voiceQuestionId: null,
  load: () => set({ loaded: true, enabled: readSteelmanWakePreference(), voiceApproval: readVoiceApprovalPreference() }),
  setEnabled: (on) => {
    writeSteelmanWakePreference(on);
    set(on ? { enabled: true, problem: null } : { enabled: false, status: 'off', hearing: false, problem: null, called: null, approval: null });
  },
  setVoiceApproval: (on) => {
    writeVoiceApprovalPreference(on);
    set(on ? { voiceApproval: true } : { voiceApproval: false, approval: null });
  },
  setStatus: (status, problem) => set(problem === undefined ? { status } : { status, problem }),
  setHearing: (hearing) => set({ hearing }),
  setProblem: (problem) => set({ problem }),
  setCalled: (called) => set({ called }),
  notify: (text) => set({ notice: { id: nextId++, text } }),
  clearNotice: (id) => set((state) => (state.notice?.id === id ? { notice: null } : {})),
  setApproval: (approval) => set({ approval }),
  requestPanel: (request) => set({ panelRequest: { ...request, id: nextId++ } }),
  takePanelRequest: (id) => set((state) => (state.panelRequest?.id === id ? { panelRequest: null } : {})),
  setVoiceQuestionId: (voiceQuestionId) => set({ voiceQuestionId }),
}));
