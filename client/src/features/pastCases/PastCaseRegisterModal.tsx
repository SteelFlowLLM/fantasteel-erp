'use client';

// 사례로 등록 (REQ-CASE-002, BP-CASE-01, API-269·270): 불합격 LOT으로 AI가 초안을 쓰고, 품질 담당이 고쳐서 저장한다.
// AI가 실패하면 서버가 검사 결과로 채운 초안과 이유를 준다(오류 아님). 저장하면 과거 사례 화면에서 그 사례를 연다.
import { PAST_CASE_CATEGORY, type CreatePastCaseInput, type PastCaseCategory, type PastCaseDraftView } from '@fantasteel/shared';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { pastCaseApi, pastCaseKeys } from '@/api/pastCases';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { StateView } from '@/components/StateView';
import { CASE_CATEGORY_LABEL } from '@/codes';
import { useAction } from '@/hooks/useAction';
import { todayStr } from '@/lib/format';
import { errorMessageOf } from '@/stores/useToastStore';

type Form = Omit<CreatePastCaseInput, 'lotIds'>;

const formOf = (draft: PastCaseDraftView): Form => ({
  caseCategory: draft.caseCategory,
  title: draft.title,
  phenomenon: draft.phenomenon,
  cause: draft.cause,
  actionTaken: draft.actionTaken,
  equipmentText: draft.equipmentText,
  occurredDate: draft.occurredDate,
});

export function PastCaseRegisterModal({ lotId, lotNo, onClose }: { lotId: number; lotNo: string; onClose: () => void }) {
  const router = useRouter();
  const draft = useMutation({ mutationFn: pastCaseApi.createDraft });
  const [form, setForm] = useState<Form | null>(null);
  const save = useAction(pastCaseApi.create, {
    success: (created) => `${created.caseNo}로 과거 사례에 등록했어요`,
    invalidate: [pastCaseKeys.all],
    onSuccess: (created) => {
      onClose();
      router.push(`/past-cases?q=${encodeURIComponent(created.caseNo)}`);
    },
  });

  // 창을 열면 한 번 초안을 받는다 (LOT이 바뀌면 다시). AI 초안은 최대 1분이라 개발 모드의 effect 두 번 실행에도 한 번만 부른다
  const { mutate } = draft;
  const requested = useRef<number | null>(null);
  useEffect(() => {
    if (requested.current === lotId) return;
    requested.current = lotId;
    setForm(null);
    mutate(lotId, { onSuccess: (data) => setForm(formOf(data)) });
  }, [lotId, mutate]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  const missing = form ? [!form.title.trim() && '제목', !form.phenomenon.trim() && '현상', !form.occurredDate && '발생일'].filter(Boolean) : [];
  const canSave = form !== null && missing.length === 0 && !save.isPending;

  return (
    <Modal
      title={`사례로 등록 · ${lotNo}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={!canSave} title={missing.length ? `${missing.join('·')}을(를) 입력해 주세요` : undefined} onClick={() => form && save.mutate({ ...form, lotIds: [lotId] })}>
            {save.isPending ? '저장하는 중…' : '사례로 저장'}
          </Button>
        </>
      }
    >
      {draft.isPending ? (
        <StateView kind="loading" title="AI가 사례 초안을 쓰고 있어요" text="검사 결과와 비슷한 과거 사례를 읽고 써요. 최대 1분 걸릴 수 있어요." />
      ) : draft.error ? (
        <StateView kind="error" title="초안을 만들지 못했어요" text={errorMessageOf(draft.error)} />
      ) : form && draft.data ? (
        <div className="flex flex-col gap-3">
          {draft.data.aiWritten ? (
            <Banner tone="run">AI가 쓴 초안이에요. 숫자와 원인·조치를 확인하고 고쳐서 저장해 주세요.</Banner>
          ) : (
            <Banner tone="wait">{draft.data.aiNotice ?? '검사 결과로 초안을 채웠어요.'} 원인·조치를 채워서 저장해 주세요.</Banner>
          )}
          {draft.data.referenceCaseNos.length ? <span className="text-cap text-ink-3">참고한 비슷한 사례 · {draft.data.referenceCaseNos.join(', ')}</span> : null}
          <div className="grid grid-cols-[160px_1fr_160px] gap-3">
            <Field label="구분" required>
              <Select value={form.caseCategory} onChange={(e) => set('caseCategory', e.target.value as PastCaseCategory)}>
                {Object.values(PAST_CASE_CATEGORY).map((c) => (
                  <option key={c} value={c}>
                    {CASE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="제목" required>
              <Input value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="발생일" required>
              <Input type="date" value={form.occurredDate} max={todayStr()} onChange={(e) => set('occurredDate', e.target.value)} />
            </Field>
          </div>
          <Field label="현상" required>
            <Textarea rows={3} maxLength={2000} value={form.phenomenon} onChange={(e) => set('phenomenon', e.target.value)} />
          </Field>
          <Field label="원인" hint="모르면 비워 두고 나중에 확인한 내용을 새 사례로 남겨요">
            <Textarea rows={2} maxLength={2000} value={form.cause} onChange={(e) => set('cause', e.target.value)} />
          </Field>
          <Field label="조치">
            <Textarea rows={2} maxLength={2000} value={form.actionTaken} onChange={(e) => set('actionTaken', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="관련 설비" hint="설비 마스터 없이 텍스트로 적어요 (예: 1번 전로)">
              <Input value={form.equipmentText} maxLength={200} onChange={(e) => set('equipmentText', e.target.value)} />
            </Field>
            <Field label="관련 LOT">
              <Input value={lotNo} readOnly className="font-mono" />
            </Field>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
