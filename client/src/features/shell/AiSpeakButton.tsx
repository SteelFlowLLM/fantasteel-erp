'use client';

// 철강맨AI 답마다 붙는 읽기·멈춤 단추 (이슈 #507, 문서에 없는 기능): 누르면 브라우저 음성으로 이 답을 읽고, 읽는 중에는 [멈춤]이 된다.
// 읽을 글은 마크다운·표·코드 블록·링크 주소를 뺀 앞부분이다 (lib/steelmanSpeechText.ts). 브라우저에 한국어 목소리가 없으면 누르면 이유를 알린다.
import { Button } from '@/components/Button';
import { useSpeechVoices } from '@/hooks/useSpeechVoices';
import { useSteelmanSpeechStore, type SpeechSupport } from '@/lib/steelmanSpeech';
import { toggleReadAloud } from '@/lib/steelmanWakeActions';
import { toast } from '@/stores/useToastStore';

export interface SpeakButtonViewProps {
  support: SpeechSupport;
  /** 이 답을 읽는 중 */
  reading: boolean;
  onClick: () => void;
}

/** 단추 모양. 브라우저가 읽기를 지원하지 않으면 그리지 않는다. 한국어 목소리가 없으면 흐리게 보이고, 눌렀을 때 이유를 알린다(비활성 단추는 마우스를 올려도 안내가 안 뜨는 브라우저가 있다) */
export function SpeakButtonView({ support, reading, onClick }: SpeakButtonViewProps) {
  if (support === 'unsupported') return null;
  const unavailable = support === 'no-korean' && !reading;
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={reading ? 'stop' : 'volume'}
      aria-disabled={unavailable}
      className={unavailable ? 'self-start opacity-55' : 'self-start'}
      title={unavailable ? '이 브라우저에 한국어 목소리가 없어 읽지 못해요. 읽어 주기 설정의 안내를 확인해 주세요' : reading ? '읽기를 멈춰요' : '이 답을 소리 내 읽어 줘요. 긴 답은 앞부분만 읽어요'}
      onClick={onClick}
    >
      {reading ? '멈춤' : '읽기'}
    </Button>
  );
}

export function AiSpeakButton({ entryId, content }: { entryId: string; content: string }) {
  const { support } = useSpeechVoices();
  const reading = useSteelmanSpeechStore((state) => state.speaking?.key === entryId);
  if (!content.trim()) return null;
  const click = () => {
    if (toggleReadAloud(entryId, content) === 'unavailable') toast.error('이 브라우저에 한국어 목소리가 없어 읽지 못해요. 위쪽 읽어 주기 설정에서 안내를 확인해 주세요');
  };
  return <SpeakButtonView support={support} reading={reading} onClick={click} />;
}
