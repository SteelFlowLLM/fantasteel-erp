'use client';

// 제품 규격 (REQ-MST-003): 강종 × 두께 × 폭 × 길이, 1매 이론중량(소수 3자리), 규격 코드 SL-/CL-강종-두께x폭x길이.
// 같은 조합은 화면에서 먼저 막고, 쓰인 규격은 치수·이론중량을 잠근다(MST-002). 쓰이지 않은 규격만 지운다.
import { useMemo, useState } from 'react';
import { ERROR_MESSAGE, ITEM_TYPE_LABEL, PRODUCT_QTY_UNIT, formatSpecCode, type ProductItemType } from '@/codes';
import { masterDataApi, type MasterProductSpecView } from '@/api/masterData';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Segmented } from '@/components/Tabs';
import { CODE_LINK, MASTER_LOCK_TEXT, ModalFooter, RowActions, TableFoot, yieldPercentText, type MasterTabKey } from '@/features/masterData/components/MasterParts';
import { useAction } from '@/hooks/useAction';
import { useMasterDataFieldErrors } from '@/hooks/useMasterDataForm';
import { useMasterProductSpecs, useMasterSteelGrades, useMasterYards } from '@/hooks/useMasterData';
import { fmtDims, fmtTon } from '@/lib/format';
import { calcTheoreticalWeightTon, compareDecimal } from '@/lib/weight';

type TypeFilter = 'ALL' | ProductItemType;
const TYPE_FILTERS: readonly { key: TypeFilter; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'SLAB', label: ITEM_TYPE_LABEL.SLAB },
  { key: 'COIL', label: ITEM_TYPE_LABEL.COIL },
];

