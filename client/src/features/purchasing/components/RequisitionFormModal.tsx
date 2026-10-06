'use client';

// 구매요청 등록·다시 요청 창 (REQ-PUR-001, BP-PUR-01). 등록하면 바로 승인 대기가 되고 소속 부서장에게 승인 요청이 간다.
// 임시 저장·'작성 중'은 없다(공통 코드 정의서). 반려된 요청은 요청자가 고쳐 다시 요청한다(10장 REJECTED → WAITING_APPROVAL).
// 입력: 원료 1품목 · 수량(톤, 소수 3자리) (ERD: 구매요청 1건 = 원료 1품목), 희망 입고일, 요청 근거. 요청자·부서는 자동(요청한 사원·요청 시점 소속).
import { useState, type ReactNode } from 'react';
import { ApiError, InputError } from '@/api/client';
import type { RequisitionView } from '@/api/purchasing';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { Tag } from '@/components/Tag';
import { useItemList } from '@/hooks/useLookups';
import { useCreatePurchaseRequisition, usePurchaseRequisitionFormContext, useResubmitPurchaseRequisition } from '@/hooks/usePurchaseRequisitions';
import { withEulReul } from '@/lib/josa';
import { errorMessageOf } from '@/stores/useToastStore';

export interface RequisitionFormValues {
  itemId: number | null;
  /** 입력 글자 그대로 */
  requestedTon: string;
  /** MRP에서 온 요청: 근거 생산계획 */
  productionPlanId: number | null;
  productionPlanNo: string | null;
  desiredReceiptDate: string;
  requestReason: string;
}

export interface RequisitionFormModalProps {
  mode: 'create' | 'resubmit';
  initial?: RequisitionFormValues;
  /** 다시 요청할 때: 대상 요청 */
  requisition?: { id: number; purchaseRequisitionNo: string; updatedAt: string; rejectReason: string | null };
  /** 창 위 안내 (예: MRP에서 채운 값) */
  notice?: ReactNode;
  onClose: () => void;
  onDone?: (view: RequisitionView) => void;
}

const REASON_MAX = 500;
const EMPTY_VALUES: RequisitionFormValues = { itemId: null, requestedTon: '', productionPlanId: null, productionPlanNo: null, desiredReceiptDate: '', requestReason: '' };

