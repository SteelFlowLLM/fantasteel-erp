'use client';

// 이 Mac의 음성 서버 켜기·끄기 (문서에 없는 기능, 이슈 #450). ERP 서버가 macOS이고 자동 켜기(start.sh --install)가 등록됐을 때만 버튼이 된다.
// ERP 서버가 다른 컴퓨터면 그 컴퓨터의 음성 서버를 여기서 켤 수 없어 카드를 숨긴다(음성 서버 컴퓨터의 자동 켜기를 쓴다).
import { sttApi, sttKeys } from '@/api/stt';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { useAction } from '@/hooks/useAction';
import { useSttLocalServer } from '@/hooks/useStt';

export function SttLocalServerCard({ canEdit }: { canEdit: boolean }) {
  const query = useSttLocalServer();
  const start = useAction(sttApi.startLocalServer, { success: '음성 서버를 켰어요', invalidate: [sttKeys.localServer()] });
  const stop = useAction(sttApi.stopLocalServer, { success: '음성 서버를 껐어요. 다음 로그인 때 다시 켜져요', invalidate: [sttKeys.localServer()] });
  const status = query.data;
  if (!status?.supported) return null;
  const busy = start.isPending || stop.isPending;

  return (
    <Card petKey="card:sttSettings.localServer">
      <CardHead title="이 Mac의 음성 서버" meta={<LocalServerBadge running={status.running} healthy={status.healthy} installed={status.installed} />} />
      <CardBody className="text-sm leading-relaxed text-ink-2">
        {status.installed ? (
          <p className="text-xs text-ink-3">
            ERP 서버와 같은 Mac에서 돌아가는 음성 서버예요. 로그인하면 저절로 켜지고, 여기서 끄면 다음 로그인 때 다시 켜져요.
            {status.pid ? ` (프로세스 ${status.pid})` : ''}
          </p>
        ) : null}
        {status.message ? (
          <Banner tone={status.installed ? 'run' : 'neutral'} icon="info">
            {status.message}
          </Banner>
        ) : null}
        {status.logPath ? <p className="text-cap break-all text-ink-3">로그: {status.logPath}</p> : null}
      </CardBody>
      {status.installed ? (
        <CardFoot>
          <Button className="ml-auto" onClick={() => stop.mutate()} disabled={!canEdit || busy || !status.running}>
            {stop.isPending ? '끄는 중…' : '끄기'}
          </Button>
          <Button variant="primary" onClick={() => start.mutate()} disabled={!canEdit || busy}>
            {start.isPending ? '켜는 중…' : status.running ? '다시 켜기' : '켜기'}
          </Button>
        </CardFoot>
      ) : null}
    </Card>
  );
}

function LocalServerBadge({ running, healthy, installed }: { running: boolean; healthy: boolean; installed: boolean }) {
  if (!installed) return <Badge>등록 안 됨</Badge>;
  if (running && healthy) return <Badge tone="ok">켜짐</Badge>;
  if (running) return <Badge tone="run">켜는 중</Badge>;
  return <Badge tone="danger">꺼짐</Badge>;
}
