'use client';

// 라우팅 (REQ-MST-005): 품목 유형(슬래브·코일)별 공정 순서와 계획 수율. 공정 추가·삭제·순서 변경은 데이터 수정만으로 한다.
// - 열연 계획 수율은 넣지 않고 규격 매핑에서 계산한다 (REQ-MST-004).
// - 제선 수율은 4.4 계산(원료 → 용선은 용선 1t당 원단위)에 쓰지 않아 '—'로 보이고 준비 상태에서도 누락으로 보지 않는다 (사용자 확인 필요, master.md).
import { useState } from 'react';
import { ITEM_TYPE_LABEL, PROCESS_TYPE, PROCESS_TYPE_LABEL, type ProcessType } from '@/codes';
import { masterDataApi, type MasterRoutingView } from '@/api/masterData';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { IconButton } from '@/components/IconButton';
import { Input, Select } from '@/components/Input';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { MASTER_LOCK_TEXT, TableFoot, formatYieldPercent, type MasterTabKey } from '@/features/masterData/components/MasterParts';
import { useAction } from '@/hooks/useAction';
import { useMasterDataFieldErrors } from '@/hooks/useMasterDataForm';
import { useMasterRoutings } from '@/hooks/useMasterData';

export function RoutingTab({ canEdit, onGoTab }: { canEdit: boolean; onGoTab: (tab: MasterTabKey) => void }) {
  const routings = useMasterRoutings();
  return (
    <QueryBoundary query={routings} loadingLabel="라우팅을 불러오는 중…">
      {(rows) => (
        <div className="grid grid-cols-2 items-start gap-4">
          {rows.map((routing) => (
            // 저장하면 updatedAt이 바뀌어 입력 상태를 새로 만든다
            <RoutingCard key={`${routing.itemType}-${routing.updatedAt ?? 'none'}`} routing={routing} canEdit={canEdit} onGoTab={onGoTab} />
          ))}
        </div>
      )}
    </QueryBoundary>
  );
}

interface DraftStep {
  processType: ProcessType;
  plannedYieldRate: string;
}

const buildDraft = (routing: MasterRoutingView): DraftStep[] => routing.steps.map((s) => ({ processType: s.processType, plannedYieldRate: s.plannedYieldRate ?? '' }));
const isSameDraft = (a: DraftStep[], b: DraftStep[]) => a.length === b.length && a.every((s, i) => s.processType === b[i].processType && s.plannedYieldRate.trim() === b[i].plannedYieldRate.trim());
const RATE = /^\d+(\.\d+)?$/;

