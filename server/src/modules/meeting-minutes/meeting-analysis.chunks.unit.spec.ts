// 긴 전사 조각 나누기·합치기 (DB 없음)
import type { MeetingCandidate } from '@fantasteel/shared';
import { CHUNK_MERGE, joinSummaries, mergeChunkResults, restrictToChunk, splitLongText, splitTranscript, type TranscriptLine } from './meeting-analysis.chunks';
import { DROP, LIST_MAX, validateAnalysis, type ValidatedAnalysis } from './meeting-analysis.validator';

const lines = (count: number, length: number): TranscriptLine[] => Array.from({ length: count }, (_, i) => ({ number: i + 1, text: `${'가'.repeat(length - 1)}.` }));

const candidate = (over: Partial<MeetingCandidate>): MeetingCandidate => ({
  key: 'c1',
  kind: 'TASK',
  title: '견적서 보내기',
  description: null,
  evidence: [0],
  sourceText: null,
  assigneeId: 7,
  assigneeName: '박서영',
  dueDate: '2026-10-20',
  startAt: null,
  endAt: null,
  endAssumed: false,
  attendeeIds: [],
  purchase: null,
  itemName: null,
  relatedSalesOrderNo: null,
  salesOrderId: null,
  issues: [],
  context: [],
  decision: 'PENDING',
  ...over,
});

const part = (over: Partial<ValidatedAnalysis>): ValidatedAnalysis => ({ summary: '', decisions: [], candidates: [], changes: [], ...over });

describe('splitTranscript', () => {
  it('짧은 전사는 나누지 않는다', () => {
    const chunks = splitTranscript(lines(10, 100));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ index: 1, total: 1, firstNumber: 1, lastNumber: 10 });
  });

  it('구간이 없는 전사도 빈 조각 하나로 한 번은 분석한다', () => {
    expect(splitTranscript([])).toEqual([{ index: 1, total: 1, lines: [], numbers: new Set(), firstNumber: 0, lastNumber: 0 }]);
  });

  it('긴 전사는 발언 경계에서 나누고 모든 발언을 한 번 이상 담으며 번호는 회의 전체 기준이다', () => {
    const all = lines(300, 200); // 약 6만 자
    const chunks = splitTranscript(all, { singlePassMax: 40_000, chunkChars: 20_000, overlapChars: 1_000 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      const size = chunk.lines.reduce((sum, l) => sum + String(l.number).length + 4 + l.text.length, 0);
      expect(size).toBeLessThanOrEqual(20_000);
      expect(chunk.total).toBe(chunks.length);
      // 원문 그대로 (조각 안에서 번호를 다시 세지 않는다)
      for (const line of chunk.lines) expect(line.text).toBe(all[line.number - 1].text);
    }
    const covered = new Set(chunks.flatMap((c) => [...c.numbers]));
    expect(covered.size).toBe(300);
    expect(chunks[0].firstNumber).toBe(1);
    expect(chunks.at(-1)?.lastNumber).toBe(300);
  });

  it('다음 조각은 앞 조각 끝 발언을 겹침 길이만큼 다시 담는다', () => {
    const chunks = splitTranscript(lines(300, 200), { singlePassMax: 40_000, chunkChars: 20_000, overlapChars: 1_000 });
    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1];
      const shared = [...chunks[i].numbers].filter((n) => prev.numbers.has(n));
      expect(shared.length).toBeGreaterThan(0);
      // 겹침은 앞 조각의 끝부분이다
      expect(Math.min(...shared)).toBeGreaterThan(prev.firstNumber);
      expect(Math.max(...shared)).toBe(prev.lastNumber);
      const sharedLength = chunks[i].lines.filter((l) => prev.numbers.has(l.number)).reduce((sum, l) => sum + String(l.number).length + 4 + l.text.length, 0);
      expect(sharedLength).toBeLessThanOrEqual(1_000);
    }
  });

  it('조각보다 긴 한 발언은 문장 경계에서 나눠 같은 번호로 둔다', () => {
    const sentence = `${'나'.repeat(99)}.`;
    const long: TranscriptLine = { number: 2, text: Array.from({ length: 500 }, () => sentence).join(' ') }; // 약 5만 자
    const chunks = splitTranscript([{ number: 1, text: '시작합니다.' }, long, { number: 3, text: '끝.' }], { singlePassMax: 40_000, chunkChars: 20_000, overlapChars: 1_000 });
    const pieces = chunks.flatMap((c) => c.lines).filter((l) => l.number === 2);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    for (const piece of pieces) {
      expect(piece.text.endsWith('.')).toBe(true);
      expect(long.text.includes(piece.text)).toBe(true);
    }
    expect(chunks.at(-1)?.lastNumber).toBe(3);
  });
});

describe('splitLongText', () => {
  it('문장 끝에서 나누고 문장 하나가 너무 길면 글자 수로 자른다', () => {
    expect(splitLongText('짧아요.', 100)).toEqual(['짧아요.']);
    expect(splitLongText('하나입니다. 둘입니다? 셋!', 12)).toEqual(['하나입니다. 둘입니다?', '셋!']);
    expect(splitLongText('가'.repeat(25), 10)).toEqual(['가'.repeat(10), '가'.repeat(10), '가'.repeat(5)]);
  });
});

