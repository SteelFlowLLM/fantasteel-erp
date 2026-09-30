// 검사 대기 LOT 1건의 측정값 입력 폼. 입력하는 동안 항목별 "미리보기"만 보여 주고, 판정은 등록할 때 서버가 한다.
import { useState } from 'react';
import type { Inspection, InspectionSpecItem, PendingInspection } from '@/api/quality';
import { Badge, EmptyNote, Icon } from '@/components/ui';
import { canUse, useMe } from '@/stores/auth';
import { useRegisterInspection } from './qualityHooks';
import { fmtGap, limitText, previewItem, suggestValue, type Preview } from './qualityUtil';
import { LimitGauge } from './qualityUi';
import './quality.css';

const noLimit = (it: InspectionSpecItem) => it.minValue === null && it.maxValue === null;

function PreviewBadge({ p, item }: { p: Preview; item: InspectionSpecItem }) {
  if (noLimit(item)) return <Badge tone="wait">기준 없음</Badge>;
  if (p.state === 'empty') return <Badge>미입력</Badge>;
  if (p.state === 'invalid') return <Badge tone="wait">숫자 확인</Badge>;
  return <Badge tone={p.state === 'pass' ? 'ok' : 'danger'}>미리보기 {p.state === 'pass' ? '합격' : '불합격'}</Badge>;
}

