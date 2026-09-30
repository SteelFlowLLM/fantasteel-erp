// 불합격 처리 상태 지정 (REQ-QC-004): 보류 / 격하 / 폐기 + 사유. v2는 상태와 사유만 기록한다.
import { useState } from 'react';
import { DISPOSITION_STATUS, DISPOSITION_STATUS_LABEL, type DispositionStatus } from '@fantasteel/shared';
import type { RejectedLot } from '@/api/quality';
import { Icon } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { canUse, useMe } from '@/stores/auth';
import { useSetDisposition } from './qualityHooks';
import { DispositionBadge } from './qualityUi';
import './quality.css';

const ORDER: DispositionStatus[] = [DISPOSITION_STATUS.HOLD, DISPOSITION_STATUS.DOWNGRADED, DISPOSITION_STATUS.SCRAPPED];
const HELP: Record<DispositionStatus, string> = {
  HOLD: '결정을 미뤄 두는 상태로 표시해요.',
  DOWNGRADED: '하위 등급으로 전환할 대상으로 표시해요.',
  SCRAPPED: '폐기(스크랩) 대상으로 표시해요.',
};
const MAX_REASON = 500;

export function DispositionForm({ lot }: { lot: RejectedLot }) {
  const me = useMe();
  const canSet = canUse(me, 'DISPOSITION_SET');
  const [choice, setChoice] = useState<DispositionStatus | null>(lot.dispositionStatus);
  const [reason, setReason] = useState('');
  const save = useSetDisposition(() => setReason(''));
  const canSubmit = canSet && choice !== null && reason.trim().length > 0 && !save.isPending;

  return (
    <section className="hl-card" style={{ flex: 'none' }}>
      <header className="hl-card__head">
        <h2>처리 상태 지정</h2>
        <span className="hl-card__meta">현재 <DispositionBadge status={lot.dispositionStatus} /></span>
      </header>
      <form
        className="hl-card__body"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && choice) save.mutate({ lotId: lot.id, dispositionStatus: choice, reason: reason.trim() });
        }}
      >
        {lot.dispositionStatus ? (
          <div className="hl-cap" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>지정 {fmtDateTime(lot.dispositionAt)}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>사유: {lot.dispositionReason ?? '—'}</span>
          </div>
        ) : <span className="hl-cap">아직 처리 상태를 지정하지 않았어요</span>}

        <div role="radiogroup" aria-label="처리 상태" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {ORDER.map((s) => (
            <label key={s} className={`hl-radio-card${choice === s ? ' is-on' : ''}`} style={!canSet ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}>
              <input type="radio" name="disposition" value={s} checked={choice === s} disabled={!canSet} onChange={() => setChoice(s)} />
              <span className="hl-col" style={{ gap: 4 }}>
                <DispositionBadge status={s} />
                <span className="hl-cap">{HELP[s]}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="hl-field">
          <label htmlFor="qr-reason">사유 <span style={{ color: 'var(--danger)' }} title="필수">*</span></label>
          <textarea
            id="qr-reason"
            className="hl-input"
            rows={3}
            maxLength={MAX_REASON}
            value={reason}
            disabled={!canSet}
            placeholder="예: 성분 재확인 전까지 보류 / 하위 등급 용도로 전환 / 재사용 불가로 폐기"
            onChange={(e) => setReason(e.target.value)}
          />
          <span className="hl-field__hint">{reason.length}/{MAX_REASON}자 · 사유를 적어야 지정할 수 있어요</span>
        </div>

        <div className="hl-row" style={{ gap: 8 }}>
          {!canSet ? <span className="hl-lockhint"><Icon name="lock" size="sm" />불합격 처리 상태를 지정할 권한이 필요해요</span> : null}
          <button type="submit" className="hl-btn hl-btn--primary" style={{ marginLeft: 'auto' }} disabled={!canSubmit} title={canSet ? undefined : '권한이 필요해요'}>
            <Icon name="check" />{save.isPending ? '저장하는 중…' : choice && choice === lot.dispositionStatus ? `${DISPOSITION_STATUS_LABEL[choice]} 사유 다시 기록` : '상태 지정'}
          </button>
        </div>

        <div className="hl-banner" style={{ fontSize: 12, lineHeight: '17px' }}>
          <Icon name="info" size="sm" />
          <span>v2는 처리 <b>상태와 사유만 기록</b>해요. 격하 재판정·재작업·폐기 재고 처리는 하지 않아요. 불합격 LOT은 이미 예약·배정·출하에서 빠져 있어요. 지정·변경 내역은 작업 로그에 남아요.</span>
        </div>
      </form>
    </section>
  );
}
