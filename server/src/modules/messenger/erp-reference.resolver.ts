import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';
import { MessengerRepository } from './messenger.repository';

export interface MessageLinkView {
  /** 메시지에 적힌 번호 그대로 */
  label: string;
  /** 프론트 경로 (SERVER-GUIDE 8장) */
  linkPath: string;
}

export type ErpReferenceKind = 'SALES_ORDER' | 'PURCHASE_REQUISITION' | 'LOT';
export interface ErpReferenceCandidate {
  kind: ErpReferenceKind;
  /** 번호 후보. LOT은 뒤 토막을 하나씩 뗀 것까지 긴 것부터 (예: "HT-1-260921-001-01", "HT-1-260921-001"). */
  numbers: string[];
}

// 채번 규칙(NumberingService): SO-/PR-YYYYMMDD-NNNN, RM-코드-YYMMDD-NNN, HM-고로-YYMMDD-NN, HT-전로-YYMMDD-NNN(-SS), C전로-YYMMDD-NNN-SS
const REFERENCE_PATTERN = /(?<![A-Za-z0-9])(?:(SO|PR)-\d{8}-\d{4}(?!\d)|(?:HT|HM|RM)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|C\d+(?:-\d+){2,3}(?![A-Za-z0-9]))/g;

/** 내용에서 ERP 번호처럼 보이는 것을 나온 순서대로 뽑는다 (DB 확인 전). */
export function extractErpReferences(content: string): ErpReferenceCandidate[] {
  const out: ErpReferenceCandidate[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(REFERENCE_PATTERN)) {
    const text = m[0];
    if (seen.has(text)) continue;
    seen.add(text);
    if (m[1]) {
      out.push({ kind: m[1] === 'SO' ? 'SALES_ORDER' : 'PURCHASE_REQUISITION', numbers: [text] });
      continue;
    }
    // "HT-1-260921-001-A확인"처럼 번호 뒤에 다른 글자가 붙어도 앞부분이 실제 LOT이면 찾도록 짧은 후보도 둔다
    const parts = text.split('-');
    const numbers: string[] = [];
    for (let n = parts.length; n >= 3; n--) numbers.push(parts.slice(0, n).join('-'));
    out.push({ kind: 'LOT', numbers });
  }
  return out;
}

/** 메시지 내용의 수주번호·LOT번호·구매요청번호를 ERP 화면 링크로 바꾼다 (REQ-MSG-006). 실제로 있는 번호만. */
@Injectable()
export class ErpReferenceResolver {
  constructor(private readonly repo: MessengerRepository) {}

  async resolve(tx: Tx, content: string): Promise<MessageLinkView[]> {
    return (await this.resolveMany(tx, [content]))[0];
  }

  /** 여러 메시지를 한 번에 (목록 조회에서 메시지마다 DB를 부르지 않도록). */
  async resolveMany(tx: Tx, contents: string[]): Promise<MessageLinkView[][]> {
    const candidates = contents.map(extractErpReferences);
    const numbersOf = (kind: ErpReferenceKind) => [...new Set(candidates.flat().filter((c) => c.kind === kind).flatMap((c) => c.numbers))];
    const [soNos, prNos, lotNos] = [numbersOf('SALES_ORDER'), numbersOf('PURCHASE_REQUISITION'), numbersOf('LOT')];
    // 같은 tx 연결에서 도는 조회라 차례로 부른다 (한 연결에 동시 쿼리를 걸지 않는다)
    const salesOrders = soNos.length ? await this.repo.findSalesOrdersByNo(tx, soNos) : [];
    const requisitions = prNos.length ? await this.repo.findPurchaseRequisitionsByNo(tx, prNos) : [];
    const lots = lotNos.length ? await this.repo.findLotsByNo(tx, lotNos) : [];
    const salesOrderIdByNo = new Map(salesOrders.map((s) => [s.salesOrderNo, s.id]));
    const requisitionIdByNo = new Map(requisitions.map((p) => [p.purchaseRequisitionNo, p.id]));
    const existingLotNos = new Set(lots.map((l) => l.lotNo));

    return candidates.map((list) => {
      const links: MessageLinkView[] = [];
      const add = (label: string, linkPath: string) => {
        if (!links.some((l) => l.label === label)) links.push({ label, linkPath });
      };
      for (const c of list) {
        if (c.kind === 'SALES_ORDER') {
          const id = salesOrderIdByNo.get(c.numbers[0]);
          if (id) add(c.numbers[0], `/sales-orders/${id}`);
        } else if (c.kind === 'PURCHASE_REQUISITION') {
          const id = requisitionIdByNo.get(c.numbers[0]);
          if (id) add(c.numbers[0], `/purchase-requisitions/${id}`);
        } else {
          const lotNo = c.numbers.find((n) => existingLotNos.has(n));
          if (lotNo) add(lotNo, `/lots/trace?lot=${encodeURIComponent(lotNo)}`);
        }
      }
      return links;
    });
  }
}
