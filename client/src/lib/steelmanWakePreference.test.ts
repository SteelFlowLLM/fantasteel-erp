// 철강맨 부르기 설정은 사원마다 따로 저장한다 (이슈 #457 리뷰): 한 브라우저를 같이 써도 다른 사원은 꺼진 채 시작한다.
import { describe, expect, it } from 'vitest';
import { parseSteelmanWakePreference, readSteelmanWakePreference, steelmanWakeKeyOf, writeSteelmanWakePreference } from '@/lib/steelmanWakePreference';

const memory = () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
  return () => storage;
};

describe('철강맨 부르기 설정', () => {
  it('A가 켠 설정은 B에게 보이지 않는다', () => {
    const storage = memory();
    writeSteelmanWakePreference(1, { wake: true, voiceApproval: true, sensitivity: 'high' }, storage);
    expect(readSteelmanWakePreference(1, storage)).toEqual({ wake: true, voiceApproval: true, sensitivity: 'high' });
    expect(readSteelmanWakePreference(2, storage)).toEqual({ wake: false, voiceApproval: false, sensitivity: 'normal' });
    expect(steelmanWakeKeyOf(2)).toBe('fantasteel.steelman-wake.2');
  });

  it('깨졌거나 모르는 값은 꺼짐, 저장소를 못 쓰면 꺼짐', () => {
    const off = { wake: false, voiceApproval: false, sensitivity: 'normal' };
    expect(parseSteelmanWakePreference('{"wake":"true"}')).toEqual(off);
    expect(parseSteelmanWakePreference('nope')).toEqual(off);
    expect(readSteelmanWakePreference(1, () => { throw new Error('막힘'); })).toEqual(off);
    // 민감도가 없던 옛 저장값(이슈 #457)은 보통으로 읽는다
    expect(parseSteelmanWakePreference('{"wake":true,"voiceApproval":false}')).toEqual({ wake: true, voiceApproval: false, sensitivity: 'normal' });
    expect(parseSteelmanWakePreference('{"wake":true,"sensitivity":"loud"}').sensitivity).toBe('normal');
  });
});
