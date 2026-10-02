// 작업 실적 표: 시작·완료 일시(완료 일시가 없으면 진행 중), 고로·전로 코드, 투입·산출, 만든 LOT, 시뮬레이션 값
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PROCESS_TYPE_LABEL, type ProcessType } from '@/codes';
import type { ProductionResultView } from '@/api/production';
import { Badge } from '@/components/Badge';
import { Table, Td, Th } from '@/components/Table';
import { EmptyNote } from '@/components/StateView';
import { actualLossRateText, fmtLossRate } from '@/features/production/lib/productionDisplay';
import { fmtMDHM, fmtTon } from '@/lib/format';

const traceHref = (lotNo: string) => `/lots/trace?lot=${encodeURIComponent(lotNo)}`;

function ioText(r: ProductionResultView): { input: string; output: string } {
  const p = r.processType as ProcessType;
  if (r.completedAt === null) return { input: '-', output: '-' };
  switch (p) {
    case 'IRONMAKING':
      return { input: `원료 ${fmtTon(r.inputTon)}`, output: `용선 ${fmtTon(r.outputTon)}` };
    case 'STEELMAKING':
      return { input: `용선 ${fmtTon(r.inputTon)}`, output: `히트 ${fmtTon(r.outputTon)}` };
    case 'CONTINUOUS_CASTING':
      return { input: `히트 ${fmtTon(r.inputTon)}`, output: `슬래브 ${r.outputQty ?? 0}매 · ${fmtTon(r.outputTon)}` };
    default:
      return { input: `슬래브 ${fmtTon(r.inputTon)}`, output: `코일 ${r.outputQty ?? 0}개 · ${fmtTon(r.outputTon)}` };
  }
}

export function LotLinks({ lotNos, max = 3 }: { lotNos: readonly string[]; max?: number }) {
  if (lotNos.length === 0) return <span className="text-ink-3">-</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {lotNos.slice(0, max).map((no) => (
        <Link key={no} href={traceHref(no)} className="font-mono text-mono text-run hover:underline">
          {no}
        </Link>
      ))}
      {lotNos.length > max ? <span className="text-cap text-ink-3">외 {lotNos.length - max}개</span> : null}
    </span>
  );
}

export interface ResultsTableProps {
  results: readonly ProductionResultView[];
  /** 공정 열을 보일지 (공정별 묶음 안에서는 숨긴다) */
  showProcess?: boolean;
  emptyText: string;
  /** 행 끝 작업 칸 (진행 중 실적의 '작업 완료' 등) */
  action?: (result: ProductionResultView) => ReactNode;
}

export function ResultsTable({ results, showProcess, emptyText, action }: ResultsTableProps) {
  if (results.length === 0) return <EmptyNote>{emptyText}</EmptyNote>;
  return (
    <div className="overflow-x-auto">
      <Table compact>
        <thead>
          <tr>
            {showProcess ? <Th>공정</Th> : null}
            <Th>작업 시작</Th>
            <Th>작업 완료</Th>
            <Th>고로·전로</Th>
            <Th align="right">투입</Th>
            <Th align="right">산출</Th>
            <Th>만든 LOT</Th>
            <Th>실적 시뮬레이션</Th>
            <Th>작업자</Th>
            {action ? <Th align="right">작업</Th> : null}
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const io = ioText(r);
            return (
              <tr key={r.id}>
                {showProcess ? <Td className="font-medium">{PROCESS_TYPE_LABEL[r.processType as ProcessType] ?? r.processType}</Td> : null}
                <Td>{fmtMDHM(r.startedAt)}</Td>
                <Td>{r.completedAt ? fmtMDHM(r.completedAt) : <Badge tone="run">진행 중</Badge>}</Td>
                <Td className="font-mono text-mono">{r.blastFurnaceCode ?? r.converterCode ?? '-'}</Td>
                <Td align="right">{io.input}</Td>
                <Td align="right" className="font-medium">
                  {io.output}
                </Td>
                <Td className="whitespace-normal">
                  <LotLinks lotNos={r.outputLotNos} />
                </Td>
                <Td className="text-xs">
                  {r.isSimulated ? (
                    <span className="flex flex-col">
                      <span>시드 {r.randomSeed ?? '-'}</span>
                      {r.processType === 'CONTINUOUS_CASTING' ? (
                        <span className="text-ink-3">
                          샘플 손실률 {fmtLossRate(r.sampleLossRate)} · 손실 {r.lossQty ?? 0}매 · 실제 감소율{' '}
                          {actualLossRateText((r.outputQty ?? 0) + (r.lossQty ?? 0), r.lossQty)}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-ink-3">-</span>
                  )}
                </Td>
                <Td>{r.operatorName ?? '-'}</Td>
                {action ? <Td align="right">{action(r)}</Td> : null}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
