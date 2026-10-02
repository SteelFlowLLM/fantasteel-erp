import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TaskNotificationScreen } from '@/features/tasks/TaskNotificationScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/tasks') };

export default function TaskNotificationPage() {
  // 주소의 tab·notification·task를 읽으므로 Suspense로 감싼다 (Next.js useSearchParams)
  return (
    <Suspense fallback={null}>
      <TaskNotificationScreen />
    </Suspense>
  );
}
