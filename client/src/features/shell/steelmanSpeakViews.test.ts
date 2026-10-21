// 철강맨 읽어 주기 화면 (이슈 #507): 답의 읽기·멈춤 단추와 설정 창이 브라우저 상태(지원 안 함·한국어 목소리 없음·준비됨)에 맞게 보이는가.
// 서버 렌더(renderToStaticMarkup)로 단추·안내를 읽는다 (브라우저 없이 Vitest node 환경).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SpeakButtonView } from '@/features/shell/AiSpeakButton';
import { SpeakSettingsView, type SpeakSettingsViewProps } from '@/features/shell/SteelmanSpeakMenu';

vi.mock('@/api/aiAssistant', () => ({ aiAssistantApi: { executeActionCard: vi.fn() } }));
vi.mock('@/api/stt', () => ({ sttApi: { transcribeWakeClip: vi.fn() } }));
vi.mock('@/hooks/useAiAssistant', () => ({ controlAiAgent: vi.fn(), sendAiAgentNote: vi.fn(), stopAiAssistant: vi.fn() }));

const button = (support: 'unsupported' | 'no-korean' | 'ready', reading: boolean) => renderToStaticMarkup(createElement(SpeakButtonView, { support, reading, onClick: () => undefined }));

describe('답의 읽기·멈춤 단추', () => {
  it('준비됐으면 [읽기], 읽는 중에는 [멈춤]', () => {
    const idle = button('ready', false);
    expect(idle).toContain('읽기');
    expect(idle).toContain('ic-volume');
    expect(idle).not.toContain('aria-disabled="true"');
    const reading = button('ready', true);
    expect(reading).toContain('멈춤');
    expect(reading).toContain('ic-stop');
    expect(reading).toContain('title="읽기를 멈춰요"');
  });

  it('브라우저가 지원하지 않으면 단추를 그리지 않는다', () => {
    expect(button('unsupported', false)).toBe('');
  });

  it('한국어 목소리가 없으면 흐리게 보이고 이유를 알린다. 읽던 중이면 멈출 수 있다', () => {
    const none = button('no-korean', false);
    expect(none).toContain('aria-disabled="true"');
    expect(none).toContain('한국어 목소리가 없어 읽지 못해요');
    expect(button('no-korean', true)).not.toContain('aria-disabled="true"');
  });
});

const settings = (patch: Partial<SpeakSettingsViewProps> = {}) =>
  renderToStaticMarkup(
    createElement(SpeakSettingsView, {
      support: 'ready',
      voices: [
        { voiceURI: 'Yuna', name: 'Yuna', lang: 'ko-KR', default: true, localService: true },
        { voiceURI: 'Google 한국어', name: 'Google 한국어', lang: 'ko_KR', default: false, localService: true },
      ],
      speak: true,
      voiceUri: null,
      speechRate: 1,
      sampling: false,
      onSpeak: () => undefined,
      onVoice: () => undefined,
      onRate: () => undefined,
      onSample: () => undefined,
      ...patch,
    }),
  );

describe('읽어 주기 설정 창', () => {
  it('켜기·목소리 목록·빠르기·들어 보기가 있다', () => {
    const html = settings();
    expect(html).toContain('철강맨 부르기로 물은 답을 소리 내 읽어 줘요');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain('브라우저 기본 한국어 목소리');
    expect(html).toContain('Yuna (ko-KR)');
    expect(html).toContain('Google 한국어 (ko_KR)');
    for (const label of ['느리게', '보통', '빠르게', '아주 빠르게']) expect(html).toContain(label);
    expect(html).toContain('들어 보기');
    expect(html).not.toContain('한국어 목소리가 없어서');
  });

  it('온라인 목소리에는 (온라인)이 붙고, 지금 읽을 목소리가 온라인이면 글이 밖으로 나간다고 알린다', () => {
    const online = { voiceURI: 'Google 한국어', name: 'Google 한국어', lang: 'ko_KR', default: true, localService: false };
    const local = { voiceURI: 'Heami', name: 'Heami', lang: 'ko-KR', default: false, localService: true };
    const both = settings({ voices: [online, local] });
    expect(both).toContain('Google 한국어 (ko_KR) (온라인)');
    expect(both).toContain('Heami (ko-KR)<');
    // 이 기기 안 목소리가 있으면 자동 선택이 그쪽이라 알림이 없다
    expect(both).not.toContain('밖으로 나가지 않아요');
    // 직접 고르면 알린다
    expect(settings({ voices: [online, local], voiceUri: 'Google 한국어' })).toContain('읽을 글이 그 목소리를 제공하는 서비스');
    // 이 기기 안 목소리가 없어 온라인뿐이어도 알린다
    expect(settings({ voices: [online] })).toContain('읽을 글이 그 목소리를 제공하는 서비스');
  });

  it('저장한 목소리와 빠르기가 고른 값으로 보이고, 이 브라우저에 없는 목소리는 기본으로 보인다', () => {
    expect(settings({ voiceUri: 'Google 한국어', speechRate: 1.25 })).toMatch(/<option value="Google 한국어" selected/);
    expect(settings({ speechRate: 1.25 })).toMatch(/<option value="1.25" selected/);
    expect(settings({ speechRate: 1.3 })).toMatch(/<option value="1.25" selected/);
    expect(settings({ voiceUri: '다른 기기의 목소리' })).toMatch(/<option value="" selected/);
  });

  it('꺼짐으로 저장했으면 체크가 빠져 있고, 읽는 중이면 [멈춤]', () => {
    expect(settings({ speak: false })).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(settings({ sampling: true })).toContain('멈춤');
  });

  it('한국어 목소리가 없으면 안내하고 목소리·빠르기·들어 보기를 막는다', () => {
    const html = settings({ support: 'no-korean', voices: [] });
    expect(html).toContain('이 브라우저에 한국어 목소리가 없어서 읽어 주지 못해요');
    expect(html).toContain('글로만 보여요');
    expect(html.match(/<select[^>]*disabled/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*들어 보기/s);
    // 켜기 칸은 눌러 둘 수 있다 (목소리를 설치하면 바로 읽는다)
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
  });

  it('브라우저가 읽기를 지원하지 않으면 그렇게 안내한다', () => {
    expect(settings({ support: 'unsupported', voices: [] })).toContain('소리 내 읽기를 지원하지 않아요');
  });
});
