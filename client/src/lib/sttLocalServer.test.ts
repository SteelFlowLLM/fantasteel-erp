import type { SttLocalServerActionView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { localServerStep } from '@/lib/sttLocalServer';

const view = (over: Partial<SttLocalServerActionView> = {}): SttLocalServerActionView => ({
  supported: true,
  installed: true,
  running: true,
  healthy: true,
  pid: 1,
  logPath: null,
  message: null,
  transcribing: 0,
  needsConfirm: false,
  warning: null,
  ...over,
});

describe('음성 서버 다시 켜기·끄기 확인 창 (이슈 #522)', () => {
  it('받아쓰는 중이라 서버가 하지 않았으면 서버 경고로 확인 창을 띄운다', () => {
    const warning = '음성 서버가 회의 녹음 1건을 받아쓰는 중이에요. 지금 다시 켜면 그 전사는 실패하고 녹음을 다시 올려야 해요';
    expect(localServerStep('start', view({ needsConfirm: true, transcribing: 1, warning }))).toEqual({
      kind: 'confirm',
      confirm: { action: 'start', title: '받아쓰는 중인데 다시 켤까요?', confirmLabel: '그래도 다시 켜기', warning },
    });
    const stop = localServerStep('stop', view({ needsConfirm: true, transcribing: 2, warning: null }));
    expect(stop).toMatchObject({ kind: 'confirm', confirm: { action: 'stop', title: '받아쓰는 중인데 끌까요?', confirmLabel: '그래도 끄기', warning: '음성 서버가 회의 녹음을 받아쓰는 중이에요' } });
  });

  it('했으면 확인 창 없이 알림만', () => {
    expect(localServerStep('start', view())).toEqual({ kind: 'done', message: '음성 서버를 켰어요' });
    expect(localServerStep('stop', view({ running: false }))).toEqual({ kind: 'done', message: '음성 서버를 껐어요. 다음 로그인 때 다시 켜져요' });
  });
});
