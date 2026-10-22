import { Module } from '@nestjs/common';
import { MasterDataController } from './master-data.controller';
import { MasterDataRepository } from './master-data.repository';
import { MasterDataService } from './master-data.service';

/** 기준정보 (REQ-MST-001~009, BP-MST-01). 작업 안내: docs/backend/master-data.md */
@Module({
  controllers: [MasterDataController],
  providers: [MasterDataService, MasterDataRepository],
  // 철강맨AI 기준정보 조회 도구(이슈 #506)가 기준정보 화면과 같은 목록 service를 쓴다
  exports: [MasterDataService],
})
export class MasterDataModule {}
