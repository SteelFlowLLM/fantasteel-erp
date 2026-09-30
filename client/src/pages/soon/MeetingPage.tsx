// Voice2ERP 회의록 (준비 중 · P2). v1 B안 36(목록)·37(새 회의)·38(정리 결과) 화면의 디자인을 탭 3개로 보여 준다.
// 기능 없음: 탭 전환만 로컬 상태. API 호출·저장·녹음·업로드 없음. (REQ-VOC-001·002)
import { useState, type CSSProperties } from 'react';
import { ComingSoonArea, SoonButton } from '@/components/ui';
import './MeetingPage.css';

type TabKey = 'list' | 'new' | 'result';
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'list', label: '목록', icon: 'ic-note' },
  { key: 'new', label: '새 회의', icon: 'ic-mic' },
  { key: 'result', label: '정리 결과', icon: 'ic-check' },
];

// ── 고정 예시 내용 ─────────────────────────────────────────────
const ATTENDEES: { name: string; initial: string; tone: string }[] = [
  { name: '김영업', initial: '김', tone: ' hl-avatar--s' },
  { name: '서구매', initial: '서', tone: '' },
  { name: '박생산', initial: '박', tone: '' },
  { name: '정품질', initial: '정', tone: ' hl-avatar--q' },
  { name: '윤물류', initial: '윤', tone: '' },
];
const avatarOf = (name: string) => ATTENDEES.find((a) => a.name === name);

const SUMMARY = [
  '열연 라인 정기 점검으로 10-02 생산 일정이 하루 밀려요.',
  'SO-20260930-0001 납기는 유지하고, 히트 HT-2-260929-015를 먼저 편성해요.',
  '철광석 재고가 부족해 추가 구매가 필요해요.',
];
const DECISIONS = [
  'SO-20260930-0001 납기 유지 · 히트 HT-2-260929-015 우선 편성',
  '철광석 1,200 t 구매요청 초안을 만든다',
  '다음 회의는 10-07 10:00에 한다',
];
const TASKS: { who: string; text: string; due: string; src: string }[] = [
  { who: '박생산', text: '10-02 열연 일정 재편성', due: '10-01', src: '02:10' },
  { who: '정품질', text: 'HT-2-260929-015 성분 검사 결과 공유', due: '10-01', src: '17:45' },
  { who: '김영업', text: '고객사 한빛중공업에 납기 안내', due: '10-02', src: '31:20' },
];
const TRANSCRIPT: { t: string; speaker: string; text: string }[] = [
  { t: '00:12', speaker: '박생산', text: '이번 주 열연 라인 정기 점검이 10-02에 잡혀 있어서 생산 일정이 하루 밀려요.' },
  { t: '02:10', speaker: '박생산', text: '점검 때문에 코일 C2-260929-015-03 출하가 늦어질 수 있어요.' },
  { t: '05:40', speaker: '김영업', text: 'SO-20260930-0001은 고객사에서 납기를 꼭 지켜 달라고 했어요.' },
  { t: '09:03', speaker: '서구매', text: '철광석 재고를 보니 다음 생산계획 소요량이 부족해요. 1,200 t 정도 더 필요해요.' },
  { t: '17:45', speaker: '정품질', text: 'HT-2-260929-015 성분 검사는 합격이에요. 결과는 내일까지 공유할게요.' },
  { t: '25:30', speaker: '윤물류', text: '출하 일정이 확정되면 바로 알려 주세요. 슬래브 HT-2-260929-015-03도 같이 나가요.' },
  { t: '31:20', speaker: '김영업', text: '한빛중공업에는 제가 납기 안내를 드릴게요.' },
  { t: '38:02', speaker: '서구매', text: '다음 회의는 10-07 10시에 하죠.' },
];

