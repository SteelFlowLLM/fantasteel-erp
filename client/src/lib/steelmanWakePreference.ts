// 철강맨 부르기 (이슈 #457)의 켜기·말로 승인 허용 설정. 계정에 저장할 컬럼이 없어 이 브라우저에 두되 사원마다 따로 둔다:
// 한 사원이 켜고 나간 브라우저로 다른 사원이 들어와도 그 사원은 마이크·말로 승인이 꺼진 채(기본)로 시작한다.
import { parseWakeSensitivity, type WakeSensitivity } from '@/lib/steelmanWakeDisplay';

export const STEELMAN_WAKE_KEY = 'fantasteel.steelman-wake';

export interface SteelmanWakePreference {
  wake: boolean;
  voiceApproval: boolean;
  /** 말 시작 민감도 (이슈 #494). 없으면 보통 */
  sensitivity: WakeSensitivity;
}

const OFF: SteelmanWakePreference = { wake: false, voiceApproval: false, sensitivity: 'normal' };

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const steelmanWakeKeyOf = (employeeId: number): string => `${STEELMAN_WAKE_KEY}.${employeeId}`;

/** 저장된 글을 읽는다. 깨졌거나 없으면 둘 다 꺼짐 */
export function parseSteelmanWakePreference(raw: string | null): SteelmanWakePreference {
  if (!raw) return OFF;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return OFF;
    const record = value as Record<string, unknown>;
    return { wake: record.wake === true, voiceApproval: record.voiceApproval === true, sensitivity: parseWakeSensitivity(record.sensitivity) };
  } catch {
    return OFF;
  }
}

const browserStorage = (): PreferenceStorage => window.localStorage;

export function readSteelmanWakePreference(employeeId: number, storage: () => PreferenceStorage = browserStorage): SteelmanWakePreference {
  try {
    return parseSteelmanWakePreference(storage().getItem(steelmanWakeKeyOf(employeeId)));
  } catch {
    return OFF;
  }
}

export function writeSteelmanWakePreference(employeeId: number, preference: SteelmanWakePreference, storage: () => PreferenceStorage = browserStorage): void {
  try {
    storage().setItem(steelmanWakeKeyOf(employeeId), JSON.stringify(preference));
  } catch {
    // localStorage를 쓸 수 없는 환경이면 이 화면을 열어 둔 동안만 유지한다
  }
}
