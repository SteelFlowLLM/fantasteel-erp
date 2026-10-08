'use client';

// 측정값 입력·수정 폼 (REQ-QC-003, BP-QC-01). 항목은 판정에 쓰는 기준 버전에서 두께 구간(초과~이하)으로 거른 것이다.
// 입력하는 동안은 미리보기만 보이고, 판정은 저장할 때 시스템이 한다. 필수 항목이 비면 판정 대기로 저장된다.
// 이미 값이 있는 검사는 같은 기록을 고친다(바꾼 항목만 보낸다). 밀시트가 발행된 LOT은 잠긴다.
import { useState } from 'react';
import { InputError } from '@/api/client';
import type { InspectionDetail, RegisterInspectionOutcome } from '@/api/inspections';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote } from '@/components/StateView';
import { PERMISSION } from '@/codes';
import { LimitGauge } from '@/features/quality/components/LimitGauge';
import { ResultBadge } from '@/features/quality/components/QualityBadges';
import { fillTypicalValues, previewOf, sameMeasuredValue, thicknessBandText, trimNum, type ValuePreview } from '@/features/quality/lib/qualityDisplay';
import { useRegisterInspection } from '@/hooks/useInspections';
import { cn } from '@/lib/cn';
import { permissionNeedText } from '@/lib/permissions';
import type { InspectionFormItem } from '@/mock/services';

function ItemBadge({ item, preview, dirty }: { item: InspectionFormItem; preview: ValuePreview; dirty: boolean }) {
  if (item.minValue === null && item.maxValue === null) return <Badge tone="wait">기준 없음</Badge>;
  if (!dirty && item.isPassed !== null) return <ResultBadge result={item.isPassed ? 'PASS' : 'FAIL'} />;
  if (preview.state === 'empty') return <Badge>{item.isRequired ? '미입력' : '선택'}</Badge>;
  if (preview.state === 'invalid') return <Badge tone="wait">숫자 확인</Badge>;
  return <Badge tone={preview.state === 'pass' ? 'ok' : 'danger'}>미리보기 {preview.state === 'pass' ? '합격' : '불합격'}</Badge>;
}

export interface InspectionFormProps {
  detail: InspectionDetail;
  canEdit: boolean;
  onSaved: (outcome: RegisterInspectionOutcome) => void;
}

