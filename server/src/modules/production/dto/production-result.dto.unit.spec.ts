// 작업 실적 일시 DTO 검증: 없는 날짜는 다른 날로 넘기지 않고 400으로 막는다 (#509). DB 없이 확인한다.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteProductionResultDto, RegisterProductionResultDto } from './production-result.dto';

const fieldsOf = async (errors: Promise<{ property: string }[]>) => (await errors).map((e) => e.property);

describe('작업 실적 일시 DTO (#509)', () => {
  it('2월 30일처럼 없는 날짜는 받지 않는다 (전에는 3월 2일로 저장됐다)', async () => {
    expect(await fieldsOf(validate(plainToInstance(RegisterProductionResultDto, { processType: 'IRONMAKING', blastFurnaceCode: 'BF1', startedAt: '2026-02-30T10:00' })))).toEqual(['startedAt']);
    expect(await fieldsOf(validate(plainToInstance(RegisterProductionResultDto, { processType: 'IRONMAKING', blastFurnaceCode: 'BF1', completedAt: '2026-02-30T10:00:00Z' })))).toEqual(['completedAt']);
    expect(await fieldsOf(validate(plainToInstance(CompleteProductionResultDto, { completedAt: '2026-02-29T10:00' })))).toEqual(['completedAt']);
  });

  it('있는 날짜는 시간대가 없거나, 있거나, 날짜와 시각 사이가 공백이어도 받는다', async () => {
    for (const startedAt of ['2026-02-28T10:00', '2028-02-29T10:00:00+09:00', '2026-10-22T01:00:00.000Z', '2026-10-22 10:00']) {
      expect(await fieldsOf(validate(plainToInstance(RegisterProductionResultDto, { processType: 'IRONMAKING', blastFurnaceCode: 'BF1', startedAt })))).toEqual([]);
    }
  });
});
