import 'reflect-metadata';
import { AI_AGENT_INPUT_SCROLL_MAX, AI_AGENT_INPUT_TEXT_MAX } from '@fantasteel/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgentInputDto, agentInputOf } from './ai-assistant.dto';

/** 컨트롤러의 ValidationPipe와 같은 옵션으로 검증해, 통과하면 service에 넘기는 값을 돌려준다 */
async function check(body: unknown) {
  const dto = plainToInstance(AgentInputDto, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { ok: errors.length === 0, input: errors.length === 0 ? agentInputOf(dto) : null };
}

describe('멈춘 동안 직접 조작 DTO (이슈 #433)', () => {
  it('종류마다 그 종류의 칸만 검증하고 넘긴다', async () => {
    expect(await check({ kind: 'click', x: 0, y: 1 })).toEqual({ ok: true, input: { kind: 'click', x: 0, y: 1 } });
    expect(await check({ kind: 'type', text: ' a b ' })).toEqual({ ok: true, input: { kind: 'type', text: ' a b ' } });
    expect(await check({ kind: 'key', key: 'Enter' })).toEqual({ ok: true, input: { kind: 'key', key: 'Enter' } });
    expect(await check({ kind: 'scroll', deltaY: -AI_AGENT_INPUT_SCROLL_MAX })).toEqual({ ok: true, input: { kind: 'scroll', deltaY: -AI_AGENT_INPUT_SCROLL_MAX } });
    // 쓰지 않는 칸은 무시한다
    expect(await check({ kind: 'key', key: 'Tab', text: '무시' })).toEqual({ ok: true, input: { kind: 'key', key: 'Tab' } });
  });

  it('범위를 벗어난 좌표·거리, 빈 글, 긴 글, 허용하지 않은 키·종류는 막는다', async () => {
    for (const body of [
      { kind: 'click', x: 1.01, y: 0.5 },
      { kind: 'click', x: 0.5 },
      { kind: 'click', x: 'a', y: 0 },
      { kind: 'type', text: '' },
      { kind: 'type', text: 'a'.repeat(AI_AGENT_INPUT_TEXT_MAX + 1) },
      { kind: 'key', key: 'Control' },
      { kind: 'scroll', deltaY: AI_AGENT_INPUT_SCROLL_MAX + 1 },
      { kind: 'scroll', deltaY: Number.NaN },
      { kind: 'drag' },
      {},
    ])
      expect((await check(body)).ok).toBe(false);
  });
});
