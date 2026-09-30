// 과거 사례 검색 (준비 중 · EX). v1 B안 29번 화면의 디자인만 남기고, 내용은 고정 예시다.
// 기능 없음: API 호출·검색·상태 변경 없음. (REQ-CASE-001~005, REQ-AST-006)
import { Fragment } from 'react';
import { ComingSoonArea, SoonButton } from '@/components/ui';
import './PastCasePage.css';

// 사례 구분은 REQ-CASE-001의 품질/설비. 사례 번호 형식은 미정이라 예시 표기다.
const CASES: { date: string; no: string; lot: string; kind: '품질' | '설비'; title: string; active?: boolean }[] = [
  { date: '09-12 09:40', no: 'CASE-0005', lot: 'HT-2-260912-004', kind: '품질', title: 'SM355 히트 성분 불합격 · 합금철 투입량 편차', active: true },
  { date: '08-27 14:10', no: 'CASE-0004', lot: 'C2-260827-011-02', kind: '품질', title: 'SPHC 코일 표면 스케일 결함' },
  { date: '08-03 10:25', no: 'CASE-0003', lot: 'HT-2-260803-007', kind: '설비', title: '2번 전로 온도 측정 오차로 성분 불합격' },
  { date: '07-19 16:00', no: 'CASE-0002', lot: 'HT-1-260719-009-05', kind: '품질', title: 'SS275 슬래브 표면 균열' },
  { date: '06-30 11:30', no: 'CASE-0001', lot: 'HT-2-260630-012-03', kind: '설비', title: '열연 가열로 온도 편차로 코일 재질 불합격' },
];

const SAVED = ['성분 불합격', '표면 결함', '온도 편차', '슬래브 균열'];

const TIMELINE: { time: string; actor: string; cls: string; evt: string; head: string; detail: string; dot: string; hit?: boolean }[] = [
  { time: '09-12 09:40', actor: 'USER', cls: 'hl-actor hl-actor--user', evt: '검사 결과 등록', head: '히트 성분 검사 불합격', detail: 'HT-2-260912-004 · 탄소(C) 기준 초과', dot: 'hl-tl__dot hl-tl__dot--danger', hit: true },
  { time: '09-12 10:05', actor: 'USER', cls: 'hl-actor hl-actor--user', evt: '불합격 처리 상태 지정', head: '처리 상태 지정 · 보류', detail: '예약·배정·출고에서 제외됨', dot: 'hl-tl__dot hl-tl__dot--wait' },
  { time: '09-12 11:20', actor: 'USER', cls: 'hl-actor hl-actor--user', evt: '원인 기록', head: '원인: 합금철 투입량 편차', detail: '투입 기록과 검사 결과를 비교해 확인', dot: 'hl-tl__dot' },
  { time: '09-12 14:00', actor: 'USER', cls: 'hl-actor hl-actor--user', evt: '조치 기록', head: '조치: 다음 히트부터 투입량 재확인', detail: '생산 부서에 공유', dot: 'hl-tl__dot' },
  { time: '09-13 09:00', actor: 'AI', cls: 'hl-actor hl-actor--ai', evt: '과거 사례 등록', head: '사례 초안 작성 → 품질 담당 확인·저장', detail: 'CASE-0005', dot: 'hl-tl__dot hl-tl__dot--ok' },
];

const STEPS = ['불합격 판정', '처리 상태 지정', '원인 · 조치 기록', '사례 등록'];

