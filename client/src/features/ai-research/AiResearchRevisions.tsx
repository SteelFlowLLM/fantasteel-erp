'use client';

// 보고서를 말로 고치기 (이슈 #418): 판 고르기, 대화처럼 보이는 고치기 기록, 부탁 칸("필요하면 더 검색" 기본 켬).
// 부탁을 보내면 서버가 조사를 다시 줄에 세워 고친 보고서를 다음 판으로 남긴다. 처음 고칠 때 그때 보고서가 1판이 된다.
import { AI_RESEARCH_LIMITS, type AiResearchRunView } from '@fantasteel/shared';
import { useState, type KeyboardEvent } from 'react';
import { aiResearchApi } from '@/api/aiResearch';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Textarea } from '@/components/Input';
import { useAction } from '@/hooks/useAction';
import { revisionBlockReason, revisionTurns, versionLabel } from '@/lib/aiResearch';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';

/** 판 고르기 (판이 있을 때만). selected는 보고 있는 판 */
export function AiResearchVersionPicker({ run, selected, onSelect }: { run: AiResearchRunView; selected: number; onSelect: (version: number) => void }) {
  if (run.versions.length === 0) return null;
  const latest = run.versions[run.versions.length - 1].version;
  return (
    <div role="group" aria-label="보고서 판" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-cap font-semibold text-ink-2">보고서 판</span>
      {run.versions.map((v) => (
        <button
          key={v.version}
          type="button"
          aria-pressed={v.version === selected}
          title={v.instruction ?? versionLabel(v)}
          onClick={() => onSelect(v.version)}
          className={cn(
            'h-7 rounded-sm border px-2.5 text-xs font-medium',
            v.version === selected ? 'border-brand bg-brand-tint text-brand' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2',
          )}
        >
          {v.version}판{v.version === latest ? ' · 최신' : ''}
        </button>
      ))}
    </div>
  );
}

export function AiResearchRevisions({ run, onSelect }: { run: AiResearchRunView; onSelect: (version: number) => void }) {
  const [instruction, setInstruction] = useState('');
  const [search, setSearch] = useState(true);
  const blockReason = revisionBlockReason(run);
  const turns = revisionTurns(run);
  const revise = useAction(() => aiResearchApi.revise(run.id, instruction, search), {
    success: '보고서 고치기를 시작했어요',
    onSuccess: () => setInstruction(''),
  });
  const text = instruction.trim();
  const disabled = blockReason !== null || revise.isPending;
  const submit = () => {
    if (text && !disabled) revise.mutate(undefined);
  };
  // Enter로 보내고 Shift+Enter는 줄바꿈 (한글 조합 중 Enter는 보내지 않는다)
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <Card className="flex-none">
      <CardHead title="보고서 고치기" meta={run.versions.length ? `${run.versions.length}/${AI_RESEARCH_LIMITS.maxReportVersions}판` : '고치면 판으로 남아요'} />
      <CardBody className="gap-3">
        {turns.length ? (
          <ol aria-label="고치기 기록" className="flex flex-col gap-2">
            {turns.map((turn) => (
              <li key={turn.version} className="flex flex-col gap-1">
                {turn.instruction !== null ? (
                  <div className="ml-auto max-w-[85%] rounded-md bg-brand-tint px-3 py-2 text-sm whitespace-pre-line break-words text-ink">
                    {turn.instruction}
                    <div className="mt-1 text-cap text-ink-3">
                      {turn.search ? '필요하면 더 검색' : '검색 없이'}
                      {turn.at ? ` · ${fmtDateTime(turn.at)}` : ''}
                    </div>
                  </div>
                ) : null}
                <div className="mr-auto flex items-center gap-2 text-cap text-ink-2">
                  {turn.pending ? (
                    <Badge tone="run">{turn.version}판을 쓰는 중…</Badge>
                  ) : (
                    <>
                      <Badge tone={turn.instruction === null ? 'neutral' : 'ai'}>{versionLabel(turn)}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => onSelect(turn.version)}>
                        이 판 보기
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        <Field label="어떻게 고칠까요?" htmlFor="research-revision-instruction" hint="부탁한 곳만 고치고 나머지는 그대로 둬요. 고친 보고서는 새 판으로 남고 앞 판도 다시 볼 수 있어요">
          <Textarea
            id="research-revision-instruction"
            rows={2}
            value={instruction}
            maxLength={AI_RESEARCH_LIMITS.instructionMax}
            placeholder="예: 3장 근거가 약해, 더 찾아서 고쳐 줘"
            disabled={disabled}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={onKey}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-sm text-ink-2">
            <input type="checkbox" checked={search} disabled={disabled} onChange={(event) => setSearch(event.target.checked)} />
            필요하면 더 검색
          </label>
          <Button size="sm" variant="ai-outline" icon="edit" disabled={!text || disabled} aria-busy={revise.isPending} onClick={submit}>
            {revise.isPending ? '보내는 중…' : '고치기'}
          </Button>
          <span className="text-cap text-ink-3 tabular-nums">
            {instruction.length}/{AI_RESEARCH_LIMITS.instructionMax}자{search ? ` · 최대 ${AI_RESEARCH_LIMITS.revisionSteps}단계 더 찾아요` : ' · 모은 출처로만 다시 써요'}
          </span>
        </div>
        {blockReason ? <p className="text-cap text-ink-3">{blockReason}</p> : null}
      </CardBody>
    </Card>
  );
}
