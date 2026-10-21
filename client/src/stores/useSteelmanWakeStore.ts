// 철강맨 부르기 (이슈 #457)의 화면 상태. 마이크·소리 처리는 features/shell/SteelmanWake.tsx가 하고, 패널이 할 일은 panelRequest로 넘긴다
// (질문은 패널에서 보낸 것과 같게 켜 둔 칩 그대로 보내야 해서 패널이 보낸다).
import { create } from 'zustand';
import type { VoiceApprovalPending } from '@/lib/steelmanWake';
import { WAKE_ACTIVITY_MS, type WakeActivity, type WakeSensitivity } from '@/lib/steelmanWakeDisplay';
import { readSteelmanWakePreference, writeSteelmanWakePreference } from '@/lib/steelmanWakePreference';

/** off: 꺼짐, starting: 마이크 여는 중, listening: 듣는 중, paused: 탭이 숨겨져 쉼, error: 마이크를 못 엶 */
export type SteelmanWakeStatus = 'off' | 'starting' | 'listening' | 'paused' | 'error';

type PanelRequestInput = { kind: 'ask'; question: string } | { kind: 'screenControl'; on: boolean };
export type SteelmanPanelRequest = PanelRequestInput & { id: number };

interface SteelmanWakeState {
  /** 설정을 읽은 사원. 화면을 그린 뒤 읽고(서버에서 먼저 그릴 때와 어긋나지 않게), 다른 사원이 들어오면 그 사원 것으로 다시 읽는다 */
  employeeId: number | null;
  enabled: boolean;
  voiceApproval: boolean;
  /** 회사 설정 (AI 연결 화면, 서버 capabilities). 읽기 전에는 둘 다 꺼진 것으로 본다: 관리자가 끈 회사에서 마이크를 잠깐이라도 열지 않게 */
  company: { wake: boolean; voiceApproval: boolean };
  status: SteelmanWakeStatus;
  /** 지금 말소리를 잡는 중 */
  hearing: boolean;
  /** 브라우저가 소리 처리(AudioContext)를 멈춰 두어 화면을 한 번 눌러야 듣는다 (이슈 #494) */
  audioBlocked: boolean;
  /** 잡은 말소리를 음성 서버에서 받아쓰는 중 */
  transcribing: boolean;
  /** 띠에 잠깐 보이는 일(들은 말·물어보는 중·답했어요). until이 지나면 지운다. 받아쓴 글은 이 화면 메모리에만 둔다 */
  activity: (WakeActivity & { id: number; until: number }) | null;
  /** 마이크 소리 크기와 지금 말 시작 기준 (띠의 막대). 초당 몇 번만 바꾼다 */
  level: { rms: number; threshold: number };
  /** 말 시작 민감도 (사원별 저장) */
  sensitivity: WakeSensitivity;
  /** 마이크·음성 서버 문제. 스위치 옆에 보인다 */
  problem: string | null;
  /** "철강맨"만 불러 다음 말을 기다리는 중: 대답과 마감 */
  called: { reply: string; until: number } | null;
  /** 잠깐 보일 안내 (멈췄어요, 실행할 카드가 없어요 등) */
  notice: { id: number; text: string } | null;
  approval: VoiceApprovalPending | null;
  /** "화면 조작 켜"를 들어 확인을 기다리는 중 (끄기는 바로 한다) */
  screenConfirm: { deadline: number } | null;
  panelRequest: SteelmanPanelRequest | null;
  /** 말로 물어 답을 기다리는 질문 id (답이 끝나면 읽어 줄 자리로 넘긴다) */
  voiceQuestionId: string | null;
  load: (employeeId: number) => void;
  setEnabled: (on: boolean) => void;
  setVoiceApproval: (on: boolean) => void;
  setCompany: (company: { wake: boolean; voiceApproval: boolean }) => void;
  setStatus: (status: SteelmanWakeStatus, problem?: string | null) => void;
  setHearing: (hearing: boolean) => void;
  setAudioBlocked: (blocked: boolean) => void;
  setTranscribing: (transcribing: boolean) => void;
  showActivity: (activity: WakeActivity, ms?: number) => void;
  clearActivity: (id: number) => void;
  setLevel: (level: { rms: number; threshold: number }) => void;
  setSensitivity: (sensitivity: WakeSensitivity) => void;
  setProblem: (problem: string | null) => void;
  setCalled: (called: SteelmanWakeState['called']) => void;
  notify: (text: string) => void;
  clearNotice: (id: number) => void;
  setApproval: (approval: VoiceApprovalPending | null) => void;
  setScreenConfirm: (screenConfirm: { deadline: number } | null) => void;
  requestPanel: (request: PanelRequestInput) => void;
  takePanelRequest: (id: number) => void;
  setVoiceQuestionId: (id: string | null) => void;
}

