'use client';

// 철강맨AI 실행 카드 (REQ-AST-005). AI는 업무 데이터를 직접 바꾸지 않고 카드로 제안만 한다.
// 사용자가 칸을 확인·수정해 [실행]을 누르면 사용자 권한으로 반영된다. 업무·일정·구매요청 카드는 회의록 후보 카드(MeetingAnalysisPanel)와 같은 모양·같은 칸이고,
// 수주 등록·열연 배정·히트 편성은 재고·생산에 영향이 커서 [실행] 뒤 확인창을 한 번 더 거친다.
import type { AiActionCard, MeetingCandidateUpdateInput } from '@fantasteel/shared';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { aiAssistantApi } from '@/api/aiAssistant';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { fields, useDirectoryNames } from '@/features/meetings/components/MeetingAnalysisPanel';
import { CandidateEditor } from '@/features/meetings/components/MeetingCandidateEditor';
import { HeatPlanBody, HotRollingBody, PastCaseBody, PastCaseEditor, SalesOrderBody, SalesOrderEditor } from '@/features/shell/AiOpsCardParts';
import { useAction } from '@/hooks/useAction';
import { useMe } from '@/hooks/useMe';
import { applyCardChanges, CARD_KIND_LABEL, CARD_RESULT, executeInputOf, isWorkCard, missingOfCard, needsConfirmation } from '@/lib/aiActionCard';
import { cn } from '@/lib/cn';
import { useAiChatStore, type AiChatCard } from '@/stores/useAiChatStore';

/** messageId: 서버에 저장한 답이면 그 id. 실행할 때 함께 보내 저장한 카드를 실행됨으로 남긴다 (이슈 #399) */
export function AiActionCards({ entryId, items, messageId }: { entryId: string; items: readonly AiChatCard[]; messageId?: number }) {
  return (
    <ul aria-label="실행 카드" className="flex flex-col gap-2">
      {items.map((item) => (
        <ActionCard key={item.card.key} entryId={entryId} item={item} messageId={messageId} />
      ))}
    </ul>
  );
}

/** [실행] 뒤 확인창에 보일 영향 설명 */
function ConfirmText({ card }: { card: AiActionCard }): ReactNode {
  if (card.kind === 'SALES_ORDER') {
    return (
      <>
        <p>
          <b>{card.customerName}</b> 수주 {card.lines.length}줄을 등록해요.
        </p>
        <p className="mt-1 text-ink-3">등록하면 합격 가용 재고를 먼저 예약하고, 모자란 매수는 생산계획이 만들어져요.</p>
      </>
    );
  }
  if (card.kind === 'HOT_ROLLING') {
    return (
      <>
        <p>
          <b>{card.productionPlanNo}</b>에 슬래브 {card.lots.length}매({card.lots.map((lot) => lot.lotNo).join(', ')})를 열연 투입으로 배정해요.
        </p>
        <p className="mt-1 text-ink-3">배정한 슬래브는 다른 수주에 예약할 수 없어요. 투입 전에는 화면에서 해제하거나 바꿀 수 있어요.</p>
      </>
    );
  }
  if (card.kind === 'HEAT_PLAN') {
    return (
      <>
        <p>
          <b>{card.productionPlanNo}</b>의 히트 수를 {card.currentHeatCount}개에서 <b>{card.newHeatCount}개</b>로 확정해요.
        </p>
        <p className="mt-1 text-ink-3">작업을 시작한 계획은 바꿀 수 없어요.</p>
      </>
    );
  }
  return null;
}

