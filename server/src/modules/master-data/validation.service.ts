import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReadinessRepository } from './readiness.repository';
import { evaluateReadiness } from './readiness.rules';

/** 기준정보 준비 상태 점검 (BP-MST-01, MST-001). 저장·수정하지 않고 읽기만 한다. */
@Injectable()
export class ValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ReadinessRepository,
  ) {}

  async check() {
    const problems = evaluateReadiness(await this.repo.loadSnapshot(this.prisma));
    return { ready: problems.length === 0, checkedAt: new Date(), problemCount: problems.length, problems };
  }
}
