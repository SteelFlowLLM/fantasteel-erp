// 시드용 가상 시계. 전역 Date를 바꿔서 서비스가 남기는 시각(created_at·approved_at·inspected_at·채번 날짜 등)을 지정한 시점으로 만든다.
// Prisma 7은 @default(now())를 클라이언트(JS Date)에서 채우므로 created_at도 함께 따라온다. DB의 now()를 쓰는 TypedSQL(inventory.updated_at)만 예외라 시드 끝에 따로 맞춘다.
// 시드 전용이다. 서버 코드에서는 쓰지 않는다.

const RealDate = Date;

export interface VirtualClock {
  /** 서울 시각 'YYYY-MM-DD HH:mm'(또는 'YYYY-MM-DD HH:mm:ss')로 옮긴다. 거꾸로 가면 경고만 남긴다 (allowBackwards면 조용히) */
  set(seoul: string, allowBackwards?: boolean): Date;
  /** 분 단위로 앞으로 */
  advanceMinutes(minutes: number): Date;
  now(): Date;
  /** 전역 Date를 원래대로 */
  uninstall(): void;
}

export function parseSeoul(seoul: string): number {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?$/.exec(seoul.trim());
  if (!m) throw new Error(`가상 시각 형식이 아닙니다 (YYYY-MM-DD HH:mm): ${seoul}`);
  const ms = RealDate.parse(`${m[1]}T${m[2]}:${m[3] ?? '00'}+09:00`);
  if (Number.isNaN(ms)) throw new Error(`가상 시각을 읽을 수 없습니다: ${seoul}`);
  return ms;
}

/**
 * 가상 시각 = 기준 시각 + (실제 경과 시간). 멈춘 시계가 아니라 흐르는 시계라서 같은 단계 안에서 만든 행도 시각 순서가 유지되고,
 * 타임아웃·잠금 같은 라이브러리 내부 시간 계산도 정상이다.
 */
export function installVirtualClock(start: string, onWarn: (message: string) => void = () => {}): VirtualClock {
  let base = parseSeoul(start);
  let anchor = RealDate.now();
  const current = () => base + (RealDate.now() - anchor);

  class VirtualDate extends RealDate {
    constructor(...args: unknown[]) {
      // 인자가 없을 때만 가상 시각. new Date(값)·Date.parse·Date.UTC는 그대로
      if (args.length === 0) super(current());
      else super(...(args as ConstructorParameters<typeof Date>));
    }
    static override now(): number {
      return current();
    }
  }
  globalThis.Date = VirtualDate as DateConstructor;

  return {
    set(seoul, allowBackwards = false) {
      const next = parseSeoul(seoul);
      if (!allowBackwards && next < current()) onWarn(`가상 시각이 거꾸로 갑니다: ${new RealDate(current()).toISOString()} → ${seoul}`);
      base = next;
      anchor = RealDate.now();
      return new RealDate(current());
    },
    advanceMinutes(minutes) {
      base = current() + minutes * 60_000;
      anchor = RealDate.now();
      return new RealDate(current());
    },
    now: () => new RealDate(current()),
    uninstall() {
      globalThis.Date = RealDate;
    },
  };
}
