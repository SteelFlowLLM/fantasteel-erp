'use client';

// 초안 카드: 원료 품목 · 수량(톤) · 희망 입고일 · 요청자 · 요청 근거 (REQ-ACT-001, 추출 스키마)
// AI 자동 추출은 준비 중이라 요청자가 직접 입력한다(SPEC 5장 결정 2). 확정은 요청자만(REQ-ACT-002, BP-ACT-01).
import { useState } from 'react';
import { DRAFT_STATUS_LABEL, PERMISSION } from '@/codes';
import { actionDraftApi, type DraftConfirmResult, type DraftDetailView } from '@/api/actionDrafts';
import { ApiError, InputError } from '@/api/client';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardFoot } from '@/components/Card';
import { ComingSoon, SoonButton } from '@/components/ComingSoon';
import { DateInput } from '@/components/DateInput';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { Table, Td, Th } from '@/components/Table';
import {
  DRAFT_FIELD_LABEL,
  DRAFT_STATUS_TONE,
  draftFormOf,
  draftPayloadOfForm,
  isFieldUnresolved,
  isSameDraftForm,
  type DraftExecutionFailure,
  type DraftForm,
} from '@/features/actionDrafts/lib/draftDisplay';
import { useAction } from '@/hooks/useAction';
import { useDraftRawMaterials } from '@/hooks/useActionDrafts';
import { useCanUse } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { fmtMDHM, fmtTon } from '@/lib/format';
import { withEulReul } from '@/lib/josa';
import { toast } from '@/stores/useToastStore';

const REASON_MAX = 500;
const NEED = [PERMISSION.PURCHASE_REQUISITION_CREATE];

export interface ConfirmFailure {
  code: string | null;
  message: string;
  detail: string | null;
}

interface DraftFormCardProps {
  draft: DraftDetailView;
  failure: DraftExecutionFailure | null;
  /** 확정·실행이 막혔을 때 위쪽 배너에 보일 내용 (null = 지움) */
  onConfirmFailure: (failure: ConfirmFailure | null) => void;
}

function toastConfirmResult(result: DraftConfirmResult) {
  if (result.executed && result.target) toast.ok(`${withEulReul(`구매요청 ${result.target.targetNo}`)} 만들었어요. 부서장 승인을 기다려요`);
  else toast.error('확정했지만 구매요청을 만들지 못했어요');
}

