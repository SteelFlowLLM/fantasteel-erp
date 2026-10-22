'use client';

// 확장 유형 초안 카드 (REQ-ACT-005, BP-ACT-02, 업무 프로세스 12.3): 수주 등록·출하요청 생성·배정 확정·재생산 계획 생성.
// 확정 주체는 초안을 만든 사원이고 그 유형의 사용 권한이 있어야 고치고 확정·반려한다. AI가 채운 칸도 사람이 확인하고 확정한다.
// 서버가 준 미확정 칸(unresolvedFields)을 칸 옆에 '미확정'으로 보인다. 칸 검증·실행은 서버가 한다.
import { useState, type ReactNode } from 'react';
import { MAX_ORDERED_QTY } from '@fantasteel/shared';
import { DRAFT_STATUS_LABEL, SALES_ORDER_ITEM_STATUS, SHIPMENT_REQUEST_STATUS } from '@/codes';
import { actionDraftApi, type DraftConfirmResult, type DraftDetailView } from '@/api/actionDrafts';
import { ApiError, InputError } from '@/api/errors';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardFoot } from '@/components/Card';
import { DateInput } from '@/components/DateInput';
import { Icon } from '@/components/Icon';
import { Input, Select } from '@/components/Input';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { Table, Td, Th } from '@/components/Table';
import type { ConfirmFailure } from '@/features/actionDrafts/components/DraftFormCard';
import { AiFillHint } from '@/features/actionDrafts/components/AiFillHint';
import { DRAFT_STATUS_TONE, type DraftExecutionFailure } from '@/features/actionDrafts/lib/draftDisplay';
import {
  ACTION_TYPE_GUIDE,
  buildTypedForm,
  buildTypedPatch,
  emptySalesOrderLine,
  emptyShipmentLine,
  isSameTypedForm,
  isTypedFieldUnresolved,
  lineFieldLabel,
  resultLabelOf,
  type AllocationForm,
  type ExtendedActionType,
  type ReproductionPlanForm,
  type SalesOrderForm,
  type ShipmentRequestForm,
  type TypedDraftForm,
} from '@/features/actionDrafts/lib/typedDrafts';
import { useAction } from '@/hooks/useAction';
import { useCustomerList, useProductSpecList } from '@/hooks/useLookups';
import { useCanUse } from '@/hooks/usePermission';
import { useSalesOrderDetail, useSalesOrderList } from '@/hooks/useSalesOrders';
import { useShipmentRequestDetail, useShipmentRequestList, useShippableItems } from '@/hooks/useShipmentRequests';
import { cn } from '@/lib/cn';
import { createSubmitLock } from '@/lib/submitLock';
import { fmtMDHM } from '@/lib/format';
import { withEulReul } from '@/lib/josa';
import { toast } from '@/stores/useToastStore';

const REASON_MAX = 500;
const CELL = 'h-auto py-2.5 whitespace-normal align-middle';
const OPEN_SALES_ORDER_ITEM: readonly string[] = [SALES_ORDER_ITEM_STATUS.OPEN, SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED];
const OPEN_SHIPMENT_REQUEST: readonly string[] = [SHIPMENT_REQUEST_STATUS.REQUESTED, SHIPMENT_REQUEST_STATUS.ALLOCATED];

interface TypedDraftFormCardProps {
  draft: DraftDetailView;
  actionType: ExtendedActionType;
  failure: DraftExecutionFailure | null;
  onConfirmFailure: (failure: ConfirmFailure | null) => void;
}

/** 칸 공통: 이 칸이 미확정인지 (서버 표시명 기준, 고치는 중인 칸은 뺀다) */
interface FieldContext {
  draft: DraftDetailView;
  editable: boolean;
  pending: boolean;
  /** 저장된 값 기준으로 미확정인지 (changed = 지금 입력이 저장값과 다름) */
  isUnresolved: (label: string, changed: boolean) => boolean;
}

function toastConfirmResult(result: DraftConfirmResult, label: string) {
  if (result.executed && result.target) toast.ok(`${withEulReul(`${resultLabelOf({ table: result.target.targetType })} ${result.target.targetNo}`)} 만들었어요`);
  else toast.error(`확정했지만 ${label}을(를) 실행하지 못했어요`);
}