export function PastCasePage() {
  return (
    <main className="hl-main">
      <ComingSoonArea grade="EX" title="과거 사례 검색">
        <div className="hl-row" style={{ gap: 8, flex: 'none' }}>
          <span className="hl-badge hl-badge--outline">예시 화면</span>
          <span className="hl-cap">아래 내용은 화면 구성을 보여 주는 예시예요. 실제 사례가 아니에요.</span>
        </div>
        <div className="pcase-split">
          <section className="hl-master" aria-label="검색 결과 목록">
            <div className="hl-master__head">
              <label className="hl-inputwrap">
                <i className="ic ic-search" />
                <input className="hl-input" type="search" defaultValue="불합격 원인" placeholder="검색어 입력 후 Enter" aria-label="검색어" style={{ fontWeight: 500 }} disabled tabIndex={-1} />
              </label>
              <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="hl-chip is-on" style={{ height: 24 }}>기간 90일 <i className="ic ic-chevron-down ic--sm" /></span>
                <span className="hl-chip" style={{ height: 24 }}>구분 전체 <i className="ic ic-chevron-down ic--sm" /></span>
                <span className="hl-chip" style={{ height: 24 }}>강종 전체 <i className="ic ic-chevron-down ic--sm" /></span>
              </div>
              <span className="hl-cap">사례 검색 결과 {CASES.length}건 · 최신순</span>
            </div>
            <div className="hl-master__list">
              {CASES.map((c) => (
                <div key={c.no} className={`hl-mitem${c.active ? ' is-active' : ''}`} style={{ padding: '9px 16px', gap: 3 }}>
                  <div className="hl-row">
                    <span className="tnum hl-cap">{c.date}</span>
                    <span className="mono" style={{ fontSize: 12 }}>{c.lot}</span>
                    <span className={`hl-badge${c.kind === '품질' ? ' hl-badge--run' : ' hl-badge--wait'}`} style={{ marginLeft: 'auto' }}>{c.kind}</span>
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: '17px' }}>{c.no} · {c.title}</div>
                </div>
              ))}
            </div>
            <div className="hl-col" style={{ gap: 8, padding: '12px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', flex: 'none' }}>
              <span className="hl-cap">저장한 검색</span>
              <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {SAVED.map((s) => <span key={s} className="hl-chip" style={{ height: 24 }}>{s}</span>)}
              </div>
              <button type="button" className="hl-btn hl-btn--sm" style={{ alignSelf: 'flex-start' }} disabled tabIndex={-1}>
                <i className="ic ic-history" />
                작업 로그 전체 보기
              </button>
            </div>
          </section>

          <div className="pcase-detail">
            <div className="hl-row" style={{ gap: 12, flex: 'none', alignItems: 'flex-end' }}>
              <div className="hl-col" style={{ gap: 2, minWidth: 0 }}>
                <div className="hl-crumb">
                  대시보드
                  <i className="ic ic-chevron-right ic--sm" />
                  과거 사례 검색
                  <i className="ic ic-chevron-right ic--sm" />
                  사례 상세
                </div>
                <div className="hl-row" style={{ gap: 10 }}>
                  <h1 className="hl-title">CASE-0005 · SM355 히트 성분 불합격</h1>
                  <span className="hl-badge hl-badge--danger">불합격 · 보류</span>
                </div>
                <span className="hl-cap">
                  LOT <span className="mono">HT-2-260912-004</span> · 09-12 09:40 → 09-13 09:00 (기록 1일)
                </span>
              </div>
              <div className="hl-page-head__actions">
                <button type="button" className="hl-btn" disabled tabIndex={-1}><i className="ic ic-trace" />LOT 추적</button>
                <button type="button" className="hl-btn hl-btn--primary" disabled tabIndex={-1}><i className="ic ic-history" />원본 이벤트</button>
              </div>
            </div>

            <section className="hl-ai-card" style={{ flex: 'none' }} aria-label="AI 요약">
              <div className="hl-card__head" style={{ height: 40 }}>
                <span className="hl-aimark hl-aimark--sm">AI</span>
                <h2>AI 요약 · 검색 결과 전체</h2>
                <span className="hl-card__meta">결과 {CASES.length}건 기준 · 예시</span>
                <div className="hl-card__actions">
                  <span className="hl-cap"><i className="ic ic-info ic--sm" /> AI 요약은 참고용 · 판단은 원본 이벤트로 확인</span>
                  <span className="hl-iconbtn hl-iconbtn--sm" style={{ color: 'var(--ai-strong)' }}><i className="ic ic-refresh ic--sm" /></span>
                </div>
              </div>
              <div className="hl-card__body" style={{ padding: '12px 16px', gap: 10 }}>
                <p style={{ fontSize: 13.5, lineHeight: '21px' }}>
                  “불합격 원인”과 비슷한 사례 {CASES.length}건을 찾았어요. 성분 불합격은 합금철 투입량 편차나 온도 측정 오차가 원인인 경우가 많았고, 투입량·측정값을 다시 확인하도록 조치해 재발을 막았어요. 표면 결함은 가열 조건과 함께 살펴본 사례가 있어요.
                </p>
                <div className="hl-sources" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '4px 16px' }}>
                  <span className="hl-sources__label" style={{ width: '100%' }}>근거 사례</span>
                  {CASES.slice(0, 4).map((c) => (
                    <span key={c.no} className="hl-source">
                      <i className="ic ic-link ic--sm" />
                      <span className="mono">{c.no}</span>
                    </span>
                  ))}
                </div>
              </div>
            </section>

            <div className="pcase-grid">
              <section className="hl-card" aria-label="사례 타임라인">
                <div className="hl-card__head">
                  <h2>사례 타임라인</h2>
                  <span className="hl-card__meta">HT-2-260912-004 · 기록 {TIMELINE.length}</span>
                </div>
                <div className="hl-card__body" style={{ padding: '14px 16px 4px', gap: 0, overflow: 'auto', flex: 1 }}>
                  <div className="hl-timeline">
                    {TIMELINE.map((x, i) => (
                      <div key={x.time} className="hl-tl" style={{ paddingBottom: i === TIMELINE.length - 1 ? 4 : 12 }}>
                        <span className={x.dot} />
                        <div className="hl-tl__body" style={x.hit ? { padding: '4px 6px', margin: '-4px 0 0 -4px', borderRadius: 6, background: 'var(--brand-tint)' } : undefined}>
                          <div className="hl-row" style={{ gap: 6 }}>
                            <time>{x.time}</time>
                            <span className={x.cls}>{x.actor}</span>
                            <span className="hl-evt">{x.evt}</span>
                            <b style={{ fontWeight: 600 }}>{x.head}</b>
                          </div>
                          <span className="hl-cap">{x.detail}{x.hit ? ' · 검색 일치' : ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="hl-card__foot" style={{ marginTop: 'auto', flexDirection: 'column', alignItems: 'stretch', gap: 8, padding: '12px 16px' }}>
                  <span className="hl-cap">대응 경로</span>
                  <div className="hl-steps">
                    {STEPS.map((s, i) => (
                      <Fragment key={s}>
                        {i ? <span className="hl-step__line is-done" /> : null}
                        <span className="hl-step is-done">
                          <span className="hl-step__dot"><i className="ic ic-check ic--sm" style={{ width: 10, height: 10 }} /></span>
                          {s}
                        </span>
                      </Fragment>
                    ))}
                  </div>
                </div>
              </section>

              <section className="hl-card" aria-label="사례 요약">
                <div className="hl-card__head"><h2>이 사례의 판단</h2></div>
                <div className="hl-card__body" style={{ gap: 12, overflow: 'auto' }}>
                  <dl className="hl-kv" style={{ rowGap: 10 }}>
                    <dt>구분</dt><dd>품질</dd>
                    <dt>강종·품목</dt><dd>SM355 · 히트</dd>
                    <dt>관련 LOT</dt><dd><span className="mono hl-link-id">HT-2-260912-004</span></dd>
                    <dt>관련 설비</dt><dd>2번 전로</dd>
                    <dt>발생일</dt><dd>09-12</dd>
                    <dt>처리 상태</dt><dd><span className="hl-badge hl-badge--wait">보류</span></dd>
                  </dl>
                  <div className="hl-col" style={{ gap: 6, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                    <span className="hl-label" style={{ fontWeight: 600 }}>현상 · 원인 · 조치</span>
                    <span style={{ fontSize: 12.5, lineHeight: '19px', color: 'var(--ink-2)' }}>
                      현상: 히트 성분 검사에서 탄소(C)가 기준을 넘어 불합격이에요. 원인: 합금철 투입량 편차. 조치: 다음 히트부터 투입량을 재확인해요.
                    </span>
                    <button type="button" className="hl-btn hl-btn--sm" style={{ alignSelf: 'flex-start' }} disabled tabIndex={-1}>
                      <i className="ic ic-history" />
                      HT-2-260912-004 작업 로그
                    </button>
                  </div>
                  <div className="hl-col" style={{ gap: 6, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                    <span className="hl-label" style={{ fontWeight: 600 }}>같은 종류의 다른 사례</span>
                    {[CASES[2], CASES[4]].map((c) => (
                      <span key={c.no} className="hl-source">
                        <i className="ic ic-link ic--sm" style={{ color: 'var(--ink-3)' }} />
                        <span className="mono">{c.lot}</span> {c.kind}
                        <em>{c.date.slice(0, 5)}</em>
                      </span>
                    ))}
                  </div>
                  <div style={{ paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                    <SoonButton grade="EX"><i className="ic ic-search" />비슷한 사례 찾기</SoonButton>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </ComingSoonArea>
    </main>
  );
}
