'use client';

// 불합격 상태 지정 (REQ-QC-004, TRM-079): 보류 / 격하 / 폐기 + 사유. 상태와 사유만 기록하고 후속 처리는 하지 않는다.
import { useState } from 'react';
import { InputError } from '@/api/client';
import type { RejectedLotListRow } from '@/api/dispositions';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Textarea } from '@/components/Input';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { DISPOSITION_STATUS, DISPOSITION_STATUS_LABEL, PERMISSION, type DispositionStatus } from '@/codes';
import { DispositionBadge } from '@/features/quality/components/QualityBadges';
import { useSetDisposition } from '@/hooks/useDispositions';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

const CHOICES: readonly DispositionStatus[] = [DISPOSITION_STATUS.HOLD, DISPOSITION_STATUS.DOWNGRADED, DISPOSITION_STATUS.SCRAPPED];
const HELP: Record<DispositionStatus, string> = {
  HOLD: '결정을 미뤄 두는 상태로 표시해요.',
  DOWNGRADED: '하위 등급으로 전환할 대상으로 표시해요.',
  SCRAPPED: '폐기 대상으로 표시해요.',
};
/** lot.disposition_reason 길이 (ERD varchar(500)) */
const MAX_REASON = 500;

export function DispositionForm({
  row,
  canEdit,
  dispositionAt,
}: {
  row: RejectedLotListRow;
  canEdit: boolean;
  /** 지정 시각. 서버 응답에 없으면 화면이 작업 로그(불합격 상태 지정)에서 찾아 넘긴다 */
  dispositionAt?: string | null;
}) {
  const setAt = dispositionAt ?? row.dispositionAt;
  const [choice, setChoice] = useState<DispositionStatus | null>(row.dispositionStatus);
  const [reason, setReason] = useState('');
  const save = useSetDisposition(() => setReason(''));
  const fieldErrors = save.error instanceof InputError ? save.error.fieldErrors : {};
  const canSubmit = canEdit && choice !== null && reason.trim().length > 0 && !save.isPending;

  return (
    <Card className="flex-none" petKey="card:rejectedLots.disposition">
      <CardHead
        title="불합격 상태 지정"
        meta={
          <span className="inline-flex items-center gap-1.5">
            현재 <DispositionBadge status={row.dispositionStatus} />
          </span>
        }
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && choice) save.mutate({ lotId: row.lotId, dispositionStatus: choice, dispositionReason: reason.trim(), expectedUpdatedAt: row.updatedAt });
        }}
      >
        <CardBody>
          {row.dispositionStatus ? (
            <div className="flex flex-col gap-0.5 text-cap text-ink-3" data-pet-term="지정 · 사유">
              {/* 시각을 모르면(작업 로그도 없으면) "준비 중" 대신 줄을 뺀다 */}
              {setAt ? <span>지정 {fmtDateTime(setAt)}</span> : null}
              <span className="text-xs text-ink-2">사유: {row.dispositionReason ?? '—'}</span>
            </div>
          ) : (
            <span className="text-cap text-ink-3">아직 불합격 상태를 지정하지 않았어요</span>
          )}

          {/* 세 가지를 한 줄에 나란히: 폭에 따라 칸 수가 바뀌면 폐기만 다음 줄에 혼자 떨어졌다 */}
          <div role="radiogroup" aria-label="불합격 상태" className="grid grid-cols-3 gap-2">
            {CHOICES.map((status) => (
              <label
                key={status}
                className={cn(
                  'flex items-start gap-2 rounded-md border p-2.5',
                  choice === status ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-2',
                  canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                )}
              >
                <input type="radio" name="disposition" value={status} checked={choice === status} disabled={!canEdit} onChange={() => setChoice(status)} className="mt-0.5" />
                {/* items-start: 배지가 칸 폭만큼 늘어나 막대처럼 보이지 않게 글자 폭만 차지한다 */}
                <span className="flex min-w-0 flex-col items-start gap-1">
                  <DispositionBadge status={status} />
                  <span className="text-cap text-ink-3">{HELP[status]}</span>
                </span>
              </label>
            ))}
          </div>
          {fieldErrors.dispositionStatus ? <span className="text-cap text-danger">{fieldErrors.dispositionStatus}</span> : null}

          <Field label={<span data-pet-term="사유">사유</span>} required htmlFor="disposition-reason" error={fieldErrors.dispositionReason} hint={`${reason.length}/${MAX_REASON}자 · 사유를 적어야 지정할 수 있어요`}>
            <Textarea
              id="disposition-reason"
              rows={3}
              maxLength={MAX_REASON}
              value={reason}
              disabled={!canEdit}
              invalid={Boolean(fieldErrors.dispositionReason)}
              placeholder="예: 성분 재확인 전까지 보류 / 하위 등급 용도로 전환 / 재사용할 수 없어 폐기"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>

          <div className="flex items-center gap-2">
            {canEdit ? null : <ReadOnlyHint permissions={[PERMISSION.DISPOSITION_SET]} />}
            <Button type="submit" variant="primary" icon="check" className="ml-auto" disabled={!canSubmit} title={canEdit ? undefined : permissionNeedText([PERMISSION.DISPOSITION_SET])}>
              {save.isPending ? '저장하는 중…' : choice !== null && choice === row.dispositionStatus ? `${DISPOSITION_STATUS_LABEL[choice]} 사유 다시 기록` : '상태 지정'}
            </Button>
          </div>

          <Banner className="text-xs leading-snug">
            불합격 상태와 사유만 기록해요. 격하 재판정·재작업·폐기 재고 처리는 하지 않아요. 불합격 LOT은 이미 예약·배정·출고 대상에서 빠져 있어요. 지정·변경 내역은 작업 로그에 남아요.
          </Banner>
        </CardBody>
      </form>
    </Card>
  );
}
