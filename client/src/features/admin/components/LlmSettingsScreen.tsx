'use client';

// AI 연결 /admin/llm (문서에 없는 기능, 2026-10-07 추가): LM Studio 서버 연결 확인 · 모델 선택 · 응답 확인.
// 나중에 외부 LLM을 쓸 때는 주소와 API 키만 바꾼다 (둘 다 OpenAI 호환 API).
// 설정 전용 권한 코드가 없어 부서·권한 관리(ORG_MANAGE) 권한으로 연다(가정). 사용 권한이 없으면 조회만 한다.
import { useEffect, useState } from 'react';
import { LLM_DEFAULT_BASE_URL, type LlmConnectionView, type LlmSettingsView } from '@fantasteel/shared';
import { PERMISSION } from '@/codes';
import { llmApi, llmKeys } from '@/api/llm';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { useAction } from '@/hooks/useAction';
import { useLlmChatTest, useLlmConnectionTest, useLlmSettings } from '@/hooks/useLlm';
import { useCanUse } from '@/hooks/usePermission';

export function LlmSettingsScreen() {
  const canEdit = useCanUse(PERMISSION.ORG_MANAGE);
  const settings = useLlmSettings();

  return (
    <PageMain>
      <div className="flex flex-none items-end gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-2xl font-semibold">AI 연결</h1>
          <span className="text-cap text-ink-3">LM Studio 서버에 연결하고 AI 기능이 쓸 모델을 골라요</span>
        </div>
        <div className="ml-auto flex items-center gap-2">{canEdit ? null : <ReadOnlyHint permissions={[PERMISSION.ORG_MANAGE]} />}</div>
      </div>
      <QueryBoundary query={settings} loadingLabel="AI 연결 설정을 불러오는 중">
        {(data) => <LlmSettingsForm key={`${data.baseUrl}|${data.model ?? ''}|${data.hasApiKey}`} saved={data} canEdit={canEdit} />}
      </QueryBoundary>
    </PageMain>
  );
}

