'use client';

// 심층 조사 반복 (이슈 #521): 완료한 조사를 매일 또는 매주 고른 요일의 정한 시각(서울)에 같은 질문·계획으로 다시 조사한다.
// 차례마다 새 조사가 생기고 끝나면 알림이 간다. 반복이 만든 조사에서도 같은 반복(원래 조사의 것)을 바꾸거나 끈다.
import { AI_RESEARCH_LIMITS, AI_RESEARCH_WEEKDAY_LABEL, aiResearchScheduleText, type AiResearchRunView, type AiResearchScheduleRule } from '@fantasteel/shared';
import { useState } from 'react';
import { aiResearchApi } from '@/api/aiResearch';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { useAction } from '@/hooks/useAction';
import { fmtRunAt, nextRunPreview, scheduleDraftOf, scheduleDraftProblem, scheduleInputOf, toggleWeekday } from '@/lib/aiResearch';

/** 반복 걸기·바꾸기 창. 저장하면 다음 차례를 지금 뒤 첫 시각으로 다시 정한다 */
export function AiResearchScheduleModal({ run, onClose }: { run: AiResearchRunView; onClose: () => void }) {
  const [draft, setDraft] = useState<AiResearchScheduleRule>(() => scheduleDraftOf(run.schedule));
  const problem = scheduleDraftProblem(draft);
  const preview = nextRunPreview(draft);
  // 반복이 만든 조사에서 열어도 원래 조사의 반복을 바꾼다 (서버도 같게 본다)
  const targetId = run.schedule?.runId ?? run.id;
  const save = useAction(() => aiResearchApi.setSchedule(targetId, scheduleInputOf(draft)), {
    success: (saved) => `반복을 걸었어요 · ${aiResearchScheduleText(saved)}`,
    onSuccess: onClose,
  });
  const submit = () => {
    if (!problem && !save.isPending) save.mutate(undefined);
  };
  return (
    <Modal
      title={run.schedule?.enabled ? '반복 바꾸기' : '반복 조사 걸기'}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={problem !== null || save.isPending} aria-busy={save.isPending} onClick={submit}>
            {save.isPending ? '저장하는 중…' : '저장'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="text-sm text-ink-2">
          정한 시각이 되면 이 조사의 질문·계획으로 <b>새 조사</b>를 만들어 다시 조사해요. 계획 확인 없이 바로 시작하고, 끝나면 알림이 가요.
        </p>
        <Field label="반복" htmlFor="research-schedule-frequency">
          <Select id="research-schedule-frequency" value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value === 'WEEKLY' ? 'WEEKLY' : 'DAILY' })}>
            <option value="DAILY">매일</option>
            <option value="WEEKLY">매주 고른 요일</option>
          </Select>
        </Field>
        {draft.frequency === 'WEEKLY' ? (
          <div role="group" aria-label="요일" className="flex flex-wrap gap-1.5">
            {AI_RESEARCH_WEEKDAY_LABEL.map((label, index) => (
              <Chip key={label} on={draft.weekdays.includes(index + 1)} onClick={() => setDraft({ ...draft, weekdays: toggleWeekday(draft.weekdays, index + 1) })}>
                {label}
              </Chip>
            ))}
          </div>
        ) : null}
        <Field label="실행 시각 (서울)" htmlFor="research-schedule-time" error={problem}>
          <Input id="research-schedule-time" type="time" step={60} value={draft.time} invalid={problem !== null} onChange={(event) => setDraft({ ...draft, time: event.target.value })} />
        </Field>
        <p className="text-cap text-ink-3">
          {preview ? `다음 실행: ${preview}` : '규칙을 고르면 다음 실행 시각을 보여 드려요'} · 켜 둘 수 있는 반복은 {AI_RESEARCH_LIMITS.maxSchedulesPerEmployee}개까지예요. 앞 반복 조사가 끝나지 않았거나 진행 중인 조사가 {AI_RESEARCH_LIMITS.activeRunsPerEmployee}개면 그 차례는 건너뛰어요.
        </p>
      </form>
    </Modal>
  );
}

/** 조사의 반복 상태 (반복이 있을 때만): 규칙·다음 실행·마지막 실행·건너뛴 이유, [바꾸기]·[끄기]·[다시 켜기] */
export function AiResearchScheduleBanner({ run, onEdit }: { run: AiResearchRunView; onEdit: () => void }) {
  const { set } = useUrlParams();
  const schedule = run.schedule;
  const disable = useAction(() => aiResearchApi.disableSchedule(schedule?.runId ?? run.id), { success: '반복을 껐어요' });
  if (!schedule) return null;
  const fromOther = schedule.runId !== run.id;
  const goTo = (id: number) => set({ id, new: null });
  return (
    <Banner
      tone={schedule.enabled ? 'run' : 'neutral'}
      icon="refresh"
      actions={
        schedule.enabled ? (
          <>
            <Button size="sm" icon="edit" onClick={onEdit}>
              바꾸기
            </Button>
            <Button size="sm" variant="danger-outline" disabled={disable.isPending} onClick={() => disable.mutate(undefined)}>
              끄기
            </Button>
          </>
        ) : (
          <Button size="sm" icon="refresh" onClick={onEdit}>
            다시 켜기
          </Button>
        )
      }
    >
      <b>
        {schedule.enabled ? '반복 조사' : '반복 꺼짐'} · {aiResearchScheduleText(schedule)}
      </b>
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-cap">
        {schedule.nextRunAt ? <span>다음 실행 {fmtRunAt(schedule.nextRunAt)}</span> : null}
        {schedule.lastRunAt ? <span>마지막 차례 {fmtRunAt(schedule.lastRunAt)}</span> : null}
        {schedule.lastRunId && schedule.lastRunId !== run.id ? (
          <button type="button" className="text-run hover:underline" onClick={() => goTo(schedule.lastRunId ?? run.id)}>
            마지막으로 만든 조사 #{schedule.lastRunId} 보기
          </button>
        ) : null}
        {fromOther ? (
          <button type="button" className="text-run hover:underline" onClick={() => goTo(schedule.runId)}>
            반복을 건 조사 #{schedule.runId} 보기
          </button>
        ) : null}
      </div>
      {schedule.lastSkipReason ? <div className="mt-0.5 text-cap text-wait">지난 차례: {schedule.lastSkipReason}</div> : null}
    </Banner>
  );
}
