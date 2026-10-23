'use client';

// 철강맨 아침 브리핑 창 (시안 "철강맨 아침 브리핑"). 철강맨이 인사 → 생각 → 조회 → 읽기 → 정리 → 설명 → 끝 순서로 움직이고,
// 왼쪽 "읽은 자료"는 실제 조회가 끝나는 대로 체크된다. 카드는 하나씩 열리며 철강맨이 말풍선으로 읽어 준다.
import { AI_BRIEFING_QUESTION } from '@fantasteel/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ROLE_LABEL } from '@/codes';
import { BriefingDrawer } from '@/features/briefing/BriefingDrawer';
import { BriefingFaceImage } from '@/features/briefing/BriefingFaceImage';
import { BriefingCardButton, EmphasisText, SEVERITY_DOT, SkeletonCard } from '@/features/briefing/BriefingParts';
import { briefingFaceSources, type BriefingFace } from '@/features/briefing/lib/briefingFaces';
import {
  BRIEFING_SEVERITY_LABEL,
  BRIEFING_SOURCE_LABEL,
  briefingCountLabel,
  briefingDateText,
  briefingGreeting,
  briefingRuleCount,
  briefingSourceCount,
  buildBriefingCards,
  plainLength,
  splitEmphasis,
  visibleEmphasis,
  type BriefingCard,
  type BriefingLink,
  type BriefingSeverity,
  type BriefingSourceKey,
} from '@/features/briefing/lib/briefingRules';
import { BriefingCancelled, createBriefingRunner, typingPause } from '@/features/briefing/lib/briefingRunner';
import { useBriefingSources } from '@/features/briefing/useBriefingSources';
import { useMe } from '@/hooks/useMe';
import { cn } from '@/lib/cn';
import { todayStr } from '@/lib/format';
import { isDepartmentHead } from '@/lib/permissions';
import { seoulDateParts } from '@/lib/seoulDate';
import { useBriefingStore } from '@/stores/useBriefingStore';
import { useShellStore } from '@/stores/useShellStore';

const PHASES = ['인사', '생각', '조회', '읽기', '정리', '설명', '끝'] as const;
/** 자료 하나를 이만큼 기다려도 안 오면 없는 것으로 보고 넘어간다 */
const SOURCE_TIMEOUT_MS = 8_000;
const SPARK_MARK: Record<BriefingSeverity, string> = { danger: '!', wait: '?', run: 'i', ok: '♪' };
const SPARK_BG: Record<BriefingSeverity, string> = { danger: 'bg-danger', wait: 'bg-wait', run: 'bg-run', ok: 'bg-ok' };

type RowState = 'idle' | 'active' | 'done';

interface Line {
  id: number;
  text: string;
  shown: number;
  severity: BriefingSeverity | null;
}