export function TypedDraftFormCard({ draft, actionType, failure, onConfirmFailure }: TypedDraftFormCardProps) {
  const guide = ACTION_TYPE_GUIDE[actionType];
  const canUse = useCanUse(...(guide ? [guide.permission] : []));
  const saved = buildTypedForm(actionType, draft.payload);
  const [form, setForm] = useState<TypedDraftForm>(saved);
  // 다른 탭·저장으로 초안이 바뀌면, 내가 고치는 중이 아닐 때만 폼을 맞춘다 (렌더 중 상태 맞추기)
  const [base, setBase] = useState({ updatedAt: draft.updatedAt, form: saved });
  if (base.updatedAt !== draft.updatedAt) {
    setBase({ updatedAt: draft.updatedAt, form: saved });
    if (isSameTypedForm(form, base.form)) setForm(saved);
  }
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const status = draft.draftStatus;
  const open = status === 'AI_GENERATED' || status === 'WAITING_APPROVAL';
  const editable = open && draft.isRequester && canUse;
  const retryable = status === 'APPROVED' && failure !== null && draft.isRequester && canUse;
  const dirty = !isSameTypedForm(form, saved);
  const typeLabel = guide?.label ?? draft.actionTypeLabel;

  const onConfirmError = (error: unknown) => {
    if (error instanceof ApiError) onConfirmFailure({ code: error.code, message: error.message, detail: error.detail });
  };
  const update = useAction(actionDraftApi.updateFields);
  const confirm = useAction(actionDraftApi.confirm, {
    onError: onConfirmError,
    onSuccess: (result) => {
      toastConfirmResult(result, typeLabel);
      onConfirmFailure(null);
    },
  });
  const execute = useAction(actionDraftApi.execute, { onError: onConfirmError, onSuccess: (result) => toastConfirmResult(result, typeLabel) });
  const reject = useAction(actionDraftApi.reject, {
    success: '초안을 반려했어요',
    onError: (error) => setRejectError(error instanceof InputError ? (error.fieldErrors.rejectReason ?? null) : null),
    onSuccess: () => {
      setRejecting(false);
      setRejectReason('');
    },
  });
  const pending = update.isPending || confirm.isPending || execute.isPending || reject.isPending;
  // 확정·다시 실행·반려를 렌더를 기다리지 않고 잠근다: 더블클릭한 두 번째 요청을 보내지 않는다 (#531)
  const [lock] = useState(createSubmitLock);
  const once = (run: () => Promise<unknown>) => () => {
    if (!lock.tryEnter()) return;
    void run()
      .catch(() => {
        // 안내는 useAction(토스트)과 onError가 한다
      })
      .finally(() => lock.release());
  };

  const save = () => update.mutate({ actionDraftId: draft.id, fields: buildTypedPatch(form), expectedUpdatedAt: draft.updatedAt });
  const doConfirm = once(async () => {
    onConfirmFailure(null);
    try {
      let expectedUpdatedAt = draft.updatedAt;
      if (dirty) expectedUpdatedAt = (await update.mutateAsync({ actionDraftId: draft.id, fields: buildTypedPatch(form), expectedUpdatedAt })).updatedAt;
      await confirm.mutateAsync({ actionDraftId: draft.id, expectedUpdatedAt });
    } catch {
      // 안내는 useAction(토스트)과 onError(위 배너)가 한다
    }
  });

  const ctx: FieldContext = {
    draft,
    editable,
    pending,
    isUnresolved: (label, changed) => open && isTypedFieldUnresolved(draft.unresolvedFields, label, changed),
  };

  return (
    <Card petKey="card:actionDrafts.typedForm" className={cn(status === 'EXECUTED' && 'border-[#b9dec8]', status === 'REJECTED' && 'opacity-90')}>
      <header className="flex flex-none flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-base font-semibold">{editable ? '값을 확인하고 확정해 주세요' : '초안 내용'}</h2>
        <AiFillHint aiFilledFields={draft.payload.aiFilledFields ?? []} aiExtraction={draft.payload.aiExtraction} editable={editable} />
        <Badge tone={DRAFT_STATUS_TONE[status]} className="ml-auto">
          {DRAFT_STATUS_LABEL[status]}
        </Badge>
      </header>
      <div className="overflow-x-auto px-4 py-3">
        {form.actionType === 'SALES_ORDER_CREATE' ? <SalesOrderFields ctx={ctx} form={form} onChange={setForm} /> : null}
        {form.actionType === 'SHIPMENT_REQUEST_CREATE' ? <ShipmentRequestFields ctx={ctx} form={form} onChange={setForm} /> : null}
        {form.actionType === 'ALLOCATION_CONFIRM' ? (
          <AllocationFields ctx={ctx} form={form} onChange={setForm} onRecommend={(id) => update.mutate({ actionDraftId: draft.id, fields: { shipmentRequestItemId: id }, expectedUpdatedAt: draft.updatedAt })} dirty={dirty} />
        ) : null}
        {form.actionType === 'REPRODUCTION_PLAN_CREATE' ? <ReproductionPlanFields ctx={ctx} form={form} onChange={setForm} /> : null}
        <RequesterRow draft={draft} />
      </div>
      <CardFoot className="flex-wrap">
        {(editable || retryable) && rejecting ? (
          <>
            <Input
              aria-label="반려 사유"
              className="min-w-56 flex-1"
              value={rejectReason}
              maxLength={REASON_MAX}
              placeholder="반려 사유 (필수)"
              invalid={rejectError !== null}
              autoFocus
              onChange={(event) => setRejectReason(event.target.value)}
            />
            <Button variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>
              취소
            </Button>
            <Button
              variant="danger-outline"
              disabled={rejectReason.trim() === '' || pending}
              onClick={once(() => reject.mutateAsync({ actionDraftId: draft.id, rejectReason: rejectReason.trim(), expectedUpdatedAt: draft.updatedAt }))}
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
            <Button icon="check" className="ml-auto" disabled={!dirty || pending} onClick={save}>
              저장
            </Button>
            <Button variant="primary" icon="send" disabled={pending} onClick={doConfirm}>
              {guide?.confirmLabel ?? '확정'}
            </Button>
          </>
        ) : retryable ? (
          <>
            {/* 실행에 실패한 초안은 반려해 끝낼 수 있다 (#471 리뷰) */}
            <Button variant="ghost" icon="x-circle" disabled={pending} onClick={() => setRejecting(true)}>
              반려
            </Button>
            <span className="text-cap text-ink-3">확정된 값은 바꿀 수 없어요</span>
            <Button variant="primary" icon="refresh" className="ml-auto" disabled={pending} onClick={once(() => execute.mutateAsync({ actionDraftId: draft.id }))}>
              {typeLabel} 다시 실행
            </Button>
          </>
        ) : (
          <TypedLockHint draft={draft} canUse={canUse} typeLabel={typeLabel} />
        )}
      </CardFoot>
    </Card>
  );
}

