'use client';

// 철강맨AI 패널 = AI 어시스턴트 (REQ-AST-001·003·004·007·008·009). 더 넓게(SPEC 4장 4번), 여는 버튼은 상단 바(4장 5번).
// 용어 사전과 데이터 조회(REQ-AST-004 조회 대상 전부), 과거 사례 검색(AST-006, 예시 사례 + 등록 사례)으로 답한다. 업무·일정·구매요청 등록을 부탁하면 실행 카드(AST-005)로 보여 주고, 사용자가 확인해 [실행]을 눌러야 반영된다.
// 답을 받은 질문은 서버가 대화로 저장하고(이슈 #399), [대화 목록]에서 지난 대화를 열어 이어 묻거나 지운다.
// 입력칸 맨 앞의 /로 명령(심층 조사·이번 질문만 웹 검색·브라우저, 새 대화, 대화 목록)을 부른다(이슈 #410, lib/aiSlashCommand.ts).
// 화면 도우미 펫 철강맨과 한 캐릭터로 느끼도록 펫 말풍선·대화창(public/pet/pet-engine.js의 .fp-bubble·.fp-chat)과 같은 모양으로 그린다.
import { AI_IMAGE_MAX_COUNT, AI_REASONING_DEFAULT, AI_RESEARCH_LIMITS, type DriveFileView, AI_REASONING_LABEL, AI_REASONING_LEVELS, type AiAssistantImageInput, type AiAssistantScreenContext, type AiAssistantSource, type AiReasoningLevel, type AiResearchSeed } from '@fantasteel/shared';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { aiResearchApi } from '@/api/aiResearch';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ROLE_LABEL } from '@/codes';
import { DriveFilePicker } from '@/features/drive/components/DriveFilePicker';
import { AiBrowserFramesDetails, AiLiveView, AiStepsDetails } from '@/features/shell/AiAnswerTrace';
import { AiAnswerText, AiWebSources } from '@/features/shell/AiWebAnswer';
import { routeTitleOf } from '@/features/shell/routeTitles';
import { AiActionCards } from '@/features/shell/AiActionCards';
import { AiChatThreadList } from '@/features/shell/AiChatThreadList';
import { SteelmanAiMark } from '@/features/shell/SteelmanAiMark';
import { SteelmanAiStatus } from '@/features/shell/SteelmanAiStatus';
import { AFTER_ANSWER_MS, finishedSteelmanStatus, liveSteelmanStatus, type SteelmanStatus, type ToolTimes } from '@/lib/steelmanStatus';
import { useAction } from '@/hooks/useAction';
import { controlAiAgent, sendAiAgentInput, sendAiAgentNote, useAiCapabilities, useAiSuggestedQuestions, useAskAiAssistant, useOpenAiChatThread, useRememberAiChatThread } from '@/hooks/useAiAssistant';
import { useAiImageDraft } from '@/hooks/useAiImageDraft';
import { useDriveReady } from '@/hooks/useIntegrations';
import { useMe } from '@/hooks/useMe';
import { aiImageDataUrl, type PreparedAiImage } from '@/lib/aiImage';
import { driveAiImageProblem } from '@/lib/driveFiles';
import { readAiReasoningPreference, reasoningAfterSend, writeAiReasoningPreference } from '@/lib/aiReasoning';
import { researchChipLabel } from '@/lib/aiResearchChart';
import { researchCardSeedAt, webResearchStartAt, type AiWebResearchStart } from '@/lib/aiResearchSeed';
import { AI_BROWSER_TITLE, browserDisabledReason, browserMaxActionsOf, readAiBrowserPreference, writeAiBrowserPreference } from '@/lib/aiBrowser';
import { AiDriveMention } from '@/features/shell/AiDriveMention';
import { AI_SLASH_MENU_ID, AiSlashCommandMenu, aiSlashOptionId } from '@/features/shell/AiSlashCommandMenu';
import { AI_DRIVE_TITLE, attachDriveFile, driveDisabledReason, mentionStillOpen, mentionTriggerAt, moveMentionIndex, readAiDrivePreference, removeMentionTrigger, writeAiDrivePreference } from '@/lib/aiDrive';
import { AI_SLASH_ESCAPED_HINT, AI_SLASH_NEED_QUESTION, filterSlashCommands, parseSlashDraft, slashCompletion, slashQueryOf, type AiSlashCommand, type AiSlashCommandKey } from '@/lib/aiSlashCommand';
import { AI_NOTION_TITLE, notionDisabledReason, readAiNotionPreference, writeAiNotionPreference } from '@/lib/aiNotion';
import { AI_SCREEN_CONTROL_TITLE, readAiScreenControlPreference, writeAiScreenControlPreference } from '@/lib/aiScreenControl';
import { AI_WEB_SEARCH_TITLE, AI_WEB_SEARCH_UNAVAILABLE_HINT, readAiWebSearchPreference, webSearchEngineHint, writeAiWebSearchPreference } from '@/lib/aiWebSearch';
import { AI_CHAT_STOPPED_REASON, useAiChatStore, type AiChatEntry, type AiChatLive } from '@/stores/useAiChatStore';
import { useShellStore } from '@/stores/useShellStore';

/** 서버 DTO와 같은 상한 (가정값) */
const MAX_QUESTION_LENGTH = 1000;

/** 답에 붙는 출처 종류 (REQ-AST-009) */
export const SOURCE_ICON: Record<AiAssistantSource['kind'], IconName> = { GLOSSARY: 'book', PROCESS: 'book', MANUAL: 'book', DATA: 'database' };
const SOURCE_LABEL: Record<AiAssistantSource['kind'], string> = { GLOSSARY: '용어 사전', PROCESS: '업무 프로세스', MANUAL: '업무 매뉴얼', DATA: '조회 데이터' };

/** 용어 사전·업무 프로세스는 ID를 함께 보이고, 조회 데이터의 id는 도구 이름(영문)이라 보이지 않는다 */
export const sourceText = (source: AiAssistantSource): string =>
  `${SOURCE_LABEL[source.kind]} · ${source.label}${source.kind === 'DATA' ? '' : ` (${source.id})`}`;

/** 펫 대화창의 추천 질문 칩(.fp-chip)과 같은 모양. 질문이 길 수 있어 한 줄로 자르지 않고 줄을 바꾼다 */
export const QUESTION_CHIP =
  'inline-flex min-h-7 items-center gap-1.5 rounded-[14px] border border-line-strong bg-surface px-2.5 py-1 text-left text-xs leading-snug font-medium text-ink-2 enabled:hover:border-steelman enabled:hover:text-steelman-ink disabled:cursor-not-allowed disabled:opacity-60';

/** 펫 말풍선(.fp-bubble)처럼 아바타 쪽으로 꼬리를 낸다: 바깥 삼각형이 테두리, 안쪽 삼각형이 바탕색으로 테두리 틈을 메운다 */
const TAIL_SHAPE =
  'relative before:absolute before:top-2 before:-left-[11px] before:border-y-8 before:border-r-10 before:border-l-0 before:border-y-transparent ' +
  'after:absolute after:top-[11px] after:-left-[6px] after:border-y-5 after:border-r-7 after:border-l-0 after:border-y-transparent';