function ActionCard({ entryId, item, messageId }: { entryId: string; item: AiChatCard; messageId?: number }) {
  const { card, status } = item;
  const me = useMe();
  const names = useDirectoryNames();
  const updateCard = useAiChatStore((state) => state.updateCard);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const missing = missingOfCard(card);
  const execute = useAction(aiAssistantApi.executeActionCard, {
    success: (result) => CARD_RESULT[result.registered.type].message(result.registered),
    onSuccess: (result) => {
      setConfirming(false);
      updateCard(entryId, card.key, { status: 'done', result: result.registered });
    },
    onError: () => setConfirming(false),
  });
  const dismissed = status === 'dismissed';
  const done = status === 'done';
  const locked = done || dismissed;
  const editable = isWorkCard(card) || card.kind === 'SALES_ORDER' || card.kind === 'PAST_CASE';

  const replaceCard = (next: AiActionCard) => {
    updateCard(entryId, card.key, { card: next });
    setEditing(false);
  };
  const editWork = (changes: MeetingCandidateUpdateInput) => {
    if (isWorkCard(card) && Object.keys(changes).length > 0) updateCard(entryId, card.key, { card: applyCardChanges(card, changes) });
    setEditing(false);
  };
  const executeCard = () => execute.mutate({ ...executeInputOf(card), ...(messageId ? { chat: { messageId, cardKey: card.key } } : {}) });
  const run = () => (needsConfirmation(card) ? setConfirming(true) : executeCard());

  return (
    <li className={cn('flex flex-col gap-2 rounded-sm border bg-surface-2 p-3', done ? 'border-ok' : 'border-line', dismissed && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="outline">{CARD_KIND_LABEL[card.kind]}</Badge>
        <b className={cn('min-w-0 text-sm break-words', dismissed && 'line-through')}>{card.title}</b>
        <span className="ml-auto flex items-center gap-1">
          <Badge tone="ai" plain title="철강맨AI가 만든 초안이에요. 확인하고 실행을 눌러야 업무에 반영돼요">
            AI 초안
          </Badge>
          {done ? <Badge tone="ok">실행됨</Badge> : dismissed ? <Badge tone="neutral" plain>닫음</Badge> : <Badge tone="neutral" plain>실행 전</Badge>}
        </span>
      </div>

      {editing && isWorkCard(card) ? (
        <CandidateEditor candidate={card} myId={me.employeeId} pending={false} assigneeHint="" onCancel={() => setEditing(false)} onSave={editWork} />
      ) : editing && card.kind === 'SALES_ORDER' ? (
        <SalesOrderEditor card={card} onCancel={() => setEditing(false)} onSave={replaceCard} />
      ) : editing && card.kind === 'PAST_CASE' ? (
        <PastCaseEditor card={card} onCancel={() => setEditing(false)} onSave={replaceCard} />
      ) : (
        <>
          {isWorkCard(card) ? (
            <>
              {card.description ? <p className="text-sm text-ink-2">{card.description}</p> : null}
              <div className="flex flex-col gap-0.5">{fields(card, names)}</div>
            </>
          ) : card.kind === 'SALES_ORDER' ? (
            <SalesOrderBody card={card} />
          ) : card.kind === 'HOT_ROLLING' ? (
            <HotRollingBody card={card} />
          ) : card.kind === 'HEAT_PLAN' ? (
            <HeatPlanBody card={card} />
          ) : (
            <PastCaseBody card={card} />
          )}
        </>
      )}

      {card.issues.length > 0 && !locked ? (
        <ul className="flex flex-col gap-0.5 rounded-xs bg-wait-bg px-2 py-1.5 text-xs text-[#7a3d00]">
          {card.issues.map((issue) => (
            <li key={issue} className="flex items-start gap-1">
              <span aria-hidden>⚠</span>
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {item.result ? (
        <div className="flex items-center gap-1 rounded-xs bg-ok-bg px-2 py-1.5 text-xs text-ok-strong">
          <Icon name="check" size="sm" />
          <span>{CARD_RESULT[item.result.type].message(item.result)}</span>
          <Link href={CARD_RESULT[item.result.type].href(item.result)} className="font-medium text-brand hover:underline">
            {CARD_RESULT[item.result.type].linkLabel(item.result)}
          </Link>
        </div>
      ) : null}

      {!locked && !editing ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {missing.length > 0 ? <p className="mr-auto text-cap text-ink-3">{missing.join(', ')}을(를) 채우면 실행할 수 있어요</p> : null}
          {editable ? (
            <Button size="sm" disabled={execute.isPending} onClick={() => setEditing(true)}>
              수정
            </Button>
          ) : null}
          <Button size="sm" disabled={execute.isPending} onClick={() => updateCard(entryId, card.key, { status: 'dismissed' })}>
            닫기
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={execute.isPending || missing.length > 0}
            title={missing.length > 0 ? `${missing.join(', ')}을(를) 채워야 실행할 수 있어요` : '내 권한으로 업무에 반영해요'}
            onClick={run}
          >
            {execute.isPending ? '실행하는 중…' : '실행'}
          </Button>
        </div>
      ) : null}

      {confirming ? (
        <ConfirmDialog title={`${CARD_KIND_LABEL[card.kind]}을(를) 실행할까요?`} confirmLabel="실행" pending={execute.isPending} onConfirm={executeCard} onCancel={() => setConfirming(false)}>
          <ConfirmText card={card} />
        </ConfirmDialog>
      ) : null}
    </li>
  );
}