let nextId = 1;

const QUIET = { rms: 0, threshold: 0 };
/** 끄거나 다른 사원으로 바뀌면 지우는 듣기 상태 */
const IDLE = { hearing: false, audioBlocked: false, transcribing: false, activity: null, level: QUIET } as const;

export const useSteelmanWakeStore = create<SteelmanWakeState>((set, get) => ({
  employeeId: null,
  enabled: false,
  voiceApproval: false,
  company: { wake: false, voiceApproval: false },
  status: 'off',
  hearing: false,
  audioBlocked: false,
  transcribing: false,
  activity: null,
  level: QUIET,
  sensitivity: 'normal',
  problem: null,
  called: null,
  notice: null,
  approval: null,
  screenConfirm: null,
  panelRequest: null,
  voiceQuestionId: null,
  load: (employeeId) => {
    const saved = readSteelmanWakePreference(employeeId);
    set({ employeeId, enabled: saved.wake, voiceApproval: saved.voiceApproval, sensitivity: saved.sensitivity, status: 'off', ...IDLE, problem: null, called: null, notice: null, approval: null, screenConfirm: null, panelRequest: null, voiceQuestionId: null });
  },
  setEnabled: (on) => {
    const { employeeId, voiceApproval, sensitivity } = get();
    if (employeeId !== null) writeSteelmanWakePreference(employeeId, { wake: on, voiceApproval, sensitivity });
    set(on ? { enabled: true, problem: null } : { enabled: false, status: 'off', ...IDLE, problem: null, called: null, approval: null, screenConfirm: null });
  },
  setVoiceApproval: (on) => {
    const { employeeId, enabled, sensitivity } = get();
    if (employeeId !== null) writeSteelmanWakePreference(employeeId, { wake: enabled, voiceApproval: on, sensitivity });
    set(on ? { voiceApproval: true } : { voiceApproval: false, approval: null });
  },
  setCompany: (company) =>
    set((state) => {
      if (state.company.wake === company.wake && state.company.voiceApproval === company.voiceApproval) return {};
      // 회사 설정이 꺼지면 기다리던 말로 승인·화면 조작 확인도 거둔다 (사원 각자의 켜기 설정은 그대로 둔다)
      return { company, ...(company.voiceApproval ? {} : { approval: null, screenConfirm: null }), ...(company.wake ? {} : { called: null, status: 'off' as const, ...IDLE }) };
    }),
  setStatus: (status, problem) => set(problem === undefined ? { status } : { status, problem }),
  setHearing: (hearing) => set({ hearing }),
  setAudioBlocked: (audioBlocked) => set((state) => (state.audioBlocked === audioBlocked ? {} : { audioBlocked })),
  setTranscribing: (transcribing) => set((state) => (state.transcribing === transcribing ? {} : { transcribing })),
  showActivity: (activity, ms = WAKE_ACTIVITY_MS) => set({ activity: { ...activity, id: nextId++, until: Date.now() + ms } }),
  clearActivity: (id) => set((state) => (state.activity?.id === id ? { activity: null } : {})),
  setLevel: (level) => set({ level }),
  setSensitivity: (sensitivity) => {
    const { employeeId, enabled, voiceApproval } = get();
    if (employeeId !== null) writeSteelmanWakePreference(employeeId, { wake: enabled, voiceApproval, sensitivity });
    set({ sensitivity });
  },
  setProblem: (problem) => set({ problem }),
  setCalled: (called) => set({ called }),
  notify: (text) => set({ notice: { id: nextId++, text } }),
  clearNotice: (id) => set((state) => (state.notice?.id === id ? { notice: null } : {})),
  setApproval: (approval) => set({ approval }),
  setScreenConfirm: (screenConfirm) => set({ screenConfirm }),
  requestPanel: (request) => set({ panelRequest: { ...request, id: nextId++ } }),
  takePanelRequest: (id) => set((state) => (state.panelRequest?.id === id ? { panelRequest: null } : {})),
  setVoiceQuestionId: (voiceQuestionId) => set({ voiceQuestionId }),
}));

/** 말로 승인을 쓸 수 있는가: 회사가 허용하고 이 사원도 켰을 때만 */
export const voiceApprovalAllowed = (state: Pick<SteelmanWakeState, 'voiceApproval' | 'company'>): boolean => state.voiceApproval && state.company.voiceApproval;