const MEETINGS: { day: string; items: { title: string; meta: string; state: 'draft' | 'done' | 'proc'; sub: string; active?: boolean }[] }[] = [
  { day: '오늘 · 09-30 (수)', items: [{ title: '주간 생산회의', meta: '10:00 · 42분 · 5명 · 음성 파일', state: 'draft', sub: '할 일 3 · 구매 초안 1', active: true }] },
  { day: '어제 · 09-29 (화)', items: [
    { title: '품질 점검 회의', meta: '15:00 · 30분 · 4명 · 녹음', state: 'done', sub: '업무 등록 2 · 구매요청 초안 1' },
    { title: '납기 협의', meta: '10:30 · 25분 · 3명 · 텍스트', state: 'done', sub: '업무 등록 2' },
  ] },
  { day: '09-28 (월)', items: [{ title: '설비 점검 공유', meta: '14:00 · 20분 · 3명 · 음성 파일', state: 'proc', sub: 'AI 정리 중' }] },
];

const small: CSSProperties = { fontSize: 12.5, lineHeight: '18px' };
const blk: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };

function Sample() {
  return (
    <div className="hl-row" style={{ gap: 8, flex: 'none' }}>
      <span className="hl-badge hl-badge--outline">예시 화면</span>
      <span className="hl-cap">아래 내용은 화면 구성을 보여 주는 예시예요. 실제 데이터가 아니에요.</span>
    </div>
  );
}

function StateBadge({ state, small: sm }: { state: 'draft' | 'done' | 'proc'; small?: boolean }) {
  if (state === 'draft') return <span className="hl-badge hl-badge--wait">확인 대기</span>;
  if (state === 'done') return <span className="hl-badge hl-badge--ok">확인 완료</span>;
  return <span style={{ fontSize: sm ? 11.5 : 12, fontWeight: 600, color: '#1F5FCC' }}>AI 정리 중</span>;
}

function AttendeeChip({ name }: { name: string }) {
  const a = avatarOf(name);
  return (
    <span className="hl-chip" style={{ height: 24, padding: '0 8px 0 3px' }}>
      <span className={`hl-avatar hl-avatar--sm${a?.tone ?? ''}`} style={{ width: 18, height: 18 }}>{a?.initial ?? name.slice(0, 1)}</span>
      {name}
    </span>
  );
}

