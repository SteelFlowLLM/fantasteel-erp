// 규격 매핑 (REQ-MST-004): 슬래브 규격 1개 ↔ 코일 규격 1개. 열연 계획 수율 = 코일 이론중량 ÷ 슬래브 이론중량.
import { useState } from 'react';
import { masterApi, type ProductSpecView, type SpecMappingView } from '@/api/masterData';
import { Badge, EmptyNote, Field, Icon, Modal, QueryBoundary } from '@/components/ui';
import { fmtDims, fmtTon } from '@/lib/format';
import { AddButton, CardHead, DeleteButton, errMsg, FormFooter, LockHint, SelectBox, useMasterAction } from './common';
import { useProductSpecs, useSpecMappings, useSteelGrades } from './masterHooks';

const RULE = '코일 1개 이론중량 ≤ 슬래브 1매 이론중량';

export function SpecMappingTab({ canEdit }: { canEdit: boolean }) {
  const mappings = useSpecMappings();
  const [creating, setCreating] = useState(false);
  const remove = useMasterAction((m: SpecMappingView) => masterApi.specMappings.remove(m.id), '매핑을 삭제했어요');

  return (
    <section className="hl-card md-card">
      <CardHead title="슬래브 ↔ 코일 규격 매핑" count={mappings.data?.length} sub={`${RULE} · 열연 계획 수율 = 코일 ÷ 슬래브`}>
        {!canEdit ? <LockHint /> : null}
        <AddButton canEdit={canEdit} onClick={() => setCreating(true)}>매핑 추가</AddButton>
      </CardHead>
      <QueryBoundary query={mappings}>
        {(rows) => (
          <div className="md-scroll">
            <table className="hl-table hl-table--compact">
              <thead>
                <tr>
                  <th>강종</th>
                  <th>슬래브 규격</th>
                  <th className="num">슬래브 1매</th>
                  <th>코일 규격</th>
                  <th className="num">코일 1개</th>
                  <th className="num">열연 계획 수율</th>
                  <th>사용 여부</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.steelGradeCode}</td>
                    <td>
                      <div className="mono">{m.slabSpec.specCode}</div>
                      <div className="hl-cap tnum">{fmtDims(m.slabSpec.thicknessMm, m.slabSpec.widthMm, m.slabSpec.lengthMm)} mm</div>
                    </td>
                    <td className="num">{fmtTon(m.slabSpec.theoreticalWeightTon)}</td>
                    <td>
                      <div className="mono">{m.coilSpec.specCode}</div>
                      <div className="hl-cap tnum">{fmtDims(m.coilSpec.thicknessMm, m.coilSpec.widthMm, m.coilSpec.lengthMm)} mm</div>
                    </td>
                    <td className="num">{fmtTon(m.coilSpec.theoreticalWeightTon)}</td>
                    <td className="num"><b>{m.hotRollingPlannedYieldRate}</b> <span className="hl-cap">{(Number(m.hotRollingPlannedYieldRate) * 100).toFixed(2)}%</span></td>
                    <td>{m.isUsed ? <Badge tone="run" title="두 규격 중 하나라도 수주·재고·LOT에서 쓰이면 사용됨이에요">사용됨</Badge> : <span className="hl-muted">미사용</span>}</td>
                    <td className="num">
                      <DeleteButton
                        label={`${m.slabSpec.specCode} 매핑`}
                        canEdit={canEdit}
                        pending={remove.isPending}
                        disabledReason={m.isUsed ? '수주·재고·LOT에 사용된 규격의 매핑은 삭제할 수 없어요' : undefined}
                        onConfirm={() => remove.mutate(m)}
                      />
                    </td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={8}><EmptyNote>등록된 매핑이 없어요</EmptyNote></td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </QueryBoundary>
      <div className="hl-card__foot">
        <span className="hl-cap">열연 계획 수율은 저장하지 않고 두 규격의 이론중량으로 계산해요 · 사용된 규격의 매핑은 바꾸거나 삭제할 수 없어요 · 새 규격을 추가해 매핑해 주세요</span>
      </div>
      {creating ? <MappingModal onClose={() => setCreating(false)} /> : null}
    </section>
  );
}

function MappingModal({ onClose }: { onClose: () => void }) {
  const grades = useSteelGrades({ active: 'true' });
  const specs = useProductSpecs({ active: 'true' });
  const [gradeId, setGradeId] = useState('');
  const [slabId, setSlabId] = useState('');
  const [coilId, setCoilId] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useMasterAction((body: { slabSpecId: number; coilSpecId: number }) => masterApi.specMappings.create(body), '규격을 매핑했어요', onClose);

  const unmapped = (t: 'SLAB' | 'COIL'): ProductSpecView[] =>
    (specs.data ?? []).filter((s) => s.itemType === t && s.mappingId === null && (!gradeId || s.steelGradeId === Number(gradeId)));
  const slabs = unmapped('SLAB');
  const coils = unmapped('COIL');
  const slab = slabs.find((s) => s.id === Number(slabId));
  const coil = coils.find((s) => s.id === Number(coilId));
  const gradeMismatch = !!slab && !!coil && slab.steelGradeId !== coil.steelGradeId;
  const ruleBroken = !!slab && !!coil && Number(coil.theoreticalWeightTon) > Number(slab.theoreticalWeightTon);
  const yieldPreview = slab && coil && Number(slab.theoreticalWeightTon) > 0 ? (Number(coil.theoreticalWeightTon) / Number(slab.theoreticalWeightTon)).toFixed(4) : null;

  const submit = () => {
    setServerError(null);
    if (!slab || !coil) return;
    create.mutate({ slabSpecId: slab.id, coilSpecId: coil.id }, { onError: (e) => setServerError(errMsg(e, '매핑하지 못했어요')) });
  };
  const opt = (s: ProductSpecView) => <option key={s.id} value={s.id}>{s.specCode} · {fmtTon(s.theoreticalWeightTon)}</option>;

  return (
    <Modal
      title="규격 매핑 추가"
      onClose={onClose}
      width={560}
      footer={<FormFooter error={serverError} hint={RULE} onClose={onClose} onSubmit={submit} pending={create.isPending} disabled={!slab || !coil || ruleBroken || gradeMismatch} submitLabel="매핑" />}
    >
      <div className="hl-banner hl-banner--run"><Icon name="info" /><div><b>규칙:</b> {RULE}. 같은 강종끼리만, 아직 매핑되지 않은 규격만 고를 수 있어요.</div></div>
      <Field label="강종" hint="강종을 고르면 그 강종의 규격만 보여요">
        <SelectBox value={gradeId} onChange={(v) => { setGradeId(v); setSlabId(''); setCoilId(''); }}>
          <option value="">전체 강종</option>
          {grades.data?.map((g) => <option key={g.id} value={g.id}>{g.steelGradeCode} · {g.steelGradeName}</option>)}
        </SelectBox>
      </Field>
      <Field label={<>매핑 안 된 슬래브 규격<span className="req">*</span></>} hint={slabs.length ? undefined : '매핑할 수 있는 슬래브 규격이 없어요. 제품 규격 탭에서 먼저 추가해 주세요'}>
        <SelectBox value={slabId} onChange={setSlabId}>
          <option value="">슬래브 규격 선택</option>
          {slabs.map(opt)}
        </SelectBox>
      </Field>
      <Field label={<>매핑 안 된 코일 규격<span className="req">*</span></>} hint={coils.length ? undefined : '매핑할 수 있는 코일 규격이 없어요. 제품 규격 탭에서 먼저 추가해 주세요'}>
        <SelectBox value={coilId} onChange={setCoilId}>
          <option value="">코일 규격 선택</option>
          {coils.map(opt)}
        </SelectBox>
      </Field>
      {gradeMismatch ? <span className="hl-cap hl-danger-text">강종이 다른 규격은 매핑할 수 없어요</span> : null}
      <div className="hl-col" style={{ gap: 6, padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6 }}>
        <span className="hl-label">비교 <span className="hl-tag" style={{ marginLeft: 4 }}>계산값</span></span>
        <dl className="hl-kv" style={{ rowGap: 6 }}>
          <dt>슬래브 1매</dt>
          <dd className="tnum">{slab ? `${fmtTon(slab.theoreticalWeightTon)} · ${fmtDims(slab.thicknessMm, slab.widthMm, slab.lengthMm)} mm` : '–'}</dd>
          <dt>코일 1개</dt>
          <dd className="tnum">{coil ? `${fmtTon(coil.theoreticalWeightTon)} · ${fmtDims(coil.thicknessMm, coil.widthMm, coil.lengthMm)} mm` : '–'}</dd>
          <dt>열연 계획 수율</dt>
          <dd className="tnum">{yieldPreview ?? '–'}</dd>
        </dl>
        {ruleBroken ? <span className="hl-cap hl-danger-text" role="alert">코일 이론중량이 슬래브 이론중량보다 커서 매핑할 수 없어요 ({RULE})</span> : null}
      </div>
    </Modal>
  );
}
