'use client';

// 생산 설정값 (REQ-MST-009): 히트 용량(초기 250t, 용강 기준), 납기 위험 기준일(초기 3일). 단일 행.
import { useState } from 'react';
import { isMasterServerMode, masterDataApi, type MasterProductionSettingView } from '@/api/masterData';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { QueryBoundary } from '@/components/QueryBoundary';
import { MASTER_LOCK_TEXT, TableFoot } from '@/features/masterData/components/MasterParts';
import { useAction } from '@/hooks/useAction';
import { useMasterDataFieldErrors } from '@/hooks/useMasterDataForm';
import { useMasterProductionSetting } from '@/hooks/useMasterData';
import { fmtDateTime } from '@/lib/format';

export function ProductionSettingTab({ canEdit }: { canEdit: boolean }) {
  const setting = useMasterProductionSetting();
  return (
    <QueryBoundary query={setting} loadingLabel="생산 설정값을 불러오는 중…">
      {(row) => <SettingForm key={row?.updatedAt ?? 'none'} setting={row} canEdit={canEdit} />}
    </QueryBoundary>
  );
}

function SettingForm({ setting, canEdit }: { setting: MasterProductionSettingView | null; canEdit: boolean }) {
  const initialHeat = setting?.heatCapacityTon ?? '';
  const initialDays = setting ? String(setting.deliveryRiskDays) : '';
  const [heat, setHeat] = useState(initialHeat);
  const [days, setDays] = useState(initialDays);
  const fieldErrors = useMasterDataFieldErrors();
  const save = useAction(masterDataApi.saveProductionSetting, { success: '생산 설정값을 저장했어요', onError: fieldErrors.takeFrom });
  const dirty = heat.trim() !== initialHeat || days.trim() !== initialDays;

  return (
    <Card className="max-w-[640px]">
      {/* 서버 응답에는 수정 시각이 없다 */}
      <CardHead title="생산 설정값" meta={isMasterServerMode() ? undefined : setting ? `마지막 저장 ${fmtDateTime(setting.updatedAt)}` : '아직 저장한 값이 없어요'} />
      <div className="grid grid-cols-2 gap-4 p-4">
        <Field label="히트 용량" required hint="용강 기준 전로 1히트의 용량이에요 · 히트 수 계산에 써요 (초기 250 t)" error={fieldErrors.errorOf('heatCapacityTon')}>
          <Input
            numeric
            inputMode="decimal"
            suffix="t"
            value={heat}
            readOnly={!canEdit}
            invalid={fieldErrors.errorOf('heatCapacityTon') !== null}
            onChange={(e) => {
              setHeat(e.target.value);
              fieldErrors.clear('heatCapacityTon');
            }}
          />
        </Field>
        <Field label="납기 위험 기준일" required hint="납기까지 남은 일수가 이 값 이하이고 출하 매수가 수주 매수보다 적으면 납기 위험이에요 (초기 3일)" error={fieldErrors.errorOf('deliveryRiskDays')}>
          <Input
            numeric
            inputMode="numeric"
            suffix="일"
            value={days}
            readOnly={!canEdit}
            invalid={fieldErrors.errorOf('deliveryRiskDays') !== null}
            onChange={(e) => {
              setDays(e.target.value);
              fieldErrors.clear('deliveryRiskDays');
            }}
          />
        </Field>
      </div>
      <TableFoot className="flex items-center gap-3 rounded-b-md">
        <span className="min-w-0 flex-1">{dirty ? '저장하지 않은 변경이 있어요' : '값을 고치고 저장해요'}</span>
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setHeat(initialHeat);
            setDays(initialDays);
            fieldErrors.clear();
          }}
        >
          되돌리기
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!canEdit || !dirty || save.isPending}
          title={canEdit ? undefined : MASTER_LOCK_TEXT}
          onClick={() => save.mutate({ heatCapacityTon: heat, deliveryRiskDays: days, expectedUpdatedAt: setting?.updatedAt ?? null })}
        >
          {save.isPending ? '저장 중…' : '저장'}
        </Button>
      </TableFoot>
    </Card>
  );
}
