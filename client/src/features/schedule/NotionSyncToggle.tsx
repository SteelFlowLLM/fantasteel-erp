'use client';

// 일정을 회사 Notion(일정 데이터베이스·캘린더)에도 넣을지 고르는 칸 (이슈 #434). 회의록 일정 후보·철강맨AI 일정 카드·내 일정 등록 창이 같이 쓴다.
// Notion이 아직 준비되지 않아도 고를 수 있다: 켜 둔 일정은 관리자가 Notion을 준비하면 그때 올라간다.
import { useScheduleNotionStatus } from '@/hooks/useScheduleEvents';

export const NOTION_REMOVAL_HINT = '이미 Notion에 올라간 일정이에요. 저장하면 다음 반영 때 Notion 페이지는 휴지통으로 옮기고 Notion 캘린더 일정은 취소해요';

/**
 * 후보·카드 본문의 'Notion 캘린더' 값. 켜 두었어도 Notion이 준비 전이면 아직 올라가지 않으므로 고르는 칸의 안내와 같은 뜻으로 보인다 (#519)
 */
export function NotionSyncValue({ on }: { on: boolean }) {
  const status = useScheduleNotionStatus();
  if (!on) return <span className="text-ink-3">넣지 않음 (ERP 일정만)</span>;
  if (status.data && !status.data.ready) return <span title={status.data.reason ?? undefined}>켜 둠 · Notion 준비 전이라 준비되면 올라가요</span>;
  return <>함께 넣음</>;
}

/** published: 이미 Notion에 올라간 일정. 이때 끄면 무엇이 일어나는지 알린다 */
export function NotionSyncToggle({ id, checked, published = false, disabled = false, onChange }: { id: string; checked: boolean; published?: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const status = useScheduleNotionStatus();
  const hint = published && !checked
    ? NOTION_REMOVAL_HINT
    : !status.data
    ? null
    : status.data.ready
      ? `Notion 일정 데이터베이스${status.data.calendarName ? `와 캘린더 "${status.data.calendarName}"` : ''}에 올라가요`
      : `지금은 넣을 수 없어요 (${status.data.reason ?? 'Notion을 쓸 수 없어요'}). 켜 두면 준비된 뒤 올라가요`;
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="inline-flex items-center gap-1.5 text-sm">
        <input id={id} type="checkbox" className="size-3.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        Notion 캘린더에도 넣기
      </label>
      {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
    </div>
  );
}
