'use client';

// 수주 등록 /sales-orders/new (REQ-SO-001~003, BP-SO-01, 보고서 1 A-2 + C 수정):
// 고객사 + 품목 줄(규격은 등록된 슬래브·코일만, 매수 정수, 납기는 품목마다) → 저장하면 재고 우선 예약 + 부족 매수 생산계획(히트 편성).
// 비고 없음(ERD에 칸 없음). 톤은 매수 × 1매 이론중량 계산값이고 저장하지 않는다.
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ApiError, InputError } from '@/api/client';
import type { ProductSpecView } from '@/api/lookups';
import { salesOrderApi, type SalesOrderPreviewLine } from '@/api/salesOrders';
import { ITEM_TYPE_LABEL, PERMISSION, type ProductItemType } from '@/codes';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { IconButton } from '@/components/IconButton';
import { Input, Select } from '@/components/Input';
import { Kpi } from '@/components/Kpi';
import { PageMain } from '@/components/Page';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { StateView } from '@/components/StateView';
import { Steps } from '@/components/Steps';
import { Table, Td, Th } from '@/components/Table';
import { Tag } from '@/components/Tag';
import { useAction } from '@/hooks/useAction';
import { useCustomerList, useProductSpecList } from '@/hooks/useLookups';
import { useMe } from '@/hooks/useMe';
import { useCanUse } from '@/hooks/usePermission';
import { useSalesOrderPreview } from '@/hooks/useSalesOrders';
import { fmtDims, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';
import { calcWeightTon, sumTon } from '@/lib/weight';
import { errorMessageOf } from '@/stores/useToastStore';
import {
  draftLineErrors,
  hasLineErrors,
  parseOrderedQty,
  previewLinesOf,
  qtyUnitOf,
  type DraftLine,
} from '@/features/sales/lib/salesOrderForm';

let lineSeq = 0;
const newLine = (from?: DraftLine): DraftLine => {
  lineSeq += 1;
  return { key: `line-${lineSeq}`, itemType: from?.itemType ?? 'SLAB', steelGradeId: from?.steelGradeId ?? null, itemId: null, qtyText: '', dueDate: '' };
};

interface LineRowProps {
  index: number;
  line: DraftLine;
  specs: readonly ProductSpecView[];
  submitted: boolean;
  serverDueError: string | undefined;
  preview: SalesOrderPreviewLine | undefined;
  canRemove: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}

function LineRow({ index, line, specs, submitted, serverDueError, preview, canRemove, onChange, onRemove }: LineRowProps) {
  const errors = draftLineErrors(line, submitted);
  const unit = qtyUnitOf([line.itemType]);
  const ofType = specs.filter((s) => s.itemType === line.itemType);
  const grades = [...new Map(ofType.map((s) => [s.steelGradeId, s.steelGradeCode])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const choices = ofType.filter((s) => line.steelGradeId === null || s.steelGradeId === line.steelGradeId);
  const spec = specs.find((s) => s.id === line.itemId);
  const qty = parseOrderedQty(line.qtyText);
  const id = `so-line-${line.key}`;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-surface px-3 py-3">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs bg-surface-3 px-1 text-cap font-semibold text-ink-2">{index + 1}</span>
        <Select
          aria-label={`${index + 1}번째 품목 유형`}
          className="w-[84px]"
          value={line.itemType}
          onChange={(event) => onChange({ itemType: event.target.value as ProductItemType, steelGradeId: null, itemId: null })}
        >
          <option value="SLAB">{ITEM_TYPE_LABEL.SLAB}</option>
          <option value="COIL">{ITEM_TYPE_LABEL.COIL}</option>
        </Select>
        <Select
          aria-label={`${index + 1}번째 강종`}
          className="w-[104px]"
          value={line.steelGradeId ?? ''}
          onChange={(event) => onChange({ steelGradeId: event.target.value === '' ? null : Number(event.target.value), itemId: null })}
        >
          <option value="">강종 전체</option>
          {grades.map(([gradeId, code]) => (
            <option key={gradeId} value={gradeId}>
              {code}
            </option>
          ))}
        </Select>
        <IconButton icon="trash" label={`${index + 1}번째 품목 빼기`} size="sm" className="ml-auto" disabled={!canRemove} onClick={onRemove} />
      </div>
      <Field label="규격" required error={errors.itemId} htmlFor={`${id}-spec`}>
        <Select
          id={`${id}-spec`}
          invalid={Boolean(errors.itemId)}
          value={line.itemId ?? ''}
          onChange={(event) => {
            const itemId = event.target.value === '' ? null : Number(event.target.value);
            const picked = specs.find((s) => s.id === itemId);
            onChange({ itemId, steelGradeId: picked ? picked.steelGradeId : line.steelGradeId });
          }}
        >
          <option value="">{choices.length === 0 ? '등록된 규격이 없어요' : '규격 선택'}</option>
          {choices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.steelGradeCode} {fmtDims(s.thicknessMm, s.widthMm, s.lengthMm)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2">
        <Field
          label="매수"
          required
          htmlFor={`${id}-qty`}
          error={errors.qty}
          hint={qty !== null && spec ? `= ${qty}${unit} · ${fmtTon(calcWeightTon(qty, spec.theoreticalWeightTon))} (계산값)` : '정수로 입력해요 · 톤은 자동 계산'}
        >
          <Input
            id={`${id}-qty`}
            inputMode="numeric"
            numeric
            suffix={unit}
            placeholder="0"
            invalid={Boolean(errors.qty)}
            value={line.qtyText}
            onChange={(event) => onChange({ qtyText: event.target.value })}
          />
        </Field>
        <Field label="납기" required htmlFor={`${id}-due`} error={errors.dueDate ?? serverDueError}>
          <DateInput id={`${id}-due`} value={line.dueDate} invalid={Boolean(errors.dueDate ?? serverDueError)} onChange={(dueDate) => onChange({ dueDate })} />
        </Field>
      </div>
      <span className="text-cap text-ink-3">
        {spec ? (
          <>
            <span className="font-mono">{spec.itemCode}</span> · 1{unit} {fmtTon(spec.theoreticalWeightTon)}
            {preview ? (
              <>
                {' '}
                · 예약 가용 {preview.availableQty}
                {unit} → 재고에서 {preview.reserveQty}
                {unit} 예약
                {preview.shortageQty > 0 ? (
                  <b className="font-semibold text-wait">
                    {' '}
                    · 부족 {preview.shortageQty}
                    {unit} → 생산계획 (예상)
                  </b>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          '규격을 고르면 1매 이론중량과 예약 가용을 보여 줘요'
        )}
      </span>
    </li>
  );
}

export function SalesOrderCreateScreen() {
  const router = useRouter();
  const me = useMe();
  const canCreate = useCanUse(PERMISSION.SALES_ORDER_CREATE);
  const customers = useCustomerList();
  const specs = useProductSpecList();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const previewTargets = useMemo(() => previewLinesOf(lines), [lines]);
  const previewInput = useMemo(() => previewTargets.map(({ itemId, orderedQty }) => ({ itemId, orderedQty })), [previewTargets]);
  const preview = useSalesOrderPreview(previewInput);
  const previewByLine = new Map<number, SalesOrderPreviewLine>();
  previewTargets.forEach((target, i) => {
    const row = preview.data?.[i];
    if (row && row.itemId === target.itemId) previewByLine.set(target.index, row);
  });

  const itemTypes = lines.map((l) => l.itemType);
  const unit = qtyUnitOf(itemTypes);
  const create = useAction(salesOrderApi.create, {
    success: (r) =>
      `${r.salesOrderNo} 수주를 등록했어요 · 재고 예약 ${r.reservedQty}${unit}` +
      (r.shortageQty > 0 ? ` · 부족 ${r.shortageQty}${unit} → 생산계획 ${r.productionPlanNos.length}건` : ' · 생산계획은 필요 없어요'),
    onSuccess: (r) => router.push(`/sales-orders/${r.salesOrderId}`),
    onError: (error) => {
      setServerFieldErrors(error instanceof InputError ? error.fieldErrors : {});
      setServerError(error instanceof ApiError || error instanceof InputError ? errorMessageOf(error) : '저장하지 못했어요');
    },
  });

  const updateLine = (index: number, patch: Partial<DraftLine>) => setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const lineErrorCount = lines.filter((line) => hasLineErrors(draftLineErrors(line, true))).length;
  const validQtyLines = lines.flatMap((line) => {
    const qty = parseOrderedQty(line.qtyText);
    const spec = specs.data?.find((s) => s.id === line.itemId);
    return qty !== null && spec ? [{ qty, ton: calcWeightTon(qty, spec.theoreticalWeightTon) }] : [];
  });
  const totalQty = validQtyLines.reduce((sum, l) => sum + l.qty, 0);
  const totalTon = sumTon(validQtyLines.map((l) => l.ton));
  const previewRows = preview.data ?? [];
  const reserveTotal = previewRows.reduce((sum, r) => sum + r.reserveQty, 0);
  const shortageTotal = previewRows.reduce((sum, r) => sum + r.shortageQty, 0);
  const planCount = previewRows.filter((r) => r.shortageQty > 0).length;
  const customerName = customers.data?.find((c) => c.id === customerId)?.customerName ?? null;

  const save = () => {
    setSubmitted(true);
    setServerError(null);
    setServerFieldErrors({});
    if (customerId === null || lineErrorCount > 0) return;
    create.mutate({
      customerId,
      items: lines.map((line) => ({ itemId: line.itemId ?? 0, orderedQty: line.qtyText, dueDate: line.dueDate })),
    });
  };

  if (customers.isPending || specs.isPending) return <StateView kind="loading" title="고객사·규격을 불러오는 중…" />;
  if (customers.error || specs.error) return <StateView kind="error" text="고객사·규격 목록을 불러오지 못했어요" />;
  const specList = specs.data ?? [];

  const statusCaption =
    customerId === null
      ? '기본 정보를 확인해 주세요'
      : lineErrorCount > 0
        ? `${lineErrorCount}행 확인 후 저장`
        : `합계 ${totalQty.toLocaleString('en-US')}${unit} · ${fmtTon(totalTon)} (계산값)`;

  return (
    <>
      <section className="flex w-[440px] flex-none flex-col border-r border-line bg-surface-2">
        <header className="flex flex-none items-center gap-2 border-b border-line bg-surface px-4 py-3">
          <h1 className="text-lg font-semibold">수주 입력</h1>
          <span className="text-cap text-ink-3">1 · 2단계</span>
          <ButtonLink size="sm" variant="ghost" className="ml-auto" href="/sales-orders">
            목록
          </ButtonLink>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
          <div className="flex flex-col gap-3">
            <b className="text-sm font-semibold">1 기본 정보</b>
            <Field label="고객사" required htmlFor="so-customer" error={submitted && customerId === null ? '고객사를 선택해 주세요' : serverFieldErrors.customerId}>
              <Select
                id="so-customer"
                invalid={submitted && customerId === null}
                value={customerId ?? ''}
                onChange={(event) => setCustomerId(event.target.value === '' ? null : Number(event.target.value))}
              >
                <option value="">고객사 선택</option>
                {(customers.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.customerName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="담당" hint="등록한 사원이 담당이 돼요">
              <Input readOnly value={`${me.employeeName} · ${me.departmentName}`} />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <b className="text-sm font-semibold">2 품목</b>
              <Tag>{lines.length}행</Tag>
              {new Set(itemTypes).size > 1 ? <Tag tone="run">코일·슬래브 혼합</Tag> : null}
            </div>
            {serverFieldErrors.items ? <span className="text-cap text-danger">{serverFieldErrors.items}</span> : null}
            <ol className="flex flex-col gap-2">
              {lines.map((line, index) => (
                <LineRow
                  key={line.key}
                  index={index}
                  line={line}
                  specs={specList}
                  submitted={submitted}
                  serverDueError={serverFieldErrors[`items.${index}.dueDate`]}
                  preview={previewByLine.get(index)}
                  canRemove={lines.length > 1}
                  onChange={(patch) => updateLine(index, patch)}
                  onRemove={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                />
              ))}
            </ol>
            <Button size="sm" icon="plus" onClick={() => setLines((prev) => [...prev, newLine(prev[prev.length - 1])])}>
              품목 행 추가
            </Button>
            <span className="text-cap text-ink-3">매수는 정수로 입력해요 (슬래브 매 · 코일 개) · 톤은 매수 × 1매 이론중량 계산값이고 저장하지 않아요</span>
          </div>
        </div>
        <footer className="flex flex-none flex-col gap-2 border-t border-line bg-surface px-4 py-3">
          {serverError ? (
            <span role="alert" className="text-cap text-danger">
              {serverError}
            </span>
          ) : null}
          {canCreate ? null : <ReadOnlyHint permissions={[PERMISSION.SALES_ORDER_CREATE]} />}
          <div className="flex items-center gap-2">
            <span className="text-cap text-ink-3">{statusCaption}</span>
            <ButtonLink size="md" className="ml-auto" href="/sales-orders">
              취소
            </ButtonLink>
            <Button
              variant="primary"
              disabled={!canCreate || create.isPending}
              title={canCreate ? undefined : permissionNeedText([PERMISSION.SALES_ORDER_CREATE])}
              onClick={save}
            >
              {create.isPending ? '저장 중…' : '저장'}
            </Button>
          </div>
        </footer>
      </section>

      <PageMain>
        <Steps
          items={[
            { key: 'basic', label: '1 · 기본 정보', state: customerId !== null ? 'done' : 'run' },
            {
              key: 'items',
              label: `2 · 품목 (${lines.length}행 입력 · ${lineErrorCount}행 확인 필요)`,
              state: lineErrorCount === 0 ? 'done' : customerId !== null ? 'run' : 'todo',
            },
            { key: 'save', label: '3 · 저장·예약 결과', state: 'todo' },
          ]}
        />
        <Banner tone="run">
          아래는 지금 예약 가용으로 본 <b>미리보기</b>예요. 저장하는 순간의 재고로 다시 계산해요.
        </Banner>
        <div className="grid grid-cols-3 gap-3">
          <Kpi
            label="수주 합계"
            value={totalQty.toLocaleString('en-US')}
            unit={unit}
            sub={`${fmtTon(totalTon)} (계산값) · 품목 ${lines.length} · ${customerName ?? '고객사 미선택'}`}
          />
          <Kpi label="재고 예약 (예상)" value={reserveTotal.toLocaleString('en-US')} unit={unit} sub="합격 재고 우선 · LOT은 정하지 않아요" />
          <Kpi label="부족 매수 (예상)" value={shortageTotal.toLocaleString('en-US')} unit={unit} sub={planCount > 0 ? `생산계획 ${planCount}건 · 히트 편성까지 계산해요` : '생산계획이 필요 없어요'} />
        </div>

        <Card>
          <CardHead title="품목별 예약 미리보기" meta="매수 기준 · 저장 전" />
          {preview.error ? (
            <div className="px-4 py-3">
              <Banner tone="danger">{errorMessageOf(preview.error)}</Banner>
            </div>
          ) : null}
          <div className="overflow-auto">
            <Table>
              <thead>
                <tr>
                  <Th>품목</Th>
                  <Th align="right">수주 매수</Th>
                  <Th align="right">예약 가용</Th>
                  <Th align="right">예약</Th>
                  <Th align="right">부족 매수</Th>
                  <Th>부족분 히트 편성 (예상)</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const spec = specList.find((s) => s.id === line.itemId);
                  const row = previewByLine.get(index);
                  const lineUnit = qtyUnitOf([line.itemType]);
                  const f = row?.formation ?? null;
                  return (
                    <tr key={line.key}>
                      <Td>
                        <span className="flex flex-col">
                          <span className="font-medium">
                            {index + 1}. {spec ? spec.itemName : `${ITEM_TYPE_LABEL[line.itemType]} · 규격 미선택`}
                          </span>
                          {spec ? <span className="font-mono text-[11px] text-ink-3">{spec.itemCode}</span> : null}
                        </span>
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {parseOrderedQty(line.qtyText) ?? '-'}
                        {parseOrderedQty(line.qtyText) !== null ? lineUnit : ''}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {row ? `${row.availableQty}${lineUnit}` : '-'}
                      </Td>
                      <Td align="right" className="font-semibold text-run tabular-nums">
                        {row ? `${row.reserveQty}${lineUnit}` : '-'}
                      </Td>
                      <Td align="right" className="font-semibold text-wait tabular-nums">
                        {row ? `${row.shortageQty}${lineUnit}` : '-'}
                      </Td>
                      <Td className="text-xs text-ink-2">
                        {!row ? (
                          <Tag>{line.itemId === null ? '규격 선택 필요' : '매수 확인 필요'}</Tag>
                        ) : f ? (
                          <span className="tabular-nums">
                            히트 {f.heatCount}개 · 히트 톤 {fmtTon(f.heatTon)} · 필요 용강량 {fmtTon(f.requiredSteelTon)} · 예상 여재 {f.expectedSurplusSlabQty}매
                          </span>
                        ) : (
                          '재고로 모두 예약해요'
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <div className="flex items-center gap-2 border-t border-line bg-surface-2 px-4 py-2.5 text-cap text-ink-2">
            <Tag>시스템</Tag>
            저장하면 합격·가용 재고를 매수 단위로 먼저 예약하고(부분 예약 허용), 부족 매수만 품목 라우팅대로 생산계획을 만들어요.
          </div>
        </Card>

        <Card>
          <CardHead title="저장하면 이렇게 돼요" />
          <CardBody>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
              <li>수주 번호(SO-YYMM-NNN)를 매기고 품목별 납기와 함께 저장해요. 담당은 {me.employeeName} 님이에요.</li>
              <li>품목마다 예약 가용만큼 재고를 예약해요 (주체: 시스템).</li>
              <li>부족 매수는 생산계획을 만들고 히트 수·히트 톤·필요 용강량을 계산해요. 슬래브는 제선→제강→연주, 코일은 열연까지.</li>
              <li>작업 로그에 수주 등록·예약·생산계획 생성이 남고, 수주 상세 화면으로 이동해요.</li>
            </ol>
          </CardBody>
        </Card>
      </PageMain>
    </>
  );
}
