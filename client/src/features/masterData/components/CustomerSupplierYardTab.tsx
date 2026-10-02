'use client';

// 고객사·공급업체 (REQ-MST-007), 야드 (REQ-MST-008: 원료·슬래브·코일 야드, 야드 안 위치는 관리하지 않음).
// '사용 안 함' 토글 없이 삭제만 둔다. 쓰는 곳이 있으면 삭제를 거부한다 (PLAN 5장, 컨벤션 7-2).
// 야드 수정 창은 그 야드의 실제 야드 유형을 보여 준다 (옛 화면의 '항상 원료 야드' 표시 버그 수정, 보고서 5).
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { YARD_TYPE, YARD_TYPE_LABEL, type YardType } from '@/codes';
import { masterDataApi } from '@/api/masterData';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Segmented } from '@/components/Tabs';
import { MASTER_LOCK_TEXT, ModalFooter, RowActions, TableFoot } from '@/features/masterData/components/MasterParts';
import { useAction } from '@/hooks/useAction';
import { useMasterDataFieldErrors } from '@/hooks/useMasterDataForm';
import { useMasterCustomers, useMasterSuppliers, useMasterYards } from '@/hooks/useMasterData';

// 화면 안에서 세 목록을 고르는 값 (주소 &sub=)
type ListKind = 'customers' | 'suppliers' | 'yards';
const KINDS: readonly { key: ListKind; label: string }[] = [
  { key: 'customers', label: '고객사' },
  { key: 'suppliers', label: '공급업체' },
  { key: 'yards', label: '야드' },
];
const isListKind = (value: string | null): value is ListKind => KINDS.some((k) => k.key === value);

/** 세 대상을 같은 표로 그리기 위한 화면 행 (저장할 때는 ERD 이름의 입력으로 바꾼다) */
interface CodeNameRow {
  id: number;
  code: string;
  name: string;
  yardType: YardType | null;
  referenceText: string | null;
  updatedAt: string;
}

interface KindText {
  what: string;
  /** 입력칸 오류 키 = api 입력 이름 (ERD customer_code·supplier_code·yard_code …) */
  codeField: 'customerCode' | 'supplierCode' | 'yardCode';
  nameField: 'customerName' | 'supplierName' | 'yardName';
  codeLabel: string;
  nameLabel: string;
  nameMax: number;
  codeExample: string;
  foot: string;
}

const KIND_TEXT: Record<ListKind, KindText> = {
  customers: {
    what: '고객사',
    codeField: 'customerCode',
    nameField: 'customerName',
    codeLabel: '고객사 코드',
    nameLabel: '고객사명',
    nameMax: 100,
    codeExample: 'CUS-05',
    foot: '수주·출하요청이 쓰는 고객사는 지울 수 없어요',
  },
  suppliers: {
    what: '공급업체',
    codeField: 'supplierCode',
    nameField: 'supplierName',
    codeLabel: '공급업체 코드',
    nameLabel: '공급업체명',
    nameMax: 100,
    codeExample: 'SUP-05',
    foot: '원료 기본 공급업체·발주가 쓰는 공급업체는 지울 수 없어요',
  },
  yards: {
    what: '야드',
    codeField: 'yardCode',
    nameField: 'yardName',
    codeLabel: '야드 코드',
    nameLabel: '야드명',
    nameMax: 50,
    codeExample: 'YD-CL-02',
    foot: '품목 기본 야드·LOT·입고가 쓰는 야드는 지울 수 없어요 · 야드 유형은 만든 뒤 바꿀 수 없어요 · 야드 안의 위치는 관리하지 않아요',
  },
};

