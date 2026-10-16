'use client';

// 외부 연결의 Google Drive 카드 (문서에 없는 기능, 이슈 #361). Notion과 달리 MCP가 아니라 Drive REST API + 관리자가 넣은 OAuth 클라이언트다.
// 순서: Google Cloud Console에서 OAuth 클라이언트 만들기 → 클라이언트 ID·보안 비밀번호·폴더 저장 → 연결하기(Google 허용 화면) → 연결 확인.
import { useState } from 'react';
import { integrationApi, integrationKeys, type IntegrationConnectionView, type IntegrationTestResult } from '@/api/integrations';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { useAction } from '@/hooks/useAction';
import { useIntegrationTest } from '@/hooks/useIntegrations';
import { fmtDateTime } from '@/lib/format';
import { INTEGRATION_STATUS_LABEL, INTEGRATION_STATUS_TONE, driveConnectBlockReason, driveFolderLink, driveSettingsPatch } from '@/lib/integrations';
import { toast } from '@/stores/useToastStore';

export function GoogleDriveCard({ connection, canEdit }: { connection: IntegrationConnectionView; canEdit: boolean }) {
  const savedClientId = connection.oauthClient?.clientId ?? '';
  const secretSaved = connection.oauthClient?.clientSecretSet ?? false;
  const savedFolderId = connection.settings.folderId ?? null;
  const savedFolder = savedFolderId ? driveFolderLink(savedFolderId) : '';
  const [clientId, setClientId] = useState(savedClientId);
  const [clientSecret, setClientSecret] = useState('');
  const [folder, setFolder] = useState(savedFolder);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const test = useIntegrationTest();
  const save = useAction(integrationApi.updateSettings, { success: '설정을 저장했어요', invalidate: [integrationKeys.all] });
  const connect = useAction(integrationApi.connect, {
    onSuccess: (result) => {
      // 허용 화면은 Google 쪽이라 이 화면을 떠난다. 허용이 끝나면 서버가 이 화면으로 돌려보낸다
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
  const patch = driveSettingsPatch({ savedClientId, clientId, clientSecret, savedFolder, folder });
  const dirty = Object.keys(patch).length > 0;
  const clientIdChanged = clientId.trim() !== savedClientId;
  const busy = connect.isPending || disconnect.isPending;
  const blockReason = driveConnectBlockReason(connection, dirty);

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

        <SetupGuide />

        <div className="flex flex-col gap-3 rounded-md border border-line p-3">
          <span className="text-xs font-semibold text-ink-2">OAuth 클라이언트</span>
          <Field label="클라이언트 ID" hint="Google Cloud Console의 OAuth 클라이언트 ID (…apps.googleusercontent.com)">
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={!canEdit}
              placeholder="1234567890-abc.apps.googleusercontent.com"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          <Field
            label={
              <>
                클라이언트 보안 비밀번호 {secretSaved ? <Badge tone="ok">저장됨</Badge> : <Badge tone="neutral">저장 안 됨</Badge>}
              </>
            }
            hint="저장만 하고 다시 보여 주지 않아요. 바꾸려면 새 값을 넣고 저장하세요"
          >
            <Input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={!canEdit}
              placeholder={secretSaved ? '새 값으로 바꾸려면 입력' : 'GOCSPX-…'}
              spellCheck={false}
              autoComplete="new-password"
            />
          </Field>
          {connection.redirectUri ? <RedirectUri uri={connection.redirectUri} /> : null}
          {connected && clientIdChanged ? (
            <Banner tone="wait" icon="alert">
              클라이언트 ID를 바꾸면 지금 연결이 풀려서 다시 연결해야 해요.
            </Banner>
          ) : null}
        </div>

        <Field
          label="녹음·사진을 올리는 Drive 폴더"
          hint="Drive 폴더의 링크를 붙여 넣어요. 연결한 Google 계정이 볼 수 있는 폴더여야 하고, 폴더 바로 아래 파일만 읽어요"
        >
          <Input value={folder} onChange={(e) => setFolder(e.target.value)} disabled={!canEdit} placeholder="https://drive.google.com/drive/folders/…" spellCheck={false} />
        </Field>
        {savedFolderId ? (
          <span className="text-cap text-ink-3">
            저장된 폴더{' '}
            <a href={savedFolder} target="_blank" rel="noopener noreferrer" className="font-mono text-run hover:underline">
              {savedFolderId}
            </a>
          </span>
        ) : (
          <span className="text-cap text-ink-3">폴더를 정하기 전에는 회의록 만들기에서 Drive 녹음을 가져올 수 없어요</span>
        )}
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => save.mutate({ providerKey, input: patch })} disabled={!canEdit || !dirty || save.isPending}>
            {save.isPending ? '저장 중…' : '설정 저장'}
          </Button>
          {dirty ? <span className="text-cap text-ink-3">저장하지 않은 변경이 있어요</span> : null}
        </div>

        {test.data ? <DriveTestResult result={test.data} /> : null}
        {test.error ? (
          <Banner tone="danger" icon="alert">
            {test.error instanceof Error ? test.error.message : '연결 확인에 실패했어요'}
          </Banner>
        ) : null}
      </CardBody>
      <CardFoot>
        <span className="text-xs text-ink-3">{blockReason ?? (connected ? '확인하면 폴더 이름과 녹음·사진 수를 읽어 와요' : '연결하면 Google 허용 화면으로 이동해요')}</span>
        {connected ? (
          <Button className="ml-auto" variant="danger-ghost" onClick={() => setConfirmDisconnect(true)} disabled={!canEdit || busy}>
            연결 끊기
          </Button>
        ) : null}
        <Button className={connected ? undefined : 'ml-auto'} icon="refresh" onClick={() => test.mutate(providerKey)} disabled={!canEdit || !connected || test.isPending || busy}>
          {test.isPending ? '확인 중…' : '연결 확인'}
        </Button>
        <Button
          variant={connected ? 'default' : 'primary'}
          icon="link"
          onClick={() => connect.mutate(providerKey)}
          disabled={!canEdit || busy || blockReason !== null}
          title={blockReason ?? undefined}
        >
          {connect.isPending ? '이동하는 중…' : status === 'NOT_CONNECTED' ? '연결하기' : '다시 연결'}
        </Button>
      </CardFoot>
      {confirmDisconnect ? (
        <ConfirmDialog
          title="Google Drive 연결 끊기"
          confirmLabel="연결 끊기"
          tone="danger"
          pending={disconnect.isPending}
          onConfirm={() => disconnect.mutate(providerKey)}
          onCancel={() => setConfirmDisconnect(false)}
        >
          <p>ERP에 저장된 허용 정보를 지우고 Google 쪽 허용도 함께 없애요. 끊으면 Drive 녹음을 가져올 수 없어요.</p>
          <p className="mt-2 text-xs text-ink-3">클라이언트 ID·보안 비밀번호와 폴더 설정은 남아서, 다시 연결할 때 새로 넣지 않아도 돼요.</p>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

/** 관리자가 Google Cloud Console의 OAuth 클라이언트에 그대로 등록할 주소 */
function RedirectUri({ uri }: { uri: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      toast.ok('주소를 복사했어요');
    } catch {
      toast.error('복사하지 못했어요. 주소를 직접 선택해 복사해 주세요');
    }
  };
  return (
    <Field label="리디렉션 URI" hint="Google Cloud Console의 OAuth 클라이언트 '승인된 리디렉션 URI'에 넣으세요">
      <div className="flex gap-2">
        <Input value={uri} readOnly spellCheck={false} className="flex-1 font-mono" onFocus={(e) => e.currentTarget.select()} />
        <Button icon="copy" onClick={copy}>
          복사
        </Button>
      </div>
    </Field>
  );
}

function SetupGuide() {
  return (
    <details className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-ink-2">설정 방법 (Google Cloud Console)</summary>
      <ol className="mt-2 ml-4 flex list-decimal flex-col gap-1.5 text-xs leading-normal text-ink-2">
        <li>Google Cloud Console에서 프로젝트를 만들고, API 및 서비스 › 라이브러리에서 Google Drive API를 사용 설정해요.</li>
        <li>
          OAuth 동의 화면을 설정해요. Google Workspace면 대상을 내부로, 아니면 외부 + 테스트로 두고 연결할 계정을 테스트 사용자에 더해요.
          <span className="text-wait"> 외부 + 테스트 상태 앱은 7일마다 다시 연결해야 해요.</span>
        </li>
        <li>데이터 액세스에 drive.readonly와 drive.file 범위를 더해요.</li>
        <li>사용자 인증 정보 › OAuth 클라이언트 ID(웹 애플리케이션)를 만들고, 아래 리디렉션 URI를 승인된 리디렉션 URI에 글자 그대로 넣어요.</li>
        <li>클라이언트 ID·보안 비밀번호와 Drive 폴더 링크를 이 카드에 넣고 저장해요.</li>
        <li>연결하기 › Google 계정을 고르고 권한을 모두 허용해요. 돌아오면 연결 확인으로 폴더 이름과 파일 수를 봐요.</li>
      </ol>
    </details>
  );
}

function DriveTestResult({ result }: { result: IntegrationTestResult }) {
  if (!result.ok) {
    return (
      <Banner tone="danger" icon="alert">
        {result.error ?? '연결을 확인하지 못했어요'}
      </Banner>
    );
  }
  const folder = result.driveFolder;
  return (
    <Banner tone="ok">
      <span className="font-medium">연결이 잘 돼요</span>
      {result.latencyMs !== null ? ` · ${result.latencyMs}ms` : ''}
      {folder ? (
        <div className="mt-0.5 text-cap">
          폴더 「{folder.name}」 · 녹음 {folder.audioCount}개 · 사진 {folder.imageCount}개{folder.countLimited ? ' (파일이 많아 앞의 1,000개만 셌어요)' : ''}
        </div>
      ) : null}
    </Banner>
  );
}