// ── 칸 그리기 공통 ──────────────────────────────────

function FieldLabel({ label, required, unresolved }: { label: string; required: boolean; unresolved: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span data-pet-term={label}>
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
      {unresolved ? (
        <span data-pet-term="미확정">
          <Badge tone="wait" plain>
            미확정
          </Badge>
        </span>
      ) : null}
    </span>
  );
}

function ReadValue({ text }: { text: string | null | undefined }) {
  return text ? <span className="text-sm text-ink">{text}</span> : <span className="text-sm text-ink-3">입력되지 않았어요</span>;
}

/** 항목 | 값 | 기준 세 칸짜리 한 줄 */
function FieldRow({ label, required, unresolved, hint, children }: { label: string; required: boolean; unresolved: boolean; hint: ReactNode; children: ReactNode }) {
  return (
    <tr data-risk={unresolved || undefined}>
      <Td className={cn(CELL, 'w-32 text-ink-2')}>
        <FieldLabel label={label} required={required} unresolved={unresolved} />
      </Td>
      <Td className={CELL}>{children}</Td>
      <Td className={cn(CELL, 'w-56 text-cap text-ink-3')}>{hint}</Td>
    </tr>
  );
}

function FieldTable({ children }: { children: ReactNode }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-32">항목</Th>
          <Th>값</Th>
          <Th className="w-56">기준</Th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </Table>
  );
}

function RequesterRow({ draft }: { draft: DraftDetailView }) {
  const r = draft.requester;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-cap text-ink-3">
      <Icon name="user" size="sm" />
      <span data-pet-term="확정 주체">확정 주체</span>
      <span className="text-ink">
        {r.employeeName}
        {r.jobGradeName ? ` ${r.jobGradeName}` : ''}
        {r.departmentName ? ` · ${r.departmentName}` : ''}
      </span>
      · 초안을 만든 사원이 확인하고 확정해요
    </p>
  );
}

