'use client';

// 배합 원단위 (REQ-MST-006): 용선 1t당 철광석·석탄·석회석(공통, t/t), 용강 1t당 강종별 합금철(kg/t).
// 단위는 원료 유형으로 정한다(합금철 kg/t, 그 밖 t/t — PLAN 4장). 바뀐 칸을 한 번에 저장한다(하나라도 틀리면 아무것도 저장하지 않음).
import { useState } from 'react';
import { RAW_MATERIAL_TYPE_LABEL } from '@/codes';
import { masterDataApi, type MasterRawMaterialView, type MasterSpecificConsumptionView, type MasterSteelGradeView, type SpecificConsumptionChange } from '@/api/masterData';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { Input } from '@/components/Input';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { MASTER_LOCK_TEXT, TableFoot } from '@/features/masterData/components/MasterParts';
import { HOT_METAL_RAW_MATERIAL_TYPES } from '@/features/masterData/lib/readiness';
import { useAction } from '@/hooks/useAction';
import { useMasterDataFieldErrors } from '@/hooks/useMasterDataForm';
import { useMasterRawMaterials, useMasterSpecificConsumptions, useMasterSteelGrades } from '@/hooks/useMasterData';
import { compareDecimal } from '@/lib/weight';

interface Loaded {
  materials: MasterRawMaterialView[];
  grades: MasterSteelGradeView[];
  consumptions: MasterSpecificConsumptionView[];
}

const cellKey = (itemId: number, steelGradeId: number | null) => `${itemId}:${steelGradeId ?? 'common'}`;

export function ConsumptionTab({ canEdit }: { canEdit: boolean }) {
  const materials = useMasterRawMaterials();
  const grades = useMasterSteelGrades();
  const consumptions = useMasterSpecificConsumptions();
  const combined = {
    data: materials.data && grades.data && consumptions.data ? { materials: materials.data, grades: grades.data, consumptions: consumptions.data } : undefined,
    isPending: materials.isPending || grades.isPending || consumptions.isPending,
    error: materials.error ?? grades.error ?? consumptions.error,
    refetch: () => Promise.all([materials.refetch(), grades.refetch(), consumptions.refetch()]),
  };
  return (
    <QueryBoundary query={combined} loadingLabel="배합 원단위를 불러오는 중…">
      {(data) => (
        <ConsumptionEditor
          // 저장하면 값이 바뀌어 입력 상태를 새로 만든다
          key={data.consumptions.map((c) => `${c.id}=${c.consumptionRate}`).join(',')}
          data={data}
          canEdit={canEdit}
        />
      )}
    </QueryBoundary>
  );
}

