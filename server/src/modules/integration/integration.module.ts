import { Module } from '@nestjs/common';
import { GoogleDriveClient } from './google-drive/google-drive.client';
import { GoogleDriveController } from './google-drive/google-drive.controller';
import { GoogleDriveService } from './google-drive/google-drive.service';
import { GoogleServiceAccount } from './google-drive/google-service-account';
import { IntegrationConnectionRepository } from './integration-connection.repository';
import { IntegrationController } from './integration.controller';
import { IntegrationCrypto } from './integration-crypto';
import { IntegrationService } from './integration.service';
import { IntegrationTokenStore } from './integration-token.store';
import { McpClientService } from './mcp/mcp.client';
import { NotionAssistantService } from './notion/notion-assistant.service';
import { NotionPageService } from './notion/notion-page.service';
import { NotionSyncRepository } from './notion/notion-sync.repository';
import { NotionWorkspaceService } from './notion/notion-workspace.service';

/**
 * 외부 서비스 연결 (이슈 #358 Notion MCP, #361 Google Drive). 작업 안내: docs/backend/integration.md
 * 암호화·토큰 저장(IntegrationTokenStore)은 MCP 클라이언트와 Google Drive(REST API + OAuth 2.0)가 함께 쓴다.
 * 회의록 모듈이 NotionPageService로 페이지를 만들고, GoogleDriveService로 Drive 녹음을 받아 전사한다.
 * NotionWorkspaceService(#391)는 일정·회의록·할 일을 Notion 데이터베이스에 한 방향으로 반영한다. NotionAssistantService(#398)는 철강맨AI의 Notion 읽기·쓰기.
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
    NotionAssistantService,
    NotionSyncRepository,
    NotionWorkspaceService,
    GoogleDriveClient,
    GoogleDriveService,
    GoogleServiceAccount,
  ],
  // 일정·업무·회의록을 저장하는 모듈이 NotionWorkspaceService.kick()으로 Notion 업무 공간 반영을 깨운다 (이슈 #391).
  // 철강맨AI가 NotionAssistantService로 상위 페이지 아래를 읽고 쓴다 (이슈 #398)
  exports: [NotionPageService, NotionAssistantService, NotionWorkspaceService, McpClientService, IntegrationTokenStore, GoogleDriveService],
})
export class IntegrationModule {}
