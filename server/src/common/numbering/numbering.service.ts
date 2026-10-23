import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';
import {
  type DatedLotKind,
  type DocumentNumberKind,
  documentNumberPrefix,
  formatDocumentNumber,
  formatLotNumber,
  formatMillSheetNumber,
  lotNumberPrefix,
  nextSequence,
} from './number-format';
import { NumberingRepository } from './numbering.repository';

/**
 * 업무 번호·LOT 채번 (업무 프로세스 정의서 9.1·9.2). 반드시 번호를 저장하는 트랜잭션 안에서 부른다.
 *
 * ERD에 채번 카운터 테이블이 없어서 "같은 앞부분의 최댓값 + 1"로 정한다. 최댓값을 읽기 전에 그 앞부분을 트랜잭션 끝까지 잠가서
 * 동시 거래는 앞 거래가 커밋한 뒤 그 번호를 보고 다음 번호를 받는다. 잠그지 않으면 거의 모든 업무 거래가 남기는 작업 로그(EV-)
 * 번호가 겹쳐 unique 위반으로 본 거래 전체가 실패한다.
 * 한 트랜잭션에서 같은 종류를 여러 개 만들 때(슬래브 여러 매 등)는 첫 번호를 받은 뒤 순번을 직접 늘린다.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly repository: NumberingRepository) {}

  /** 수주 SO- · 생산계획 PP- · 구매요청 PR- · 발주 PO- · 입고 GR- · 출하요청 DR- · 작업 로그 EV- */
  async nextDocumentNumber(tx: Tx, kind: DocumentNumberKind, at: Date = new Date()): Promise<string> {
    const prefix = documentNumberPrefix(kind, at);
    await this.repository.lockPrefix(tx, prefix);
    const last = await this.repository.findLastDocumentNumber(tx, kind, prefix);
    return formatDocumentNumber(kind, nextSequence(prefix, last), at);
  }

  /**
   * 그 날짜 업무 번호의 앞부분 잠금만 잡고 번호는 받지 않는다. 잠금 순서를 맞추려고 채번보다 먼저 잡을 때 쓴다
   * (예: 원료 LOT을 잠그기 전에 작업 로그 EV 잠금을 잡아, EV → 원료 LOT 순으로 잠그는 제선 실적과 교착하지 않게).
   * 트랜잭션 잠금이라 같은 트랜잭션의 뒤 nextDocumentNumber는 다시 잡고 그대로 다음 번호를 받는다
   */
  async lockDocumentNumber(tx: Tx, kind: DocumentNumberKind, at: Date = new Date()): Promise<void> {
    await this.repository.lockPrefix(tx, documentNumberPrefix(kind, at));
  }

  /** 원료 RM-원료코드- · 용선 HM-고로- · 히트 HT-전로- (+YYMMDD-순번). 슬래브·코일은 number-format의 formatSlabNumber·formatCoilNumber */
  async nextLotNumber(tx: Tx, kind: DatedLotKind, code: string, at: Date = new Date()): Promise<string> {
    const prefix = lotNumberPrefix(kind, code, at);
    await this.repository.lockPrefix(tx, prefix);
    // 채번 종류(RAW_MATERIAL·HOT_METAL·HEAT)가 곧 LOT 유형 값이다 (공통 코드 LOT_TYPE)
    const last = await this.repository.findLastLotNumber(tx, prefix, kind);
    return formatLotNumber(kind, code, nextSequence(prefix, last), at);
  }

  /** 밀시트 MS-{출하요청 일련}-N (출하요청 안에서 수주별 1부터) */
  async nextMillSheetNumber(tx: Tx, shipmentRequestId: number, shipmentRequestNo: string): Promise<string> {
    return formatMillSheetNumber(shipmentRequestNo, (await this.repository.countMillSheets(tx, shipmentRequestId)) + 1);
  }
}
