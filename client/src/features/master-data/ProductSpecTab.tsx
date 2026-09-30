// 제품 규격 (REQ-MST-003, MST-002): 강종 × 두께 × 폭 × 길이로 고정한 슬래브·코일 규격.
import { useMemo, useState } from 'react';
import { calcTheoreticalWeightTon } from '@fantasteel/shared';
import { masterApi, type ProductSpecView, type SpecItemType, type UpdateProductSpecBody } from '@/api/masterData';
import { Badge, EmptyNote, Field, Icon, Modal, QueryBoundary } from '@/components/ui';
import { fmtDims, fmtTon } from '@/lib/format';
import { ACTIVE_OPTIONS, ActiveToggle, AddButton, CardHead, EditButton, errMsg, FormFooter, LockHint, parseDec, SelectBox, useMasterAction } from './common';
import { useProductSpecs, useSteelGrades, useYards } from './masterHooks';

const FORMULA = '두께 × 폭 × 길이 × 7.85 ÷ 10^9';
const USED_HINT = '사용된 규격은 치수·이론중량을 수정할 수 없어요. 다른 치수는 새 규격으로 추가해 주세요';
const LIMITS = { thickness: 2000, width: 5000, length: 5_000_000 } as const;

export function ProductSpecTab({ canEdit, goMapping }: { canEdit: boolean; goMapping: () => void }) {
  const [itemType, setItemType] = useState<'' | SpecItemType>('');
  const [gradeId, setGradeId] = useState('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [editing, setEditing] = useState<ProductSpecView | 'new' | null>(null);
  const grades = useSteelGrades();
  const specs = useProductSpecs({ itemType: itemType || undefined, steelGradeId: gradeId ? Number(gradeId) : undefined, active: active || undefined });
  const toggle = useMasterAction((s: ProductSpecView) => (s.isActive ? masterApi.productSpecs.deactivate(s.id) : masterApi.productSpecs.activate(s.id)), (s) => (s.isActive ? '규격을 사용으로 바꿨어요' : '규격을 사용 안 함으로 바꿨어요'));

  return (
    <section className="hl-card md-card">
      <CardHead title="제품 규격" count={specs.data?.length} sub="1매 이론중량 = 두께 × 폭 × 길이 × 7.85 ÷ 10^9 (t, 소수 3자리)">
        <div className="hl-seg" role="group" aria-label="품목 유형">
          {([['', '전체'], ['SLAB', '슬래브'], ['COIL', '코일']] as const).map(([v, l]) => (
            <button key={v} type="button" className={itemType === v ? 'is-on' : undefined} onClick={() => setItemType(v)}>{l}</button>
          ))}
        </div>
        <SelectBox value={gradeId} onChange={setGradeId} label="강종" style={{ width: 120 }}>
          <option value="">강종 전체</option>
          {grades.data?.map((g) => <option key={g.id} value={g.id}>{g.steelGradeCode}</option>)}
        </SelectBox>
        <SelectBox value={active} onChange={(v) => setActive(v as '' | 'true' | 'false')} label="사용 여부" style={{ width: 120 }}>{ACTIVE_OPTIONS}</SelectBox>
        {!canEdit ? <LockHint /> : null}
        <AddButton canEdit={canEdit} onClick={() => setEditing('new')}>규격 추가</AddButton>
      </CardHead>
      <QueryBoundary query={specs}>
        {(rows) => (
          <div className="md-scroll">
            <table className="hl-table hl-table--compact">
              <thead>
                <tr>
                  <th>규격 코드</th>
                  <th>유형</th>
                  <th>강종</th>
                  <th>두께 × 폭 × 길이 (mm)</th>
                  <th className="num">1매 이론중량</th>
                  <th>매핑된 규격</th>
                  <th className="num">열연 계획 수율</th>
                  <th>사용 여부</th>
                  <th>사용</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className={s.isActive ? undefined : 'is-muted'}>
                    <td className="mono">{s.specCode}</td>
                    <td>{s.itemTypeName}</td>
                    <td className="mono">{s.steelGradeCode}</td>
                    <td className="tnum">{fmtDims(s.thicknessMm, s.widthMm, s.lengthMm)}</td>
                    <td className="num">{fmtTon(s.theoreticalWeightTon)}</td>
                    <td>
                      {s.mappedSpec ? (
                        <button type="button" className="hl-link-id mono" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={goMapping} title="규격 매핑 탭으로 이동">{s.mappedSpec.specCode}</button>
                      ) : <span className="hl-danger-text">매핑 없음</span>}
                    </td>
                    <td className="num">{s.hotRollingPlannedYieldRate ?? <span className="hl-muted">-</span>}</td>
                    <td>{s.isUsed ? <Badge tone="run" title="수주·예약·생산계획·LOT·재고에서 쓰여요">사용됨</Badge> : <span className="hl-muted">미사용</span>}</td>
                    <td><ActiveToggle active={s.isActive} canEdit={canEdit} pending={toggle.isPending} onToggle={() => toggle.mutate(s)} /></td>
                    <td className="num"><EditButton label={s.specCode} canEdit={canEdit} onClick={() => setEditing(s)} /></td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={10}><EmptyNote>조건에 맞는 규격이 없어요</EmptyNote></td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </QueryBoundary>
      <div className="hl-card__foot">
        <span className="hl-cap">규격 코드와 이론중량은 서버가 만들어요 · 삭제 대신 사용 안 함으로 바꿔요 · 사용 중지한 규격은 수주 등록 선택 목록에서 빠져요</span>
      </div>
      {editing ? <ProductSpecModal spec={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function ProductSpecModal({ spec, onClose }: { spec: ProductSpecView | null; onClose: () => void }) {
  const editing = !!spec;
  const used = !!spec?.isUsed;
  const grades = useSteelGrades({ active: 'true' });
  const yards = useYards({ active: 'true' });
  const [type, setType] = useState<SpecItemType>(spec?.itemType ?? 'SLAB');
  const [gradeId, setGradeId] = useState(spec ? String(spec.steelGradeId) : '');
  const [t, setT] = useState(spec?.thicknessMm ?? '');
  const [w, setW] = useState(spec?.widthMm ?? '');
  const [l, setL] = useState(spec?.lengthMm ?? '');
  const [yardId, setYardId] = useState(spec?.yardId ? String(spec.yardId) : '');
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const nums = { t: parseDec(t, 2), w: parseDec(w, 2), l: parseDec(l, 2) };
  const errors = {
    grade: gradeId ? null : '강종을 선택해 주세요',
    t: nums.t && nums.t <= LIMITS.thickness ? null : `0보다 크고 ${LIMITS.thickness.toLocaleString()} 이하, 소수 2자리까지`,
    w: nums.w && nums.w <= LIMITS.width ? null : `0보다 크고 ${LIMITS.width.toLocaleString()} 이하, 소수 2자리까지`,
    l: nums.l && nums.l <= LIMITS.length ? null : `0보다 크고 ${LIMITS.length.toLocaleString()} 이하, 소수 2자리까지`,
  };
  const dimsOk = !errors.t && !errors.w && !errors.l;
  const preview = useMemo(() => {
    if (!dimsOk) return null;
    try { return calcTheoreticalWeightTon(t.trim(), w.trim(), l.trim()); } catch { return null; }
  }, [dimsOk, t, w, l]);

  const save = useMasterAction(
    (input: { create: true; body: Parameters<typeof masterApi.productSpecs.create>[0] } | { create: false; body: UpdateProductSpecBody & { id: number } }) =>
      input.create ? masterApi.productSpecs.create(input.body) : masterApi.productSpecs.update(input.body),
    editing ? '규격을 저장했어요' : '규격을 추가했어요',
    onClose,
  );
  const submit = () => {
    setTried(true);
    setServerError(null);
    const yard = yardId ? Number(yardId) : null;
    const opts = { onError: (e: unknown) => setServerError(errMsg(e)) };
    if (spec) {
      const body: UpdateProductSpecBody & { id: number } = { id: spec.id };
      if (!used) {
        if (Object.values(errors).some(Boolean) || !nums.t || !nums.w || !nums.l) return;
        if (Number(gradeId) !== spec.steelGradeId) body.steelGradeId = Number(gradeId);
        if (nums.t !== Number(spec.thicknessMm)) body.thicknessMm = nums.t;
        if (nums.w !== Number(spec.widthMm)) body.widthMm = nums.w;
        if (nums.l !== Number(spec.lengthMm)) body.lengthMm = nums.l;
      }
      if (yard !== spec.yardId) body.yardId = yard;
      if (Object.keys(body).length === 1) return setServerError('바뀐 내용이 없어요');
      save.mutate({ create: false, body }, opts);
    } else {
      if (Object.values(errors).some(Boolean) || !nums.t || !nums.w || !nums.l) return;
      save.mutate({ create: true, body: { itemType: type, steelGradeId: Number(gradeId), thicknessMm: nums.t, widthMm: nums.w, lengthMm: nums.l, yardId: yard } }, opts);
    }
  };

  const yardOptions = yards.data?.filter((y) => y.yardType === type) ?? [];
  const show = (k: keyof typeof errors) => (tried && !used ? errors[k] : null);

  return (
    <Modal
      title={editing ? `규격 수정 · ${spec.specCode}` : '규격 추가'}
      onClose={onClose}
      width={560}
      footer={<FormFooter error={serverError} hint="저장하면 규격 코드와 이론중량을 서버가 계산해 저장해요" onClose={onClose} onSubmit={submit} pending={save.isPending} submitLabel={editing ? '저장' : '추가'} />}
    >
      {used ? <div className="hl-banner hl-banner--wait"><Icon name="lock" /><div>{USED_HINT}</div></div> : null}
      <div className="hl-field">
        <span className="hl-field__label">품목 유형<span className="req">*</span></span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(['SLAB', 'COIL'] as const).map((k) => (
            <label key={k} className={`hl-radio-card${type === k ? ' is-on' : ''}`} style={{ alignItems: 'center', padding: '10px 12px', ...(editing && type !== k ? { opacity: 0.55 } : {}) }}>
              <input type="radio" name="md-spec-type" checked={type === k} disabled={editing} onChange={() => { setType(k); setYardId(''); }} aria-label={k === 'SLAB' ? '슬래브' : '코일'} />
              <Icon name={k === 'SLAB' ? 'slab' : 'coil'} />
              <b style={{ fontSize: 13 }}>{k === 'SLAB' ? '슬래브' : '코일'}</b>
            </label>
          ))}
        </div>
        {editing ? <span className="hl-field__hint">품목 유형은 바꿀 수 없어요</span> : null}
      </div>
      <Field label={<>강종<span className="req">*</span></>} error={show('grade')}>
        <SelectBox value={gradeId} onChange={setGradeId} disabled={used}>
          <option value="">강종 선택</option>
          {grades.data?.map((g) => <option key={g.id} value={g.id}>{g.steelGradeCode} · {g.steelGradeName}</option>)}
          {spec && !grades.data?.some((g) => g.id === spec.steelGradeId) ? <option value={spec.steelGradeId}>{spec.steelGradeCode} (사용 안 함)</option> : null}
        </SelectBox>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <Field label={<>두께 (mm)<span className="req">*</span></>} error={show('t')}>
          <input className={`hl-input num${show('t') ? ' is-error' : ''}`} inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)} readOnly={used} placeholder="250" aria-label="두께" />
        </Field>
        <Field label={<>폭 (mm)<span className="req">*</span></>} error={show('w')}>
          <input className={`hl-input num${show('w') ? ' is-error' : ''}`} inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} readOnly={used} placeholder="1200" aria-label="폭" />
        </Field>
        <Field label={<>길이 (mm)<span className="req">*</span></>} error={show('l')}>
          <input className={`hl-input num${show('l') ? ' is-error' : ''}`} inputMode="decimal" value={l} onChange={(e) => setL(e.target.value)} readOnly={used} placeholder="10000" aria-label="길이" />
        </Field>
      </div>
      <div className="hl-field">
        <span className="hl-field__label">1매 이론중량 <span className="hl-tag" style={{ marginLeft: 4 }}>계산값</span></span>
        <div className="hl-row" style={{ gap: 8 }}>
          <b className="tnum" style={{ fontSize: 18 }}>{used && spec ? fmtTon(spec.theoreticalWeightTon) : preview ? fmtTon(preview) : '–'}</b>
          <span className="hl-cap">{used ? '저장된 확정값' : '계산값 (서버가 저장 시 다시 계산해요)'}</span>
        </div>
        <span className="hl-field__hint tnum">{FORMULA}</span>
      </div>
      <Field label="야드" hint={type === 'SLAB' ? '슬래브 야드만 선택할 수 있어요 (선택)' : '코일 야드만 선택할 수 있어요 (선택)'}>
        <SelectBox value={yardId} onChange={setYardId}>
          <option value="">야드 없음</option>
          {yardOptions.map((y) => <option key={y.id} value={y.id}>{y.yardName} ({y.yardCode})</option>)}
          {spec?.yardId && !yardOptions.some((y) => y.id === spec.yardId) ? <option value={spec.yardId}>{spec.yardName ?? `야드 ${spec.yardId}`}</option> : null}
        </SelectBox>
      </Field>
    </Modal>
  );
}
