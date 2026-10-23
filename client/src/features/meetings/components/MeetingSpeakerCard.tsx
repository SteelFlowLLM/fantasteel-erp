'use client';

// 화자 연결 카드: 음성 전사에서 나뉜 화자 이름표(화자 1, 화자 2 …)를 회의 참석자에게 이어 준다.
// 연결하면 AI가 "누가 말했는지" 알고 정리한다. 작성자만, 확정 전에만 (Voice2ERP 화자 분리).
// 'AI로 추정'은 선택 칸만 채운다: 저장은 작성자가 확인하고 누른다 (이슈 #406).
import { speakerLabelText, type MeetingMinutesView, type MeetingSpeakerMappingInput, type MeetingSpeakerSuggestResult } from '@fantasteel/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { meetingMinutesApi } from '@/api/meetingMinutes';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Select } from '@/components/Input';
import { useAction } from '@/hooks/useAction';
import { cn } from '@/lib/cn';
import { toast } from '@/stores/useToastStore';
import { applySpeakerSuggestions, duplicatePickedIds, initialSpeakerSelection, speakerMappingToSave, speakerOrder, SPEAKER_TONE_CLASSES } from '@/lib/meetingSpeakers';

export function MeetingSpeakerCard({ minutes }: { minutes: MeetingMinutesView }) {
  const [selection, setSelection] = useState<Record<string, string>>(() => initialSpeakerSelection(minutes.speakers));
  const save = useAction((v: { id: number; input: MeetingSpeakerMappingInput }) => meetingMinutesApi.updateSpeakers(v.id, v.input), { success: '화자를 연결했어요' });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [suggestFailure, setSuggestFailure] = useState<string | null>(null);
  // 저장하지 않는 조회라 useAction(모든 조회 무효화)을 쓰지 않는다
  const suggest = useMutation({
    mutationFn: (id: number) => meetingMinutesApi.suggestSpeakers(id),
    onMutate: () => setSuggestFailure(null),
    onSuccess: (result: MeetingSpeakerSuggestResult) => {
      if (result.failureReason) {
        setSuggestFailure(result.failureReason);
        return;
      }
      setSelection((prev) => applySpeakerSuggestions(prev, result.suggestions));
      setReasons(Object.fromEntries(result.suggestions.map((s) => [s.label, s.reason])));
      const found = result.suggestions.filter((s) => s.employeeId !== null).length;
      if (found > 0) toast.ok(`AI가 화자 ${found}명을 추정했어요. 확인하고 저장해 주세요`);
      else toast.info('AI가 확실한 화자를 찾지 못했어요. 직접 골라 주세요');
    },
    onError: (error) => toast.apiError(error),
  });
  const busy = save.isPending || suggest.isPending;
  const order = speakerOrder(minutes.transcriptSegments);
  const toSave = speakerMappingToSave(minutes.speakers, selection);
  const duplicated = duplicatePickedIds(selection);

  return (
    <Card>
      <CardHead
        title="화자 연결"
        meta={`화자 ${minutes.speakers.length}명 · 누가 말했는지 알려 주세요`}
        actions={
          <Button size="sm" variant="ai" disabled={busy} title="자기소개·호칭·부서 이야기로 누가 말했는지 짐작해 칸을 채워요. 저장은 확인하고 눌러 주세요" onClick={() => suggest.mutate(minutes.id)}>
            {suggest.isPending ? 'AI가 추정하는 중…' : 'AI로 추정'}
          </Button>
        }
      />
      <CardBody className="gap-3">
        <p className="text-cap text-ink-3">음성에서 목소리로 나눈 결과예요. 참석자에게 이어 주면 AI가 누가 말했는지 알고 정리해요. 모르면 &quot;모름&quot;으로 두세요.</p>
        <ul className="flex flex-col gap-2.5">
          {minutes.speakers.map((speaker) => (
            <li key={speaker.label} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-start sm:gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn('inline-flex h-5 items-center rounded-xs px-1.5 text-cap font-semibold', SPEAKER_TONE_CLASSES[(order.get(speaker.label) ?? 0) % SPEAKER_TONE_CLASSES.length])}>{speakerLabelText(speaker.label)}</span>
                  <span className="text-cap text-ink-3">발언 {speaker.segmentCount}개</span>
                </div>
                {speaker.firstTexts.map((text, index) => (
                  <q key={index} className="line-clamp-2 text-xs text-ink-2">
                    {text}
                  </q>
                ))}
                {reasons[speaker.label] ? <p className="text-cap text-ai-strong">AI: {reasons[speaker.label]}</p> : null}
              </div>
              <Select
                aria-label={`${speakerLabelText(speaker.label)} 연결`}
                value={selection[speaker.label] ?? ''}
                disabled={busy}
                onChange={(event) => setSelection((prev) => ({ ...prev, [speaker.label]: event.target.value }))}
              >
                <option value="">모름</option>
                {minutes.attendees.map((attendee) => (
                  <option key={attendee.employeeId} value={attendee.employeeId}>
                    {attendee.employeeName}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
        {suggestFailure ? (
          <p role="alert" className="text-cap text-danger">
            AI로 추정하지 못했어요: {suggestFailure}
          </p>
        ) : null}
        {duplicated.length > 0 ? <p className="text-cap text-wait">같은 사람을 두 화자에 골랐어요. 목소리가 둘로 나뉜 거라면 그대로 두어도 돼요.</p> : null}
        <div className="flex justify-end">
          <Button size="sm" variant="primary" disabled={toSave === null || busy} onClick={() => toSave && save.mutate({ id: minutes.id, input: { mapping: toSave } })}>
            저장
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
