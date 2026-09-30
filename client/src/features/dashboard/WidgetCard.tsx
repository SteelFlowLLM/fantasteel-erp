// 위젯 카드 한 장: 머리(제목·보조 문구·바로가기·제외 버튼) + 서버 데이터 본문.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { WidgetCode } from '@fantasteel/shared';
import { ApiError } from '@/api/client';
import { dashboardApi, dashboardKeys } from '@/api/dashboard';
import { ComingSoon, Icon, Spinner } from '@/components/ui';
import { SoonWidgetBody, WidgetBody, widgetMeta } from './WidgetBody';
import { WIDGET_UI, widgetDef } from './widgetCatalog';

/** 소켓이 끊겼을 때를 대비한 느린 주기 갱신. 평소에는 실시간 주제로 바로 갱신된다. */
const WIDGET_REFETCH_MS = 30_000;

export function WidgetCard({ code, editing, onRemove }: { code: WidgetCode; editing: boolean; onRemove?: (code: WidgetCode) => void }) {
  const def = widgetDef(code);
  const ui = WIDGET_UI[code];
  const isP2 = !!def?.isP2;
  const query = useQuery({
    queryKey: dashboardKeys.widget(code),
    queryFn: () => dashboardApi.widget(code),
    refetchInterval: isP2 ? false : WIDGET_REFETCH_MS,
  });
  const data = query.data;
  const title = def?.label ?? code;
  const soon = data ? !data.available : isP2;
  const meta = data ? widgetMeta(data) : null;

  return (
    <section className={`hl-card hl-widget dsh-card${soon ? ' hl-ai-card dsh-card--soon' : ''}`} aria-label={title}>
      <header className="hl-card__head dsh-card__head" title={editing ? '끌어서 옮기기' : undefined}>
        {editing ? <Icon name="grip" size="sm" style={{ color: 'var(--ink-3)', flex: 'none' }} /> : null}
        {soon ? <span className="hl-aimark hl-aimark--sm">AI</span> : null}
        <h2 className="dsh-clip" title={title}>{title}</h2>
        {soon ? <ComingSoon grade="P2" /> : null}
        {meta ? <span className="hl-card__meta dsh-clip" title={meta}>{meta}</span> : null}
        <div className="hl-card__actions">
          {!editing && !soon && query.isFetching && data ? <Icon name="refresh" size="sm" style={{ color: 'var(--ink-3)' }} /> : null}
          {!editing && ui.link && !soon ? <Link to={ui.link.to} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{ui.link.label}</Link> : null}
          {editing && onRemove ? (
            <button type="button" className="hl-iconbtn hl-iconbtn--sm dsh-nodrag" aria-label={`${title} 위젯 제외`} title="위젯 제외" onClick={() => onRemove(code)}>
              <Icon name="x" size="sm" />
            </button>
          ) : null}
        </div>
      </header>
      {data ? (
        <WidgetBody data={data} />
      ) : isP2 ? (
        <SoonWidgetBody code={code} />
      ) : query.error ? (
        <div className="hl-card__body dsh-state">
          <span className="hl-cap">
            {query.error instanceof ApiError && query.error.status === 403 ? '이 위젯을 볼 권한이 없어요' : query.error instanceof Error ? query.error.message : '불러오지 못했어요'}
          </span>
          <button type="button" className="hl-btn hl-btn--sm dsh-nodrag" onClick={() => void query.refetch()}>다시 시도</button>
        </div>
      ) : (
        <div className="hl-card__body dsh-state"><Spinner /></div>
      )}
    </section>
  );
}
