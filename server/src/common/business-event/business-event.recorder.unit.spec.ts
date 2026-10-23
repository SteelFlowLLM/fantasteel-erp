// DB 없이 기록기가 말로 승인 표시를 사유에 붙이는지 본다 (이슈 #457).
import type { AuthUser } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';
import type { NumberingService } from '../numbering/numbering.service';
import { runAsVoiceApproved } from './ai-assisted.context';
import { BusinessEventRecorder } from './business-event.recorder';

const user = { employeeId: 3 } as AuthUser;

const setup = () => {
  const created: { reason: string | null }[] = [];
  const tx = {
    businessEvent: {
      create: async ({ data }: { data: { reason: string | null } }) => {
        created.push(data);
        return { id: created.length, businessEventNo: `BE-${created.length}` };
      },
    },
  } as unknown as Tx;
  const numbering = { nextDocumentNumber: async () => 'BE-1' } as unknown as NumberingService;
  return { recorder: new BusinessEventRecorder(numbering), tx, created };
};

describe('BusinessEventRecorder 말로 승인 표시', () => {
  it('말로 승인한 실행 안의 로그만 사유에 표시가 붙는다', async () => {
    const { recorder, tx, created } = setup();
    await recorder.record(tx, { type: 'TASK_CREATED', actor: user, target: { table: 'task', id: 1 } });
    await runAsVoiceApproved(() => recorder.record(tx, { type: 'TASK_CREATED', actor: user, target: { table: 'task', id: 2 } }));
    await runAsVoiceApproved(() => recorder.record(tx, { type: 'DRAFT_CREATED', actor: user, target: { table: 'action_draft', id: 3 }, reason: 'AI 카드' }));
    expect(created.map((row) => row.reason)).toEqual([null, '철강맨 말로 승인', 'AI 카드 · 철강맨 말로 승인']);
  });
});
