import type { Metadata } from 'next';
import { DriveFilesScreen } from '@/features/drive/DriveFilesScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/drive') };

export default function DrivePage() {
  return <DriveFilesScreen />;
}
