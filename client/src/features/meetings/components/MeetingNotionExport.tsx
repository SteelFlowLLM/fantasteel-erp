'use client';

// 회의록 상세 머리의 Notion 내보내기 (이슈 #358). 확정된 회의록을 회사 Notion의 상위 페이지 아래에 새 페이지로 내보낸다 (한 번만).
// 이미 내보냈으면 버튼 대신 "Notion에서 보기" 링크를 보인다. 버튼은 연결·상위 페이지가 준비됐고 작성자 또는 ORG_MANAGE 사용 권한일 때만 보인다.
import { useQueryClient } from '@tanstack/react-query';
import { MEETING_MINUTES_STATUS } from '@fantasteel/shared';
import { meetingMinutesApi, meetingMinutesKeys, type MeetingMinutesView } from '@/api/meetingMinutes';
import { Icon } from '@/components/Icon';
import { Button } from '@/components/Button';
import { useAction } from '@/hooks/useAction';
import { useIntegrations } from '@/hooks/useIntegrations';
import { useMe } from '@/hooks/useMe';
import { fmtDateTime } from '@/lib/format';
import { canExportMeetingToNotion, notionConnection, safeExternalUrl } from '@/lib/integrations';

export function MeetingNotionExport({ minutes }: { minutes: MeetingMinutesView }) {
  const link = safeExternalUrl(minutes.notionPageUrl);
  if (link) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-ink-3">
        {minutes.notionExportedAt ? <span>{fmtDateTime(minutes.notionExportedAt)} 내보냄</span> : null}
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink no-underline hover:border-[#a9b3be] hover:bg-surface-2"
        >
          <Icon name="share" size="sm" />
          Notion에서 보기
        </a>
      </span>
    );
  }
  if (minutes.meetingMinutesStatus !== MEETING_MINUTES_STATUS.CONFIRMED) return null;
  return <ExportButton minutes={minutes} />;
}

function ExportButton({ minutes }: { minutes: MeetingMinutesView }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const integrations = useIntegrations();
  const exportToNotion = useAction(meetingMinutesApi.exportToNotion, {
    success: 'Notion으로 내보냈어요',
    onSuccess: (result) => queryClient.setQueryData(meetingMinutesKeys.detail(me.employeeId, minutes.id), result.meetingMinutes),
  });

  if (!canExportMeetingToNotion(minutes, me, notionConnection(integrations.data))) return null;
  return (
    <Button size="sm" icon="share" onClick={() => exportToNotion.mutate(minutes.id)} disabled={exportToNotion.isPending} aria-busy={exportToNotion.isPending}>
      {exportToNotion.isPending ? 'Notion으로 보내는 중…' : 'Notion으로 내보내기'}
    </Button>
  );
}