export function DraftFormCard({ draft, failure, onConfirmFailure }: DraftFormCardProps) {
  const canUsePr = useCanUse(PERMISSION.PURCHASE_REQUISITION_CREATE);
  const materials = useDraftRawMaterials();
  const saved = draftFormOf(draft.payload);
  const [form, setForm] = useState<DraftForm>(saved);
  // 다른 탭·저장으로 초안이 바뀌면, 내가 고치는 중이 아닐 때만 폼을 맞춘다 (렌더 중 상태 맞추기)
  const [base, setBase] = useState({ updatedAt: draft.updatedAt, form: saved });
  if (base.updatedAt !== draft.updatedAt) {
    setBase({ updatedAt: draft.updatedAt, form: saved });
    if (isSameDraftForm(form, base.form)) setForm(saved);
  }
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const status = draft.draftStatus;
  const open = status === 'AI_GENERATED' || status === 'WAITING_APPROVAL';
  const editable = open && draft.isRequester && canUsePr;
  const retryable = status === 'APPROVED' && failure !== null && draft.isRequester && canUsePr;
  const dirty = !isSameDraftForm(form, saved);

  const onInputError = (error: unknown) => {
    if (error instanceof InputError) setFieldErrors(error.fieldErrors);
  };
  const onConfirmError = (error: unknown) => {
    onInputError(error);
    if (error instanceof ApiError) onConfirmFailure({ code: error.code, message: error.message, detail: error.detail });
  };
  const update = useAction(actionDraftApi.update, { onError: onInputError, onSuccess: () => setFieldErrors({}) });
  const confirm = useAction(actionDraftApi.confirm, {
    onError: onConfirmError,
    onSuccess: (result) => {
      toastConfirmResult(result);
      onConfirmFailure(null);
    },
  });
  const execute = useAction(actionDraftApi.execute, { onError: onConfirmError, onSuccess: toastConfirmResult });
  const reject = useAction(actionDraftApi.reject, {
    success: '초안을 반려했어요',
    onError: onInputError,
    onSuccess: () => {
      setRejecting(false);
      setRejectReason('');
    },
  });
  const pending = update.isPending || confirm.isPending || execute.isPending || reject.isPending;

  const set = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = () => update.mutate({ actionDraftId: draft.id, payload: draftPayloadOfForm(form), expectedUpdatedAt: draft.updatedAt });
  const doConfirm = async () => {
    onConfirmFailure(null);
    setFieldErrors({});
    try {
      let expectedUpdatedAt = draft.updatedAt;
      if (dirty) expectedUpdatedAt = (await update.mutateAsync({ actionDraftId: draft.id, payload: draftPayloadOfForm(form), expectedUpdatedAt })).updatedAt;
      await confirm.mutateAsync({ actionDraftId: draft.id, expectedUpdatedAt });
    } catch {
      // 안내는 useAction(토스트)과 onError(위 배너·칸 아래 안내)가 한다
    }
  };

  const materialList = materials.data ?? [];
  const material = materialList.find((m) => m.id === form.itemId);
  const unresolved = (field: keyof DraftForm) => open && isFieldUnresolved(field, draft.unresolvedFields, form, saved);
  const errorOf = (field: keyof DraftForm) => fieldErrors[field] ?? null;
  const reasonTooLong = form.requestReason.length > REASON_MAX;

  const label = (field: keyof DraftForm, required: boolean) => (
    <span className="flex flex-wrap items-center gap-1.5">
      <span>
        {DRAFT_FIELD_LABEL[field]}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
      {unresolved(field) ? (
        <Badge tone="wait" plain>
          미확정
        </Badge>
      ) : null}
    </span>
  );
  const note = (field: keyof DraftForm) => {
    const error = errorOf(field);
    return error ? (
      <span role="alert" className="mt-1 block text-cap text-danger">
        {error}
      </span>
    ) : null;
  };
  const readValue = (text: string | null) => (text ? <span className="text-sm text-ink">{text}</span> : <span className="text-sm text-ink-3">입력되지 않았어요</span>);
  const cell = 'h-auto py-2.5 whitespace-normal align-middle';

  return (
    <Card className={cn(status === 'EXECUTED' && 'border-[#b9dec8]', status === 'REJECTED' && 'opacity-90')}>
      <header className="flex flex-none flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-base font-semibold">{editable ? '값을 입력하고 확정해 주세요' : '초안 내용'}</h2>
        <span className="flex items-center gap-1.5 rounded-sm border border-dashed border-line-strong bg-surface-2 px-2 py-1 text-cap text-ink-3">
          <ComingSoon grade="AI" />
          AI 자동 추출은 준비 중이에요. 값을 직접 입력해 주세요.
        </span>
        <span className="ml-auto flex items-center gap-2">
          <SoonButton grade="AI" variant="ai-outline" size="sm">
            AI 자동 추출
          </SoonButton>
          <Badge tone={DRAFT_STATUS_TONE[status]}>{DRAFT_STATUS_LABEL[status]}</Badge>
        </span>
      </header>
      <div className="overflow-x-auto px-4 py-3">
        <Table>
          <thead>
            <tr>
              <Th className="w-32">항목</Th>
              <Th>값</Th>
              <Th className="w-56">기준</Th>
            </tr>
          </thead>
          <tbody>
            <tr data-risk={unresolved('itemId') || undefined}>
              <Td className={cn(cell, 'text-ink-2')}>{label('itemId', true)}</Td>
              <Td className={cell}>
                {editable ? (
                  <Select
                    aria-label={DRAFT_FIELD_LABEL.itemId}
                    className="w-full max-w-80"
                    value={form.itemId ?? ''}
                    invalid={Boolean(errorOf('itemId'))}
                    disabled={pending || materials.isPending}
                    onChange={(event) => set('itemId', event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">원료를 골라 주세요</option>
                    {materialList.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.itemName} · {m.itemCode}
                      </option>
                    ))}
                  </Select>
                ) : (
                  readValue(draft.itemName ? `${draft.itemName} · ${draft.itemCode ?? ''}` : null)
                )}
                {note('itemId')}
                {materials.error ? <span className="mt-1 block text-cap text-danger">원료 목록을 불러오지 못했어요</span> : null}
              </Td>
              <Td className={cn(cell, 'text-cap text-ink-3')}>
                {(editable ? material : draft.itemName)
                  ? `기본 공급업체 ${(editable ? material?.defaultSupplierName : draft.itemDefaultSupplierName) ?? '미지정'}`
                  : '기준정보에 등록된 원료'}
              </Td>
            </tr>
            <tr data-risk={unresolved('requiredTon') || undefined}>
              <Td className={cn(cell, 'text-ink-2')}>{label('requiredTon', true)}</Td>
              <Td className={cell}>
                {editable ? (
                  <Input
                    aria-label={DRAFT_FIELD_LABEL.requiredTon}
                    numeric
                    suffix="t"
                    inputMode="decimal"
                    placeholder="0.000"
                    className="w-44"
                    value={form.requiredTon}
                    invalid={Boolean(errorOf('requiredTon'))}
                    disabled={pending}
                    onChange={(event) => set('requiredTon', event.target.value)}
                  />
                ) : (
                  readValue(draft.payload.requiredTon ? fmtTon(draft.payload.requiredTon) : null)
                )}
                {note('requiredTon')}
              </Td>
              <Td className={cn(cell, 'text-cap text-ink-3')}>0보다 큰 톤 · 소수 3자리까지</Td>
            </tr>
            <tr data-risk={unresolved('desiredReceiptDate') || undefined}>
              <Td className={cn(cell, 'text-ink-2')}>{label('desiredReceiptDate', true)}</Td>
              <Td className={cell}>
                {editable ? (
                  <DateInput
                    ariaLabel={DRAFT_FIELD_LABEL.desiredReceiptDate}
                    value={form.desiredReceiptDate}
                    onChange={(value) => set('desiredReceiptDate', value)}
                    invalid={Boolean(errorOf('desiredReceiptDate'))}
                    disabled={pending}
                    className="w-44"
                  />
                ) : (
                  readValue(draft.payload.desiredReceiptDate)
                )}
                {note('desiredReceiptDate')}
              </Td>
              <Td className={cn(cell, 'text-cap text-ink-3')}>YYYY-MM-DD 날짜</Td>
            </tr>
            <tr>
              <Td className={cn(cell, 'text-ink-2')}>요청자</Td>
              <Td className={cell}>
                <span className="text-sm text-ink">
                  {draft.requester.employeeName}
                  {draft.requester.jobGradeName ? ` ${draft.requester.jobGradeName}` : ''}
                  {draft.requester.departmentName ? ` · ${draft.requester.departmentName}` : ''}
                </span>
              </Td>
              <Td className={cn(cell, 'text-cap text-ink-3')}>메시지 작성자 · 바꿀 수 없어요</Td>
            </tr>
            <tr>
              <Td className={cn(cell, 'border-b-0 text-ink-2')}>{label('requestReason', false)}</Td>
              <Td className={cn(cell, 'border-b-0')}>
                {editable ? (
                  <Textarea
                    aria-label={DRAFT_FIELD_LABEL.requestReason}
                    rows={2}
                    placeholder="어디에 쓰는지, 왜 필요한지 (선택)"
                    value={form.requestReason}
                    invalid={reasonTooLong || Boolean(errorOf('requestReason'))}
                    disabled={pending}
                    onChange={(event) => set('requestReason', event.target.value)}
                  />
                ) : (
                  readValue(draft.payload.requestReason)
                )}
                {reasonTooLong && editable ? <span className="mt-1 block text-cap text-danger">{REASON_MAX}자까지 쓸 수 있어요</span> : note('requestReason')}
              </Td>
              <Td className={cn(cell, 'border-b-0 text-cap text-ink-3')}>{REASON_MAX}자 이하 · 선택 · 비우면 원본 메시지 글이 들어가요</Td>
            </tr>
          </tbody>
        </Table>
      </div>
      <CardFoot className="flex-wrap">
        {editable || retryable ? (
          rejecting && editable ? (
            <>
              <Input
                aria-label="반려 사유"
                className="min-w-56 flex-1"
                value={rejectReason}
                maxLength={REASON_MAX}
                placeholder="반려 사유 (필수)"
                invalid={Boolean(fieldErrors.rejectReason)}
                autoFocus
                onChange={(event) => setRejectReason(event.target.value)}
              />
              <Button variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>
                취소
              </Button>
              <Button
                variant="danger-outline"
                disabled={rejectReason.trim() === '' || pending}
                onClick={() => reject.mutate({ actionDraftId: draft.id, rejectReason: rejectReason.trim(), expectedUpdatedAt: draft.updatedAt })}
              >
                반려 확정
              </Button>
            </>
          ) : editable ? (
            <>
              <Button variant="ghost" icon="x-circle" disabled={pending} onClick={() => setRejecting(true)}>
                반려
              </Button>
              <span className="text-cap text-ink-3">{dirty ? '저장하지 않은 수정이 있어요' : `마지막 저장 ${fmtMDHM(draft.updatedAt)}`}</span>
              <Button icon="check" className="ml-auto" disabled={!dirty || reasonTooLong || pending} onClick={save}>
                저장
              </Button>
              <Button variant="primary" icon="send" disabled={reasonTooLong || pending} onClick={() => void doConfirm()}>
                확정하고 구매요청 만들기
              </Button>
            </>
          ) : (
            <>
              <span className="text-cap text-ink-3">확정된 값은 바꿀 수 없어요</span>
              <Button variant="primary" icon="refresh" className="ml-auto" disabled={pending} onClick={() => execute.mutate({ actionDraftId: draft.id })}>
                구매요청 만들기 다시 실행
              </Button>
            </>
          )
        ) : (
          <LockHint draft={draft} canUsePr={canUsePr} />
        )}
      </CardFoot>
    </Card>
  );
}

function LockHint({ draft, canUsePr }: { draft: DraftDetailView; canUsePr: boolean }) {
  const name = draft.requester.employeeName;
  const status = draft.draftStatus;
  if (draft.isRequester && !canUsePr && status !== 'EXECUTED' && status !== 'REJECTED') return <ReadOnlyHint permissions={NEED} />;
  const text =
    status === 'AI_GENERATED' || status === 'WAITING_APPROVAL'
      ? `수정·확정·반려는 요청자(${name})만 할 수 있어요. ${name}님이 확정해야 구매요청이 만들어져요`
      : status === 'APPROVED'
        ? `요청자(${name})가 확정했어요 · 구매요청 생성 대기`
        : status === 'EXECUTED'
          ? `확정 ${fmtMDHM(draft.confirmedAt)} · ERP 반영 ${fmtMDHM(draft.executedAt)} · 더 고칠 수 없어요`
          : '반려된 초안이라 더 고칠 수 없어요';
  return (
    <span className="inline-flex items-center gap-1 text-cap text-ink-3">
      <Icon name="lock" size="sm" />
      {text}
    </span>
  );
}
