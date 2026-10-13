'use client';

// 검사 기준 입력 창: 새 기준(공정 × 강종, 버전 1) 또는 지금 버전을 바탕으로 새 버전 만들기 (REQ-QC-002, TRM-110).
// 항목: 코드·이름·단위·최소(이상)·최대(이하)·적용 두께 구간(초과~이하)·필수·순서(행 순서).
import { useRef, useState } from 'react';
import { isServerDataSource } from '@/api/http';
import { PROCESS_TYPE_LABEL } from '@/codes';
import { COMMON_STANDARD_GRADE, inspectionStandardApi, type InspectionStandardDetailView, type InspectionStandardItemInput } from '@/api/inspectionStandards';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { IconButton } from '@/components/IconButton';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { Table, Td, Th } from '@/components/Table';
import { Tag } from '@/components/Tag';
import { ModalFooter } from '@/features/masterData/components/MasterParts';
import { canChooseCommonStandard, canHaveCommonStandard, formatInspectionStandardCode, INSPECTED_PROCESS_TYPES, type InspectedProcessType } from '@/features/inspectionStandards/lib/standardItems';
import { PROCESS_INSPECTION_TEXT } from '@/features/inspectionStandards/lib/standardText';
import { useAction } from '@/hooks/useAction';
import { useMasterDataFieldErrors } from '@/hooks/useMasterDataForm';
import { useMasterSteelGrades } from '@/hooks/useMasterData';
import { cn } from '@/lib/cn';

export type StandardEditorTarget =
  | { mode: 'create'; processType: InspectedProcessType | null; steelGradeId: number | null }
  | { mode: 'version'; detail: InspectionStandardDetailView };

interface DraftItem extends InspectionStandardItemInput {
  key: number;
}

const trimZeros = (value: string | null) => (value === null ? '' : value.includes('.') ? value.replace(/\.?0+$/, '') : value);

/** 지금 버전 항목 → 입력칸 값 (처음 채울 때와 바뀐 칸을 견줄 때 같은 모양) */
const toInputValues = (item: InspectionStandardDetailView['items'][number]): InspectionStandardItemInput => ({
  inspectionItemCode: item.inspectionItemCode,
  inspectionItemName: item.inspectionItemName,
  unit: item.unit ?? '',
  minValue: trimZeros(item.minValue),
  maxValue: trimZeros(item.maxValue),
  minThicknessMm: trimZeros(item.minThicknessMm),
  maxThicknessMm: trimZeros(item.maxThicknessMm),
  isRequired: item.isRequired,
});

/** 지금 버전에서 바뀐 칸: 입력칸 기본 배경과 겹치지 않게 아래쪽 밑줄로 표시한다 */
const CHANGED_MARK = 'shadow-[inset_0_-2px_0_var(--color-wait)]';

const buildEmptyItem = (key: number): DraftItem => ({
  key,
  inspectionItemCode: '',
  inspectionItemName: '',
  unit: '',
  minValue: '',
  maxValue: '',
  minThicknessMm: '',
  maxThicknessMm: '',
  isRequired: true,
});

type TextField = Exclude<keyof InspectionStandardItemInput, 'isRequired'>;
/** 예시 안내 글은 고정폭 글꼴이면 자간이 벌어지고, 진하면 이미 넣은 값처럼 보인다: 일반 글꼴에 더 흐린 색으로 */
const EXAMPLE_PLACEHOLDER = 'placeholder:font-sans placeholder:text-ink-disabled';

