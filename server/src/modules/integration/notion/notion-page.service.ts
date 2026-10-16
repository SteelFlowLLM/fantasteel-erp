import { Injectable } from '@nestjs/common';
import { INTEGRATION_PROVIDER } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConnectionRepository } from '../integration-connection.repository';
import { readSettings } from '../integration-settings';
import { McpClientService } from '../mcp/mcp.client';
import { buildCreatePageArgs, NOTION_CREATE_PAGES_TOOL, readCreatedPageUrl, type NotionPageDraft } from './notion.tools';

/**
 * 회사 Notion 계정으로 페이지를 만든다. LLM에게 Notion 도구를 넘기지 않고 서버 코드가 정한 도구 하나만 부른다.
 * 페이지는 관리자가 연결 설정에서 고른 상위 페이지 아래에 생긴다.
 */
@Injectable()
export class NotionPageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: IntegrationConnectionRepository,
    private readonly mcp: McpClientService,
  ) {}

  /** 연결·상위 페이지가 준비됐는지 먼저 본다 (내보내기 전에 회의록을 잡아 두지 않게) */
  async assertReady(): Promise<string> {
    const row = await this.repository.findByProviderKey(this.prisma, INTEGRATION_PROVIDER.NOTION);
    if (!row?.oauthTokens) {
      if (row?.connectedAt) throw new AppException('INT-003');
      throw new AppException('INT-002', 'Notion이 연결되어 있지 않아요. 관리자가 먼저 연결해 주세요');
    }
    const parentPageId = readSettings(row.settings).parentPageId;
    if (!parentPageId) throw new AppException('INT-006');
    return parentPageId;
  }

  /** 새 페이지 주소를 돌려준다 */
  async createPage(page: NotionPageDraft): Promise<string> {
    const parentPageId = await this.assertReady();
    return this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => {
      const tool = (await session.listTools()).find((t) => t.name === NOTION_CREATE_PAGES_TOOL);
      if (!tool) throw new AppException('INT-005', `Notion MCP 서버에 ${NOTION_CREATE_PAGES_TOOL} 도구가 없어요`);
      const result = await session.callTool(tool.name, buildCreatePageArgs(tool, parentPageId, page));
      return readCreatedPageUrl(result);
    });
  }
}
