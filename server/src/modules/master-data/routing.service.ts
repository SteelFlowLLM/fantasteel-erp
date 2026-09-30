import { Injectable } from '@nestjs/common';
import { ITEM_TYPE, PROCESS_CODE, PROCESS_CODE_LABEL, type AuthUser, type ProcessCode } from '@fantasteel/shared';
import { badInput, notFound } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { ReplaceRoutingDto } from './dto/replace-routing.dto';
import { UpdateRoutingYieldDto } from './dto/update-routing-yield.dto';
import { MasterChangeRecorder } from './master-change.recorder';
import { RoutingRepository, type RoutingRow } from './routing.repository';
import { validateRoutingProcesses, validateYield } from './routing.rules';

const ROUTING_ITEM_TYPES = [ITEM_TYPE.SLAB, ITEM_TYPE.COIL] as const;

const processView = (r: RoutingRow) => ({
  id: r.id,
  processCode: r.processCode,
  processName: PROCESS_CODE_LABEL[r.processCode as ProcessCode] ?? r.processCode,
  processSeq: r.processSeq,
  plannedYieldRate: r.plannedYieldRate,
  /** 열연은 규격 매핑에서 계산(MAPPING), 나머지는 입력값(INPUT) */
  yieldSource: r.processCode === PROCESS_CODE.HOT_ROLLING ? 'MAPPING' : 'INPUT',
});

function group(itemType: string, rows: RoutingRow[]) {
  return { itemType, processes: rows.filter((r) => r.itemType === itemType).map(processView) };
}

@Injectable()
export class RoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RoutingRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  /** 품목 유형별 공정 순서·수율. 공정 순서는 코드가 아니라 DB에서 읽는다. */
  async list() {
    const rows = await this.repo.findMany(this.prisma);
    return ROUTING_ITEM_TYPES.map((t) => group(t, rows));
  }

  async get(itemType: string) {
    this.assertItemType(itemType);
    return group(itemType, await this.repo.findMany(this.prisma, itemType));
  }

  /** 배열 순서대로 공정 순서를 다시 정하고 수율을 저장한다 (공정 추가·삭제·순서 변경). */
  async replace(itemType: string, dto: ReplaceRoutingDto, user: AuthUser) {
    this.assertItemType(itemType);
    validateRoutingProcesses(dto.processes);
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findMany(tx, itemType);
      await this.repo.replace(tx, itemType, dto.processes.map((p) => ({ processCode: p.processCode, plannedYieldRate: p.plannedYieldRate ?? null })));
      const after = await this.repo.findMany(tx, itemType);
      await this.changes.record(tx, user, {
        targetNo: `ROUTING-${itemType}`, summary: `${itemType === ITEM_TYPE.COIL ? '코일' : '슬래브'} 라우팅 수정 (${after.map((r) => PROCESS_CODE_LABEL[r.processCode as ProcessCode]).join(' → ')})`,
        before: before.map(processView), after: after.map(processView),
      });
      return group(itemType, after);
    });
  }

  /** 공정 1개의 계획 수율만 바꾼다. */
  async updateYield(id: number, dto: UpdateRoutingYieldDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('라우팅 공정');
      validateYield(before.processCode, dto.plannedYieldRate);
      const row = await this.repo.updateYield(tx, id, dto.plannedYieldRate ?? null);
      await this.changes.record(tx, user, {
        targetNo: `ROUTING-${row.itemType}-${row.processCode}`, targetId: row.id,
        summary: `${row.itemType === ITEM_TYPE.COIL ? '코일' : '슬래브'} 라우팅 ${PROCESS_CODE_LABEL[row.processCode as ProcessCode]} 계획 수율 수정`,
        before: processView(before), after: processView(row),
      });
      return processView(row);
    });
  }

  private assertItemType(itemType: string): asserts itemType is 'SLAB' | 'COIL' {
    if (!(ROUTING_ITEM_TYPES as readonly string[]).includes(itemType)) throw badInput('품목 유형은 SLAB 또는 COIL 이어야 합니다');
  }
}
