// 위젯 격자 (SPEC 4장 3번): 12칸 격자. 편집 중에는 카드 머리를 끌어 옮기고, 오른쪽 아래·오른쪽·아래 변을 끌어 크기를 바꾼다.
// 위젯마다 최소 크기가 있고, 빈 줄은 위로 당겨 정리한다.
import { useMemo } from 'react';
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type { DashboardWidgetKey } from '@/api/dashboard';
import { DRAG_HANDLE_CLASS, NO_DRAG_CLASS } from '@/features/dashboard/components/WidgetFrame';
import { fromLayoutItems, GRID_COLS, GRID_GAP, GRID_ROW_HEIGHT, samePlacements, toLayoutItems, type WidgetPlacement } from '@/features/dashboard/lib/layout';
import { WIDGET_COMPONENTS } from '@/features/dashboard/widgets/widgetRegistry';
import { cn } from '@/lib/cn';

interface Props {
  placements: readonly WidgetPlacement[];
  editing: boolean;
  /** 편집 중 끌기·크기 조절·자동 정리로 배치가 바뀌었을 때 */
  onChange: (next: WidgetPlacement[]) => void;
  onRemove: (key: DashboardWidgetKey) => void;
}

export function DashboardGrid({ placements, editing, onChange, onRemove }: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  const layout = useMemo(() => toLayoutItems(placements), [placements]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'min-w-0 flex-none pb-2',
        // 끄는 중인 카드 강조, 편집 중에는 크기 조절 손잡이를 늘 보인다
        '[&_.react-grid-item.react-draggable-dragging>section]:shadow-pop [&_.react-grid-placeholder]:rounded-md [&_.react-grid-placeholder]:bg-run/20',
        editing && '[&_.react-resizable-handle]:z-[2] [&_.react-resizable-handle]:opacity-100 [&_.react-resizable-handle::after]:border-run',
      )}
    >
      {mounted ? (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: GRID_ROW_HEIGHT, margin: [GRID_GAP, GRID_GAP], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, handle: `.${DRAG_HANDLE_CLASS}`, cancel: `.${NO_DRAG_CLASS}` }}
          resizeConfig={{ enabled: editing, handles: ['se', 'e', 's'] }}
          compactor={verticalCompactor}
          onLayoutChange={(next) => {
            if (!editing) return;
            const moved = fromLayoutItems(next);
            if (!samePlacements(moved, placements)) onChange(moved);
          }}
        >
          {placements.map((p) => {
            const Widget = WIDGET_COMPONENTS[p.key];
            return (
              <div key={p.key}>
                <Widget editing={editing} onRemove={onRemove} />
              </div>
            );
          })}
        </ReactGridLayout>
      ) : null}
    </div>
  );
}
