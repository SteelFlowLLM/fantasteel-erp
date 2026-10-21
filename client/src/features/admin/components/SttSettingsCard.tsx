'use client';

// 음성 인식(STT) 연결 카드 (문서에 없는 기능, Voice2ERP 1단계 · 이슈 #432): 방식(내 음성 서버 / OpenAI 방식 API)·주소·모델·API 키 저장, 연결 확인, 파일로 시험.
// 방식은 서버에 저장하지 않는다: 주소로 짐작하고, 바꾸면 주소·모델 기본값만 채운다.
// AI 연결(LLM) 카드와 같은 권한(ORG_MANAGE)을 쓴다(가정). LLM을 API로 바꿔도 음성은 이 설정을 따로 쓴다.
// 모델은 연결 확인으로 받은 목록(사이드카의 GET /v1/models, 이슈 #445)이 있으면 고르기 칸, 없으면 직접 입력이다.
import { useEffect, useRef, useState } from 'react';
import { STT_API_BASE_URL, type SttSettingsView } from '@fantasteel/shared';
import { sttApi, sttKeys } from '@/api/stt';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { QueryBoundary } from '@/components/QueryBoundary';
import { useAction } from '@/hooks/useAction';
import { STT_HOST_KIND_LABEL, STT_MODE_LABEL, classifySttHost, sttModeDefaults, sttModeOf, sttModelChoices, sameOriginUrl, type SttMode } from '@/lib/sttHost';
import { useSttConnectionTest, useSttSettings, useSttTranscribeTest } from '@/hooks/useStt';

/** active: 음성 인식 탭이 보이는 중. 처음 보일 때 저장된 설정으로 연결을 확인한다 (AI 모델 탭이 열 때 확인하는 것과 같게) */
export function SttSettingsCard({ canEdit, active }: { canEdit: boolean; active: boolean }) {
  const settings = useSttSettings();
  return (
    <QueryBoundary query={settings} loadingLabel="음성 인식 설정을 불러오는 중">
      {(data) => <SttSettingsForm key={`${data.baseUrl}|${data.model ?? ''}|${data.hasApiKey}`} saved={data} canEdit={canEdit} active={active} />}
    </QueryBoundary>
  );
}

