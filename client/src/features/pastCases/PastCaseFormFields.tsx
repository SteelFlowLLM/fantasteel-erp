'use client';

// 사례 등록·수정 창이 같이 쓰는 입력칸 (REQ-CASE-001 항목).
import { PAST_CASE_CATEGORY, type PastCaseCategory } from '@fantasteel/shared';
import { Field } from '@/components/Field';
import { Input, Select, Textarea } from '@/components/Input';
import { CASE_CATEGORY_LABEL } from '@/codes';
import type { PastCaseForm } from '@/features/pastCases/pastCaseForm';
import { todayStr } from '@/lib/format';

export function PastCaseFormFields({ form, lotNos, onChange }: { form: PastCaseForm; lotNos: string; onChange: <K extends keyof PastCaseForm>(key: K, value: PastCaseForm[K]) => void }) {
  return (
    <>
      <div className="grid grid-cols-[160px_1fr_160px] gap-3">
        <Field label="구분" required>
          <Select value={form.caseCategory} onChange={(e) => onChange('caseCategory', e.target.value as PastCaseCategory)}>
            {Object.values(PAST_CASE_CATEGORY).map((c) => (
              <option key={c} value={c}>
                {CASE_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="제목" required>
          <Input value={form.title} maxLength={200} onChange={(e) => onChange('title', e.target.value)} />
        </Field>
        <Field label="발생일" required>
          <Input type="date" value={form.occurredDate} max={todayStr()} onChange={(e) => onChange('occurredDate', e.target.value)} />
        </Field>
      </div>
      <Field label="현상" required>
        <Textarea rows={3} maxLength={2000} value={form.phenomenon} onChange={(e) => onChange('phenomenon', e.target.value)} />
      </Field>
      <Field label="원인" hint="모르면 비워 두고 나중에 확인한 내용을 새 사례로 남겨요">
        <Textarea rows={2} maxLength={2000} value={form.cause} onChange={(e) => onChange('cause', e.target.value)} />
      </Field>
      <Field label="조치">
        <Textarea rows={2} maxLength={2000} value={form.actionTaken} onChange={(e) => onChange('actionTaken', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="관련 설비" hint="설비 마스터 없이 텍스트로 적어요 (예: 1번 전로)">
          <Input value={form.equipmentText} maxLength={200} onChange={(e) => onChange('equipmentText', e.target.value)} />
        </Field>
        <Field label="관련 LOT">
          <Input value={lotNos} readOnly className="font-mono" />
        </Field>
      </div>
    </>
  );
}
