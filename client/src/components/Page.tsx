// 화면 틀: 셸 본문 안에 들어가는 영역 (옛 hl-main · hl-master · hl-page-head)
// 목록|상세 화면은 <MasterPane>…</MasterPane><PageMain>…</PageMain>, 한 영역 화면은 <PageMain>만 쓴다.
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function PageMain({ flush, className, children }: { flush?: boolean; className?: string; children: ReactNode }) {
  return (
    <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-auto', flush ? 'gap-0 p-0' : 'gap-4 px-6 py-5', className)}>{children}</main>
  );
}

/** 왼쪽 목록 칸 (320px) */
export function MasterPane({ head, className, children }: { head?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn('flex min-h-0 w-80 flex-none flex-col border-r border-line bg-surface', className)}>
      {head ? <div className="flex flex-col gap-2.5 border-b border-line px-4 pt-3.5 pb-2.5">{head}</div> : null}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

export interface PageHeadProps {
  title: ReactNode;
  /** 제목 위 작은 경로 글자 */
  crumb?: ReactNode;
  actions?: ReactNode;
}

export function PageHead({ title, crumb, actions }: PageHeadProps) {
  return (
    <div className="flex flex-none items-end gap-4">
      <div className="flex min-w-0 flex-col">
        {crumb ? <span className="flex items-center gap-1.5 text-cap font-medium text-ink-3">{crumb}</span> : null}
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      </div>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