export function ProductSpecTab({ canEdit, onGoTab }: { canEdit: boolean; onGoTab: (tab: MasterTabKey) => void }) {
  const specs = useMasterProductSpecs();
  const grades = useMasterSteelGrades();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [gradeFilter, setGradeFilter] = useState('');
  const [editing, setEditing] = useState<MasterProductSpecView | 'new' | null>(null);

  return (
    <Card>
      <CardHead
        title="제품 규격"
        meta={specs.data ? `${specs.data.length}개` : undefined}
        actions={
          <>
            <Segmented ariaLabel="품목 유형" items={TYPE_FILTERS} active={typeFilter} onChange={setTypeFilter} />
            <Select aria-label="강종" value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="w-32">
              <option value="">강종 전체</option>
              {(grades.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.steelGradeCode}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="primary" icon="plus" disabled={!canEdit} title={canEdit ? undefined : MASTER_LOCK_TEXT} onClick={() => setEditing('new')}>
              규격 추가
            </Button>
          </>
        }
      />
      <QueryBoundary query={specs} loadingLabel="제품 규격을 불러오는 중…">
        {(rows) => {
          const shown = rows.filter((r) => (typeFilter === 'ALL' || r.itemType === typeFilter) && (!gradeFilter || r.steelGradeId === Number(gradeFilter)));
          return (
            <>
              <div className="overflow-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>규격 코드</Th>
                      <Th>품목 유형</Th>
                      <Th>강종</Th>
                      <Th align="right">두께 × 폭 × 길이 (mm)</Th>
                      <Th align="right">1매 이론중량</Th>
                      <Th>기본 야드</Th>
                      <Th>대응 규격</Th>
                      <Th align="right">열연 계획 수율</Th>
                      <Th>사용 여부</Th>
                      <Th aria-label="수정·삭제" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((spec) => (
                      <tr key={spec.id}>
                        <Td className="font-mono text-mono">{spec.itemCode}</Td>
                        <Td>{ITEM_TYPE_LABEL[spec.itemType]}</Td>
                        <Td>{spec.steelGradeCode}</Td>
                        <Td align="right">{fmtDims(spec.thicknessMm, spec.widthMm, spec.lengthMm)}</Td>
                        <Td align="right">{fmtTon(spec.theoreticalWeightTon)}</Td>
                        <Td>{spec.defaultYardName}</Td>
                        <Td>
                          {spec.mappedSpec ? (
                            <button type="button" className={CODE_LINK} onClick={() => onGoTab('mapping')} title="규격 매핑 탭으로 이동">
                              {spec.mappedSpec.itemCode}
                            </button>
                          ) : (
                            <span className="text-cap font-semibold text-danger">매핑 없음</span>
                          )}
                        </Td>
                        <Td align="right">{yieldPercentText(spec.hotRollingPlannedYieldRate)}</Td>
                        <Td>
                          {spec.isUsed ? (
                            <Badge tone="run" title={`${spec.usageText ?? ''}에 쓰였어요`}>
                              사용됨
                            </Badge>
                          ) : (
                            <Badge tone="neutral">미사용</Badge>
                          )}
                        </Td>
                        <Td align="right">
                          <RowActions
                            canEdit={canEdit}
                            onEdit={() => setEditing(spec)}
                            remove={{ what: `규격 ${spec.itemCode}`, run: () => masterDataApi.deleteProductSpec(spec.id), success: '규격을 삭제했어요', blockedReason: spec.referenceText }}
                          />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {shown.length === 0 ? <EmptyNote>조건에 맞는 제품 규격이 없어요</EmptyNote> : null}
              </div>
              <TableFoot>
                1매 이론중량 = 두께 × 폭 × 길이 × 7.85 ÷ 10^9 (t, 소수 3자리) · 규격 코드와 1매 이론중량은 저장할 때 계산해요 · 수주·재고·LOT에 쓰인 규격은
                치수·이론중량을 바꿀 수 없어요(다른 치수는 새 규격으로 추가) · 쓰이지 않고 매핑도 없는 규격만 지울 수 있어요
              </TableFoot>
              {editing ? <ProductSpecModal spec={editing === 'new' ? null : editing} specs={rows} onClose={() => setEditing(null)} /> : null}
            </>
          );
        }}
      </QueryBoundary>
    </Card>
  );
}

const DECIMAL = /^\d+(\.\d+)?$/;

function previewWeight(t: string, w: string, l: string): string | null {
  if (![t, w, l].every((v) => DECIMAL.test(v.trim()) && Number(v) > 0)) return null;
  try {
    return calcTheoreticalWeightTon(t.trim(), w.trim(), l.trim());
  } catch {
    return null;
  }
}

function ProductSpecModal({ spec, specs, onClose }: { spec: MasterProductSpecView | null; specs: readonly MasterProductSpecView[]; onClose: () => void }) {
  const grades = useMasterSteelGrades();
  const yards = useMasterYards();
  const fieldErrors = useMasterDataFieldErrors();
  const [itemType, setItemType] = useState<ProductItemType>(spec?.itemType ?? 'SLAB');
  const [steelGradeId, setSteelGradeId] = useState(spec ? String(spec.steelGradeId) : '');
  const [thicknessMm, setThicknessMm] = useState(spec?.thicknessMm.replace(/\.00$/, '') ?? '');
  const [widthMm, setWidthMm] = useState(spec?.widthMm.replace(/\.00$/, '') ?? '');
  const [lengthMm, setLengthMm] = useState(spec?.lengthMm.replace(/\.00$/, '') ?? '');
  const [yardId, setYardId] = useState(spec ? String(spec.defaultYardId) : '');
  const locked = spec?.isUsed ?? false;

  const typeYards = (yards.data ?? []).filter((y) => y.yardType === itemType);
  const grade = (grades.data ?? []).find((g) => g.id === Number(steelGradeId));
  const weight = previewWeight(thicknessMm, widthMm, lengthMm);
  const code = grade && weight ? formatSpecCode(itemType, grade.steelGradeCode, thicknessMm.trim(), widthMm.trim(), lengthMm.trim()) : null;
  const duplicate = useMemo(
    () =>
      weight && grade
        ? specs.find(
            (s) =>
              s.id !== spec?.id &&
              s.itemType === itemType &&
              s.steelGradeId === grade.id &&
              compareDecimal(s.thicknessMm, thicknessMm.trim()) === 0 &&
              compareDecimal(s.widthMm, widthMm.trim()) === 0 &&
              compareDecimal(s.lengthMm, lengthMm.trim()) === 0,
          )
        : undefined,
    [grade, itemType, lengthMm, spec?.id, specs, thicknessMm, weight, widthMm],
  );

  const options = { onSuccess: onClose, onError: fieldErrors.takeFrom };
  const create = useAction(masterDataApi.createProductSpec, { ...options, success: '규격을 추가했어요' });
  const update = useAction(masterDataApi.updateProductSpec, { ...options, success: '규격을 저장했어요' });
  const pending = create.isPending || update.isPending;

  const submit = () => {
    const values = {
      steelGradeId: steelGradeId ? Number(steelGradeId) : null,
      thicknessMm,
      widthMm,
      lengthMm,
      defaultYardId: yardId ? Number(yardId) : null,
    };
    if (spec) update.mutate({ ...values, id: spec.id, expectedUpdatedAt: spec.updatedAt });
    else create.mutate({ ...values, itemType });
  };

  const dimension = (field: 'thicknessMm' | 'widthMm' | 'lengthMm', label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <Field label={`${label} (mm)`} required error={fieldErrors.errorOf(field) ?? (field === 'thicknessMm' && duplicate ? `같은 강종·두께·폭·길이의 규격이 이미 있어요 (${duplicate.itemCode})` : null)}>
      <Input
        numeric
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        readOnly={locked}
        invalid={fieldErrors.errorOf(field) !== null || (field === 'thicknessMm' && duplicate !== undefined)}
        onChange={(e) => {
          set(e.target.value);
          fieldErrors.clear(field);
        }}
      />
    </Field>
  );

  return (
    <Modal
      title={spec ? `규격 수정 · ${spec.itemCode}` : '규격 추가'}
      onClose={onClose}
      width={560}
      footer={<ModalFooter pending={pending} disabled={duplicate !== undefined} submitLabel={spec ? '저장' : '추가'} onCancel={onClose} onSubmit={submit} />}
    >
      {locked ? (
        <Banner tone="wait">
          {ERROR_MESSAGE['MST-002']} <span className="font-mono text-cap">MST-002</span> · {spec?.usageText}에 쓰였어요. 다른 치수는 새 규격으로 추가해 주세요. 기본
          야드만 바꿀 수 있어요.
        </Banner>
      ) : null}
      <Field label="품목 유형" required hint={spec ? '품목 유형은 바꿀 수 없어요' : `단위 유형은 매수(${PRODUCT_QTY_UNIT[itemType]})예요`}>
        <Segmented
          ariaLabel="품목 유형"
          items={[
            { key: 'SLAB', label: ITEM_TYPE_LABEL.SLAB },
            { key: 'COIL', label: ITEM_TYPE_LABEL.COIL },
          ]}
          active={itemType}
          onChange={(next) => {
            if (spec) return;
            setItemType(next);
            setYardId('');
          }}
        />
      </Field>
      <Field label="강종" required error={fieldErrors.errorOf('steelGradeId')}>
        <Select
          value={steelGradeId}
          disabled={locked}
          invalid={fieldErrors.errorOf('steelGradeId') !== null}
          onChange={(e) => {
            setSteelGradeId(e.target.value);
            fieldErrors.clear('steelGradeId');
          }}
        >
          <option value="">강종을 선택해 주세요</option>
          {(grades.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.steelGradeCode}
              {g.standardNo ? ` · ${g.standardNo}` : ''}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        {dimension('thicknessMm', '두께', thicknessMm, setThicknessMm, itemType === 'SLAB' ? '250' : '2.3')}
        {dimension('widthMm', '폭', widthMm, setWidthMm, '1200')}
        {dimension('lengthMm', '길이', lengthMm, setLengthMm, itemType === 'SLAB' ? '10000' : '1065000')}
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-2 px-3.5 py-2.5 text-sm">
        <span className="flex flex-col gap-0.5">
          <span className="text-cap text-ink-3">1매 이론중량 (계산값)</span>
          <b className="font-semibold tabular-nums">{locked && spec ? fmtTon(spec.theoreticalWeightTon) : weight ? fmtTon(weight) : '-'}</b>
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-cap text-ink-3">규격 코드</span>
          <b className="truncate font-mono text-mono font-semibold">{locked && spec ? spec.itemCode : (code ?? '-')}</b>
        </span>
      </div>
      <Field label="기본 야드" required hint="입고·실적으로 LOT이 생기면 이 야드로 자동 지정돼요" error={fieldErrors.errorOf('defaultYardId')}>
        <Select
          value={yardId}
          invalid={fieldErrors.errorOf('defaultYardId') !== null}
          onChange={(e) => {
            setYardId(e.target.value);
            fieldErrors.clear('defaultYardId');
          }}
        >
          <option value="">기본 야드를 선택해 주세요</option>
          {typeYards.map((y) => (
            <option key={y.id} value={y.id}>
              {y.yardName} ({y.yardCode})
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
