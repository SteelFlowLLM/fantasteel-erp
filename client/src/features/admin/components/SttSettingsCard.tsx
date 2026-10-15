'use client';

// 음성 인식(STT) 연결 카드 (문서에 없는 기능, Voice2ERP 1단계): whisper.cpp 서버 주소·모델·API 키 저장, 연결 확인, 파일로 시험.
// AI 연결(LLM) 카드와 같은 권한(ORG_MANAGE)을 쓴다(가정).
import { useRef, useState } from 'react';
import { STT_DEFAULT_BASE_URL, type SttSettingsView } from '@fantasteel/shared';
import { sttApi, sttKeys } from '@/api/stt';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { QueryBoundary } from '@/components/QueryBoundary';
import { useAction } from '@/hooks/useAction';
import { useSttConnectionTest, useSttSettings, useSttTranscribeTest } from '@/hooks/useStt';

export function SttSettingsCard({ canEdit }: { canEdit: boolean }) {
  const settings = useSttSettings();
  return (
    <QueryBoundary query={settings} loadingLabel="음성 인식 설정을 불러오는 중">
      {(data) => <SttSettingsForm key={`${data.baseUrl}|${data.model ?? ''}|${data.hasApiKey}`} saved={data} canEdit={canEdit} />}
    </QueryBoundary>
  );
}

function SttSettingsForm({ saved, canEdit }: { saved: SttSettingsView; canEdit: boolean }) {
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
  const [model, setModel] = useState(saved.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const connection = useSttConnectionTest();
  const transcribe = useSttTranscribeTest();
  const save = useAction(sttApi.updateSettings, { success: '음성 인식 설정을 저장했어요', invalidate: [sttKeys.settings()] });

  /** 입력한 키가 있으면 그 키, 지우기를 눌렀으면 빈 값, 아니면 저장된 키(undefined) */
  const apiKeyInput = (): string | undefined => (apiKey.trim() ? apiKey.trim() : clearApiKey ? '' : undefined);
  const dirty = baseUrl.trim() !== saved.baseUrl || model.trim() !== (saved.model ?? '') || apiKey.trim() !== '' || clearApiKey;
  const result = connection.data;
  const test = transcribe.data;

  return (
    <Card petKey="card:sttSettings">
      <CardHead title="음성 인식 (STT)" meta={<SttBadge result={result} pending={connection.isPending} />} />
      <CardBody>
        <Field label="서버 주소" required hint={`whisper.cpp 기본값 ${STT_DEFAULT_BASE_URL} · OpenAI 호환 주소(…/v1)`}>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={!canEdit} placeholder={STT_DEFAULT_BASE_URL} spellCheck={false} />
        </Field>
        <Field label="모델" hint="whisper.cpp는 비워 두면 됨 · OpenAI는 whisper-1">
          <Input value={model} onChange={(e) => setModel(e.target.value)} disabled={!canEdit} placeholder="비워 둠" spellCheck={false} />
        </Field>
        <Field
          label="API 키"
          hint={saved.hasApiKey && !clearApiKey ? '저장된 키가 있어요. 바꿀 때만 입력해요' : 'whisper.cpp는 비워 둬요. 외부 서버를 쓸 때만 입력해요'}
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
        {test ? (
          test.ok ? (
            <Banner tone="ok" icon="check-circle">
              <span className="font-medium">구간 {test.segmentCount}개</span>
              {test.durationSec !== null ? ` · ${test.durationSec.toFixed(1)}초` : ''} · {test.latencyMs}ms — {test.text || '(인식된 글 없음)'}
            </Banner>
          ) : (
            <Banner tone="danger" icon="alert">
              {test.error}
            </Banner>
          )
        ) : null}
        {transcribe.error ? (
          <Banner tone="danger" icon="alert">
            {transcribe.error instanceof Error ? transcribe.error.message : '파일 시험에 실패했어요'}
          </Banner>
        ) : null}
      </CardBody>
      <CardFoot>
        {result?.connected ? <span className="text-xs text-ink-3">{result.latencyMs}ms</span> : null}
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/webm"
          aria-label="시험할 오디오 파일"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) transcribe.mutate(file);
          }}
        />
        <Button className="ml-auto" icon="refresh" onClick={() => connection.mutate({ baseUrl, apiKey: apiKeyInput() })} disabled={!canEdit || connection.isPending || !baseUrl.trim()}>
          {connection.isPending ? '확인 중…' : '연결 확인'}
        </Button>
        <Button variant="ai-outline" onClick={() => fileInput.current?.click()} disabled={!canEdit || transcribe.isPending || dirty}>
          {transcribe.isPending ? '글로 바꾸는 중…' : '파일로 시험'}
        </Button>
        <Button
          variant="primary"
          onClick={() => save.mutate({ baseUrl, model: model.trim() || null, apiKey: apiKeyInput() }, { onSuccess: () => transcribe.reset() })}
          disabled={!canEdit || !dirty || save.isPending || !baseUrl.trim()}
        >
          저장
        </Button>
      </CardFoot>
    </Card>
  );
}

function SttBadge({ result, pending }: { result: { connected: boolean } | undefined; pending: boolean }) {
  if (pending) return <Badge tone="run">확인 중</Badge>;
  if (!result) return <Badge>확인 전</Badge>;
  return result.connected ? <Badge tone="ok">연결됨</Badge> : <Badge tone="danger">연결 안 됨</Badge>;
}
