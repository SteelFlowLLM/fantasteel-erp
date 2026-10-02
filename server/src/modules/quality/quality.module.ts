import { Module } from '@nestjs/common';
import { QualityController } from './quality.controller';
import { QualityRepository } from './quality.repository';
import { QualityService } from './quality.service';

/** 검사 기준·검사·자동 판정·불합격 처리 (REQ-QC-001~004, BP-QC-01). 작업 안내: docs/backend/quality.md */
@Module({
  controllers: [QualityController],
  providers: [QualityService, QualityRepository],
})
export class QualityModule {}
