'use client';

// Drive에서 녹음 고르기 (이슈 #361). 관리자가 정한 회사 Drive 폴더 바로 아래의 녹음을 최신 수정순으로 보이고, 하나를 골라 회의록으로 가져온다.
// 목록·고르기는 공용 DriveFilePicker를 쓴다.
import type { DriveFileView } from '@/api/integrations';
import { DriveFilePicker } from '@/features/drive/components/DriveFilePicker';
import { driveAudioProblem } from '@/lib/integrations';

export function DriveAudioPicker({ selectedId, onPick, onClose }: { selectedId: string | null; onPick: (file: DriveFileView) => void; onClose: () => void }) {
  return (
    <DriveFilePicker
      title="Drive에서 녹음 고르기"
      description="회사 Drive 폴더에 올라온 녹음이에요. 최근에 고친 것부터 보여요"
      kinds={['audio']}
      selectedId={selectedId}
      problemOf={driveAudioProblem}
      confirmLabel="이 녹음 쓰기"
      emptyText="폴더에 녹음이 없어요. Drive 폴더에 녹음을 올린 뒤 다시 열어 주세요"
      onPick={onPick}
      onClose={onClose}
    />
  );
}
