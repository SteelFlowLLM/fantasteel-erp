// 카드 (옛 hl-card · hl-card__head · __body · __foot)
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps {
  className?: string;
  /** 화면 도우미 펫이 이 카드를 설명할 때 쓰는 키 (public/pet/guide/의 'card:<화면 키>.<이름>') */
  petKey?: string;
  children: ReactNode;
}

// 카드 윗면은 화면 도우미 펫이 올라가 걷고 앉는 면이다(data-pet-perch)
export function Card({ className, petKey, children }: CardProps) {
  return (
    <section data-pet-perch="" data-pet-target={petKey} className={cn('flex min-h-0 min-w-0 flex-col rounded-md border border-line bg-surface shadow-1', className)}>
      {children}
    </section>
  );
}

export interface CardHeadProps {
  title: ReactNode;
  /** 제목 옆 작은 글자 (건수·부제) */
  meta?: ReactNode;
  /** 오른쪽 버튼 자리 */
  actions?: ReactNode;
  className?: string;
}

export function CardHead({ title, meta, actions, className }: CardHeadProps) {
  return (
    <header className={cn('flex h-11 flex-none items-center gap-2 border-b border-line px-4', className)}>
      <h2 className="text-base font-semibold">{title}</h2>
      {meta ? <span className="text-xs text-ink-3">{meta}</span> : null}
      {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ flush, className, children }: { flush?: boolean; className?: string; children: ReactNode }) {
  return <div className={cn('flex min-h-0 flex-col', flush ? 'gap-0 p-0' : 'gap-3 p-4', className)}>{children}</div>;
}

export function CardFoot({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <footer className={cn('flex flex-none items-center gap-2 rounded-b-md border-t border-line bg-surface-2 px-4 py-2.5', className)}>{children}</footer>
  );
}
