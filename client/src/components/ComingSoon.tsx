// P2·EX '준비 중' 표시: 디자인(버튼·화면)은 남기고 기능은 뺀다 (SPEC 1장).
import type { ReactNode } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/Button';
import { cn } from '@/lib/cn';
import { withEunNeun } from '@/lib/josa';

/** P2 = 2등급(AI), EX = 추가 기능, AI = 등급 표시 없이 '준비 중'만 (예: Message → ERP의 AI 자동 추출) */
export type SoonGrade = 'P2' | 'EX' | 'AI';

export const soonLabel = (grade: SoonGrade): string => (grade === 'AI' ? '준비 중' : `준비 중 (${grade})`);

export function ComingSoon({ grade = 'P2', className }: { grade?: SoonGrade; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] bg-surface-3 px-1.5 py-px text-2xs font-semibold text-ink-3', className)}>
      {soonLabel(grade)}
    </span>
  );
}

/** 준비 중 안내 띠 (점선 테두리) */
export function SoonBanner({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-md border border-dashed border-line-strong bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2 [&_b]:font-semibold', className)}>
      {children}
    </div>
  );
}

/** 준비 중 화면·영역: 위에 안내 띠를 두르고, 본문(디자인)은 흐리게·조작 불가로 보인다. */
export function ComingSoonArea({ grade = 'P2', title, className, children }: { grade?: Exclude<SoonGrade, 'AI'>; title: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}>
      <SoonBanner>
        <ComingSoon grade={grade} />
        <span>
          <b>{withEunNeun(title)}</b> {grade === 'P2' ? '2등급(AI) 기능' : '추가 기능'}이라 지금은 화면만 볼 수 있어요. 1등급 기능이 끝난 뒤 하나씩 추가돼요.
        </span>
      </SoonBanner>
      <div aria-hidden="true" inert className="pointer-events-none flex min-h-0 flex-1 flex-col gap-4 opacity-[0.62] grayscale-25 select-none">
        {children}
      </div>
    </div>
  );
}

/** 준비 중 버튼: 늘 막혀 있고, 글자 뒤에 '준비 중'이 붙는다. */
export function SoonButton({ grade = 'P2', variant, size, className, children }: { grade?: SoonGrade; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode }) {
  return (
    <Button variant={variant} size={size} className={className} disabled title={soonLabel(grade)}>
      {children}
      <ComingSoon grade={grade} />
    </Button>
  );
}

/** AI 표시 (옛 hl-aimark): AI가 관여하는 곳은 늘 보라색으로 구분한다 */
export function AiMark({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-sm bg-ai font-mono leading-none font-semibold tracking-[0.02em] text-white',
        size === 'sm' && 'size-5 text-[9px]',
        size === 'md' && 'size-6 text-2xs',
        size === 'lg' && 'size-8 text-xs',
        className,
      )}
    >
      AI
    </span>
  );
}

