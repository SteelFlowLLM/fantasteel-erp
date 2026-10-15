import { hasMeetingAudioExtension } from '@fantasteel/shared';

/**
 * 브라우저 녹음은 video/webm, 모바일·일부 브라우저의 파일 선택은 MIME이 비거나 application/octet-stream으로 오기도 한다.
 * 그럴 때만 확장자로 알아본다 (text/plain 같은 분명한 비오디오는 확장자가 .mp3여도 거절).
 */
export function isMeetingAudio(mimeType: string, fileName: string): boolean {
  if (mimeType.startsWith('audio/') || mimeType === 'video/webm' || mimeType === 'video/mp4') return true;
  if (mimeType === '' || mimeType === 'application/octet-stream') return hasMeetingAudioExtension(fileName);
  return false;
}
