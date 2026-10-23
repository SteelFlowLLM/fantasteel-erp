import type { Metadata } from 'next';
import { LlmSettingsScreen } from '@/features/admin/components/LlmSettingsScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/admin/llm') };

export default function LlmSettingsPage() {
  return <LlmSettingsScreen />;
}
