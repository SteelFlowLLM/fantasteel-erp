import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller';
import { OrganizationRepository } from './organization.repository';
import { OrganizationService } from './organization.service';

/** 조직관리·사원 (REQ-AUTH-002~004, REQ-ORG-001~004, BP-AUTH-01). 작업 안내: docs/backend/organization.md */
@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService, OrganizationRepository],
  // notification이 부서 알림을 부서원별로 펼칠 때 findActiveMemberIds를 부른다
  exports: [OrganizationService],
})
export class OrganizationModule {}
