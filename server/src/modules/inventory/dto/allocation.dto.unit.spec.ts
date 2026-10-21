// 배정 변경·해제 사유 길이: 화면(shared 상수)과 서버가 같은 상한을 쓴다 (이슈 #476). DB 없음
import 'reflect-metadata';
import { ALLOCATION_REASON_MAX } from '@fantasteel/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReleaseAllocationDto } from './allocation.dto';

const check = (reason: string) => validate(plainToInstance(ReleaseAllocationDto, { reason }));

describe('ReleaseAllocationDto 사유', () => {
  it('상한은 200자다', () => {
    expect(ALLOCATION_REASON_MAX).toBe(200);
  });

  it('상한까지는 받고 넘으면 400 문구로 거절한다', async () => {
    expect(await check('가'.repeat(ALLOCATION_REASON_MAX))).toEqual([]);
    const errors = await check('가'.repeat(ALLOCATION_REASON_MAX + 1));
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toEqual(['사유는 200자까지 쓸 수 있어요']);
  });
});
