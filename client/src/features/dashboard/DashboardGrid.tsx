// 위젯 격자 (SPEC 5-3): 12칸 격자에 위젯 카드를 놓는다. 편집 중에는 카드 머리를 끌어 옮기고, 모서리·변을 끌어 크기를 바꾼다.
import { useMemo } from 'react';
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout, type LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type { WidgetCode, WidgetPlacement } from '@fantasteel/shared';
import { WidgetCard } from './WidgetCard';
import { GRID_COLS, GRID_GAP, GRID_ROW_HEIGHT, WIDGET_UI, samePlacements, widgetDef } from './widgetCatalog';

const toLayout = (placements: readonly WidgetPlacement[]): LayoutItem[] =>
  placements.map((p) => {
    const ui = WIDGET_UI[p.widgetCode];
    // 저장된 크기가 최소 크기보다 작으면 저장된 크기를 그대로 둔다 (최소 크기는 늘리고 줄일 때만 적용)
    return { i: p.widgetCode, x: p.x, y: p.y, w: p.w, h: p.h, minW: Math.min(ui.minW, p.w), minH: Math.min(ui.minH, p.h) };
  });

const toPlacements = (layout: Layout): WidgetPlacement[] =>
  layout.map((l) => ({ widgetCode: l.i as WidgetCode, x: l.x, y: l.y, w: l.w, h: l.h }));

/** 격자가 화면에 놓는 모양(빈 줄을 위로 당긴 배치). 저장값과 비교할 때 쓴다. */
export function compactPlacements(placements: readonly WidgetPlacement[]): WidgetPlacement[] {
  return toPlacements(verticalCompactor.compact(toLayout(placements), GRID_COLS));
}

interface Props {
  placements: readonly WidgetPlacement[];
  editing: boolean;
  /** 편집 중 끌기·크기 조절·자동 정리로 배치가 바뀌었을 때 */
  onChange: (next: WidgetPlacement[]) => void;
  onRemove: (code: WidgetCode) => void;
}

export function DashboardGrid({ placements, editing, onChange, onRemove }: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  // shared에 없는 코드(옛 저장값)는 그리지 않는다
  const known = useMemo(() => placements.filter((p) => !!widgetDef(p.widgetCode)), [placements]);
  const layout = useMemo(() => toLayout(known), [known]);

  return (
    <div ref={containerRef} className={`app-grid dsh-grid${editing ? ' is-editing' : ''}`}>
      {mounted ? (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: GRID_ROW_HEIGHT, margin: [GRID_GAP, GRID_GAP], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, handle: '.dsh-card__head', cancel: '.dsh-nodrag' }}
          resizeConfig={{ enabled: editing, handles: ['se', 'e', 's'] }}
          compactor={verticalCompactor}
          onLayoutChange={(next) => {
            if (!editing) return;
            const moved = toPlacements(next);
            if (!samePlacements(moved, known)) onChange(moved);
          }}
        >
          {known.map((p) => (
            <div key={p.widgetCode}>
              <WidgetCard code={p.widgetCode} editing={editing} onRemove={onRemove} />
            </div>
          ))}
        </ReactGridLayout>
      ) : null}
    </div>
  );
}
