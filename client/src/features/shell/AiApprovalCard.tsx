'use client';

// 철강맨AI 승인 카드 (이슈 #362). 쓰기 도구를 쓰기 전에 무엇을 하는지 보이고 사용자가 허용·거부한다. 카드는 고칠 수 없다.
// 카드의 상태는 서버 이벤트로만 바뀐다: 버튼을 눌러도 approval_resolved가 올 때까지 '보내는 중'으로 둔다.
import { useEffect, useState } from 'react';
import { buttonClass, Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { ScreenLink } from '@/features/shell/ScreenLink';
import { decideAiApproval } from '@/hooks/useAiAssistant';
import { aiApprovalCountdownText, aiApprovalResolutionText, isInternalLinkPath, type AiApprovalCard } from '@/lib/aiApproval';
import { useShellStore } from '@/stores/useShellStore';

/** 고르는 동안 남은 시간을 1초마다 다시 센다 */
function useCountdownNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

const BOX = 'flex flex-col gap-2 rounded-md border bg-surface-2 px-3 py-2.5 text-sm';

function Details({ card }: { card: AiApprovalCard }) {
  if (card.details.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
      {card.details.map((detail, index) => (
        <div key={index} className="contents">
          <dt className="text-ink-3">{detail.label}</dt>
          <dd className="break-words whitespace-pre-wrap text-ink">{detail.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Execution({ card }: { card: AiApprovalCard }) {
  const closePanel = useShellStore((state) => state.closeAiPanel);
  const { execution } = card;
  if (execution === null) {
    if (card.interrupted) {
      return <p className="text-xs text-ink-2">연결이 끊겨 실행 결과를 받지 못했어요. 만들어졌는지는 해당 화면에서 확인해 주세요.</p>;
    }
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-ink-2">
        <Icon name="clock" size="sm" className="text-ink-3" />
        실행하고 있어요…
      </p>
    );
  }
  if (execution.status === 'FAILED') {
    return (
      <div role="alert" className="flex flex-col gap-0.5 rounded-sm border border-danger bg-danger-bg px-2.5 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
          <Icon name="alert" size="sm" />
          실행하지 못했어요
        </span>
        <span className="break-words text-ink-2">{execution.message}</span>
        <span className="text-cap text-ink-3">{execution.attempts > 1 ? `${execution.attempts}번 시도했어요. ` : ''}자동으로 다시 실행하지 않아요. 원인을 확인하고 다시 요청해 주세요.</span>
      </div>
    );
  }
  const result = execution.result;
  return (
    <div role="status" className="flex flex-col gap-1.5 rounded-sm border border-ok bg-ok-bg px-2.5 py-2 text-xs">
      <span className="inline-flex items-start gap-1.5 font-semibold text-ok">
        <Icon name="check-circle" size="sm" className="mt-px flex-none" />
        <span className="min-w-0 break-words">{execution.message}</span>
      </span>
      {result ? (
        <>
          <span className="break-words text-ink-2">{result.label}</span>
          {isInternalLinkPath(result.linkPath) ? (
            <ScreenLink
              href={result.linkPath}
              className={buttonClass({ size: 'sm', className: 'self-start' })}
              textClassName="text-ink-3"
              onClick={closePanel}
            >
              <Icon name="arrow-right" />
              열어서 보기
            </ScreenLink>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** 답 안의 승인 카드 하나: 고르는 중 → 허용됨/거부됨/시간이 지나 거부됨 → (허용이면) 실행 결과 */
export function AiApprovalCardView({ card }: { card: AiApprovalCard }) {
  const choosing = card.resolution === null;
  const now = useCountdownNow(choosing);
  const sending = card.sending !== null;
  const allowed = card.resolution === 'ALLOW';
  const border = choosing ? 'border-steelman' : !allowed ? 'border-line-strong' : card.execution?.status === 'FAILED' ? 'border-danger' : 'border-line-strong';

  return (
    // 남은 시간이 1초마다 바뀌므로 위쪽 aria-live(진행 상황)에 읽히지 않게 끈다. 끝난 이유·실행 결과(role=status/alert)만 알린다
    <div role="group" aria-label={`승인 요청: ${card.title}`} aria-live="off" className={`${BOX} ${border}`}>
      <div className="flex items-start gap-1.5">
        <Icon name={choosing ? 'lock' : allowed ? 'check-circle' : 'x-circle'} size="sm" className={`mt-0.5 flex-none ${choosing ? 'text-steelman-ink' : 'text-ink-3'}`} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-cap text-ink-3">{choosing ? '허용하면 이 일을 해요' : '승인 요청'}</span>
          <b className="font-semibold break-words">{card.title}</b>
        </div>
      </div>
      <Details card={card} />
      {card.resolution === null ? (
        <>
          <p className="flex items-center gap-1.5 text-cap text-ink-3">
            <Icon name="clock" size="sm" />
            {aiApprovalCountdownText(card.expiresAt, now)}
            <span>· 고르지 않으면 거부돼요</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="primary" size="sm" icon="check" disabled={sending} aria-label={`허용: ${card.title}`} onClick={() => void decideAiApproval(card.approvalId, 'ALLOW')}>
              허용
            </Button>
            <Button size="sm" icon="x" disabled={sending} aria-label={`거부: ${card.title}`} onClick={() => void decideAiApproval(card.approvalId, 'DENY')}>
              거부
            </Button>
            {sending ? (
              <span role="status" className="text-cap text-ink-3">
                {card.sending === 'ALLOW' ? '허용을 보냈어요…' : '거부를 보냈어요…'}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <p role="status" className="text-xs font-semibold text-ink-2">
            {aiApprovalResolutionText(card.resolution)}
          </p>
          {allowed ? <Execution card={card} /> : <p className="text-cap text-ink-3">실행하지 않았어요</p>}
        </>
      )}
    </div>
  );
}

/** 카드 여러 개 (한 답에서 쓰기 도구를 여러 번 불렀을 때) */
export function AiApprovalCards({ cards }: { cards: readonly AiApprovalCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {cards.map((card) => (
        <AiApprovalCardView key={card.approvalId} card={card} />
      ))}
    </div>
  );
}
