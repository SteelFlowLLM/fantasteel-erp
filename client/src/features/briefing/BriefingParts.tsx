// 아침 브리핑의 작은 조각: 심각도 꼬리표, 강조 글, 카드, 빈 카드, 근거 표 칸.
// 색 클래스는 Tailwind가 찾을 수 있게 심각도마다 글자 그대로 둔다.
import type { ReactNode } from 'react';
import { BRIEFING_SEVERITY_LABEL, splitEmphasis, type BriefingCard, type BriefingCell, type BriefingSeverity } from '@/features/briefing/lib/briefingRules';
import { cn } from '@/lib/cn';

type Tone = BriefingSeverity | 'mute';

const CHIP: Record<Tone, string> = {
  danger: 'bg-danger-bg text-danger',
  wait: 'bg-wait-bg text-wait',
  run: 'bg-run-bg text-run',
  ok: 'bg-ok-bg text-ok',
  mute: 'bg-surface-3 text-ink-3',
};

/** 강조(**…**) 색: 심각도별, 없으면 AI 보라 */
const EMPHASIS: Record<BriefingSeverity | 'ai', string> = {
  danger: 'text-danger bg-[linear-gradient(transparent_62%,var(--color-danger-bg)_62%)]',
  wait: 'text-wait bg-[linear-gradient(transparent_62%,var(--color-wait-bg)_62%)]',
  run: 'text-run bg-[linear-gradient(transparent_62%,var(--color-run-bg)_62%)]',
  ok: 'text-ok bg-[linear-gradient(transparent_62%,var(--color-ok-bg)_62%)]',
  ai: 'text-ai-strong bg-[linear-gradient(transparent_62%,var(--color-ai-bg)_62%)]',
};

export const SEVERITY_DOT: Record<BriefingSeverity, string> = { danger: 'bg-danger', wait: 'bg-wait', run: 'bg-run', ok: 'bg-ok' };
const SEVERITY_BAR = SEVERITY_DOT;
const SEVERITY_TEXT: Record<BriefingSeverity, string> = { danger: 'text-danger', wait: 'text-wait', run: 'text-run', ok: 'text-ok' };
const SEVERITY_SPEAKING: Record<BriefingSeverity, string> = {
  danger: 'border-danger shadow-[0_0_0_3px_var(--color-danger-bg),0_6px_18px_rgba(18,24,32,0.1)]',
  wait: 'border-wait shadow-[0_0_0_3px_var(--color-wait-bg),0_6px_18px_rgba(18,24,32,0.1)]',
  run: 'border-run shadow-[0_0_0_3px_var(--color-run-bg),0_6px_18px_rgba(18,24,32,0.1)]',
  ok: 'border-ok shadow-[0_0_0_3px_var(--color-ok-bg),0_6px_18px_rgba(18,24,32,0.1)]',
};

export function ToneChip({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-xs px-1.5 text-cap font-bold', CHIP[tone], className)}>{children}</span>;
}

export function SeverityChip({ severity }: { severity: BriefingSeverity }) {
  return <ToneChip tone={severity}>{BRIEFING_SEVERITY_LABEL[severity]}</ToneChip>;
}

/** **강조**가 들어 있는 글. tone = 말풍선 강조색, mono = 카드 요약처럼 번호를 고정폭으로 */
export function EmphasisText({ text, parts, tone = 'ai', mono = false }: { text?: string; parts?: { text: string; em: boolean }[]; tone?: BriefingSeverity | 'ai'; mono?: boolean }) {
  const pieces = parts ?? splitEmphasis(text ?? '');
  return (
    <>
      {pieces.map((part, index) =>
        part.em ? (
          <em key={index} className={cn('font-semibold not-italic', mono ? 'font-mono text-mono text-ink' : EMPHASIS[tone])}>
            {part.text}
          </em>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function BriefingCardButton({
  card,
  speaking,
  animate,
  onOpen,
  onPeek,
  onUnpeek,
}: {
  card: BriefingCard;
  speaking: boolean;
  animate: boolean;
  onOpen: () => void;
  onPeek: () => void;
  onUnpeek: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${BRIEFING_SEVERITY_LABEL[card.severity]} · ${card.title} ${card.value} · 근거 열기`}
      data-briefing-card={card.key}
      className={cn(
        'relative flex min-h-26 flex-col gap-1.5 rounded-md border border-line bg-surface py-2.5 pr-3 pl-4 text-left transition-[box-shadow,border-color,transform] duration-200',
        'hover:-translate-y-px hover:border-line-strong hover:shadow-[0_4px_14px_rgba(18,24,32,0.1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        speaking && SEVERITY_SPEAKING[card.severity],
        animate && 'briefing-card-in',
      )}
      onClick={onOpen}
      onMouseEnter={onPeek}
      onFocus={onPeek}
      onMouseLeave={onUnpeek}
      onBlur={onUnpeek}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1 rounded-l-md', SEVERITY_BAR[card.severity])} />
      {speaking ? (
        <span aria-hidden="true" className="absolute -top-2.5 right-2.5 bg-nav-dark px-1.5 text-2xs text-white">
          말하는 중
        </span>
      ) : null}
      <span className="flex items-center gap-2">
        <SeverityChip severity={card.severity} />
        <span className="text-[13.5px] font-bold text-ink">{card.title}</span>
        <span className={cn('ml-auto whitespace-nowrap text-[17px] font-extrabold tracking-[-0.02em]', SEVERITY_TEXT[card.severity])}>{card.value}</span>
      </span>
      <span className="text-[12.5px] leading-[18px] text-ink-2">
        <EmphasisText text={card.summary} mono />
      </span>
      <span className="mt-auto flex items-center gap-2">
        <span className="min-w-0 truncate text-2xs text-ink-disabled">
          <span className="font-semibold text-ai">규칙 · </span>
          {card.rule}
        </span>
        <span className="ml-auto flex-none text-xs font-bold text-brand">근거 열기 →</span>
      </span>
    </button>
  );
}

export function SkeletonCard() {
  return (
    <div aria-hidden="true" className="flex min-h-26 flex-col gap-2 rounded-md border border-dashed border-line bg-surface-2 px-3.5 py-3">
      <i className="briefing-skeleton block h-2.5 w-[46%] rounded-xs" />
      <i className="briefing-skeleton block h-2.5 w-[88%] rounded-xs" />
      <i className="briefing-skeleton block h-2.5 w-[64%] rounded-xs" />
    </div>
  );
}

/** 번호(SO-2610-001, HT-BOF1-…, DR-…, CBOF1-…)처럼 보이는 칸은 고정폭으로 */
export const isCodeCell = (cell: BriefingCell): boolean => typeof cell === 'string' && /^[A-Z][A-Z0-9]*-[A-Z0-9-]+$/.test(cell);

export function DetailCell({ cell }: { cell: BriefingCell }) {
  if (typeof cell === 'string') return <>{cell}</>;
  return <ToneChip tone={cell.tone}>{cell.text}</ToneChip>;
}
