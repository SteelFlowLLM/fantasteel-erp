'use client';

// 외부 연결 카드의 연결 상태 (문서에 없는 기능, 이슈 #518): 정상·주의·끊김 배지, 마지막 오류와 그 시각, 해결되지 않은 장애.
// 장애는 서버가 연동 관리 권한자에게 알림으로도 알린다 (같은 장애는 하루 한 번, 풀리면 복구 알림).
import { INTEGRATION_FAULT_KIND_LABEL } from '@fantasteel/shared';
import type { IntegrationConnectionView } from '@/api/integrations';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { fmtDateTime, relTime } from '@/lib/format';
import {
  INTEGRATION_HEALTH_LABEL,
  INTEGRATION_HEALTH_TONE,
  INTEGRATION_STATUS_LABEL,
  INTEGRATION_STATUS_TONE,
  integrationFaultLine,
  showIntegrationHealth,
} from '@/lib/integrations';

/** 카드 머리의 배지: 연결 상태(연결됨·다시 연결 필요·연결 안 됨)와, 보일 때 정상·주의·끊김 */
export function IntegrationStatusBadges({ connection }: { connection: Pick<IntegrationConnectionView, 'status' | 'health'> }) {
  const { status, health } = connection;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={INTEGRATION_STATUS_TONE[status]}>{INTEGRATION_STATUS_LABEL[status]}</Badge>
      {showIntegrationHealth(connection) ? (
        <Badge tone={INTEGRATION_HEALTH_TONE[health.level]} title="연결이 지금 쓸 수 있는 상태인지: 정상 · 주의(일시 실패·반영 실패) · 끊김(다시 연결하거나 서버 설정을 고쳐야 해요)">
          {INTEGRATION_HEALTH_LABEL[health.level]}
        </Badge>
      ) : null}
    </span>
  );
}

/** 마지막 오류(시각 포함)와 해결되지 않은 장애 목록. 둘 다 없으면 아무것도 그리지 않는다 */
export function IntegrationHealthNotes({ connection }: { connection: Pick<IntegrationConnectionView, 'lastError' | 'health'> }) {
  const { lastError, health } = connection;
  return (
    <>
      {lastError ? (
        <Banner tone="danger" icon="alert">
          <span className="text-cap font-medium">
            마지막 오류{health.lastErrorAt ? ` · ${fmtDateTime(health.lastErrorAt)} (${relTime(health.lastErrorAt)})` : ''}
          </span>
          <div className="break-words">{lastError}</div>
        </Banner>
      ) : null}
      {health.faults.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-line p-3" data-testid="integration-faults">
          <span className="text-xs font-semibold text-ink-2">풀리지 않은 장애</span>
          <ul className="flex flex-col gap-1.5">
            {health.faults.map((fault) => (
              <li key={fault.faultKind} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-cap text-ink-2">
                  <Badge tone={fault.faultKind === 'RECONNECT_REQUIRED' || fault.faultKind === 'CREDENTIAL_ERROR' ? 'danger' : 'wait'}>{INTEGRATION_FAULT_KIND_LABEL[fault.faultKind]}</Badge>
                  {integrationFaultLine(fault)}
                </span>
                <span className="break-words text-cap text-ink-3">처음 {fmtDateTime(fault.firstFailedAt)} · {fault.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