function LlmSettingsForm({ saved, canEdit }: { saved: LlmSettingsView; canEdit: boolean }) {
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
  const [model, setModel] = useState(saved.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);

  const connection = useLlmConnectionTest();
  const chat = useLlmChatTest();
  const save = useAction(llmApi.updateSettings, { success: 'AI 연결 설정을 저장했어요', invalidate: [llmKeys.settings()] });

  /** 입력한 키가 있으면 그 키, 지우기를 눌렀으면 빈 값, 아니면 저장된 키(undefined) */
  const apiKeyInput = (): string | undefined => (apiKey.trim() ? apiKey.trim() : clearApiKey ? '' : undefined);
  const runConnectionTest = () => connection.mutate({ baseUrl, apiKey: apiKeyInput() });

  // 화면을 열면 저장된 주소로 한 번 확인해 모델 목록을 채운다
  useEffect(() => {
    if (canEdit) connection.mutate({ baseUrl: saved.baseUrl });
    // 처음 열 때 한 번만 (의존성을 비워 둔다)
  }, []);

  const result = connection.data;
  const dirty = baseUrl.trim() !== saved.baseUrl || model !== (saved.model ?? '') || apiKey.trim() !== '' || clearApiKey;
  const onSave = () => save.mutate({ baseUrl, model: model || null, apiKey: apiKeyInput() }, { onSuccess: () => chat.reset() });

  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] items-start gap-4">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHead title="서버 연결" meta={<ConnectionBadge result={result} pending={connection.isPending} />} />
          <CardBody>
            <Field label="서버 주소" required hint={`LM Studio 기본값 ${LLM_DEFAULT_BASE_URL} · OpenAI 호환 주소(…/v1)`}>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={!canEdit} placeholder={LLM_DEFAULT_BASE_URL} spellCheck={false} />
            </Field>
            <Field
              label="API 키"
              hint={
                saved.hasApiKey && !clearApiKey
                  ? '저장된 키가 있어요. 바꿀 때만 입력해요'
                  : 'LM Studio는 비워 둬요. 서버에서 인증을 켰거나 외부 LLM을 쓸 때만 입력해요'
              }
            >
              <div className="flex gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={!canEdit}
                  placeholder={saved.hasApiKey && !clearApiKey ? '••••••••' : '없음'}
                  className="flex-1"
                />
                {canEdit && saved.hasApiKey ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setApiKey('');
                      setClearApiKey((v) => !v);
                    }}
                  >
                    {clearApiKey ? '지우기 취소' : '키 지우기'}
                  </Button>
                ) : null}
              </div>
            </Field>
            {result && !result.connected ? (
              <Banner tone="danger" icon="alert">
                {result.error}
              </Banner>
            ) : null}
          </CardBody>
          <CardFoot>
            {result?.connected ? (
              <span className="text-xs text-ink-3">
                모델 {result.models.length}개 · {result.latencyMs}ms
              </span>
            ) : null}
            <Button className="ml-auto" icon="refresh" onClick={runConnectionTest} disabled={!canEdit || connection.isPending || !baseUrl.trim()}>
              {connection.isPending ? '확인 중…' : '연결 확인'}
            </Button>
          </CardFoot>
        </Card>

        <Card>
          <CardHead title="모델" meta={saved.model ? `저장된 모델 ${saved.model}` : '아직 고르지 않았어요'} />
          <CardBody>
            <Field label="사용할 모델" hint="연결 확인으로 받은 목록에서 골라요. LM Studio에서 다운로드한 모델(LM Link로 연결한 다른 컴퓨터의 모델 포함)이 보여요">
              <Select value={model} onChange={(e) => setModel(e.target.value)} disabled={!canEdit || !result?.connected}>
                <option value="">모델을 골라 주세요</option>
                {modelOptions(result, model).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            {chat.data ? (
              chat.data.ok ? (
                <Banner tone="ok" icon="check-circle">
                  <span className="font-medium">{chat.data.model}</span> · {chat.data.latencyMs}ms — {chat.data.reply || '(빈 답)'}
                </Banner>
              ) : (
                <Banner tone="danger" icon="alert">
                  {chat.data.error}
                </Banner>
              )
            ) : null}
            {chat.error ? (
              <Banner tone="danger" icon="alert">
                {chat.error instanceof Error ? chat.error.message : '응답 확인에 실패했어요'}
              </Banner>
            ) : null}
          </CardBody>
          <CardFoot>
            <span className="text-xs text-ink-3">응답 확인은 저장된 설정으로 짧은 질문을 보내요. 처음엔 모델을 올리느라 오래 걸릴 수 있어요</span>
            <Button className="ml-auto" variant="ai-outline" onClick={() => chat.mutate()} disabled={!canEdit || chat.isPending || !saved.model || dirty}>
              {chat.isPending ? '답 기다리는 중…' : '응답 확인'}
            </Button>
            <Button variant="primary" onClick={onSave} disabled={!canEdit || !dirty || save.isPending || !baseUrl.trim()}>
              저장
            </Button>
          </CardFoot>
        </Card>
      </div>

      <Card>
        <CardHead title="LM Studio 준비" />
        <CardBody className="text-sm leading-relaxed text-ink-2">
          <ol className="flex list-decimal flex-col gap-1.5 pl-4">
            <li>LM Studio에서 모델을 다운로드해요.</li>
            <li>
              <b>Developer</b> 탭에서 서버를 켜요 (기본 포트 1234).
            </li>
            <li>
              여기서 <b>연결 확인</b> → 모델 선택 → <b>저장</b> → <b>응답 확인</b>.
            </li>
          </ol>
          <p className="text-xs text-ink-3">
            ERP 서버가 LM Studio를 부르므로 주소의 127.0.0.1은 <b>ERP 서버를 돌리는 컴퓨터</b>예요. 사용자 PC에는 LM Studio가 없어도 돼요.
          </p>
          <p className="text-xs text-ink-3">
            <b>LM Link</b>: GPU가 있는 다른 컴퓨터의 모델을 쓰려면 ERP 서버 컴퓨터의 LM Studio(또는 llmster)를 같은 Link에 넣어요. 원격 모델도 이 주소 그대로 목록에
            보여요.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function ConnectionBadge({ result, pending }: { result: LlmConnectionView | undefined; pending: boolean }) {
  if (pending) return <Badge tone="run">확인 중</Badge>;
  if (!result) return <Badge>확인 전</Badge>;
  return result.connected ? <Badge tone="ok">연결됨</Badge> : <Badge tone="danger">연결 안 됨</Badge>;
}

/**
 * 받은 목록에서 대화용 모델만 (임베딩 모델은 답을 만들지 못한다). 로드된 모델을 앞에 둔다.
 * 지금 고른 모델이 목록에 없으면 따로 표시해 선택이 사라지지 않게 한다.
 */
function modelOptions(result: LlmConnectionView | undefined, selected: string): { id: string; label: string }[] {
  const models = (result?.models ?? []).filter((m) => m.type !== 'embeddings').sort((a, b) => Number(b.loaded === true) - Number(a.loaded === true));
  const options = models.map((m) => ({ id: m.id, label: m.loaded ? `${m.id} · 로드됨` : m.id }));
  if (selected && !options.some((o) => o.id === selected)) options.unshift({ id: selected, label: `${selected} (지금 목록에 없음)` });
  return options;
}
