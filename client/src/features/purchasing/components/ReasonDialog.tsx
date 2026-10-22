'use client';

// 발주 취소·잔량 마감·입고 취소 확인 창 (BP-PUR-02 반대 거래). 사유는 필수이고 500자까지(서버 DTO와 같다), 작업 로그에 남는다.
// 서버가 거부하면(PUR-004~007·COM-001) 창을 닫지 않고 아래에 이유를 보인다.
import { useState, type ReactNode } from 'react';
import { InputError } from '@/api/errors';
import { Banner } from '@/components/Banner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { Textarea } from '@/components/Input';
import { errorMessageOf } from '@/stores/useToastStore';

const REASON_MAX = 500;

export function ReasonDialog({
  id,
  title,
  confirmLabel,
  reasonLabel,
  pending,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  id: string;
  title: ReactNode;
  confirmLabel: string;
  reasonLabel: string;
  pending: boolean;
  /** 마지막 요청의 서버 오류 (없으면 null) */
  error: unknown;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [blank, setBlank] = useState(false);
  const fieldError = blank ? `${reasonLabel}를 입력해 주세요` : error instanceof InputError ? (error.fieldErrors.reason ?? null) : null;
  const failure = error && !(error instanceof InputError && error.fieldErrors.reason) ? errorMessageOf(error) : null;

  return (
    <ConfirmDialog
      title={title}
      confirmLabel={confirmLabel}
      tone="danger"
      pending={pending}
      onCancel={onCancel}
      onConfirm={() => {
        if (!reason.trim()) {
          setBlank(true);
          return;
        }
        setBlank(false);
        onConfirm(reason);
      }}
    >
      <div className="flex flex-col gap-3">
        {children}
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
        <Field label={<span data-pet-term={reasonLabel}>{reasonLabel}</span>} required htmlFor={id} error={fieldError} hint={`${reason.length} / ${REASON_MAX}자 · 작업 로그에 남아요`}>
          <Textarea id={id} rows={3} maxLength={REASON_MAX} value={reason} invalid={Boolean(fieldError)} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