export function RequisitionFormModal({ mode, initial, requisition, notice, onClose, onDone }: RequisitionFormModalProps) {
  const [values, setValues] = useState<RequisitionFormValues>(() => initial ?? EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const materials = useItemList({ itemType: 'RAW_MATERIAL' });
  const context = usePurchaseRequisitionFormContext();
  const headName = context.data?.headName ?? null;

  const handleError = (error: unknown) => {
    if (error instanceof InputError) {
      setFieldErrors(error.fieldErrors);
      setFailure(Object.keys(error.fieldErrors).length === 0 ? error.message : null);
      return;
    }
    setFieldErrors({});
    setFailure(error instanceof ApiError && error.code === 'PUR-001' ? `승인권자(부서장)가 없어 등록하지 못했어요 · ${errorMessageOf(error)}` : errorMessageOf(error));
  };

  const create = useCreatePurchaseRequisition({
    success: (view) => `${withEulReul(view.purchaseRequisitionNo)} 등록했어요. ${headName ? `${headName} 부서장` : '부서장'} 승인을 기다려요`,
    onSuccess: (view) => {
      onDone?.(view);
      onClose();
    },
    onError: handleError,
  });
  const resubmit = useResubmitPurchaseRequisition({
    success: (view) => `${withEulReul(view.purchaseRequisitionNo)} 다시 요청했어요. ${headName ? `${headName} 부서장` : '부서장'} 승인을 기다려요`,
    onSuccess: (view) => {
      onDone?.(view);
      onClose();
    },
    onError: handleError,
  });
  const pending = create.isPending || resubmit.isPending;

  const submit = () => {
    if (values.itemId === null) {
      setFieldErrors({ itemId: '원료를 골라 주세요' });
      return;
    }
    setFieldErrors({});
    setFailure(null);
    const payload = {
      itemId: values.itemId,
      requestedTon: values.requestedTon.trim(),
      productionPlanId: values.productionPlanId,
      desiredReceiptDate: values.desiredReceiptDate,
      requestReason: values.requestReason,
    };
    if (mode === 'resubmit' && requisition) {
      resubmit.mutate({ ...payload, purchaseRequisitionId: requisition.id, expectedUpdatedAt: requisition.updatedAt });
    } else {
      create.mutate(payload);
    }
  };

  const materialRows = materials.data ?? [];
  const material = materialRows.find((m) => m.id === values.itemId);
  const lineError = [fieldErrors.itemId, fieldErrors.requestedTon].filter(Boolean).join(' · ');
  const noHead = context.data !== undefined && headName === null;

  return (
    <Modal
      title={mode === 'resubmit' && requisition ? `구매요청 고쳐 다시 요청 · ${requisition.purchaseRequisitionNo}` : '구매요청 등록'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <span className="mr-auto text-cap text-ink-3">
            {context.data
              ? headName
                ? `${mode === 'resubmit' ? '다시 요청하면' : '등록하면'} 바로 승인 대기가 되고 ${context.data.departmentName} 부서장 ${headName}님에게 승인 요청이 가요`
                : `${context.data.departmentName}에 부서장이 없어 승인 요청을 보낼 수 없어요`
              : null}
          </span>
          <Button onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending || materials.isPending}>
            {pending ? '처리하는 중…' : mode === 'resubmit' ? '다시 요청' : '등록'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {notice ? <Banner tone="run">{notice}</Banner> : null}
        {requisition?.rejectReason ? (
          <Banner tone="danger">
            <b>반려 사유</b> · {requisition.rejectReason}
          </Banner>
        ) : null}
        {noHead ? <Banner tone="danger">소속 부서에 승인권자(부서장)가 지정되지 않아 등록할 수 없어요 (PUR-001). 관리자에게 부서장 지정을 요청해 주세요.</Banner> : null}
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
        {materials.error ? <Banner tone="danger">원료 목록을 불러오지 못했어요 · {errorMessageOf(materials.error)}</Banner> : null}

        <Field
          label="원료 품목 · 수량(톤)"
          required
          htmlFor="pr-item"
          hint={mode === 'resubmit' ? '다시 요청할 때는 수량만 고칠 수 있어요. 다른 원료는 새로 요청해 주세요' : '구매요청 1건에 원료 1품목이에요. 여러 원료는 따로 요청해 주세요'}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Select
                id="pr-item"
                aria-label="원료"
                className="w-[240px]"
                value={values.itemId ?? ''}
                invalid={Boolean(fieldErrors.itemId)}
                disabled={materials.isPending || mode === 'resubmit'}
                onChange={(event) => setValues((current) => ({ ...current, itemId: event.target.value ? Number(event.target.value) : null }))}
              >
                <option value="">{materials.isPending ? '원료 목록을 불러오는 중…' : '원료를 골라 주세요'}</option>
                {materialRows.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.itemName} · {m.itemCode}
                  </option>
                ))}
              </Select>
              <Input
                aria-label="수량(톤)"
                className="w-[140px]"
                numeric
                inputMode="decimal"
                placeholder="0.000"
                suffix="t"
                value={values.requestedTon}
                invalid={Boolean(fieldErrors.requestedTon)}
                onChange={(event) => setValues((current) => ({ ...current, requestedTon: event.target.value }))}
              />
              {values.productionPlanNo ? (
                <Tag tone="neutral" size="md" title="MRP 근거 생산계획 (이 계획·원료로는 구매요청을 한 번만 만들어요)">
                  근거 {values.productionPlanNo}
                </Tag>
              ) : null}
            </div>
            {lineError ? (
              <span role="alert" className="text-cap text-danger">
                {lineError}
              </span>
            ) : material ? (
              <span className="text-cap text-ink-3">
                {material.defaultSupplierName ? `기본 공급업체 ${material.defaultSupplierName}` : '기본 공급업체가 지정되지 않았어요'} · 기본 야드 {material.defaultYardName}
              </span>
            ) : null}
          </div>
        </Field>

        <Field label="희망 입고일" required htmlFor="pr-desired-date" error={fieldErrors.desiredReceiptDate ?? null} hint="발주할 때 납기의 기본값이 돼요">
          <DateInput id="pr-desired-date" value={values.desiredReceiptDate} onChange={(value) => setValues((current) => ({ ...current, desiredReceiptDate: value }))} invalid={Boolean(fieldErrors.desiredReceiptDate)} />
        </Field>

        <Field
          label="요청 근거"
          htmlFor="pr-reason"
          error={fieldErrors.requestReason ?? null}
          hint={`어디에 쓰는지, 왜 필요한지 적어 주세요 · ${values.requestReason.length} / ${REASON_MAX}자`}
        >
          <Textarea
            id="pr-reason"
            rows={3}
            maxLength={REASON_MAX}
            value={values.requestReason}
            invalid={Boolean(fieldErrors.requestReason)}
            onChange={(event) => setValues((current) => ({ ...current, requestReason: event.target.value }))}
          />
        </Field>

        {context.data ? (
          <p className="text-cap text-ink-3">
            요청자 {context.data.requesterName} · {context.data.departmentName}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
