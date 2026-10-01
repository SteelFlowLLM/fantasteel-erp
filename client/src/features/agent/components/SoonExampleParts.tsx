// 준비 중(P2·EX) 예시 화면이 함께 쓰는 작은 부품: 예시 표시, AI 카드, 근거·출처 줄, 작업 로그 주체, 이력 줄.
// AI가 관여하는 곳은 보라색(ai 토큰)으로, 사람이 확인한 원본·기록은 기본색으로 구분한다.
import type { ReactNode } from 'react';
import { Badge } from '@/components/Badge';
import { AiMark } from '@/components/ComingSoon';
import { Icon, type IconName } from '@/components/Icon';
import { Tag } from '@/components/Tag';
import { ACTOR_TYPE_LABEL, type ActorType } from '@/codes';
import { cn } from '@/lib/cn';

/** 화면 맨 위 '예시 화면' 안내 */
export function ExampleNotice({ text = '아래 내용은 화면 구성을 보여 주는 예시예요. 실제 데이터가 아니에요.' }: { text?: string }) {
  return (
    <div className="flex flex-none items-center gap-2">
      <Badge tone="outline">예시 화면</Badge>
      <span className="text-cap text-ink-3">{text}</span>
    </div>
  );
}

/** AI가 만든 내용을 담는 보라색 카드 (옛 hl-ai-card) */
export function AiCard({
  title,
  meta,
  actions,
  icon,
  className,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** 없으면 AI 표시 */
  icon?: IconName;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-col rounded-md border border-ai-line bg-surface shadow-1', className)}>
      <header className="flex h-11 flex-none items-center gap-2 rounded-t-md border-b border-ai-line bg-ai-bg px-4">
        {icon ? <Icon name={icon} className="text-ai-strong" /> : <AiMark size="sm" />}
        <h2 className="text-base font-semibold text-ai-strong">{title}</h2>
        {meta ? <span className="text-xs text-ink-3">{meta}</span> : null}
        {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className={cn('flex min-h-0 flex-col gap-3 p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** AI 한 줄 안내 (옛 hl-ai-brief) */
export function AiBrief({ meta, className, children }: { meta?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-none items-center gap-2.5 rounded-md border border-ai-line bg-ai-bg px-3.5 py-2 text-sm text-ai-strong [&_b]:font-semibold', className)}>
      <AiMark size="sm" />
      <p className="min-w-0 flex-1">{children}</p>
      {meta ? <span className="ml-auto flex-none text-cap text-ink-3">{meta}</span> : null}
    </div>
  );
}

export interface SourceItem {
  icon: IconName;
  label: ReactNode;
  /** 오른쪽 작은 글자 (시각·코드) */
  note?: ReactNode;
}

/** 근거·출처 줄 (옛 hl-sources). AI 답변·요약에는 늘 출처를 붙인다 (REQ-AST-009). */
export function SourceList({ label = '근거', items, caption, className }: { label?: string; items: readonly SourceItem[]; caption?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-xs', className)}>
      <span className="font-semibold text-ink-2">{label}</span>
      {caption ? <span className="text-cap text-ink-3">{caption}</span> : null}
      {items.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-1 text-ink-2">
          <Icon name={item.icon} size="sm" className="text-ink-3" />
          {item.label}
          {item.note ? <em className="text-cap text-ink-3 not-italic">{item.note}</em> : null}
        </span>
      ))}
    </div>
  );
}

/** 원본 연결 줄 (옛 hl-origin) */
export function OriginLine({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-sm bg-surface-2 px-2.5 py-2 text-xs leading-[17px] text-ink-2">
      <Icon name={icon} size="sm" className="mt-px text-ink-3" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** 작업 로그 주체: 공통 코드 ACTOR_TYPE 표시명만 쓴다 (사용자/시스템, AI 주체 없음) */
export function ActorTag({ actorType }: { actorType: ActorType }) {
  return (
    <Tag tone={actorType === 'SYSTEM' ? 'neutral' : 'brand'} size="sm">
      {ACTOR_TYPE_LABEL[actorType]}
    </Tag>
  );
}

/** 작업 로그 이벤트 이름 (옛 hl-evt) */
export function EventName({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium text-ink-3">{children}</span>;
}

/** 'AI 경유' 표시 (TRM-103) */
export function AiAssistedTag() {
  return (
    <span className="inline-flex h-4 items-center rounded-xs bg-ai-bg px-1 text-[10px] font-semibold text-ai-strong">AI 경유</span>
  );
}

/** 끄트머리 잠금 안내 (옛 hl-lockhint) */
export function LockHint({ icon = 'lock', className, children }: { icon?: IconName; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-cap text-ink-3', className)}>
      <Icon name={icon} size="sm" />
      {children}
    </span>
  );
}

/** 작은 숫자 칸 (옛 hl-figure) */
export function Figure({ label, value, unit, danger }: { label: ReactNode; value: ReactNode; unit?: string; danger?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-sm bg-surface-2 px-3 py-2">
      <span className="text-cap text-ink-3">{label}</span>
      <b className={cn('text-xl font-semibold tabular-nums', danger ? 'text-danger' : 'text-ink')}>
        {value}
        {unit ? <small className="ml-0.5 text-xs font-medium text-ink-3">{unit}</small> : null}
      </b>
    </div>
  );
}

/** 목록 칸의 날짜 묶음 머리 (옛 hl-daysep) */
export function DaySeparator({ children }: { children: ReactNode }) {
  return <div className="px-4 pt-2.5 pb-1 text-cap font-semibold text-ink-3">{children}</div>;
}

/** 목록 칸의 한 줄 (옛 hl-mitem). active면 선택 표시. */
export function MasterItem({ active, muted, className, children }: { active?: boolean; muted?: boolean; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border-b border-line px-4 py-2.5',
        active && 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)]',
        muted && 'opacity-70',
        className,
      )}
    >
      {children}
    </div>
  );
}
