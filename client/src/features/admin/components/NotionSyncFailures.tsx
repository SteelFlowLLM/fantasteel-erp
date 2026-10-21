'use client';

// Notion 반영 실패 목록과 다시 시도 (문서에 없는 기능, 이슈 #518). 일정·회의록·할 일 한 행이 Notion에 반영되지 못하면 서버가 DB 목록에 남기고
// (서버를 다시 띄워도 남는다), 이 목록에서 항목별·전체로 바로 다시 시도한다. 다시 시도는 서버가 반영을 한 번 돌려 결과를 기다린다.
import { useState } from 'react';
import { PERMISSION } from '@/codes';
import { integrationApi, integrationKeys, type NotionSyncFailureView, type NotionSyncRetryResult } from '@/api/integrations';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAction } from '@/hooks/useAction';
import { useNotionSyncFailures } from '@/hooks/useIntegrations';
import { fmtDateTime } from '@/lib/format';
import { NOTION_SYNC_FAILURES_NOTE, notionSyncTargetLabel, syncFailureNextLabel, syncRetryConfirmText, syncRetryToast } from '@/lib/integrations';
import { permissionNeedText } from '@/lib/permissions';
import { errorMessageOf, toast } from '@/stores/useToastStore';

function announce(result: NotionSyncRetryResult): void {
  const { tone, text } = syncRetryToast(result);
  if (tone === 'ok') toast.ok(text);
  else toast.error(text);
}

export function NotionSyncFailuresSection({ canView, canEdit }: { canView: boolean; canEdit: boolean }) {
  const query = useNotionSyncFailures(canView);
  const [confirming, setConfirming] = useState<NotionSyncFailureView | null>(null);
  const retryAll = useAction(integrationApi.retryNotionSyncFailures, { invalidate: [integrationKeys.all], onSuccess: announce });
  const retryOne = useAction(integrationApi.retryNotionSyncFailure, {
    invalidate: [integrationKeys.all],
    onSuccess: (result) => {
      setConfirming(null);
      announce(result);
    },
    onError: () => setConfirming(null),
  });
  const failures = query.data ?? [];
  const busy = retryAll.isPending || retryOne.isPending;
  const needText = canEdit ? undefined : permissionNeedText([PERMISSION.ORG_MANAGE]);

  const retry = (failure: NotionSyncFailureView) => {
    // 만들어졌는지 몰랐던 건은 Notion을 먼저 확인했는지 묻는다: 이미 있으면 같은 페이지가 하나 더 생긴다
    if (syncRetryConfirmText(failure)) setConfirming(failure);
    else retryOne.mutate(failure.id);
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3" data-testid="notion-sync-failures">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink-2">반영 실패 목록</span>
        <Badge tone={failures.length > 0 ? 'danger' : 'ok'}>{query.data ? (failures.length > 0 ? `${failures.length}건` : '없음') : '불러오는 중'}</Badge>
        {failures.length > 0 ? (
          <Button className="ml-auto" icon="refresh" onClick={() => retryAll.mutate()} disabled={!canEdit || busy} title={needText}>
            {retryAll.isPending ? '다시 시도하는 중…' : '전체 다시 시도'}
          </Button>
        ) : null}
      </div>
      <span className="text-cap text-ink-3">{NOTION_SYNC_FAILURES_NOTE}</span>
      {query.error ? (
        <Banner tone="danger" icon="alert">
          {errorMessageOf(query.error)}
        </Banner>
      ) : null}
      {failures.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {failures.map((failure) => (
            <li key={failure.id} className="flex flex-col gap-1 rounded-md border border-line p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{notionSyncTargetLabel(failure)}</Badge>
                <span className="min-w-0 truncate text-sm font-medium" title={failure.title}>
                  {failure.title}
                </span>
                <span className="font-mono text-cap text-ink-3">#{failure.targetId}</span>
                {failure.isResultUnknown ? (
                  <Badge tone="wait" title="Notion에 페이지가 만들어졌는지 알 수 없었어요. 다시 시도하기 전에 Notion을 확인해 주세요">
                    결과 모름
                  </Badge>
                ) : null}
                <Button
                  className="ml-auto"
                  size="sm"
                  onClick={() => retry(failure)}
                  disabled={!canEdit || busy}
                  title={needText ?? `${notionSyncTargetLabel(failure)}「${failure.title}」만 다시 시도해요`}
                >
                  {retryOne.isPending && retryOne.variables === failure.id ? '시도하는 중…' : '다시 시도'}
                </Button>
              </div>
              <span className="text-cap text-ink-3">
                {failure.failureCount}번 실패 · 처음 {fmtDateTime(failure.firstFailedAt)} · 마지막 {fmtDateTime(failure.lastFailedAt)} · {syncFailureNextLabel(failure)}
              </span>
              <span className="break-words text-cap text-danger">{failure.lastError}</span>
            </li>
          ))}
        </ul>
      ) : query.data ? (
        <span className="text-cap text-ink-3">반영에 실패해 남은 항목이 없어요</span>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={`${notionSyncTargetLabel(confirming)} 다시 시도`}
          confirmLabel="다시 시도"
          tone="danger"
          pending={retryOne.isPending}
          onConfirm={() => retryOne.mutate(confirming.id)}
          onCancel={() => setConfirming(null)}
        >
          <p>{syncRetryConfirmText(confirming)}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
