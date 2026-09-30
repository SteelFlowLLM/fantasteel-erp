// 최근 작업 로그 (REQ-DSH-001)
import { Link } from 'react-router';
import type { RecentEventsWidget as Data } from '@/api/dashboard';
import { EmptyNote } from '@/components/ui';
import { fmtDateTime, relTime } from '@/lib/format';

export function RecentEventsWidget({ data }: { data: Data }) {
  return (
    <ul className="hl-card__body dsh-log">
      {data.items.map((e) => (
        <li key={e.id} className="hl-row dsh-log__row">
          <time className="hl-cap tnum dsh-log__time" dateTime={e.occurredAt} title={fmtDateTime(e.occurredAt)}>{relTime(e.occurredAt)}</time>
          <span className={`hl-actor ${e.actorType === 'SYSTEM' ? 'hl-actor--system' : 'hl-actor--user'} dsh-log__actor`} title={e.actorLabel}>
            <span className="dsh-clip">{e.actorLabel}</span>
          </span>
          <span className="hl-evt" style={{ flex: 'none' }}>{e.eventTypeLabel}</span>
          {e.isAiAssisted ? <span className="hl-actor hl-actor--ai" style={{ flex: 'none' }} title="AI 어시스턴트가 도운 작업">AI</span> : null}
          {e.linkPath ? (
            <Link className="dsh-clip dsh-log__text" to={e.linkPath} title={e.summary}>{e.summary}</Link>
          ) : (
            <span className="dsh-clip dsh-log__text" title={e.summary}>{e.summary}</span>
          )}
        </li>
      ))}
      {!data.items.length ? <li><EmptyNote>최근 작업 로그가 없어요</EmptyNote></li> : null}
    </ul>
  );
}
