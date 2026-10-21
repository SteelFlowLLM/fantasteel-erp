'use client';

// 철강맨 부르기 회사 설정 (문서에 없는 기능, 이슈 #457): 관리자가 회사 전체로 부르기·말로 승인을 끄고 켠다.
// 음성 설정과 같은 권한(ORG_MANAGE). 켜 있어도 사원마다 철강맨AI 패널의 마이크 스위치(기본 꺼짐)를 켜야 듣는다.
// 체크 칸 하나로는 끄는 곳이 보이지 않아 [켜기 | 끄기]를 둘 다 보이고, 저장한 상태는 머리의 배지로 보인다.
import { useState } from 'react';
import type { SteelmanWakeSettingsView } from '@fantasteel/shared';
import { aiAssistantKeys } from '@/api/aiAssistant';
import { sttApi, sttKeys } from '@/api/stt';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Segmented } from '@/components/Tabs';
import { useAction } from '@/hooks/useAction';
import { useSteelmanWakeSettings } from '@/hooks/useStt';

type OnOff = 'on' | 'off';
const ON_OFF: readonly { key: OnOff; label: string }[] = [
  { key: 'on', label: '켜기' },
  { key: 'off', label: '끄기' },
];
const toKey = (on: boolean): OnOff => (on ? 'on' : 'off');

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
  const nextVoiceApproval = enabled && voiceApproval;
  const dirty = enabled !== saved.enabled || nextVoiceApproval !== saved.voiceApproval;

  return (
    <Card petKey="card:llmSettings.steelmanWake">
      <CardHead title="철강맨 부르기" meta={<Badge tone={saved.enabled ? 'ok' : 'neutral'}>{saved.enabled ? '켜짐' : '꺼짐'}</Badge>} />
      <CardBody>
        {/* 권한이 없으면 fieldset이 안의 단추를 모두 막는다 */}
        <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-3">
          <Field label="철강맨 부르기 쓰기" hint={enabled ? '사원이 패널의 마이크를 켜고 "철강맨~"으로 불러 물을 수 있어요. 사원이 각자 켜야 들어요' : '모든 사원의 마이크 스위치가 사라지고, 듣던 마이크도 꺼져요'}>
            <div>
              <Segmented<OnOff> ariaLabel="철강맨 부르기 쓰기" items={ON_OFF} active={toKey(enabled)} onChange={(key) => setEnabled(key === 'on')} />
            </div>
          </Field>
          <Field
            label="말로 승인 허용"
            hint={
              !enabled
                ? '철강맨 부르기를 끄면 말로 승인도 꺼져요'
                : voiceApproval
                  ? "사원이 각자 허용하면 업무·일정·구매요청 초안 카드를 '실행'이라는 말로 실행해요. 목소리로 사람을 가리지 않아요"
                  : '카드는 화면에서 눌러 실행해요'
            }
          >
            <fieldset disabled={!enabled} className="min-w-0 disabled:opacity-50">
              <Segmented<OnOff> ariaLabel="말로 승인 허용" items={ON_OFF} active={toKey(nextVoiceApproval)} onChange={(key) => setVoiceApproval(key === 'on')} />
            </fieldset>
          </Field>
          <p className="text-cap text-ink-3">받아쓰기는 음성 인식 탭에 연결한 음성 서버로 해요. 소리는 회사 밖으로 나가지 않아요.</p>
        </fieldset>
      </CardBody>
      <CardFoot>
        {dirty ? <span className="text-cap font-medium text-wait">저장해야 적용돼요</span> : null}
        <Button className="ml-auto" variant="primary" disabled={!canEdit || !dirty || save.isPending} onClick={() => save.mutate({ enabled, voiceApproval: nextVoiceApproval })}>
          저장
        </Button>
      </CardFoot>
    </Card>
  );
}
