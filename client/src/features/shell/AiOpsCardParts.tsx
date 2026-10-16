'use client';

// 철강맨AI 실행 카드 중 수주 등록·열연 배정·히트 편성·과거 사례 카드의 내용과 편집기 (REQ-AST-005).
// 업무·일정·구매요청 카드는 회의록 후보 카드와 같은 부품(MeetingAnalysisPanel·CandidateEditor)을 쓴다.
import { ITEM_TYPE, PAST_CASE_CATEGORY_LABEL, type AiHeatPlanCard, type AiHotRollingCard, type AiPastCaseCard, type AiSalesOrderCard, type AiSalesOrderCardLine } from '@fantasteel/shared';
import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Input, Select, Textarea } from '@/components/Input';
import { Field as DisplayField } from '@/features/meetings/components/MeetingAnalysisPanel';
import { useCustomerList, useItemList } from '@/hooks/useLookups';
import { pastCaseIssues, salesOrderIssues } from '@/lib/aiActionCard';

// ── 수주 등록 ────────────────────────────────────────────

export function SalesOrderBody({ card }: { card: AiSalesOrderCard }) {
  return (
    <div className="flex flex-col gap-0.5">
      <DisplayField label="고객사">{card.customerName ?? <span className="text-ink-3">미정</span>}</DisplayField>
      {card.lines.length === 0 ? <DisplayField label="품목"><span className="text-ink-3">미정</span></DisplayField> : null}
      {card.lines.map((line, index) => (
        <DisplayField key={index} label={`품목 ${index + 1}`}>
          {line.itemLabel ?? <span className="text-ink-3">규격 미정</span>}
          <span className="text-ink-2"> · {line.orderedQty === null ? '매수 미정' : `${line.orderedQty}매`} · 납기 {line.dueDate ?? '미정'}</span>
        </DisplayField>
      ))}
    </div>
  );
}

