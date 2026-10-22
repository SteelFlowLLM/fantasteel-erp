// 이 Mac의 음성 서버 켜기·끄기 결과를 화면 동작으로 (이슈 #522): 받아쓰는 중이라 서버가 하지 않았으면 확인 창, 했으면 알림.
import type { SttLocalServerActionView } from '@fantasteel/shared';

export type LocalServerAction = 'start' | 'stop';

export interface LocalServerConfirm {
  action: LocalServerAction;
  title: string;
  confirmLabel: string;
  warning: string;
}

export type LocalServerStep = { kind: 'confirm'; confirm: LocalServerConfirm } | { kind: 'done'; message: string };

export function localServerStep(action: LocalServerAction, result: SttLocalServerActionView): LocalServerStep {
  if (result.needsConfirm) {
    return {
      kind: 'confirm',
      confirm: {
        action,
        title: action === 'start' ? '받아쓰는 중인데 다시 켤까요?' : '받아쓰는 중인데 끌까요?',
        confirmLabel: action === 'start' ? '그래도 다시 켜기' : '그래도 끄기',
        warning: result.warning ?? '음성 서버가 회의 녹음을 받아쓰는 중이에요',
      },
    };
  }
  return { kind: 'done', message: action === 'start' ? '음성 서버를 켰어요' : '음성 서버를 껐어요. 다음 로그인 때 다시 켜져요' };
}