/** 품목 줄 표: 줄마다 칸 여러 개 + 지우기, 아래 '품목 추가' */
function LineTable({ headers, rows, onAdd, editable, pending, emptyText }: { headers: string[]; rows: ReactNode[]; onAdd: () => void; editable: boolean; pending: boolean; emptyText: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Table>
        <thead>
          <tr>
            <Th className="w-12">줄</Th>
            {headers.map((h) => (
              <Th key={h}>{h}</Th>
            ))}
            {editable ? <Th className="w-12" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows
          ) : (
            <tr>
              <Td colSpan={headers.length + 2} className={cn(CELL, 'text-ink-3')}>
                {emptyText}
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
      {editable ? (
        <Button size="sm" variant="ghost" icon="plus" className="self-start" disabled={pending} onClick={onAdd}>
          품목 추가
        </Button>
      ) : null}
    </div>
  );
}

function RemoveLineButton({ index, onRemove, pending }: { index: number; onRemove: () => void; pending: boolean }) {
  return (
    <Td className={CELL}>
      <Button size="sm" variant="ghost" icon="trash" aria-label={`품목 ${index + 1} 지우기`} disabled={pending} onClick={onRemove} />
    </Td>
  );
}

function UnresolvedMark({ show }: { show: boolean }) {
  return show ? (
    <Badge tone="wait" plain className="ml-1.5">
      미확정
    </Badge>
  ) : null;
}

// ── 수주 등록 ───────────────────────────────────────

function SalesOrderFields({ ctx, form, onChange }: { ctx: FieldContext; form: SalesOrderForm; onChange: (form: SalesOrderForm) => void }) {
  const { draft, editable, pending, isUnresolved } = ctx;
  const customers = useCustomerList();
  const specs = useProductSpecList();
  const saved = buildTypedForm('SALES_ORDER_CREATE', draft.payload) as SalesOrderForm;
  const setLine = (index: number, patch: Partial<SalesOrderForm['items'][number]>) => onChange({ ...form, items: form.items.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  const lineChanged = (index: number, key: keyof SalesOrderForm['items'][number]) => saved.items[index]?.[key] !== form.items[index]?.[key];

  return (
    <div className="flex flex-col gap-3">
      <FieldTable>
        <FieldRow label="고객사" required unresolved={isUnresolved('고객사', form.customerId !== saved.customerId)} hint="기준정보에 등록된 고객사">
          {editable ? (
            <Select aria-label="고객사" className="w-full max-w-80" value={form.customerId ?? ''} disabled={pending || customers.isPending} onChange={(e) => onChange({ ...form, customerId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">고객사를 골라 주세요</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customerName} · {c.customerCode}
                </option>
              ))}
            </Select>
          ) : (
            <ReadValue text={draft.payloadLabels.customerId} />
          )}
        </FieldRow>
      </FieldTable>
      <span className="flex items-center text-sm font-semibold">
        품목
        <UnresolvedMark show={isUnresolved('품목', form.items.length !== saved.items.length)} />
        <span className="ml-2 text-cap font-normal text-ink-3">매수는 1~{MAX_ORDERED_QTY.toLocaleString('en-US')} 정수 · 톤은 매수 × 이론중량으로 계산해요</span>
      </span>
      <LineTable
        headers={['규격', '매수', '납기']}
        editable={editable}
        pending={pending}
        emptyText="품목이 없어요. 품목을 추가해 주세요"
        onAdd={() => onChange({ ...form, items: [...form.items, emptySalesOrderLine()] })}
        rows={form.items.map((line, index) => (
          <tr key={index}>
            <Td className={cn(CELL, 'text-ink-3 tabular-nums')}>{index + 1}</Td>
            <Td className={CELL}>
              {editable ? (
                <Select aria-label={lineFieldLabel(index, '규격')} className="w-full min-w-56" value={line.itemId ?? ''} disabled={pending || specs.isPending} onChange={(e) => setLine(index, { itemId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">규격을 골라 주세요</option>
                  {(specs.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.itemCode} · {s.itemName}
                    </option>
                  ))}
                </Select>
              ) : (
                <ReadValue text={draft.payloadLabels[`items.${index}.itemId`]} />
              )}
              <UnresolvedMark show={isUnresolved(lineFieldLabel(index, '규격'), lineChanged(index, 'itemId'))} />
            </Td>
            <Td className={CELL}>
              {editable ? (
                <Input aria-label={lineFieldLabel(index, '매수')} numeric suffix="매" inputMode="numeric" className="w-28" value={line.orderedQty} disabled={pending} onChange={(e) => setLine(index, { orderedQty: e.target.value })} />
              ) : (
                <ReadValue text={line.orderedQty ? `${line.orderedQty}매` : null} />
              )}
              <UnresolvedMark show={isUnresolved(lineFieldLabel(index, '매수'), lineChanged(index, 'orderedQty'))} />
            </Td>
            <Td className={CELL}>
              {editable ? <DateInput ariaLabel={lineFieldLabel(index, '납기')} value={line.dueDate} disabled={pending} onChange={(value) => setLine(index, { dueDate: value })} className="w-40" /> : <ReadValue text={line.dueDate} />}
              <UnresolvedMark show={isUnresolved(lineFieldLabel(index, '납기'), lineChanged(index, 'dueDate'))} />
            </Td>
            {editable ? <RemoveLineButton index={index} pending={pending} onRemove={() => onChange({ ...form, items: form.items.filter((_, i) => i !== index) })} /> : null}
          </tr>
        ))}
      />
    </div>
  );
}

// ── 출하요청 생성 ───────────────────────────────────

function ShipmentRequestFields({ ctx, form, onChange }: { ctx: FieldContext; form: ShipmentRequestForm; onChange: (form: ShipmentRequestForm) => void }) {
  const { draft, editable, pending, isUnresolved } = ctx;
  const customers = useCustomerList();
  const shippable = useShippableItems(editable ? form.customerId : null);
  const saved = buildTypedForm('SHIPMENT_REQUEST_CREATE', draft.payload) as ShipmentRequestForm;
  const setLine = (index: number, patch: Partial<ShipmentRequestForm['items'][number]>) => onChange({ ...form, items: form.items.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  const lineChanged = (index: number, key: keyof ShipmentRequestForm['items'][number]) => saved.items[index]?.[key] !== form.items[index]?.[key];
  const options = shippable.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <FieldTable>
        <FieldRow label="고객사" required unresolved={isUnresolved('고객사', form.customerId !== saved.customerId)} hint="같은 고객사의 수주 품목만 묶어요">
          {editable ? (
            <Select aria-label="고객사" className="w-full max-w-80" value={form.customerId ?? ''} disabled={pending || customers.isPending} onChange={(e) => onChange({ ...form, customerId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">고객사를 골라 주세요</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customerName} · {c.customerCode}
                </option>
              ))}
            </Select>
          ) : (
            <ReadValue text={draft.payloadLabels.customerId} />
          )}
        </FieldRow>
        <FieldRow label="출하 예정일" required={false} unresolved={false} hint="선택 · YYYY-MM-DD">
          {editable ? <DateInput ariaLabel="출하 예정일" value={form.shipDate} disabled={pending} onChange={(value) => onChange({ ...form, shipDate: value })} className="w-40" /> : <ReadValue text={form.shipDate || null} />}
        </FieldRow>
      </FieldTable>
      <span className="flex items-center text-sm font-semibold">
        품목
        <UnresolvedMark show={isUnresolved('품목', form.items.length !== saved.items.length)} />
        <span className="ml-2 text-cap font-normal text-ink-3">출하 가능 매수 = ACTIVE 예약 − 진행 중 출하요청</span>
      </span>
      <LineTable
        headers={['수주 품목', '매수']}
        editable={editable}
        pending={pending}
        emptyText="품목이 없어요. 고객사를 고르고 품목을 추가해 주세요"
        onAdd={() => onChange({ ...form, items: [...form.items, emptyShipmentLine()] })}
        rows={form.items.map((line, index) => {
          const savedLabel = draft.payloadLabels[`items.${index}.salesOrderItemId`];
          const listed = options.some((o) => o.salesOrderItemId === line.salesOrderItemId);
          return (
            <tr key={index}>
              <Td className={cn(CELL, 'text-ink-3 tabular-nums')}>{index + 1}</Td>
              <Td className={CELL}>
                {editable ? (
                  <Select
                    aria-label={lineFieldLabel(index, '수주 품목')}
                    className="w-full min-w-64"
                    value={line.salesOrderItemId ?? ''}
                    disabled={pending || form.customerId === null}
                    onChange={(e) => setLine(index, { salesOrderItemId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">{form.customerId === null ? '고객사를 먼저 골라 주세요' : '수주 품목을 골라 주세요'}</option>
                    {line.salesOrderItemId !== null && !listed ? <option value={line.salesOrderItemId}>{savedLabel ?? `수주 품목 ${line.salesOrderItemId}`} (출하 가능 없음)</option> : null}
                    {options.map((o) => (
                      <option key={o.salesOrderItemId} value={o.salesOrderItemId}>
                        {o.salesOrderNo} #{o.lineNo} {o.itemCode} · 출하 가능 {o.shippableQty}매
                      </option>
                    ))}
                  </Select>
                ) : (
                  <ReadValue text={savedLabel} />
                )}
                <UnresolvedMark show={isUnresolved(lineFieldLabel(index, '수주 품목'), lineChanged(index, 'salesOrderItemId'))} />
              </Td>
              <Td className={CELL}>
                {editable ? (
                  <Input aria-label={lineFieldLabel(index, '매수')} numeric suffix="매" inputMode="numeric" className="w-28" value={line.requestQty} disabled={pending} onChange={(e) => setLine(index, { requestQty: e.target.value })} />
                ) : (
                  <ReadValue text={line.requestQty ? `${line.requestQty}매` : null} />
                )}
                <UnresolvedMark show={isUnresolved(lineFieldLabel(index, '매수'), lineChanged(index, 'requestQty'))} />
              </Td>
              {editable ? <RemoveLineButton index={index} pending={pending} onRemove={() => onChange({ ...form, items: form.items.filter((_, i) => i !== index) })} /> : null}
            </tr>
          );
        })}
      />
    </div>
  );
}

// ── 배정 확정 ───────────────────────────────────────

function AllocationFields({ ctx, form, onChange, onRecommend, dirty }: { ctx: FieldContext; form: AllocationForm; onChange: (form: AllocationForm) => void; onRecommend: (shipmentRequestItemId: number) => void; dirty: boolean }) {
  const { draft, editable, pending, isUnresolved } = ctx;
  const [shipmentRequestId, setShipmentRequestId] = useState<number | null>(null);
  const requests = useShipmentRequestList();
  const detail = useShipmentRequestDetail(editable ? shipmentRequestId : null);
  const savedId = (buildTypedForm('ALLOCATION_CONFIRM', draft.payload) as AllocationForm).shipmentRequestItemId;
  const lotIds = 'lotIds' in draft.payload ? draft.payload.lotIds : [];
  const lotsChosenBy = 'lotIds' in draft.payload ? draft.payload.lotsChosenBy : null;
  const openRequests = (requests.data ?? []).filter((r) => OPEN_SHIPMENT_REQUEST.includes(r.shipmentRequestStatus));

  return (
    <FieldTable>
      <FieldRow label="출하요청 품목" required unresolved={isUnresolved('출하요청 품목', form.shipmentRequestItemId !== savedId)} hint="배정 대기·배정 확정 상태의 출하요청">
        <div className="flex flex-col gap-1.5">
          <ReadValue text={form.shipmentRequestItemId === savedId ? draft.payloadLabels.shipmentRequestItemId : '새로 고른 품목 (저장하면 LOT을 다시 추천해요)'} />
          {editable ? (
            <div className="flex flex-col gap-2">
              <Select aria-label="출하요청" className="w-full min-w-60 max-w-96" value={shipmentRequestId ?? ''} disabled={pending || requests.isPending} onChange={(e) => setShipmentRequestId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">바꾸려면 출하요청을 골라 주세요</option>
                {openRequests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.shipmentRequestNo} · {r.customerName} · 배정 대기 {r.waitingAllocationQty}매
                  </option>
                ))}
              </Select>
              {shipmentRequestId !== null ? (
                <Select
                  aria-label="출하요청 품목"
                  className="w-full min-w-60 max-w-96"
                  value={form.shipmentRequestItemId ?? ''}
                  disabled={pending || detail.isPending}
                  onChange={(e) => onChange({ ...form, shipmentRequestItemId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">품목을 골라 주세요</option>
                  {(detail.data?.lines ?? []).map((l) => (
                    <option key={l.shipmentRequestItemId} value={l.shipmentRequestItemId}>
                      #{l.lineNo} {l.itemCode} · 요청 {l.requestQty}매 · 배정 대기 {l.waitingAllocationQty}매
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
          ) : null}
        </div>
      </FieldRow>
      <FieldRow label="배정 LOT" required unresolved={isUnresolved('배정 LOT', form.shipmentRequestItemId !== savedId)} hint="AI가 고르지 않아요 · 생산완료일이 오래된 순(FIFO) 추천">
        <div className="flex flex-col gap-1.5">
          <ReadValue text={lotIds.length > 0 ? `${lotIds.length}개${lotsChosenBy === 'PERSON' ? ' (사람이 고름)' : ''} · ${draft.payloadLabels.lotIds ?? ''}` : null} />
          {editable && savedId !== null && !dirty ? (
            <Button size="sm" variant="ghost" icon="refresh" className="self-start" disabled={pending} onClick={() => onRecommend(savedId)}>
              추천 다시 받기
            </Button>
          ) : null}
        </div>
      </FieldRow>
    </FieldTable>
  );
}

// ── 재생산 계획 생성 ────────────────────────────────

function ReproductionPlanFields({ ctx, form, onChange }: { ctx: FieldContext; form: ReproductionPlanForm; onChange: (form: ReproductionPlanForm) => void }) {
  const { draft, editable, pending, isUnresolved } = ctx;
  const [salesOrderId, setSalesOrderId] = useState<number | null>(null);
  const salesOrders = useSalesOrderList();
  const detail = useSalesOrderDetail(editable ? salesOrderId : null);
  const savedId = (buildTypedForm('REPRODUCTION_PLAN_CREATE', draft.payload) as ReproductionPlanForm).salesOrderItemId;
  const openOrders = (salesOrders.data ?? []).filter((o) => OPEN_SALES_ORDER_ITEM.includes(o.status));

  return (
    <FieldTable>
      <FieldRow label="수주 품목" required unresolved={isUnresolved('수주 품목', form.salesOrderItemId !== savedId)} hint="진행 중인 수주 품목 · 재생산 매수는 실행 때 다시 계산">
        <div className="flex flex-col gap-1.5">
          <ReadValue text={form.salesOrderItemId === savedId ? draft.payloadLabels.salesOrderItemId : '새로 고른 수주 품목'} />
          {editable ? (
            <div className="flex flex-col gap-2">
              <Select aria-label="수주" className="w-full min-w-60 max-w-96" value={salesOrderId ?? ''} disabled={pending || salesOrders.isPending} onChange={(e) => setSalesOrderId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">바꾸려면 수주를 골라 주세요</option>
                {openOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.salesOrderNo} · {o.customerName}
                    {o.hasReproductionNeed ? ' · 재생산 필요' : ''}
                  </option>
                ))}
              </Select>
              {salesOrderId !== null ? (
                <Select aria-label="수주 품목" className="w-full min-w-60 max-w-96" value={form.salesOrderItemId ?? ''} disabled={pending || detail.isPending} onChange={(e) => onChange({ ...form, salesOrderItemId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">품목을 골라 주세요</option>
                  {(detail.data?.items ?? [])
                    .filter((i) => OPEN_SALES_ORDER_ITEM.includes(i.salesOrderItemStatus))
                    .map((i) => (
                      <option key={i.salesOrderItemId} value={i.salesOrderItemId}>
                        #{i.lineNo} {i.itemCode} · 주문 {i.orderedQty}매
                      </option>
                    ))}
                </Select>
              ) : null}
            </div>
          ) : null}
        </div>
      </FieldRow>
    </FieldTable>
  );
}

function TypedLockHint({ draft, canUse, typeLabel }: { draft: DraftDetailView; canUse: boolean; typeLabel: string }) {
  const name = draft.requester.employeeName;
  const status = draft.draftStatus;
  const guide = ACTION_TYPE_GUIDE[draft.actionType];
  if (draft.isRequester && !canUse && guide && status !== 'EXECUTED' && status !== 'REJECTED') return <ReadOnlyHint permissions={[guide.permission]} />;
  const text =
    status === 'AI_GENERATED' || status === 'WAITING_APPROVAL'
      ? `${name}님이 만든 초안이에요. 고치고 확정·반려하는 것은 ${name}님만 할 수 있어요`
      : status === 'APPROVED'
        ? `${name}님이 확정했어요 · ${typeLabel} 실행 대기`
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
