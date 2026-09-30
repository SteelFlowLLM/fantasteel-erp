// 공정 흐름 현황 (REQ-DSH-001): 단계별 건수를 흐름 상자로 나열한다.
import { Fragment } from 'react';
import { Link } from 'react-router';
import type { ProcessFlowWidget as Data } from '@/api/dashboard';
import { EmptyNote, Icon } from '@/components/ui';
import { fmtInt } from '@/lib/format';

export function ProcessFlowWidget({ data }: { data: Data }) {
  if (!data.stages.length) return <div className="hl-card__body"><EmptyNote>표시할 공정 단계가 없어요</EmptyNote></div>;
  return (
    <div className="hl-card__body dsh-flow">
      {data.stages.map((s, i) => {
        const inner = (
          <>
            <span className="hl-cap dsh-clip" title={s.label}>{s.label}</span>
            <span className={`dsh-flow__count tnum${s.count ? '' : ' hl-muted'}`}>{fmtInt(s.count)}<small>{s.unit}</small></span>
          </>
        );
        return (
          <Fragment key={s.key}>
            {i > 0 ? <Icon name="chevron-right" size="sm" style={{ color: 'var(--ink-3)', flex: 'none' }} /> : null}
            {s.linkPath ? (
              <Link className="hl-flowbox dsh-flow__box" to={s.linkPath} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link>
            ) : (
              <div className="hl-flowbox dsh-flow__box">{inner}</div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
