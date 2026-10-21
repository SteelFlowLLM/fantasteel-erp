// DB 없이 말로 승인한 카드 실행의 문을 본다 (이슈 #457): 되돌리기 어려운 카드는 거절하고, 받는 카드는 말로 승인 범위 안에서 실행한다.
// 구매요청 초안은 실제 MessageActionService로 작업 로그·사유 표시까지 본다.
import { AI_VOICE_APPROVABLE_KINDS, type AuthUser } from '@fantasteel/shared';
import type { AuthUserService } from '../../common/auth/auth-user.service';
import { isInVoiceApprovedRun, runAsVoiceApproved } from '../../common/business-event/ai-assisted.context';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import type { NumberingService } from '../../common/numbering/numbering.service';
import type { PrismaService, Tx } from '../../prisma/prisma.service';
import type { ActionTypeRegistry } from '../message-action/action-types/action-type.registry';
import type { DraftExtractor } from '../message-action/draft-extractor';
import type { MessageActionRepository } from '../message-action/message-action.repository';
import { MessageActionService } from '../message-action/message-action.service';
import { AiAssistantService } from './ai-assistant.service';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';

const user = { employeeId: 1 } as AuthUser;

const setup = (company = { enabled: true, voiceApproval: true }) => {
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
    wakeSettings: { read: async () => company },
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

describe('회사 설정 (이슈 #457)', () => {
  it('관리자가 말로 승인을 꺼 두면 말로 승인한 실행은 VOC-012, 눌러 실행은 그대로', async () => {
    const { service, seen } = setup({ enabled: true, voiceApproval: false });
    await expect(service.executeActionCard(user, dto('TASK', true))).rejects.toMatchObject({ code: 'VOC-012' });
    await service.executeActionCard(user, dto('TASK'));
    expect(seen).toEqual([false]);
  });
});

describe('말로 승인한 구매요청 초안의 작업 로그', () => {
  it('createFromAssistant는 같은 트랜잭션에 DRAFT_CREATED를 AI 경유로 남기고, 말로 승인 범위면 사유에 표시가 붙는다', async () => {
    const created: { businessEventType: string; reason: string | null; isAiAssisted: boolean }[] = [];
    const tx = {
      businessEvent: {
        create: async ({ data }: { data: (typeof created)[number] }) => {
          created.push(data);
          return { id: 1, businessEventNo: 'EV-1' };
        },
      },
    } as unknown as Tx;
    const recorder = new BusinessEventRecorder({ nextDocumentNumber: async () => 'EV-1' } as unknown as NumberingService);
    const registry = { get: () => ({ permission: 'PURCHASE_REQUISITION', assertCanExecute: async () => undefined }) } as unknown as ActionTypeRegistry;
    const repository = { createDraft: async () => ({ id: 5, draftStatus: 'AI_GENERATED' }), updateDraft: async () => undefined } as unknown as MessageActionRepository;
    const service = new MessageActionService({} as PrismaService, repository, {} as AuthUserService, recorder, registry, {} as DraftExtractor);
    const requester = { employeeId: 1, permissions: { PURCHASE_REQUISITION: 'USE' } } as unknown as AuthUser;
    const payload = { itemId: 3, requestedTon: '10', desiredReceiptDate: '2026-11-01', requestReason: '원료 보충', sourceText: null };
    await runAsVoiceApproved(() => service.createFromAssistant(tx, requester, payload));
    expect(created).toEqual([expect.objectContaining({ businessEventType: 'DRAFT_CREATED', reason: '철강맨 말로 승인', isAiAssisted: true })]);
  });
});