export function SalesOrderEditor({ card, onCancel, onSave }: { card: AiSalesOrderCard; onCancel: () => void; onSave: (card: AiSalesOrderCard) => void }) {
  const customers = useCustomerList();
  const coils = useItemList({ itemType: ITEM_TYPE.COIL });
  const slabs = useItemList({ itemType: ITEM_TYPE.SLAB });
  const products = useMemo(() => [...(coils.data ?? []), ...(slabs.data ?? [])], [coils.data, slabs.data]);
  const [customerId, setCustomerId] = useState(card.customerId === null ? '' : String(card.customerId));
  const [lines, setLines] = useState<AiSalesOrderCardLine[]>(card.lines.length > 0 ? card.lines : [{ itemId: null, itemLabel: null, orderedQty: null, dueDate: null }]);
  const setLine = (index: number, patch: Partial<AiSalesOrderCardLine>) => setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const save = () => {
    const customer = (customers.data ?? []).find((c) => String(c.id) === customerId);
    const next: AiSalesOrderCard = {
      ...card,
      customerId: customer?.id ?? null,
      customerName: customer?.customerName ?? null,
      title: `수주 등록 · ${customer?.customerName ?? '고객사 미정'}`,
      lines: lines.map((line) => {
        const item = products.find((p) => p.id === line.itemId);
        return { ...line, itemLabel: item ? `${item.itemCode} · ${item.itemName}` : line.itemLabel };
      }),
      issues: [],
    };
    onSave({ ...next, issues: salesOrderIssues(next) });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xs border border-line-strong bg-surface p-3">
      <Field label="고객사" htmlFor={`${card.key}-customer`}>
        <Select id={`${card.key}-customer`} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">선택해 주세요</option>
          {(customers.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.customerName}
            </option>
          ))}
        </Select>
      </Field>
      {lines.map((line, index) => (
        <div key={index} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,2fr)_90px_150px_auto]">
          <Field label={`규격 ${index + 1}`} htmlFor={`${card.key}-item-${index}`}>
            <Select id={`${card.key}-item-${index}`} value={line.itemId === null ? '' : String(line.itemId)} onChange={(e) => setLine(index, { itemId: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">선택해 주세요</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.itemCode} · {p.itemName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="매수" htmlFor={`${card.key}-qty-${index}`}>
            <Input
              id={`${card.key}-qty-${index}`}
              numeric
              suffix="매"
              inputMode="numeric"
              value={line.orderedQty === null ? '' : String(line.orderedQty)}
              onChange={(e) => setLine(index, { orderedQty: /^\d+$/.test(e.target.value) ? Number(e.target.value) : null })}
            />
          </Field>
          <Field label="납기" htmlFor={`${card.key}-due-${index}`}>
            <DateInput id={`${card.key}-due-${index}`} value={line.dueDate ?? ''} onChange={(value) => setLine(index, { dueDate: value === '' ? null : value })} />
          </Field>
          <Button size="sm" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>
            줄 삭제
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap justify-between gap-1.5">
        <Button size="sm" disabled={lines.length >= 10} onClick={() => setLines((current) => [...current, { itemId: null, itemLabel: null, orderedQty: null, dueDate: null }])}>
          줄 추가
        </Button>
        <span className="flex gap-1.5">
          <Button size="sm" onClick={onCancel}>
            취소
          </Button>
          <Button size="sm" variant="primary" onClick={save}>
            저장
          </Button>
        </span>
      </div>
    </div>
  );
}

// ── 열연 배정 ────────────────────────────────────────────

export function HotRollingBody({ card }: { card: AiHotRollingCard }) {
  return (
    <div className="flex flex-col gap-0.5">
      <DisplayField label="생산계획">{card.productionPlanNo}</DisplayField>
      <DisplayField label="대응 슬래브">{card.itemLabel}</DisplayField>
      <DisplayField label="더 필요한 슬래브">
        {card.neededQty}매 <span className="text-ink-3">(가용 재고 {card.availableQty}매)</span>
      </DisplayField>
      <DisplayField label="추천 슬래브 (FIFO)">
        <ul className="flex flex-col gap-0.5">
          {card.lots.map((lot) => (
            <li key={lot.lotId}>
              {lot.lotNo}
              <span className="text-ink-3">
                {lot.producedDate ? ` · 생산 ${lot.producedDate}` : ''}
                {lot.heatNo ? ` · 히트 ${lot.heatNo}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </DisplayField>
    </div>
  );
}

// ── 히트 편성 ────────────────────────────────────────────

export function HeatPlanBody({ card }: { card: AiHeatPlanCard }) {
  return (
    <div className="flex flex-col gap-0.5">
      <DisplayField label="생산계획">{card.productionPlanNo}</DisplayField>
      <DisplayField label="규격">{card.itemLabel}</DisplayField>
      <DisplayField label="부족 매수">{card.shortageQty}매</DisplayField>
      <DisplayField label="히트 수">
        {card.currentHeatCount}개 → <b>{card.newHeatCount}개</b>
      </DisplayField>
      <DisplayField label="히트 톤 · 필요 용강">
        {card.heatTon} 톤 · {card.requiredMoltenSteelTon} 톤
      </DisplayField>
    </div>
  );
}

// ── 과거 사례 ────────────────────────────────────────────

export function PastCaseBody({ card }: { card: AiPastCaseCard }) {
  const empty = <span className="text-ink-3">없음</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <DisplayField label="관련 LOT">{card.lotNo}</DisplayField>
      <DisplayField label="구분">{PAST_CASE_CATEGORY_LABEL[card.caseCategory]}</DisplayField>
      <DisplayField label="발생일">{card.occurredDate}</DisplayField>
      <DisplayField label="현상">{card.phenomenon || empty}</DisplayField>
      <DisplayField label="원인">{card.cause || empty}</DisplayField>
      <DisplayField label="조치">{card.actionTaken || empty}</DisplayField>
      <DisplayField label="설비">{card.equipmentText || empty}</DisplayField>
      {card.referenceCaseNos.length > 0 ? <DisplayField label="참고 사례">{card.referenceCaseNos.join(', ')}</DisplayField> : null}
    </div>
  );
}

export function PastCaseEditor({ card, onCancel, onSave }: { card: AiPastCaseCard; onCancel: () => void; onSave: (card: AiPastCaseCard) => void }) {
  const [draft, setDraft] = useState(card);
  const set = <K extends keyof AiPastCaseCard>(key: K, value: AiPastCaseCard[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const titleError = draft.title.trim() === '' ? '제목을 입력해 주세요' : null;
  const id = (name: string) => `${card.key}-${name}`;
  return (
    <div className="flex flex-col gap-2.5 rounded-xs border border-line-strong bg-surface p-3">
      <Field label="제목" htmlFor={id('title')} error={titleError}>
        <Input id={id('title')} value={draft.title} maxLength={200} invalid={!!titleError} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Field label="구분" htmlFor={id('category')}>
          <Select id={id('category')} value={draft.caseCategory} onChange={(e) => set('caseCategory', e.target.value === 'EQUIPMENT' ? 'EQUIPMENT' : 'QUALITY')}>
            {Object.entries(PAST_CASE_CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="발생일" htmlFor={id('date')}>
          <DateInput id={id('date')} value={draft.occurredDate} onChange={(value) => set('occurredDate', value)} />
        </Field>
      </div>
      <Field label="현상" htmlFor={id('phenomenon')}>
        <Textarea id={id('phenomenon')} rows={2} maxLength={2000} value={draft.phenomenon} onChange={(e) => set('phenomenon', e.target.value)} />
      </Field>
      <Field label="원인" htmlFor={id('cause')}>
        <Textarea id={id('cause')} rows={2} maxLength={2000} value={draft.cause} onChange={(e) => set('cause', e.target.value)} />
      </Field>
      <Field label="조치" htmlFor={id('action')}>
        <Textarea id={id('action')} rows={2} maxLength={2000} value={draft.actionTaken} onChange={(e) => set('actionTaken', e.target.value)} />
      </Field>
      <Field label="설비" htmlFor={id('equipment')}>
        <Input id={id('equipment')} value={draft.equipmentText} maxLength={200} onChange={(e) => set('equipmentText', e.target.value)} />
      </Field>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" onClick={onCancel}>
          취소
        </Button>
        <Button size="sm" variant="primary" disabled={!!titleError} onClick={() => onSave({ ...draft, issues: pastCaseIssues(draft) })}>
          저장
        </Button>
      </div>
    </div>
  );
}
