// 품목·원료 (REQ-MST-001, MST-007): 품목(단위 유형·기본 공급업체)과 원료(원료 코드·종류·기본 공급업체·야드).
import { useState } from 'react';
import { RAW_MATERIAL_TYPE, RAW_MATERIAL_TYPE_LABEL, type RawMaterialType } from '@fantasteel/shared';
import { masterApi, type ItemView, type RawMaterialView } from '@/api/masterData';
import { EmptyNote, Field, Modal, QueryBoundary } from '@/components/ui';
import { fmtTon } from '@/lib/format';
import { ACTIVE_OPTIONS, ActiveToggle, AddButton, CardHead, EditButton, errMsg, FormFooter, LockHint, SelectBox, useMasterAction } from './common';
import { useItems, useRawMaterials, useSuppliers, useYards } from './masterHooks';

const UNIT_LABEL = { QTY: 'QTY 매수', TON: 'TON 톤' } as const;
const MATERIAL_CODE_RE = /^[A-Z0-9]{1,10}$/;
const RM_TYPES = Object.values(RAW_MATERIAL_TYPE) as RawMaterialType[];

export function ItemMaterialTab({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="md-scroll md-col">
      {!canEdit ? <LockHint /> : null}
      <ItemsCard canEdit={canEdit} />
      <MaterialsCard canEdit={canEdit} />
    </div>
  );
}

