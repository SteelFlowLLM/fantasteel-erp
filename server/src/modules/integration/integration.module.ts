import { Module } from '@nestjs/common';
import { GoogleDriveClient } from './google-drive/google-drive.client';
import { GoogleDriveController } from './google-drive/google-drive.controller';
import { GoogleDriveService } from './google-drive/google-drive.service';
import { IntegrationConnectionRepository } from './integration-connection.repository';
import { IntegrationController } from './integration.controller';
import { IntegrationCrypto } from './integration-crypto';
import { IntegrationService } from './integration.service';
import { IntegrationTokenStore } from './integration-token.store';
import { McpClientService } from './mcp/mcp.client';
import { NotionPageService } from './notion/notion-page.service';

/**
 * 외부 서비스 연결 (이슈 #358 Notion MCP, #361 Google Drive). 작업 안내: docs/backend/integration.md
 * 암호화·토큰 저장(IntegrationTokenStore)은 MCP 클라이언트와 Google Drive(REST API + OAuth 2.0)가 함께 쓴다.
 * 회의록 모듈이 NotionPageService로 페이지를 만들고, GoogleDriveService로 Drive 녹음을 받아 전사한다.
 */
@Module({
  controllers: [IntegrationController, GoogleDriveController],
  providers: [
    IntegrationService,
    IntegrationConnectionRepository,
    IntegrationCrypto,
    IntegrationTokenStore,
    McpClientService,
    NotionPageService,
    GoogleDriveClient,
    GoogleDriveService,
  ],
  exports: [NotionPageService, McpClientService, IntegrationTokenStore, GoogleDriveService],
})
export class IntegrationModule {}
