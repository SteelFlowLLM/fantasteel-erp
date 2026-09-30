import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** 채번 날짜는 Asia/Seoul 기준. */
export function kstParts(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600_000);
  const yyyy = k.getUTCFullYear();
  const mm = pad(k.getUTCMonth() + 1, 2);
  const dd = pad(k.getUTCDate(), 2);
  return { yyyymmdd: `${yyyy}${mm}${dd}`, yymmdd: `${String(yyyy).slice(2)}${mm}${dd}` };
}

/** 업무번호·LOT 채번. 종류·날짜·설비별 DB 카운터를 쓰고 같은 트랜잭션에서 증가시킨다. */
@Injectable()
export class NumberingService {
  /** 카운터를 1 올리고 새 값을 돌려준다 (행 잠금으로 동시 채번 안전). */
  async next(tx: Tx, sequenceKey: string): Promise<number> {
    const row = await tx.numberSequence.upsert({
      where: { sequenceKey },
      create: { sequenceKey, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return row.lastValue;
  }

  /** 수주 SO- / 생산계획 PP- / 구매요청 PR- / 발주 PO- / 입고 RCV- / 출하 SHP- / 밀시트 MS- + YYYYMMDD-NNNN */
  async documentNo(tx: Tx, prefix: 'SO' | 'PP' | 'PR' | 'PO' | 'RCV' | 'SHP' | 'GI' | 'MS' | 'MRP' | 'QI', at = new Date()): Promise<string> {
    const { yyyymmdd } = kstParts(at);
    const key = `${prefix}-${yyyymmdd}`;
    return `${key}-${pad(await this.next(tx, key), 4)}`;
  }

  /** 원료 LOT: RM-원료코드-YYMMDD-NNN */
  async rawMaterialLotNo(tx: Tx, materialCode: string, at = new Date()): Promise<string> {
    const key = `RM-${materialCode}-${kstParts(at).yymmdd}`;
    return `${key}-${pad(await this.next(tx, key), 3)}`;
  }
  /** 용선: HM-고로-YYMMDD-NN */
  async hotMetalNo(tx: Tx, blastFurnaceNo: string, at = new Date()): Promise<string> {
    const key = `HM-${blastFurnaceNo}-${kstParts(at).yymmdd}`;
    return `${key}-${pad(await this.next(tx, key), 2)}`;
  }
  /** 히트: HT-전로-YYMMDD-NNN */
  async heatNo(tx: Tx, converterNo: string, at = new Date()): Promise<string> {
    const key = `HT-${converterNo}-${kstParts(at).yymmdd}`;
    return `${key}-${pad(await this.next(tx, key), 3)}`;
  }
  /** 슬래브: 히트번호-SS (히트 안에서 1부터) */
  slabNo(heatNo: string, seq: number): string {
    return `${heatNo}-${pad(seq, 2)}`;
  }
  /** 코일: C + 슬래브번호(HT- 제외) */
  coilNo(slabNo: string): string {
    return `C${slabNo.replace(/^HT-/, '')}`;
  }
}