function ItemsCard({ canEdit }: { canEdit: boolean }) {
  const items = useItems();
  const [editing, setEditing] = useState<ItemView | null>(null);
  const toggle = useMasterAction((i: ItemView) => masterApi.items.update({ id: i.id, isActive: !i.isActive }), '품목을 바꿨어요');
  return (
    <section className="hl-card md-card" style={{ flex: 'none' }}>
      <CardHead title="품목" count={items.data?.length} sub="단위 유형: 제품(슬래브·코일)은 QTY 매수, 원료는 TON 톤 · 서버가 정해요" />
      <QueryBoundary query={items}>
        {(rows) => (
          <div style={{ overflow: 'auto' }}>
            <table className="hl-table hl-table--compact">
              <thead><tr><th>품목 코드</th><th>품목명</th><th>유형</th><th>단위 유형</th><th>기본 공급업체</th><th>사용</th><th className="num" /></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={i.isActive ? undefined : 'is-muted'}>
                    <td className="mono">{i.itemCode}</td>
                    <td>{i.itemName}</td>
                    <td>{i.itemTypeName}</td>
                    <td><span className="hl-tag">{UNIT_LABEL[i.unitType]}</span></td>
                    <td className="hl-ink2">{i.defaultSupplierName ?? '–'}</td>
                    <td><ActiveToggle active={i.isActive} canEdit={canEdit} pending={toggle.isPending} onToggle={() => toggle.mutate(i)} /></td>
                    <td className="num"><EditButton label={i.itemName} canEdit={canEdit} onClick={() => setEditing(i)} /></td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={7}><EmptyNote>등록된 품목이 없어요</EmptyNote></td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </QueryBoundary>
      <div className="hl-card__foot"><span className="hl-cap">품목 코드·유형은 바꿀 수 없어요 · 원료 품목은 아래 원료 등록에서 만들어요</span></div>
      {editing ? <ItemModal item={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function ItemModal({ item, onClose }: { item: ItemView; onClose: () => void }) {
  const suppliers = useSuppliers({ active: 'true' });
  const [name, setName] = useState(item.itemName);
  const [supplierId, setSupplierId] = useState(item.defaultSupplierId ? String(item.defaultSupplierId) : '');
  const [serverError, setServerError] = useState<string | null>(null);
  const save = useMasterAction(masterApi.items.update, '품목을 저장했어요', onClose);
  const submit = () => {
    setServerError(null);
    if (!name.trim()) return setServerError('품목명을 입력해 주세요');
    save.mutate({ id: item.id, itemName: name.trim(), defaultSupplierId: supplierId ? Number(supplierId) : null }, { onError: (e) => setServerError(errMsg(e)) });
  };
  return (
    <Modal title={`품목 수정 · ${item.itemCode}`} onClose={onClose} footer={<FormFooter error={serverError} onClose={onClose} onSubmit={submit} pending={save.isPending} />}>
      <Field label="품목 코드 · 유형" hint="바꿀 수 없어요"><input className="hl-input mono" readOnly value={`${item.itemCode} · ${item.itemTypeName} · ${UNIT_LABEL[item.unitType]}`} /></Field>
      <Field label={<>품목명<span className="req">*</span></>}><input className="hl-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} /></Field>
      <Field label="기본 공급업체" hint="사용 중인 공급업체만 고를 수 있어요">
        <SelectBox value={supplierId} onChange={setSupplierId}>
          <option value="">지정 안 함</option>
          {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.supplierName} ({s.supplierCode})</option>)}
          {item.defaultSupplierId && !suppliers.data?.some((s) => s.id === item.defaultSupplierId) ? <option value={item.defaultSupplierId}>{item.defaultSupplierName} (사용 안 함)</option> : null}
        </SelectBox>
      </Field>
    </Modal>
  );
}

function MaterialsCard({ canEdit }: { canEdit: boolean }) {
  const [type, setType] = useState<'' | RawMaterialType>('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [editing, setEditing] = useState<RawMaterialView | 'new' | null>(null);
  const materials = useRawMaterials({ rawMaterialType: type || undefined, active: active || undefined });
  const toggle = useMasterAction((m: RawMaterialView) => masterApi.rawMaterials.update({ id: m.id, isActive: !m.isActive }), '원료를 바꿨어요');
  return (
    <section className="hl-card md-card" style={{ flex: 'none' }}>
      <CardHead title="원료" count={materials.data?.length} sub="원료 코드는 LOT 번호(RM-원료코드-…)에 쓰여요">
        <SelectBox value={type} onChange={(v) => setType(v as '' | RawMaterialType)} label="원료 종류" style={{ width: 120 }}>
          <option value="">종류 전체</option>
          {RM_TYPES.map((t) => <option key={t} value={t}>{RAW_MATERIAL_TYPE_LABEL[t]}</option>)}
        </SelectBox>
        <SelectBox value={active} onChange={(v) => setActive(v as '' | 'true' | 'false')} label="사용 여부" style={{ width: 120 }}>{ACTIVE_OPTIONS}</SelectBox>
        <AddButton canEdit={canEdit} onClick={() => setEditing('new')}>원료 추가</AddButton>
      </CardHead>
      <QueryBoundary query={materials}>
        {(rows) => (
          <div style={{ overflow: 'auto' }}>
            <table className="hl-table hl-table--compact">
              <thead><tr><th>원료 코드</th><th>원료명</th><th>종류</th><th>단위 유형</th><th>기본 공급업체</th><th>야드</th><th className="num">재고</th><th>사용</th><th className="num" /></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className={m.isActive ? undefined : 'is-muted'}>
                    <td className="mono">{m.materialCode}</td>
                    <td>{m.itemName}</td>
                    <td>{m.rawMaterialTypeName}</td>
                    <td><span className="hl-tag">{UNIT_LABEL[m.unitType]}</span></td>
                    <td>{m.defaultSupplierName ?? <span className="hl-danger-text">없음</span>}</td>
                    <td className="hl-ink2">{m.yardName ?? '–'}</td>
                    <td className="num">{fmtTon(m.onHandTon)}</td>
                    <td><ActiveToggle active={m.isActive} canEdit={canEdit} pending={toggle.isPending} onToggle={() => toggle.mutate(m)} /></td>
                    <td className="num"><EditButton label={m.itemName} canEdit={canEdit} onClick={() => setEditing(m)} /></td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={9}><EmptyNote>조건에 맞는 원료가 없어요</EmptyNote></td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </QueryBoundary>
      <div className="hl-card__foot"><span className="hl-cap">원료 코드·종류는 만든 뒤 바꿀 수 없어요 · 기본 공급업체를 비우면 준비 상태 점검에 걸려요 · 재고는 읽기 전용이에요</span></div>
      {editing ? <MaterialModal material={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function MaterialModal({ material, onClose }: { material: RawMaterialView | null; onClose: () => void }) {
  const editing = !!material;
  const suppliers = useSuppliers({ active: 'true' });
  const yards = useYards({ yardType: 'RAW_MATERIAL', active: 'true' });
  const [code, setCode] = useState(material?.materialCode ?? '');
  const [name, setName] = useState(material?.itemName ?? '');
  const [type, setType] = useState<RawMaterialType>(material?.rawMaterialType ?? 'IRON_ORE');
  const [supplierId, setSupplierId] = useState(material?.defaultSupplierId ? String(material.defaultSupplierId) : '');
  const [yardId, setYardId] = useState(material?.yardId ? String(material.yardId) : '');
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useMasterAction(masterApi.rawMaterials.create, '원료를 추가했어요', onClose);
  const update = useMasterAction(masterApi.rawMaterials.update, '원료를 저장했어요', onClose);
  const errors = { code: MATERIAL_CODE_RE.test(code) ? null : '영문 대문자·숫자 10자 이내 (예: IO)', name: name.trim() ? null : '원료명을 입력해 주세요' };
  const submit = () => {
    setTried(true);
    setServerError(null);
    if (errors.code || errors.name) return;
    const opts = { onError: (e: unknown) => setServerError(errMsg(e)) };
    const common = { itemName: name.trim(), yardId: yardId ? Number(yardId) : null, defaultSupplierId: supplierId ? Number(supplierId) : null };
    if (material) update.mutate({ id: material.id, ...common }, opts);
    else create.mutate({ materialCode: code, rawMaterialType: type, ...common }, opts);
  };
  return (
    <Modal
      title={editing ? `원료 수정 · ${material.materialCode}` : '원료 추가'}
      onClose={onClose}
      footer={<FormFooter error={serverError} hint={editing ? undefined : '만들면 품목과 재고(0 t)가 함께 생겨요'} onClose={onClose} onSubmit={submit} pending={create.isPending || update.isPending} submitLabel={editing ? '저장' : '추가'} />}
    >
      <Field label={<>원료 코드<span className="req">*</span></>} error={tried && !editing ? errors.code : null} hint="LOT 번호에 쓰여요 · 만든 뒤에는 바꿀 수 없어요">
        <input className="hl-input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} readOnly={editing} placeholder="IO" maxLength={10} />
      </Field>
      <Field label={<>원료명<span className="req">*</span></>} error={tried ? errors.name : null}><input className="hl-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} /></Field>
      <Field label="원료 종류" hint={editing ? '만든 뒤에는 바꿀 수 없어요' : undefined}>
        <SelectBox value={type} onChange={(v) => setType(v as RawMaterialType)} disabled={editing}>
          {RM_TYPES.map((t) => <option key={t} value={t}>{RAW_MATERIAL_TYPE_LABEL[t]}</option>)}
        </SelectBox>
      </Field>
      <Field label="기본 공급업체" hint="사용 중인 공급업체만 고를 수 있어요">
        <SelectBox value={supplierId} onChange={setSupplierId}>
          <option value="">지정 안 함</option>
          {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.supplierName} ({s.supplierCode})</option>)}
          {material?.defaultSupplierId && !suppliers.data?.some((s) => s.id === material.defaultSupplierId) ? <option value={material.defaultSupplierId}>{material.defaultSupplierName} (사용 안 함)</option> : null}
        </SelectBox>
      </Field>
      <Field label="야드" hint="원료 야드만 고를 수 있어요">
        <SelectBox value={yardId} onChange={setYardId}>
          <option value="">지정 안 함</option>
          {yards.data?.map((y) => <option key={y.id} value={y.id}>{y.yardName} ({y.yardCode})</option>)}
          {material?.yardId && !yards.data?.some((y) => y.id === material.yardId) ? <option value={material.yardId}>{material.yardName}</option> : null}
        </SelectBox>
      </Field>
    </Modal>
  );
}