function RoutingCard({ routing, canEdit, onGoTab }: { routing: MasterRoutingView; canEdit: boolean; onGoTab: (tab: MasterTabKey) => void }) {
  const initial = buildDraft(routing);
  const [steps, setSteps] = useState<DraftStep[]>(initial);
  const [adding, setAdding] = useState('');
  const fieldErrors = useMasterDataFieldErrors();
  const title = `${ITEM_TYPE_LABEL[routing.itemType]} 라우팅`;
  const save = useAction(masterDataApi.saveRouting, { success: `${title}을 저장했어요`, onError: fieldErrors.takeFrom });
  const dirty = !isSameDraft(steps, initial);

  const available = Object.values(PROCESS_TYPE).filter((p) => !steps.some((s) => s.processType === p) && !(routing.itemType === 'SLAB' && p === 'HOT_ROLLING'));
  const move = (index: number, delta: number) => {
    const next = [...steps];
    const [step] = next.splice(index, 1);
    next.splice(index + delta, 0, step);
    setSteps(next);
    fieldErrors.clear();
  };

  return (
    <Card>
      <CardHead title={title} meta={`공정 ${steps.length}개`} />
      <Table>
        <thead>
          <tr>
            <Th className="w-14">순서</Th>
            <Th>공정</Th>
            <Th>계획 수율</Th>
            <Th aria-label="순서 바꾸기·빼기" />
          </tr>
        </thead>
        <tbody>
          {steps.map((step, index) => {
            const rateError = fieldErrors.errorOf(`steps.${index}.plannedYieldRate`);
            const processError = fieldErrors.errorOf(`steps.${index}.processType`);
            const preview = RATE.test(step.plannedYieldRate.trim()) ? formatYieldPercent(step.plannedYieldRate.trim()) : null;
            return (
              <tr key={step.processType}>
                <Td className="tabular-nums">{index + 1}</Td>
                <Td>
                  <span className="flex flex-col">
                    <span className="font-medium">{PROCESS_TYPE_LABEL[step.processType]}</span>
                    {processError ? <span className="text-cap text-danger">{processError}</span> : null}
                  </span>
                </Td>
                <Td className="py-1">
                  {step.processType === 'HOT_ROLLING' ? (
                    <button type="button" className="text-sm text-run hover:underline" onClick={() => onGoTab('mapping')}>
                      규격 매핑에서 계산
                    </button>
                  ) : step.processType === 'IRONMAKING' ? (
                    <span className="flex items-center gap-2">
                      <span className="text-ink-3">—</span>
                      <span className="text-cap text-ink-3">계산에 쓰지 않음 (원료는 용선 1t당 원단위로 계산)</span>
                    </span>
                  ) : (
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <Input
                          numeric
                          inputMode="decimal"
                          className="w-24"
                          placeholder="0.95"
                          value={step.plannedYieldRate}
                          readOnly={!canEdit}
                          invalid={rateError !== null}
                          aria-label={`${PROCESS_TYPE_LABEL[step.processType]} 계획 수율`}
                          onChange={(e) => {
                            const value = e.target.value;
                            setSteps((current) => current.map((s, i) => (i === index ? { ...s, plannedYieldRate: value } : s)));
                            fieldErrors.clear(`steps.${index}.plannedYieldRate`);
                          }}
                        />
                        <span className="text-cap text-ink-3 tabular-nums">{preview ?? ''}</span>
                      </span>
                      {rateError ? <span className="text-cap text-danger">{rateError}</span> : null}
                    </span>
                  )}
                </Td>
                <Td align="right">
                  <span className="inline-flex">
                    <IconButton icon="chevron-up" label="위로" size="sm" disabled={!canEdit || index === 0} onClick={() => move(index, -1)} />
                    <IconButton icon="chevron-down" label="아래로" size="sm" disabled={!canEdit || index === steps.length - 1} onClick={() => move(index, 1)} />
                    <IconButton
                      icon="x"
                      label="공정 빼기"
                      size="sm"
                      disabled={!canEdit}
                      title={canEdit ? '공정 빼기' : MASTER_LOCK_TEXT}
                      onClick={() => {
                        setSteps(steps.filter((_, i) => i !== index));
                        fieldErrors.clear();
                      }}
                    />
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {steps.length === 0 ? <EmptyNote>공정이 없어요. 아래에서 공정을 넣어 주세요</EmptyNote> : null}
      {canEdit && available.length > 0 ? (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <Select aria-label="넣을 공정" value={adding} onChange={(e) => setAdding(e.target.value)} className="w-40">
            <option value="">넣을 공정</option>
            {available.map((p) => (
              <option key={p} value={p}>
                {PROCESS_TYPE_LABEL[p]}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            icon="plus"
            disabled={!adding}
            onClick={() => {
              const processType = available.find((p) => p === adding);
              if (processType) setSteps([...steps, { processType, plannedYieldRate: '' }]);
              setAdding('');
            }}
          >
            공정 넣기
          </Button>
        </div>
      ) : null}
      <TableFoot className="flex items-center gap-3">
        <span className="min-w-0 flex-1">수율은 0보다 크고 1 이하 비율이에요 · 열연 수율은 넣지 않아요(규격 매핑에서 계산) · 순서는 위에서 아래로예요</span>
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setSteps(initial);
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
          onClick={() =>
            save.mutate({
              itemType: routing.itemType,
              expectedUpdatedAt: routing.updatedAt,
              steps: steps.map((s) => ({ processType: s.processType, plannedYieldRate: s.plannedYieldRate.trim() || null })),
            })
          }
        >
          {save.isPending ? '저장 중…' : '저장'}
        </Button>
      </TableFoot>
    </Card>
  );
}
