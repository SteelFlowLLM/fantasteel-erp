import { parseAssistantAnswer } from './assistant.answer';

describe('parseAssistantAnswer 생각 표시', () => {
  it('<think> 블록을 뺀다', () => {
    expect(parseAssistantAnswer('<think>음</think>답이에요', []).answer).toBe('답이에요');
  });

  it('Gemma 표시(<|channel>thought … <channel|>)도 생각으로 보고 뺀다', () => {
    expect(parseAssistantAnswer('<|channel>thought\n음…<channel|>답이에요', []).answer).toBe('답이에요');
  });

  it('Gemma 여는 표시만 남아 오면 표시만 지운다', () => {
    expect(parseAssistantAnswer('<|channel>thought\n포스코는 1968년에 세워졌어요', []).answer).toBe('포스코는 1968년에 세워졌어요');
  });
});