export function CustomerSupplierYardTab({ canEdit }: { canEdit: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const subParam = params.get('sub');
  const kind: ListKind = isListKind(subParam) ? subParam : 'customers';
  const setKind = (next: ListKind) => router.replace(`${pathname}?tab=customer-supplier-yard&sub=${next}`, { scroll: false });
  return (
    <>
      <Segmented ariaLabel="대상" items={KINDS} active={kind} onChange={setKind} className="self-start" />
      {kind === 'customers' ? <CustomerList canEdit={canEdit} /> : null}
      {kind === 'suppliers' ? <SupplierList canEdit={canEdit} /> : null}
      {kind === 'yards' ? <YardList canEdit={canEdit} /> : null}
    </>
  );
}

function CustomerList({ canEdit }: { canEdit: boolean }) {
  const query = useMasterCustomers();
  const rows = query.data?.map((c): CodeNameRow => ({ id: c.id, code: c.customerCode, name: c.customerName, yardType: null, referenceText: c.referenceText, updatedAt: c.updatedAt }));
  return <CodeNameTable kind="customers" canEdit={canEdit} query={{ ...query, data: rows }} remove={masterDataApi.deleteCustomer} />;
}

function SupplierList({ canEdit }: { canEdit: boolean }) {
  const query = useMasterSuppliers();
  const rows = query.data?.map((s): CodeNameRow => ({ id: s.id, code: s.supplierCode, name: s.supplierName, yardType: null, referenceText: s.referenceText, updatedAt: s.updatedAt }));
  return <CodeNameTable kind="suppliers" canEdit={canEdit} query={{ ...query, data: rows }} remove={masterDataApi.deleteSupplier} />;
}

function YardList({ canEdit }: { canEdit: boolean }) {
  const query = useMasterYards();
  const rows = query.data?.map((y): CodeNameRow => ({ id: y.id, code: y.yardCode, name: y.yardName, yardType: y.yardType, referenceText: y.referenceText, updatedAt: y.updatedAt }));
  return <CodeNameTable kind="yards" canEdit={canEdit} query={{ ...query, data: rows }} remove={masterDataApi.deleteYard} />;
}

interface CodeNameTableProps {
  kind: ListKind;
  canEdit: boolean;
  query: { data: CodeNameRow[] | undefined; isPending: boolean; error: unknown; refetch: () => unknown };
  remove: (id: number) => Promise<number>;
}

function CodeNameTable({ kind, canEdit, query, remove }: CodeNameTableProps) {
  const text = KIND_TEXT[kind];
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<CodeNameRow | 'new' | null>(null);
  return (
    <Card>
      <CardHead
        title={text.what}
        meta={query.data ? `${query.data.length}곳` : undefined}
        actions={
          <>
            <Input leadingIcon="search" placeholder="코드·이름" aria-label="코드·이름 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="w-48" />
            <Button size="sm" variant="primary" icon="plus" disabled={!canEdit} title={canEdit ? undefined : MASTER_LOCK_TEXT} onClick={() => setEditing('new')}>
              {text.what} 추가
            </Button>
          </>
        }
      />
      <QueryBoundary query={query} loadingLabel={`${text.what}를 불러오는 중…`}>
        {(rows) => {
          const needle = keyword.trim().toLowerCase();
          const shown = rows.filter((r) => !needle || r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle));
          return (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>{text.codeLabel}</Th>
                    <Th>{text.nameLabel}</Th>
                    {kind === 'yards' ? <Th>야드 유형</Th> : null}
                    <Th aria-label="수정·삭제" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.id}>
                      <Td className="font-mono text-mono">{row.code}</Td>
                      <Td>{row.name}</Td>
                      {kind === 'yards' ? <Td>{row.yardType ? YARD_TYPE_LABEL[row.yardType] : '-'}</Td> : null}
                      <Td align="right">
                        <RowActions
                          canEdit={canEdit}
                          onEdit={() => setEditing(row)}
                          remove={{ what: `${text.what} ${row.name}`, run: () => remove(row.id), success: `${text.what}를 삭제했어요`, blockedReason: row.referenceText }}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {shown.length === 0 ? <EmptyNote>{needle ? '검색 결과가 없어요' : `등록된 ${text.what}가 없어요`}</EmptyNote> : null}
              <TableFoot>{text.foot}</TableFoot>
            </>
          );
        }}
      </QueryBoundary>
      {editing ? <CodeNameModal kind={kind} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function CodeNameModal({ kind, row, onClose }: { kind: ListKind; row: CodeNameRow | null; onClose: () => void }) {
  const text = KIND_TEXT[kind];
  const fieldErrors = useMasterDataFieldErrors();
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [yardType, setYardType] = useState<YardType | ''>(row?.yardType ?? '');
  const options = { onSuccess: onClose, onError: fieldErrors.takeFrom };
  const created = `${text.what}를 추가했어요`;
  const saved = `${text.what}를 저장했어요`;
  const createCustomer = useAction(masterDataApi.createCustomer, { ...options, success: created });
  const updateCustomer = useAction(masterDataApi.updateCustomer, { ...options, success: saved });
  const createSupplier = useAction(masterDataApi.createSupplier, { ...options, success: created });
  const updateSupplier = useAction(masterDataApi.updateSupplier, { ...options, success: saved });
  const createYard = useAction(masterDataApi.createYard, { ...options, success: created });
  const updateYard = useAction(masterDataApi.updateYard, { ...options, success: saved });
  const pending = [createCustomer, updateCustomer, createSupplier, updateSupplier, createYard, updateYard].some((a) => a.isPending);

  const submit = () => {
    if (row) {
      const expectedUpdatedAt = row.updatedAt;
      if (kind === 'customers') updateCustomer.mutate({ id: row.id, customerName: name, expectedUpdatedAt });
      else if (kind === 'suppliers') updateSupplier.mutate({ id: row.id, supplierName: name, expectedUpdatedAt });
      else updateYard.mutate({ id: row.id, yardName: name, expectedUpdatedAt });
      return;
    }
    if (kind === 'customers') createCustomer.mutate({ customerCode: code, customerName: name });
    else if (kind === 'suppliers') createSupplier.mutate({ supplierCode: code, supplierName: name });
    else createYard.mutate({ yardCode: code, yardName: name, yardType: yardType || null });
  };

  return (
    <Modal
      title={row ? `${text.what} 수정 · ${row.code}` : `${text.what} 추가`}
      onClose={onClose}
      width={440}
      footer={<ModalFooter pending={pending} submitLabel={row ? '저장' : '추가'} onCancel={onClose} onSubmit={submit} />}
    >
      <Field label={text.codeLabel} required hint={row ? '코드는 바꿀 수 없어요' : `영문 대문자·숫자·밑줄·하이픈 (예: ${text.codeExample})`} error={fieldErrors.errorOf(text.codeField)}>
        <Input
          value={code}
          readOnly={row !== null}
          maxLength={30}
          placeholder={text.codeExample}
          className="font-mono"
          invalid={fieldErrors.errorOf(text.codeField) !== null}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            fieldErrors.clear(text.codeField);
          }}
        />
      </Field>
      <Field label={text.nameLabel} required error={fieldErrors.errorOf(text.nameField)}>
        <Input
          value={name}
          maxLength={text.nameMax}
          invalid={fieldErrors.errorOf(text.nameField) !== null}
          onChange={(e) => {
            setName(e.target.value);
            fieldErrors.clear(text.nameField);
          }}
        />
      </Field>
      {kind === 'yards' ? (
        <Field label="야드 유형" required hint={row ? '야드 유형은 만든 뒤 바꿀 수 없어요' : undefined} error={fieldErrors.errorOf('yardType')}>
          <Select
            value={yardType}
            disabled={row !== null}
            invalid={fieldErrors.errorOf('yardType') !== null}
            onChange={(e) => {
              const next = Object.values(YARD_TYPE).find((t) => t === e.target.value);
              setYardType(next ?? '');
              fieldErrors.clear('yardType');
            }}
          >
            <option value="">야드 유형을 선택해 주세요</option>
            {Object.values(YARD_TYPE).map((t) => (
              <option key={t} value={t}>
                {YARD_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </Modal>
  );
}
