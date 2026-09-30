// 고객사·공급업체 (REQ-MST-007) · 야드 (REQ-MST-008): 단순 등록·수정·사용 토글·삭제.
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { YARD_TYPE, YARD_TYPE_LABEL, type YardType } from '@fantasteel/shared';
import { masterApi, type ListMasterQuery } from '@/api/masterData';
import { EmptyNote, Field, Modal, QueryBoundary } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { ACTIVE_OPTIONS, ActiveToggle, AddButton, CardHead, CODE_RE_UPPER, DeleteButton, EditButton, errMsg, FormFooter, LockHint, SelectBox, useMasterAction } from './common';
import { useCustomers, useSuppliers, useYards } from './masterHooks';

type Sub = 'customers' | 'suppliers' | 'yards';
const SUBS: { key: Sub; label: string }[] = [
  { key: 'customers', label: '고객사' },
  { key: 'suppliers', label: '공급업체' },
  { key: 'yards', label: '야드' },
];
const YARD_TYPES = Object.values(YARD_TYPE) as YardType[];

interface PartyRow { id: number; code: string; name: string; isActive: boolean; updatedAt: string; extra?: ReactNode }
interface PartyConfig {
  noun: string;
  codeLabel: string;
  nameLabel: string;
  deleteHint: string;
  yardType?: boolean;
}
const CONFIG: Record<Sub, PartyConfig> = {
  customers: { noun: '고객사', codeLabel: '고객사 코드', nameLabel: '고객사명', deleteHint: '수주·출하요청·밀시트가 쓰는 고객사는 삭제할 수 없어요' },
  suppliers: { noun: '공급업체', codeLabel: '공급업체 코드', nameLabel: '공급업체명', deleteHint: '품목·발주·LOT가 쓰는 공급업체는 삭제할 수 없어요' },
  yards: { noun: '야드', codeLabel: '야드 코드', nameLabel: '야드명', deleteHint: '원료·규격·LOT·입고가 쓰는 야드는 삭제할 수 없어요', yardType: true },
};

// 탭마다 다른 조회 훅을 같은 모양(PartyRow)으로 바꿔 준다. sub가 바뀌면 PartyPanel이 새로 만들어지므로 훅 순서는 일정하다.
type RowsQuery = { data: PartyRow[] | undefined; isLoading: boolean; error: unknown; refetch: () => unknown };
function useCustomerRows(q: ListMasterQuery): RowsQuery {
  const r = useCustomers(q);
  return { data: r.data?.map((c) => ({ id: c.id, code: c.customerCode, name: c.customerName, isActive: c.isActive, updatedAt: c.updatedAt })), isLoading: r.isLoading, error: r.error, refetch: r.refetch };
}
function useSupplierRows(q: ListMasterQuery): RowsQuery {
  const r = useSuppliers(q);
  return { data: r.data?.map((c) => ({ id: c.id, code: c.supplierCode, name: c.supplierName, isActive: c.isActive, updatedAt: c.updatedAt })), isLoading: r.isLoading, error: r.error, refetch: r.refetch };
}
function useYardRows(q: ListMasterQuery): RowsQuery {
  const r = useYards(q);
  return { data: r.data?.map((y) => ({ id: y.id, code: y.yardCode, name: y.yardName, isActive: y.isActive, updatedAt: y.updatedAt, extra: YARD_TYPE_LABEL[y.yardType] })), isLoading: r.isLoading, error: r.error, refetch: r.refetch };
}
const ROW_HOOKS: Record<Sub, (q: ListMasterQuery) => RowsQuery> = { customers: useCustomerRows, suppliers: useSupplierRows, yards: useYardRows };

export function PartyYardTab({ canEdit }: { canEdit: boolean }) {
  const [params, setParams] = useSearchParams();
  const subParam = params.get('sub');
  const sub: Sub = SUBS.some((s) => s.key === subParam) ? (subParam as Sub) : 'customers';
  const setSub = (s: Sub) => setParams((p) => { const n = new URLSearchParams(p); n.set('sub', s); return n; }, { replace: true });
  return (
    <div className="md-col" style={{ flex: 1, minHeight: 0 }}>
      <div className="hl-seg" style={{ alignSelf: 'flex-start' }} role="group" aria-label="고객사·공급업체·야드">
        {SUBS.map((s) => <button key={s.key} type="button" className={sub === s.key ? 'is-on' : undefined} onClick={() => setSub(s.key)}>{s.label}</button>)}
      </div>
      <PartyPanel key={sub} sub={sub} canEdit={canEdit} />
    </div>
  );
}

