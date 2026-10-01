'use client';

// 열연 투입 배정 화면의 창: 배정 변경(사유 필수, 해제 + 새 배정 한 번에) · 배정 해제 · 열연 실적 등록
import { useState } from 'react';
import { rollingApi, type RollingAllocationView, type RollingCandidate, type RollingDetail } from '@/api/rolling';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { Table, Td, Th } from '@/components/Table';
import { dateTimeLocalHoursAgo, fromDateTimeLocal } from '@/features/production/lib/dateTimeLocal';
import { fieldErrorsOf } from '@/features/production/lib/formErrors';
import { useAction } from '@/hooks/useAction';
import { fmtDateTime, fmtTon } from '@/lib/format';
import { calcWeightTon } from '@/lib/weight';

export function ChangeAllocationModal({ allocation, candidates, onClose }: { allocation: RollingAllocationView; candidates: readonly RollingCandidate[]; onClose: () => void }) {
  const [newLotId, setNewLotId] = useState<number | null>(candidates[0]?.lotId ?? null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const change = useAction(rollingApi.change, {
    success: `${allocation.lotNo} 배정을 바꿨어요`,
    onSuccess: onClose,
    onError: (e) => setErrors(fieldErrorsOf(e)),
  });
  const submit = () => {
    if (!reason.trim()) {
      setErrors({ reasonText: '배정을 바꾸는 사유를 입력해 주세요' });
      return;
    }
    if (newLotId === null) {
      setErrors({ newLotId: '바꿀 슬래브를 골라 주세요' });
      return;
    }
    change.mutate({ allocationId: allocation.allocationId, newLotId, reasonText: reason });
  };
  return (
    <Modal
      title={`배정 변경 · ${allocation.lotNo}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onClose} disabled={change.isPending}>
            닫기
          </Button>
          <Button variant="primary" onClick={submit} disabled={change.isPending || candidates.length === 0}>
            {change.isPending ? '바꾸는 중…' : '배정 변경'}
          </Button>
        </>
      }
    >
      <span className="text-sm leading-5 text-ink-2">지금 배정을 해제하고 고른 슬래브를 새로 배정해요. 두 가지를 한 번에 처리하고, 사유는 작업 로그에 &lsquo;배정 변경&rsquo;으로 남아요.</span>
      <Field label="새 슬래브" required error={errors.newLotId}>
        <Select value={newLotId ?? ''} onChange={(e) => setNewLotId(Number(e.target.value))} invalid={!!errors.newLotId}>
          {candidates.length === 0 ? <option value="">바꿀 수 있는 슬래브가 없어요</option> : null}
          {candidates.map((c) => (
            <option key={c.lotId} value={c.lotId}>
              {c.fifoRank}. {c.lotNo} · {c.producedDate}
              {c.surplusAt ? ' · 여재' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="사유" required hint="500자 이내" error={errors.reasonText}>
        <Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="예: 야드 위치 때문에 가까운 슬래브로 바꿈" invalid={!!errors.reasonText} />
      </Field>
    </Modal>
  );
}

export function ReleaseAllocationModal({ allocation, onClose }: { allocation: RollingAllocationView; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const release = useAction(rollingApi.release, { success: `${allocation.lotNo} 배정을 해제했어요`, onSuccess: onClose });
  return (
    <Modal
      title={`배정 해제 · ${allocation.lotNo}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose} disabled={release.isPending}>
            닫기
          </Button>
          <Button variant="danger" onClick={() => release.mutate({ allocationId: allocation.allocationId, reasonText: reason })} disabled={release.isPending}>
            {release.isPending ? '해제하는 중…' : '배정 해제'}
          </Button>
        </>
      }
    >
      <span className="text-sm leading-5 text-ink-2">해제한 슬래브는 다시 미배정 합격 슬래브(여재·가용재고)가 돼요.</span>
      <Field label="사유" hint="작업 로그에 남아요 (선택, 500자 이내)">
        <Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function HotRollingModal({ detail, onClose }: { detail: RollingDetail; onClose: () => void }) {
  const plan = detail.plan;
  const rollable = plan.allocations.filter((a) => detail.rollableAllocationIds.includes(a.allocationId));
  const [selected, setSelected] = useState<number[]>(rollable.map((a) => a.allocationId));
  const [startedText, setStartedText] = useState(() => dateTimeLocalHoursAgo(2));
  const [completedText, setCompletedText] = useState(() => dateTimeLocalHoursAgo(0));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const register = useAction(rollingApi.registerHotRolling, {
    success: (r) => `열연 실적을 등록했어요 · 코일 ${r.coilLotNos.length}개`,
    onSuccess: onClose,
    onError: (e) => setErrors(fieldErrorsOf(e)),
  });
  const toggle = (id: number) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const submit = () => {
    if (selected.length === 0) {
      setErrors({ allocationIds: '열연할 슬래브를 1매 이상 골라 주세요' });
      return;
    }
    register.mutate({
      productionPlanId: plan.productionPlanId,
      allocationIds: selected.length === rollable.length ? null : selected,
      startedAt: fromDateTimeLocal(startedText),
      completedAt: fromDateTimeLocal(completedText),
    });
  };
  return (
    <Modal
      title={`열연 실적 등록 · ${plan.productionPlanNo}`}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button onClick={onClose} disabled={register.isPending}>
            닫기
          </Button>
          <Button variant="primary" onClick={submit} disabled={register.isPending || rollable.length === 0}>
            {register.isPending ? '등록하는 중…' : `열연 실적 등록 (${selected.length}매 → 코일 ${selected.length}개)`}
          </Button>
        </>
      }
    >
      <span className="text-cap text-ink-3">
        배정 확정한 슬래브를 투입(소진)하고 슬래브 1매마다 코일 1개를 만들어요. 코일 LOT = C + 슬래브번호(HT- 제외), 코일 규격 {plan.coilItem.itemCode}, 코일 검사 대상. 열연 수율은
        고정이에요.
      </span>
      {errors.allocationIds ? <Banner tone="danger">{errors.allocationIds}</Banner> : null}
      {errors.productionPlanId ? <Banner tone="danger">{errors.productionPlanId}</Banner> : null}
      {rollable.length === 0 ? (
        <Banner tone="wait">열연할 수 있는 배정 슬래브가 없어요. 먼저 FIFO 추천에서 배정을 확정해 주세요.</Banner>
      ) : (
        <Table compact>
          <thead>
            <tr>
              <Th>선택</Th>
              <Th>슬래브 LOT</Th>
              <Th>히트</Th>
              <Th>배정 확정</Th>
              <Th>코일 LOT (예정)</Th>
            </tr>
          </thead>
          <tbody>
            {rollable.map((a) => (
              <tr key={a.allocationId}>
                <Td>
                  <input type="checkbox" checked={selected.includes(a.allocationId)} onChange={() => toggle(a.allocationId)} aria-label={`${a.lotNo} 선택`} />
                </Td>
                <Td className="font-mono text-mono">{a.lotNo}</Td>
                <Td className="font-mono text-mono text-ink-2">{a.heatLotNo ?? '-'}</Td>
                <Td>{fmtDateTime(a.confirmedAt)}</Td>
                <Td className="font-mono text-mono text-ink-3">C{a.lotNo.replace(/^HT-/, '')}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <span className="text-xs text-ink-2">
        투입 슬래브 {selected.length}매 · {fmtTon(calcWeightTon(selected.length, plan.slabItem.unitWeightTon))} → 코일 {selected.length}개 ·{' '}
        {fmtTon(calcWeightTon(selected.length, plan.coilItem.unitWeightTon))} (계산값)
      </span>
      <div className="grid grid-cols-2 gap-3">
        <Field label="작업 시작 일시" required error={errors.startedAt}>
          <Input type="datetime-local" value={startedText} onChange={(e) => setStartedText(e.target.value)} invalid={!!errors.startedAt} />
        </Field>
        <Field label="작업 완료 일시" required error={errors.completedAt}>
          <Input type="datetime-local" value={completedText} onChange={(e) => setCompletedText(e.target.value)} invalid={!!errors.completedAt} />
        </Field>
      </div>
    </Modal>
  );
}