const ANSWER_BUBBLE = `${TAIL_SHAPE} rounded-lg border-2 border-steelman bg-surface shadow-[3px_3px_0_var(--color-steelman-shadow)] before:border-r-steelman after:border-r-surface`;
const FAILURE_BUBBLE = `${TAIL_SHAPE} rounded-lg border-2 border-danger bg-surface shadow-[3px_3px_0_var(--color-danger-line)] before:border-r-danger after:border-r-surface`;
const STOPPED_BUBBLE = `${TAIL_SHAPE} rounded-lg border-2 border-line-strong bg-surface-2 before:border-r-line-strong after:border-r-surface-2`;

/** 지금 모델이 사진을 볼 수 없을 때 첨부 단추에 보이는 안내 */
const NO_VISION_TITLE = '지금 모델은 사진을 볼 수 없어요';
/** / 명령을 지금 쓸 수 없을 때 고르기 창과 입력칸 아래에 보이는 이유 */
const SLASH_RESEARCH_OFF = '심층 조사를 쓸 수 없어요 (AI 연결에 모델이 정해져 있지 않아요)';
const SLASH_WEB_OFF = '웹 검색을 쓸 수 없어요';
const SLASH_NEW_CHAT_PENDING = '답을 받는 중에는 새 대화를 시작할 수 없어요';
const SLASH_NEW_CHAT_EMPTY = '이미 새 대화예요';
const SLASH_RESEARCH_SHORT = `조사할 질문을 ${AI_RESEARCH_LIMITS.questionMin}자 이상 적어 주세요`;
const ATTACH_ACCEPT = 'image/png,image/jpeg,image/webp';

type FailureEntry = Extract<AiChatEntry, { role: 'failure' }>;

/** 끌어온 것이 파일이면 (글자나 링크를 끌어온 것은 건드리지 않는다) */
const hasFiles = (event: DragEvent): boolean => event.dataTransfer.types.includes('Files');

/** 위로 스크롤해 읽는 중이면 새 내용이 와도 끌어내리지 않는다: 바닥에서 이만큼(px) 안이면 따라간다 */
const STICK_TO_BOTTOM_PX = 80;

