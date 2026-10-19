'use client';

// 외부 연결 /admin/integrations (문서에 없는 기능, 이슈 #358·#361·#391): 회사 Notion 계정 연결과 회의록을 둘 상위 페이지·업무 공간, 회사 Google Drive 연결과 녹음 폴더.
// 회사 계정 하나를 모든 사원이 함께 쓴다. 설정 전용 권한 코드가 없어 AI 연결 화면처럼 ORG_MANAGE로 연다(가정). 사용 권한이 없으면 조회만 한다.
// OAuth 허용이 끝나면 서버가 브라우저를 ?integration=notion|google-drive&result=connected|error&message=… 로 돌려보낸다.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PERMISSION } from '@/codes';
import { integrationApi, integrationKeys, type IntegrationConnectionView, type IntegrationTestResult, type NotionCalendarOption, type NotionWorkspaceView } from '@/api/integrations';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { GoogleDriveCard } from '@/features/admin/components/GoogleDriveCard';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { useAction } from '@/hooks/useAction';
import { useIntegrationTest, useIntegrations } from '@/hooks/useIntegrations';
import { useCanUse } from '@/hooks/usePermission';
import {
  INTEGRATION_STATUS_LABEL,
  INTEGRATION_STATUS_TONE,
  integrationCallbackToast,
  integrationCardKind,
  NOTION_CALENDAR_EMPTY_HINT,
  notionCalendarKey,
  notionCalendarLabel,
  notionCalendarSaveInput,
  notionPageLink,
  notionWorkspaceBlockReason,
  notionWorkspaceStatusLabel,
  notionWorkspaceSyncLabel,
  parseIntegrationCallback,
  safeExternalUrl,
  withoutCallbackParams,
} from '@/lib/integrations';
import { fmtDateTime } from '@/lib/format';
import { errorMessageOf, toast } from '@/stores/useToastStore';

export function IntegrationsScreen() {
  const canEdit = useCanUse(PERMISSION.ORG_MANAGE);
  const integrations = useIntegrations();
  useCallbackNotice();

  return (
    <PageMain>
      <div className="flex flex-none items-end gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-2xl font-semibold">외부 연결</h1>
          <span className="text-cap text-ink-3">회사 계정 하나를 연결해 모든 사원이 함께 써요. 사원마다 따로 연결하지 않아요</span>
        </div>
        <div className="ml-auto flex items-center gap-2">{canEdit ? null : <ReadOnlyHint permissions={[PERMISSION.ORG_MANAGE]} />}</div>
      </div>
      <QueryBoundary query={integrations} loadingLabel="외부 연결을 불러오는 중">
        {(items) => (
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-2">
            {items.map((item) => {
              const kind = integrationCardKind(item);
              if (kind === 'google-drive') {
                // 저장한 값이 바뀌면 카드를 새로 그려 입력칸을 저장된 값으로 맞춘다
                const draftKey = `${item.settings.folderId ?? ''}|${item.oauthClient?.clientId ?? ''}|${item.oauthClient?.clientSecretSet ? 1 : 0}`;
                return <GoogleDriveCard key={`${item.providerKey}|${draftKey}`} connection={item} canEdit={canEdit} />;
              }
              if (kind === 'notion') return <NotionCard key={`${item.providerKey}|${item.settings.parentPageId ?? ''}`} connection={item} canEdit={canEdit} />;
              return null;
            })}
          </div>
        )}
      </QueryBoundary>
    </PageMain>
  );
}

/** 연결 허용이 끝나고 돌아왔을 때 결과를 한 번 알리고, 주소의 쿼리를 지운다 */
function useCallbackNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const notice = parseIntegrationCallback(params);
    if (!notice) return;
    handled.current = true;
    const { tone, text } = integrationCallbackToast(notice);
    if (tone === 'ok') toast.ok(text);
    else toast.error(text);
    const rest = withoutCallbackParams(params.toString());
    router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [params, pathname, router]);
}

