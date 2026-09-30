// AI Factory Agent (준비 중 · P2). v1 B안 34번 화면의 디자인만 남기고, 내용은 고정 예시다.
// 기능 없음: API 호출·상태 변경 없음. (REQ-AGT-001~006)
import { Fragment } from 'react';
import { ComingSoonArea, SoonButton } from '@/components/ui';
import './AgentPage.css';

type Sev = { label: string; short: string; cls: string };
const SEV_HIGH: Sev = { label: '심각도 높음', short: '높음', cls: 'hl-badge hl-badge--danger' };
const SEV_WARN: Sev = { label: '주의', short: '주의', cls: 'hl-badge hl-badge--wait' };
const SEV_INFO: Sev = { label: '참고', short: '참고', cls: 'hl-badge hl-badge--outline' };

// REQ-AGT-001·004의 위험 유형 5가지
const ALERTS: { num: string; type: string; cat: string; sev: Sev; title: string; cands: number; hint: string; active?: boolean }[] = [
  { num: '①', type: '원료 부족', cat: '원료', sev: SEV_HIGH, title: '철광석 1,200 t 부족 예상', cands: 1, hint: '승인 대기 1 · 구매요청 초안', active: true },
  { num: '②', type: '합격 매수 부족', cat: '합격', sev: SEV_HIGH, title: 'SO-20260930-0001 합격 슬래브 12매 부족', cands: 1, hint: '승인 대기 1 · 재생산 계획 초안' },
  { num: '③', type: '납기 위험', cat: '납기', sev: SEV_HIGH, title: 'SO-20260930-0002 납기 3일 이내 · 출하 매수 부족', cands: 0, hint: '담당자 알림' },
  { num: '④', type: '여재 장기 보유', cat: '여재', sev: SEV_INFO, title: 'SM355 합격 슬래브 8매 미배정', cands: 1, hint: '승인 대기 1 · 대기 수주 배정 추천' },
  { num: '⑤', type: '불합격률 상승', cat: '품질', sev: SEV_WARN, title: 'SPHC 불합격률 기준 초과', cands: 0, hint: '품질 부서 알림' },
];

const RULES: [string, string][] = [
  ['원료 부족', '생산계획 소요량 > 원료 잔량 + 입고예정 (스케줄)'],
  ['합격 매수 부족', '검사 결과 등록 시 합격 매수 < 수주 매수 (이벤트)'],
  ['납기 위험', '납기까지 기준일(초기 3일) 이하 · 출하 매수 < 수주 매수 (스케줄)'],
  ['여재 장기 보유', '예약·배정 없는 합격 슬래브를 오래 보유 (스케줄)'],
  ['불합격률 상승', '강종별 불합격률이 기준 초과 (스케줄)'],
];

const METRICS: [string, string, boolean][] = [
  ['소요량', '3,400 t', false],
  ['원료 잔량', '1,600 t', false],
  ['입고예정', '600 t', false],
  ['부족량', '1,200 t', true],
];

const DRAFT_FLOW = ['AI_GENERATED', 'WAITING_APPROVAL', 'APPROVED', 'EXECUTED'];

const TIMELINE: { time: string; actor: string; actorCls: string; evt: string; head: string; detail: string; dot: string }[] = [
  { time: '09-30 10:00', actor: 'SYSTEM', actorCls: 'hl-actor hl-actor--system', evt: 'Agent 위험 감지', head: '① 원료 부족 감지', detail: '철광석 부족량 1,200 t', dot: 'hl-tl__dot hl-tl__dot--danger' },
  { time: '09-30 10:00', actor: 'SYSTEM', actorCls: 'hl-actor hl-actor--system', evt: 'Action Draft 생성', head: '구매요청 초안 생성 (AI_GENERATED)', detail: '같은 대상의 미처리 초안이 없어 새로 만들었어요', dot: 'hl-tl__dot hl-tl__dot--ai' },
  { time: '09-30 10:01', actor: 'AI', actorCls: 'hl-actor hl-actor--ai', evt: '상황 설명', head: 'AI 어시스턴트가 상황 설명 작성', detail: '데이터 변경 없음', dot: 'hl-tl__dot' },
];

