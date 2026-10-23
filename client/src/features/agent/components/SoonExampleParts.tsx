// 준비 중(P2·EX) 예시 화면이 함께 쓰는 작은 부품: 예시 표시, AI 카드, 작업 로그 주체, 이력 줄.
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
  petKey,
  tone = 'ai',
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** 없으면 AI 표시 */
  icon?: IconName;
  className?: string;
  bodyClassName?: string;
  /** 화면 도우미 펫 설명 키 (Card와 같이 윗면은 펫이 올라가는 면) */
  petKey?: string;
  /** 철강맨AI 주황색이 필요한 화면(Agent)에서 쓴다 */
  tone?: 'ai' | 'steelman';
  children: ReactNode;
}) {
  const orange = tone === 'steelman';
  return (
    <section data-pet-perch="" data-pet-target={petKey} className={cn('flex min-h-0 min-w-0 flex-col rounded-md border bg-surface shadow-1', orange ? 'border-steelman-shadow' : 'border-ai-line', className)}>
      <header className={cn('flex h-11 flex-none items-center gap-2 rounded-t-md border-b px-4', orange ? 'border-steelman-shadow bg-steelman-soft' : 'border-ai-line bg-ai-bg')}>
        {icon ? <Icon name={icon} className={orange ? 'text-steelman-ink' : 'text-ai-strong'} /> : <AiMark size="sm" tone={tone} />}
        <h2 className={cn('text-base font-semibold', orange ? 'text-steelman-ink' : 'text-ai-strong')}>{title}</h2>
        {meta ? <span className="text-xs text-ink-3">{meta}</span> : null}
        {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className={cn('flex min-h-0 flex-col gap-3 p-4', bodyClassName)}>{children}</div>
    </section>
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
    <span className="inline-flex min-h-4 items-center rounded-xs bg-ai-bg px-1 text-2xs font-semibold text-ai-strong">AI 경유</span>
  );
}

/** 목록 칸의 한 줄 (옛 hl-mitem). active면 선택 표시. petItem·petTitle은 화면 도우미 펫이 읽는 항목 종류(용어 사전 변수명)와 제목. */
export function MasterItem({
  active,
  muted,
  petItem,
  petTitle,
  className,
  children,
}: {
  active?: boolean;
  muted?: boolean;
  petItem?: string;
  petTitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-pet-item={petItem}
      data-pet-item-title={petTitle}
      className={cn(
        'flex flex-col gap-1 border-b border-line px-4 py-2.5',
        active && 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint-hover',
        muted && 'opacity-70',
        className,
      )}
    >
      {children}
    </div>
  );
}
