// 로그인 (B안 디자인). 사원번호·비밀번호 → 서버 발급 JWT (REQ-AUTH-001).
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { authApi } from '@/api/auth';
import { Icon } from '@/components/ui';
import { useAuthStore } from '@/stores/auth';

// 시드에 들어 있는 테스트 계정 (로컬 시연용). 비밀번호는 server/prisma/seed.ts의 SEED_PASSWORD.
const DEMO_PASSWORD = 'heatline';
const DEMO: { role: string; name: string; no: string; note: string }[] = [
  { role: '영업', name: '김영업', no: '2104012', note: '수주 등록·출하요청' },
  { role: '구매', name: '서구매', no: '1907015', note: 'MRP·구매요청·발주·입고' },
  { role: '생산', name: '박생산', no: '1803021', note: '생산계획·실적·열연 배정' },
  { role: '품질', name: '정품질', no: '1911030', note: '검사 입력·불합격 관리' },
  { role: '물류', name: '윤물류', no: '2005024', note: '출고 확정·밀시트' },
  { role: '부서장', name: '남구매', no: '1604007', note: '구매부장 · 구매요청 승인' },
  { role: '부서장', name: '강생산', no: '1402002', note: '생산부장 · 구매요청 승인' },
  { role: '관리자', name: '이관리', no: '1704010', note: '사용자·부서·권한·기준정보' },
];

