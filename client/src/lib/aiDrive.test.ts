// 철강맨AI Drive(이슈 #398 2단계): 켜기·못 켤 때 이유·도구 줄 요약, 입력칸 @ 파일 고르기.
import type { DriveFileView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import {
  AI_DRIVE_OFF_REASON,
  attachDriveFile,
  driveDisabledReason,
  driveToolDoneText,
  driveToolRunningText,
  DRIVE_MENTION_LIST_MAX,
  filterMentionFiles,
  mentionStillOpen,
  mentionTriggerAt,
  moveMentionIndex,
  parseAiDrivePreference,
  removeMentionTrigger,
} from '@/lib/aiDrive';

const file = (id: string, name: string, kind: DriveFileView['kind'] = 'document'): DriveFileView => ({ id, name, mimeType: 'application/pdf', kind, size: 10, modifiedTime: null, thumbnailLink: null });

describe('Drive 켜기', () => {
  it('저장된 값은 "true"만 켜짐, 서버가 쓸 수 있다고 해야 켠다', () => {
    expect(parseAiDrivePreference('true')).toBe(true);
    expect(parseAiDrivePreference('false')).toBe(false);
    expect(driveDisabledReason({ drive: { available: true } }, false)).toBeNull();
    expect(driveDisabledReason({ drive: { available: false, reason: 'Google Drive 폴더가 설정되지 않았어요' } }, false)).toBe('Google Drive 폴더가 설정되지 않았어요');
    expect(driveDisabledReason(undefined, false)).toBe(AI_DRIVE_OFF_REASON);
  });

  it('도구 줄: 찾는 중·읽는 중, 끝나면 결과 수·읽음', () => {
    expect(driveToolRunningText('drive_read_file')).toBe(' … 읽는 중');
    expect(driveToolRunningText('notion_search')).toBeNull();
    expect(driveToolDoneText('drive_search', [{ title: 'a', url: 'https://drive.google.com/file/d/x/view' }])).toBe('결과 1개');
    expect(driveToolDoneText('drive_read_file', [])).toBe('읽지 못함');
  });
});

describe('입력칸 @', () => {
  it('처음이나 띄어쓰기 뒤에 @ 한 글자를 쳤을 때만 연다 (메일 주소·붙여 넣기는 열지 않는다)', () => {
    expect(mentionTriggerAt('', '@', 1)).toBe(0);
    expect(mentionTriggerAt('이 파일 ', '이 파일 @', 6)).toBe(5);
    expect(mentionTriggerAt('요약해줘', '@요약해줘', 1)).toBe(0);
    expect(mentionTriggerAt('kim', 'kim@', 4)).toBeNull();
    expect(mentionTriggerAt('', '@파일', 3)).toBeNull();
    expect(mentionTriggerAt('a b', 'a @b', 3)).toBe(2);
    expect(mentionTriggerAt('ab', 'a@', 2)).toBeNull();
  });

  it('고르면 그 @를 글에서 뺀다', () => {
    expect(removeMentionTrigger('이 파일 @ 요약해줘', 5)).toBe('이 파일  요약해줘');
    expect(removeMentionTrigger('바뀐 글', 1)).toBe('바뀐 글');
  });

  it('@를 지우거나 앞 글이 지워져 @가 밀리면 창을 닫는다', () => {
    expect(mentionStillOpen('이 파일 @보', 5)).toBe(true);
    expect(mentionStillOpen('이 파일 ', 5)).toBe(false);
    expect(mentionStillOpen('파일 @', 5)).toBe(false);
  });

  it('창의 파일: 녹음은 빼고 이름(띄어쓰기·대소문자 무시)으로 거르고, 개수 상한', () => {
    const files = [file('a1aaaaaaaaaa', '라인 점검 메모.txt'), file('a2aaaaaaaaaa', '회의 녹음.m4a', 'audio'), file('a3aaaaaaaaaa', 'Site Photo.PNG', 'image')];
    expect(filterMentionFiles(files, '').map((f) => f.id)).toEqual(['a1aaaaaaaaaa', 'a3aaaaaaaaaa']);
    expect(filterMentionFiles(files, '라인점검').map((f) => f.id)).toEqual(['a1aaaaaaaaaa']);
    expect(filterMentionFiles(files, 'site p').map((f) => f.id)).toEqual(['a3aaaaaaaaaa']);
    expect(filterMentionFiles(Array.from({ length: 30 }, (_, i) => file(`f${i}aaaaaaaaaa`, `문서 ${i}`)), '')).toHaveLength(DRIVE_MENTION_LIST_MAX);
  });

  it('↑↓는 끝에서 처음으로 돈다', () => {
    expect(moveMentionIndex(0, -1, 3)).toBe(2);
    expect(moveMentionIndex(2, 1, 3)).toBe(0);
    expect(moveMentionIndex(0, 1, 0)).toBe(0);
  });

  it('문서는 같은 파일 한 번, 3개까지 붙인다', () => {
    let list: DriveFileView[] = [];
    for (const id of ['d1aaaaaaaaaa', 'd2aaaaaaaaaa', 'd1aaaaaaaaaa', 'd3aaaaaaaaaa']) list = attachDriveFile(list, file(id, id)).list;
    expect(list.map((f) => f.id)).toEqual(['d1aaaaaaaaaa', 'd2aaaaaaaaaa', 'd3aaaaaaaaaa']);
    expect(attachDriveFile(list, file('d4aaaaaaaaaa', 'x')).problem).toBe('Drive 파일은 3개까지 붙일 수 있어요');
  });
});
