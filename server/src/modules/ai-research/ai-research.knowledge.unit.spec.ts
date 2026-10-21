// 심층 조사의 사내 지식 출처 (이슈 #484, DB·LLM 없음)
import { KS_SECTIONS } from '../ai-assistant/knowledge/ks.generated';
import { renderKnowledge, sourceCatalog, withInternalEvidence } from './ai-research.evidence';
import { findCompanyKnowledge, knowledgeSourcesFrom, knowledgeUrl, searchKs } from './ai-research.knowledge';
import { AUDIT_SYSTEM_PROMPT, buildPlanMessages, KNOWLEDGE_PLAN_RULE, REPORT_SYSTEM_PROMPT } from './ai-research.prompt';
import { finalizeReport } from './ai-research.report';
import { checkResearchQuery, decideAction, isInternalSource, readPlan, readTurn, storedSources, type StoredSource } from './ai-research.rules';

const plan = { title: '강종 비교', steps: [{ title: '시장', query: '구조용 강재 수요 전망' }] };
const knowledgeSource = (id: number, sectionId = 'KS-8'): StoredSource => knowledgeSourcesFrom([{ kind: 'ks', id: sectionId, name: '강종별 기준값', text: 'SS275 인장강도 410–550' }], [], id)[0];
const web: StoredSource = { id: 3, title: '웹 글', url: 'https://example.com/ss275', snippet: 'SS275 인장강도 400–510' };

