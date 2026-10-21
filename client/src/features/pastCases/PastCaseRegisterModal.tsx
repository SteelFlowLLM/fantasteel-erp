'use client';

// 사례로 등록 (REQ-CASE-002, BP-CASE-01, API-269·270): 불합격 LOT으로 AI가 초안을 쓰고, 품질 담당이 고쳐서 저장한다.
// AI가 실패하면 서버가 검사 결과로 채운 초안과 이유를 준다(오류 아님). 저장하면 과거 사례 화면에서 그 사례를 연다.
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { pastCaseApi, pastCaseKeys } from '@/api/pastCases';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { StateView } from '@/components/StateView';
import { PastCaseFormFields } from '@/features/pastCases/PastCaseFormFields';
import { formOfDraft, missingFieldsOf, type PastCaseForm } from '@/features/pastCases/pastCaseForm';
import { useAction } from '@/hooks/useAction';
import { errorMessageOf } from '@/stores/useToastStore';

export function PastCaseRegisterModal({ lotId, lotNo, onClose }: { lotId: number; lotNo: string; onClose: () => void }) {
  const router = useRouter();
  const draft = useMutation({ mutationFn: pastCaseApi.createDraft });
  const [form, setForm] = useState<PastCaseForm | null>(null);
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
    mutate(lotId, { onSuccess: (data) => setForm(formOfDraft(data)) });
  }, [lotId, mutate]);

  const set = <K extends keyof PastCaseForm>(key: K, value: PastCaseForm[K]) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  const missing = form ? missingFieldsOf(form) : [];
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
          <PastCaseFormFields form={form} lotNos={lotNo} onChange={set} />
        </div>
      ) : null}
    </Modal>
  );
}
