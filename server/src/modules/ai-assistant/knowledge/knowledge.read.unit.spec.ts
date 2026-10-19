import { parseAssistantAnswer } from '../assistant.answer';
import { buildAssistantMessages, knowledgeCatalog } from '../assistant.prompt';
import { knowledgeTool } from '../tools/knowledge.tool';
import { GLOSSARY_TERMS } from './glossary.generated';
import { KNOWLEDGE_TEXT_MAX, lookupKnowledge } from './knowledge.read';
import { KnowledgeReads } from './knowledge.reads';
import { MANUAL_GUIDES } from './manual.generated';
import { PROCESS_STEPS } from './process.generated';

const tool = knowledgeTool();
const user = {} as never;
const read = (args: Record<string, unknown>) => tool.run(args, user);

describe('지식 목록 (프롬프트)', () => {
  const catalog = knowledgeCatalog();

  it('매뉴얼·업무는 ID와 이름을 모두 싣는다', () => {
    for (const guide of MANUAL_GUIDES) expect(catalog).toContain(`${guide.id} ${guide.name}`);
    for (const step of PROCESS_STEPS) expect(catalog).toContain(`${step.id} ${step.name}`);
  });

  it('용어는 나열하지 않고 이름·TRM ID로 읽는다고만 알린다', () => {
    expect(catalog).toContain('용어(kind: glossary)');
    expect(catalog).toContain('TRM ID');
    expect(catalog).not.toContain(GLOSSARY_TERMS[0].id);
    expect(catalog.split('\n')).toHaveLength(4);
  });

  it('시스템 프롬프트에 들어간다', () => {
    const [system] = buildAssistantMessages({ employeeName: '김', roleLabel: '영업', today: '2026-10-18', screen: null, references: [], history: [], question: '안녕' });
    expect(system.content).toContain(catalog);
    expect(system.content).toContain('read_knowledge');
  });
});

describe('read_knowledge', () => {
  it('매뉴얼을 ID로 읽는다', async () => {
    const guide = MANUAL_GUIDES[0];
    const out = await read({ kind: 'manual', id: guide.id });
    expect(out.hideSource).toBe(true);
    expect(out.data).toMatchObject({ 종류: 'manual', id: guide.id, 이름: guide.name });
    expect(JSON.stringify(out.data)).toContain('화면 절차');
  });

  it('업무 프로세스를 ID로 읽는다', async () => {
    const step = PROCESS_STEPS[0];
    expect((await read({ kind: 'process', id: step.id })).data).toMatchObject({ id: step.id, 이름: step.name });
  });

  it('용어를 이름이나 TRM ID로 읽는다', async () => {
    const term = GLOSSARY_TERMS[0];
    expect((await read({ kind: 'glossary', id: term.name })).data).toMatchObject({ id: term.id });
    expect((await read({ kind: 'glossary', id: term.id.toLowerCase() })).data).toMatchObject({ id: term.id, 이름: term.name });
  });

  it('없는 항목은 가능한 값이나 비슷한 용어를 알려 준다', async () => {
    await expect(read({ kind: 'manual', id: 'MAN-XX-99' })).rejects.toThrow(`없는 매뉴얼이에요: MAN-XX-99. 가능한 값: ${MANUAL_GUIDES[0].id}`);
    await expect(read({ kind: 'process', id: 'BP-XX-99' })).rejects.toThrow(`가능한 값: ${PROCESS_STEPS[0].id}`);
    await expect(read({ kind: 'glossary', id: '없는용어xyz' })).rejects.toThrow('없는 용어예요');
    await expect(read({ kind: 'glossary', id: '예약 수량' })).rejects.toThrow(/비슷한 용어: TRM-/);
  });

  it('kind·id가 틀리면 이유를 알린다', async () => {
    await expect(read({ kind: 'x', id: 'a' })).rejects.toThrow('kind는 manual, process, glossary 중 하나예요');
    await expect(read({ kind: 'manual' })).rejects.toThrow('id가 필요해요');
  });

  it('본문은 4000자까지만 읽고 잘렸다고 알린다', () => {
    const long = { id: 'MAN-ZZ-01', processId: 'BP-ZZ-01', name: '긴 매뉴얼', text: '가'.repeat(KNOWLEDGE_TEXT_MAX * 2) };
    const found = lookupKnowledge('manual', 'MAN-ZZ-01', { guides: [long], steps: [], terms: [] });
    expect(found.found && found.text.length).toBeLessThan(KNOWLEDGE_TEXT_MAX + 50);
    expect(found.found && found.text).toContain('길어서 여기까지만 읽었어요');
  });
});

describe('읽은 항목의 출처 인정 (parseAssistantAnswer)', () => {
  const guide = MANUAL_GUIDES[0];
  const step = PROCESS_STEPS[0];
  const term = GLOSSARY_TERMS[0];
  const raw = `절차예요 [${guide.id}] 순서예요 [${step.id}] 뜻이에요 [${term.id}]`;

  it('읽지 않았으면 참고 자료에 없는 ID는 출처가 아니다', () => {
    expect(parseAssistantAnswer(raw, []).sources).toEqual([]);
  });

  it('읽었으면 그 ID를 출처로 인정하고, 읽지 않은 ID는 여전히 인정하지 않는다', () => {
    const reads = new KnowledgeReads();
    reads.add(JSON.stringify({ kind: 'manual', id: guide.id }));
    reads.add(JSON.stringify({ kind: 'process', id: step.id }));
    reads.add(JSON.stringify({ kind: 'glossary', id: term.name }));
    reads.add(JSON.stringify({ kind: 'glossary', id: term.name }));
    reads.add('깨진 JSON');
    reads.add(JSON.stringify({ kind: 'manual', id: 'MAN-XX-99' }));
    expect(reads.terms).toHaveLength(1);
    const parsed = parseAssistantAnswer(`${raw} [${MANUAL_GUIDES[1].id}]`, reads.terms, reads.steps, reads.guides);
    expect(parsed.sources).toEqual([
      { kind: 'MANUAL', id: guide.id, label: guide.name },
      { kind: 'PROCESS', id: step.id, label: step.name },
      { kind: 'GLOSSARY', id: term.id, label: term.name },
    ]);
    expect(parsed.answer).not.toContain('[');
  });
});
