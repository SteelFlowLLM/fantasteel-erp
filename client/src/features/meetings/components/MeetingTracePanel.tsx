'use client';

// AI 실행 기록 (Voice2ERP). 모델이 단계마다 낸 답 원문·생각 글과 서버가 버리거나 고친 항목을 접어 둔다.
// 후보가 왜 빠졌는지, 어떤 모델이 얼마나 걸렸는지 사람이 직접 따라가 보게 하려는 것이라 기본은 접혀 있다.
import type { MeetingAnalysisTrace, MeetingTraceStep } from '@fantasteel/shared';
import { Badge } from '@/components/Badge';
import { formatDuration, TRACE_STAGE_LABEL, traceSummaryText } from '@/lib/meetingAnalysis';

const SUMMARY = 'cursor-pointer select-none text-xs font-medium text-ink-2 hover:text-ai-strong';
const PRE = 'max-h-64 overflow-auto rounded-xs bg-surface-2 px-2 py-1.5 font-mono text-cap whitespace-pre-wrap break-words text-ink-2';

function Step({ step }: { step: MeetingTraceStep }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-xs border border-line bg-surface px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <b className="text-sm">{TRACE_STAGE_LABEL[step.stage]}</b>
        <span className="font-mono text-ink-3">{step.model}</span>
        <span className="text-ink-3">{formatDuration(step.durationMs)}</span>
        {step.ok ? null : <Badge tone="danger">실패</Badge>}
      </div>
      {step.error ? <p className="text-xs text-danger">{step.error}</p> : null}
      {step.changes.length > 0 ? (
        <ul aria-label="서버가 버리거나 고친 것" className="flex flex-col gap-0.5 text-xs">
          {step.changes.map((change, index) => (
            <li key={index} className="flex flex-wrap items-baseline gap-x-1.5">
              <span className={change.action === 'DROPPED' ? 'font-medium text-[#7a3d00]' : 'font-medium text-ink-2'}>{change.action === 'DROPPED' ? '버림' : '고침'}</span>
              {change.title ? <span className="break-words">“{change.title}”</span> : null}
              <span className="text-ink-3">— {change.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-3">서버가 버리거나 고친 항목이 없어요</p>
      )}
      {step.rawAnswer ? (
        <details>
          <summary className={SUMMARY}>모델이 낸 답 원문</summary>
          <pre className={PRE}>{step.rawAnswer}</pre>
        </details>
      ) : null}
      {step.thinking ? (
        <details>
          <summary className={SUMMARY}>모델의 생각 글</summary>
          <p className="my-1 text-cap text-ink-3">모델이 스스로 쓴 설명이라 실제 판단과 다를 수 있어요</p>
          <pre className={PRE}>{step.thinking}</pre>
        </details>
      ) : null}
      {step.truncated ? <p className="text-cap text-ink-3">글이 길어 앞부분만 저장했어요</p> : null}
    </li>
  );
}

export function MeetingTracePanel({ trace }: { trace: MeetingAnalysisTrace | undefined }) {
  if (!trace) return null;
  return (
    <details className="rounded-xs border border-ai-line bg-ai-bg px-2.5 py-2">
      <summary className={SUMMARY}>
        AI가 한 일 보기 <span className="font-normal text-ink-3">· {traceSummaryText(trace)}</span>
      </summary>
      <ol className="mt-2 flex flex-col gap-2">
        {trace.steps.map((step) => (
          <Step key={step.stage} step={step} />
        ))}
      </ol>
    </details>
  );
}
