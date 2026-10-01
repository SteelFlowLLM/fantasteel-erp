// '위젯 추가' 옆 패널 (REQ-DSH-002): 아직 놓지 않은 위젯을 골라 맨 아래에 기본 크기로 추가한다.
import type { DashboardWidgetKey } from '@/api/dashboard';
import { Button } from '@/components/Button';
import { ComingSoon } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { EmptyNote } from '@/components/StateView';
import type { WidgetPlacement } from '@/features/dashboard/lib/layout';
import { WIDGETS } from '@/features/dashboard/widgetCatalog';
import { cn } from '@/lib/cn';

export function WidgetAddPanel({ placements, onAdd, onClose }: { placements: readonly WidgetPlacement[]; onAdd: (key: DashboardWidgetKey) => void; onClose: () => void }) {
  const placed = new Set<string>(placements.map((p) => p.key));
  const available = WIDGETS.filter((w) => !placed.has(w.key));
  return (
    <aside aria-label="위젯 추가" className="flex min-h-0 w-[340px] flex-none flex-col border-l border-line bg-surface max-[1100px]:w-[290px]">
      <div className="flex h-14 flex-none items-center gap-2 border-b border-line pr-3 pl-4">
        <Icon name="widget" />
        <b className="text-md font-semibold">위젯 추가</b>
        <span className="text-cap text-ink-3">
          {WIDGETS.length}개 중 {WIDGETS.length - available.length}개 표시
        </span>
        <IconButton icon="x" size="sm" label="위젯 추가 닫기" className="ml-auto" onClick={onClose} />
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {available.map((w) => (
          <li key={w.key} className="flex items-start gap-3 border-b border-line px-4 py-3">
            <span className={cn('flex size-10 flex-none items-center justify-center rounded-md [&_.ic]:size-5', w.soon ? 'bg-ai-bg text-ai-strong' : 'bg-run-bg text-run')}>
              <Icon name={w.icon} size="lg" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5">
                <b className="font-semibold">{w.label}</b>
                {w.soon ? <ComingSoon grade="P2" /> : null}
                {w.isDefault ? <span className="text-cap text-ink-3">기본</span> : null}
              </span>
              <span className="text-cap text-ink-3">{w.description}</span>
              <span className="text-cap text-ink-3 tabular-nums">
                기본 크기 {w.defaultW} × {w.defaultH}칸 · 최소 {w.minW} × {w.minH}칸
              </span>
            </div>
            <Button size="sm" icon="plus" className="flex-none self-center" aria-label={`${w.label} 위젯 추가`} onClick={() => onAdd(w.key)}>
              추가
            </Button>
          </li>
        ))}
        {available.length === 0 ? (
          <li>
            <EmptyNote>모든 위젯이 표시 중이에요</EmptyNote>
          </li>
        ) : null}
      </ul>
      <div className="flex flex-none items-start gap-1.5 border-t border-line bg-surface-2 px-4 py-3 text-cap text-ink-3">
        <Icon name="info" size="sm" className="mt-px flex-none" />
        [추가]를 누르면 맨 아래에 기본 크기로 놓여요. 카드 머리를 끌어 옮기고 모서리를 끌어 크기를 바꾸세요
      </div>
    </aside>
  );
}