export function InspectionForm({ detail, canEdit, onSaved }: InspectionFormProps) {
  const items = detail.items;
  const [raw, setRaw] = useState<Record<number, string>>(() =>
    Object.fromEntries(items.map((item) => [item.inspectionStandardItemId, trimNum(item.measuredValue)])),
  );
  const register = useRegisterInspection(onSaved);
  const serverErrors = register.error instanceof InputError ? register.error.fieldErrors : {};

  const rows = items.map((item) => {
    const text = raw[item.inspectionStandardItemId] ?? '';
    return { item, text, preview: previewOf(text, item), dirty: !sameMeasuredValue(item.measuredValue, text) };
  });
  const dirtyRows = rows.filter((r) => r.dirty);
  const invalidRows = rows.filter((r) => r.preview.state === 'invalid');
  const enteredRows = rows.filter((r) => r.preview.state === 'pass' || r.preview.state === 'fail');
  const outsideRows = rows.filter((r) => r.preview.state === 'fail');
  const missingRows = rows.filter((r) => r.item.isRequired && r.preview.state === 'empty');
  const hasSavedValues = items.some((item) => item.measuredValue !== null);
  const editable = canEdit && !detail.locked && detail.standard !== null;
  const canSubmit = editable && items.length > 0 && invalidRows.length === 0 && dirtyRows.length > 0 && !register.isPending;

  const forecast =
    invalidRows.length > 0
      ? { tone: 'text-wait', text: `숫자(소수 4자리까지)로 입력해 주세요: ${invalidRows.map((r) => r.item.inspectionItemName).join(', ')}` }
      : outsideRows.length > 0
        ? { tone: 'text-danger', text: `기준 밖 ${outsideRows.length}개 · 저장하면 불합격으로 판정돼요` }
        : missingRows.length > 0
          ? { tone: 'text-wait', text: `필수 항목이 비어 있어요(${missingRows.map((r) => r.item.inspectionItemName).join(', ')}) · 저장하면 판정 대기로 남아요` }
          : enteredRows.length > 0
            ? { tone: 'text-ok', text: '모든 필수 항목이 기준 안이에요 · 저장하면 합격으로 판정돼요' }
            : { tone: 'text-ink-3', text: '측정값을 입력해 주세요' };

  const submit = () => {
    if (!canSubmit) return;
    register.mutate({
      lotId: detail.lot.lotId,
      values: dirtyRows.map((r) => ({ inspectionStandardItemId: r.item.inspectionStandardItemId, measuredValue: r.text.trim() === '' ? null : r.text.trim() })),
      expectedUpdatedAt: detail.updatedAt,
    });
  };

  return (
    <>
      <Card className="flex-none">
        <CardHead
          title="측정값"
          meta={`항목 ${items.length}개 · 필수 ${items.filter((i) => i.isRequired).length}개`}
          actions={
            <>
              <Button
                size="sm"
                icon="edit"
                disabled={!editable || items.length === 0}
                title={canEdit ? '비어 있는 칸만 기준 안 값으로 채워요. 저장은 직접 눌러요' : permissionNeedText([PERMISSION.INSPECTION_REGISTER])}
                onClick={() => setRaw((prev) => fillTypicalValues(items, prev))}
              >
                기준 안 값으로 채우기
              </Button>
              <span className="text-cap text-ink-3">시연용 도우미</span>
            </>
          }
        />
        <CardBody>
          <p className="flex items-start gap-1.5 text-cap text-ink-2">
            <Icon name="info" size="sm" className="mt-px text-run" />
            <span>
              입력하는 동안 보이는 합격·불합격은 기준(경계 포함)과 견준 미리보기예요. <b className="font-semibold">저장하면 시스템이 판정해요.</b>
              {hasSavedValues ? ' 같은 검사 기록을 고치고, 바꾼 값의 전·후는 작업 로그에 남아요.' : null}
            </span>
          </p>
          {items.length === 0 ? <EmptyNote>이 LOT에 적용할 검사 항목이 없어요. 품질 담당이 검사 기준 화면에서 항목을 등록해야 해요.</EmptyNote> : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {rows.map(({ item, text, preview, dirty }) => {
              const id = `qi-${item.inspectionStandardItemId}`;
              const bad = preview.state === 'fail';
              const band = thicknessBandText(item.minThicknessMm, item.maxThicknessMm);
              const serverError = serverErrors[`values.${item.inspectionStandardItemId}`];
              return (
                <div key={item.inspectionStandardItemId} className={cn('flex min-w-0 flex-col gap-1.5 rounded-md border p-3', bad ? 'border-[#e3a7a2] bg-[#fff9f8]' : 'border-line')}>
                  <div className="flex items-center gap-1.5">
                    <label htmlFor={id} className="text-sm font-semibold text-ink">
                      {item.inspectionItemName}
                      {item.isRequired ? (
                        <span className="ml-0.5 text-danger" title="필수">
                          *
                        </span>
                      ) : (
                        <span className="ml-1.5 text-cap font-normal text-ink-3">선택</span>
                      )}
                    </label>
                    <span className="font-mono text-2xs text-ink-3">{item.inspectionItemCode}</span>
                    <span className="ml-auto">
                      <ItemBadge item={item} preview={preview} dirty={dirty} />
                    </span>
                  </div>
                  <Input
                    id={id}
                    numeric
                    inputMode="decimal"
                    autoComplete="off"
                    suffix={item.unit ?? undefined}
                    value={text}
                    disabled={!editable}
                    invalid={bad || preview.state === 'invalid' || Boolean(serverError)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setRaw((prev) => ({ ...prev, [item.inspectionStandardItemId]: value }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submit();
                    }}
                  />
                  <LimitGauge item={item} value={preview.state === 'empty' ? null : text} bad={bad} />
                  {/* 기준 값은 게이지 눈금에 있다. 이 줄은 두께 구간이나 입력 확인 문구가 있을 때만 */}
                  {band || preview.state === 'fail' || preview.state === 'invalid' ? (
                    <div className="flex flex-wrap items-center gap-x-1.5 text-cap text-ink-3">
                      {band ? <span>{band}</span> : null}
                      {preview.state === 'fail' ? (
                        <span className="ml-auto text-danger">
                          {preview.side === 'below' ? '하한' : '상한'}보다 {preview.gap}
                          {item.unit ? ` ${item.unit}` : ''} {preview.side === 'below' ? '낮아요' : '높아요'}
                        </span>
                      ) : null}
                      {preview.state === 'invalid' ? <span className="ml-auto text-danger">숫자(소수 4자리까지)로 입력해 주세요</span> : null}
                    </div>
                  ) : null}
                  {serverError ? (
                    <span role="alert" className="text-cap text-danger">
                      {serverError}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <section aria-label="검사 저장" className="sticky bottom-0 z-[1] flex flex-none items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-cap text-ink-3">미리보기 (저장하면 시스템이 판정해요)</span>
          <b className="text-base font-semibold">
            입력 {enteredRows.length}/{items.length}
            {hasSavedValues ? <span className="ml-2 text-xs font-normal text-ink-3">바꾼 항목 {dirtyRows.length}개</span> : null}
          </b>
          <span className={cn('text-cap', forecast.tone)}>{forecast.text}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canEdit ? null : <ReadOnlyHint permissions={[PERMISSION.INSPECTION_REGISTER]} />}
          {hasSavedValues && dirtyRows.length > 0 && editable ? (
            <Button
              onClick={() => setRaw(Object.fromEntries(items.map((item) => [item.inspectionStandardItemId, trimNum(item.measuredValue)])))}
              disabled={register.isPending}
            >
              되돌리기
            </Button>
          ) : null}
          <Button variant="primary" icon="check" disabled={!canSubmit} title={canEdit ? undefined : permissionNeedText([PERMISSION.INSPECTION_REGISTER])} onClick={submit}>
            {register.isPending ? '저장하는 중…' : hasSavedValues ? '측정값 수정' : '검사 등록'}
          </Button>
        </div>
      </section>
    </>
  );
}
