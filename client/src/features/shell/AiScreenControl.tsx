'use client';

// 철강맨AI ERP 화면 조작 (이슈 #382, 문서에 없는 기능·시험 중). 화면 동작 실행기(lib/aiScreenAgent.ts)에 라우터와 열 수 있는 화면을 알려 두고,
// 조작하는 동안 위에 배너를 보인다. 멈추기는 답 멈추기와 같다 (서버가 기다리던 동작도 지운다).
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { routeTitleOf } from '@/features/shell/routeTitles';
import { canOpenScreen, SCREENS } from '@/features/shell/screens';
import { stopAiAssistant } from '@/hooks/useAiAssistant';
import { useMe } from '@/hooks/useMe';
import { registerScreenAgent, useAiScreenControlStore } from '@/lib/aiScreenAgent';

export function AiScreenControl() {
  const router = useRouter();
  const me = useMe();
  const running = useAiScreenControlStore((state) => state.running);
  // 이 사원이 여는 화면(준비 중 제외). ui_navigate는 이 주소만 연다
  const screens = useMemo(
    () => SCREENS.filter((def) => !def.soon && canOpenScreen(me, def.access)).map((def) => ({ path: def.href, title: routeTitleOf(def.href).title || def.label })),
    [me],
  );

  useEffect(() => {
    registerScreenAgent({ navigate: (path) => router.push(path), screens, title: (pathname) => routeTitleOf(pathname).title });
    return () => registerScreenAgent(null);
  }, [router, screens]);

  if (!running) return null;
  return (
    <div data-ai-skip="" role="status" className="flex flex-none items-center gap-2 border-b border-steelman bg-steelman-soft px-4 py-1.5 text-sm font-semibold text-steelman-ink">
      <Icon name="dashboard" size="sm" />
      AI가 화면을 조작하고 있어요 · 저장·확정은 직접 눌러 주세요
      <Button size="sm" icon="x-circle" className="ml-auto" onClick={stopAiAssistant}>
        멈추기
      </Button>
    </div>
  );
}
