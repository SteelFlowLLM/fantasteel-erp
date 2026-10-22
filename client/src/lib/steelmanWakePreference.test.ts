// 철강맨 부르기 설정은 사원마다 따로 저장한다 (이슈 #457 리뷰): 한 브라우저를 같이 써도 다른 사원은 꺼진 채 시작한다.
import { describe, expect, it } from 'vitest';
import { parseSteelmanWakePreference, readSteelmanWakePreference, steelmanWakeKeyOf, writeSteelmanWakePreference } from '@/lib/steelmanWakePreference';

const memory = () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
  return () => storage;
};

const OFF = { wake: false, voiceApproval: false, sensitivity: 'normal', speak: true, voiceUri: null, speechRate: 1 };

describe('철강맨 부르기 설정', () => {
  it('A가 켠 설정은 B에게 보이지 않는다', () => {
    const storage = memory();
    const mine = { wake: true, voiceApproval: true, sensitivity: 'high', speak: false, voiceUri: 'Yuna', speechRate: 1.25 } as const;
    writeSteelmanWakePreference(1, mine, storage);
    expect(readSteelmanWakePreference(1, storage)).toEqual(mine);
    expect(readSteelmanWakePreference(2, storage)).toEqual(OFF);
    expect(steelmanWakeKeyOf(2)).toBe('fantasteel.steelman-wake.2');
  });

  it('깨졌거나 모르는 값은 꺼짐, 저장소를 못 쓰면 꺼짐', () => {
    expect(parseSteelmanWakePreference('{"wake":"true"}')).toEqual(OFF);
    expect(parseSteelmanWakePreference('nope')).toEqual(OFF);
    expect(readSteelmanWakePreference(1, () => { throw new Error('막힘'); })).toEqual(OFF);
    // 민감도가 없던 옛 저장값(이슈 #457)은 보통으로 읽는다
    expect(parseSteelmanWakePreference('{"wake":true,"voiceApproval":false}')).toEqual({ ...OFF, wake: true });
    expect(parseSteelmanWakePreference('{"wake":true,"sensitivity":"loud"}').sensitivity).toBe('normal');
  });

  it('읽어 주기 설정(이슈 #507): 옛 저장값은 켜짐·기본 목소리·보통 빠르기, 깨진 값은 기본으로 읽는다', () => {
    expect(parseSteelmanWakePreference('{"wake":true}')).toMatchObject({ speak: true, voiceUri: null, speechRate: 1 });
    expect(parseSteelmanWakePreference('{"speak":false}').speak).toBe(false);
    expect(parseSteelmanWakePreference('{"voiceUri":"Google 한국어","speechRate":1.5}')).toMatchObject({ voiceUri: 'Google 한국어', speechRate: 1.5 });
    expect(parseSteelmanWakePreference('{"voiceUri":7,"speechRate":"빠르게"}')).toMatchObject({ voiceUri: null, speechRate: 1 });
    expect(parseSteelmanWakePreference('{"voiceUri":""}').voiceUri).toBeNull();
    // 범위를 벗어난 빠르기는 브라우저가 받는 범위로 맞춘다
    expect(parseSteelmanWakePreference('{"speechRate":9}').speechRate).toBe(2);
    expect(parseSteelmanWakePreference('{"speechRate":0}').speechRate).toBe(0.5);
  });
});
