import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataRepository } from './master-data.repository';

/**
 * 업무 로직·트랜잭션·데이터에 따른 권한 검사 (컨벤션 6장).
 * 트랜잭션: this.prisma.$transaction(async (tx) => { ... }) 안에서 repository와 businessEventRecorder.record(tx, ...)를 부른다.
 */
@Injectable()
export class MasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MasterDataRepository,
  ) {}
}
