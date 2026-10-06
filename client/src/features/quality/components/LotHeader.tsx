// 품질 화면 상세 위쪽: 경로 · LOT 번호(LOT 추적 링크) · 유형 · 상태 배지 · 오른쪽 버튼
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Tag } from '@/components/Tag';

export const lotTraceHref = (lotNo: string, direction?: 'forward' | 'backward'): string =>
  `/lots/trace?lot=${encodeURIComponent(lotNo)}${direction ? `&direction=${direction}` : ''}`;

export function LotHeader({ area, lotNo, typeName, badges, actions }: { area: string; lotNo: string; typeName: string; badges?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-none flex-wrap items-end gap-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1 text-cap font-medium text-ink-3">
          품질
          <Icon name="chevron-right" size="sm" />
          {area}
          <Icon name="chevron-right" size="sm" />
          {typeName}
        </span>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href={lotTraceHref(lotNo)} className="font-mono text-lg font-semibold text-ink hover:text-run hover:underline" title="LOT 추적에서 보기">
            {lotNo}
          </Link>
          <Tag>{typeName}</Tag>
          {badges}
        </div>
      </div>
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** 이름-값 칸 묶음 (옛 qc-kv): 폭에 맞춰 여러 줄로 흐른다 */
export function InfoGrid({ items }: { items: readonly { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-4.5 gap-y-3">
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-0.5 text-sm">
          <dt className="text-xs text-ink-3">{item.label}</dt>
          <dd className="m-0 font-medium break-words text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 목록 칸의 한 줄 (옛 hl-mitem). 고른 줄은 왼쪽에 막대를 그린다. */
export function MasterItemLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={
        active
          ? 'flex flex-col gap-1 border-b border-line bg-brand-tint px-4 py-2.5 shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint-hover'
          : 'flex flex-col gap-1 border-b border-line px-4 py-2.5 hover:bg-surface-2'
      }
    >
      {children}
    </Link>
  );
}
