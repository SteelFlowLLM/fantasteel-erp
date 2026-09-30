// 생산 설정 (REQ-MST-009): 히트 용량(t) · 납기 위험 기준일(일).
import { useState } from 'react';
import { masterApi, type ProductionSettingView } from '@/api/masterData';
import { Field, Icon, QueryBoundary } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { errMsg, LockHint, LOCK_TITLE, parseDec, useMasterAction } from './common';
import { useProductionSetting } from './masterHooks';

export function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const setting = useProductionSetting();
  return (
    <QueryBoundary query={setting}>
      {(s) => <SettingsForm key={s.updatedAt} setting={s} canEdit={canEdit} />}
    </QueryBoundary>
  );
}

function SettingsForm({ setting, canEdit }: { setting: ProductionSettingView; canEdit: boolean }) {
  const [heat, setHeat] = useState(setting.heatCapacityTon);
  const [days, setDays] = useState(String(setting.deliveryRiskDays));
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const save = useMasterAction(masterApi.productionSettings.save, '생산 설정을 저장했어요');

  const heatN = parseDec(heat, 3);
  const daysN = /^\d+$/.test(days.trim()) ? Number(days) : null;
  const errors = {
    heat: heatN && heatN > 0 ? null : '0보다 큰 숫자로 입력해 주세요 (소수 3자리까지)',
    days: daysN !== null ? null : '0 이상의 정수로 입력해 주세요',
  };
  const dirty = Number(heat) !== Number(setting.heatCapacityTon) || Number(days) !== setting.deliveryRiskDays;
  const submit = () => {
    setTried(true);
    setServerError(null);
    if (errors.heat || errors.days || heatN === null || daysN === null) return;
    save.mutate({ heatCapacityTon: heatN, deliveryRiskDays: daysN }, { onError: (e) => setServerError(errMsg(e)) });
  };

  return (
    <section className="hl-card md-card" style={{ maxWidth: 640, flex: 'none' }}>
      <header className="hl-card__head">
        <h3>생산 설정</h3>
        <span className="hl-cap">마지막 저장 {fmtDateTime(setting.updatedAt)}</span>
      </header>
      <div className="hl-card__body" style={{ gap: 14 }}>
        {!canEdit ? <LockHint /> : null}
        <Field label="히트 용량" error={tried ? errors.heat : null} hint="전로 1히트의 용량이에요 · 히트당 매수 계산에 써요 (초기 250 t)">
          <span className="hl-inputwrap">
            <input className={`hl-input num${tried && errors.heat ? ' is-error' : ''}`} style={{ paddingRight: 28 }} inputMode="decimal" value={heat} onChange={(e) => setHeat(e.target.value)} disabled={!canEdit} title={canEdit ? undefined : LOCK_TITLE} aria-label="히트 용량" />
            <span className="hl-suffix">t</span>
          </span>
        </Field>
        <Field label="납기 위험 기준일" error={tried ? errors.days : null} hint="납기까지 남은 일수가 이 값 이하이고 출하가 덜 됐으면 납기 위험이에요 (초기 3일)">
          <span className="hl-inputwrap">
            <input className={`hl-input num${tried && errors.days ? ' is-error' : ''}`} style={{ paddingRight: 28 }} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} disabled={!canEdit} title={canEdit ? undefined : LOCK_TITLE} aria-label="납기 위험 기준일" />
            <span className="hl-suffix">일</span>
          </span>
        </Field>
      </div>
      <footer className="hl-card__foot">
        {serverError ? <span className="hl-cap hl-danger-text" role="alert">{serverError}</span> : dirty ? <span className="hl-cap hl-wait-text">저장하지 않은 변경이 있어요</span> : null}
        <button type="button" className="hl-btn" style={{ marginLeft: 'auto' }} disabled={!dirty} onClick={() => { setHeat(setting.heatCapacityTon); setDays(String(setting.deliveryRiskDays)); setTried(false); setServerError(null); }}>되돌리기</button>
        <button type="button" className="hl-btn hl-btn--primary" disabled={!canEdit || !dirty || save.isPending} title={canEdit ? undefined : LOCK_TITLE} onClick={submit}>
          <Icon name="check" />{save.isPending ? '저장 중…' : '저장'}
        </button>
      </footer>
    </section>
  );
}
