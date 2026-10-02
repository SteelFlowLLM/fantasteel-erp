// 위젯 카드 한 장 (옛 WidgetCard): 머리(끌기 손잡이·제목·보조 문구·바로가기·제외) + 본문.
// 본문은 카드 안에서 스크롤한다(SPEC 4장 3번). 편집 중에는 본문 링크가 눌리지 않는다.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import type { DashboardWidgetKey } from '@/api/dashboard';
import type { Permission } from '@/codes';
import { Button } from '@/components/Button';
import { AiMark, ComingSoon } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { EmptyNote, Spinner } from '@/components/StateView';
import { widgetDef } from '@/features/dashboard/widgetCatalog';
import { canOpenScreen } from '@/features/shell/screens';
import { useMe } from '@/hooks/useMe';
import { cn } from '@/lib/cn';
import { permissionNeedText } from '@/lib/permissions';

/** react-grid-layout 끌기 손잡이·끌기 제외 표시 (모양 없는 표시용 class) */
export const DRAG_HANDLE_CLASS = 'dashboard-drag-handle';
export const NO_DRAG_CLASS = 'dashboard-nodrag';

export interface WidgetProps {
  editing: boolean;
  onRemove: (key: DashboardWidgetKey) => void;
}

export interface WidgetFrameProps extends WidgetProps {
  widgetKey: DashboardWidgetKey;
  /** 제목 옆 짧은 보조 문구 */
  meta?: string | null;
  children: ReactNode;
}

export function WidgetFrame({ widgetKey, editing, onRemove, meta, children }: WidgetFrameProps) {
  const def = widgetDef(widgetKey);
  const me = useMe();
  const link = def.link && !editing && !def.soon && canOpenScreen(me, def.link.screen.access) ? def.link : null;
  return (
    <section
      aria-label={def.label}
      className={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-surface', def.soon ? 'border-ai-line' : 'border-line shadow-1')}
    >
      <header
        title={editing ? '끌어서 옮기기' : undefined}
        className={cn(DRAG_HANDLE_CLASS, 'flex h-11 min-w-0 flex-none items-center gap-2 border-b border-line pr-2 pl-4', editing && 'cursor-grab select-none active:cursor-grabbing')}
      >
        {editing ? <Icon name="grip" size="sm" className="flex-none text-ink-3" /> : null}
        {def.soon ? <AiMark size="sm" /> : null}
        <h2 className="min-w-12 shrink truncate text-base font-semibold" title={def.label}>
          {def.label}
        </h2>
        {def.soon ? <ComingSoon grade="P2" /> : null}
        <span className="min-w-0 flex-1 truncate text-xs text-ink-3" title={meta ?? undefined}>
          {meta}
        </span>
        <div className="flex flex-none items-center gap-1">
          {link ? (
            <Link href={link.screen.href} className="px-1 text-xs whitespace-nowrap text-run hover:underline">
              {link.label}
            </Link>
          ) : null}
          {editing ? <IconButton icon="x" size="sm" label={`${def.label} 위젯 제외`} title="위젯 제외" className={NO_DRAG_CLASS} onClick={() => onRemove(widgetKey)} /> : null}
        </div>
      </header>
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-auto', editing && '[&_a]:pointer-events-none')}>{children}</div>
    </section>
  );
}

/** 권한이 없는 위젯 (BP-DSH-01 "권한 내 집계") */
export function WidgetLock({ permissions }: { permissions: readonly Permission[] }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-surface-3 text-ink-2">
        <Icon name="lock" />
      </span>
      <b className="text-sm font-semibold text-ink">이 위젯을 볼 권한이 없어요</b>
      {permissions.length > 0 ? <span className="text-cap text-ink-3">{permissionNeedText(permissions, 'VIEW')}</span> : null}
    </div>
  );
}

interface WidgetQuery<T> {
  data: T | undefined;
  error: unknown;
  refetch: () => unknown;
}

/** 위젯 본문의 상태: 잠금 → 데이터 → 오류(권한 오류는 잠금) → 불러오는 중 */
export function WidgetBody<T>({ allowed, permissions, query, children }: { allowed: boolean; permissions: readonly Permission[]; query: WidgetQuery<T>; children: (data: T) => ReactNode }) {
  if (!allowed) return <WidgetLock permissions={permissions} />;
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.error) {
    if (query.error instanceof ApiError && query.error.code === 'COM-002') return <WidgetLock permissions={permissions} />;
    const message = query.error instanceof Error ? query.error.message : null;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center">
        <b className="text-sm font-semibold text-ink">불러오지 못했어요</b>
        {message ? <span className="text-cap text-ink-3">{message}</span> : null}
        <Button size="sm" className={NO_DRAG_CLASS} onClick={() => void query.refetch()}>
          다시 시도
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center py-6">
      <Spinner />
    </div>
  );
}

/** 위젯 안 빈 상태 */
export function WidgetEmpty({ children }: { children: ReactNode }) {
  return <EmptyNote className="flex flex-1 items-center justify-center">{children}</EmptyNote>;
}

/** 범례 한 칸 */
export function LegendItem({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-cap text-ink-2">
      <i className={cn('inline-block size-2 rounded-xs', colorClass)} aria-hidden="true" />
      {label}
    </span>
  );
}

/** 작은 숫자 (라벨 + 값) */
export function Figure({ label, value, unit, tone }: { label: string; value: ReactNode; unit?: string; tone?: 'danger' | 'muted' }) {
  return (
    <div className="flex min-w-14 flex-col gap-0.5">
      <span className="truncate text-cap text-ink-3">{label}</span>
      <b className={cn('text-xl font-semibold tabular-nums', tone === 'danger' && 'text-danger', tone === 'muted' && 'text-ink-3')}>
        {value}
        {unit ? <small className="ml-0.5 text-xs font-medium text-ink-3">{unit}</small> : null}
      </b>
    </div>
  );
}