export function InspectionForm({ item, onRegistered }: { item: PendingInspection; onRegistered: (inspection: Inspection) => void }) {
  const me = useMe();
  const canRegister = canUse(me, 'INSPECTION_REGISTER');
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [memo, setMemo] = useState('');
  const register = useRegisterInspection(onRegistered);

  const items = [...item.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const rows = items.map((it) => ({ it, p: previewItem(raw[it.inspectionItemCode] ?? '', it) }));
  const missing = rows.filter((r) => r.it.isRequired && r.p.state === 'empty');
  const invalid = rows.filter((r) => r.p.state === 'invalid');
  const blocked = rows.filter((r) => r.it.isRequired && noLimit(r.it));
  const entered = rows.filter((r) => r.p.state === 'pass' || r.p.state === 'fail');
  const failCount = entered.filter((r) => r.p.state === 'fail' && !noLimit(r.it)).length;
  const canSubmit = canRegister && items.length > 0 && !missing.length && !invalid.length && !blocked.length && entered.length > 0 && !register.isPending;

  const setValue = (code: string, v: string) => setRaw((prev) => ({ ...prev, [code]: v.replace(/[^0-9.\-]/g, '') }));

  /** 데모용 도우미: 비어 있는 칸만 기준 안쪽 값으로 채운다. 등록은 사용자가 직접 누른다. */
  const fill = () =>
    setRaw((prev) => {
      const next = { ...prev };
      for (const it of items) {
        if ((prev[it.inspectionItemCode] ?? '').trim() !== '') continue;
        const s = suggestValue(it);
        if (s !== null) next[it.inspectionItemCode] = s;
      }
      return next;
    });

  const submit = () =>
    register.mutate({
      lotId: item.lot.id,
      values: entered.map((r) => ({ inspectionItemCode: r.it.inspectionItemCode, measuredValue: (raw[r.it.inspectionItemCode] ?? '').trim() })),
      memo: memo.trim() || undefined,
    });

  const why = !canRegister ? null : !items.length ? '이 LOT의 검사 기준이 등록돼 있지 않아 입력할 수 없어요'
    : blocked.length ? `기준(최소·최대)이 없는 필수 항목이 있어 판정할 수 없어요: ${blocked.map((r) => r.it.inspectionItemName).join(', ')}`
      : invalid.length ? `숫자(소수 4자리까지)로 입력해 주세요: ${invalid.map((r) => r.it.inspectionItemName).join(', ')}`
        : missing.length ? `필수 측정값이 비어 있어요: ${missing.map((r) => r.it.inspectionItemName).join(', ')}`
          : entered.length === 0 ? '측정값을 입력해 주세요' : null;

  return (
    <>
      <section className="hl-card" style={{ flex: 'none' }}>
        <header className="hl-card__head">
          <h2>측정값</h2>
          <span className="hl-card__meta">{item.inspectionName} · 항목 {items.length}개 · 필수 {items.filter((i) => i.isRequired).length}개</span>
          <div className="hl-card__actions">
            <button type="button" className="hl-btn hl-btn--sm" onClick={fill} disabled={!canRegister || !items.length} title="비어 있는 칸을 기준 안쪽 값으로 채워요 (데모용). 등록은 직접 눌러요">
              <Icon name="edit" />기준 안 값으로 채우기
            </button>
            <span className="hl-cap">데모용 도우미</span>
          </div>
        </header>
        <div className="hl-card__body">
          <div className="hl-banner hl-banner--run" style={{ fontSize: 12, lineHeight: '17px' }}>
            <Icon name="info" size="sm" />
            <span>입력하는 동안 보이는 합격·불합격은 기준(경계 포함)과 견준 <b>미리보기</b>예요. <b>시스템이 저장할 때 판정해요.</b></span>
          </div>
          {!items.length ? <EmptyNote>이 LOT의 검사 항목이 없어요. 관리자가 기준정보에서 검사 기준을 등록해야 해요.</EmptyNote> : null}
          <div className="qc-grid">
            {rows.map(({ it, p }) => {
              const code = it.inspectionItemCode;
              const id = `qi-${code}`;
              const bad = p.state === 'fail' && !noLimit(it);
              const value = p.state === 'pass' || p.state === 'fail' ? p.value : null;
              return (
                <div key={code} className={`qc-item${bad ? ' is-bad' : ''}`}>
                  <div className="hl-row">
                    <label className="hl-label" htmlFor={id} style={{ fontWeight: 600, color: 'var(--ink)' }}>
                      {it.inspectionItemName}
                      {it.isRequired ? <span style={{ color: 'var(--danger)', marginLeft: 3 }} title="필수">*</span> : <span className="hl-cap" style={{ marginLeft: 6 }}>선택</span>}
                    </label>
                    <span style={{ marginLeft: 'auto' }}><PreviewBadge p={p} item={it} /></span>
                  </div>
                  <span className="hl-inputwrap">
                    <input
                      id={id}
                      className={`hl-input num${bad || p.state === 'invalid' && !p.typing ? ' is-error' : ''}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={raw[code] ?? ''}
                      disabled={!canRegister}
                      onChange={(e) => setValue(code, e.target.value)}
                      style={{ paddingRight: (it.unit?.length ?? 0) > 2 ? 44 : 36, textAlign: 'right' }}
                    />
                    {it.unit ? <span className="hl-suffix">{it.unit}</span> : null}
                  </span>
                  <LimitGauge minValue={it.minValue} maxValue={it.maxValue} unit={it.unit} raw={(raw[code] ?? '').trim()} value={value} bad={bad} />
                  <div className="hl-row hl-cap" style={{ gap: 6 }}>
                    <span>기준 {limitText(it)}</span>
                    {p.state === 'fail' && !noLimit(it) ? <span className="hl-danger-text" style={{ marginLeft: 'auto' }}>{p.side === 'below' ? '하한' : '상한'}보다 {fmtGap(p.gap)}{it.unit ? ` ${it.unit}` : ''} {p.side === 'below' ? '낮아요' : '높아요'}</span> : null}
                    {p.state === 'invalid' && !p.typing ? <span className="hl-danger-text" style={{ marginLeft: 'auto' }}>숫자(소수 4자리까지)로 입력해 주세요</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hl-field">
            <label htmlFor="qi-memo">검사 메모</label>
            <textarea id="qi-memo" className="hl-input" rows={2} maxLength={500} value={memo} disabled={!canRegister} placeholder="시편 채취 위치 등 (선택)" onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="hl-row qi-bar" aria-label="검사 등록">
        <div className="hl-col" style={{ gap: 2, minWidth: 0 }}>
          <span className="hl-cap">미리보기 (저장할 때 시스템이 판정해요)</span>
          <b style={{ fontSize: 14 }}>
            입력 {entered.length}/{items.length}
            {entered.length ? <span className={failCount ? 'hl-danger-text' : 'hl-ok-text'}> · 기준 밖 {failCount}개</span> : null}
          </b>
          {why ? <span className="hl-cap" style={{ color: 'var(--wait)' }}>{why}</span> : null}
        </div>
        <div className="hl-row" style={{ marginLeft: 'auto', gap: 8 }}>
          {!canRegister ? <span className="hl-lockhint"><Icon name="lock" size="sm" />권한이 필요해요</span> : null}
          <button type="button" className="hl-btn hl-btn--primary" disabled={!canSubmit} title={canRegister ? undefined : '권한이 필요해요'} onClick={submit}>
            <Icon name="check" />{register.isPending ? '등록하는 중…' : '검사 등록'}
          </button>
        </div>
      </section>
    </>
  );
}
