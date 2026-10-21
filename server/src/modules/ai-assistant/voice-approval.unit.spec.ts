// DB 없이 말로 승인한 카드 실행의 문을 본다 (이슈 #457): 되돌리기 어려운 카드는 거절하고, 받는 카드는 말로 승인 범위 안에서 실행한다.
import { AI_VOICE_APPROVABLE_KINDS, type AuthUser } from '@fantasteel/shared';
import { isInVoiceApprovedRun } from '../../common/business-event/ai-assisted.context';
import { AiAssistantService } from './ai-assistant.service';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';

const user = { employeeId: 1 } as AuthUser;

const setup = () => {
  const seen: boolean[] = [];
  const run = async () => {
    seen.push(isInVoiceApprovedRun());
    return { kind: 'TASK', registered: { type: 'task', id: 11 } };
  };
  // 생성자 의존성이 많아 실행에 쓰는 것만 붙인다
  const service = Object.assign(Object.create(AiAssistantService.prototype) as object, {
    cards: { execute: run },
    opsCards: { execute: run },
    notionCards: { execute: run },
    updateCards: { execute: run },
    researchCards: { execute: run },
  }) as unknown as AiAssistantService;
  return { service, seen };
};

const dto = (kind: string, approvedByVoice?: boolean) => ({ kind, title: 'a', ...(approvedByVoice === undefined ? {} : { approvedByVoice }) }) as unknown as ExecuteAiActionCardDto;

describe('말로 승인한 카드 실행', () => {
  it('말로 승인할 수 있는 카드는 업무·일정·구매요청뿐이다', () => {
    expect(AI_VOICE_APPROVABLE_KINDS).toEqual(['TASK', 'EVENT', 'PURCHASE']);
  });

  it('업무·일정·구매요청은 말로 승인 범위 안에서 실행하고, 눌러 실행하면 범위 밖이다', async () => {
    const { service, seen } = setup();
    await service.executeActionCard(user, dto('TASK', true));
    await service.executeActionCard(user, dto('PURCHASE', true));
    await service.executeActionCard(user, dto('TASK'));
    await service.executeActionCard(user, dto('SALES_ORDER', false));
    expect(seen).toEqual([true, true, false, false]);
  });

  it.each(['SALES_ORDER', 'HOT_ROLLING', 'HEAT_PLAN', 'NOTION_PAGE_UPDATE', 'NOTION_PAGE_APPEND', 'NOTION_PAGE_CREATE', 'TASK_UPDATE', 'SCHEDULE_EVENT_UPDATE', 'PAST_CASE', 'RESEARCH'])('%s는 말로 승인하면 실행하지 않고 VOC-010', async (kind) => {
    const { service, seen } = setup();
    await expect(service.executeActionCard(user, dto(kind, true))).rejects.toMatchObject({ code: 'VOC-010' });
    expect(seen).toEqual([]);
  });
});