export function BriefingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const router = useRouter();
  const head = isDepartmentHead(me);
  const seed = String(me.employeeId);
  const playId = useBriefingStore((s) => s.playId);
  const replay = useBriefingStore((s) => s.openBriefing);
  const [today] = useState(todayStr);
  const read = useBriefingSources(today, open);
  const readRef = useRef(read);
  readRef.current = read;

  const runner = useMemo(() => createBriefingRunner(), []);
  const [startedAt, setStartedAt] = useState(() => new Date());
  const [phase, setPhase] = useState(-1);
  const [status, setStatus] = useState('');
  const [face, setFaceState] = useState<{ key: BriefingFace; nonce: number }>({ key: 'greet', nonce: 0 });
  const [spark, setSpark] = useState<BriefingSeverity | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [rows, setRows] = useState<Partial<Record<BriefingSourceKey, RowState>>>({});
  const [ruleRow, setRuleRow] = useState<RowState>('idle');
  const [cards, setCards] = useState<BriefingCard[] | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [speaking, setSpeaking] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [drawer, setDrawer] = useState<number | null>(null);
  const [sourceKeys, setSourceKeys] = useState<BriefingSourceKey[]>(() => read.keys);
  const completedRef = useRef(false);
  const drawerRef = useRef<number | null>(null);
  drawerRef.current = drawer;
  const lineSeq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const setFace = useCallback((key: BriefingFace, force = false) => {
    setFaceState((prev) => (prev.key === key && !force ? prev : { key, nonce: prev.nonce + 1 }));
  }, []);
  /** 근거 창이 열려 있으면 그 카드 표정을 지킨다 */
  const faceIf = useCallback(
    (key: BriefingFace) => {
      if (drawerRef.current === null) setFace(key);
    },
    [setFace],
  );

  // 표정이 바뀔 때 빈 칸이 보이지 않게 그림을 미리 읽는다
  useEffect(() => {
    for (const src of briefingFaceSources(seed)) {
      const img = new Image();
      img.src = src;
    }
  }, [seed]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines]);

  const typeLine = useCallback(
    async (id: number, text: string, severity: BriefingSeverity | null = null) => {
      lineSeq.current += 1;
      const lineId = lineSeq.current;
      const total = plainLength(text);
      const chars = [...splitEmphasis(text).map((p) => p.text).join('')];
      setLines((prev) => [...prev, { id: lineId, text, shown: 0, severity }]);
      for (let i = 0; i < total; i += 1) {
        if (runner.isSkipping()) break;
        setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, shown: i + 1 } : l)));
        await runner.wait(id, typingPause(chars[i] ?? ''));
      }
      setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, shown: total } : l)));
    },
    [runner],
  );

  const idle = useCallback(() => {
    setFace('listening');
    setSpark(null);
    setStatus('기다리는 중 · 카드를 눌러 보세요');
  }, [setFace]);

  const play = useCallback(async () => {
    const id = runner.start();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) runner.skip();
    const keys = readRef.current.keys;
    completedRef.current = false;
    setStartedAt(new Date());
    setSourceKeys(keys);
    setLines([]);
    setRows({});
    setRuleRow('idle');
    setCards(null);
    setRevealed(0);
    setSpeaking(-1);
    setSpark(null);
    setPlaying(true);
    try {
      setFace('greet', true);
      setPhase(0);
      setStatus('인사하는 중');
      await runner.wait(id, 120);
      await typeLine(id, `**${me.employeeName} ${me.jobGradeName}님**, ${briefingGreeting(seoulDateParts(new Date()).hour)} 철강맨이에요.`);
      await runner.wait(id, 250);

      faceIf('thinking');
      setPhase(1);
      setStatus('오늘 볼 것을 고르는 중…');
      await typeLine(id, `오늘 ${ROLE_LABEL[me.roleCode]} 브리핑을 준비할게요. 잠깐만요…`);
      await runner.wait(id, 200);

      faceIf('searching');
      setPhase(2);
      for (const key of keys) {
        setRows((prev) => ({ ...prev, [key]: 'active' }));
        setStatus(`${BRIEFING_SOURCE_LABEL[key]} 조회 중…`);
        await runner.wait(id, 140);
        const deadline = Date.now() + SOURCE_TIMEOUT_MS;
        while (readRef.current.state[key] === 'loading' && Date.now() < deadline) await runner.pause(id, 120);
        setRows((prev) => ({ ...prev, [key]: 'done' }));
      }

      faceIf('reading');
      setPhase(3);
      setRuleRow('active');
      setStatus(`규칙 ${briefingRuleCount(me.roleCode, head)}개에 맞춰 읽는 중…`);
      await runner.wait(id, 350);
      const built = buildBriefingCards(me.roleCode, readRef.current.sources, head);
      setCards(built);
      setRuleRow('done');

      faceIf('found');
      setPhase(4);
      setStatus(`${built.length}건 찾음!`);
      await typeLine(id, built[0]?.key === 'quiet' ? '다 읽었어요! 오늘은 급하게 볼 일이 없어요.' : `다 찾았어요! 오늘 꼭 볼 것 **${built.length}가지**예요.`);
      await runner.wait(id, 250);

      setPhase(5);
      for (let i = 0; i < built.length; i += 1) {
        const card = built[i];
        setRevealed(i + 1);
        setSpeaking(i);
        faceIf(card.severity);
        if (drawerRef.current === null) setSpark(card.severity);
        setStatus(`${i + 1} / ${built.length} · ${card.title}`);
        await typeLine(id, card.say, card.severity);
        await runner.wait(id, 350);
      }
      setSpeaking(-1);
      if (drawerRef.current === null) setSpark(null);

      faceIf('done');
      setPhase(6);
      setStatus('브리핑 끝!');
      await typeLine(id, '오늘 브리핑은 여기까지예요. 카드를 누르면 근거와 바로 가는 길을 보여 드릴게요!');
      setPlaying(false);
      completedRef.current = true;
      runner.finish(id);
      await runner.wait(id, 2600);
      if (drawerRef.current === null) idle();
    } catch (error) {
      if (!(error instanceof BriefingCancelled)) throw error;
    }
  }, [runner, faceIf, setFace, typeLine, me, head, idle]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    void play();
    return () => {
      runner.cancel();
      setPlaying(false);
      setDrawer(null);
    };
    // 열릴 때와 다시 듣기(playId)에만 처음부터 다시 돈다
  }, [open, playId]);

  const close = onClose;

  const openDrawer = (index: number) => {
    const card = cards?.[index];
    if (!card) return;
    if (playing) runner.skip();
    setDrawer(index);
    setFace(card.severity);
    setSpark(card.severity);
    setStatus(`${card.title} 근거를 열어 뒀어요`);
  };

  const closeDrawer = useCallback(() => {
    setDrawer(null);
    if (completedRef.current) idle();
  }, [idle]);

  const peek = (card: BriefingCard) => {
    if (playing || drawer !== null) return;
    setFace(card.severity);
    setSpark(card.severity);
    setStatus(`${card.title} · 근거를 열어 볼까요?`);
  };
  const unpeek = () => {
    if (playing || drawer !== null || !completedRef.current) return;
    idle();
  };

  const go = (link: BriefingLink) => {
    router.push(link.href);
    setDrawer(null);
    close();
  };

  const askAi = () => {
    useShellStore.getState().openAiPanel({ label: '철강맨 아침 브리핑', question: AI_BRIEFING_QUESTION });
    close();
  };

  useEffect(() => {
    if (!open) return;
    // 창이 맨 위에 있으니 키를 먼저 받는다(capture). 펫 대화창 입력칸에 초점이 남아 있어도 Esc로 닫힌다
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (drawerRef.current !== null) closeDrawer();
        else close();
      } else if (event.key === ' ' && playing && (document.activeElement === panelRef.current || document.activeElement === document.body)) {
        event.preventDefault();
        runner.skip();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, playing, runner, close, closeDrawer]);

  const ruleCount = briefingRuleCount(me.roleCode, head);
  const drawerCard = drawer !== null ? cards?.[drawer] : undefined;
  const basis = briefingDateText(startedAt);

  return (
    <div
      className={cn('fixed inset-0 z-[56] flex items-center justify-center bg-[rgba(22,32,43,0.44)] p-4', !open && 'hidden')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="briefing-title"
        tabIndex={-1}
        className="briefing-in relative flex max-h-[calc(100dvh/var(--app-zoom)-64px)] w-[min(980px,calc(100dvw/var(--app-zoom)-32px))] flex-col overflow-hidden rounded-lg bg-surface shadow-[0_24px_60px_rgba(10,16,24,0.35),0_0_0_1px_rgba(18,24,32,0.08)] outline-none"
      >
        <header className="flex items-center gap-3 border-b border-line bg-gradient-to-b from-[#fbfaff] to-surface px-4 py-3 max-md:flex-wrap">
          <span className="grid size-[34px] flex-none place-items-center overflow-hidden rounded-[7px] bg-nav-dark">
            <BriefingFaceImage face="listening" seed={seed} size={32} />
          </span>
          <div className="min-w-0 max-md:flex-[1_1_calc(100%-100px)]">
            <h2 id="briefing-title" className="flex items-center gap-2 text-lg font-extrabold tracking-[-0.01em]">
              철강맨 아침 브리핑
            </h2>
            <p className="text-xs text-ink-3">
              {me.departmentName} · {me.employeeName} {me.jobGradeName}님 · {basis}
            </p>
          </div>
          <span className="flex-1 max-md:hidden" />
          <span
            tabIndex={0}
            aria-describedby="briefing-rule-tip"
            className="group relative inline-flex cursor-help items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-ai-line bg-ai-bg py-1 pr-2.5 pl-2 text-[11.5px] font-semibold text-ai-strong max-md:order-5"
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-ai shadow-[0_0_0_2px_#fff]" />
            규칙 기반 브리핑
            <Icon name="info" size="sm" />
            <span
              id="briefing-rule-tip"
              role="tooltip"
              className="pointer-events-none absolute top-[calc(100%+8px)] right-0 z-10 w-[330px] cursor-default whitespace-normal rounded-lg bg-nav-dark px-3.5 py-3 text-xs font-normal leading-[18px] text-[#dfe6ee] opacity-0 shadow-pop transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus:opacity-100 max-md:right-auto max-md:left-0"
            >
              <b className="mb-1.5 block text-[12.5px] text-white">이 문장은 규칙으로 만들어요</b>
              AI를 부르지 않고, 정해 둔 <b className="text-white">조건에 맞는 데이터</b>를 찾아 정해 둔 <b className="text-white">문장 틀</b>에 숫자만 채워요. 같은 데이터면 늘 같은 문장이 나와요.
              {cards ? (
                <span className="my-2 flex flex-col gap-1">
                  {cards.slice(0, 3).map((c) => (
                    <span key={c.key} className="block rounded-sm bg-nav-dark-2 px-2 py-1 text-[11.5px]">
                      <code className="font-mono text-cap text-ai-line">{c.detail.ruleExpr}</code>
                      <br />→ &quot;{c.title} {c.value}&quot;
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="mt-1.5 block text-cap text-ink-disabled">더 자세한 설명은 아래 [철강맨AI에게 묻기]로 들을 수 있어요.</span>
            </span>
          </span>
          <IconButton icon="x" label="브리핑 닫기" size="sm" onClick={close} />
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[224px_1fr] overflow-auto max-md:grid-cols-1">
          <div className="flex flex-col items-center gap-3 border-r border-line bg-surface-2 px-4 pt-4.5 pb-4 max-md:flex-row max-md:flex-wrap max-md:justify-center max-md:border-r-0 max-md:border-b max-md:py-3">
            <div className="relative size-48 flex-none overflow-hidden rounded-xl bg-nav-dark shadow-[inset_0_-18px_0_rgba(255,255,255,0.03)] max-md:size-24 max-md:rounded-lg">
              <BriefingFaceImage
                key={face.nonce}
                face={face.key}
                seed={seed}
                size={192}
                className="briefing-pop absolute inset-0 size-full! max-md:size-24!"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-2.5 right-2.5 rounded-xs px-1.5 text-cap text-white transition-[opacity,transform] duration-200',
                  spark ? cn('opacity-100', SPARK_BG[spark]) : 'translate-y-1 opacity-0',
                )}
              >
                {spark ? `${BRIEFING_SEVERITY_LABEL[spark]} ${SPARK_MARK[spark]}` : ''}
              </span>
            </div>
            <div className="min-h-4 w-full text-center text-cap text-ink-2 max-md:flex-[1_1_140px] max-md:text-left" aria-live="polite">
              {status || ' '}
            </div>
            <div className="flex w-full gap-[3px] max-md:order-3">
              {PHASES.map((p, i) => (
                <div key={p} className={cn('flex-1 text-center text-[10px] leading-[13px]', i === phase ? 'font-bold text-ai-strong' : 'text-ink-disabled')}>
                  <span className={cn('mb-[3px] block h-[5px] rounded-[1px] transition-colors', i < phase ? 'bg-chart-3' : i === phase ? 'bg-ai' : 'bg-line')} />
                  {p}
                </div>
              ))}
            </div>
            <div className="w-full rounded-md border border-line bg-surface px-2 py-1.5 max-md:hidden">
              <h5 className="mb-1 flex justify-between text-cap font-semibold text-ink-3">
                <span>읽은 자료</span>
                <span>{basis.slice(-5)}</span>
              </h5>
              {sourceKeys.map((key) => (
                <SourceRow key={key} label={BRIEFING_SOURCE_LABEL[key]} value={briefingSourceCount(read.sources, key)} state={rows[key] ?? 'idle'} />
              ))}
              <SourceRow label="브리핑 규칙" value={`${ruleCount}개`} state={ruleRow} rule />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3.5 px-4.5 pt-4.5 pb-4 pl-5.5 max-md:px-4">
            <div className="relative">
              <span className="absolute -top-2.5 left-3 z-[3] border-2 border-nav-dark bg-steelman px-[7px] text-cap leading-4 text-white">철강맨</span>
              {playing ? (
                <button
                  type="button"
                  title="남은 말을 한 번에 보여 줘요 (Space)"
                  className="absolute -top-3 right-3 z-[3] inline-flex items-center gap-1 border-2 border-nav-dark bg-surface px-2 text-cap font-bold leading-4 text-ink shadow-[2px_2px_0_rgba(27,37,49,0.15)] hover:bg-steelman-soft"
                  onClick={() => runner.skip()}
                >
                  건너뛰기 ▶▶
                </button>
              ) : null}
              <svg aria-hidden="true" className="absolute top-[30px] -left-3.5 z-[2] size-4 max-md:hidden" viewBox="0 0 8 8" shapeRendering="crispEdges">
                <path fill="#16202b" d="M7 0h1v1h-1z M5 1h2v1h-2z M3 2h2v1h-2z M1 3h2v1h-2z M0 4h1v1h-1z M1 5h2v1h-2z M3 6h2v1h-2z M5 7h3v1h-3z" />
                <path fill="#fff" d="M7 1h1v1h-1z M5 2h3v1h-3z M3 3h5v1h-5z M1 4h7v1h-7z M3 5h5v1h-5z M5 6h3v1h-3z" />
              </svg>
              <div className="rounded-[3px] border-2 border-nav-dark bg-surface text-sm leading-[21px] text-ink shadow-[4px_4px_0_rgba(27,37,49,0.12)]">
                <div ref={logRef} className="briefing-log h-39 overflow-auto px-3.5 pt-4 pb-3" aria-live="polite">
                  {lines.map((line, index) => {
                    const typing = line.shown < plainLength(line.text);
                    return (
                      <p key={line.id} className={cn('mb-1.5 transition-opacity duration-300 last:mb-0', index < lines.length - 1 && 'opacity-45')}>
                        {line.severity ? <span aria-hidden="true" className={cn('mr-1.5 inline-block size-[7px] align-[1px]', SEVERITY_DOT[line.severity])} /> : null}
                        <EmphasisText parts={visibleEmphasis(line.text, line.shown)} tone={line.severity ?? 'ai'} />
                        {typing ? <span aria-hidden="true" className="briefing-caret" /> : null}
                      </p>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="-mb-1.5 flex items-center gap-2 text-xs text-ink-3">
              <b className="text-sm text-ink">오늘 꼭 볼 것</b>
              <span>{cards ? briefingCountLabel(cards) : '준비 중…'}</span>
              <span className="flex-1" />
              <span className="max-md:hidden">카드를 누르면 근거를 보여 줘요</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
              {cards
                ? cards.map((card, index) =>
                    index < revealed ? (
                      <BriefingCardButton
                        key={card.key}
                        card={card}
                        speaking={index === speaking}
                        animate={playing}
                        onOpen={() => openDrawer(index)}
                        onPeek={() => peek(card)}
                        onUnpeek={unpeek}
                      />
                    ) : (
                      <SkeletonCard key={card.key} />
                    ),
                  )
                : [0, 1, 2, 3].map((n) => <SkeletonCard key={n} />)}
            </div>
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-line bg-surface-2 px-4 py-2.5">
          <span className="min-w-0 truncate text-cap text-ink-disabled max-md:hidden">
            <b className="font-semibold text-ink-3">규칙 기반</b> · 숫자는 지금 ERP 데이터 · 볼 수 있는 자료만 읽어요
          </span>
          <span className="flex-1" />
          {playing ? (
            <Button onClick={() => runner.skip()}>
              건너뛰기 ▶▶
            </Button>
          ) : null}
          <Button icon="refresh" onClick={replay}>
            다시 듣기
          </Button>
          <Button variant="ai-outline" onClick={askAi}>
            철강맨AI에게 묻기
          </Button>
          <Button variant="primary" onClick={close}>
            닫기
          </Button>
        </footer>
      </section>

      {open && drawerCard ? <BriefingDrawer card={drawerCard} faceSeed={seed} basis={basis} onBack={closeDrawer} onGo={go} /> : null}
    </div>
  );
}

function SourceRow({ label, value, state, rule = false }: { label: string; value: string; state: RowState; rule?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-[7px] py-[3px] text-xs transition-colors duration-200',
        rule && 'mt-[3px] border-t border-dashed border-line pt-1.5',
        state === 'active' ? 'text-run' : state === 'done' ? (rule ? 'text-ai-strong' : 'text-ink-2') : 'text-ink-disabled',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-3 flex-none place-items-center rounded-xs border-2 transition-colors',
          state === 'active' && 'briefing-spin border-run',
          state === 'done' && (rule ? 'border-ai bg-ai' : 'border-ok bg-ok'),
          state === 'idle' && 'border-line-strong',
        )}
      >
        {state === 'done' ? <span className="mb-px h-[3px] w-[5px] -rotate-45 border-b-2 border-l-2 border-white" /> : null}
      </span>
      {label}
      <b className="ml-auto font-mono text-[11.5px] font-semibold">{state === 'done' ? value : ''}</b>
    </div>
  );
}