export function AgentPage() {
  return (
    <main className="hl-main">
      <ComingSoonArea grade="P2" title="AI Factory Agent">
        <div className="hl-row" style={{ gap: 8, flex: 'none' }}>
          <span className="hl-badge hl-badge--outline">예시 화면</span>
          <span className="hl-cap">아래 내용은 화면 구성을 보여 주는 예시예요. 실제 데이터가 아니에요.</span>
        </div>
        <div className="agent-split">
          <section className="hl-master" aria-label="감지 목록">
            <div className="hl-master__head">
              <div className="hl-row">
                <span className="hl-aimark hl-aimark--sm">AI</span>
                <b style={{ fontSize: 14 }}>감지 5건</b>
                <span className="hl-cap tnum">예시</span>
                <span className="hl-iconbtn hl-iconbtn--sm" style={{ marginLeft: 'auto' }}><i className="ic ic-filter" /></span>
              </div>
              <div className="agent-chips">
                <span className="hl-chip is-on">전체 <b>5</b></span>
                {ALERTS.map((a) => <span key={a.type} className="hl-chip">{a.cat} <b>1</b></span>)}
              </div>
            </div>
            <div className="hl-master__list">
              {ALERTS.map((c) => (
                <div key={c.type} className={`hl-mitem${c.active ? ' is-active' : ''}`}>
                  <div className="hl-row">
                    <span className={c.sev.cls}>{c.sev.short}</span>
                    <b style={{ fontSize: 13 }}>{c.num} {c.type}</b>
                    <span className="hl-cap" style={{ marginLeft: 'auto' }}>{c.cat}</span>
                  </div>
                  <span style={{ fontSize: 12.5, color: '#3F4A57' }}>{c.title}</span>
                  <div className="hl-row" style={{ gap: 6, minWidth: 0 }}>
                    {c.cands ? <span className="hl-ai-pick">후보 {c.cands}</span> : <span className="hl-tag">후보 없음</span>}
                    <span className="hl-cap" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.hint}</span>
                  </div>
                </div>
              ))}
              <div className="hl-daysep" style={{ padding: '10px 16px 6px' }}>최근 24시간 해소</div>
              <div className="hl-mitem" style={{ opacity: 0.7 }}>
                <div className="hl-row">
                  <span className="hl-badge hl-badge--ok">해소</span>
                  <b style={{ fontSize: 13 }}>① 원료 부족</b>
                  <span className="hl-cap" style={{ marginLeft: 'auto' }}>원료</span>
                </div>
                <span style={{ fontSize: 12.5, color: '#3F4A57' }}>석회석 부족 예상 → 구매요청 실행됨</span>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="hl-cap">감지 종류 · 스케줄 감지와 이벤트 감지</span>
                <dl className="hl-kv" style={{ fontSize: 12, rowGap: 6 }}>
                  {RULES.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
                </dl>
                <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  <button type="button" className="hl-btn hl-btn--sm" disabled tabIndex={-1}><i className="ic ic-filter" />감지 기준 설정</button>
                  <SoonButton className="hl-btn hl-btn--ai-outline hl-btn--sm"><i className="ic ic-radar" />지금 감지 실행</SoonButton>
                </div>
              </div>
            </div>
          </section>

          <div className="agent-detail">
            <div className="hl-page-head">
              <div>
                <div className="hl-crumb">
                  대시보드
                  <i className="ic ic-chevron-right ic--sm" />
                  AI Factory Agent
                  <i className="ic ic-chevron-right ic--sm" />
                  ① 원료 부족
                </div>
                <h1 className="hl-title hl-row" style={{ gap: 8 }}>
                  <span className="hl-aimark">AI</span>
                  ① 원료 부족 · 철광석 (RM-IO)
                  <span className={SEV_HIGH.cls}>{SEV_HIGH.label}</span>
                </h1>
              </div>
              <div className="hl-page-head__actions">
                <button type="button" className="hl-btn" disabled tabIndex={-1}><i className="ic ic-history" />작업 로그</button>
                <SoonButton grade="EX"><i className="ic ic-search" />사례 검색</SoonButton>
              </div>
            </div>

            <div className="hl-ai-brief" style={{ padding: '8px 14px' }}>
              <span className="hl-aimark hl-aimark--sm">AI</span>
              <p style={{ fontSize: 13 }}><b>AI는 상황을 설명하고 후보를 제안할 뿐, 실행은 부서장 개별 승인 후에만 돼요</b></p>
              <span className="hl-ai-brief__meta" style={{ marginLeft: 'auto' }}>감지 09-30 10:00 · 예시</span>
            </div>

            <section className="hl-ai-card" style={{ flex: 'none' }}>
              <header className="hl-card__head">
                <span className="hl-aimark hl-aimark--sm">AI</span>
                <h2>상황 설명</h2>
                <span className="hl-card__meta">AI가 작성 · 데이터 변경 없음</span>
              </header>
              <div className="hl-card__body" style={{ gap: 12 }}>
                <p style={{ margin: 0, fontSize: 14, lineHeight: '21px' }}>
                  <b>철광석 1,200 t 부족 예상</b> — 생산계획 <span className="mono">PP-20260930-0001</span>의 소요량이 원료 잔량과 입고예정을 합친 양보다 많아요.
                </p>
                <div className="hl-statbar" style={{ boxShadow: 'none' }}>
                  {METRICS.map(([k, v, danger]) => {
                    const m = v.match(/^([\d.,]+)\s*(.*)$/);
                    return (
                      <div key={k} className="hl-kpi" style={{ padding: '10px 14px' }}>
                        <span className="hl-kpi__label">{k}</span>
                        <span className={`hl-kpi__value${danger ? ' hl-danger-text' : ''}`} style={{ fontSize: 20, lineHeight: '26px' }}>{m ? <>{m[1]}<small> {m[2]}</small></> : v}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="hl-sources" style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, alignItems: 'center' }}>
                  <span className="hl-sources__label">근거</span>
                  <span className="hl-cap">MRP 결과 기준 (소요량 − 잔량 − 입고예정)</span>
                  <span className="hl-source"><i className="ic ic-calc ic--sm" />MRP 결과<em>09-30 10:00</em></span>
                  <span className="hl-source"><i className="ic ic-box ic--sm" />원료 재고<em>RM-IO</em></span>
                </div>
              </div>
            </section>

            <section className="hl-draft" style={{ flex: 'none' }}>
              <div className="hl-draft__head">
                <span className="hl-aimark hl-aimark--sm">AI</span>
                <b>대응 후보 1 · 구매요청 초안</b>
                <span className="hl-code-badge hl-code-badge--ai">AI_GENERATED</span>
              </div>
              <div className="hl-draft__body" style={{ gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
                  <dl className="hl-kv" style={{ fontSize: 13, rowGap: 7 }}>
                    <dt>원료</dt><dd>철광석 <span className="mono hl-muted">RM-IO</span></dd>
                    <dt>수량</dt><dd>1,200 t</dd>
                    <dt>희망 입고</dt><dd>10-07</dd>
                    <dt>승인권자</dt><dd>구매부 부서장</dd>
                  </dl>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="hl-origin">
                      <i className="ic ic-radar ic--sm" />
                      <span>Agent 감지 09-30 10:00 · ① 원료 부족 · 부족량 1,200 t 기준</span>
                    </div>
                    <div className="hl-banner hl-banner--wait" style={{ padding: '8px 12px', fontSize: 12, lineHeight: '17px' }}>
                      <i className="ic ic-info ic--sm" />
                      <span>같은 대상의 미처리 초안이 있으면 새로 만들지 않아요.</span>
                    </div>
                  </div>
                </div>
                <div className="hl-row" style={{ gap: 10, padding: '10px 12px', background: '#F7F8FA', borderRadius: 4 }}>
                  <span className="hl-cap">승인 후 흐름</span>
                  <div className="hl-steps" style={{ flex: 1 }}>
                    <span className="hl-step is-run"><span className="hl-step__dot" />부서장 개별 승인</span>
                    <span className="hl-step__line" />
                    <span className="hl-step"><span className="hl-step__dot" />구매요청 생성 (SYSTEM)</span>
                    <span className="hl-step__line" />
                    <span className="hl-step"><span className="hl-step__dot" />작업 로그 기록 (승인 · 실행)</span>
                  </div>
                </div>
                <div className="hl-row" style={{ gap: 10 }}>
                  <span className="hl-cap">진행 단계</span>
                  <span className="hl-draftflow">
                    {DRAFT_FLOW.map((s, i) => (
                      <Fragment key={s}>
                        {i ? <i /> : null}
                        <span className={i === 0 ? 'is-ai is-current' : undefined}>{s}</span>
                      </Fragment>
                    ))}
                  </span>
                </div>
              </div>
              <div className="hl-draft__actions" style={{ alignItems: 'center', marginTop: 'auto' }}>
                <SoonButton className="hl-btn hl-btn--primary hl-btn--sm"><i className="ic ic-check" />승인</SoonButton>
                <SoonButton className="hl-btn hl-btn--sm">반려</SoonButton>
                <button type="button" className="hl-btn hl-btn--sm" disabled tabIndex={-1}><i className="ic ic-cart" />구매요청 보기</button>
                <span className="hl-lockhint" style={{ marginLeft: 'auto' }}>
                  <i className="ic ic-lock ic--sm" />
                  AI는 데이터를 바꾸지 않아요 · 부서장 승인 후 SYSTEM이 반영
                </span>
              </div>
            </section>

            <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px dashed #C3CBD4', borderRadius: 6, background: '#F7F8FA' }}>
              <div className="hl-row" style={{ gap: 6 }}>
                <i className="ic ic-info ic--sm hl-muted" />
                <b style={{ fontSize: 13 }}>대응 후보가 없는 유형은 이렇게 보여요 (예: ⑤ 불합격률 상승)</b>
              </div>
              <span className="hl-ink2" style={{ fontSize: 12, lineHeight: '17px' }}>상황 설명만 제공하고 품질 부서에 알림을 보내요. 원인 분석과 조치는 품질 담당이 판단해요.</span>
            </div>

            <section className="hl-card" style={{ flex: 'none' }} aria-label="감지 이력">
              <div className="hl-card__head">
                <i className="ic ic-history" style={{ color: 'var(--brand)' }} />
                <h2>감지 이력</h2>
                <span className="hl-card__meta">이 감지를 참조한 작업 로그 {TIMELINE.length}건</span>
              </div>
              <div className="hl-card__body" style={{ padding: '12px 16px 4px', gap: 0 }}>
                <div className="hl-timeline">
                  {TIMELINE.map((e, i) => (
                    <div key={e.head} className="hl-tl" style={{ paddingBottom: i === TIMELINE.length - 1 ? 4 : 10 }}>
                      <span className={e.dot} />
                      <div className="hl-tl__body">
                        <div className="hl-row" style={{ gap: 6 }}>
                          <time>{e.time}</time>
                          <span className={e.actorCls}>{e.actor}</span>
                          <span className="hl-evt">{e.evt}</span>
                          <b style={{ fontWeight: 600 }}>{e.head}</b>
                        </div>
                        <span className="hl-cap">{e.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </ComingSoonArea>
    </main>
  );
}
