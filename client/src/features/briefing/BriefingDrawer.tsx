'use client';

// 카드를 누르면 오른쪽에서 나오는 근거 창: 철강맨 메모, 근거 표, 규칙 조건식, 그 화면으로 가는 단추.
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { BriefingFaceImage } from '@/features/briefing/BriefingFaceImage';
import { DetailCell, EmphasisText, SeverityChip, isCodeCell } from '@/features/briefing/BriefingParts';
import type { BriefingCard, BriefingLink } from '@/features/briefing/lib/briefingRules';
import { cn } from '@/lib/cn';

const VALUE_TEXT = { danger: 'text-danger', wait: 'text-wait', run: 'text-run', ok: 'text-ok' } as const;

export function BriefingDrawer({ card, faceSeed, basis, onBack, onGo }: { card: BriefingCard; faceSeed: string; basis: string; onBack: () => void; onGo: (link: BriefingLink) => void }) {
  const d = card.detail;
  const titleId = `briefing-drawer-${card.key}`;
  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-[58] bg-[rgba(22,32,43,0.28)]" onMouseDown={onBack} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="briefing-drawer-in fixed inset-y-0 right-0 z-[59] flex w-[min(860px,calc(100dvw/var(--app-zoom)))] flex-col bg-surface shadow-[-16px_0_40px_rgba(10,16,24,0.22)]"
      >
        <div className="flex items-start gap-3 border-b border-line px-4.5 pt-3.5 pb-3">
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-cap text-ink-3">{d.crumb} · 철강맨 브리핑에서 열림</div>
            <h3 id={titleId} className="flex flex-wrap items-center gap-2 text-xl font-bold">
              <SeverityChip severity={card.severity} />
              {card.title}
              <span className={cn('font-extrabold', VALUE_TEXT[card.severity])}>{card.value}</span>
            </h3>
            <div className="mt-1 text-[11.5px] text-ink-3">
              규칙 <code className="rounded-xs border border-ai-line bg-ai-bg px-1.5 font-mono text-cap text-ai-strong">{d.ruleExpr}</code> · {basis} 기준
            </div>
          </div>
          <IconButton icon="x" label="근거 창 닫기" size="sm" onClick={onBack} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4.5 py-3.5">
          <div className="flex items-start gap-3 rounded-md border border-ai-line bg-ai-bg px-3 py-2.5">
            <span className="size-16 flex-none overflow-hidden rounded-lg bg-nav-dark">
              <BriefingFaceImage face={card.severity} seed={faceSeed} size={64} />
            </span>
            <div>
              <h4 className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-ai-strong">
                철강맨 메모 <span className="rounded-xs bg-surface-3 px-1.5 text-cap font-semibold text-ink-3">규칙으로 만든 문장</span>
              </h4>
              <p className="text-sm leading-5 text-ink">
                <EmphasisText text={d.memo} mono />
              </p>
            </div>
          </div>

          <div className="overflow-auto rounded-md border border-line">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {d.columns.map((c) => (
                    <th key={c.label} className={cn('whitespace-nowrap border-b border-line bg-surface-2 px-2.5 py-1.5 text-left text-[11.5px] font-semibold text-ink-3', c.numeric && 'text-right')}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((row, ri) => (
                  <tr key={ri} className={cn(row.highlight && 'bg-ai-bg [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-ai)]')}>
                    {row.cells.map((cell, ci) => (
                      <td key={ci} className={cn('border-b border-surface-3 px-2.5 py-2 align-middle text-ink', d.columns[ci]?.numeric && 'text-right tabular-nums', isCodeCell(cell) && 'whitespace-nowrap font-mono text-mono')}>
                        <DetailCell cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.note ? <p className="text-[11.5px] text-ink-3">{d.note}</p> : null}
        </div>

        <div className="flex items-center gap-2 border-t border-line bg-surface-2 px-4.5 py-3">
          <Button variant="ghost" onClick={onBack}>
            ← 브리핑으로
          </Button>
          <span className="flex-1" />
          {d.secondary ? <Button onClick={() => onGo(d.secondary as BriefingLink)}>{d.secondary.label}</Button> : null}
          <Button variant="primary" icon="arrow-right" onClick={() => onGo(d.primary)}>
            {d.primary.label}
          </Button>
        </div>
      </aside>
    </>
  );
}