function ConsumptionEditor({ data, canEdit }: { data: Loaded; canEdit: boolean }) {
  const initial = new Map(data.consumptions.map((c) => [cellKey(c.itemId, c.steelGradeId), c.consumptionRate]));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(initial));
  const fieldErrors = useMasterDataFieldErrors();
  const save = useAction(masterDataApi.saveSpecificConsumptions, { success: (count) => `원단위 ${count}건을 저장했어요`, onError: fieldErrors.takeFrom });

  const common = data.materials.filter((m) => (HOT_METAL_RAW_MATERIAL_TYPES as readonly string[]).includes(m.rawMaterialType));
  const ferroalloys = data.materials.filter((m) => m.rawMaterialType === 'FERROALLOY');

  const isChanged = (key: string) => {
    const before = initial.get(key) ?? '';
    const now = (values[key] ?? '').trim();
    if (!before || !now) return before !== now;
    try {
      return compareDecimal(before, now) !== 0;
    } catch {
      return true;
    }
  };
  const changes: SpecificConsumptionChange[] = [];
  for (const m of common) if (isChanged(cellKey(m.id, null))) changes.push({ itemId: m.id, steelGradeId: null, consumptionRate: (values[cellKey(m.id, null)] ?? '').trim() || null });
  for (const m of ferroalloys) {
    for (const g of data.grades) {
      const key = cellKey(m.id, g.id);
      if (isChanged(key)) changes.push({ itemId: m.id, steelGradeId: g.id, consumptionRate: (values[key] ?? '').trim() || null });
    }
  }

  const cell = (key: string, unit: string, label: string) => {
    const error = fieldErrors.errorOf(key);
    return (
      <span className="flex flex-col items-end gap-0.5">
        <Input
          numeric
          inputMode="decimal"
          suffix={unit}
          className="w-28"
          placeholder="미설정"
          aria-label={label}
          value={values[key] ?? ''}
          readOnly={!canEdit}
          invalid={error !== null}
          onChange={(e) => {
            const value = e.target.value;
            setValues((current) => ({ ...current, [key]: value }));
            fieldErrors.clear(key);
          }}
        />
        {error ? <span className="text-cap text-danger">{error}</span> : null}
      </span>
    );
  };

  return (
    <>
      <Card>
        <CardHead title="공통 원단위" meta="t/t (용선 1t당) · 철광석·석탄·석회석은 강종과 상관없는 공통값이에요" />
        <Table>
          <thead>
            <tr>
              <Th>원료 코드</Th>
              <Th>원료</Th>
              <Th>원료 유형</Th>
              <Th align="right">원단위</Th>
            </tr>
          </thead>
          <tbody>
            {common.map((m) => (
              <tr key={m.id}>
                <Td className="font-mono text-mono">{m.itemCode}</Td>
                <Td>{m.itemName}</Td>
                <Td>{RAW_MATERIAL_TYPE_LABEL[m.rawMaterialType]}</Td>
                <Td align="right" className="py-1">
                  {cell(cellKey(m.id, null), 't/t', `${m.itemName} 원단위`)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {common.length === 0 ? <EmptyNote>철광석·석탄·석회석 원료가 없어요. 품목 탭에서 원료를 추가해 주세요</EmptyNote> : null}
      </Card>
      <Card>
        <CardHead title="합금철 원단위 (강종별)" meta="kg/t (용강 1t당)" />
        <div className="overflow-auto">
          <Table>
            <thead>
              <tr>
                <Th>원료 코드</Th>
                <Th>합금철</Th>
                {data.grades.map((g) => (
                  <Th key={g.id} align="right">
                    {g.steelGradeCode}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ferroalloys.map((m) => (
                <tr key={m.id}>
                  <Td className="font-mono text-mono">{m.itemCode}</Td>
                  <Td>{m.itemName}</Td>
                  {data.grades.map((g) => (
                    <Td key={g.id} align="right" className="py-1">
                      {cell(cellKey(m.id, g.id), 'kg/t', `${m.itemName} ${g.steelGradeCode} 원단위`)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          {ferroalloys.length === 0 ? <EmptyNote>합금철 원료가 없어요. 품목 탭에서 원료를 추가해 주세요</EmptyNote> : null}
        </div>
      </Card>
      <Card>
        <TableFoot className="flex items-center gap-3 rounded-md border-t-0">
          <span className="min-w-0 flex-1">
            {changes.length > 0
              ? `변경 ${changes.length}건 · 칸을 비우고 저장하면 그 원단위를 지워요 (지우면 준비 상태에 누락으로 나와요)`
              : '값을 고치고 저장해요 · 0보다 커야 해요 · 비어 있으면 미설정이에요 · 제품 규격이 없는 강종은 비워 둬도 돼요'}
          </span>
          <Button
            size="sm"
            disabled={changes.length === 0 || save.isPending}
            onClick={() => {
              setValues(Object.fromEntries(initial));
              fieldErrors.clear();
            }}
          >
            되돌리기
          </Button>
          <Button size="sm" variant="primary" disabled={!canEdit || changes.length === 0 || save.isPending} title={canEdit ? undefined : MASTER_LOCK_TEXT} onClick={() => save.mutate(changes)}>
            {save.isPending ? '저장 중…' : '저장'}
          </Button>
        </TableFoot>
      </Card>
    </>
  );
}
