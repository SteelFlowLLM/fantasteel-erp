'use client';

// 보고서 내보내기 (이슈 #521): 보고 있는 판을 PDF로 내려받고, 완료한 조사는 Notion으로 내보낸다.
// Notion은 다시 내보낼 수 있고 그때마다 새 페이지를 만든다(회의록 내보내기와 같은 상위 페이지). 다시 내보낼 때는 한 번 더 묻는다.
import type { AiResearchRunView } from '@fantasteel/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { aiResearchApi } from '@/api/aiResearch';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { useAction } from '@/hooks/useAction';
import { useIntegrations } from '@/hooks/useIntegrations';
import { researchPdfName } from '@/lib/aiResearch';
import { isNotionExportReady, notionConnection, safeExternalUrl } from '@/lib/integrations';
import { toast } from '@/stores/useToastStore';

/** 받은 파일을 브라우저 내려받기로 넘긴다 */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // 내려받기가 시작된 뒤에 풀어야 해서 한 박자 늦춘다
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** 이미 내보낸 Notion 페이지 링크 (마지막으로 내보낸 것) */
export function ResearchNotionLink({ run }: { run: AiResearchRunView }) {
  const link = safeExternalUrl(run.notionPageUrl);
  if (!link) return null;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      title={run.notionExportedVersion ? `${run.notionExportedVersion}판을 내보낸 페이지` : '마지막으로 내보낸 페이지'}
      className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink no-underline hover:border-[#a9b3be] hover:bg-surface-2"
    >
      <Icon name="share" size="sm" />
      Notion에서 보기
    </a>
  );
}

/**
 * 보고서 카드의 [PDF]·[Notion으로 내보내기]. version은 보고 있는 앞 판 (지금 판이면 null).
 * PDF는 보고서가 있으면 언제나, Notion은 완료한 조사이고 연결·상위 페이지가 준비됐을 때만.
 */
export function AiResearchReportExports({ run, version }: { run: AiResearchRunView; version: number | null }) {
  const integrations = useIntegrations();
  const [confirming, setConfirming] = useState(false);
  const shownVersion = version ?? run.versions.at(-1)?.version ?? null;
  const pdf = useMutation({
    mutationFn: () => aiResearchApi.pdf(run.id, version ?? undefined),
    onSuccess: (blob) => {
      saveBlob(blob, researchPdfName(run.id, shownVersion));
      toast.ok('보고서 PDF를 내려받았어요');
    },
    onError: (error) => toast.apiError(error),
  });
  const exportToNotion = useAction(() => aiResearchApi.exportToNotion(run.id, version ?? undefined), {
    success: shownVersion ? `${shownVersion}판을 Notion으로 내보냈어요` : 'Notion으로 내보냈어요',
    onSuccess: () => setConfirming(false),
  });
  const notionReady = run.status === 'COMPLETED' && isNotionExportReady(notionConnection(integrations.data));
  const again = Boolean(run.notionPageUrl);
  return (
    <>
      <Button size="sm" icon="download" disabled={pdf.isPending} aria-busy={pdf.isPending} onClick={() => pdf.mutate()}>
        {pdf.isPending ? 'PDF 만드는 중…' : 'PDF'}
      </Button>
      {notionReady ? (
        <Button size="sm" icon="share" disabled={exportToNotion.isPending} aria-busy={exportToNotion.isPending} onClick={() => (again ? setConfirming(true) : exportToNotion.mutate(undefined))}>
          {exportToNotion.isPending ? 'Notion으로 보내는 중…' : again ? 'Notion으로 다시 내보내기' : 'Notion으로 내보내기'}
        </Button>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title="Notion으로 다시 내보내기"
          confirmLabel="새 페이지로 내보내기"
          pending={exportToNotion.isPending}
          onConfirm={() => exportToNotion.mutate(undefined)}
          onCancel={() => setConfirming(false)}
        >
          {shownVersion ? `${shownVersion}판` : '지금 보고서'}를 Notion에 <b>새 페이지</b>로 하나 더 만들어요. 앞서 내보낸 페이지{run.notionExportedVersion ? `(${run.notionExportedVersion}판)` : ''}는 그대로 남고, 이 조사의 [Notion에서 보기]는 새 페이지로 바뀌어요.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