export function AiPanel() {
  const me = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const close = useShellStore((state) => state.closeAiPanel);
  const context = useShellStore((state) => state.aiContext);
  const expanded = useShellStore((state) => state.aiPanelExpanded);
  const toggleExpanded = useShellStore((state) => state.toggleAiPanelExpanded);
  const entries = useAiChatStore((state) => state.entries);
  const pendingId = useAiChatStore((state) => state.pendingId);
  const live = useAiChatStore((state) => state.live);
  const claim = useAiChatStore((state) => state.claim);
  const clear = useAiChatStore((state) => state.clear);
  const removeFailure = useAiChatStore((state) => state.removeFailure);
  const threadId = useAiChatStore((state) => state.threadId);
  const openThread = useOpenAiChatThread();
  const [showThreads, setShowThreads] = useState(false);
  const researchRef = useShellStore((state) => state.aiResearchRef);
  const setResearchRef = useShellStore((state) => state.setAiResearchRef);
  const ask = useAskAiAssistant();
  const [draft, setDraft] = useState('');
  const [reasoning, setReasoning] = useState<AiReasoningLevel>(AI_REASONING_DEFAULT);
  const [oneShot, setOneShot] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [webSearchPref, setWebSearchPref] = useState(false);
  const [browserPref, setBrowserPref] = useState(false);
  const [screenControlPref, setScreenControlPref] = useState(false);
  const [notionPref, setNotionPref] = useState(false);
  const [drivePref, setDrivePref] = useState(false);
  // 입력칸 @로 붙인 Drive 문서 (사진은 사진 칸으로 간다)와 @ 창을 연 자리 (이슈 #398 2단계)
  const [driveFiles, setDriveFiles] = useState<DriveFileView[]>([]);
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  // / 명령 고르기 창 (이슈 #410): Esc로 닫으면 입력칸이 /로 시작하지 않게 될 때까지 다시 열지 않는다
  const [slashDismissed, setSlashDismissed] = useState(false);
  // 고른 줄은 명령으로 든다 (거르면 순서가 바뀐다). null이면 쓸 수 있는 첫 명령
  const [slashActive, setSlashActive] = useState<AiSlashCommandKey | null>(null);
  const [slashProblem, setSlashProblem] = useState<string | null>(null);
  const capabilities = useAiCapabilities();
  // 모델 정보를 아직 못 읽었거나 알 수 없으면(null) 막지 않는다. 확실히 안 되는 것(false)만 막는다
  const visionOff = capabilities.data?.vision === false;
  const reasoningOff = capabilities.data?.reasoning === false;
  // 웹 검색: 엔진이 하나도 없거나 AI 연결 정보를 못 읽었을 때만 막는다 (읽는 중에는 막지 않는다)
  const webEngineHint = webSearchEngineHint(capabilities.data?.webSearch);
  const webSearchBlocked = capabilities.isError || capabilities.data?.webSearch?.engines.length === 0;
  const webSearchOn = webSearchPref && !webSearchBlocked;
  // 브라우저 사용: 서버가 못 쓴다고 했거나 연결 정보를 못 읽었을 때만 막는다 (읽는 중에는 막지 않는다)
  const browserBlockedReason = browserDisabledReason(capabilities.data, capabilities.isError);
  const browserOn = browserPref && browserBlockedReason === null;
  // ERP 화면 조작 (이슈 #382, 시험 중): 서버가 켜 두었을 때만 칩을 보인다
  const screenControlAvailable = capabilities.data?.screenControl?.available === true;
  const screenControlOn = screenControlPref && screenControlAvailable;
  // Notion (이슈 #398): 서버가 연결·상위 페이지를 확인해 줄 때만 켠다. 못 켜면 이유를 보인다
  const notionBlockedReason = notionDisabledReason(capabilities.data, capabilities.isError);
  const notionOn = notionPref && notionBlockedReason === null;
  const driveBlockedReason = driveDisabledReason(capabilities.data, capabilities.isError);
  const driveOn = drivePref && driveBlockedReason === null;
  // 심층 조사 (이슈 #378): 서버가 모델이 정해져 있다고 알릴 때만. 지금 입력한 글로 조사를 만들고 그 화면으로 간다
  const deepResearchOn = capabilities.data?.deepResearch?.available === true;
  const sendToResearch = useAction(aiResearchApi.create, {
    success: '심층 조사 계획을 세우고 있어요',
    onSuccess: (run) => {
      setDraft('');
      router.push(`/ai-research?id=${run.id}`);
    },
  });
  // 웹 검색 답에서 이어 가기 (이슈 #408): 입력하던 글은 그대로 두고 조사 화면으로 간다
  const continueToResearch = useAction(aiResearchApi.create, {
    success: '먼저 찾은 내용을 넘겨 심층 조사 계획을 세우고 있어요',
    onSuccess: (run) => router.push(`/ai-research?id=${run.id}`),
  });
  const photos = useAiImageDraft();
  const drive = useDriveReady();
  const [pickingDrive, setPickingDrive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const roleLabel = ROLE_LABEL[me.roleCode];
  const screenTitle = routeTitleOf(pathname).title || '대시보드';
  const pending = pendingId !== null;
  // 철강맨 모습 (이슈 #414): 패널을 열면 인사, 질문을 쓰는 동안 듣는 중. 막 끝난 답 옆에는 끝난 모습을 잠깐 보인다
  const [greetKey] = useState(() => String(Date.now()));
  const [greeting, setGreeting] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setGreeting(false), AFTER_ANSWER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const headerStatus: SteelmanStatus | null = pending ? null : greeting ? 'greet' : draft.trim() ? 'listening' : null;
  const [afterAnswer, setAfterAnswer] = useState<{ entryId: string } | null>(null);
  const wasPending = useRef(false);
  const afterTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    const last = entries.at(-1);
    if (!finished || !last || last.role === 'user') return;
    setAfterAnswer({ entryId: last.id });
    window.clearTimeout(afterTimer.current);
    afterTimer.current = window.setTimeout(() => setAfterAnswer(null), AFTER_ANSWER_MS);
  }, [pending, entries]);
  useEffect(() => () => window.clearTimeout(afterTimer.current), []);

  useEffect(() => {
    claim(me.employeeId);
  }, [claim, me.employeeId]);
  useRememberAiChatThread();

  // 저장된 생각 정도는 화면을 그린 뒤에 읽는다 (서버에서 먼저 그릴 때와 어긋나지 않게)
  useEffect(() => {
    const saved = readAiReasoningPreference();
    setReasoning(saved.level);
    setOneShot(saved.oneShot);
    setWebSearchPref(readAiWebSearchPreference());
    setBrowserPref(readAiBrowserPreference());
    setScreenControlPref(readAiScreenControlPreference());
    setNotionPref(readAiNotionPreference());
    setDrivePref(readAiDrivePreference());
  }, []);

  // 답이 자라는 동안(생각·조회·답 글) 맨 아래를 따라간다
  const liveSize = live ? `${live.steps.length}:${live.answer.length}:${lastStepSize(live)}:${live.browserFrames.length}` : '';
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && stickRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [entries.length, pending, liveSize]);

  const onScroll = () => {
    const scroller = scrollRef.current;
    if (scroller) stickRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < STICK_TO_BOTTOM_PX;
  };

  // 모델이 사진을 볼 수 없게 바뀌면 붙여 둔 사진은 보낼 수 없어 비운다
  const { images: draftImages, clear: clearDraftImages } = photos;
  useEffect(() => {
    if (visionOff && draftImages.length) clearDraftImages();
  }, [visionOff, draftImages.length, clearDraftImages]);

  const changeReasoning = (level: AiReasoningLevel) => {
    setReasoning(level);
    writeAiReasoningPreference({ level, oneShot });
  };

  const changeWebSearch = (on: boolean) => {
    setWebSearchPref(on);
    writeAiWebSearchPreference(on);
  };

  const changeBrowser = (on: boolean) => {
    setBrowserPref(on);
    writeAiBrowserPreference(on);
  };

  const changeScreenControl = (on: boolean) => {
    setScreenControlPref(on);
    writeAiScreenControlPreference(on);
  };

  const changeNotion = (on: boolean) => {
    setNotionPref(on);
    writeAiNotionPreference(on);
  };

  const changeDrive = (on: boolean) => {
    setDrivePref(on);
    writeAiDrivePreference(on);
  };

  // / 명령: 맨 앞이 /이고 띄어쓰기 전이면 고르기 창을 연다. @ 창이 열려 있으면 열지 않는다
  const slashQuery = mentionAt === null && !slashDismissed ? slashQueryOf(draft) : null;
  const slashCommands = slashQuery === null ? [] : filterSlashCommands(slashQuery);
  const slashOpen = slashCommands.length > 0;
  const slashDraft = parseSlashDraft(draft);

  const slashBlockedReason = (key: AiSlashCommandKey): string | null => {
    switch (key) {
      case 'research':
        return deepResearchOn ? null : SLASH_RESEARCH_OFF;
      case 'web':
        return webSearchBlocked ? (capabilities.isError ? AI_WEB_SEARCH_UNAVAILABLE_HINT : webEngineHint || SLASH_WEB_OFF) : null;
      case 'browser':
        return browserBlockedReason;
      case 'newChat':
        return pending ? SLASH_NEW_CHAT_PENDING : entries.length ? null : SLASH_NEW_CHAT_EMPTY;
      case 'threads':
        return null;
    }
  };
  const slashPicked = slashCommands.findIndex((command) => command.key === slashActive);
  const slashCurrent = slashPicked >= 0 ? slashPicked : Math.max(0, slashCommands.findIndex((command) => slashBlockedReason(command.key) === null));

  // 입력칸에 @를 치면 Drive 파일 고르기를 연다. Drive가 준비됐을 때만 (메신저 입력칸의 @와는 따로다)
  const changeDraft = (next: string, caret: number) => {
    if (mentionAt !== null && !mentionStillOpen(next, mentionAt)) setMentionAt(null);
    else if (drive.ready && mentionAt === null) {
      const at = mentionTriggerAt(draft, next, caret);
      if (at !== null) setMentionAt(at);
    }
    if (!next.startsWith('/')) setSlashDismissed(false);
    if (slashQueryOf(next) !== slashQueryOf(draft)) setSlashActive(null);
    setSlashProblem(null);
    setDraft(next);
  };

  const closeMention = () => {
    setMentionAt(null);
    inputRef.current?.focus();
  };

  const dismissMention = useCallback(() => setMentionAt(null), []);

  // @ 창 검색칸이 비었을 때 지우기를 누르면 입력칸의 그 @까지 지운 것으로 본다
  const cancelMention = () => {
    if (mentionAt !== null) setDraft((current) => removeMentionTrigger(current, mentionAt));
    closeMention();
  };

  const pickMention = (file: DriveFileView) => {
    if (mentionAt !== null) setDraft((current) => removeMentionTrigger(current, mentionAt));
    closeMention();
    // 사진은 'Drive에서 사진 첨부'와 같은 길로 (화면이 줄여서 사진 칸에 붙인다)
    if (file.kind === 'image') {
      if (visionOff) photos.warn(NO_VISION_TITLE);
      else void photos.addDriveFile(file);
      return;
    }
    const next = attachDriveFile(driveFiles, file);
    if (next.problem) photos.warn(next.problem);
    setDriveFiles(next.list);
  };

  const changeOneShot = (checked: boolean) => {
    setOneShot(checked);
    writeAiReasoningPreference({ level: reasoning, oneShot: checked });
  };

  // 주소의 쿼리(열어 둔 수주 id 등)도 함께 보내 '이 수주'를 알아듣게 한다 (REQ-AST-007)
  const screenContext = (): AiAssistantScreenContext => ({
    path: `${pathname}${typeof window === 'undefined' ? '' : window.location.search}`,
    title: screenTitle,
    label: context?.label ?? null,
  });

  // 생각 정도를 바꿀 수 없는 모델이면 보내지 않는다 (서버도 무시한다)
  const sentReasoning = (level: AiReasoningLevel): AiReasoningLevel | undefined => (reasoningOff ? undefined : level);

  // withImages=false: 추천 질문 칩처럼 붙여 둔 사진과 상관없이 묻는 질문. once: / 명령으로 이번 질문만 켜는 도구 (저장된 켜기 설정은 그대로)
  const send = (question: string, withImages = true, once: { webSearch?: boolean; browser?: boolean } = {}) => {
    if (!question.trim() || pending || photos.busy) return;
    stickRef.current = true;
    setShowThreads(false);
    const attached: AiAssistantImageInput[] = withImages && !visionOff ? draftImages.map(({ mediaType, dataBase64 }) => ({ mediaType, dataBase64 })) : [];
    ask(question, screenContext(), sentReasoning(reasoning), attached, webSearchOn || once.webSearch === true, browserOn || once.browser === true, screenControlOn, researchRef?.id, notionOn, { drive: driveOn, driveFileIds: withImages ? driveFiles.map((file) => file.id) : [] });
    setDraft('');
    if (withImages) setDriveFiles([]);
    if (withImages) photos.clear();
    const next = reasoningAfterSend(reasoning, oneShot);
    if (!reasoningOff && next !== reasoning) {
      setReasoning(next);
      writeAiReasoningPreference({ level: next, oneShot });
    }
  };

  const startNewChat = () => {
    clear();
    setShowThreads(false);
  };

  // 쓸 수 없는 명령이나 질문이 빠진 명령은 보내지 않고 입력칸 아래에 이유를 보인다
  const runSlashCommand = (command: AiSlashCommand, question: string) => {
    const blocked = slashBlockedReason(command.key);
    if (blocked) {
      setSlashProblem(blocked);
      return;
    }
    if (command.takesQuestion && !question) {
      setSlashProblem(AI_SLASH_NEED_QUESTION);
      return;
    }
    switch (command.key) {
      case 'research':
        if (question.length < AI_RESEARCH_LIMITS.questionMin) setSlashProblem(SLASH_RESEARCH_SHORT);
        else if (!sendToResearch.isPending) sendToResearch.mutate({ question: question.slice(0, AI_RESEARCH_LIMITS.questionMax) });
        return;
      case 'web':
        send(question, true, { webSearch: true });
        return;
      case 'browser':
        send(question, true, { browser: true });
        return;
      // 질문을 받지 않는 명령 뒤에 적은 글은 버리지 않고 입력칸에 남긴다
      case 'newChat':
        startNewChat();
        setDraft(question);
        return;
      case 'threads':
        setShowThreads(true);
        setDraft(question);
        return;
    }
  };

  // 고르기 창에서 고르면: 질문을 받는 명령은 `/웹 `까지 채우고, 아니면 바로 한다
  const pickSlashCommand = (command: AiSlashCommand) => {
    const blocked = slashBlockedReason(command.key);
    if (blocked) setSlashProblem(blocked);
    else if (command.takesQuestion) setDraft(slashCompletion(command));
    else runSlashCommand(command, '');
    inputRef.current?.focus();
  };

  // 브라우저·화면 조작을 켠 답이 진행 중이면 보내는 글은 새 질문이 아니라 작업 중 덧붙임이다 (이슈 #430)
  const canAddNote = pending && live?.control != null;
  const sendNote = () => {
    const text = draft.trim();
    if (!text) return;
    stickRef.current = true;
    void sendAiAgentNote(text).then((sent) => {
      if (sent) setDraft('');
    });
  };

  const submit = () => {
    if (canAddNote) {
      sendNote();
      return;
    }
    if (slashDraft.kind === 'command') runSlashCommand(slashDraft.command, slashDraft.question);
    else send(slashDraft.text);
  };

  // 실행 카드 요청 예시는 바로 보내지 않고 입력칸에 채워, 사용자가 ○○를 채우고 고쳐서 보낸다
  const fill = (text: string) => {
    setDraft(text);
    inputRef.current?.focus();
  };

  // 다시 물을 때는 처음 보냈던 생각 정도로 묻는다 (고른 값은 건드리지 않는다)
  const retry = (failure: FailureEntry) => {
    removeFailure(failure.id);
    stickRef.current = true;
    ask(failure.question, screenContext(), sentReasoning(failure.reasoning ?? reasoning), visionOff ? undefined : failure.images, Boolean(failure.webSearch) && !webSearchBlocked, Boolean(failure.browser) && browserBlockedReason === null, screenControlOn, undefined, notionOn, { drive: driveOn });
  };

  // 사진 파일을 끌어다 놓거나 붙여 넣으면 질문 칸에 붙는다
  const attachFiles = (files: readonly File[]) => {
    // 버튼은 꺼 두지만 붙여 넣기·끌어 놓기는 막을 수 없어, 말없이 버리지 않고 이유를 알린다
    if (visionOff) {
      photos.warn(NO_VISION_TITLE);
      return;
    }
    void photos.addFiles(files);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return; // 글자만 붙여 넣는 건 그대로 둔다
    event.preventDefault();
    attachFiles(files);
  };

  const onDragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    // 막지 않으면 브라우저가 놓은 사진을 이 탭에서 열어 ERP 화면을 벗어난다
    event.preventDefault();
    setDragging(!visionOff);
  };

  const onDragLeave = (event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  };

  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    attachFiles(Array.from(event.dataTransfer.files));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return; // 한글 조합 중 Enter는 보내지 않는다
    // 입력칸으로 돌아와 있어도 Esc로 @ 창을 닫는다
    if (event.key === 'Escape' && mentionAt !== null) {
      event.preventDefault();
      closeMention();
      return;
    }
    if (slashOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashActive(slashCommands[moveMentionIndex(slashCurrent, event.key === 'ArrowDown' ? 1 : -1, slashCommands.length)].key);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        event.preventDefault();
        pickSlashCommand(slashCommands[slashCurrent]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  // 입력칸 아래 / 명령 줄: 못 한 이유, 명령이 할 일, //로 글 그대로 보냄
  const slashLine: { text: string; error: boolean } | null = slashProblem
    ? { text: slashProblem, error: true }
    : slashDraft.kind === 'command' && !slashOpen
      ? { text: slashBlockedReason(slashDraft.command.key) ?? slashDraft.command.hint, error: slashBlockedReason(slashDraft.command.key) !== null }
      : slashDraft.kind === 'text' && slashDraft.escaped
        ? { text: AI_SLASH_ESCAPED_HINT, error: false }
        : null;
  // [심층 조사로 보내기]도 / 명령 낱말은 빼고 질문만 넘긴다
  const researchQuestion = slashDraft.kind === 'command' ? slashDraft.question : slashDraft.text.trim();

  return (
    <aside
      aria-label="철강맨AI"
      // 화면 조작의 화면 글에서 패널 자신은 뺀다 (lib/aiScreenAgent.ts)
      data-ai-skip=""
      // 펫이 패널 밑(보내기 버튼 위)에 서 있지 않게 비켜서게 한다 (pet-engine.js avoidEdges)
      data-pet-avoid=""
      // 패널은 펫보다 아래 층이라, 패널 밑에 깔린 요소를 가리키는 표시(테두리·지시봉)는 패널 앞에서 멈추게 한다
      data-pet-cover=""
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`absolute inset-y-0 right-0 z-10 flex min-h-0 flex-col border-l-2 border-ink bg-surface shadow-[-4px_0_0_rgba(18,24,32,0.16),var(--shadow-pop)] ${expanded ? 'w-full' : 'w-[min(620px,46vw)]'}`}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-steelman bg-steelman-soft/80 text-sm font-semibold text-steelman-ink">
          여기에 놓으면 질문에 사진을 붙여요
        </div>
      ) : null}
      <div className="flex min-h-12 flex-none items-center gap-1 border-b-2 border-line bg-surface-2 py-1.5 pr-2 pl-3">
        <SteelmanAiStatus size="sm" status={headerStatus} seedKey={greetKey} />
        <div className="ml-1 flex min-w-0 flex-col">
          <b className="text-base leading-tight font-bold">철강맨AI</b>
          <small className="truncate text-cap text-ink-3">화면 도우미 철강맨이 답해요</small>
        </div>
        <IconButton
          icon="history"
          label={showThreads ? '대화로 돌아가기' : '대화 목록'}
          size="sm"
          className={`ml-auto ${showThreads ? 'bg-steelman-soft text-steelman-ink' : ''}`}
          aria-pressed={showThreads}
          onClick={() => setShowThreads((open) => !open)}
        />
        <IconButton
          icon="refresh"
          label="새 대화"
          size="sm"
          disabled={!entries.length || pending}
          onClick={startNewChat}
        />
        <IconButton icon={expanded ? 'minimize' : 'maximize'} label={expanded ? '작게 보기' : '크게 펼치기'} size="sm" onClick={toggleExpanded} />
        <IconButton icon="x" label="패널 닫기" size="sm" onClick={close} />
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
        <div className={`mx-auto flex flex-col gap-3.5 p-4 ${expanded ? 'max-w-[880px]' : ''}`}>
          {showThreads ? (
            <AiChatThreadList
              currentThreadId={threadId}
              busy={pending}
              opening={openThread.isPending}
              onOpen={(id) => {
                stickRef.current = true;
                openThread.mutate(id, { onSuccess: () => setShowThreads(false) });
              }}
            />
          ) : (
            <>
              {entries.length ? null : <Welcome roleLabel={roleLabel} contextQuestion={context?.question ?? null} disabled={pending} onAsk={(question) => send(question, false)} onFill={fill} />}
              {entries.map((entry, index) => (
                <ChatEntry
                  key={entry.id}
                  entry={entry}
                  disabled={pending}
                  onRetry={retry}
                  steelman={afterAnswer?.entryId === entry.id ? finishedSteelmanStatus(entry) : null}
                  research={
                    deepResearchOn && entry.role === 'assistant'
                      ? { start: webResearchStartAt(entries, index), cardSeed: researchCardSeedAt(entries, index), pending: continueToResearch.isPending, onStart: (start) => continueToResearch.mutate(start) }
                      : null
                  }
                />
              ))}
              {pending && live ? <LiveAnswer live={live} seedKey={pendingId ?? 'live'} /> : null}
            </>
          )}
        </div>
      </div>

      <div className={`mx-auto w-full flex-none px-4 pb-2.5 ${expanded ? 'max-w-[880px]' : ''}`}>
        <span className="mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-sm border border-line bg-surface-2 px-2 py-1 text-cap text-ink-2">
          <Icon name="eye" size="sm" />
          <span className="truncate">
            보고 있는 화면 · <b className="font-semibold">{screenTitle}</b>
            {context ? ` · ${context.label}` : null}
          </span>
          <span className="flex-none text-ink-3">(질문과 함께 보내요)</span>
        </span>
        {researchRef ? (
          <span className="mb-1.5 ml-1.5 inline-flex max-w-full items-center gap-1 rounded-sm border border-line bg-brand-tint px-2 py-1 text-cap text-ink-2">
            <Icon name="search" size="sm" />
            <span className="truncate" title={researchRef.title}>{researchChipLabel(researchRef)}</span>
            <button type="button" aria-label="보고서 빼기" className="flex-none text-ink-3 hover:text-ink" onClick={() => setResearchRef(null)}>
              ×
            </button>
          </span>
        ) : null}
        <div className="relative flex flex-col rounded-md border border-line-strong bg-surface focus-within:border-steelman focus-within:shadow-[0_0_0_2px_var(--color-steelman-soft)]">
          {mentionAt !== null ? <AiDriveMention onPick={pickMention} onClose={closeMention} onCancel={cancelMention} onDismiss={dismissMention} /> : null}
          {slashOpen ? <AiSlashCommandMenu commands={slashCommands} active={slashCurrent} blockedReasonOf={slashBlockedReason} onPick={pickSlashCommand} onHover={(index) => setSlashActive(slashCommands[index].key)} /> : null}
          {draftImages.length ? <DraftImages images={draftImages} onRemove={photos.remove} /> : null}
          {driveFiles.length ? <DraftDriveFiles files={driveFiles} onRemove={(id) => setDriveFiles((current) => current.filter((file) => file.id !== id))} /> : null}
          <textarea
            ref={inputRef}
            rows={2}
            value={draft}
            maxLength={MAX_QUESTION_LENGTH}
            onChange={(event) => changeDraft(event.target.value, event.target.selectionStart ?? event.target.value.length)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={canAddNote ? '작업 중인 철강맨AI에게 말 덧붙이기 — 예: 부산 말고 서울 기준으로 (Enter로 보내기)' : drive.ready ? '철강맨AI에게 묻기 — 예: 여재가 뭐야? (/로 명령, @로 Drive 파일 붙이기)' : '철강맨AI에게 묻기 — 예: 여재가 뭐야? (/로 명령)'}
            aria-label="철강맨AI에게 질문"
            aria-controls={slashOpen ? AI_SLASH_MENU_ID : undefined}
            aria-activedescendant={slashOpen ? aiSlashOptionId(slashCommands[slashCurrent].key) : undefined}
            className="resize-none border-0 bg-transparent px-3 py-2.5 text-base leading-snug outline-none"
          />
          {slashLine ? (
            <p role={slashLine.error ? 'alert' : 'status'} className={`px-3 pb-1 text-cap ${slashLine.error ? 'text-danger' : 'text-ink-3'}`}>
              {slashLine.text}
            </p>
          ) : null}
          {draftImages.length && !draft.trim() ? <p className="px-3 pb-1 text-cap text-ink-3">사진과 함께 물어볼 내용을 적어 주세요</p> : null}
          {photos.notice ? (
            <p role={photos.notice.error ? 'alert' : 'status'} className={`px-3 pb-1 text-cap ${photos.notice.error ? 'text-danger' : 'text-ink-3'}`}>
              {photos.notice.text}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1.5 pt-1 pb-1.5">
            <div className="inline-flex items-center">
              <IconButton
                icon="clip"
                label="사진 첨부"
                size="sm"
                disabled={visionOff || photos.busy}
                title={visionOff ? NO_VISION_TITLE : '사진 첨부'}
                onClick={() => fileInputRef.current?.click()}
              />
              <IconButton
                icon="maximize"
                label="화면 캡처"
                size="sm"
                disabled={visionOff || photos.busy}
                title={visionOff ? NO_VISION_TITLE : '지금 ERP 화면을 사진으로 붙여요'}
                onClick={() => void photos.addCapture()}
              />
              {drive.ready ? (
                <IconButton
                  icon="file"
                  label="Drive에서 사진 첨부"
                  size="sm"
                  disabled={visionOff || photos.busy}
                  title={visionOff ? NO_VISION_TITLE : '회사 Drive 폴더의 사진을 붙여요'}
                  onClick={() => setPickingDrive(true)}
                />
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ATTACH_ACCEPT}
                aria-label="첨부할 사진 고르기"
                hidden
                onChange={(event) => {
                  attachFiles(Array.from(event.target.files ?? []));
                  event.target.value = ''; // 같은 사진을 다시 고를 수 있게
                }}
              />
            </div>
            {/* 생각 정도를 못 바꾸는 모델이면 칸을 숨긴다. 모르는 모델(null)은 보여 주고, 서버가 못 쓰면 답 아래에 알린다 */}
            {reasoningOff ? null : <ReasoningPicker level={reasoning} oneShot={oneShot} onLevel={changeReasoning} onOneShot={changeOneShot} />}
            <WebSearchToggle on={webSearchOn} blocked={webSearchBlocked} hint={webSearchBlocked ? (capabilities.isError ? AI_WEB_SEARCH_UNAVAILABLE_HINT : webEngineHint) : webEngineHint} onChange={changeWebSearch} />
            <BrowserToggle on={browserOn} blockedReason={browserBlockedReason} onChange={changeBrowser} />
            {screenControlAvailable ? <ScreenControlToggle on={screenControlOn} onChange={changeScreenControl} /> : null}
            <NotionToggle on={notionOn} blockedReason={notionBlockedReason} onChange={changeNotion} />
            <DriveToggle on={driveOn} blockedReason={driveBlockedReason} onChange={changeDrive} />
            {deepResearchOn ? (
              <Button
                size="sm"
                variant="ghost"
                icon="search"
                disabled={researchQuestion.length < AI_RESEARCH_LIMITS.questionMin || sendToResearch.isPending}
                title="웹을 여러 번 찾아 읽고 출처가 달린 보고서를 써요. 먼저 조사 계획을 보여 줘요 (/조사 질문으로도 보내요)"
                onClick={() => sendToResearch.mutate({ question: researchQuestion })}
              >
                심층 조사로 보내기
              </Button>
            ) : null}
            <span className="text-cap text-ink-3">Enter 보내기 · Shift+Enter 줄바꿈 · / 명령</span>
            {pending ? (
              <>
                {canAddNote ? <Button variant="primary" size="sm" icon="send" className="ml-auto" disabled={!draft.trim()} aria-label="덧붙이기" title="작업 중인 AI에게 말을 덧붙여요" onClick={sendNote} /> : null}
                <Button size="sm" icon="x-circle" className={canAddNote ? '' : 'ml-auto'} aria-label="멈추기" onClick={() => ask.stop()}>
                  멈추기
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" icon="send" className="ml-auto" disabled={!draft.trim() || photos.busy} aria-label="보내기" onClick={submit} />
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5 border-t border-line px-4 py-2 text-cap text-ink-3">
        <Icon name="lock" size="sm" />
        철강맨AI는 조회와 초안만 만들어요 · 반영은 사람이 확정 · 내 권한({roleLabel}) 범위
      </div>
      {pickingDrive ? (
        <DriveFilePicker
          title="Drive에서 사진 고르기"
          description="회사 Drive 폴더의 사진이에요. 고르면 질문 칸에 붙어요"
          kinds={['image']}
          problemOf={driveAiImageProblem}
          confirmLabel="이 사진 붙이기"
          emptyText="폴더에 사진이 없어요. Drive 폴더에 사진을 올린 뒤 다시 열어 주세요"
          onPick={(file) => {
            setPickingDrive(false);
            void photos.addDriveFile(file);
          }}
          onClose={() => setPickingDrive(false)}
        />
      ) : null}
    </aside>
  );
}

function Welcome({ roleLabel, contextQuestion, disabled, onAsk, onFill }: { roleLabel: string; contextQuestion: string | null; disabled: boolean; onAsk: (question: string) => void; onFill: (text: string) => void }) {
  const suggested = useAiSuggestedQuestions();
  const roleQuestions = suggested.data?.roleQuestions ?? [];
  const firstTimeQuestions = suggested.data?.firstTimeQuestions ?? [];
  const cardExamples = suggested.data?.actionCardExamples ?? [];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-cap leading-relaxed text-ink-3">
        용어는 용어 사전에서, 재고·수주·생산·검사·구매·출하·LOT 추적·작업 로그는 내 권한 범위의 데이터를 조회해 출처와 함께 답해요. "비슷한 사례 찾아줘"처럼 물으면 과거 사례에서 찾아 요약해요. 자료에 없는 내용은 확인할 수 없다고 답해요. "견적서 보내기 업무 등록해줘"처럼 업무·일정·구매요청·수주 등록, 열연 배정, 히트 편성 확정, 과거 사례 등록, 내 일정·업무 고치기를 부탁하면 실행 카드로 만들어 줘요. 'Notion'을 켜면 회사 Notion을 찾아 읽고 정리 글을 Notion 카드로 써 줘요. 카드를 확인하고 [실행]을 눌러야 반영돼요.
      </p>
      {suggested.isError ? <p className="text-cap text-danger">추천 질문을 불러오지 못했어요. 질문은 바로 입력할 수 있어요.</p> : null}
      {contextQuestion || roleQuestions.length ? (
        <>
          <b className="mt-1 text-xs font-semibold">추천 질문 · {roleLabel}</b>
          <QuestionChips questions={[...(contextQuestion ? [contextQuestion] : []), ...roleQuestions]} disabled={disabled} onAsk={onAsk} />
        </>
      ) : null}
      {cardExamples.length ? (
        <>
          <b className="mt-1.5 text-xs font-semibold">실행 카드로 요청하기</b>
          <span className="text-cap text-ink-3">누르면 입력칸에 채워져요. 고쳐서 보내면 카드로 만들어 줘요 (실행은 카드에서 직접 눌러요)</span>
          <div className="flex flex-wrap gap-1.5">
            {cardExamples.map((example) => (
              <button key={example.kind} type="button" disabled={disabled} title={example.text} className={QUESTION_CHIP} onClick={() => onFill(example.text)}>
                <Icon name="edit" size="sm" />
                {example.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {firstTimeQuestions.length ? (
        <>
          <b className="mt-1.5 text-xs font-semibold">처음 쓰는 분께</b>
          <QuestionChips questions={firstTimeQuestions} disabled={disabled} onAsk={onAsk} />
        </>
      ) : null}
    </div>
  );
}

function QuestionChips({ questions, disabled, onAsk }: { questions: readonly string[]; disabled: boolean; onAsk: (question: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {questions.map((question) => (
        <button key={question} type="button" disabled={disabled} className={QUESTION_CHIP} onClick={() => onAsk(question)}>
          {question}
        </button>
      ))}
    </div>
  );
}

/** 마지막 단계의 글 길이: 생각 글이 자라는 것도 따라가려고 */
function lastStepSize(live: AiChatLive): number {
  const last = live.steps.at(-1);
  return last && last.kind !== 'tool' ? last.text.length : 0;
}

/** 생각 정도: 끔·낮게·보통·깊게. '이번 질문만'을 켜 두면 보낸 뒤 기본값으로 돌아간다 */
function ReasoningPicker({ level, oneShot, onLevel, onOneShot }: { level: AiReasoningLevel; oneShot: boolean; onLevel: (level: AiReasoningLevel) => void; onOneShot: (checked: boolean) => void }) {
  return (
    <div className="inline-flex items-center gap-2 text-cap text-ink-3">
      <span id="ai-reasoning-label">생각</span>
      <div role="radiogroup" aria-labelledby="ai-reasoning-label" className="inline-flex overflow-hidden rounded-sm border border-line-strong">
        {AI_REASONING_LEVELS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === level}
            onClick={() => onLevel(option)}
            className={`h-6 px-2 text-cap not-first:border-l not-first:border-line-strong ${option === level ? 'bg-steelman-soft font-semibold text-steelman-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'}`}
          >
            {AI_REASONING_LABEL[option]}
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-1 text-ink-2">
        <input type="checkbox" checked={oneShot} onChange={(event) => onOneShot(event.target.checked)} />
        이번 질문만
      </label>
    </div>
  );
}

/** 웹 검색 켜기. 켜면 이 질문에 인터넷 검색 도구를 쓰고, 질문 글이 검색 엔진으로 나간다 (이슈 #367) */
function WebSearchToggle({ on, blocked, hint, onChange }: { on: boolean; blocked: boolean; hint: string; onChange: (on: boolean) => void }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-cap text-ink-3" title={AI_WEB_SEARCH_TITLE}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="웹 검색"
        aria-describedby="ai-web-search-hint"
        disabled={blocked}
        onClick={() => onChange(!on)}
        className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-cap disabled:cursor-not-allowed disabled:opacity-55 ${on ? 'border-steelman bg-steelman-soft font-semibold text-steelman-ink' : 'border-line-strong bg-surface text-ink-2 enabled:hover:bg-surface-2'}`}
      >
        <Icon name="search" size="sm" />웹 검색
      </button>
      <span id="ai-web-search-hint">{blocked ? hint : on ? `${hint ? `${hint} · ` : ''}질문 글이 검색 엔진으로 나가요` : hint}</span>
    </div>
  );
}

/** 브라우저 사용 켜기. 켜면 이 질문에 철강맨AI가 설치된 Chrome으로 웹 페이지를 열고 눌러 본다 (이슈 #373) */
function BrowserToggle({ on, blockedReason, onChange }: { on: boolean; blockedReason: string | null; onChange: (on: boolean) => void }) {
  const blocked = blockedReason !== null;
  return (
    <div className="inline-flex items-center gap-1.5 text-cap text-ink-3" title={AI_BROWSER_TITLE}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="브라우저"
        aria-describedby="ai-browser-hint"
        disabled={blocked}
        onClick={() => onChange(!on)}
        className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-cap disabled:cursor-not-allowed disabled:opacity-55 ${on ? 'border-steelman bg-steelman-soft font-semibold text-steelman-ink' : 'border-line-strong bg-surface text-ink-2 enabled:hover:bg-surface-2'}`}
      >
        <Icon name="search" size="sm" />브라우저
      </button>
      <span id="ai-browser-hint">{blocked ? blockedReason : on ? AI_BROWSER_TITLE : ''}</span>
    </div>
  );
}

/** Drive 켜기 (이슈 #398 2단계). 켜면 이 질문에 회사 Drive 폴더의 파일을 찾아 읽는다. 연결·폴더가 없으면 이유와 함께 꺼 둔다 */
function DriveToggle({ on, blockedReason, onChange }: { on: boolean; blockedReason: string | null; onChange: (on: boolean) => void }) {
  const blocked = blockedReason !== null;
  return (
    <div className="inline-flex items-center gap-1.5 text-cap text-ink-3" title={blocked ? blockedReason : AI_DRIVE_TITLE}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Drive"
        aria-describedby="ai-drive-hint"
        disabled={blocked}
        onClick={() => onChange(!on)}
        className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-cap disabled:cursor-not-allowed disabled:opacity-55 ${on ? 'border-steelman bg-steelman-soft font-semibold text-steelman-ink' : 'border-line-strong bg-surface text-ink-2 enabled:hover:bg-surface-2'}`}
      >
        <Icon name="file" size="sm" />Drive
      </button>
      <span id="ai-drive-hint">{blocked ? blockedReason : on ? '읽기만 해요' : ''}</span>
    </div>
  );
}

/** 입력칸 @로 붙인 Drive 문서. 보내면 서버가 읽어 질문에 붙인다 */
function DraftDriveFiles({ files, onRemove }: { files: readonly DriveFileView[]; onRemove: (id: string) => void }) {
  return (
    <div role="group" aria-label={`붙인 Drive 파일 ${files.length}개`} className="flex flex-wrap gap-1.5 px-3 pt-2.5">
      {files.map((file) => (
        <span key={file.id} className="inline-flex max-w-full items-center gap-1 rounded-sm border border-line bg-surface-2 px-2 py-0.5 text-cap text-ink-2">
          <Icon name="file" size="sm" className="flex-none text-ink-3" />
          <span className="truncate" title={file.name}>
            {file.name}
          </span>
          <button type="button" aria-label={`${file.name} 빼기`} className="flex-none text-ink-3 hover:text-ink" onClick={() => onRemove(file.id)}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** Notion 켜기 (이슈 #398). 켜면 이 질문에 회사 Notion을 찾아 읽고, 쓰기는 실행 카드로 제안한다. 연결·상위 페이지가 없으면 이유와 함께 꺼 둔다 */
function NotionToggle({ on, blockedReason, onChange }: { on: boolean; blockedReason: string | null; onChange: (on: boolean) => void }) {
  const blocked = blockedReason !== null;
  return (
    <div className="inline-flex items-center gap-1.5 text-cap text-ink-3" title={blocked ? blockedReason : AI_NOTION_TITLE}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Notion"
        aria-describedby="ai-notion-hint"
        disabled={blocked}
        onClick={() => onChange(!on)}
        className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-cap disabled:cursor-not-allowed disabled:opacity-55 ${on ? 'border-steelman bg-steelman-soft font-semibold text-steelman-ink' : 'border-line-strong bg-surface text-ink-2 enabled:hover:bg-surface-2'}`}
      >
        <Icon name="book" size="sm" />Notion
      </button>
      <span id="ai-notion-hint">{blocked ? blockedReason : on ? '쓰기는 카드로만 해요' : ''}</span>
    </div>
  );
}

/** ERP 화면 조작 켜기 (이슈 #382, 시험 중). 켜면 철강맨AI가 지금 화면을 읽고 옮기고 칸을 채운다. 저장·확정은 사용자가 누른다 */
function ScreenControlToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-cap text-ink-3" title={AI_SCREEN_CONTROL_TITLE}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="화면 조작"
        onClick={() => onChange(!on)}
        className={`inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-cap ${on ? 'border-steelman bg-steelman-soft font-semibold text-steelman-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2'}`}
      >
        <Icon name="dashboard" size="sm" />화면 조작
      </button>
      {on ? <span>시험 중 · 저장은 직접 눌러요</span> : null}
    </div>
  );
}

/** 질문 칸 위에 붙여 둔 사진. 보내기 전에 하나씩 뺄 수 있다 */
function DraftImages({ images, onRemove }: { images: readonly PreparedAiImage[]; onRemove: (index: number) => void }) {
  return (
    <div role="group" className="flex flex-wrap gap-2 px-3 pt-2.5" aria-label={`붙인 사진 ${images.length}/${AI_IMAGE_MAX_COUNT}장`}>
      {images.map((image, index) => (
        <div key={index} className="relative">
          <img src={aiImageDataUrl(image)} alt={`붙인 사진 ${index + 1}`} className="size-14 rounded-sm border border-line object-cover" />
          <button
            type="button"
            aria-label={`사진 ${index + 1} 빼기`}
            title="사진 빼기"
            className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 hover:bg-surface-3"
            onClick={() => onRemove(index)}
          >
            <Icon name="x" size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** 답에서 심층 조사로 잇기 (이슈 #408). start는 웹 검색 답이면 그 질문·seed, cardSeed는 심층 조사 카드가 넘길 웹 검색 결과 */
interface ChatEntryResearch {
  start: AiWebResearchStart | null;
  cardSeed: AiResearchSeed | null;
  pending: boolean;
  onStart: (start: AiWebResearchStart) => void;
}

function ChatEntry({
  entry,
  disabled,
  onRetry,
  research,
  steelman,
}: {
  entry: AiChatEntry;
  disabled: boolean;
  onRetry: (failure: FailureEntry) => void;
  research: ChatEntryResearch | null;
  /** 답이 막 끝났을 때의 철강맨 모습 (이슈 #414). 없으면 가만히 있는 얼굴 */
  steelman: SteelmanStatus | null;
}) {
  if (entry.role === 'user') {
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
        {entry.images?.length ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {entry.images.map((image, index) => (
              <img key={index} src={aiImageDataUrl(image)} alt={`첨부한 사진 ${index + 1}`} className="size-16 rounded-sm border border-line object-cover" />
            ))}
          </div>
        ) : entry.imageCount ? (
          // 저장한 대화를 다시 열면 사진은 없다 (저장하지 않는다)
          <span className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface-2 px-2 py-0.5 text-cap text-ink-3">
            <Icon name="file" size="sm" />
            사진 {entry.imageCount}장 · 사진은 저장하지 않아요
          </span>
        ) : null}
        <div className="rounded-lg rounded-br-xs bg-brand-tint px-3 py-2 text-sm break-keep whitespace-pre-wrap wrap-anywhere text-brand">{entry.content}</div>
        {entry.notes?.map((note, index) => (
          <div key={index} className="rounded-lg rounded-br-xs border border-brand/30 bg-surface px-3 py-1.5 text-xs break-keep whitespace-pre-wrap wrap-anywhere text-brand">
            <b className="font-semibold">덧붙임</b> · {note}
          </div>
        ))}
      </div>
    );
  }
  if (entry.role === 'failure') {
    // 사용자가 직접 멈춘 것은 실패가 아니라 경고 색 없이 보인다
    const stopped = entry.content === AI_CHAT_STOPPED_REASON;
    return (
      <div className="flex gap-3">
        <SteelmanAiStatus status={stopped ? null : steelman} seedKey={entry.id} />
        <div role={stopped ? 'status' : 'alert'} className={`flex min-w-0 flex-1 flex-col gap-2 px-3 py-2.5 text-sm ${stopped ? STOPPED_BUBBLE : FAILURE_BUBBLE}`}>
          <span className={`inline-flex items-center gap-1.5 font-semibold ${stopped ? 'text-ink-2' : 'text-danger'}`}>
            <Icon name={stopped ? 'x-circle' : 'alert'} size="sm" />
            {stopped ? '답을 멈췄어요' : '답을 받지 못했어요'}
          </span>
          {stopped ? null : <p className="leading-normal break-keep wrap-anywhere text-ink-2">{entry.content}</p>}
          <Button size="sm" icon="refresh" className="self-start" disabled={disabled} onClick={() => onRetry(entry)}>
            다시 묻기
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <SteelmanAiStatus status={steelman} seedKey={entry.id} />
      <div className={`flex min-w-0 flex-1 flex-col gap-2 px-3 py-2.5 ${ANSWER_BUBBLE}`}>
        <AiAnswerText content={entry.content} webSources={entry.webSources} className="text-sm leading-normal break-keep whitespace-pre-wrap wrap-anywhere" />
        <AiWebSources sources={entry.webSources} />
        {research?.start ? (
          <Button
            size="sm"
            variant="ghost"
            icon="search"
            className="self-start"
            disabled={research.pending}
            title="이 질문과 답, 웹 출처를 넘겨 심층 조사를 만들어요. 이미 찾은 것은 빼고 모자란 부분을 더 찾아요"
            onClick={() => research.start && research.onStart(research.start)}
          >
            심층 조사로 더 알아보기
          </Button>
        ) : null}
        {entry.cards?.length ? <AiActionCards entryId={entry.id} items={entry.cards} messageId={entry.messageId} researchSeed={research?.cardSeed ?? null} /> : null}
        {/* 웹 출처만 있는 답에 '출처 없음'을 함께 보이면 서로 어긋나 보여서, 그때는 ERP 출처 줄을 숨긴다 */}
        {entry.sources.length || !entry.webSources?.length ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-cap">
            <span className="font-semibold text-ink-2">출처</span>
            {entry.sources.length ? (
              entry.sources.map((source) => (
                <span key={`${source.kind}-${source.id}`} className="inline-flex items-center gap-1 text-ink-2">
                  <Icon name={SOURCE_ICON[source.kind]} size="sm" className="text-ink-3" />
                  {sourceText(source)}
                </span>
              ))
            ) : (
              <span className="text-ink-3">없음 · 자료에서 찾은 내용이 아니에요</span>
            )}
          </div>
        ) : null}
        <AiBrowserFramesDetails frames={entry.browserFrames} />
        <AiStepsDetails steps={entry.steps} />
        {entry.reasoningApplied === false && entry.requestedReasoning && entry.requestedReasoning !== AI_REASONING_DEFAULT ? (
          <p className="text-cap text-ink-3">이 모델은 생각 정도를 바꿀 수 없어 기본값으로 답했어요</p>
        ) : null}
        {entry.unsaved ? <p className="text-cap text-ink-3">이 질문과 답은 대화 목록에 저장하지 못했어요</p> : null}
      </div>
    </div>
  );
}

/** 답을 기다리는 동안 철강맨이 단계에 맞춰 바뀐다 (이슈 #414). 도구의 시작·끝 시각은 이 화면이 받은 때로 센다 */
function LiveAnswer({ live, seedKey }: { live: AiChatLive; seedKey: string }) {
  const maxActions = browserMaxActionsOf(useAiCapabilities().data);
  const times = useRef(new Map<string, ToolTimes>());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const status = liveSteelmanStatus(live, now, (step) => {
    const seen = times.current.get(step.id) ?? {};
    if (seen.startedAt === undefined) seen.startedAt = now;
    if (step.result && seen.endedAt === undefined) seen.endedAt = now;
    times.current.set(step.id, seen);
    return seen;
  });
  // 같은 상황이 이어지는 동안 같은 시안: 상황이 바뀔 때만 다음 열쇠로 넘어간다 (단계가 늘어도 같은 상황이면 그대로)
  const segment = useRef({ status, count: 0 });
  if (segment.current.status !== status) segment.current = { status, count: segment.current.count + 1 };
  const stepKey = `${seedKey}:${segment.current.count}`;
  return (
    <div className="flex gap-3">
      <SteelmanAiStatus status={status} seedKey={stepKey} />
      <div className={`min-w-0 flex-1 px-3 py-2.5 ${ANSWER_BUBBLE}`}>
        <AiLiveView live={live} onControl={(command) => void controlAiAgent(command)} onInput={(input) => void sendAiAgentInput(input)} maxActions={maxActions} />
      </div>
    </div>
  );
}
