// 철강맨 부르기 (이슈 #494): 브라우저가 멈춰 둔 AudioContext를 깨운다.
// 사용자가 누르지 않은 때(새로고침했는데 켜져 있음·탭 복귀·권한 창을 오래 둠) 만든 AudioContext는 'suspended'로 남아 소리를 하나도 처리하지 않는다.
// 바로 깨워 보고, 안 되면 막혔다고 알린 뒤 다음 누르기·키 입력에서 다시 깨운다. 상태가 바뀌면(statechange) 다시 알린다.

/** 시험에서 가짜로 바꿀 수 있게 쓰는 부분만 */
export interface AudioContextLike {
  readonly state: AudioContextState;
  resume(): Promise<void>;
  onstatechange: BaseAudioContext['onstatechange'];
}

export type UnlockTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** 깨우는 동안 쓰는 사용자 조작. 캡처 단계에서 들어 다른 화면이 막아도 받는다 */
const UNLOCK_EVENTS = ['pointerdown', 'keydown'] as const;

/**
 * context를 깨우고 막혀 있는지(blocked)를 알린다. 돌려준 함수를 부르면 듣기를 그만둔다(닫을 때).
 * resume은 사용자 조작 전에는 끝나지 않고 기다릴 수 있어 기다리지 않는다
 */
export function keepAudioRunning(context: AudioContextLike, onBlocked: (blocked: boolean) => void, target: UnlockTarget): () => void {
  let stopped = false;
  const sync = () => {
    if (!stopped && context.state !== 'closed') onBlocked(context.state === 'suspended');
  };
  const unlock = () => {
    if (context.state === 'suspended') void context.resume().then(sync, sync);
  };
  context.onstatechange = sync;
  for (const event of UNLOCK_EVENTS) target.addEventListener(event, unlock, true);
  void context.resume().then(sync, sync);
  sync();
  return () => {
    stopped = true;
    context.onstatechange = null;
    for (const event of UNLOCK_EVENTS) target.removeEventListener(event, unlock, true);
  };
}
