import { Module } from '@nestjs/common';
import { IntegrationConnectionRepository } from './integration-connection.repository';
import { IntegrationController } from './integration.controller';
import { IntegrationCrypto } from './integration-crypto';
import { IntegrationService } from './integration.service';
import { IntegrationTokenStore } from './integration-token.store';
import { McpClientService } from './mcp/mcp.client';
import { NotionPageService } from './notion/notion-page.service';

/**
 * 외부 서비스 연결 (이슈 #358). 작업 안내: docs/backend/integration.md
 * 암호화·토큰 저장(IntegrationTokenStore)은 MCP가 아닌 연결(Google Drive REST API)도 함께 쓰도록 MCP 클라이언트 밖에 둔다.
 * 회의록 모듈이 NotionPageService로 페이지를 만든다.
 */
@Module({
  controllers: [IntegrationController],
  providers: [IntegrationService, IntegrationConnectionRepository, IntegrationCrypto, IntegrationTokenStore, McpClientService, NotionPageService],
  exports: [NotionPageService, McpClientService, IntegrationTokenStore],
})
export class IntegrationModule {}
