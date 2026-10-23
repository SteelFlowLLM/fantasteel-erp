'use client';

// 철강맨 아침 브리핑 바깥 틀 (셸에 하나). 로그인할 때마다 한 번 연다.
// 다시 열기는 철강맨AI 채팅·철강맨 펫 대화창의 /브리핑이 맡는다(useBriefingStore.openBriefing).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BriefingDialog } from '@/features/briefing/BriefingDialog';
import { useMe } from '@/hooks/useMe';
import { takeBriefingAfterLogin, useBriefingStore } from '@/stores/useBriefingStore';

export function MorningBriefing() {
  const me = useMe();
  const open = useBriefingStore((s) => s.open);
  const openBriefing = useBriefingStore((s) => s.openBriefing);
  const closeBriefing = useBriefingStore((s) => s.closeBriefing);
  const [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 로그인 직후 표시가 있으면 연다. 새로고침·새 탭 자동 로그인에는 표시가 없어 열지 않는다
  useEffect(() => {
    setReady(true);
    if (takeBriefingAfterLogin()) openBriefing();
  }, [me.employeeId, openBriefing]);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  if (!ready || !mounted) return null;
  return createPortal(<BriefingDialog open={open} onClose={closeBriefing} />, document.body);
}
