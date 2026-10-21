// 일정 Notion 상태·안내 (이슈 #434): 연결 없음 · 업무 공간 없음 · 준비됨 · 상태를 읽다 실패, 네 갈래를 DB 없이 본다.
import type { PrismaService } from '../../../prisma/prisma.service';
import type { IntegrationConnectionRepository } from '../integration-connection.repository';
import type { McpClientService } from '../mcp/mcp.client';
import type { NotionPageService } from './notion-page.service';
import type { NotionSyncRepository } from './notion-sync.repository';
import { NotionWorkspaceService } from './notion-workspace.service';

const ref = (id: string) => ({ dataSourceId: id, databaseId: null, url: null });
const READY = { notionWorkspace: { scheduleEvents: ref('c1'), meetingMinutes: ref('c2'), tasks: ref('c3'), calendar: { accountId: 'acc-1', calendarId: 'erp-cal', name: 'ERP 일정', sendInvites: false } } };

function serviceWith(find: () => Promise<unknown>): NotionWorkspaceService {
  const connections = { findByProviderKey: find } as unknown as IntegrationConnectionRepository;
  return new NotionWorkspaceService({} as PrismaService, connections, {} as NotionSyncRepository, {} as McpClientService, {} as NotionPageService);
}

describe('일정 Notion 상태 (scheduleStatus·scheduleNotice)', () => {
  it('Notion 토큰이 없으면 연결되지 않았다고 알린다', async () => {
    const service = serviceWith(async () => ({ oauthTokens: null, settings: READY }));
    expect(await service.scheduleStatus()).toEqual({ ready: false, reason: 'Notion이 연결되지 않았어요', calendarName: null });
    expect(await service.scheduleNotice()).toBe('Notion이 연결되지 않았어요. 일정은 ERP에만 넣었고, Notion이 준비되면 자동으로 올라가요');
  });

  it('연결은 됐지만 업무 공간 데이터베이스가 다 있지 않으면 그 이유', async () => {
    const service = serviceWith(async () => ({ oauthTokens: 'secret', settings: { notionWorkspace: { scheduleEvents: ref('c1') } } }));
    expect(await service.scheduleStatus()).toEqual({ ready: false, reason: '관리자가 아직 Notion 업무 공간을 만들지 않았어요', calendarName: null });
  });

  it('준비됐으면 고른 캘린더 이름을 알리고 안내는 없다', async () => {
    const service = serviceWith(async () => ({ oauthTokens: 'secret', settings: READY }));
    expect(await service.scheduleStatus()).toEqual({ ready: true, reason: null, calendarName: 'ERP 일정' });
    expect(await service.scheduleNotice()).toBeNull();
  });

  it('상태를 읽다 실패해도 안내는 던지지 않고 null (일정은 이미 저장됐다)', async () => {
    const service = serviceWith(async () => {
      throw new Error('DB 연결 끊김');
    });
    await expect(service.scheduleStatus()).rejects.toThrow('DB 연결 끊김');
    expect(await service.scheduleNotice()).toBeNull();
  });
});
