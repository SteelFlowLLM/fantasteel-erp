import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/past-cases') };

export default function PastCasePage() {
  return <StagePlaceholder stage={6} soon={{ grade: 'EX', title: '과거 사례 검색' }} />;
}