function NotionCard({ connection, canEdit }: { connection: IntegrationConnectionView; canEdit: boolean }) {
  const savedPageId = connection.settings.parentPageId ?? null;
  const savedLink = savedPageId ? notionPageLink(savedPageId) : '';
  const [parentPage, setParentPage] = useState(savedLink);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const test = useIntegrationTest();
  const save = useAction(integrationApi.updateSettings, { success: '상위 페이지를 저장했어요', invalidate: [integrationKeys.all] });
  const connect = useAction(integrationApi.connect, {
    onSuccess: (result) => {
      // 허용 화면은 Notion 쪽이라 이 화면을 떠난다. 허용이 끝나면 서버가 이 화면으로 돌려보낸다
      window.location.href = result.authorizationUrl;
    },
  });
  const disconnect = useAction(integrationApi.disconnect, {
    success: '연결을 끊었어요',
    invalidate: [integrationKeys.all],
    onSuccess: () => {
      setConfirmDisconnect(false);
      test.reset();
    },
    onError: () => setConfirmDisconnect(false),
  });

  const { providerKey, status } = connection;
  const connected = status === 'CONNECTED';
  const dirty = parentPage.trim() !== savedLink;
  const busy = connect.isPending || disconnect.isPending;

  return (
    <Card petKey={`card:integrations.${providerKey}`}>
      <CardHead title={connection.displayName} meta={<Badge tone={INTEGRATION_STATUS_TONE[status]}>{INTEGRATION_STATUS_LABEL[status]}</Badge>} />
      <CardBody>
        <KvList
          items={[
            { label: '연결한 시각', value: connection.connectedAt ? fmtDateTime(connection.connectedAt) : '-' },
            { label: '연결한 사람', value: connection.connectedAt ? (connection.connectedBy?.name ?? '-') : '-' },
          ]}
        />
        {status === 'RECONNECT_REQUIRED' ? (
          <Banner tone="wait" icon="alert">
            <b>연결이 끊겼어요.</b> 허용이 만료되었거나 취소되었어요. 관리자가 다시 연결해 주세요.
          </Banner>
        ) : null}
        {connection.lastError ? (
          <Banner tone="danger" icon="alert">
            <span className="text-cap font-medium">마지막 오류</span>
            <div className="break-words">{connection.lastError}</div>
          </Banner>
        ) : null}

        <Field
          label="회의록을 둘 Notion 상위 페이지"
          hint="Notion 페이지의 링크를 붙여 넣어요. 연결한 Notion 계정이 편집할 수 있는 페이지여야 하고, 회의록과 업무 공간 데이터베이스가 이 페이지 아래에 만들어져요"
        >
          <div className="flex gap-2">
            <Input
              value={parentPage}
              onChange={(e) => setParentPage(e.target.value)}
              disabled={!canEdit}
              placeholder="https://www.notion.so/…"
              spellCheck={false}
              className="flex-1"
            />
            <Button
              variant="primary"
              onClick={() => save.mutate({ providerKey, input: { parentPage: parentPage.trim() || null } })}
              disabled={!canEdit || !dirty || save.isPending}
            >
              {save.isPending ? '저장 중…' : '저장'}
            </Button>
          </div>
        </Field>
        {savedPageId ? (
          <span className="text-cap text-ink-3">
            저장된 상위 페이지{' '}
            <a href={savedLink} target="_blank" rel="noopener noreferrer" className="font-mono text-run hover:underline">
              {savedPageId}
            </a>
          </span>
        ) : (
          <span className="text-cap text-ink-3">상위 페이지를 정하기 전에는 회의록을 내보낼 수 없어요</span>
        )}

        <NotionWorkspaceSection connection={connection} canEdit={canEdit} hasUnsavedChanges={dirty} />

        {test.data ? <TestResult result={test.data} /> : null}
        {test.error ? (
          <Banner tone="danger" icon="alert">
            {test.error instanceof Error ? test.error.message : '연결 확인에 실패했어요'}
          </Banner>
        ) : null}
      </CardBody>
      <CardFoot>
        <span className="text-xs text-ink-3">{connected ? '확인하면 Notion 서버에 도구 목록을 물어봐요' : '연결하면 Notion 허용 화면으로 이동해요'}</span>
        {connected ? (
          <Button className="ml-auto" variant="danger-ghost" onClick={() => setConfirmDisconnect(true)} disabled={!canEdit || busy}>
            연결 끊기
          </Button>
        ) : null}
        <Button className={connected ? undefined : 'ml-auto'} icon="refresh" onClick={() => test.mutate(providerKey)} disabled={!canEdit || !connected || test.isPending || busy}>
          {test.isPending ? '확인 중…' : '연결 확인'}
        </Button>
        <Button variant={connected ? 'default' : 'primary'} icon="link" onClick={() => connect.mutate(providerKey)} disabled={!canEdit || busy}>
          {connect.isPending ? '이동하는 중…' : status === 'NOT_CONNECTED' ? '연결하기' : '다시 연결'}
        </Button>
      </CardFoot>
      {confirmDisconnect ? (
        <ConfirmDialog
          title={`${connection.displayName} 연결 끊기`}
          confirmLabel="연결 끊기"
          tone="danger"
          pending={disconnect.isPending}
          onConfirm={() => disconnect.mutate(providerKey)}
          onCancel={() => setConfirmDisconnect(false)}
        >
          <p>ERP에 저장된 연결 정보를 지워요. 끊으면 회의록을 내보낼 수 없고, 상위 페이지 설정은 남아요.</p>
          <p className="mt-2 text-xs text-ink-3">Notion 쪽 허용까지 없애려면 Notion의 설정 › 연결에서 따로 지워 주세요.</p>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

/**
 * Notion 업무 공간 (이슈 #391): 상위 페이지 아래 일정·회의록·할 일 데이터베이스를 한 번 만들고, 그 뒤로 서버가 ERP → Notion으로 자동 반영한다.
 * 이미 만들었으면 단추 대신 데이터베이스 링크와 반영 상태를 보인다. 만들다 멈췄으면(일부만) 없는 것만 이어서 만든다.
 */
function NotionWorkspaceSection({ connection, canEdit, hasUnsavedChanges }: { connection: IntegrationConnectionView; canEdit: boolean; hasUnsavedChanges: boolean }) {
  const workspace = connection.notionWorkspace;
  const queryClient = useQueryClient();
  const setup = useAction(integrationApi.setupNotionWorkspace, {
    success: 'Notion 업무 공간을 만들었어요. 일정·회의록·할 일을 옮기기 시작해요',
    invalidate: [integrationKeys.all],
    // 실패해도 서버가 남긴 마지막 오류·일부만 만든 데이터베이스를 카드에 보이려고 다시 읽는다
    onError: () => void queryClient.invalidateQueries({ queryKey: integrationKeys.all }),
  });
  const blocked = notionWorkspaceBlockReason(connection, hasUnsavedChanges);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink-2">Notion 업무 공간</span>
        <Badge tone={workspace?.ready ? 'ok' : workspace ? 'wait' : 'neutral'}>{notionWorkspaceStatusLabel(workspace)}</Badge>
      </div>
      <span className="text-cap text-ink-3">
        상위 페이지 아래에 일정(달력)·회의록·할 일(상태별·담당자별 보드) 데이터베이스를 만들고, ERP에 저장한 내용을 자동으로 옮겨요. Notion에서 고친 내용은 ERP로 돌아오지 않아요.
      </span>
      {workspace ? (
        <KvList
          items={[
            { label: '만든 시각', value: workspace.createdAt ? fmtDateTime(workspace.createdAt) : '-' },
            { label: '마지막 반영', value: workspace.lastSyncedAt ? fmtDateTime(workspace.lastSyncedAt) : '아직 없어요' },
            { label: '반영', value: workspace.ready ? notionWorkspaceSyncLabel(workspace) : '-' },
          ]}
        />
      ) : null}
      {workspace && workspace.databases.length > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-cap">
          {workspace.databases.map((db) => {
            const href = safeExternalUrl(db.url);
            return href ? (
              <a key={db.key} href={href} target="_blank" rel="noopener noreferrer" className="text-run hover:underline">
                {db.title}
              </a>
            ) : (
              <span key={db.key} className="text-ink-3">
                {db.title}
              </span>
            );
          })}
        </div>
      ) : null}
      {workspace?.setupWarning ? (
        <Banner tone="wait" icon="alert">
          <span className="text-cap font-medium">데이터베이스 보기</span>
          <div className="break-words">{workspace.setupWarning}</div>
          {workspace.ready ? (
            <div className="mt-1">
              <Button onClick={() => setup.mutate()} disabled={!canEdit || blocked !== null || setup.isPending}>
                {setup.isPending ? '고치는 중…' : '다시 고치기'}
              </Button>
            </div>
          ) : null}
        </Banner>
      ) : null}
      {workspace?.lastSyncError ? (
        <Banner tone="wait" icon="alert">
          <span className="text-cap font-medium">마지막 반영 오류</span>
          <div className="break-words">{workspace.lastSyncError}</div>
        </Banner>
      ) : null}
      {workspace?.ready ? (
        <NotionCalendarSection
          key={workspace.calendar ? `${notionCalendarKey(workspace.calendar)}|${workspace.calendar.sendInvites ? 1 : 0}` : 'none'}
          workspace={workspace}
          canEdit={canEdit}
        />
      ) : null}
      {setup.error ? (
        <Banner tone="danger" icon="alert">
          <span className="text-cap font-medium">업무 공간을 만들지 못했어요</span>
          <div className="break-words">{errorMessageOf(setup.error)}</div>
        </Banner>
      ) : null}
      {workspace?.ready ? null : (
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => setup.mutate()} disabled={!canEdit || blocked !== null || setup.isPending}>
            {setup.isPending ? '만드는 중…' : workspace ? '이어서 만들기' : 'Notion 업무 공간 만들기'}
          </Button>
          {blocked ? <span className="text-cap text-ink-3">{blocked}</span> : null}
        </div>
      )}
    </div>
  );
}

/**
 * Notion 캘린더 (이슈 #391 2단계): 회사 Notion 계정에 연결된 캘린더 하나를 고르면 ERP 일정을 그 캘린더에도 만든다.
 * 목록은 Notion에 물어보므로 "캘린더 불러오기"를 눌렀을 때만 읽는다. 초대는 기본 꺼짐(켜면 참석자에게 초대 메일이 간다).
 */
function NotionCalendarSection({ workspace, canEdit }: { workspace: NotionWorkspaceView; canEdit: boolean }) {
  const current = workspace.calendar;
  const [options, setOptions] = useState<NotionCalendarOption[] | null>(null);
  const [selected, setSelected] = useState(current ? notionCalendarKey(current) : '');
  const [sendInvites, setSendInvites] = useState(current?.sendInvites ?? false);
  const load = useMutation({
    mutationFn: integrationApi.notionCalendars,
    onSuccess: (list) => {
      setOptions(list);
      // 지금 캘린더가 목록에 없으면(지워짐) 고른 값을 비운다
      if (!list.some((o) => notionCalendarKey(o) === selected)) setSelected('');
    },
  });
  const save = useAction(integrationApi.updateNotionCalendar, { success: '캘린더 설정을 저장했어요', invalidate: [integrationKeys.all] });
  const input = notionCalendarSaveInput(current, selected, options ?? [], sendInvites);

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink-2">Notion 캘린더</span>
        <Badge tone={current ? 'ok' : 'neutral'}>{current ? notionCalendarLabel({ ...current, writable: true }) : '고르지 않았어요'}</Badge>
      </div>
      <span className="text-cap text-ink-3">고르면 ERP 일정을 이 캘린더에도 만들고 고쳐요. 캘린더를 바꿔도 옛 캘린더의 일정은 지우지 않아요.</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon="refresh" onClick={() => load.mutate()} disabled={!canEdit || load.isPending}>
          {load.isPending ? '불러오는 중…' : '캘린더 불러오기'}
        </Button>
        {current ? (
          <Button variant="danger-ghost" onClick={() => save.mutate({ accountId: null })} disabled={!canEdit || save.isPending}>
            캘린더 반영 끄기
          </Button>
        ) : null}
      </div>
      {load.error ? (
        <Banner tone="danger" icon="alert">
          {errorMessageOf(load.error)}
        </Banner>
      ) : null}
      {options && options.length === 0 ? (
        <Banner tone="wait" icon="alert">
          {NOTION_CALENDAR_EMPTY_HINT}
        </Banner>
      ) : null}
      {options && options.length > 0 ? (
        <Select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!canEdit} aria-label="일정을 만들 캘린더">
          <option value="">캘린더 선택</option>
          {options.map((o) => (
            <option key={notionCalendarKey(o)} value={notionCalendarKey(o)} disabled={o.writable === false}>
              {notionCalendarLabel(o)}
            </option>
          ))}
        </Select>
      ) : null}
      {current || (options && options.length > 0) ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-3.5" checked={sendInvites} disabled={!canEdit} onChange={(e) => setSendInvites(e.target.checked)} />
            참석자에게 초대 보내기
          </label>
          <span className="text-cap text-ink-3">켜면 일정 참석자 중 메일을 등록한 사원에게 캘린더 초대 메일이 가요. 메일은 관리 › 사원에서 넣어요.</span>
          <div>
            <Button variant="primary" onClick={() => input && save.mutate(input)} disabled={!canEdit || input === null || save.isPending}>
              {save.isPending ? '저장 중…' : '캘린더 설정 저장'}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function TestResult({ result }: { result: IntegrationTestResult }) {
  if (!result.ok) {
    return (
      <Banner tone="danger" icon="alert">
        {result.error ?? '연결을 확인하지 못했어요'}
        {result.missingTools.length > 0 ? <div className="mt-0.5 text-cap">없는 도구: {result.missingTools.join(', ')}</div> : null}
      </Banner>
    );
  }
  return (
    <Banner tone={result.missingTools.length > 0 ? 'wait' : 'ok'}>
      <span className="font-medium">연결이 잘 돼요</span>
      {result.latencyMs !== null ? ` · ${result.latencyMs}ms` : ''} · 도구 {result.tools.length}개
      {result.missingTools.length > 0 ? <div className="mt-0.5 text-cap">필요한데 없는 도구: {result.missingTools.join(', ')}</div> : null}
    </Banner>
  );
}
