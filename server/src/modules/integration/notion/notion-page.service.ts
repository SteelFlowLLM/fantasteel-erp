import { Injectable, Logger } from '@nestjs/common';
import { INTEGRATION_PROVIDER } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConnectionRepository } from '../integration-connection.repository';
import { readSettings } from '../integration-settings';
import { isRejectedBeforeRun, McpClientService } from '../mcp/mcp.client';
import { buildCreatePageArgs, NOTION_CREATE_PAGES_TOOL, parentPageNotFound, readCreatedPageUrl, type NotionPageDraft } from './notion.tools';

/** 페이지가 만들어졌는지 알 수 없을 때. 다시 누르면 같은 페이지가 하나 더 생길 수 있어 확인을 먼저 부탁한다 */
const UNCERTAIN_MESSAGE = 'Notion 페이지가 만들어졌는지 확인하지 못했어요. 상위 페이지에 이미 생겼는지 Notion에서 확인한 뒤, 없으면 몇 분 뒤 다시 내보내 주세요';

/**
 * 회사 Notion 계정으로 페이지를 만든다. LLM에게 Notion 도구를 넘기지 않고 서버 코드가 정한 도구 하나만 부른다.
 * 페이지는 관리자가 연결 설정에서 고른 상위 페이지 아래에 생긴다.
 */
@Injectable()
export class NotionPageService {
  private readonly logger = new Logger(NotionPageService.name);

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

  /**
   * 새 페이지 주소를 돌려준다. beforeCall은 도구를 부르기 바로 전(같은 연결의 다른 호출을 기다린 뒤)에 불린다: 부르는 쪽이 여기서 대상을 잡는다.
   * beforeCall 뒤의 실패 중 페이지가 만들어졌는지 알 수 없는 것(시간 초과·연결 끊김·주소 없는 성공 답)은 INT-009로 던진다.
   * 그 밖의 오류는 페이지를 만들지 않은 것이다.
   */
  async createPage(page: NotionPageDraft, beforeCall: () => Promise<void> = async () => undefined): Promise<string> {
    const parentPageId = await this.assertReady();
    return this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => {
      const tool = (await session.listTools()).find((t) => t.name === NOTION_CREATE_PAGES_TOOL);
      if (!tool) throw new AppException('INT-005', `Notion MCP 서버에 ${NOTION_CREATE_PAGES_TOOL} 도구가 없어요`);
      const args = buildCreatePageArgs(tool, parentPageId, page);
      await beforeCall();
      let result;
      try {
        result = await session.callTool(tool.name, args);
      } catch (error) {
        if (isRejectedBeforeRun(error)) throw parentPageNotFound(error) ?? error;
        this.logger.warn(`Notion 페이지 만들기 결과를 알 수 없음: ${error instanceof Error ? error.message : String(error)}`);
        throw new AppException('INT-009', UNCERTAIN_MESSAGE);
      }
      const url = readCreatedPageUrl(result);
      if (!url) {
        this.logger.warn('Notion 페이지 만들기 응답에 주소가 없음');
        throw new AppException('INT-009', UNCERTAIN_MESSAGE);
      }
      return url;
    });
  }
}