// ── 목록 (v1 36번) ─────────────────────────────────────────────
function ListDesign() {
  return (
    <div className="meet-split">
      <section className="hl-master" aria-label="회의 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>회의 4건</b>
            <span className="hl-cap">최근 7일</span>
            <SoonButton className="hl-btn hl-btn--sm hl-btn--primary"><i className="ic ic-plus" />새 회의</SoonButton>
          </div>
          <label className="hl-inputwrap">
            <i className="ic ic-search ic--sm" />
            <input className="hl-input" type="search" placeholder="제목·참석자·수주번호" aria-label="회의 검색" disabled tabIndex={-1} />
          </label>
          <div className="hl-seg" role="group" aria-label="정리 상태" style={{ alignSelf: 'flex-start' }}>
            <button type="button" className="is-on" disabled tabIndex={-1}>전체</button>
            <button type="button" disabled tabIndex={-1}>확인 대기 1</button>
            <button type="button" disabled tabIndex={-1}>정리 중 1</button>
            <button type="button" disabled tabIndex={-1}>완료 2</button>
          </div>
          <div className="hl-row" style={{ gap: 10 }}>
            <label className="hl-row" style={{ gap: 6, fontSize: 12, color: '#3F4A57' }}>
              <input type="checkbox" disabled tabIndex={-1} />
              내가 참석한 회의
            </label>
            <span className="hl-btn hl-btn--sm hl-btn--ghost" style={{ marginLeft: 'auto' }}><i className="ic ic-calendar" />7일</span>
          </div>
        </div>
        <div className="hl-master__list">
          {MEETINGS.map((d) => (
            <div key={d.day}>
              <div className="hl-daysep" style={{ padding: '10px 16px 4px' }}>{d.day}</div>
              {d.items.map((m) => (
                <div key={m.title} className={`hl-mitem${m.active ? ' is-active' : ''}`}>
                  <div className="hl-row">
                    <b style={{ fontSize: 13.5 }}>{m.title}</b>
                    <span style={{ marginLeft: 'auto' }}><StateBadge state={m.state} small /></span>
                  </div>
                  <span className="hl-cap tnum">{m.meta}</span>
                  {m.state === 'draft' ? (
                    <div className="hl-row" style={{ gap: 6 }}>
                      <span className="hl-ai-pick">Voice2ERP 정리 완료</span>
                      <span className="hl-cap">{m.sub}</span>
                    </div>
                  ) : m.state === 'done' ? (
                    <span className="hl-cap">{m.sub}</span>
                  ) : (
                    <div className="hl-row" style={{ gap: 8 }}>
                      <span className="hl-skel hl-skel--line" style={{ flex: 1 }} />
                      <span className="hl-cap tnum">{m.sub}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          <div className="hl-daysep" style={{ padding: '10px 16px 4px' }}>예정</div>
          <div className="hl-mitem" style={{ background: '#F7F8FA' }}>
            <div className="hl-row">
              <b style={{ fontSize: 13.5, color: '#3F4A57' }}>주간 생산회의</b>
              <span className="hl-tag" style={{ marginLeft: 'auto' }}>10-07 10:00</span>
            </div>
            <span className="hl-cap">지난 회의(주간 생산회의)에서 정한 다음 회의 · 녹음 준비</span>
          </div>
        </div>
      </section>

      <div className="meet-detail">
        <div className="hl-page-head">
          <div>
            <div className="hl-crumb">
              대시보드
              <i className="ic ic-chevron-right ic--sm" />
              회의록
              <i className="ic ic-chevron-right ic--sm" />
              09-30 10:00
            </div>
            <h1 className="hl-title hl-row" style={{ gap: 10 }}>
              주간 생산회의
              <span className="hl-badge hl-badge--ok">정리 완료</span>
              <StateBadge state="draft" />
            </h1>
          </div>
          <div className="hl-page-head__actions">
            <button type="button" className="hl-btn" disabled tabIndex={-1}><i className="ic ic-history" />작업 로그</button>
            <SoonButton className="hl-btn hl-btn--primary">결과 확인하고 등록 <i className="ic ic-arrow-right" /></SoonButton>
          </div>
        </div>

        <section className="hl-card" style={{ flex: 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto) 1fr', columnGap: 28, padding: '12px 16px', alignItems: 'start' }}>
            <div className="hl-figure"><span>일시</span><b style={{ fontSize: 15 }} className="tnum">09-30 10:00 · 42분</b></div>
            <div className="hl-figure"><span>입력 방식</span><b style={{ fontSize: 15 }}>음성 파일</b></div>
            <div className="hl-figure"><span>작성</span><b style={{ fontSize: 15 }}>박생산</b></div>
            <div className="hl-figure">
              <span>연결</span>
              <div className="hl-row" style={{ gap: 6, marginTop: 3 }}>
                <span className="hl-tag">수주 SO-20260930-0001</span>
              </div>
            </div>
            <div className="hl-figure">
              <span>참석자 {ATTENDEES.length}명</span>
              <div className="hl-row" style={{ gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                {ATTENDEES.map((a) => <AttendeeChip key={a.name} name={a.name} />)}
              </div>
            </div>
          </div>
        </section>

        <div className="meet-two">
          <section className="hl-ai-card">
            <header className="hl-card__head">
              <span className="hl-aimark hl-aimark--sm">AI</span>
              <h2>Voice2ERP 정리 미리보기</h2>
              <span className="hl-card__meta">초안 · 확인 전</span>
              <span className="hl-code-badge hl-code-badge--ai" style={{ marginLeft: 'auto' }}>AI_GENERATED</span>
            </header>
            <div className="hl-card__body" style={{ gap: 12, flex: 1 }}>
              <div style={blk}>
                <span className="hl-cap">요약</span>
                <ol style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13, lineHeight: '19px', listStyle: 'none', margin: 0, padding: 0 }}>
                  {SUMMARY.map((s, i) => <li key={s}>{i + 1}. {s}</li>)}
                </ol>
              </div>
              <div style={blk}>
                <span className="hl-cap">결정사항 {DECISIONS.length}</span>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 4, ...small, listStyle: 'none', margin: 0, padding: 0 }}>
                  {DECISIONS.map((d) => (
                    <li key={d} className="hl-row" style={{ gap: 6 }}>
                      <i className="ic ic-check ic--sm hl-ok-text" />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div style={blk}>
                <span className="hl-cap">할 일 {TASKS.length} · 등록 전</span>
                <table className="hl-ai-table">
                  <thead><tr><th>담당</th><th>할 일</th><th className="num">마감</th></tr></thead>
                  <tbody>
                    {TASKS.map((t) => <tr key={t.text}><td>{t.who}</td><td>{t.text}</td><td className="num">{t.due}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div className="hl-origin" style={{ alignItems: 'center' }}>
                <i className="ic ic-cart ic--sm" />
                <span><b style={{ color: '#121820' }}>구매 관련 1</b> · 철광석 1,200 t 10-07까지 → 구매요청 초안으로 보낼 수 있어요</span>
              </div>
              <div className="hl-origin" style={{ alignItems: 'center' }}>
                <i className="ic ic-calendar ic--sm" />
                <span><b style={{ color: '#121820' }}>다음 회의</b> · 10-07 10:00 주간 생산회의</span>
              </div>
              <div className="hl-sources" style={{ marginTop: 'auto' }}>
                <span className="hl-sources__label">근거</span>
                <span className="hl-source"><i className="ic ic-mic ic--sm" />음성 파일 원본 · 전체 텍스트<em>화자 5명</em></span>
              </div>
            </div>
          </section>
          <section className="hl-card">
            <header className="hl-card__head">
              <i className="ic ic-note" />
              <h2>전체 텍스트 미리보기</h2>
            </header>
            <div className="hl-card__body" style={{ gap: 10, flex: 1 }}>
              {TRANSCRIPT.slice(0, 6).map((l) => {
                const a = avatarOf(l.speaker);
                return (
                  <div key={l.t} className="hl-chat-msg" style={{ gridTemplateColumns: '28px 1fr' }}>
                    <span className={`hl-avatar hl-avatar--sm${a?.tone ?? ''}`}>{a?.initial ?? l.speaker.slice(0, 1)}</span>
                    <div>
                      <div className="hl-chat-msg__meta"><b>{l.speaker}</b><time>{l.t}</time></div>
                      <p style={{ margin: 0, ...small }}>{l.text}</p>
                    </div>
                  </div>
                );
              })}
              <span className="hl-cap" style={{ marginTop: 'auto' }}>… 이후 발언 2개 · 38:02까지</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── 새 회의 (v1 37번 · 음성 파일 업로드 방식) ─────────────────────
function NewDesign() {
  return (
    <div className="hl-col" style={{ gap: 14, flex: 1, minHeight: 0 }}>
      <div className="hl-page-head">
        <div>
          <div className="hl-crumb">
            대시보드
            <i className="ic ic-chevron-right ic--sm" />
            회의록
            <i className="ic ic-chevron-right ic--sm" />
            새 회의
          </div>
          <h1 className="hl-title">주간 생산회의 · 파일로 기록</h1>
        </div>
        <div className="hl-page-head__actions">
          <button type="button" className="hl-btn" disabled tabIndex={-1}><i className="ic ic-chevron-left" />회의 목록</button>
          <SoonButton>임시 저장</SoonButton>
        </div>
      </div>
      <div className="meet-new">
        <section className="hl-card">
          <div className="hl-tabs" style={{ padding: '0 12px' }} role="tablist" aria-label="입력 방식">
            <span className="hl-tab"><i className="ic ic-mic ic--sm" />녹음</span>
            <span className="hl-tab is-active"><i className="ic ic-upload ic--sm" />음성 파일 업로드</span>
            <span className="hl-tab"><i className="ic ic-note ic--sm" />텍스트 붙여넣기</span>
            <span className="hl-cap" style={{ marginLeft: 'auto', alignSelf: 'center' }}>입력 방식은 하나만 선택돼요</span>
          </div>
          <div className="hl-card__body" style={{ flex: 1, gap: 16, padding: '20px 24px' }}>
            <div className="hl-drop" style={{ padding: 22 }}>
              <span className="hl-state__icon" style={{ width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#E7EEF5', color: '#173A5E' }}>
                <i className="ic ic-upload ic--lg" />
              </span>
              <b style={{ fontSize: 14, color: '#121820' }}>회의 파일을 끌어 놓거나 선택하세요</b>
              <span className="hl-cap">텍스트(.txt) · 음성(m4a · mp3 · wav) · 최대 200 MB</span>
              <SoonButton className="hl-btn hl-btn--sm"><i className="ic ic-clip" />파일 선택</SoonButton>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="hl-row">
                <b style={{ fontSize: 13 }}>선택한 파일</b>
                <span className="hl-cap">파일을 고르면 이렇게 보여요 (예시)</span>
              </div>
              <div className="hl-row" style={{ gap: 12, padding: '14px 16px', border: '1px solid #DDE2E7', borderRadius: 6 }}>
                <span className="hl-chan" style={{ width: 40, height: 40, background: '#E6EEFC', color: '#1F5FCC' }}>
                  <i className="ic ic-mic ic--lg" />
                </span>
                <div className="hl-col" style={{ gap: 2 }}>
                  <b style={{ fontSize: 13 }} className="mono">주간생산회의_0930.m4a</b>
                  <span className="hl-cap">음성 · 42분 · 38.4 MB</span>
                </div>
              </div>
            </div>
          </div>
          <div className="hl-card__foot" style={{ padding: '12px 24px' }}>
            <span className="hl-cap">파일을 읽으면 바로 정리를 시작할 수 있어요</span>
            <span style={{ marginLeft: 'auto' }}><SoonButton>취소</SoonButton></span>
            <SoonButton className="hl-btn hl-btn--ai"><span className="hl-aimark hl-aimark--sm" style={{ background: '#FFFFFF', color: '#5B3FC4' }}>AI</span>정리 시작</SoonButton>
          </div>
        </section>

        <aside className="hl-card" aria-label="회의 정보">
          <header className="hl-card__head">
            <h2>회의 정보</h2>
            <span className="hl-card__meta">작성 박생산</span>
          </header>
          <div className="hl-card__body" style={{ gap: 14, flex: 1 }}>
            <div className="hl-field">
              <label htmlFor="meet-title">제목</label>
              <input id="meet-title" className="hl-input" readOnly tabIndex={-1} defaultValue="주간 생산회의" />
            </div>
            <div className="hl-field">
              <label htmlFor="meet-when">일시</label>
              <span className="hl-inputwrap">
                <i className="ic ic-calendar ic--sm" />
                <input id="meet-when" className="hl-input tnum" readOnly tabIndex={-1} defaultValue="2026-09-30 10:00" />
              </span>
            </div>
            <div className="hl-field">
              <span className="hl-field__label">참석자 {ATTENDEES.length}명</span>
              <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {ATTENDEES.map((a) => <AttendeeChip key={a.name} name={a.name} />)}
                <span className="hl-chip" style={{ borderStyle: 'dashed', padding: '0 7px' }}><i className="ic ic-plus ic--sm" /></span>
              </div>
            </div>
            <div className="hl-field">
              <span className="hl-field__label">연결</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="hl-file">
                  <i className="ic ic-order" />
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <b style={{ fontSize: 12.5 }}>수주 SO-20260930-0001</b>
                    <span className="hl-cap">한빛중공업 · 납기 10-15</span>
                  </span>
                </div>
                <span className="hl-btn hl-btn--sm hl-btn--ghost" style={{ alignSelf: 'flex-start' }}><i className="ic ic-link" />연결 추가</span>
              </div>
            </div>
            <div className="hl-field">
              <label htmlFor="meet-agenda">안건</label>
              <textarea id="meet-agenda" className="hl-input" rows={3} readOnly tabIndex={-1} defaultValue={'열연 점검 일정\n철광석 재고'} />
            </div>
            <label className="hl-row" style={{ gap: 8, fontSize: 12.5, color: '#3F4A57' }}>
              <input type="checkbox" disabled tabIndex={-1} defaultChecked />
              정리가 끝나면 참석자에게 알림
            </label>
            <div className="hl-ai-brief" style={{ marginTop: 'auto', alignItems: 'flex-start' }}>
              <span className="hl-aimark hl-aimark--sm">AI</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <p style={{ fontSize: 12.5, lineHeight: '18px' }}>
                  <b>Voice2ERP</b>
                  : 전체 텍스트 → 요약·결정사항·할 일 초안 · 확인 후 업무 등록
                </p>
                <span className="hl-cap">AI는 등록하지 않아요</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── 정리 결과 (v1 38번) ─────────────────────────────────────────
function ResultDesign() {
  return (
    <div className="meet-split">
      <section className="hl-master" aria-label="전체 텍스트">
        <div className="hl-master__head" style={{ gap: 8 }}>
          <div className="hl-row">
            <i className="ic ic-note" />
            <b style={{ fontSize: 14 }}>전체 텍스트</b>
            <span className="hl-cap">발언 {TRANSCRIPT.length} · 42분</span>
            <span className="hl-iconbtn hl-iconbtn--sm" style={{ marginLeft: 'auto' }}><i className="ic ic-mic" /></span>
          </div>
          <label className="hl-inputwrap">
            <i className="ic ic-search ic--sm" />
            <input className="hl-input" style={{ height: 30 }} type="search" placeholder="텍스트 검색" aria-label="전체 텍스트 검색" disabled tabIndex={-1} />
          </label>
        </div>
        <div className="hl-master__list" style={{ padding: '4px 0' }}>
          {TRANSCRIPT.map((l, i) => {
            const on = i === 3;
            return (
              <div
                key={l.t}
                style={{ display: 'grid', gridTemplateColumns: '40px 1fr', columnGap: 8, padding: on ? '8px 14px' : '6px 14px', fontSize: 12, lineHeight: '17px', ...(on ? { background: '#F3F0FD', boxShadow: 'inset 0 0 0 1px #CFC5F5' } : null) }}
              >
                <time className={`mono${on ? '' : ' hl-muted'}`} style={{ fontSize: 11, ...(on ? { color: '#452FA0', fontWeight: 600 } : null) }}>{l.t}</time>
                <span>
                  <b>{l.speaker}</b> {l.text}
                  {on ? <><br /><span className="hl-ai-pick" style={{ marginTop: 4 }}>구매 관련 항목 1</span></> : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="meet-detail">
        <div className="hl-page-head">
          <div>
            <div className="hl-crumb">
              대시보드
              <i className="ic ic-chevron-right ic--sm" />
              회의록
              <i className="ic ic-chevron-right ic--sm" />
              주간 생산회의
            </div>
            <h1 className="hl-title hl-row" style={{ gap: 10 }}>
              <span className="hl-aimark">AI</span>
              Voice2ERP 정리
              <span className="hl-code-badge hl-code-badge--ai">AI_GENERATED</span>
              <span className="hl-cap" style={{ fontWeight: 500 }}>초안 · 확인 전 · 09-30 10:00 · 42분 · 5명</span>
            </h1>
          </div>
          <div className="hl-page-head__actions">
            <button type="button" className="hl-btn" disabled tabIndex={-1}><i className="ic ic-chevron-left" />회의 목록</button>
            <button type="button" className="hl-btn" disabled tabIndex={-1}><i className="ic ic-history" />작업 로그</button>
          </div>
        </div>

        <section className="hl-ai-card" style={{ flex: 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr' }}>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, borderRight: '1px solid #CFC5F5' }}>
              <span className="hl-label" style={{ color: '#452FA0' }}>요약</span>
              <ol style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, lineHeight: '19px', listStyle: 'none', margin: 0, padding: 0 }}>
                {SUMMARY.map((s, i) => <li key={s}>{i + 1}. {s}</li>)}
              </ol>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="hl-label" style={{ color: '#452FA0' }}>결정사항 {DECISIONS.length}</span>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, lineHeight: '19px', listStyle: 'none', margin: 0, padding: 0 }}>
                {DECISIONS.map((d, i) => (
                  <li key={d} className="hl-row" style={{ gap: 6, alignItems: 'flex-start' }}>
                    <i className="ic ic-check ic--sm hl-ok-text" style={{ marginTop: 2 }} />
                    <span>{d}</span>
                    <span className="hl-link-id" style={{ marginLeft: 'auto', fontSize: 11.5, whiteSpace: 'nowrap' }}>원문 {['05:40', '09:03', '38:02'][i]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <div className="meet-two meet-two--tasks">
          <section className="hl-card" style={{ minHeight: 0 }}>
            <header className="hl-card__head">
              <i className="ic ic-task" />
              <h2>할 일 {TASKS.length}</h2>
              <span className="hl-card__meta">담당·마감 수정 가능 · 체크한 항목만 업무로 등록</span>
            </header>
            <div className="hl-card__body hl-card__body--flush" style={{ overflow: 'auto' }}>
              <table className="hl-table">
                <thead>
                  <tr>
                    <th className="ctr" style={{ width: 56 }}>등록</th>
                    <th style={{ width: 116 }}>담당</th>
                    <th>할 일</th>
                    <th style={{ width: 110 }}>마감</th>
                  </tr>
                </thead>
                <tbody>
                  {TASKS.map((r) => (
                    <tr key={r.text} style={{ height: 56 }}>
                      <td className="ctr"><input type="checkbox" defaultChecked disabled tabIndex={-1} aria-label="업무로 등록" /></td>
                      <td>
                        <span className="hl-selectwrap">
                          <select className="hl-input" aria-label="담당" defaultValue={r.who} disabled tabIndex={-1}>
                            <option>{r.who}</option>
                          </select>
                          <i className="ic ic-chevron-down ic--sm" />
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>
                        <b style={{ fontWeight: 500 }}>{r.text}</b>
                        <div className="hl-cap">원문 {r.src}</div>
                      </td>
                      <td><input className="hl-input tnum" defaultValue={r.due} placeholder="MM-DD" readOnly tabIndex={-1} aria-label="마감" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="hl-row" style={{ gap: 8, fontSize: 13 }}>
                  <i className="ic ic-calendar ic--sm hl-muted" />
                  <span className="hl-label">다음 회의</span>
                  <b className="tnum">10-07 10:00</b>
                  <span className="hl-cap">주간 생산회의</span>
                </div>
                <div className="hl-sources">
                  <span className="hl-sources__label">근거</span>
                  <span className="hl-source"><i className="ic ic-mic ic--sm" />음성 파일 원본 42분 · 전체 텍스트<em>발언 {TRANSCRIPT.length}</em></span>
                  <span className="hl-source"><i className="ic ic-calc ic--sm" />MRP 결과 철광석 부족 1,200 t<em>09-30 10:00</em></span>
                </div>
              </div>
            </div>
          </section>

          <div className="hl-col" style={{ gap: 14, minHeight: 0 }}>
            <section className="hl-draft">
              <div className="hl-draft__head">
                <i className="ic ic-cart ic--sm" style={{ color: '#452FA0' }} />
                <b>구매 관련 항목 1</b>
                <span className="hl-code-badge hl-code-badge--ai">AI_GENERATED</span>
              </div>
              <div className="hl-draft__body" style={{ gap: 10, flex: 1 }}>
                <dl className="hl-kv" style={{ rowGap: 7 }}>
                  <dt>원료</dt><dd>철광석 <span className="mono hl-muted">RM-IO</span></dd>
                  <dt>수량</dt><dd>1,200 t</dd>
                  <dt>희망 입고</dt><dd>10-07</dd>
                  <dt>요청자</dt><dd>서구매</dd>
                </dl>
                <div className="hl-origin">
                  <i className="ic ic-mic ic--sm" />
                  <span>주간 생산회의 · 서구매 09:03 “철광석 재고를 보니 …” <span className="hl-link-id">원문 보기</span></span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div className="hl-figure" style={{ padding: '8px 10px', background: '#F7F8FA', borderRadius: 4 }}>
                    <span>MRP 부족 · 09-30 10:00</span>
                    <b style={{ fontSize: 16 }}>1,200<small>t</small></b>
                  </div>
                  <div className="hl-figure" style={{ padding: '8px 10px', background: '#F7F8FA', borderRadius: 4 }}>
                    <span>요청 후 여유</span>
                    <b style={{ fontSize: 16 }}>0<small>t</small></b>
                  </div>
                </div>
                <span className="hl-cap">보내면 요청자가 구매요청 초안을 확인·수정 후 확정해요</span>
                <span className="hl-draftflow">
                  <span className="is-ai is-current">AI_GENERATED</span><i /><span>WAITING_APPROVAL</span><i /><span>APPROVED</span><i /><span>EXECUTED</span>
                </span>
              </div>
              <div className="hl-draft__actions">
                <SoonButton className="hl-btn hl-btn--ai-outline"><i className="ic ic-cart" />구매요청 초안으로 보내기</SoonButton>
              </div>
            </section>
          </div>
        </div>

        <div className="hl-row" style={{ flex: 'none', gap: 8, padding: '10px 14px', background: '#FFFFFF', border: '1px solid #DDE2E7', borderRadius: 6 }}>
          <span className="hl-lockhint">
            <i className="ic ic-info ic--sm" />
            AI 정리는 초안이에요 · 확인 전엔 업무가 등록되지 않아요
          </span>
          <label className="hl-selectwrap" style={{ width: 190, marginLeft: 'auto' }}>
            <select className="hl-input" aria-label="정리 결과 공유 대화방" disabled tabIndex={-1} defaultValue="">
              <option value="">대화방 공유 안 함</option>
            </select>
            <i className="ic ic-chevron-down ic--sm" />
          </label>
          <SoonButton className="hl-btn hl-btn--ai-outline"><i className="ic ic-refresh" />다시 정리</SoonButton>
          <SoonButton className="hl-btn hl-btn--primary"><i className="ic ic-check" />확인하고 업무 등록 (3)</SoonButton>
        </div>
      </div>
    </div>
  );
}

export function MeetingPage() {
  const [tab, setTab] = useState<TabKey>('list');
  return (
    <main className="hl-main">
      {/* 탭은 흐려지는 영역 밖에 둬서 눌러 볼 수 있다 */}
      <div className="hl-tabs meet-tabs" role="tablist" aria-label="회의록 화면 보기">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`hl-tab${tab === t.key ? ' is-active' : ''}`} onClick={() => setTab(t.key)}>
            <i className={`ic ${t.icon} ic--sm`} />
            {t.label}
          </button>
        ))}
        <span className="hl-cap" style={{ marginLeft: 'auto', alignSelf: 'center' }}>Voice2ERP 회의록 · 화면 3개를 탭으로 볼 수 있어요</span>
      </div>
      <ComingSoonArea grade="P2" title="Voice2ERP 회의록">
        <Sample />
        {tab === 'list' ? <ListDesign /> : tab === 'new' ? <NewDesign /> : <ResultDesign />}
      </ComingSoonArea>
    </main>
  );
}
