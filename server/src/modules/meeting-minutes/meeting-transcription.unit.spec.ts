// DB 없이 도는 회의 전사 단위 테스트 (이슈 #522): 용어 힌트 만들기, 전사 진행 쓰기 차례.
import { Logger } from '@nestjs/common';
import type { MeetingTranscriptionProgress } from '@fantasteel/shared';
import { buildSttPrompt, STT_PROMPT_MAX_CHARS } from './meeting-stt-prompt';
import { ProgressWriter } from './meeting-transcription.runner';

const seed = {
  attendeeNames: ['김도윤', '박서영'],
  steelGradeCodes: ['SS275', 'SM355A'],
  rawMaterials: [
    { itemName: '철광석', itemCode: 'ORE01' },
    { itemName: '실리코망가니즈', itemCode: 'SMN01' },
  ],
  customerNames: ['가람중공업'],
  supplierNames: ['하람합금철'],
  glossaryTerms: ['열연', '슬래브'],
};

describe('buildSttPrompt (whisper 용어 힌트)', () => {
  it('참석자·강종·원료·고객사·공급업체·용어 순서로 짧은 문장을 만든다', () => {
    expect(buildSttPrompt(seed)).toBe('참석자 김도윤, 박서영. 강종 SS275, SM355A. 원료 철광석 ORE01, 실리코망가니즈 SMN01. 고객사 가람중공업. 공급업체 하람합금철. 용어 열연, 슬래브.');
  });

  it('상한을 넘는 낱말은 빼고 중요한 묶음(참석자·강종)부터 남긴다', () => {
    const many = { ...seed, customerNames: Array.from({ length: 40 }, (_, i) => `고객사이름${i + 1}`) };
    const prompt = buildSttPrompt(many) ?? '';
    expect(prompt.length).toBeLessThanOrEqual(STT_PROMPT_MAX_CHARS);
    expect(prompt.startsWith('참석자 김도윤, 박서영. 강종 SS275, SM355A. 원료 철광석 ORE01')).toBe(true);
    expect(prompt).toContain('고객사이름1,');
    expect(prompt).not.toContain('고객사이름40');
    // 넣지 못한 고객사 뒤의 짧은 묶음은 자리가 남으면 넣는다
    expect(buildSttPrompt(many, 52)).toBe('참석자 김도윤, 박서영. 강종 SS275, SM355A. 원료 철광석 ORE01. 용어 열연.');
  });

  it('빈 이름·겹친 이름·줄바꿈은 정리하고, 넣을 것이 없으면 null', () => {
    expect(buildSttPrompt({ ...seed, attendeeNames: ['김도윤', ' 김도윤 ', '', '박\n서영'], steelGradeCodes: [], rawMaterials: [], customerNames: [], supplierNames: [], glossaryTerms: [] })).toBe('참석자 김도윤, 박 서영.');
    expect(buildSttPrompt({ attendeeNames: [], steelGradeCodes: [], rawMaterials: [], customerNames: [], supplierNames: [], glossaryTerms: [] })).toBeNull();
  });

  it('용어를 따로 주지 않으면 용어 사전에서 고른 공정 용어를 쓴다', () => {
    expect(buildSttPrompt({ attendeeNames: [], steelGradeCodes: [], rawMaterials: [], customerNames: [], supplierNames: [] })).toMatch(/^용어 제선, 제강, 연주, 열연/);
  });
});

describe('ProgressWriter (전사 진행 쓰기)', () => {
  const logger = new Logger('test');
  const progress = (current: number, total = 5): MeetingTranscriptionProgress => ({ phase: 'TRANSCRIBE', current, total });

  it('앞의 쓰기가 끝나기 전에 온 값은 마지막 것만 쓰고, 같은 값은 다시 쓰지 않는다', async () => {
    const written: MeetingTranscriptionProgress[] = [];
    let release: () => void = () => undefined;
    const write = jest.fn(async (value: MeetingTranscriptionProgress) => {
      written.push(value);
      if (written.length === 1) await new Promise<void>((resolve) => (release = resolve));
    });
    const writer = new ProgressWriter(write, logger, 1);
    writer.push(progress(1));
    writer.push(progress(2));
    writer.push(progress(3));
    writer.push(progress(3));
    release();
    await writer.settled();
    expect(written).toEqual([progress(1), progress(3)]);
    writer.push(progress(3));
    await writer.settled();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('쓰기가 실패해도 다음 값을 쓴다 (진행 표시는 덤이다)', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const write = jest.fn().mockRejectedValueOnce(new Error('DB')).mockResolvedValue(undefined);
    const writer = new ProgressWriter(write, logger, 7);
    writer.push(progress(1));
    await writer.settled();
    writer.push(progress(2));
    await writer.settled();
    expect(write).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('회의록 7 전사 진행을 남기지 못했어요'));
  });
});