describe('KS 규격 생성 파일', () => {
  it('07 문서의 절을 마크다운 표 그대로 담고, 그림·aside 태그는 뗀다', () => {
    const grades = KS_SECTIONS.find((s) => s.id === 'KS-8');
    expect(grades?.title).toContain('강종별 기준값');
    expect(grades?.text).toContain('| 인장강도 | 270 이상 | 410–550 | 490–630 |');
    expect(KS_SECTIONS.map((s) => s.text).join('\n')).not.toMatch(/```|<aside>|flowchart/);
  });
});

describe('searchKs', () => {
  it('강종 기호로 기준값 절을 먼저 고르고 작업 메모 절은 고르지 않는다', () => {
    const ids = searchKs('SS275와 SM355A 차이가 뭐야?').map((s) => s.id);
    expect(ids[0]).toBe('KS-8');
    expect(ids).toContain('KS-8-1');
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain('KS-9');
  });

  it('KS 번호·낱말로도 찾고, 상관없는 질문이면 비운다', () => {
    expect(searchKs('KS D 3500 두께 허용차 알려 줘').map((s) => s.id)[0]).toBe('KS-7-1');
    expect(searchKs('sm355a 인장강도').map((s) => s.id)[0]).toBe('KS-8');
    expect(searchKs('전기로 탄소 배출 전망')).toEqual([]);
  });
});

describe('사내 지식 출처', () => {
  it('KS·용어 사전·매뉴얼·업무 프로세스를 찾아 사내 지식 출처로 만들고, 이미 있는 것은 다시 넣지 않는다', () => {
    const hits = findCompanyKnowledge('SS275 강종 예약 매수가 뭐고 수주 등록은 어떻게 해?');
    const kinds = new Set(hits.map((h) => h.kind));
    expect([...kinds].sort()).toEqual(['glossary', 'ks', 'manual', 'process']);
    const sources = knowledgeSourcesFrom(hits, [{ id: 1, title: '먼저 본 것', url: 'https://example.com', snippet: '' }], 2);
    expect(sources[0]).toMatchObject({ id: 2, url: knowledgeUrl(hits[0].kind, hits[0].id), knowledge: { kind: hits[0].kind, id: hits[0].id } });
    expect(sources[0].title).toMatch(/^사내 지식 · KS 규격 /);
    expect(sources.every((s) => s.readText && s.readText.length <= 6_001)).toBe(true);
    expect(knowledgeSourcesFrom(hits, sources, 99)).toEqual([]);
  });

  it('저장한 출처를 다시 읽어도 사내 지식 표시가 남고, 모르는 종류는 버린다', () => {
    const stored = storedSources([knowledgeSource(1), { ...knowledgeSource(2), knowledge: { kind: 'secret', id: 'x' } }]);
    expect(stored[0].knowledge).toEqual({ kind: 'ks', id: 'KS-8' });
    expect(stored[1].knowledge).toBeUndefined();
    expect(isInternalSource(stored[0])).toBe(true);
  });
});

describe('근거·프롬프트', () => {
  it('사내 지식 근거를 ERP·웹 기록보다 앞에 두고 웹보다 먼저 쓰라고 밝힌다', () => {
    const sources = [knowledgeSource(1), web];
    const blocks = withInternalEvidence(sources, 20_000, () => ['웹 기록']);
    expect(blocks[0]).toContain('### 사내 지식 [1]');
    expect(blocks[0]).toContain('웹 자료보다 먼저');
    expect(blocks.at(-1)).toBe('웹 기록');
    expect(renderKnowledge(sources[0])).toContain('SS275 인장강도 410–550');
    expect(sourceCatalog(sources, 5_000, 'turn')).toContain('[1] 사내 지식 · KS 규격 8. 강종별 기준값 — 사내 지식 (읽음)');
  });

  it('계획에 [사내 지식]과 부탁을 붙이고, 점검·보고서는 사내 기준과 다른 숫자를 밝히게 한다', () => {
    const user = buildPlanMessages('SS275와 SM355A 차이', '2026-10-21', null, [knowledgeSource(1)])[1].content;
    expect(user).toContain('[사내 지식]');
    expect(user).toContain(KNOWLEDGE_PLAN_RULE);
    expect(AUDIT_SYSTEM_PROMPT).toContain('사내 기준과 다름');
    expect(REPORT_SYSTEM_PROMPT).toContain('사내 기준과 다름');
    expect(REPORT_SYSTEM_PROMPT).toContain("'사내 지식' 출처");
  });
});

describe('행동·보고서에서 사내 지식', () => {
  const ctx = { plan, searchedQueries: [] as string[], maxSources: 20 };

  it('사내 지식 출처는 읽지 않고, 웹 출처 수·출처 없이 끝내기에 세지 않는다', () => {
    const sources = [knowledgeSource(1)];
    expect(decideAction(readTurn({ action: 'read', sourceId: 1 }), { ...ctx, sources })).toMatchObject({ kind: 'search', fallback: true });
    expect(decideAction(readTurn({ action: 'finish' }), { ...ctx, sources })).toMatchObject({ kind: 'search', fallback: true });
    expect(decideAction(readTurn({ action: 'finish' }), { ...ctx, sources: [...sources, web] })).toEqual({ kind: 'finish', fallback: false });
  });

  it('보고서에서 사내 지식 [n]을 인용할 수 있고 출처 목록에는 링크 없이 붙는다', () => {
    const { report, citedIds } = finalizeReport('# 비교\nSS275 인장강도는 410–550 N/mm²다 [1]. (사내 기준과 다름: 웹 [3]은 400–510) [3]', [knowledgeSource(1), web], false);
    expect(citedIds).toEqual([1, 3]);
    expect(report).toContain('- [1] 사내 지식 · KS 규격 8. 강종별 기준값');
    expect(report).not.toContain('](knowledge:');
    expect(report).toContain('- [3] [웹 글](https://example.com/ss275)');
  });
});

describe('자리 표시 검색어', () => {
  it("글자·숫자가 없는 검색어('...')는 막고, 계획이 그것뿐이면 질문으로 대신한다", () => {
    expect(checkResearchQuery('...')).toMatchObject({ ok: false, reason: '검색어에 글자가 없어요' });
    expect(checkResearchQuery('… —')).toMatchObject({ ok: false });
    expect(checkResearchQuery('SS275 용접성')).toEqual({ ok: true, query: 'SS275 용접성' });
    expect(readPlan({ title: '...', steps: [{ title: '...', query: '...' }] }, 'SS275와 SM355A 차이')).toBeNull();
  });
});
