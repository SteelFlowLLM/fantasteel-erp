import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller';
import { OrganizationRepository } from './organization.repository';
import { OrganizationService } from './organization.service';

/** 조직관리·사원 (REQ-AUTH-002~004, REQ-ORG-001~004, BP-AUTH-01). 작업 안내: docs/backend/organization.md */
@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService, OrganizationRepository],
})
export class OrganizationModule {}
