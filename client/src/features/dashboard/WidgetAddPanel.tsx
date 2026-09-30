// "위젯 추가" 옆 패널: 아직 놓지 않은 위젯을 골라 맨 아래에 기본 크기로 추가한다 (REQ-DSH-002).
import { WIDGETS, type WidgetCode, type WidgetPlacement } from '@fantasteel/shared';
import { ComingSoon, EmptyNote, Icon } from '@/components/ui';
import { WIDGET_UI } from './widgetCatalog';

export function WidgetAddPanel({ placements, onAdd, onClose }: { placements: readonly WidgetPlacement[]; onAdd: (code: WidgetCode) => void; onClose: () => void }) {
  const placed = new Set<string>(placements.map((p) => p.widgetCode));
  const available = WIDGETS.filter((w) => !placed.has(w.code));
  return (
    <aside className="dsh-panel" aria-label="위젯 추가">
      <div className="hl-row dsh-panel__head">
        <Icon name="widget" />
        <b style={{ fontSize: 15 }}>위젯 추가</b>
        <span className="hl-cap">{WIDGETS.length}개 중 {WIDGETS.length - available.length}개 표시</span>
        <button type="button" className="hl-iconbtn hl-iconbtn--sm" style={{ marginLeft: 'auto' }} aria-label="위젯 추가 닫기" onClick={onClose}><Icon name="x" /></button>
      </div>
      <ul className="dsh-panel__list">
        {available.map((w) => {
          const ui = WIDGET_UI[w.code];
          return (
            <li key={w.code} className="hl-row dsh-panel__item">
              <span className="hl-chan" style={{ width: 40, height: 40, ...(w.isP2 ? { background: 'var(--ai-bg)', color: 'var(--ai-strong)' } : { background: '#E6EEFC', color: '#1F5FCC' }) }}>
                <Icon name={ui.icon} size="lg" />
              </span>
              <div className="hl-col hl-grow" style={{ gap: 2 }}>
                <span className="hl-row" style={{ gap: 6 }}><b>{w.label}</b>{w.isP2 ? <ComingSoon grade="P2" /> : null}</span>
                <span className="hl-cap">{ui.description}</span>
                <span className="hl-cap tnum">기본 크기 {w.defaultW} × {w.defaultH}칸</span>
              </div>
              <button type="button" className="hl-btn hl-btn--sm" style={{ flex: 'none' }} aria-label={`${w.label} 위젯 추가`} onClick={() => onAdd(w.code)}><Icon name="plus" />추가</button>
            </li>
          );
        })}
        {!available.length ? <li><EmptyNote>모든 위젯이 표시 중이에요</EmptyNote></li> : null}
      </ul>
      <div className="hl-row hl-cap dsh-panel__foot">
        <Icon name="info" size="sm" />
        [추가]를 누르면 맨 아래에 기본 크기로 놓여요. 카드 머리를 끌어 옮기고 모서리를 끌어 크기를 바꾸세요
      </div>
    </aside>
  );
}