export function LoginPage() {
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [employeeNo, setEmployeeNo] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const next = params.get('next') || '/dashboard';

  if (session) return <Navigate to={next.startsWith('/login') ? '/dashboard' : next} replace />;

  const login = async (no: string, pw: string) => {
    if (!no.trim() || !pw) {
      setError('사원번호와 비밀번호를 입력해 주세요');
      return;
    }
    setPending(true);
    setError(null);
    try {
      setSession(await authApi.login(no.trim(), pw));
      navigate(next.startsWith('/login') ? '/dashboard' : next, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '로그인하지 못했어요');
    } finally {
      setPending(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void login(employeeNo, password);
  };

  return (
    <div className="hl hl-app hl-app--rail">
      <section aria-label="FantaSteel 소개" style={{ width: 'min(760px, 52vw)', flex: 'none', background: '#16202B', color: '#FFFFFF', padding: '44px 60px 40px', display: 'flex', flexDirection: 'column', gap: 28, overflow: 'hidden' }}>
        <div className="hl-row" style={{ gap: 12 }}>
          <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden="true">
            <rect width="24" height="24" rx="4" fill="#FFFFFF" />
            <rect x="6" y="5" width="3" height="14" fill="#173A5E" />
            <rect x="15" y="5" width="3" height="14" fill="#173A5E" />
            <rect x="3" y="10.5" width="18" height="3" fill="#E0762E" />
          </svg>
          <span className="hl-col" style={{ gap: 2 }}>
            <span style={{ fontSize: 18, lineHeight: '22px', fontWeight: 700, letterSpacing: '.08em' }}>FANTASTEEL</span>
            <span style={{ fontSize: 12, color: '#C9D2DC' }}>철강 제조 AI 협업 ERP</span>
          </span>
        </div>
        <div className="hl-col" style={{ gap: 10, marginTop: 8 }}>
          <h1 style={{ fontSize: 30, lineHeight: '42px', fontWeight: 600, letterSpacing: '-.01em', margin: 0 }}>수주에서 출하까지,<br />한 흐름으로 일합니다.</h1>
          <p style={{ fontSize: 14, lineHeight: '22px', color: '#C9D2DC', maxWidth: 560, margin: 0 }}>영업·구매·생산·품질·물류가 같은 수주와 LOT를 보고 일해요. 예약과 배정은 시스템이 추천하고 담당자가 확정합니다.</p>
        </div>
        <svg viewBox="0 0 640 250" aria-hidden="true" style={{ display: 'block', flex: 'none', width: '100%', maxWidth: 640 }}>
          <rect x="0" y="40" width="260" height="210" fill="#223040" />
          <rect x="20" y="64" width="220" height="24" rx="2" fill="#23507F" /><rect x="20" y="94" width="220" height="24" rx="2" fill="#23507F" />
          <rect x="20" y="124" width="220" height="24" rx="2" fill="#5B86B5" /><rect x="20" y="154" width="176" height="24" rx="2" fill="#23507F" />
          <rect x="20" y="184" width="120" height="24" rx="2" fill="#5B86B5" /><rect x="20" y="214" width="64" height="24" rx="2" fill="#23507F" />
          <rect x="280" y="0" width="150" height="104" fill="#223040" />
          <rect x="296" y="16" width="118" height="32" rx="2" fill="#5B86B5" /><rect x="296" y="56" width="118" height="32" rx="2" fill="#23507F" />
          <rect x="446" y="0" width="194" height="104" fill="#23507F" />
          <rect x="462" y="18" width="160" height="12" rx="2" fill="#223040" /><rect x="462" y="38" width="112" height="12" rx="2" fill="#223040" /><rect x="462" y="58" width="136" height="12" rx="2" fill="#223040" />
          <rect x="280" y="120" width="360" height="130" fill="#223040" />
          {[[300, 186, 48, '#23507F'], [330, 162, 72, '#5B86B5'], [360, 176, 58, '#23507F'], [390, 146, 88, '#5B86B5'], [420, 168, 66, '#23507F'], [450, 154, 80, '#5B86B5'], [480, 190, 44, '#23507F'], [510, 158, 76, '#5B86B5'], [540, 172, 62, '#23507F'], [570, 150, 84, '#5B86B5'], [600, 182, 52, '#23507F']].map(([x, y, h, c]) => (
            <rect key={x as number} x={x as number} y={y as number} width="18" height={h as number} rx="2" fill={c as string} />
          ))}
          <rect x="280" y="110" width="96" height="3" fill="#E0762E" />
        </svg>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 'auto', paddingTop: 22, borderTop: '1px solid #223040', listStyle: 'none', paddingLeft: 0, marginBottom: 0 }}>
          {[
            { icon: 'order', title: '수주→출하 한 흐름', text: '예약·생산·검사·출하 매수를 수주 한 줄에서 확인' },
            { icon: 'approve', title: '추천은 시스템, 확정은 사람', text: '예약·배정은 추천 후 담당자가 확정, 구매요청은 부서장이 승인' },
            { icon: 'trace', title: '원료부터 코일까지 LOT 추적', text: '원료 → 용선 → 히트 → 슬래브 → 코일 정·역추적' },
          ].map((f) => (
            <li key={f.title} className="hl-row" style={{ gap: 14 }}>
              <span style={{ width: 36, height: 36, borderRadius: 6, background: '#223040', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#9DB6D1' }}><Icon name={f.icon} /></span>
              <div className="hl-col"><b style={{ fontSize: 14, fontWeight: 600 }}>{f.title}</b><span style={{ fontSize: 12, color: '#C9D2DC' }}>{f.text}</span></div>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="로그인" style={{ flex: 1, minWidth: 0, background: '#FFFFFF', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', padding: '56px 24px 24px' }}>
          <form style={{ width: 400, display: 'flex', flexDirection: 'column', gap: 16 }} onSubmit={submit}>
            <div className="hl-col" style={{ gap: 4 }}>
              <h2 style={{ fontSize: 24, lineHeight: '32px', fontWeight: 600, margin: 0 }}>로그인</h2>
              <p className="hl-muted" style={{ fontSize: 13, margin: 0 }}>사원번호와 비밀번호를 입력하세요.</p>
            </div>
            <div className="hl-field">
              <label htmlFor="login-no">사원번호</label>
              <span className="hl-inputwrap">
                <i className="ic ic-user" style={{ top: 12 }} />
                <input id="login-no" className="hl-input" type="text" inputMode="numeric" style={{ height: 40 }} placeholder="예: 2104012" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} autoComplete="username" autoFocus />
              </span>
            </div>
            <div className="hl-field">
              <label htmlFor="login-pw">비밀번호</label>
              <span className="hl-inputwrap">
                <i className="ic ic-key" style={{ top: 12 }} />
                <input id="login-pw" className={`hl-input${error ? ' is-error' : ''}`} type={show ? 'text' : 'password'} style={{ height: 40, paddingRight: 40 }} placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-invalid={!!error} aria-describedby={error ? 'login-err' : undefined} />
                <button className="hl-iconbtn hl-iconbtn--sm" style={{ position: 'absolute', right: 6, top: 6 }} aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'} type="button" onClick={() => setShow(!show)}>
                  <i className="ic ic-eye" style={{ position: 'static' }} />
                </button>
              </span>
              {error ? <span id="login-err" role="alert" className="hl-row" style={{ gap: 5, fontSize: 12, lineHeight: '16px', color: '#C0322B' }}><Icon name="alert" size="sm" />{error}</span> : null}
            </div>
            <button type="submit" className="hl-btn hl-btn--primary hl-btn--lg" style={{ width: '100%' }} disabled={pending}>{pending ? '로그인 중…' : '로그인'}</button>
            <div className="hl-col" style={{ gap: 6, paddingTop: 14, borderTop: '1px solid #DDE2E7' }}>
              <div className="hl-row"><b style={{ fontSize: 13 }}>테스트 계정</b><span className="hl-cap">누르면 바로 로그인해요 (로컬 시연용)</span></div>
              <ul className="hl-col" style={{ gap: 0, border: '1px solid #DDE2E7', borderRadius: 6, listStyle: 'none', padding: 0, margin: 0 }}>
                {DEMO.map((d, i) => (
                  <li key={d.no}>
                    <button type="button" className="hl-row" disabled={pending} onClick={() => void login(d.no, DEMO_PASSWORD)} style={{ width: '100%', gap: 10, height: 32, padding: '0 10px', border: 0, borderBottom: i < DEMO.length - 1 ? '1px solid #DDE2E7' : 0, background: 'transparent', color: '#121820', fontSize: 12.5, textAlign: 'left' }}>
                      <span className="hl-role" style={{ width: 50, justifyContent: 'center', whiteSpace: 'nowrap' }}>{d.role}</span>
                      <b style={{ fontWeight: 600, width: 48 }}>{d.name}</b>
                      <span className="hl-cap">{d.note}</span>
                      <Icon name="chevron-right" size="sm" style={{ marginLeft: 'auto', color: '#5E6977' }} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </form>
        </div>
        <footer className="hl-row" style={{ height: 48, flex: 'none', padding: '0 40px', gap: 8, fontSize: 11, color: '#5E6977', borderTop: '1px solid #DDE2E7' }}>
          <Icon name="shield" size="sm" />
          <span>인가된 사용자만 접속 · 계정 문의 경영지원부 이관리</span>
        </footer>
      </section>
    </div>
  );
}
