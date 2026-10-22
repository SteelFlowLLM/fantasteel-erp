import { useSyncExternalStore } from 'react';
import { koreanVoices, speechSupport, type SpeechSupport } from '@/lib/steelmanSpeech';

// 브라우저가 주는 한국어 목소리와 읽기 가능 여부 (이슈 #507). 목소리 목록은 브라우저가 늦게 채워서 voiceschanged를 듣는다.

export interface SpeechVoices {
  support: SpeechSupport;
  voices: SpeechSynthesisVoice[];
}

const SERVER: SpeechVoices = { support: 'unsupported', voices: [] };
let cached: SpeechVoices = SERVER;

/** 바뀐 것이 없으면 같은 객체를 돌려줘야 다시 그리지 않는다 */
function read(): SpeechVoices {
  const support = speechSupport();
  const voices = koreanVoices();
  if (cached.support === support && cached.voices.length === voices.length && cached.voices.every((voice, index) => voice.voiceURI === voices[index]?.voiceURI)) return cached;
  cached = { support, voices };
  return cached;
}

function subscribe(listener: () => void): () => void {
  if (typeof speechSynthesis === 'undefined') return () => undefined;
  speechSynthesis.addEventListener('voiceschanged', listener);
  return () => speechSynthesis.removeEventListener('voiceschanged', listener);
}

export function useSpeechVoices(): SpeechVoices {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}