function SttSettingsForm({ saved, canEdit, active }: { saved: SttSettingsView; canEdit: boolean; active: boolean }) {
  const [mode, setMode] = useState<SttMode>(sttModeOf(saved.baseUrl));
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
  const [model, setModel] = useState(saved.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const connection = useSttConnectionTest();
  const transcribe = useSttTranscribeTest();
  const save = useAction(sttApi.updateSettings, { success: '음성 인식 설정을 저장했어요', invalidate: [sttKeys.settings(), sttKeys.savedConnection()] });

  /** 주소 출처가 저장된 것과 같을 때만 저장된 키를 이어 쓴다 (서버도 같은 규칙: 다른 주소로 키가 새지 않게) */
  const keyCarriesOver = sameOriginUrl(baseUrl, saved.baseUrl);
  const savedKeyDropped = saved.hasApiKey && !keyCarriesOver && !clearApiKey;
  /** 입력한 키가 있으면 그 키, 지우기를 눌렀거나 주소가 다른 곳으로 바뀌었으면 빈 값, 아니면 저장된 키(undefined) */
  const apiKeyInput = (): string | undefined => (apiKey.trim() ? apiKey.trim() : clearApiKey || savedKeyDropped ? '' : undefined);
  const dirty = baseUrl.trim() !== saved.baseUrl || model.trim() !== (saved.model ?? '') || apiKey.trim() !== '' || clearApiKey;
  const result = connection.data;
  const models = result?.models ?? [];
  const test = transcribe.data;
  const host = classifySttHost(baseUrl);
  const changeMode = (next: SttMode) => {
    const defaults = sttModeDefaults(next);
    setMode(next);
    setApiKey('');
    connection.reset();
    setBaseUrl(defaults.baseUrl);
    setModel(defaults.model);
  };
  const runConnectionTest = () => connection.mutate({ baseUrl, model: model.trim() || null, apiKey: apiKeyInput() });

  // 탭을 처음 열 때 한 번, 저장된 설정으로 확인한다. 1초 무음을 실제로 보내므로 화면을 열자마자(다른 탭을 보는 중에)는 보내지 않는다.
  // 저장하면 새 값으로 다시 그려지며(key) 한 번 더 확인한다
  const autoChecked = useRef(false);
  const { mutate: checkConnection } = connection;
  useEffect(() => {
    if (!active || !canEdit || autoChecked.current) return;
    autoChecked.current = true;
    checkConnection({ baseUrl: saved.baseUrl });
  }, [active, canEdit, checkConnection, saved.baseUrl]);

  return (
    <Card petKey="card:sttSettings">
      <CardHead title="음성 인식 (STT)" meta={<SttBadge result={result} pending={connection.isPending} />} />
      <CardBody>
        <Field
          label="방식"
          hint={
            mode === 'server'
              ? '이 Mac이나 같은 망·Tailscale의 PC에서 켠 whisper.cpp·화자 분리 서버예요. 다른 PC의 서버면 그 터미널에 보이는 API 키를 넣어요'
              : 'OpenAI처럼 키로 쓰는 음성 인식 API예요. 회의 음성이 그 회사 서버로 나가요'
          }
        >
          <Select value={mode} onChange={(e) => changeMode(e.target.value as SttMode)} disabled={!canEdit} aria-label="음성 인식 방식">
            {(Object.keys(STT_MODE_LABEL) as SttMode[]).map((key) => (
              <option key={key} value={key}>
                {STT_MODE_LABEL[key]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="서버 주소"
          required
          hint={
            <>
              <b>{STT_HOST_KIND_LABEL[host.kind]}</b> · {host.note}
            </>
          }
          error={host.warn ? `${STT_HOST_KIND_LABEL[host.kind]}: ${host.note}` : null}
        >
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={!canEdit}
            invalid={host.warn}
            placeholder={mode === 'server' ? 'http://192.168.0.20:8000/v1' : STT_API_BASE_URL}
            spellCheck={false}
          />
        </Field>
        <Field
          label="모델"
          hint={
            models.length
              ? '연결 확인으로 받은 목록이에요. 화자 분리 모델이라야 회의록에서 누가 말했는지 나뉘어요'
              : mode === 'server'
                ? '연결 확인을 누르면 서버가 가진 모델이 목록으로 나와요 · whisper.cpp만 켰다면 비워 둬요'
                : 'OpenAI는 whisper-1'
          }
        >
          {models.length ? (
            <Select value={model} onChange={(e) => setModel(e.target.value)} disabled={!canEdit} aria-label="음성 인식 모델">
              <option value="">서버 기본값</option>
              {sttModelChoices(models, model).map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input value={model} onChange={(e) => setModel(e.target.value)} disabled={!canEdit} placeholder="비워 둠" spellCheck={false} aria-label="음성 인식 모델" />
          )}
        </Field>
        <Field
          label="API 키"
          hint={savedKeyDropped ? '주소가 바뀌어 저장된 키는 새 주소로 보내지 않아요. 저장하면 지워져요' : saved.hasApiKey && !clearApiKey ? '저장된 키가 있어요. 바꿀 때만 입력해요' : mode === 'server' ? '이 Mac에서만 켠 음성 서버면 비워 둬요. 다른 PC에 연 서버는 그 터미널의 "ERP에 넣을 API 키"를 넣어요' : 'API 회사에서 받은 키를 넣어요'}
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
        <Button className="ml-auto" icon="refresh" onClick={runConnectionTest} disabled={!canEdit || connection.isPending || !baseUrl.trim()}>
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

export function SttBadge({ result, pending }: { result: { connected: boolean } | undefined; pending: boolean }) {
  if (pending) return <Badge tone="run">확인 중</Badge>;
  if (!result) return <Badge>확인 전</Badge>;
  return result.connected ? <Badge tone="ok">연결됨</Badge> : <Badge tone="danger">연결 안 됨</Badge>;
}
