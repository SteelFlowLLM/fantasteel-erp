'use client';

// 철강맨 부르기 회사 설정 (문서에 없는 기능, 이슈 #457): 관리자가 회사 전체로 부르기·말로 승인을 끄고 켠다.
// 음성 설정과 같은 권한(ORG_MANAGE). 켜 있어도 사원마다 철강맨AI 패널의 마이크 스위치(기본 꺼짐)를 켜야 듣는다.
import { useState } from 'react';
import type { SteelmanWakeSettingsView } from '@fantasteel/shared';
import { aiAssistantKeys } from '@/api/aiAssistant';
import { sttApi, sttKeys } from '@/api/stt';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { QueryBoundary } from '@/components/QueryBoundary';
import { useAction } from '@/hooks/useAction';
import { useSteelmanWakeSettings } from '@/hooks/useStt';

export function SteelmanWakeSettingsCard({ canEdit }: { canEdit: boolean }) {
  const settings = useSteelmanWakeSettings();
  return (
    <QueryBoundary query={settings} loadingLabel="철강맨 부르기 설정을 불러오는 중">
      {(data) => <SteelmanWakeSettingsForm key={`${data.enabled}|${data.voiceApproval}`} saved={data} canEdit={canEdit} />}
    </QueryBoundary>
  );
}

function SteelmanWakeSettingsForm({ saved, canEdit }: { saved: SteelmanWakeSettingsView; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(saved.enabled);
  const [voiceApproval, setVoiceApproval] = useState(saved.voiceApproval);
  // 사원 화면이 스위치를 숨기고 마이크를 끄도록 철강맨AI 기능 정보도 다시 읽게 한다
  const save = useAction(sttApi.updateWakeSettings, { success: '철강맨 부르기 설정을 저장했어요', invalidate: [sttKeys.wakeSettings(), aiAssistantKeys.capabilities] });
  const dirty = enabled !== saved.enabled || (enabled && voiceApproval !== saved.voiceApproval);

  return (
    <Card petKey="card:llmSettings.steelmanWake">
      <CardHead title="철강맨 부르기" />
      <CardBody>
        <Field label="철강맨 부르기 쓰기" hint="끄면 모든 사원의 마이크 스위치가 사라지고 듣던 마이크도 꺼져요. 켜 있어도 사원이 각자 켜야 들어요">
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} />
            {enabled ? '켜짐 — 사원이 "철강맨~"으로 불러 물을 수 있어요' : '꺼짐 — 아무도 부를 수 없어요'}
          </label>
        </Field>
        <Field label="말로 승인 허용" hint="켜면 사원이 각자 허용한 경우에만 업무·일정·구매요청 초안 카드를 '실행'이라는 말로 실행해요. 목소리로 사람을 가리지 않아요">
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={enabled && voiceApproval} disabled={!canEdit || !enabled} onChange={(e) => setVoiceApproval(e.target.checked)} />
            {enabled && voiceApproval ? '켜짐' : '꺼짐 — 카드는 화면에서 눌러 실행해요'}
          </label>
        </Field>
      </CardBody>
      <CardFoot>
        <Button className="ml-auto" variant="primary" disabled={!canEdit || !dirty || save.isPending} onClick={() => save.mutate({ enabled, voiceApproval: enabled && voiceApproval })}>
          저장
        </Button>
      </CardFoot>
    </Card>
  );
}
