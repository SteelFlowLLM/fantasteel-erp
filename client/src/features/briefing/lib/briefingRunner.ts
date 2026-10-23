// 브리핑 재생의 기다리기·건너뛰기·멈추기. 재생 한 번마다 번호(runId)를 주고,
// 새로 시작하거나 멈추면 앞 재생의 기다림은 BriefingCancelled로 끝나 남은 장면을 그리지 않는다.
// 건너뛰기는 남은 연출 기다림을 바로 끝낸다. 자료를 기다리는 것(pause)은 건너뛰어도 실제로 기다린다.

export class BriefingCancelled extends Error {
  constructor() {
    super('브리핑 재생을 멈췄어요');
    this.name = 'BriefingCancelled';
  }
}

interface Pending {
  id: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
  reject: (error: BriefingCancelled) => void;
  skippable: boolean;
}

export interface BriefingRunner {
  /** 앞 재생을 멈추고 새 재생 번호를 준다 */
  start: () => number;
  /** 연출 기다림. 건너뛰는 중이면 바로 끝난다 */
  wait: (id: number, ms: number) => Promise<void>;
  /** 자료를 기다리는 짧은 쉼. 건너뛰어도 기다린다 */
  pause: (id: number, ms: number) => Promise<void>;
  /** 남은 연출을 한 번에 */
  skip: () => void;
  /** 이 재생이 끝나 건너뛰기를 푼다 */
  finish: (id: number) => void;
  cancel: () => void;
  isSkipping: () => boolean;
  isCurrent: (id: number) => boolean;
}

export function createBriefingRunner(): BriefingRunner {
  let runId = 0;
  let skipping = false;
  const pending = new Set<Pending>();

  const cancel = () => {
    runId += 1;
    for (const p of pending) {
      clearTimeout(p.timer);
      p.reject(new BriefingCancelled());
    }
    pending.clear();
    skipping = false;
  };

  const sleep = (id: number, ms: number, skippable: boolean): Promise<void> =>
    new Promise((resolve, reject) => {
      if (id !== runId) {
        reject(new BriefingCancelled());
        return;
      }
      if (skippable && skipping) {
        resolve();
        return;
      }
      const entry: Pending = {
        id,
        skippable,
        resolve,
        reject,
        timer: setTimeout(() => {
          pending.delete(entry);
          if (entry.id === runId) resolve();
          else reject(new BriefingCancelled());
        }, ms),
      };
      pending.add(entry);
    });

  return {
    start: () => {
      cancel();
      return runId;
    },
    wait: (id, ms) => sleep(id, ms, true),
    pause: (id, ms) => sleep(id, ms, false),
    skip: () => {
      skipping = true;
      for (const p of [...pending]) {
        if (!p.skippable) continue;
        clearTimeout(p.timer);
        pending.delete(p);
        p.resolve();
      }
    },
    finish: (id) => {
      if (id === runId) skipping = false;
    },
    cancel,
    isSkipping: () => skipping,
    isCurrent: (id) => id === runId,
  };
}

/** 말풍선 글자 사이 쉼(ms): 문장 끝은 조금 길게, 쉼표는 살짝. 느리면 읽기 답답해서 짧게 둔다 */
export function typingPause(ch: string): number {
  if ('.!?…'.includes(ch)) return 60;
  return ch === ',' ? 35 : 8;
}
