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
 * ERD에 채번 카운터 테이블이 없어서 "같은 앞부분의 최댓값 + 1"로 정한다. 두 요청이 동시에 같은 번호를 받으면
 * 번호 컬럼의 unique 제약이 뒤 요청을 막고(P2002 → COM-001), 사용자가 다시 시도하면 된다.
 * 한 트랜잭션에서 같은 종류를 여러 개 만들 때(슬래브 여러 매 등)는 첫 번호를 받은 뒤 순번을 직접 늘린다.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly repository: NumberingRepository) {}

  /** 수주 SO- · 생산계획 PP- · 구매요청 PR- · 발주 PO- · 입고 GR- · 출하요청 DR- · 작업 로그 EV- */
  async nextDocumentNumber(tx: Tx, kind: DocumentNumberKind, at: Date = new Date()): Promise<string> {
    const prefix = documentNumberPrefix(kind, at);
    const last = await this.repository.findLastDocumentNumber(tx, kind, prefix);
    return formatDocumentNumber(kind, nextSequence(prefix, last), at);
  }

  /** 원료 RM-원료코드- · 용선 HM-고로- · 히트 HT-전로- (+YYMMDD-순번). 슬래브·코일은 number-format의 formatSlabNumber·formatCoilNumber */
  async nextLotNumber(tx: Tx, kind: DatedLotKind, code: string, at: Date = new Date()): Promise<string> {
    const prefix = lotNumberPrefix(kind, code, at);
    // 채번 종류(RAW_MATERIAL·HOT_METAL·HEAT)가 곧 LOT 유형 값이다 (공통 코드 LOT_TYPE)
    const last = await this.repository.findLastLotNumber(tx, prefix, kind);
    return formatLotNumber(kind, code, nextSequence(prefix, last), at);
  }

  /** 밀시트 MS-{출하요청 일련}-N (출하요청 안에서 수주별 1부터) */
  async nextMillSheetNumber(tx: Tx, shipmentRequestId: number, shipmentRequestNo: string): Promise<string> {
    return formatMillSheetNumber(shipmentRequestNo, (await this.repository.countMillSheets(tx, shipmentRequestId)) + 1);
  }
}
