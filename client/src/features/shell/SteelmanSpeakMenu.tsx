'use client';

// 철강맨 읽어 주기 개인 설정 (이슈 #507, 문서에 없는 기능): 철강맨 부르기로 물은 답을 읽어 줄지, 목소리, 빠르기.
// 목소리 이름은 브라우저마다 달라 이 브라우저에 사원별로 저장한다(철강맨 부르기의 다른 개인 설정과 같다, lib/steelmanWakePreference.ts).
// 한국어 목소리가 없거나 브라우저가 지원하지 않으면 여기서 안내하고 읽기는 건너뛴다.
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { PopHead, PopPanel } from '@/features/shell/PopPanel';
import { usePopover } from '@/hooks/usePopover';
import { useSpeechVoices } from '@/hooks/useSpeechVoices';
import { pickVoice, SPEECH_RATES, SPEECH_SAMPLE_KEY, useSteelmanSpeechStore, type SpeechSupport } from '@/lib/steelmanSpeech';
import { toggleSpeechSample } from '@/lib/steelmanWakeActions';
import { useSteelmanWakeStore } from '@/stores/useSteelmanWakeStore';

/** 저장한 빠르기에 가장 가까운 선택지 */
const nearestRate = (rate: number): number => SPEECH_RATES.reduce((best, item) => (Math.abs(item.value - rate) < Math.abs(best.value - rate) ? item : best)).value;

export interface SpeakSettingsViewProps {
  support: SpeechSupport;
  /** localService가 false인 목소리는 온라인(원격)이다: 목록에 (온라인)을 붙이고, 읽을 글이 밖으로 나간다고 알린다 */
  voices: ReadonlyArray<{ voiceURI: string; name: string; lang: string; default: boolean; localService: boolean }>;
  speak: boolean;
  voiceUri: string | null;
  speechRate: number;
  /** [들어 보기]로 읽는 중 */
  sampling: boolean;
  onSpeak: (on: boolean) => void;
  onVoice: (voiceUri: string | null) => void;
  onRate: (rate: number) => void;
  onSample: () => void;
}

/** 설정 창 안. 한국어 목소리가 없으면 목소리·빠르기·들어 보기를 막고 이유와 할 일을 안내한다 */
export function SpeakSettingsView({ support, voices, speak, voiceUri, speechRate, sampling, onSpeak, onVoice, onRate, onSample }: SpeakSettingsViewProps) {
  const ready = support === 'ready';
  const chosenVoice = voices.some((voice) => voice.voiceURI === voiceUri) ? voiceUri : null;
  // 지금 읽을 목소리가 온라인이면(직접 골랐거나, 이 기기 안 목소리가 없어서) 글이 밖으로 나간다고 알린다
  const online = ready && pickVoice(voices, voiceUri)?.localService === false;
  return (
    <div className="flex flex-col gap-3 overflow-auto px-3.5 py-3 text-sm text-ink">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={speak} onChange={(event) => onSpeak(event.target.checked)} />
        <span>
          철강맨 부르기로 물은 답을 소리 내 읽어 줘요
          <small className="block text-cap text-ink-3">긴 답은 앞부분만 읽어요. 읽는 동안 마이크는 쉬고, 다 읽으면 다시 들어요. 답마다 있는 [읽기] 단추는 이 설정과 상관없이 읽어요.</small>
        </span>
      </label>
      {support === 'unsupported' ? (
        <Banner tone="wait" icon="alert">
          이 브라우저는 소리 내 읽기를 지원하지 않아요. 답은 글로만 보여요.
        </Banner>
      ) : null}
      {support === 'no-korean' ? (
        <Banner tone="wait" icon="alert">
          이 브라우저에 한국어 목소리가 없어서 읽어 주지 못해요. 운영체제의 음성(읽어 주기) 설정에서 한국어 목소리를 설치한 뒤 브라우저를 다시 열어 주세요. 그때까지 답은 글로만 보여요.
        </Banner>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="text-cap text-ink-3">목소리</span>
        <select
          aria-label="읽어 줄 목소리"
          className="rounded-sm border border-line-strong bg-surface px-1.5 py-1 text-sm disabled:opacity-55"
          disabled={!ready}
          value={chosenVoice ?? ''}
          onChange={(event) => onVoice(event.target.value || null)}
        >
          <option value="">브라우저 기본 한국어 목소리</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang}){voice.localService ? '' : ' (온라인)'}
            </option>
          ))}
        </select>
        {online ? <small className="text-cap text-ink-3">온라인 목소리라 읽을 글이 그 목소리를 제공하는 서비스(예: Google)로 보내져요. 이 기기 안 목소리를 고르면 밖으로 나가지 않아요.</small> : null}
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-cap text-ink-3">빠르기</span>
        <select
          aria-label="읽는 빠르기"
          className="rounded-sm border border-line-strong bg-surface px-1.5 py-1 text-sm disabled:opacity-55"
          disabled={!ready}
          value={nearestRate(speechRate)}
          onChange={(event) => onRate(Number(event.target.value))}
        >
          {SPEECH_RATES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <Button size="sm" icon={sampling ? 'stop' : 'volume'} className="self-start" disabled={!ready} onClick={onSample}>
        {sampling ? '멈춤' : '들어 보기'}
      </Button>
    </div>
  );
}

/** appearance: icon은 패널 머리의 아이콘 단추, bar는 철강맨 부르기 띠의 글자 단추 */
export function SteelmanSpeakMenu({ appearance }: { appearance: 'icon' | 'bar' }) {
  const popover = usePopover<HTMLDivElement>();
  const { support, voices } = useSpeechVoices();
  const speak = useSteelmanWakeStore((state) => state.speak);
  const voiceUri = useSteelmanWakeStore((state) => state.voiceUri);
  const speechRate = useSteelmanWakeStore((state) => state.speechRate);
  const sampling = useSteelmanSpeechStore((state) => state.speaking?.key === SPEECH_SAMPLE_KEY);
  const ready = support === 'ready';
  return (
    <div ref={popover.ref} className="relative">
      {appearance === 'icon' ? (
        <IconButton
          icon="volume"
          label="읽어 주기 설정"
          title={speak && ready ? '읽어 주기 켜짐 · 목소리·빠르기 설정' : '읽어 주기 설정'}
          size="sm"
          aria-haspopup="dialog"
          aria-expanded={popover.open}
          className={speak && ready ? 'bg-steelman-soft text-steelman-ink' : ''}
          onClick={() => popover.setOpen(!popover.open)}
        />
      ) : (
        <Button size="sm" icon="volume" aria-haspopup="dialog" aria-expanded={popover.open} onClick={() => popover.setOpen(!popover.open)}>
          읽어 주기 {!ready ? '안 됨' : speak ? '켜짐' : '꺼짐'}
        </Button>
      )}
      {popover.open ? (
        <PopPanel label="철강맨 읽어 주기 설정" placement="right">
          <PopHead title="철강맨 읽어 주기" />
          <SpeakSettingsView
            support={support}
            voices={voices}
            speak={speak}
            voiceUri={voiceUri}
            speechRate={speechRate}
            sampling={sampling}
            onSpeak={(on) => useSteelmanWakeStore.getState().setSpeak(on)}
            onVoice={(next) => useSteelmanWakeStore.getState().setSpeechVoice(next)}
            onRate={(rate) => useSteelmanWakeStore.getState().setSpeechRate(rate)}
            onSample={() => toggleSpeechSample()}
          />
        </PopPanel>
      ) : null}
    </div>
  );
}
