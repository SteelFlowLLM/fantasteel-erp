'use client';

// 철강맨AI 브라우저 사용의 열 수 있는 주소 설정 (문서에 없는 기능, 이슈 #430): 시작 사이트 목록과 '모든 사이트 열기' 스위치.
// AI 연결(LLM) 카드와 같은 권한(ORG_MANAGE)을 쓴다. 사내 주소·로그인·결제 막기는 어떤 설정에서도 그대로다.
import { useState } from 'react';
import type { LlmBrowserSettingsView } from '@fantasteel/shared';
import { llmApi, llmKeys } from '@/api/llm';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { QueryBoundary } from '@/components/QueryBoundary';
import { useAction } from '@/hooks/useAction';
import { useLlmBrowserSettings } from '@/hooks/useLlm';
import { parseStartSiteInput } from '@/lib/aiBrowser';

export function BrowserSettingsCard({ canEdit }: { canEdit: boolean }) {
  const settings = useLlmBrowserSettings();
  return (
    <QueryBoundary query={settings} loadingLabel="브라우저 설정을 불러오는 중">
      {(data) => <BrowserSettingsForm key={`${data.startSites?.join(',') ?? 'default'}|${data.openAllSites}`} saved={data} canEdit={canEdit} />}
    </QueryBoundary>
  );
}

function BrowserSettingsForm({ saved, canEdit }: { saved: LlmBrowserSettingsView; canEdit: boolean }) {
  // 저장한 목록이 없으면 지금 쓰는(env·기본) 목록에서 시작하되, 손대지 않고 저장하면 기본값 그대로 둔다
  const [sites, setSites] = useState<string[]>(saved.effectiveStartSites);
  const [customized, setCustomized] = useState(saved.startSites !== null);
  const [openAll, setOpenAll] = useState(saved.openAllSites);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(llmApi.updateBrowserSettings, { success: '브라우저 설정을 저장했어요', invalidate: [llmKeys.browserSettings()] });

  const dirty = openAll !== saved.openAllSites || (customized && sites.join(',') !== (saved.startSites ?? saved.effectiveStartSites).join(',')) || customized !== (saved.startSites !== null);

  const addSite = () => {
    if (!draft.trim()) return;
    const host = parseStartSiteInput(draft);
    if (!host) {
      setProblem('도메인 모양으로 적어 주세요 (예: kosis.kr)');
      return;
    }
    setProblem(null);
    setDraft('');
    if (sites.includes(host)) return;
    setCustomized(true);
    setSites([...sites, host]);
  };

  const removeSite = (host: string) => {
    setCustomized(true);
    setSites(sites.filter((site) => site !== host));
  };

  const resetSites = () => {
    setCustomized(false);
    setSites(saved.defaultStartSites);
  };

  return (
    <Card petKey="card:llmSettings.browser">
      <CardHead title="철강맨AI 브라우저 — 열 수 있는 주소" />
      <CardBody>
        <Field label="시작 사이트" hint="링크 없이도 브라우저로 열 수 있는 사이트예요(하위 도메인 포함). 저장하면 서버 설정(BROWSER_START_SITES)보다 이 목록을 먼저 써요">
          <div className="flex flex-col gap-2">
            <ul className="flex flex-wrap gap-1.5" aria-label="시작 사이트 목록">
              {sites.length === 0 ? <li className="text-cap text-ink-3">시작 사이트가 없어요. 검색 결과·질문에 적은 주소만 열어요</li> : null}
              {sites.map((host) => (
                <li key={host} className="inline-flex items-center gap-1 rounded-sm border border-line-strong bg-surface px-2 py-0.5 text-cap text-ink-2">
                  <span className="font-mono">{host}</span>
                  {canEdit ? (
                    <button type="button" aria-label={`${host} 빼기`} className="text-ink-3 hover:text-ink" onClick={() => removeSite(host)}>
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSite();
                    }
                  }}
                  placeholder="추가할 도메인 (예: kosis.kr)"
                  spellCheck={false}
                  aria-label="추가할 시작 사이트"
                  className="flex-1"
                />
                <Button onClick={addSite} disabled={!draft.trim()}>
                  추가
                </Button>
                {customized ? (
                  <Button variant="ghost" onClick={resetSites} title="저장한 목록을 지우고 서버 기본 목록으로 돌아가요">
                    기본값으로
                  </Button>
                ) : null}
              </div>
            ) : null}
            {problem ? <p role="alert" className="text-cap text-danger">{problem}</p> : null}
          </div>
        </Field>
        <Field label="모든 사이트 열기" hint="켜면 검색 결과·질문·시작 사이트에 없는 바깥 주소도 열어요. 사내 주소 막기, 주소에 회사 정보 막기, 로그인·결제·폼 제출 막기는 그대로예요">
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={openAll} disabled={!canEdit} onChange={(e) => setOpenAll(e.target.checked)} />
            {openAll ? '켜짐 — 어떤 바깥 사이트든 열어요' : '꺼짐 — 목록·검색 결과·질문에 있는 주소만 열어요'}
          </label>
        </Field>
        {openAll ? (
          <Banner tone="wait" icon="alert">
            웹 페이지 글이 AI를 다른 곳으로 이끌 수 있어요. 목록 밖 사이트의 글도 AI가 읽고 따라 움직일 수 있으니, 꼭 필요할 때만 켜 두세요.
          </Banner>
        ) : null}
      </CardBody>
      <CardFoot>
        <Button
          className="ml-auto"
          variant="primary"
          disabled={!canEdit || !dirty || save.isPending}
          onClick={() => save.mutate({ startSites: customized ? sites : null, openAllSites: openAll })}
        >
          저장
        </Button>
      </CardFoot>
    </Card>
  );
}