describe('restrictToChunk', () => {
  it('조각에 없는 근거 번호를 지워 검증기가 그 항목을 버리게 한다', () => {
    const raw = {
      summary: '요약',
      decisions: [{ text: '결정', evidence: [5, 50] }],
      items: [
        { kind: 'TASK', title: '조각 안', evidence: [5], assigneeName: null, attendeeNames: [], dueDate: null },
        { kind: 'TASK', title: '조각 밖', evidence: [50], assigneeName: null, attendeeNames: [], dueDate: null },
      ],
    };
    const restricted = restrictToChunk(raw, new Set([4, 5, 6]));
    const segments = Array.from({ length: 60 }, (_, i) => `발언 ${i + 1}`);
    const validated = validateAnalysis(restricted, { meetingDate: '2026-10-15', segments, attendees: [], rawMaterials: [], salesOrders: new Map() });
    expect(validated?.decisions).toEqual([{ text: '결정', evidence: [4] }]);
    expect(validated?.candidates.map((c) => c.title)).toEqual(['조각 안']);
    expect(validated?.changes).toContainEqual({ action: 'DROPPED', title: '조각 밖', reason: DROP.evidence });
  });

  it('2차 검토 답은 missed만 거른다', () => {
    const raw = { missed: [{ evidence: [1, 9] }], concerns: [{ key: 'c1', reason: '날짜가 틀려요' }] };
    expect(restrictToChunk(raw, new Set([9]), ['missed'])).toEqual({ missed: [{ evidence: [9] }], concerns: raw.concerns });
    expect(restrictToChunk('모양이 다름', new Set([1]))).toBe('모양이 다름');
  });
});

describe('mergeChunkResults', () => {
  it('겹침 구간에서 두 조각이 같은 일을 뽑으면 앞 후보에 근거만 더한다', () => {
    const merged = mergeChunkResults([
      part({ summary: '앞부분', candidates: [candidate({ key: 'c1', title: '견적서 보내기', evidence: [10, 11] })] }),
      part({ summary: '뒷부분', candidates: [candidate({ key: 'c1', title: '견적서를 보내 주세요', evidence: [11, 40] }), candidate({ key: 'c2', title: '샘플 준비', evidence: [50], assigneeId: 8 })] }),
    ]);
    expect(merged.summaries).toEqual(['앞부분', '뒷부분']);
    expect(merged.candidates.map((c) => [c.key, c.title, c.evidence])).toEqual([
      ['c1', '견적서 보내기', [10, 11, 40]],
      ['c2', '샘플 준비', [50]],
    ]);
    expect(merged.changes).toEqual([{ action: 'DROPPED', title: '견적서를 보내 주세요', reason: CHUNK_MERGE.duplicate }]);
  });

  it('같은 발언에서 나온 다른 사람의 일·같은 조각의 후보는 합치지 않는다', () => {
    const merged = mergeChunkResults([
      part({ candidates: [candidate({ key: 'c1', title: '견적', evidence: [10], assigneeId: 7 }), candidate({ key: 'c2', title: '도면', evidence: [10], assigneeId: null })] }),
      part({ candidates: [candidate({ key: 'c1', title: '출하 확인', evidence: [10], assigneeId: 9 })] }),
    ]);
    // c2(담당자 없음)는 같은 조각의 c1과 합치지 않는다. 뒤 조각의 '출하 확인'은 담당자가 다른 c1을 건너뛰고 담당자 없는 c2와 같은 일로 본다
    expect(merged.candidates.map((c) => c.title)).toEqual(['견적', '도면']);
    const other = mergeChunkResults([
      part({ candidates: [candidate({ key: 'c1', title: '견적', evidence: [10], assigneeId: 7 })] }),
      part({ candidates: [candidate({ key: 'c1', title: '출하 확인', evidence: [10], assigneeId: 9 })] }),
    ]);
    expect(other.candidates.map((c) => c.title)).toEqual(['견적', '출하 확인']);
  });

  it('제목과 종류가 같으면 조각이 떨어져 있어도 하나로 본다. 종류가 다르면 다른 일이다', () => {
    const merged = mergeChunkResults([
      part({ candidates: [candidate({ title: '견적서 보내기', evidence: [3] })] }),
      part({ candidates: [candidate({ title: '견적서  보내기', evidence: [300] }), candidate({ kind: 'EVENT', title: '견적서 보내기', evidence: [301], assigneeId: null })] }),
    ]);
    expect(merged.candidates.map((c) => [c.kind, c.evidence])).toEqual([
      ['TASK', [3, 300]],
      ['EVENT', [301]],
    ]);
  });

  it('결정사항은 글이 같으면 하나로 합치고 근거를 모은다', () => {
    const merged = mergeChunkResults([part({ decisions: [{ text: '단가 동결', evidence: [2] }] }), part({ decisions: [{ text: '단가  동결', evidence: [1, 9] }, { text: '납기 연장', evidence: [12] }] })]);
    expect(merged.decisions).toEqual([
      { text: '단가 동결', evidence: [1, 2, 9] },
      { text: '납기 연장', evidence: [12] },
    ]);
  });

  it(`합친 후보는 ${LIST_MAX}개까지이고 넘친 것은 실행 기록에 남긴다`, () => {
    const many = (prefix: string, from: number) => Array.from({ length: 20 }, (_, i) => candidate({ key: `c${i + 1}`, title: `${prefix}${i}`, evidence: [from + i], assigneeId: i }));
    const merged = mergeChunkResults([part({ candidates: many('앞', 0) }), part({ candidates: many('뒤', 100) })]);
    expect(merged.candidates).toHaveLength(LIST_MAX);
    expect(merged.candidates.at(-1)?.key).toBe(`c${LIST_MAX}`);
    expect(merged.changes.filter((c) => c.reason === CHUNK_MERGE.overLimit(10))).toHaveLength(10);
  });
});

describe('joinSummaries', () => {
  it('조각 요약을 줄바꿈으로 잇고 상한에서 자른다', () => {
    expect(joinSummaries(['하나', '둘'], 100)).toBe('하나\n둘');
    expect(joinSummaries(['가'.repeat(80), '나'.repeat(80)], 100)).toHaveLength(100);
  });
});