const COLUMNS: readonly { field: TextField; label: string; width: string; numeric?: boolean; mono?: boolean; placeholder?: string }[] = [
  // 코드·이름은 TENSILE_STRENGTH·'샤르피 흡수 에너지(20°C)'가 잘리지 않을 만큼 넓히고, 숫자 칸은 줄여 표가 창 안에 들어가게 한다 (오른쪽 버튼이 잘렸다)
  { field: 'inspectionItemCode', label: '항목 코드', width: 'w-44', mono: true, placeholder: '예: TENSILE_STRENGTH' },
  { field: 'inspectionItemName', label: '항목명', width: 'w-44', placeholder: '예: 인장강도' },
  { field: 'unit', label: '단위', width: 'w-20', placeholder: '예: %' },
  { field: 'minValue', label: '최소 (이상)', width: 'w-20', numeric: true },
  { field: 'maxValue', label: '최대 (이하)', width: 'w-20', numeric: true },
  { field: 'minThicknessMm', label: '두께 초과', width: 'w-16', numeric: true },
  { field: 'maxThicknessMm', label: '두께 이하', width: 'w-16', numeric: true },
];

export function StandardEditorModal({ target, onClose, onSaved }: { target: StandardEditorTarget; onClose: () => void; onSaved: (id: number) => void }) {
  const grades = useMasterSteelGrades();
  const fieldErrors = useMasterDataFieldErrors();
  const nextKey = useRef(0);
  const newKey = () => {
    nextKey.current += 1;
    return nextKey.current;
  };
  const [items, setItems] = useState<DraftItem[]>(() =>
    target.mode === 'version'
      ? target.detail.items.map((item, index) => ({ key: -(index + 1), ...toInputValues(item) }))
      : [buildEmptyItem(0)],
  );
  const [processType, setProcessType] = useState<InspectedProcessType | ''>(target.mode === 'create' ? (target.processType ?? '') : '');
  // '' = 아직 고르지 않음 · 'common' = 공통 기준 · 그 밖 = 강종 id. 고르지 않은 채 저장하면 강종 칸에 안내가 뜬다(공통 기준으로 바꾸지 않음).
  const [gradeValue, setGradeValue] = useState(target.mode === 'create' && target.steelGradeId ? String(target.steelGradeId) : '');
  // 서버 모드는 공통 기준을 저장할 수 없어(ERD steel_grade_id NOT NULL) 선택지를 보이지 않는다
  const commonAllowed = canChooseCommonStandard(processType, isServerDataSource());

  const options = { onSuccess: (id: number) => onSaved(id), onError: fieldErrors.takeFrom };
  const createVersion = useAction(inspectionStandardApi.createVersion, { ...options, success: '새 버전을 만들었어요' });
  const create = useAction(inspectionStandardApi.create, { ...options, success: '검사 기준을 만들었어요' });
  const pending = createVersion.isPending || create.isPending;

  const update = (index: number, patch: Partial<InspectionStandardItemInput>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    for (const field of Object.keys(patch)) fieldErrors.clear(`items.${index}.${field}`);
  };
  const reorder = (next: DraftItem[]) => {
    setItems(next);
    fieldErrors.clear(); // 행 번호가 바뀌면 안내가 다른 행을 가리키므로 지운다
  };
  const move = (index: number, delta: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    reorder(next);
  };

  const submit = () => {
    const payload = items.map(({ key: _key, ...item }) => item);
    if (target.mode === 'version') createVersion.mutate({ baseStandardId: target.detail.id, items: payload });
    else create.mutate({ processType: processType || null, steelGradeId: gradeValue === '' ? null : gradeValue === 'common' ? COMMON_STANDARD_GRADE : Number(gradeValue), items: payload });
  };

  const grade = (grades.data ?? []).find((g) => g.id === Number(gradeValue));
  const previewCode =
    target.mode === 'version' ? target.detail.inspectionStandardCode : processType && gradeValue ? formatInspectionStandardCode(gradeValue === 'common' ? null : (grade?.steelGradeCode ?? null), processType) : null;
  const title =
    target.mode === 'version'
      ? `새 버전 만들기 · ${target.detail.inspectionStandardCode} v${target.detail.version} → v${Math.max(...target.detail.versions.map((v) => v.version)) + 1}`
      : '검사 기준 추가';
  const errorCount = Object.keys(fieldErrors.errors).length;
  // 새 버전 창: 처음부터 있던 행은 key가 음수(-(원래 순서 + 1))라 원래 항목을 찾을 수 있다. 추가한 행은 원본이 없다
  const originalOf = (item: DraftItem): InspectionStandardItemInput | null => {
    if (target.mode !== 'version' || item.key >= 0) return null;
    const base = target.detail.items[-item.key - 1];
    return base ? toInputValues(base) : null;
  };
  const isChanged = (item: DraftItem, field: keyof InspectionStandardItemInput) => {
    const original = originalOf(item);
    return original !== null && original[field] !== item[field];
  };
  const isNewRow = (item: DraftItem) => target.mode === 'version' && item.key >= 0;
  const changedCount =
    target.mode === 'version' ? items.reduce((sum, item) => sum + (isNewRow(item) ? 1 : [...COLUMNS.map((c) => c.field), 'isRequired' as const].filter((f) => isChanged(item, f)).length), 0) : 0;

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={1120}
      footer={<ModalFooter pending={pending} disabled={items.length === 0} submitLabel={target.mode === 'version' ? '새 버전 저장' : '기준 만들기'} onCancel={onClose} onSubmit={submit} />}
    >
      {target.mode === 'version' ? (
        <Banner tone="run">
          지금 버전(v{target.detail.version})은 고치지 않고 그대로 남아요. 저장하면 새 버전이 지금 버전이 되고, 앞으로의 검사는 새 버전으로 판정해요. 이미 판정한 검사 기록은
          예전 버전을 그대로 참조해요.
        </Banner>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Field label="공정" required error={fieldErrors.errorOf('processType')} hint={processType ? `${PROCESS_INSPECTION_TEXT[processType]} 검사` : undefined}>
            <Select
              value={processType}
              invalid={fieldErrors.errorOf('processType') !== null}
              onChange={(e) => {
                const next = INSPECTED_PROCESS_TYPES.find((p) => p === e.target.value) ?? '';
                setProcessType(next);
                fieldErrors.clear('processType');
                // 제강은 공통 기준이 없다: 공통을 골라 두었으면 다시 고르게 한다
                if (next !== '' && !canHaveCommonStandard(next) && gradeValue === 'common') {
                  setGradeValue('');
                  fieldErrors.clear('steelGradeId');
                }
              }}
            >
              <option value="">공정을 선택해 주세요</option>
              {INSPECTED_PROCESS_TYPES.map((p) => (
                <option key={p} value={p}>
                  {PROCESS_TYPE_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="강종"
            required
            error={fieldErrors.errorOf('steelGradeId')}
            hint={
              commonAllowed ? '강종 전용 기준이 없으면 공통 기준으로 판정해요' : processType === 'STEELMAKING' ? '제강 검사 기준(성분 규격)은 강종별로 만들어요' : '검사 기준은 강종별로 만들어요'
            }
          >
            <Select
              value={gradeValue}
              invalid={fieldErrors.errorOf('steelGradeId') !== null}
              onChange={(e) => {
                setGradeValue(e.target.value);
                fieldErrors.clear('steelGradeId');
              }}
            >
              <option value="">강종을 선택해 주세요</option>
              {commonAllowed ? <option value="common">공통 (모든 강종)</option> : null}
              {(grades.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.steelGradeCode}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="검사 기준 코드" hint="QS-강종-공정으로 만들어요 · 버전 1">
            <Input value={previewCode ?? ''} readOnly placeholder="공정·강종을 고르면 정해져요" className="font-mono placeholder:font-sans" />
          </Field>
        </div>
      )}

      <div className="overflow-auto rounded-md border border-line">
        <Table className="[&_td]:h-auto [&_td]:px-1.5 [&_td]:py-1.5 [&_td]:align-top [&_th]:px-1.5">
          <thead>
            <tr>
              <Th className="w-10">순서</Th>
              {COLUMNS.map((c) => (
                <Th key={c.field} align={c.numeric ? 'right' : 'left'}>
                  {c.label}
                </Th>
              ))}
              <Th align="center">필수</Th>
              <Th aria-label="순서 바꾸기·빼기" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.key}>
                <Td className="px-2">
                  {/* 입력칸(높이 32px)과 같은 줄 높이로 가운데 맞춘다: 오류 안내가 붙어 행이 길어져도 맨 윗줄에 맞는다 */}
                  <span className="flex h-8 items-center gap-1 tabular-nums text-ink-3">
                    {index + 1}
                    {isNewRow(item) ? (
                      <Tag tone="run" size="sm">
                        새
                      </Tag>
                    ) : null}
                  </span>
                </Td>
                {COLUMNS.map((c) => {
                  const error = fieldErrors.errorOf(`items.${index}.${c.field}`);
                  return (
                    <Td key={c.field} className="px-1.5">
                      <span className={`flex flex-col gap-0.5 ${c.width}`}>
                        <Input
                          aria-label={`${index + 1}행 ${c.label}`}
                          value={item[c.field]}
                          numeric={c.numeric}
                          inputMode={c.numeric ? 'decimal' : undefined}
                          placeholder={c.placeholder}
                          title={item[c.field] || undefined}
                          className={cn(c.mono && 'font-mono', EXAMPLE_PLACEHOLDER, isChanged(item, c.field) && CHANGED_MARK)}
                          invalid={error !== null}
                          onChange={(e) => update(index, { [c.field]: e.target.value })}
                        />
                        {error ? <span className="text-cap leading-normal whitespace-normal text-danger">{error}</span> : null}
                      </span>
                    </Td>
                  );
                })}
                <Td className="px-2">
                  {/* 머리에 '필수'가 있어 줄마다 글자를 되풀이하지 않는다 */}
                  <label className={cn('flex h-8 items-center justify-center rounded-sm', isChanged(item, 'isRequired') && CHANGED_MARK)}>
                    <input
                      type="checkbox"
                      aria-label={`${index + 1}행 필수`}
                      checked={item.isRequired}
                      onChange={(e) => update(index, { isRequired: e.target.checked })}
                      className="size-4 accent-[var(--color-brand)]"
                    />
                  </label>
                </Td>
                <Td align="right" className="px-1">
                  <span className="flex h-8 items-center justify-end">
                    <IconButton icon="chevron-up" label="위로" size="sm" disabled={index === 0} onClick={() => move(index, -1)} />
                    <IconButton icon="chevron-down" label="아래로" size="sm" disabled={index === items.length - 1} onClick={() => move(index, 1)} />
                    <IconButton icon="x" label="항목 빼기" size="sm" onClick={() => reorder(items.filter((_, i) => i !== index))} />
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" icon="plus" onClick={() => setItems([...items, buildEmptyItem(newKey())])}>
          항목 추가
        </Button>
        {target.mode === 'version' ? (
          <span className="inline-flex flex-none items-center gap-1.5 text-cap text-ink-2">
            <span className={cn('inline-block h-3 w-5 rounded-xs bg-surface', CHANGED_MARK)} aria-hidden />
            {changedCount > 0 ? `지금 버전에서 바뀐 칸 ${changedCount}개` : '아직 바꾼 칸이 없어요'}
          </span>
        ) : null}
        <span className="text-cap text-ink-3">
          최소·최대 중 하나는 꼭 넣어요(경계 포함) · 두께 구간은 &lsquo;초과 ~ 이하&rsquo;, 비우면 모든 두께 · 같은 항목 코드는 두께 구간이 겹치면 안 돼요 · 순서는 위에서 아래로예요
        </span>
      </div>
      {errorCount > 0 ? <Banner tone="danger">입력한 내용을 확인해 주세요 ({errorCount}곳)</Banner> : null}
    </Modal>
  );
}