function PartyPanel({ sub, canEdit }: { sub: Sub; canEdit: boolean }) {
  const cfg = CONFIG[sub];
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<PartyRow | 'new' | null>(null);
  const query = { active: active || undefined, q: q.trim() || undefined };
  const current = ROW_HOOKS[sub](query);
  const rowsOf = (): PartyRow[] => current.data ?? [];

  const toggle = useMasterAction<PartyRow, unknown>((r) => {
    const body = { id: r.id, isActive: !r.isActive };
    return sub === 'customers' ? masterApi.customers.update(body) : sub === 'suppliers' ? masterApi.suppliers.update(body) : masterApi.yards.update(body);
  }, `${cfg.noun}을(를) 바꿨어요`);
  const remove = useMasterAction<PartyRow, unknown>((r) => (sub === 'customers' ? masterApi.customers.remove(r.id) : sub === 'suppliers' ? masterApi.suppliers.remove(r.id) : masterApi.yards.remove(r.id)), `${cfg.noun}을(를) 삭제했어요`);

  return (
    <section className="hl-card md-card">
      <CardHead title={cfg.noun} count={current.data ? rowsOf().length : undefined} sub="삭제 대신 사용 안 함으로 바꿔요 · 쓰이지 않는 것만 삭제돼요">
        <label className="hl-inputwrap" style={{ width: 180 }}>
          <i className="ic ic-search ic--sm" />
          <input className="hl-input" type="search" placeholder="코드·이름" aria-label={`${cfg.noun} 검색`} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <SelectBox value={active} onChange={(v) => setActive(v as '' | 'true' | 'false')} label="사용 여부" style={{ width: 120 }}>{ACTIVE_OPTIONS}</SelectBox>
        {!canEdit ? <LockHint /> : null}
        <AddButton canEdit={canEdit} onClick={() => setEditing('new')}>{cfg.noun} 추가</AddButton>
      </CardHead>
      <QueryBoundary query={current}>
        {() => {
          const rows = rowsOf();
          return (
            <div className="md-scroll">
              <table className="hl-table hl-table--compact">
                <thead><tr><th>{cfg.codeLabel}</th><th>{cfg.nameLabel}</th>{cfg.yardType ? <th>야드 종류</th> : null}<th>수정일</th><th>사용</th><th className="num" /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.isActive ? undefined : 'is-muted'}>
                      <td className="mono">{r.code}</td>
                      <td>{r.name}</td>
                      {cfg.yardType ? <td className="hl-ink2">{r.extra}</td> : null}
                      <td className="tnum hl-ink2">{fmtDate(r.updatedAt)}</td>
                      <td><ActiveToggle active={r.isActive} canEdit={canEdit} pending={toggle.isPending} onToggle={() => toggle.mutate(r)} /></td>
                      <td className="num">
                        <span className="hl-row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          <EditButton label={r.name} canEdit={canEdit} onClick={() => setEditing(r)} />
                          <DeleteButton label={r.name} canEdit={canEdit} pending={remove.isPending} onConfirm={() => remove.mutate(r)} />
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!rows.length ? <tr><td colSpan={cfg.yardType ? 6 : 5}><EmptyNote>조건에 맞는 {cfg.noun}이(가) 없어요</EmptyNote></td></tr> : null}
                </tbody>
              </table>
            </div>
          );
        }}
      </QueryBoundary>
      <div className="hl-card__foot"><span className="hl-cap">{cfg.deleteHint} · 그럴 땐 서버가 알려 주는 대로 사용 안 함으로 바꿔 주세요{sub === 'yards' ? ' · 야드 종류는 등록 뒤 바꿀 수 없어요 · 야드 안의 위치는 관리하지 않아요' : ''}</span></div>
      {editing ? <PartyModal sub={sub} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function PartyModal({ sub, row, onClose }: { sub: Sub; row: PartyRow | null; onClose: () => void }) {
  const cfg = CONFIG[sub];
  const editing = !!row;
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [yardType, setYardType] = useState<YardType>('RAW_MATERIAL');
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const save = useMasterAction<{ id?: number; code: string; name: string; yardType: YardType }, unknown>((input) => {
    if (sub === 'customers') return input.id ? masterApi.customers.update({ id: input.id, customerName: input.name }) : masterApi.customers.create({ customerCode: input.code, customerName: input.name });
    if (sub === 'suppliers') return input.id ? masterApi.suppliers.update({ id: input.id, supplierName: input.name }) : masterApi.suppliers.create({ supplierCode: input.code, supplierName: input.name });
    return input.id ? masterApi.yards.update({ id: input.id, yardName: input.name }) : masterApi.yards.create({ yardCode: input.code, yardName: input.name, yardType: input.yardType });
  }, editing ? `${cfg.noun}을(를) 저장했어요` : `${cfg.noun}을(를) 추가했어요`, onClose);

  const errors = { code: CODE_RE_UPPER.test(code) ? null : '영문 대문자·숫자·밑줄·하이픈으로 30자 이내 (예: CUS-01)', name: name.trim() ? null : `${cfg.nameLabel}을 입력해 주세요` };
  const submit = () => {
    setTried(true);
    setServerError(null);
    if ((!editing && errors.code) || errors.name) return;
    save.mutate({ id: row?.id, code, name: name.trim(), yardType }, { onError: (e) => setServerError(errMsg(e)) });
  };

  return (
    <Modal title={editing ? `${cfg.noun} 수정 · ${row.code}` : `${cfg.noun} 추가`} onClose={onClose} footer={<FormFooter error={serverError} onClose={onClose} onSubmit={submit} pending={save.isPending} submitLabel={editing ? '저장' : '추가'} />}>
      <Field label={<>{cfg.codeLabel}<span className="req">*</span></>} error={tried && !editing ? errors.code : null} hint={editing ? '만든 뒤에는 바꿀 수 없어요' : undefined}>
        <input className="hl-input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} readOnly={editing} maxLength={30} />
      </Field>
      <Field label={<>{cfg.nameLabel}<span className="req">*</span></>} error={tried ? errors.name : null}>
        <input className="hl-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
      </Field>
      {cfg.yardType ? (
        <Field label="야드 종류" hint="등록 뒤에는 바꿀 수 없어요">
          <SelectBox value={yardType} onChange={(v) => setYardType(v as YardType)} disabled={editing}>
            {YARD_TYPES.map((t) => <option key={t} value={t}>{YARD_TYPE_LABEL[t]}</option>)}
          </SelectBox>
        </Field>
      ) : null}
    </Modal>
  );
}
