'use client';

// 사례 수정 (이슈 #464): 등록과 같은 항목을 고친다. 번호·등록자·등록 시각·관련 LOT은 그대로다.
// 수정은 작업 로그 유형이 없어 작업 로그에 남지 않는다 (docs/backend/past-case.md). 불러온 뒤 다른 사람이 고쳤으면 서버가 거절한다 (COM-001).
import type { PastCaseView } from '@fantasteel/shared';
import { useState } from 'react';
import { pastCaseApi, pastCaseKeys } from '@/api/pastCases';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { PastCaseFormFields } from '@/features/pastCases/PastCaseFormFields';
import { formOfCase, lotIdsOf, missingFieldsOf, type PastCaseForm } from '@/features/pastCases/pastCaseForm';
import { useAction } from '@/hooks/useAction';

export function PastCaseEditModal({ item, onClose }: { item: PastCaseView; onClose: () => void }) {
  const [form, setForm] = useState<PastCaseForm>(() => formOfCase(item));
  const save = useAction((input: PastCaseForm) => pastCaseApi.update(item.id, { ...input, lotIds: lotIdsOf(item), expectedUpdatedAt: item.updatedAt }), {
    success: (saved) => `${saved.caseNo}를 고쳤어요`,
    invalidate: [pastCaseKeys.all],
    onSuccess: onClose,
  });
  const set = <K extends keyof PastCaseForm>(key: K, value: PastCaseForm[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const missing = missingFieldsOf(form);

  return (
    <Modal
      title={`사례 수정 · ${item.caseNo}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={missing.length > 0 || save.isPending} title={missing.length ? `${missing.join('·')}을(를) 입력해 주세요` : undefined} onClick={() => save.mutate(form)}>
            {save.isPending ? '저장하는 중…' : '수정 저장'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <PastCaseFormFields form={form} lotNos={item.lots.map((lot) => lot.lotNo).join(', ')} onChange={set} />
      </div>
    </Modal>
  );
}
