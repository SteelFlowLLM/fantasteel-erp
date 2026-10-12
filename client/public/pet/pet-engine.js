/* FantaPet — FantaSteel ERP 화면 도우미 펫 엔진 (데모)
 *
 * 프레임워크 없이 동작하고, 전역에는 window.FantaPet 하나만 둔다. 스타일도 이 파일이 <style>로 넣는다.
 * 캐릭터 팩은 window.FANTA_PET_CHARACTERS, 기능 설명은 window.FANTA_PET_GUIDE (규격: README.md).
 * 둘 다 없으면 엔진 안의 기본 캐릭터·최소 설명으로 돈다.
 *
 * 화면 쪽 약속(속성):
 *   data-pet-target="<키>"  마우스를 올리면 설명하는 요소 (SCREEN 키, widget:<위젯 키>, card:<화면>.<이름>, topbar:search …)
 *   data-pet-perch          펫이 윗면에 올라가 걷고 앉을 수 있는 요소 (위젯 카드, 화면의 Card)
 *   data-pet-climb          오를 수 있는 기둥 (왼쪽 레일)
 *   data-pet-ignore         이 안의 perch·target은 쓰지 않는다 (role=dialog·aria-modal 안도 마찬가지)
 *   data-pet-item="<종류>"  레코드 하나(표 행·목록 항목·상자). 마우스를 올리면 데이터를 읽어 준다 (data-pet-item-title · 안의 data-pet-field="<이름>")
 *   data-pet-term="<용어>"  라벨. th·dt와 함께 용어집(guide.glossary)에 있으면 설명한다 (없으면 바깥 항목·기능이 이어받는다)
 *
 * 실제 앱에서는 화면을 옮겨 다니므로 mount 옵션 screen·navigate와 setScreen(키)로 지금 화면을 알려 준다.
 */
(function (global) {
  'use strict';
  if (global.FantaPet) return;
  const doc = global.document;

  const VERSION = '0.1.0';
  const STYLE_ID = 'fantapet-style';
  const SIZES = { small: 72, normal: 96, large: 144 };
  const SIZE_LABEL = { small: '작게', normal: '보통', large: '크게' };
  const STD_ANIMS = {
    idle: { row: 0, frames: 4, ms: 220, loop: true },
    blink: { row: 1, frames: 3, ms: 70, loop: false },
    walk: { row: 2, frames: 6, ms: 100, loop: true },
    talk: { row: 3, frames: 4, ms: 120, loop: true },
    happy: { row: 4, frames: 6, ms: 90, loop: false },
    wave: { row: 5, frames: 4, ms: 150, loop: true },
    point: { row: 6, frames: 3, ms: 150, loop: false },
    think: { row: 7, frames: 4, ms: 200, loop: true },
    drag: { row: 8, frames: 4, ms: 110, loop: true },
    fall: { row: 9, frames: 2, ms: 100, loop: true },
    land: { row: 10, frames: 3, ms: 80, loop: false },
    sleep: { row: 11, frames: 4, ms: 400, loop: true },
    surprised: { row: 12, frames: 2, ms: 150, loop: false },
    sit: { row: 13, frames: 2, ms: 500, loop: true },
  };
  // 걷기·가리키기·점프만 오른쪽을 보고 그려져 있다. 나머지(정면)는 뒤집으면 글자·무늬가 거꾸로 된다.
  const FLIP_ANIMS = new Set(['walk', 'point', 'jump']);
  // 캐릭터 팩에 동작이 빠져 있을 때 대신 쓸 동작
  const ANIM_FALLBACK = { blink: 'idle', walk: 'idle', talk: 'idle', happy: 'wave', wave: 'idle', point: 'talk', think: 'idle', drag: 'fall', fall: 'idle', land: 'idle', sleep: 'idle', surprised: 'idle', sit: 'idle', climb: 'fall', ledge: 'land', jump: 'fall' };

  const GRAVITY = 2600;
  const FLOOR_GAP = 6;
  const SIDE_GAP = 6;
  const HOVER_DELAY = 600;
  const SAME_EXPLAIN_GAP = 15000;
  const ANY_EXPLAIN_GAP = 2500;
  // 행·용어는 여러 개를 연달아 훑으므로 간격을 짧게 둔다
  const ITEM_EXPLAIN_GAP = 700;
  const SAME_ITEM_GAP = 4000;
  const IDLE_TALK_MIN_GAP = 40000;
  const SLEEP_AFTER = 120000;
  const JUMP_DY = 76; // 이 높이 차 안의 옆 면은 점프로 건너간다. 더 높으면 사다리, 더 낮으면 뛰어내리기

  // ── 작은 도구 ───────────────────────────────────────────
  const now = () => performance.now();
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const pick = (list) => (list && list.length ? list[Math.floor(Math.random() * list.length)] : null);

  function h(tag, props, ...kids) {
    const el = doc.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v; // 엔진 안의 고정 SVG만 넣는다
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : doc.createTextNode(String(kid)));
    }
    return el;
  }

  function makeStore(key) {
    let cache = {};
    try {
      const raw = global.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (isObj(parsed)) cache = parsed;
    } catch (e) {
      cache = {};
    }
    return {
      get: (k, d) => (Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : d),
      has: (k) => Object.prototype.hasOwnProperty.call(cache, k),
      set(k, v) {
        cache[k] = v;
        try {
          global.localStorage.setItem(key, JSON.stringify(cache));
        } catch (e) {
          /* 저장소를 못 쓰면 이번 방문 동안만 기억한다 */
        }
      },
    };
  }

  function hexToRgb(hex) {
    let s = String(hex || '').trim().replace('#', '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    const n = parseInt(s, 16);
    if (s.length !== 6 || Number.isNaN(n)) return [224, 112, 40];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbStr = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
  const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function luminance(c) {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  /** 캐릭터 강조색에서 말풍선·버튼 색을 만든다. 버튼 글자(흰색)가 읽히도록 진한 색은 대비 4.5 이상까지 어둡게 한다. */
  function accentVars(hex) {
    const c = hexToRgb(hex);
    let ink = c;
    for (let i = 0; i < 14 && 1.05 / (luminance(ink) + 0.05) < 4.6; i++) ink = mixRgb(ink, [12, 16, 22], 0.12);
    return {
      '--fp-accent': rgbStr(c),
      '--fp-accent-ink': rgbStr(ink),
      '--fp-accent-soft': rgbStr(mixRgb(c, [255, 255, 255], 0.86)),
      '--fp-accent-shadow': rgbStr(mixRgb(c, [255, 255, 255], 0.62)),
    };
  }

  // 7×7 도트 아이콘 (메뉴용)
  const PX_ICONS = {
    chat: ['0111110', '1000001', '1010101', '1000001', '0111110', '0110000', '0100000'],
    info: ['0001000', '0000000', '0011000', '0001000', '0001000', '0001000', '0011100'],
    walk: ['0110000', '0110000', '0000110', '0110110', '0110000', '0000110', '0000110'],
    flag: ['1111100', '1111110', '1111100', '1000000', '1000000', '1000000', '1000000'],
    swap: ['0000100', '1111110', '0000100', '0010000', '0111111', '0010000', '0000000'],
    size: ['1110111', '1000001', '1000001', '0000000', '1000001', '1000001', '1110111'],
    hide: ['0000000', '0000000', '1000001', '0111110', '1010101', '0000000', '0000000'],
    screen: ['1111111', '1000001', '1010001', '1000001', '1111111', '0011100', '0111110'],
  };
  function pxIcon(name) {
    const rows = PX_ICONS[name] || [];
    let rects = '';
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '1') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    });
    return `<svg class="fp-ic" viewBox="0 0 7 7" aria-hidden="true" shape-rendering="crispEdges" fill="currentColor">${rects}</svg>`;
  }

  // ── 엔진 안의 기본 캐릭터 (캐릭터 파일이 하나도 없을 때) ─────────────
  function buildFallbackCharacter() {
    const C = 48;
    const cv = doc.createElement('canvas');
    cv.width = C * 6;
    cv.height = C * 14;
    const g = cv.getContext('2d');
    const P = { o: '#1e2b3a', d: '#3b4d62', s: '#5a6f87', b: '#8197ae', l: '#b5c5d6', h: '#edf3f8', e: '#141c26', w: '#ffffff', r: '#e0762e', R: '#b4561b', m: '#8f3426', y: '#ffc83d', z: '#6f8197', x: '#d8433a' };
    let ox = 0;
    let oy = 0;
    const put = (x, y, c) => {
      if (x < 0 || y < 0 || x >= C || y >= C) return;
      g.fillStyle = P[c];
      g.fillRect(ox + x, oy + y, 1, 1);
    };
    const rect = (x, y, w, hh, c) => {
      for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, c);
    };
    function body(dx, dy, sw, sh) {
      const rw = 13 + sw;
      const rh = 14 + sh;
      const cx = 24 + dx;
      const bottom = 42 + dy;
      const cy = bottom - rh;
      const inside = (x, y) => {
        const nx = (x - cx + 0.5) / (rw + 0.5);
        const ny = (y - cy + 0.5) / (rh + 0.5);
        return Math.pow(Math.abs(nx), 2.6) + Math.pow(Math.abs(ny), 2.6) <= 1;
      };
      for (let y = cy - rh - 1; y <= bottom + 1; y++) {
        for (let x = cx - rw - 1; x <= cx + rw + 1; x++) {
          if (!inside(x, y)) continue;
          const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
          const nx = (x - cx + 0.5) / (rw + 0.5);
          const ny = (y - cy + 0.5) / (rh + 0.5);
          const k = (nx + 0.45) * (nx + 0.45) + (ny + 0.55) * (ny + 0.55);
          let c = edge ? 'o' : k < 0.18 ? 'h' : k < 0.6 ? 'l' : k < 1.3 ? 'b' : k < 2 ? 's' : 'd';
          if (!edge && ny > 0.2 && ny < 0.46) c = k < 1.3 ? 'r' : 'R';
          put(x, y, c);
        }
      }
      put(cx + rw - 3, bottom - 4, 'l');
      put(cx + rw - 4, bottom - 3, 'l');
      return { cx, cy, rw, rh };
    }
    function eyes(cx, ey, kind, look) {
      const xs = [cx - 6 + look, cx + 3 + look];
      for (const x0 of xs) {
        if (kind === 'open') {
          rect(x0, ey, 3, 4, 'e');
          put(x0, ey, 'w');
        } else if (kind === 'half') rect(x0, ey + 2, 3, 2, 'e');
        else if (kind === 'closed') rect(x0, ey + 3, 3, 1, 'e');
        else if (kind === 'big') {
          rect(x0 - (x0 === xs[0] ? 1 : 0), ey - 1, 4, 5, 'w');
          rect(x0 + (x0 === xs[0] ? 0 : 1), ey, 2, 3, 'e');
        }
      }
    }
    function mouth(cx, my, kind) {
      if (kind === 'open') rect(cx - 2, my, 4, 3, 'm');
      else if (kind === 'small') rect(cx - 1, my, 3, 1, 'e');
      else if (kind === 'smile') {
        put(cx - 2, my, 'e');
        rect(cx - 1, my + 1, 3, 1, 'e');
        put(cx + 2, my, 'e');
      } else if (kind === 'o') rect(cx - 1, my, 3, 3, 'e');
    }
    function foot(x, y, w, hh) {
      rect(x, y, w, hh, 'o');
      rect(x + 1, y, w - 2, hh - 1, 's');
    }
    function feet(kind, dy) {
      const y = 43 + (dy || 0);
      if (kind === 'stand') { foot(16, y, 6, 4); foot(26, y, 6, 4); }
      else if (kind === 'walkA') { foot(13, y, 6, 4); foot(28, y - 1, 6, 4); }
      else if (kind === 'walkB') { foot(18, y - 1, 6, 4); foot(24, y, 6, 4); }
      else if (kind === 'spread') { foot(11, y - 1, 6, 4); foot(31, y + 1, 6, 4); }
      else if (kind === 'dangle1') { foot(17, 42, 5, 6); foot(26, 42, 5, 5); }
      else if (kind === 'dangle2') { foot(17, 42, 5, 5); foot(26, 42, 5, 6); }
    }
    function arm(x, y, w, hh) {
      rect(x, y, w, hh, 'o');
      rect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, hh - 2), 'l');
    }
    function frame(col, row, p) {
      ox = col * C;
      oy = row * C;
      if (p.ft !== null) feet(p.ft || 'stand', p.fdy || 0);
      const b = body(p.dx || 0, p.dy || 0, p.sw || 0, p.sh || 0);
      eyes(b.cx, b.cy - 6, p.eye || 'open', p.look || 0);
      if (p.mouth) mouth(b.cx, b.cy + 1, p.mouth);
      return b;
    }
    [[0, 0], [1, 1], [1, 1], [0, 0]].forEach(([dy, sw], i) => frame(i, 0, { dy, sh: -dy, sw }));
    ['open', 'half', 'closed'].forEach((eye, i) => frame(i, 1, { eye }));
    [[0, 'walkA'], [-1, 'stand'], [-2, 'walkB'], [-1, 'stand'], [0, 'walkA'], [-1, 'walkB']].forEach(([dy, ft], i) => frame(i, 2, { dy, ft, look: 2 }));
    [['open', 0], ['small', -1], ['open', -1], ['small', 0]].forEach(([m, dy], i) => frame(i, 3, { dy, mouth: m }));
    [0, -3, -6, -6, -3, 0].forEach((dy, i) => {
      const b = frame(i, 4, { dy, fdy: dy, eye: 'closed', mouth: 'smile' });
      arm(b.cx - b.rw - 3, b.cy - 12, 4, 8);
      arm(b.cx + b.rw, b.cy - 12, 4, 8);
      if (i >= 2 && i <= 4) { put(6 + i, 8, 'y'); put(40 - i, 10, 'y'); put(8, 20 - i, 'y'); }
    });
    [0, -4, 0, -4].forEach((ay, i) => {
      const b = frame(i, 5, { mouth: 'smile' });
      arm(b.cx + b.rw, b.cy - 10 + ay, 4, 9);
    });
    [3, 6, 9].forEach((ln, i) => {
      const b = frame(i, 6, { look: 2, mouth: 'small' });
      arm(b.cx + b.rw - 2, b.cy - 2, ln + 2, 4);
    });
    [0, 1, 2, 3].forEach((i) => {
      const b = frame(i, 7, { look: -1, mouth: 'small' });
      arm(b.cx + 2, b.cy + 2, 4, 4);
      for (let k = 0; k < Math.min(3, i); k++) rect(32 + k * 4, 4, 2, 2, 'z');
    });
    [['spread', 0], ['walkA', 1], ['spread', 0], ['walkB', -1]].forEach(([ft, dx], i) => {
      const b = frame(i, 8, { dx, dy: -2, eye: 'big', mouth: 'o', ft, fdy: -1 });
      arm(b.cx - b.rw - 2, b.cy - 16, 4, 8);
      arm(b.cx + b.rw - 2, b.cy - 16, 4, 8);
    });
    [0, -2].forEach((ay, i) => {
      const b = frame(i, 9, { eye: 'big', mouth: 'o', ft: 'spread' });
      arm(b.cx - b.rw - 3, b.cy - 15 + ay, 4, 9);
      arm(b.cx + b.rw - 1, b.cy - 15 + ay, 4, 9);
    });
    [[4, -5], [-2, 2], [0, 0]].forEach(([sw, sh], i) => frame(i, 10, { sw, sh, eye: i === 0 ? 'closed' : 'open' }));
    [0, 1, 2, 3].forEach((i) => {
      frame(i, 11, { dy: 2, sh: -2, sw: i % 2, eye: 'closed' });
      if (i >= 1) { rect(34, 9, 4, 1, 'z'); put(36, 10, 'z'); put(35, 11, 'z'); rect(34, 12, 4, 1, 'z'); }
      if (i >= 2) { rect(40, 3, 3, 1, 'z'); put(41, 4, 'z'); rect(40, 5, 3, 1, 'z'); }
    });
    [0, 1].forEach((i) => {
      frame(i, 12, { dy: -i, eye: 'big', mouth: 'o' });
      rect(37, 2, 2, 6, 'x');
      rect(37, 9, 2, 2, 'x');
    });
    ['dangle1', 'dangle2'].forEach((ft, i) => {
      ox = i * C;
      oy = 13 * C;
      feet(ft, 0);
      const b = body(0, -2, 0, -1);
      eyes(b.cx, b.cy - 6, 'open', 0);
      mouth(b.cx, b.cy + 1, 'smile');
    });
    return { id: '_fallback', name: '기본 도우미', desc: '캐릭터 파일이 없을 때 나와요', cell: 48, anchor: { x: 24, y: 46 }, accent: '#e0762e', sheet: cv, anims: STD_ANIMS };
  }

  // ── 최소 설명 (guide-content.js가 없을 때) ────────────────
  const MIN_GUIDE = {
    greeting: ['안녕하세요! 화면 도우미예요.', '메뉴에 마우스를 올리면 알려 드려요.'],
    tour: [
      { target: 'dashboard', text: '대시보드예요. 위젯으로 현황을 봐요.' },
      { target: 'widget:PROCESS_FLOW', text: '단계별 건수를 한눈에 봐요.' },
      { target: 'topbar:search', text: '수주·LOT·출하요청 번호로 찾아요.' },
    ],
    targets: {
      dashboard: { title: '대시보드', short: '위젯으로 현황을 한눈에 봐요.', lines: [] },
      'widget:PROCESS_FLOW': { title: '공정 흐름 현황', short: '수주부터 출고까지 단계별 건수예요.', lines: [] },
      'topbar:search': { title: '통합 검색', short: '수주·LOT·출하요청 번호로 찾아요.', lines: [] },
    },
    faq: [],
    idle: ['궁금하면 저를 눌러 주세요.', '메뉴에 마우스를 올려 보세요.', '저를 끌어서 옮길 수 있어요.'],
    reactions: {
      drag: ['으앗!', '어디로 가요?'],
      drop: ['착지!', '여기 좋네요.'],
      poke: ['간지러워요!', '왜 불렀어요?'],
      hide: ['필요하면 불러 주세요!'],
      show: ['다시 왔어요!'],
      sleep: ['조금만 쉴게요… zZ'],
      wake: ['앗, 깼어요!'],
      swap: ['새 모습이에요!'],
      climb: ['영차, 영차!', '한 칸씩 올라가요.'],
      jump: ['폴짝!', '건너가요~'],
    },
  };
  // 펫 사용법 질문 (설명 파일과 상관없이 늘 답한다)
  const PET_FAQ = [
    { q: '펫은 어떻게 옮겨요?', keywords: ['옮기', '옮겨', '끌어', '드래그', '이동'], a: '저를 꾹 눌러 끌어서 놓으면 돼요. 놓은 자리를 기억해요.', pet: true },
    { q: '펫을 숨기려면요?', keywords: ['숨기', '숨겨', '사라', '끄기', '안보이'], a: '저를 우클릭해서 숨기기를 누르거나 Shift+P를 눌러요.', pet: true },
    { q: '캐릭터를 바꿀 수 있어요?', keywords: ['캐릭터', '바꾸', '모습', '펫바꾸'], a: '우클릭 메뉴의 캐릭터 바꾸기에서 골라요.', pet: true },
  ];

  function buildGuide(g) {
    const real = isObj(g);
    const src = real ? g : MIN_GUIDE;
    const reactions = {};
    for (const k of Object.keys(MIN_GUIDE.reactions)) {
      const mine = real && isObj(g.reactions) ? arr(g.reactions[k]).filter((s) => typeof s === 'string' && s) : [];
      reactions[k] = mine.length ? mine : MIN_GUIDE.reactions[k];
    }
    const faq = arr(src.faq).filter((f) => isObj(f) && f.q && f.a);
    const seenQ = new Set(faq.map((f) => f.q));
    return {
      real,
      greeting: arr(src.greeting).filter(Boolean).length ? arr(src.greeting).filter(Boolean) : MIN_GUIDE.greeting,
      tour: arr(src.tour).filter((s) => isObj(s) && s.target && s.text),
      targets: isObj(src.targets) ? src.targets : {},
      faq: faq.concat(PET_FAQ.filter((f) => !seenQ.has(f.q))),
      idle: arr(src.idle).filter(Boolean).length ? arr(src.idle).filter(Boolean) : MIN_GUIDE.idle,
      reactions,
      screens: buildScreens(src.screens),
      glossary: buildGlossary(src.glossary),
      items: isObj(src.items) ? src.items : {},
    };
  }

  // ── 용어집 (glossary) ─────────────────────────────────
  // 화면 글자와 용어집 키는 띄어쓰기·대소문자·정렬 표시가 달라도 같은 말로 본다
  const normTerm = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[\s▲▼△▽↑↓⇅↕*:：]/g, '');
  // '중량(t)' '매수 (매)'처럼 끝에 붙은 단위·괄호는 떼고도 한 번 더 찾는다
  // '안 읽음 0' '업무방 3'처럼 끝에 붙은 건수도 뗀다
  // 단계 표시의 진행 숫자('제강 1/1', '히트 편성 · 1히트')도 뗀다
  const bareTerm = (s) =>
    String(s || '')
      .replace(/\s*[(（][^()（）]*[)）]\s*$/, '')
      .replace(/\s*·\s*[\d,]+\s*\S*$/, '')
      .replace(/\s+[\d,]+\s*\/\s*[\d,]+$/, '')
      .replace(/\s+[\d,]+\s*(건|개|매|명)?$/, '');
  /** { <범위 키>: { 용어: 설명 } } → { <범위 키>: Map(정규화한 용어 → { term, text }) } */
  function buildGlossary(v) {
    const out = {};
    if (!isObj(v)) return out;
    for (const scope of Object.keys(v)) {
      const src = v[scope];
      if (!isObj(src)) continue;
      const m = new Map();
      const entries = [];
      for (const term of Object.keys(src)) {
        const raw = src[term];
        const text = typeof raw === 'string' ? raw : isObj(raw) && typeof raw.text === 'string' ? raw.text : '';
        if (term.trim() && text.trim()) entries.push({ term: term.trim(), text });
      }
      // 원문 그대로 맞는 것을 먼저 넣고, 괄호를 뗀 이름은 비어 있을 때만 넣는다
      for (const e of entries) m.set(normTerm(e.term), e);
      for (const e of entries) {
        const b = normTerm(bareTerm(e.term));
        if (b && !m.has(b)) m.set(b, e);
      }
      if (m.size) out[scope.trim()] = m;
    }
    return out;
  }

  // ── 레코드 번호 (코드 모양 글자) ───────────────────────
  // LOT형(HM-BF2-260918-01) · 채번형(SO-2609-003, PP-2609-0004) · 그 밖의 대문자-숫자 묶음. 여러 개가 맞으면 가장 긴 것
  const CODE_RES = ['[A-Z]{2,3}-[A-Z0-9]{2,5}-\\d{6}-\\d{2,3}', '[A-Z]{2,4}-\\d{4}-\\d{3,4}', '[A-Z]{2,}-[0-9A-Z-]{4,}'].map((s) => new RegExp(`(?:^|[^A-Za-z0-9-])(${s})(?![A-Za-z0-9])`));
  function codeIn(text) {
    const s = String(text || '');
    let best = '';
    for (const re of CODE_RES) {
      const m = re.exec(s);
      if (!m) continue;
      const c = m[1].replace(/-+$/, '');
      if (/\d/.test(c) && c.length > best.length) best = c;
    }
    return best;
  }
  /** 화면별 안내 { <SCREEN 키>: { intro: string | string[], tour: [{ target, text }] } }. 쓸 내용이 없는 항목은 버린다 */
  function buildScreens(v) {
    const out = {};
    if (!isObj(v)) return out;
    const text = (s) => typeof s === 'string' && s.trim() !== '';
    for (const key of Object.keys(v)) {
      const sc = v[key];
      if (!key || !isObj(sc)) continue;
      const intro = (typeof sc.intro === 'string' ? [sc.intro] : arr(sc.intro)).filter(text);
      const tour = arr(sc.tour).filter((st) => isObj(st) && text(st.target) && text(st.text));
      if (!intro.length && !tour.length) continue;
      out[key] = { intro, tour };
    }
    return out;
  }

  // ── 캐릭터 팩 ─────────────────────────────────────────
  function normalizePack(p) {
    if (!isObj(p) || !p.id || !p.sheet || !isObj(p.anims) || !isObj(p.anims.idle)) return null;
    const cell = Number(p.cell) > 0 ? Number(p.cell) : 48;
    const anchor = isObj(p.anchor) && Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y) ? { x: p.anchor.x, y: p.anchor.y } : { x: cell / 2, y: cell - 2 };
    const anims = {};
    for (const name of Object.keys(p.anims)) {
      const a = p.anims[name];
      if (!isObj(a) || !Number.isFinite(Number(a.row))) continue;
      anims[name] = { row: Number(a.row), frames: Math.max(1, Number(a.frames) | 0), ms: a.ms, loop: !!a.loop };
    }
    if (!anims.idle) return null;
    return { id: String(p.id), name: String(p.name || p.id), desc: String(p.desc || ''), cell, anchor, accent: p.accent || '#e07028', sheet: p.sheet, anims, _img: null, _bbox: null, _broken: false, _loading: null };
  }

  function collectPacks(list) {
    const out = [];
    const seen = new Set();
    for (const raw of arr(list)) {
      const p = normalizePack(raw);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }

  function measureBBox(p) {
    const c = p.cell;
    const a = p.anchor;
    const fallback = { top: a.y - 40, left: a.x - 16, right: a.x + 16, bottom: a.y };
    try {
      const def = p.anims.idle;
      const w = c * def.frames;
      const cv = doc.createElement('canvas');
      cv.width = w;
      cv.height = c;
      const g = cv.getContext('2d');
      g.drawImage(p._img, 0, def.row * c, w, c, 0, 0, w, c);
      const data = g.getImageData(0, 0, w, c).data;
      let top = c;
      let left = c;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < c; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] === 0) continue;
          const lx = x % c;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (lx < left) left = lx;
          if (lx > right) right = lx;
        }
      }
      if (right < 0) return fallback;
      return { top, left, right: right + 1, bottom: bottom + 1 };
    } catch (e) {
      return fallback;
    }
  }

  function loadPack(p) {
    if (p._loading) return p._loading;
    p._loading = new Promise((resolve) => {
      const done = (img) => {
        p._img = img;
        p._bbox = measureBBox(p);
        resolve(p);
      };
      const s = p.sheet;
      if (s && typeof s === 'object' && (typeof s.getContext === 'function' || s.naturalWidth !== undefined)) {
        done(s);
        return;
      }
      const img = new Image();
      img.onload = () => done(img);
      img.onerror = () => {
        p._broken = true;
        resolve(p);
      };
      img.src = String(s);
    });
    return p._loading;
  }

  /** 스프라이트 시트에서 한 동작을 재생한다 (캔버스 한 장 = 셀 1칸) */
  class Player {
    constructor(canvas) {
      this.cv = canvas;
      this.g = canvas.getContext('2d');
      this.pack = null;
      this.name = 'idle';
      this.frame = 0;
      this.t = 0;
      this.done = false;
      this.onDone = null;
      this.speed = 1;
      this.hold = -1;
      this.drawn = '';
    }
    setPack(p) {
      this.pack = p;
      this.cv.width = p.cell;
      this.cv.height = p.cell;
      this.drawn = '';
      this.set('idle', true);
    }
    resolve(name) {
      const a = this.pack ? this.pack.anims : {};
      let n = name;
      for (let i = 0; i < 6 && !a[n]; i++) n = ANIM_FALLBACK[n] || 'idle';
      return a[n] ? n : 'idle';
    }
    set(name, restart, onDone) {
      if (!this.pack) return;
      const n = this.resolve(name);
      if (n === this.name && !restart && !this.done && this.hold < 0) {
        if (onDone) this.onDone = onDone;
        return;
      }
      this.name = n;
      this.frame = 0;
      this.t = 0;
      this.done = false;
      this.hold = -1;
      this.onDone = onDone || null;
    }
    holdFrame(name, f) {
      this.set(name, true);
      this.frame = Math.min(f, this.def().frames - 1);
      this.hold = this.frame;
    }
    def() {
      return this.pack.anims[this.name];
    }
    dur(i) {
      const d = this.def();
      const raw = Array.isArray(d.ms) ? (d.ms[i] !== undefined ? d.ms[i] : d.ms[d.ms.length - 1]) : d.ms;
      return Math.max(16, Number(raw) || 120) / this.speed;
    }
    update(dtMs) {
      if (!this.pack || this.done || this.hold >= 0) return;
      const d = this.def();
      this.t += dtMs;
      for (let guard = 0; guard < 12 && this.t >= this.dur(this.frame); guard++) {
        this.t -= this.dur(this.frame);
        if (this.frame < d.frames - 1) this.frame++;
        else if (d.loop) this.frame = 0;
        else {
          this.done = true;
          this.t = 0;
          const cb = this.onDone;
          this.onDone = null;
          if (cb) cb();
          break;
        }
      }
    }
    draw() {
      const p = this.pack;
      if (!p || !p._img) return;
      const d = p.anims[this.name];
      const key = `${p.id}:${d.row}:${this.frame}`;
      if (key === this.drawn) return;
      this.drawn = key;
      const c = p.cell;
      this.g.clearRect(0, 0, c, c);
      try {
        this.g.drawImage(p._img, this.frame * c, d.row * c, c, c, 0, 0, c, c);
      } catch (e) {
        /* 시트를 못 그리면 빈 칸으로 둔다 */
      }
    }
  }

  function drawStill(canvas, pack, name, frame) {
    canvas.width = pack.cell;
    canvas.height = pack.cell;
    const p = new Player(canvas);
    p.setPack(pack);
    p.set(name || 'idle', true);
    p.frame = Math.min(frame || 0, p.def().frames - 1);
    p.draw();
  }

  // ── 사다리 소품 (pet/props/ladder.js 가 없으면 엔진이 단순한 사다리를 그린다) ──
  function buildFallbackLadder() {
    const cv = doc.createElement('canvas');
    cv.width = 10;
    cv.height = 18;
    const g = cv.getContext('2d');
    const px = (x, y, w, hh, c) => {
      g.fillStyle = c;
      g.fillRect(x, y, w, hh);
    };
    const rails = (y0, y1) => {
      px(0, y0, 2, y1 - y0, '#2a3848');
      px(8, y0, 2, y1 - y0, '#2a3848');
      px(1, y0, 1, y1 - y0, '#8ea2b8');
      px(9, y0, 1, y1 - y0, '#5d7088');
    };
    // 맨 위(0~7): 위 면에 거는 고리, hookY=3
    px(0, 1, 10, 3, '#2a3848');
    px(1, 1, 8, 1, '#a9bccf');
    rails(3, 8);
    // 가운데(8~13): 발판 1개
    rails(8, 14);
    px(2, 10, 6, 1, '#ffe08a');
    px(2, 11, 6, 1, '#f2a32b');
    px(2, 12, 6, 1, '#9c5a14');
    // 맨 아래(14~17): 받침
    rails(14, 17);
    px(0, 16, 3, 2, '#1d2734');
    px(7, 16, 3, 2, '#1d2734');
    return { width: 10, sheet: cv, img: cv, top: { x: 0, y: 0, w: 10, h: 8 }, hookY: 3, mid: { x: 0, y: 8, w: 10, h: 6 }, bottom: { x: 0, y: 14, w: 10, h: 4 } };
  }
  function normalizeLadder(p) {
    if (!isObj(p) || !p.sheet || !isObj(p.mid)) return null;
    const width = Number(p.width) > 0 ? Number(p.width) : 10;
    const tile = (t) => (isObj(t) && Number(t.h) > 0 ? { x: Number(t.x) || 0, y: Number(t.y) || 0, w: Number(t.w) > 0 ? Number(t.w) : width, h: Number(t.h) } : null);
    const mid = tile(p.mid);
    if (!mid) return null;
    return { width, sheet: p.sheet, img: null, top: tile(p.top), hookY: Number.isFinite(Number(p.hookY)) ? Number(p.hookY) : 0, mid, bottom: tile(p.bottom) };
  }
  function loadLadder(p) {
    return new Promise((resolve) => {
      const s = p.sheet;
      if (s && typeof s === 'object' && (typeof s.getContext === 'function' || s.naturalWidth !== undefined)) {
        p.img = s;
        resolve(true);
        return;
      }
      const img = new Image();
      img.onload = () => {
        p.img = img;
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = String(s);
    });
  }

  // ── 스타일 ────────────────────────────────────────────
  const CSS = `
.fp-root{position:fixed;inset:0;pointer-events:none;font-family:var(--fp-font,'IBM Plex Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif);font-size:13px;line-height:1.45;color:var(--fp-ink);-webkit-font-smoothing:antialiased;text-align:left;
--fp-ink:var(--color-ink,#121820);--fp-ink-2:var(--color-ink-2,#3f4a57);--fp-ink-3:var(--color-ink-3,#5e6977);--fp-surface:var(--color-surface,#fff);--fp-surface-2:var(--color-surface-2,#f7f8fa);--fp-surface-3:var(--color-surface-3,#eef1f4);--fp-line:var(--color-line,#dde2e7);--fp-line-strong:var(--color-line-strong,#c3cbd4);--fp-brand:var(--color-brand,#173a5e);--fp-brand-hover:var(--color-brand-hover,#0f2b47);--fp-brand-tint:var(--color-brand-tint,#e7eef5);--fp-run:var(--color-run,#1f5fcc);--fp-ok:var(--color-ok,#17794a);--fp-ok-bg:var(--color-ok-bg,#e4f3ea);
--fp-accent:#e07028;--fp-accent-ink:#9a4a17;--fp-accent-soft:#fbe9dc;--fp-accent-shadow:#f2c09c}
.fp-root *,.fp-root *::before,.fp-root *::after{box-sizing:border-box}
.fp-root button,.fp-root input{font:inherit;color:inherit;margin:0;letter-spacing:normal}
.fp-root :focus-visible{outline:2px solid var(--fp-run);outline-offset:2px}
.fp-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.fp-ic{width:14px;height:14px;flex:none;display:block}
.fp-pet{position:absolute;left:0;top:0;z-index:3;will-change:transform}
.fp-sprite{position:absolute;left:0;top:0;pointer-events:none}
.fp-canvas{display:block;image-rendering:crisp-edges;image-rendering:pixelated}
.fp-hit{position:absolute;pointer-events:auto;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;border-radius:38%;outline:none}
.fp-hit:focus-visible{outline:none;box-shadow:0 0 0 2px #fff,0 0 0 4px var(--fp-run)}
.fp-root.fp-dragging .fp-hit{cursor:grabbing}
.fp-root.fp-mouse .fp-hit:focus-visible{box-shadow:none}
.fp-root.fp-mouse .fp-card:focus-visible,.fp-root.fp-mouse .fp-pill:focus-visible,.fp-root.fp-mouse .fp-x:focus-visible,.fp-root.fp-mouse .fp-btn:focus-visible{outline:none}
.fp-shadow{position:absolute;left:0;top:0;z-index:2;border-radius:50%;background:rgba(18,24,32,.2);will-change:transform,opacity}
.fp-beam{position:absolute;left:0;top:0;z-index:3;pointer-events:none;transform-origin:0 50%;background:linear-gradient(to bottom,#2c3646 0 var(--fl),#a7b6c8 var(--fl) calc(var(--fl) + 1px),#cfd9e4 calc(var(--fl) + 1px) calc(100% - var(--fl) - 1px),#7e8fa6 calc(100% - var(--fl) - 1px) calc(100% - var(--fl)),#2c3646 calc(100% - var(--fl)) 100%)}
.fp-beam::before{content:'';position:absolute;left:0;right:0;top:var(--fl);bottom:var(--fl);background:repeating-linear-gradient(to right,transparent 0 calc(var(--st) - 2px),#5d6d84 calc(var(--st) - 2px) var(--st))}
.fp-beam-cap{position:absolute;right:calc(var(--fl) * -1);top:50%;width:calc(var(--fl) * 3);height:calc(100% + var(--fl) * 2);transform:translateY(-50%);background:linear-gradient(to right,#ffcc33 0 34%,#2c3646 34% 66%,#ffcc33 66%);box-shadow:0 0 0 1px #2c3646}
.fp-flash{position:absolute;z-index:1;border:2px solid var(--fp-accent);border-radius:8px;box-shadow:0 0 0 4px var(--fp-accent-soft),0 0 18px 2px var(--fp-accent-shadow);animation:fp-flash .6s ease-in-out 3}
.fp-flash--steady{animation:fp-flash 1.8s ease-in-out infinite}
@keyframes fp-flash{0%,100%{opacity:1}50%{opacity:.4}}
.fp-puff{position:absolute;z-index:3;background:#fff;border:2px solid #b9c3ce;border-radius:2px}
.fp-ladder{position:absolute;left:0;top:0;z-index:2;pointer-events:none;will-change:transform}
.fp-ladder canvas{display:block;width:100%;height:100%;image-rendering:crisp-edges;image-rendering:pixelated}
.fp-spark{position:absolute;z-index:3;width:4px;height:4px;background:#ffd34d;box-shadow:0 0 0 1px #c47a12}
.fp-bubble{position:absolute;left:0;top:0;z-index:4;display:none;pointer-events:auto;width:max-content;max-width:min(252px,calc(100vw - 16px));min-width:92px;padding:8px 12px 9px;background:var(--fp-surface);color:var(--fp-ink);border:2px solid var(--fp-accent);border-radius:10px;box-shadow:3px 3px 0 var(--fp-accent-shadow);font-size:13px;line-height:19px;cursor:default}
.fp-bubble::before,.fp-bubble::after{content:'';position:absolute;width:0;height:0;border-style:solid}
.fp-bubble[data-side=top]::before{left:calc(var(--fp-tail-x,50%) - 8px);bottom:-11px;border-width:10px 8px 0;border-color:var(--fp-accent) transparent transparent}
.fp-bubble[data-side=top]::after{left:calc(var(--fp-tail-x,50%) - 5px);bottom:-6px;border-width:7px 5px 0;border-color:var(--fp-surface) transparent transparent}
.fp-bubble[data-side=left]::before{right:-11px;top:var(--fp-tail-y,14px);border-width:8px 0 8px 10px;border-color:transparent transparent transparent var(--fp-accent)}
.fp-bubble[data-side=left]::after{right:-6px;top:calc(var(--fp-tail-y,14px) + 3px);border-width:5px 0 5px 7px;border-color:transparent transparent transparent var(--fp-surface)}
.fp-bubble[data-side=right]::before{left:-11px;top:var(--fp-tail-y,14px);border-width:8px 10px 8px 0;border-color:transparent var(--fp-accent) transparent transparent}
.fp-bubble[data-side=right]::after{left:-6px;top:calc(var(--fp-tail-y,14px) + 3px);border-width:5px 7px 5px 0;border-color:transparent var(--fp-surface) transparent transparent}
.fp-b-head{display:flex;align-items:center;gap:6px;margin:0 0 2px;min-width:0}
.fp-b-title{font-size:12px;font-weight:700;color:var(--fp-accent-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-b-tag{flex:none;font-size:10.5px;line-height:15px;font-weight:600;padding:0 5px;border-radius:3px;background:var(--fp-surface-3);color:var(--fp-ink-3)}
.fp-b-step{flex:none;margin-left:auto;padding-left:10px;font-size:11px;color:var(--fp-ink-3);font-variant-numeric:tabular-nums}
.fp-b-text{position:relative;margin:0;word-break:keep-all;overflow-wrap:anywhere}
.fp-b-ghost{visibility:hidden}
.fp-b-typed{position:absolute;left:0;top:0;right:0}
.fp-bubble--data{max-width:min(300px,calc(100vw - 16px))}
.fp-b-fields{display:grid;grid-template-columns:auto minmax(0,1fr);gap:1px 8px;margin:3px 0 4px;font-size:12px;line-height:17px}
.fp-b-fields dt{margin:0;color:var(--fp-ink-3);white-space:nowrap}
.fp-b-fields dd{margin:0;color:var(--fp-ink);font-weight:600;word-break:keep-all;overflow-wrap:anywhere}
.fp-msg .fp-b-fields{margin:6px 0 0}
.fp-b-note{margin-top:5px;font-family:var(--fp-mono,'IBM Plex Mono',ui-monospace,monospace);font-size:10.5px;line-height:14px;color:var(--fp-ink-3)}
.fp-b-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-top:8px}
.fp-bubble--x .fp-b-head,.fp-bubble--x .fp-b-text:first-child{padding-right:20px}
.fp-b-x{position:absolute;top:4px;right:4px;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--fp-ink-3);font-size:17px;line-height:1;cursor:pointer}
.fp-b-x:hover{background:var(--fp-surface-3);color:var(--fp-ink)}
.fp-root.fp-mouse .fp-b-x:focus-visible{outline:none}
.fp-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;padding:0 10px;border:1px solid var(--fp-line-strong);border-radius:4px;background:var(--fp-surface);color:var(--fp-ink);font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer}
.fp-btn:hover{background:var(--fp-surface-2);border-color:#a9b3be}
.fp-btn--primary,.fp-btn--primary:hover{background:var(--fp-accent-ink);border-color:var(--fp-accent-ink);color:#fff}
.fp-btn--primary:hover{filter:brightness(1.1)}
.fp-x{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:4px;background:transparent;color:var(--fp-ink-3);font-size:18px;line-height:1;cursor:pointer}
.fp-x:hover{background:var(--fp-surface-3);color:var(--fp-ink)}
.fp-hint{position:absolute;left:0;top:0;z-index:4;display:none;padding:4px 9px;border-radius:4px;background:var(--fp-ink);color:#fff;font-size:11.5px;line-height:16px;font-weight:600;white-space:nowrap;box-shadow:2px 2px 0 rgba(18,24,32,.18)}
.fp-hint::after{content:'';position:absolute;top:50%;margin-top:-5px;border:5px solid transparent}
.fp-hint[data-side=left]::after{right:-10px;border-left-color:var(--fp-ink)}
.fp-hint[data-side=right]::after{left:-10px;border-right-color:var(--fp-ink)}
.fp-chat{position:absolute;left:0;top:0;z-index:5;pointer-events:auto;width:300px;max-height:calc(100vh - 16px);display:flex;flex-direction:column;background:var(--fp-surface);border:2px solid var(--fp-ink);border-radius:8px;box-shadow:4px 4px 0 rgba(18,24,32,.16),0 12px 32px rgba(18,24,32,.14);overflow:hidden}
.fp-chat-head{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 8px;background:var(--fp-surface-2);border-bottom:2px solid var(--fp-line)}
.fp-chat-ava{flex:none;width:34px;height:34px;border-radius:6px;background:var(--fp-accent-soft);overflow:hidden;position:relative}
.fp-chat-ava canvas{position:absolute;image-rendering:pixelated}
.fp-chat-who{display:flex;flex-direction:column;min-width:0;flex:1;line-height:16px}
.fp-chat-who b{font-size:13px;font-weight:700}
.fp-chat-who small{font-size:11px;color:var(--fp-ink-3)}
.fp-chat-log{flex:1 1 auto;min-height:96px;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;overscroll-behavior:contain}
.fp-msg{max-width:88%;padding:7px 10px;border-radius:8px;font-size:13px;line-height:19px;word-break:keep-all;overflow-wrap:anywhere}
.fp-msg--pet{align-self:flex-start;background:var(--fp-surface-2);border:1px solid var(--fp-line);border-bottom-left-radius:2px}
.fp-msg--me{align-self:flex-end;background:var(--fp-brand-tint);color:var(--fp-brand);border-bottom-right-radius:2px}
.fp-msg--typing{color:var(--fp-ink-3);letter-spacing:2px}
.fp-msg-act{display:inline-flex;align-items:center;gap:4px;margin-top:6px;height:26px;padding:0 10px;border:1px solid var(--fp-accent);border-radius:4px;background:var(--fp-surface);color:var(--fp-accent-ink);font-size:12px;font-weight:700;cursor:pointer}
.fp-msg-act:hover{background:var(--fp-accent-soft)}
.fp-msg-act+.fp-msg-act{margin-left:6px}
.fp-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 10px 8px}
.fp-chips-label{width:100%;font-size:11px;color:var(--fp-ink-3)}
.fp-chip{height:26px;max-width:100%;padding:0 10px;border:1px solid var(--fp-line-strong);border-radius:13px;background:var(--fp-surface);color:var(--fp-ink-2);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.fp-chip:hover{border-color:var(--fp-accent);color:var(--fp-accent-ink)}
.fp-chat-form{display:flex;gap:6px;padding:8px 10px;border-top:1px solid var(--fp-line)}
.fp-chat-form input{flex:1;min-width:0;height:32px;padding:0 10px;border:1px solid var(--fp-line-strong);border-radius:4px;background:var(--fp-surface-2);font-size:13px;outline:none}
.fp-chat-form input:focus{border-color:var(--fp-run);box-shadow:0 0 0 2px rgba(31,95,204,.14);background:var(--fp-surface)}
.fp-chat-form input::placeholder{color:var(--fp-ink-3)}
.fp-send{flex:none;height:32px;padding:0 12px;border:1px solid var(--fp-brand);border-radius:4px;background:var(--fp-brand);color:#fff;font-size:13px;font-weight:600;cursor:pointer}
.fp-send:hover{background:var(--fp-brand-hover)}
.fp-chat-foot{display:flex;align-items:center;gap:6px;padding:5px 10px 6px;background:var(--fp-surface-2);border-top:1px solid var(--fp-line);font-size:11px;color:var(--fp-ink-3)}
.fp-chat-foot i{width:6px;height:6px;flex:none;background:var(--fp-line-strong)}
.fp-menu{position:absolute;left:0;top:0;z-index:6;pointer-events:auto;width:228px;padding:4px;background:var(--fp-surface);border:2px solid var(--fp-ink);border-radius:6px;box-shadow:4px 4px 0 rgba(18,24,32,.18),0 10px 28px rgba(18,24,32,.12)}
.fp-menu-head{display:flex;align-items:center;gap:8px;padding:4px 6px 8px;margin-bottom:4px;border-bottom:2px dotted var(--fp-line-strong)}
.fp-menu-ava{flex:none;width:28px;height:28px;border-radius:5px;background:var(--fp-accent-soft);overflow:hidden;position:relative}
.fp-menu-ava canvas{position:absolute;image-rendering:pixelated}
.fp-menu-head b{font-size:13px;font-weight:700;line-height:16px}
.fp-menu-head small{display:block;font-size:11px;line-height:14px;color:var(--fp-ink-3)}
.fp-mi{display:flex;align-items:center;gap:9px;width:100%;min-height:32px;padding:0 8px;border:0;border-radius:4px;background:transparent;font-size:13px;color:var(--fp-ink);text-align:left;cursor:pointer}
.fp-mi:hover,.fp-mi:focus-visible{background:var(--fp-brand-tint);outline:none}
.fp-mi .fp-ic{color:var(--fp-accent-ink)}
.fp-mi-sub{display:block;font-size:10.5px;line-height:13px;color:var(--fp-ink-3)}
.fp-mi-text{display:flex;flex-direction:column;min-width:0;padding:5px 0}
.fp-state{margin-left:auto;flex:none;font-size:11px;font-weight:700;line-height:18px;padding:0 6px;border-radius:3px;background:var(--fp-surface-3);color:var(--fp-ink-3)}
.fp-state[data-on=true]{background:var(--fp-ok-bg);color:var(--fp-ok)}
.fp-kbd{margin-left:auto;flex:none;font-family:var(--fp-mono,'IBM Plex Mono',ui-monospace,monospace);font-size:10.5px;line-height:16px;padding:0 4px;border:1px solid var(--fp-line-strong);border-bottom-width:2px;border-radius:3px;color:var(--fp-ink-3);background:var(--fp-surface)}
.fp-menu-row{display:flex;align-items:center;gap:9px;min-height:34px;padding:0 8px;font-size:13px}
.fp-menu-row .fp-ic{color:var(--fp-accent-ink)}
.fp-seg{margin-left:auto;display:flex;border:1px solid var(--fp-line-strong);border-radius:4px;overflow:hidden}
.fp-seg button{height:24px;padding:0 7px;border:0;border-left:1px solid var(--fp-line-strong);background:var(--fp-surface);font-size:11.5px;color:var(--fp-ink-2);cursor:pointer}
.fp-seg button:first-child{border-left:0}
.fp-seg button[aria-pressed=true]{background:var(--fp-ink);color:#fff;font-weight:600}
.fp-menu-sep{height:0;margin:4px 6px;border-top:2px dotted var(--fp-line-strong)}
.fp-backdrop{position:absolute;inset:0;z-index:7;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(18,24,32,.34)}
.fp-modal{width:min(760px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--fp-surface);border-radius:12px;box-shadow:0 24px 64px rgba(18,24,32,.28);padding:20px 22px 24px}
.fp-modal-head{display:flex;align-items:center;gap:10px}
.fp-modal-head h2{margin:0;font-size:17px;line-height:24px;font-weight:600}
.fp-modal-head small{font-size:12px;color:var(--fp-ink-3)}
.fp-pill{margin-left:auto;height:32px;padding:0 14px;border:0;border-radius:8px;background:var(--fp-surface-3);color:var(--fp-ink);font-size:13px;font-weight:600;cursor:pointer}
.fp-pill:hover{background:#e3e8ed}
.fp-pill[aria-expanded=true]{background:var(--fp-ink);color:#fff}
.fp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:14px;margin-top:16px}
.fp-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;min-height:206px;padding:20px 14px 18px;border:1.5px solid var(--fp-line);border-radius:14px;background:var(--fp-surface);text-align:center;cursor:pointer;transition:border-color .12s,box-shadow .12s,transform .12s}
.fp-card:hover{border-color:var(--fp-line-strong);transform:translateY(-1px)}
.fp-card[aria-pressed=true]{border:2px solid var(--fp-card-accent,var(--fp-accent));box-shadow:0 0 0 4px var(--fp-card-soft,var(--fp-accent-soft))}
.fp-card-stage{position:relative;width:112px;height:112px;margin-bottom:6px}
.fp-card-stage canvas{position:absolute;left:0;top:0;image-rendering:pixelated}
.fp-card-shadow{position:absolute;left:50%;bottom:10px;width:46px;height:9px;margin-left:-23px;border-radius:50%;background:rgba(18,24,32,.14)}
.fp-card b{font-size:15px;font-weight:600;line-height:22px}
.fp-card span{font-size:12.5px;line-height:18px;color:var(--fp-ink-3);word-break:keep-all}
.fp-card .fp-card-badge{position:absolute;top:10px;right:10px;font-size:10.5px;font-weight:700;line-height:18px;padding:0 6px;border-radius:9px;background:var(--fp-card-accent,var(--fp-accent));color:#fff}
.fp-make{margin-top:16px;padding:14px 16px;border:2px dashed var(--fp-line-strong);border-radius:10px;background:var(--fp-surface-2);font-size:13px;line-height:20px}
.fp-make h3{margin:0 0 6px;font-size:14px;font-weight:700}
.fp-make ol{margin:0;padding-left:20px}
.fp-make code{font-family:var(--fp-mono,'IBM Plex Mono',ui-monospace,monospace);font-size:12px;padding:0 4px;border-radius:3px;background:var(--fp-surface-3)}
.fp-make p{margin:8px 0 0;color:var(--fp-ink-3);font-size:12px}
.fp-tab{position:absolute;right:0;z-index:3;display:none;pointer-events:auto;width:42px;height:50px;padding:0;border:2px solid var(--fp-accent);border-right:0;border-radius:12px 0 0 12px;background:var(--fp-surface);box-shadow:-3px 3px 0 var(--fp-accent-shadow);overflow:hidden;cursor:pointer;transition:width .16s ease}
.fp-tab:hover,.fp-tab:focus-visible{width:52px}
.fp-tab canvas{position:absolute;image-rendering:pixelated;transform:rotate(-10deg);pointer-events:none}
.fp-tab-tip{position:absolute;right:50px;z-index:4;display:none;padding:5px 10px;border:2px solid var(--fp-accent);border-radius:8px;background:var(--fp-surface);font-size:12px;line-height:17px;white-space:nowrap;box-shadow:2px 2px 0 var(--fp-accent-shadow)}
@media (prefers-reduced-motion:reduce){.fp-flash,.fp-flash--steady{animation:none}.fp-tab,.fp-card{transition:none}}
@media (max-width:480px){.fp-modal{padding:16px 14px 18px}.fp-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fp-card{min-height:184px;padding:14px 8px}.fp-card-stage{width:96px;height:96px}.fp-modal-head small{display:none}}
`;

  function injectStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    const st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    doc.head.appendChild(st);
  }

  // ── 펫 한 마리 ────────────────────────────────────────
  function createPet(options) {
    const o = Object.assign(
      {
        characters: null,
        guide: null,
        defaultCharacter: 'steelman',
        character: null,
        storageKey: 'fantapet',
        container: doc.body,
        firstVisit: true,
        hint: '끌어서 옮기기 · 우클릭 메뉴',
        zIndex: 2147482000,
        props: null,
        user: null, // { name, gradeName, departmentName, roleCode } — 인사·{name}{grade}{dept} 자리에 쓴다
        screen: null, // 지금 화면(SCREEN 키)
        navigate: null, // (href) => void — '이 화면으로 가기'. 없으면 링크를 누른다
        screenHrefs: null, // { <SCREEN 키>: 주소 } — 다른 화면의 카드를 물으면 그 화면으로 데려갈 때 쓴다
      },
      options || {},
    );
    const store = makeStore(o.storageKey);
    const reduced = typeof global.matchMedia === 'function' && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const packs = collectPacks(o.characters || global.FANTA_PET_CHARACTERS);
    if (!packs.length) packs.push(normalizePack(buildFallbackCharacter()));
    const guide = buildGuide(o.guide !== null && o.guide !== undefined ? o.guide : global.FANTA_PET_GUIDE);

    // ── 로그인 사원 ({name}·{grade}·{dept} 자리 채우기) ──
    const U = (() => {
      if (!isObj(o.user)) return null;
      const s = (v) => (typeof v === 'string' ? v.trim() : '');
      const u = { name: s(o.user.name), grade: s(o.user.gradeName || o.user.grade), dept: s(o.user.departmentName || o.user.dept) };
      return u.name || u.grade || u.dept ? u : null;
    })();
    const PH_ANY = /\{(?:name|grade|dept)\}/;
    /** 설명 문장의 {name}·{grade}·{dept}를 채운다. 사원 정보가 없으면 자리와 뒤에 붙은 '님'·조사를 함께 지워 문장이 어색하지 않게 한다 */
    function fill(text) {
      const str = String(text === null || text === undefined ? '' : text);
      if (!PH_ANY.test(str)) return str;
      // 값이 있는 자리는 채우고, 직급만 비었으면 '님'은 남긴다(김도윤님). 나머지 빈 자리는 뒤의 '님'·조사와 함께 지운다
      let out = U ? str.replace(/\{(name|grade|dept)\}/g, (m, k) => U[k] || (k === 'grade' ? '' : m)) : str;
      out = out.replace(/(?:\{(?:name|grade|dept)\}[ \t]*)+(?:님|에서|의|은|는|이|가|을|를|에)?[ \t]*[,，]?[ \t]*/g, '').replace(/[ \t]+([!?.,~])/g, '$1');
      if (U) out = out.replace(/[ \t]+님/g, '님');
      return out.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]*[,，][ \t]*/, '').trim();
    }
    /** 첫 인사 두 마디. 사원 정보가 있으면 첫 마디는 그 사람을 불러 인사한다 */
    function greetingLines() {
      const g = guide.greeting;
      const plain = g.filter((s) => !PH_ANY.test(s));
      if (U && U.name) {
        const mine = g.find((s) => /\{name\}/.test(s));
        const first = mine ? fill(mine) : `${U.name}${U.grade ? ` ${U.grade}` : ''}님, 반가워요!`;
        return [first, plain[0] || null].filter(Boolean);
      }
      return g.slice(0, 2).map(fill).filter(Boolean);
    }
    // 사다리: pet/props/ladder.js(FANTA_PET_PROPS.ladder)가 있으면 그 그림, 없거나 못 읽으면 엔진이 그린 단순한 사다리
    let ladderProp = buildFallbackLadder();
    const customLadder = normalizeLadder(isObj(o.props) ? o.props.ladder : isObj(global.FANTA_PET_PROPS) ? global.FANTA_PET_PROPS.ladder : null);
    if (customLadder) {
      loadLadder(customLadder).then((ok) => {
        if (ok) ladderProp = customLadder;
      });
    }

    const offs = [];
    const timers = new Set();
    const on = (target, type, fn, opt) => {
      target.addEventListener(type, fn, opt);
      offs.push(() => target.removeEventListener(type, fn, opt));
    };
    const later = (fn, ms) => {
      // 떼어 낸 뒤에 끝난 흐름이 타이머를 다시 걸지 않게
      if (S.destroyed) return 0;
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    };
    const cancel = (id) => {
      if (id) {
        clearTimeout(id);
        timers.delete(id);
      }
    };

    // DOM
    injectStyle();
    const root = h('div', { class: 'fp-root', 'data-fantapet': '' });
    root.style.zIndex = String(o.zIndex);
    const shadowEl = h('div', { class: 'fp-shadow' });
    const canvas = h('canvas', { class: 'fp-canvas', 'aria-hidden': 'true' });
    const spriteEl = h('div', { class: 'fp-sprite' }, canvas);
    const hit = h('div', { class: 'fp-hit', role: 'button', tabindex: '0', 'aria-haspopup': 'dialog' });
    const petEl = h('div', { class: 'fp-pet' }, spriteEl, hit);
    const bubbleEl = h('div', { class: 'fp-bubble', role: 'status', 'aria-live': 'polite' });
    const hintEl = h('div', { class: 'fp-hint', 'aria-hidden': 'true' });
    const tabCanvas = h('canvas', { 'aria-hidden': 'true' });
    const tabEl = h('button', { class: 'fp-tab', type: 'button', 'aria-label': '펫 다시 보기 (Shift+P)', title: '펫 다시 보기 (Shift+P)' }, tabCanvas);
    const tabTip = h('div', { class: 'fp-tab-tip', 'aria-hidden': 'true' });
    root.append(shadowEl, petEl, bubbleEl, hintEl, tabEl, tabTip);
    (o.container || doc.body).appendChild(root);

    const player = new Player(canvas);
    const tabPlayer = new Player(tabCanvas);

    const S = {
      pack: null,
      sizeKey: SIZES[store.get('size')] ? store.get('size') : 'normal',
      size: 96,
      scale: 2,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      mode: 'boot', // boot | ground | air | jump | drag | hidden
      surface: null, // { type: 'floor' } | { type: 'perch', el, off }
      facing: -1,
      base: 'idle', // 한 번 재생하는 동작이 끝나면 돌아갈 동작 (idle · sit · sleep)
      walk: null,
      jump: null,
      rot: 0,
      rotV: 0,
      squash: 0,
      dragVx: 0,
      prevX: 0,
      seq: 0,
      seqT: 0,
      restUntil: Infinity,
      lastInput: now(),
      lastSpeech: -1e9,
      nextBlink: now() + 3000,
      nextIdleTalk: now() + rand(55000, 90000),
      sleeping: false,
      roam: store.has('roam') ? !!store.get('roam') : !reduced,
      explain: store.has('explain') ? !!store.get('explain') : true,
      press: null,
      lastClickT: -1e9,
      clickTimer: 0,
      lastPokeT: -1e9,
      menu: null,
      menuOpenedT: -1e9,
      picker: null,
      tour: null,
      spot: null,
      lastExplain: { key: null, t: -1e9 },
      hoverEl: null,
      hoverTimer: 0,
      landWaiters: [],
      perchCheckT: 0,
      hintUntil: 0,
      raf: 0,
      lastTs: 0,
      destroyed: false,
      climb: null,
      passThrough: false,
      noHoverUntil: 0,
      flow: -1,
      lastMoveT: -1e9,
      hoverArmed: false,
      screen: typeof o.screen === 'string' && o.screen ? o.screen : null, // 지금 화면(SCREEN 키)
      pending: null, // 화면을 옮긴 뒤 한가해지면 할 안내 { key, since, nextCheck }
      afterNav: null, // 대화창에서 '그 화면으로 가기'로 옮긴 뒤 가리킬 카드 { key, screen, t0, seenAt, nextCheck }
      hoverCand: null, // 마우스가 머문 것 { el, kind: 'target' | 'item' | 'term', term }
      booting: false, // 첫 방문 등장·인사 중
    };
    S.size = SIZES[S.sizeKey];
    if (S.screen) S.pending = { key: S.screen, since: now(), nextCheck: 0 };

    // ── 기하 ──
    const W = () => global.innerWidth;
    const H = () => global.innerHeight;
    const bbox = () => (S.pack && S.pack._bbox) || { top: 6, left: 8, right: 40, bottom: 46 };
    const floorY = () => H() - FLOOR_GAP;
    function halfW() {
      const b = bbox();
      const a = S.pack.anchor;
      return Math.max(a.x - b.left, b.right - a.x) * S.scale;
    }
    function floorRange() {
      const hw = halfW() + 2;
      return [SIDE_GAP + hw, Math.max(SIDE_GAP + hw, W() - SIDE_GAP - hw)];
    }
    function minFootY() {
      return (S.pack.anchor.y - bbox().top) * S.scale + 4;
    }
    function drawOffsetY() {
      // 앉기 그림은 엉덩이(y≈40)가 면에 닿도록 셀을 아래로 내린다
      return player.name === 'sit' ? (S.pack.anchor.y - 40) * S.scale : 0;
    }
    function petBox() {
      const b = bbox();
      const a = S.pack.anchor;
      const s = S.scale;
      const oy = drawOffsetY();
      return { left: S.x + (b.left - a.x) * s, right: S.x + (b.right - a.x) * s, top: S.y + oy + (b.top - a.y) * s, bottom: S.y + oy + (b.bottom - a.y) * s };
    }

    // ── 한 프레임 동안 다시 쓰는 값 ──
    // 목록·상세 화면에는 perch(Card)가 수십 개라, 같은 프레임 안에서 요소 찾기·위치 읽기·가려짐 검사를 되풀이하지 않는다.
    // 프레임 밖(타이머 뒤 흐름)에서 불러도 12ms가 지나면 새로 읽는다.
    const FC = { t: -1e9, raw: null, l0: null, l1: null, obs: null, vis: new Map(), rects: new Map() };
    function freshCache() {
      const t = now();
      if (t - FC.t <= 12) return;
      FC.t = t;
      FC.raw = null;
      FC.l0 = null;
      FC.l1 = null;
      FC.obs = null;
      FC.vis.clear();
      FC.rects.clear();
    }
    function invalidateCache() {
      FC.t = -1e9;
    }
    function rectOf(el) {
      freshCache();
      let r = FC.rects.get(el);
      if (!r) {
        r = el.getBoundingClientRect();
        FC.rects.set(el, r);
      }
      return r;
    }

    // ── 위젯 윗면 (perch) ──
    // 모달(z-index가 펫보다 위)·data-pet-ignore 안의 요소는 오르지도 설명하지도 않는다
    const EXCLUDE_SEL = '[role="dialog"],[aria-modal="true"],[data-pet-ignore]';
    function perchExcluded(el) {
      return !!(el && el.closest && el.closest(EXCLUDE_SEL));
    }
    function perchKey(el) {
      return el.getAttribute('data-pet-perch') || el.getAttribute('data-pet-target') || '';
    }
    /** 이 프레임의 perch 후보 (연결돼 있고 크기가 있는 것만) */
    function rawPerches() {
      freshCache();
      if (FC.raw) return FC.raw;
      const out = [];
      for (const el of doc.querySelectorAll('[data-pet-perch]')) {
        if (root.contains(el) || perchExcluded(el)) continue;
        const r = rectOf(el);
        if (r.width <= 0 || r.height <= 0) continue;
        out.push({ el, r });
      }
      FC.raw = out;
      return out;
    }
    function perchVisible(el, r, x) {
      if (!el.isConnected || r.width < 48 || r.height < 16) return false;
      if (r.top < 4 || r.top > floorY() - 24 || r.right < 8 || r.left > W() - 8) return false;
      const byEl = x === undefined || x === null;
      if (byEl) {
        freshCache();
        const known = FC.vis.get(el);
        if (known !== undefined) return known;
      }
      const sx = clamp(byEl ? (r.left + r.right) / 2 : x, Math.max(r.left + 6, 2), Math.min(r.right - 6, W() - 2));
      const top = probe(sx, r.top + 4);
      // 스크롤 영역 밖으로 잘렸거나 다른 요소에 가려졌으면 쓰지 않는다
      const ok = !!top && (top === el || el.contains(top) || root.contains(top));
      if (byEl) FC.vis.set(el, ok);
      return ok;
    }
    /**
     * 그 점에 보이는 요소. 펫 몸(잡는 곳)은 늘 그 자리에 있으니 빼고 본다.
     * 여러 점을 잇달아 볼 때는 probeStart/probeEnd로 감싸 스타일을 한 번만 바꾼다(바꿀 때마다 스타일 계산이 다시 돈다).
     */
    let probeDepth = 0;
    let probePrev = '';
    function probeStart() {
      if (probeDepth++ === 0) {
        probePrev = hit.style.pointerEvents;
        hit.style.pointerEvents = 'none';
      }
    }
    function probeEnd() {
      if (probeDepth > 0 && --probeDepth === 0) hit.style.pointerEvents = probePrev;
    }
    function probe(x, y) {
      probeStart();
      try {
        return doc.elementFromPoint(x, y);
      } finally {
        probeEnd();
      }
    }
    function petWidth() {
      const b = bbox();
      return (b.right - b.left) * S.scale;
    }
    /** 오를 수 있는 기둥(예: 왼쪽 레일 nav[data-pet-climb]) */
    function climbColumnOf(el) {
      return el && el.closest ? el.closest('[data-pet-climb]') : null;
    }
    /**
     * 면 하나. left~right = 펫 발이 설 수 있는 범위.
     * 펫보다 좁은 면(레일 탭·작은 박스)은 narrow: 가운데에 서거나 앉기만 한다(걷지 않는다).
     */
    function perchSurface(el, r) {
      const inset = halfW() * 0.55;
      let left = Math.max(r.left, 0) + inset;
      let right = Math.min(r.right, W()) - inset;
      const narrow = r.width < petWidth() * 1.25 || right - left < 12;
      if (narrow) {
        const c = clamp((r.left + r.right) / 2, halfW() * 0.7, W() - halfW() * 0.7);
        left = c;
        right = c;
      }
      return { el, top: r.top, bottom: r.bottom, left, right, rawLeft: r.left, rawRight: r.right, narrow, col: climbColumnOf(el) };
    }
    /** 떨어지다 이 면에 걸리는지 (좁은 면은 면 폭 전체로 받는다) */
    function catches(p, x) {
      return p.narrow ? x >= p.rawLeft + 4 && x <= p.rawRight - 4 : x >= p.left - 4 && x <= p.right + 4;
    }
    /** 면 목록. checkVisible이면 가려지지 않은 것만(가려짐 검사는 한 번에 몰아서). 같은 프레임에서는 같은 배열을 돌려주니 고치지 않는다 */
    function listPerches(checkVisible) {
      freshCache();
      const slot = checkVisible ? 'l1' : 'l0';
      if (FC[slot]) return FC[slot];
      const out = [];
      const fy = floorY();
      if (checkVisible) probeStart();
      try {
        for (const { el, r } of rawPerches()) {
          if (!el.isConnected) continue;
          if (checkVisible ? !perchVisible(el, r) : r.width < 48 || r.top < 4 || r.top > fy - 24) continue;
          out.push(perchSurface(el, r));
        }
      } finally {
        if (checkVisible) probeEnd();
      }
      FC[slot] = out;
      return out;
    }
    /** 서 있는 perch가 아직 화면에 있는지 (화면 이동으로 빠지면 false) */
    function surfaceAlive() {
      return !!S.surface && S.surface.type === 'perch' && S.surface.el.isConnected;
    }
    function surfaceRange() {
      if (surfaceAlive()) {
        const s = perchSurface(S.surface.el, S.surface.el.getBoundingClientRect());
        return [s.left, Math.max(s.left, s.right)];
      }
      return floorRange();
    }
    function groundBelow(x, y) {
      let best = floorY();
      for (const p of listPerches(false)) if (p.top >= y - 1 && p.top < best && catches(p, x)) best = p.top;
      return best;
    }
    function findTarget(key) {
      if (!key) return null;
      let sel;
      try {
        // 이 파일의 CSS 상수(스타일 문자열)와 겹치지 않게 전역 CSS를 직접 부른다
        sel = `[data-pet-target="${global.CSS && global.CSS.escape ? global.CSS.escape(key) : String(key).replace(/"/g, '\\"')}"]`;
      } catch (e) {
        return null;
      }
      // 같은 키가 여러 곳에 있으면(예: 레일과 상단 바의 메신저) 지금 화면에 보이는 것을 먼저 고른다.
      // 크기가 0인 것(display:none 안)은 마지막 수단, data-pet-ignore 안은 쓰지 않는다.
      const list = doc.querySelectorAll(sel);
      let sized = null;
      let any = null;
      probeStart();
      try {
        for (const el of list) {
          if (root.contains(el) || el.closest('[data-pet-ignore]')) continue;
          if (!any) any = el;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          if (!sized) sized = el;
          if (r.bottom > 0 && r.top < H() && r.right > 0 && r.left < W()) {
            const at = probe(clamp((r.left + r.right) / 2, 1, W() - 1), clamp((r.top + r.bottom) / 2, 1, H() - 1));
            if (at && (at === el || el.contains(at) || root.contains(at))) return el;
          }
        }
      } finally {
        probeEnd();
      }
      return sized || any;
    }
    function findPerch(id) {
      for (const el of doc.querySelectorAll('[data-pet-perch]')) if (perchKey(el) === id && !root.contains(el) && !perchExcluded(el)) return el;
      return null;
    }
    /** 키 하나라도 화면 안에 보이는 요소가 있는지 (화면 이동 뒤 DOM이 다 그려졌는지 볼 때) */
    function targetShown(key) {
      const el = findTarget(key);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? el : null;
    }
    /**
     * 이 요소가 다른 화면으로 가는 링크면 { href, el }. 레일 탭이나 <a href> (같은 사이트, 지금 주소와 다른 곳)만.
     * 위젯·Card 같은 덩어리는 안에 링크가 있어도 화면 이동으로 보지 않는다.
     */
    function navHrefOf(el) {
      if (!el || !el.isConnected || !el.closest) return null;
      let a = el.closest('a[href]');
      if (!a && climbColumnOf(el) && el.querySelector) a = el.querySelector('a[href]');
      if (!a) return null;
      // 지금 화면을 나타내는 링크(레일의 지금 탭, 상세 화면에서 본 목록 탭)는 '가기'가 아니다. 그 기능은 이미 이 화면에 있다
      if (a.getAttribute('aria-current') === 'page') return null;
      const keyEl = el.closest('[data-pet-target]');
      if (S.screen && keyEl && keyEl.getAttribute('data-pet-target') === S.screen && (keyEl === a || keyEl.contains(a) || a.contains(keyEl))) return null;
      const raw = a.getAttribute('href') || '';
      if (!raw || raw.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(raw)) return null;
      let u;
      try {
        u = new URL(a.href, global.location.href);
      } catch (e) {
        return null;
      }
      if (u.origin !== global.location.origin || u.pathname === global.location.pathname) return null;
      return { href: u.pathname + u.search + u.hash, el: a };
    }
    /** 다른 화면으로 간다. navigate 옵션(라우터)이 있으면 그것으로, 없거나 실패하면 링크를 누른다 */
    function goNav(nav) {
      if (!nav) return false;
      S.noHoverUntil = now() + 1500;
      closeBubble('nav');
      if (typeof o.navigate === 'function') {
        try {
          o.navigate(nav.href);
          return true;
        } catch (e) {
          /* 라우터가 실패하면 아래에서 링크를 누른다 */
        }
      }
      try {
        if (nav.el && nav.el.isConnected) nav.el.click();
        else global.location.assign(nav.href);
      } catch (e) {
        return false;
      }
      return true;
    }
    function navAction(el) {
      return navHrefOf(el) ? { label: '이 화면으로 가기', value: 'nav' } : null;
    }
    /** SCREEN 키인지 (레일 탭·화면 안내의 키). card:·widget:·topbar: 같은 키는 아니다 */
    function isScreenKey(k) {
      if (!k || typeof k !== 'string' || k.indexOf(':') >= 0) return false;
      const own = (obj) => isObj(obj) && Object.prototype.hasOwnProperty.call(obj, k);
      return own(o.screenHrefs) || own(guide.screens) || own(guide.targets);
    }
    /** 이 키가 사는 화면: SCREEN 키는 그 자체, card:<화면>.<이름>은 <화면>, widget:은 대시보드. 상단 바처럼 어디에나 있는 것은 null */
    function screenOfKey(k) {
      if (!k || typeof k !== 'string') return null;
      if (k.startsWith('card:')) return k.slice(5).split('.')[0] || null;
      if (k.startsWith('widget:')) return 'dashboard';
      return isScreenKey(k) ? k : null;
    }
    /** 그 화면으로 가는 길 { href, el }. 레일 탭이 보이면 그 링크, 없으면 screenHrefs 주소. 지금 화면이면 null */
    function screenNav(screen) {
      if (!screen || screen === S.screen) return null;
      const tab = findTarget(screen);
      const viaTab = tab ? navHrefOf(tab) : null;
      if (viaTab) return viaTab;
      const href = isObj(o.screenHrefs) && typeof o.screenHrefs[screen] === 'string' ? o.screenHrefs[screen] : '';
      if (!href) return null;
      try {
        const u = new URL(href, global.location.href);
        if (u.origin !== global.location.origin || u.pathname === global.location.pathname) return null;
        return { href: u.pathname + u.search + u.hash, el: null };
      } catch (e) {
        return null;
      }
    }
    // 지금 화면에 보이는 data-pet-target 키들. 대화 한 번에 여러 번 묻기 때문에 잠깐 기억한다
    const pageKeyCache = { t: -1e9, set: null };
    function pageKeys() {
      const t = now();
      if (pageKeyCache.set && t - pageKeyCache.t < 300) return pageKeyCache.set;
      const set = new Set();
      for (const el of doc.querySelectorAll('[data-pet-target]')) {
        if (root.contains(el) || el.closest('[data-pet-ignore]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) set.add(el.getAttribute('data-pet-target'));
      }
      pageKeyCache.t = t;
      pageKeyCache.set = set;
      return set;
    }
    /** 지금 화면 안의 카드·위젯 등 (레일 탭인 SCREEN 키는 빼고) */
    const onPageKey = (k) => !!k && !isScreenKey(k) && pageKeys().has(k);

    // ── 흐름 제어: 새 행동이 시작되면 이전 행동(기다림·걷기 후속)은 멈춘다 ──
    function begin() {
      S.seq += 1;
      S.seqT = now();
      S.restUntil = Infinity;
      return S.seq;
    }
    function rest(min, max) {
      S.restUntil = now() + rand(min || 7000, max || 16000);
    }
    function end(tok) {
      if (S.flow === tok) S.flow = -1;
      if (tok === S.seq) rest();
    }
    const wait = (ms, tok) => new Promise((resolve) => later(() => resolve(tok === undefined || tok === S.seq), ms));
    function waitLanding() {
      return new Promise((resolve) => {
        if (S.mode === 'ground') resolve(true);
        else S.landWaiters.push(resolve);
      });
    }
    function flushLanding(ok) {
      const list = S.landWaiters.splice(0);
      list.forEach((f) => f(ok));
    }

    function setBase(name) {
      S.base = name;
      if (S.mode !== 'ground' || S.walk) return;
      if (['idle', 'sit', 'sleep', 'blink', 'talk', 'wave'].includes(player.name) || player.done) player.set(name);
    }

    // ── 걷기·점프·떨어지기 ──
    function walkTo(x, opt) {
      const op = opt || {};
      return new Promise((resolve) => {
        finishWalk(false);
        if (S.mode !== 'ground') {
          resolve(false);
          return;
        }
        const dist = Math.abs(x - S.x);
        if (dist < 2) {
          resolve(true);
          return;
        }
        const k = S.size / 96;
        // run: 사용자가 시킨 이동(빠르게), trot: 혼자 먼 곳에 갈 때(조금 빠르게), 그 밖: 산책
        const speed = op.run ? Math.max(230 * k, dist / 1.6) : op.trot ? clamp(dist / 4, 44 * k, 120 * k) : 44 * k;
        if (S.base === 'sit') S.base = 'idle';
        S.walk = { x, speed, allowOff: !!op.allowOff, resolve };
        player.set('walk');
        player.speed = op.run ? 1.9 : clamp(speed / (44 * k), 1, 1.6);
      });
    }
    function finishWalk(ok) {
      const w = S.walk;
      if (!w) return;
      S.walk = null;
      player.speed = 1;
      if (player.name === 'walk') player.set(S.base);
      if (ok && S.mode === 'ground') savePos();
      w.resolve(ok);
    }
    function detachFall(vx, vy) {
      finishWalk(true);
      S.mode = 'air';
      S.surface = null;
      S.vx = vx || 0;
      S.vy = vy || 0;
      if (S.base !== 'idle') S.base = 'idle';
      S.sleeping = false;
      player.set('fall', true);
    }
    function landOn(surface, y, quiet) {
      if (surface.type === 'perch' && (!surface.el.isConnected || surface.el.getBoundingClientRect().width === 0)) {
        // 화면 이동으로 그 면이 사라졌다: 내려설 곳이 없으니 아래로 떨어진다
        S.passThrough = false;
        S.mode = 'air';
        S.surface = null;
        S.vx = 0;
        S.vy = 0;
        player.hold = -1;
        player.set('fall', true);
        return;
      }
      S.passThrough = false;
      S.mode = 'ground';
      S.surface = surface;
      S.y = y;
      S.vx = 0;
      S.vy = 0;
      if (surface.type === 'perch') {
        const r = surface.el.getBoundingClientRect();
        const s = perchSurface(surface.el, r);
        S.x = clamp(S.x, s.left, Math.max(s.left, s.right));
        surface.off = S.x - r.left;
      } else {
        const [mn, mx] = floorRange();
        S.x = clamp(S.x, mn, mx);
      }
      if (quiet) player.set(S.base, true);
      else player.set('land', true, () => player.set(S.base));
      savePos();
      flushLanding(true);
    }
    function jumpEnd(target) {
      if (target.type === 'perch') {
        const r = target.el.getBoundingClientRect();
        return { x: r.left + target.off, y: r.top, r };
      }
      const [mn, mx] = floorRange();
      return { x: clamp(target.x, mn, mx), y: floorY(), r: null };
    }
    function jumpTo(target, opt) {
      const op = opt || {};
      return new Promise((resolve) => {
        finishWalk(false);
        if (S.mode !== 'ground') {
          resolve(false);
          return;
        }
        const e = jumpEnd(target);
        const dist = Math.hypot(e.x - S.x, e.y - S.y);
        const up = S.y - e.y;
        const k = S.size / 96;
        // 점프 동작이 있는 팩은 0번(웅크림)부터 그림으로 보이고, 없으면 몸을 납작하게 눌렀다 뛴다
        const real = player.resolve('jump') === 'jump';
        S.jump = {
          x0: S.x,
          y0: S.y,
          t: -0.12,
          T: clamp(0.42 + dist / 1100, 0.45, 1.05),
          H: up > 0 ? up * 0.36 + 46 * k : Math.max(30 * k, Math.abs(e.x - S.x) * 0.16 + 24 * k),
          target,
          resolve,
          real,
        };
        S.mode = 'jump';
        S.surface = null;
        S.base = 'idle';
        S.facing = Math.sign(e.x - S.x) || S.facing;
        S.squash = real ? 0 : 1;
        if (real) player.holdFrame('jump', 0);
        else player.set('idle', true);
        if (op.chatty && !bubble.visible && now() - S.lastSpeech > 9000 && Math.random() < 0.22) react('jump');
      });
    }
    function cancelJump() {
      if (!S.jump) return;
      const j = S.jump;
      S.jump = null;
      j.resolve(false);
    }

    function groundUpdate(dt, t) {
      const surf = S.surface;
      let r = null;
      if (surf.type === 'perch') {
        r = surf.el.getBoundingClientRect();
        if (!surf.el.isConnected || r.width === 0) {
          detachFall();
          return;
        }
        if (t - S.perchCheckT > 250) {
          S.perchCheckT = t;
          if (!perchVisible(surf.el, r, S.x)) {
            detachFall();
            return;
          }
        }
        S.y = r.top;
        S.x = r.left + surf.off;
      } else {
        S.y = floorY();
      }
      const w = S.walk;
      if (w) {
        const [mn, mx] = surfaceRange();
        const target = w.allowOff ? w.x : clamp(w.x, mn, mx);
        const dir = Math.sign(target - S.x);
        const step = w.speed * dt;
        if (dir) S.facing = dir;
        if (Math.abs(target - S.x) <= step) {
          S.x = target;
          finishWalk(true);
        } else S.x += dir * step;
        if (r && (S.x < r.left - 2 || S.x > r.right + 2)) {
          detachFall(dir * 70 * (S.size / 96), -60);
          return;
        }
      } else if (r) {
        const s = perchSurface(surf.el, r);
        S.x = clamp(S.x, s.left, Math.max(s.left, s.right));
      } else {
        const [mn, mx] = floorRange();
        S.x = clamp(S.x, mn, mx);
      }
      if (r) surf.off = S.x - r.left;
    }

    function airUpdate(dt) {
      const prevY = S.y;
      S.vy = Math.min(S.vy + GRAVITY * dt, 2400);
      S.vx *= Math.pow(0.5, dt);
      S.x += S.vx * dt;
      S.y += S.vy * dt;
      const [mn, mx] = floorRange();
      if (S.x < mn) {
        S.x = mn;
        S.vx = Math.abs(S.vx) * 0.35;
      } else if (S.x > mx) {
        S.x = mx;
        S.vx = -Math.abs(S.vx) * 0.35;
      }
      const minY = minFootY();
      if (S.y < minY) {
        S.y = minY;
        if (S.vy < 0) S.vy = -S.vy * 0.2;
      }
      if (S.vy > 0) {
        let best = null;
        for (const p of S.passThrough ? [] : listPerches(false)) {
          if (!catches(p, S.x)) continue;
          if (prevY <= p.top + 1 && S.y >= p.top && (!best || p.top < best.top)) best = p;
        }
        if (best && perchVisible(best.el, best.el.getBoundingClientRect(), S.x)) {
          landOn({ type: 'perch', el: best.el, off: 0 }, best.top);
          return;
        }
        if (S.y >= floorY()) {
          landOn({ type: 'floor' }, floorY());
          return;
        }
      }
      if (player.name !== 'fall') player.set('fall');
    }

    function jumpUpdate(dt) {
      const j = S.jump;
      j.t += dt;
      if (j.t < 0) return; // 웅크리는 순간
      const e = jumpEnd(j.target);
      if (j.target.type === 'perch' && (!j.target.el.isConnected || !e.r || e.r.width === 0)) {
        // 뛰어가던 면이 사라졌다(화면 이동). 사라진 요소의 위치는 0이라 그쪽으로 날아가지 않게 제자리에서 떨어진다
        S.jump = null;
        S.mode = 'air';
        S.vx = 0;
        S.vy = 0;
        player.hold = -1;
        j.resolve(false);
        return;
      }
      const p = Math.min(1, j.t / j.T);
      const prevY = S.y;
      S.x = j.x0 + (e.x - j.x0) * p;
      S.y = j.y0 + (e.y - j.y0) * p - 4 * j.H * p * (1 - p);
      if (j.real) {
        // 1 박차고 오름 → 2 상승 → 3 정점·하강 → 4 착지 직전
        const f = p < 0.14 ? 1 : S.y < prevY - 0.2 ? 2 : p < 0.82 ? 3 : 4;
        if (player.name !== 'jump' || player.frame !== f) player.holdFrame('jump', f);
      } else if (player.name !== 'fall') player.set('fall', true);
      if (p >= 1) {
        S.jump = null;
        player.hold = -1;
        if (j.target.type === 'perch' && perchVisible(j.target.el, e.r, e.x)) landOn({ type: 'perch', el: j.target.el, off: j.target.off }, e.y);
        else if (j.target.type === 'perch') {
          S.mode = 'air';
          S.vy = 0;
          S.vx = 0;
        } else landOn({ type: 'floor' }, e.y);
        j.resolve(true);
      }
    }

    // ── 사다리 (오를 때만 잠깐 나타난다) ──
    function makeLadder() {
      const cv = h('canvas', { 'aria-hidden': 'true' });
      const el = h('div', { class: 'fp-ladder' }, cv);
      el.style.visibility = 'hidden';
      root.appendChild(el);
      return { el, cv, lh: -1, scale: 0, prop: null, gone: false, fresh: true, x: 0, top: 0 };
    }
    function placeLadder(L, x, topY, bottomY) {
      if (!L || L.gone) return;
      const P = ladderProp;
      const sc = S.scale;
      const top = topY - P.hookY * sc;
      const lh = Math.max(P.mid.h, Math.round((bottomY - top) / sc));
      if (lh !== L.lh || sc !== L.scale || P !== L.prop) {
        L.lh = lh;
        L.scale = sc;
        L.prop = P;
        const cv = L.cv;
        cv.width = P.width;
        cv.height = lh;
        const g = cv.getContext('2d');
        g.clearRect(0, 0, P.width, lh);
        const img = P.img;
        const topH = P.top ? Math.min(P.top.h, lh) : 0;
        const botH = P.bottom ? Math.min(P.bottom.h, Math.max(0, lh - topH)) : 0;
        try {
          if (P.top && topH) g.drawImage(img, P.top.x, P.top.y, P.top.w, topH, 0, 0, P.width, topH);
          for (let y = topH; y < lh - botH; y += P.mid.h) {
            const hh = Math.min(P.mid.h, lh - botH - y);
            g.drawImage(img, P.mid.x, P.mid.y, P.mid.w, hh, 0, y, P.width, hh);
          }
          if (P.bottom && botH) g.drawImage(img, P.bottom.x, P.bottom.y + P.bottom.h - botH, P.bottom.w, botH, 0, lh - botH, P.width, botH);
        } catch (err) {
          /* 시트를 못 그리면 빈 사다리 */
        }
        L.el.style.width = `${P.width * sc}px`;
        L.el.style.height = `${lh * sc}px`;
      }
      L.x = x;
      L.top = top;
      L.el.style.transform = `translate3d(${Math.round(x - (P.width * sc) / 2)}px,${Math.round(top)}px,0)`;
      if (L.fresh) {
        // 아래에서 위로 쑥 뻗어 나온다
        L.fresh = false;
        L.el.style.visibility = '';
        if (!reduced && L.el.animate) L.el.animate([{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1)' });
      }
    }
    function removeLadder(L, instant) {
      if (!L || L.gone) return;
      L.gone = true;
      if (instant || reduced || !L.el.animate || L.fresh) {
        L.el.remove();
        return;
      }
      // 반짝 하고 접혀 내려간다
      const k = S.size / 96;
      for (let i = 0; i < 4; i++) {
        const sp = h('div', { class: 'fp-spark' });
        sp.style.left = `${L.x - 2 + (i - 1.5) * 6 * k}px`;
        sp.style.top = `${L.top + 2}px`;
        root.appendChild(sp);
        const sa = sp.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${(i - 1.5) * 6}px,${-10 - Math.random() * 10}px) scale(.3)`, opacity: 0 }], { duration: 420, easing: 'ease-out' });
        sa.onfinish = () => sp.remove();
      }
      const an = L.el.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(100% 0 0 0)' }], { duration: 240, easing: 'ease-in' });
      an.onfinish = () => L.el.remove();
    }

    // ── 오르기: 사다리(위젯 옆 틈) 또는 레일(기둥)을 climb로 오르고, 위 면에 ledge로 올라선다 ──
    function surfY(surf) {
      if (!surf || surf.type === 'floor') return floorY();
      if (!surf.el.isConnected) return null;
      const r = surf.el.getBoundingClientRect();
      return r.width > 0 ? r.top : null;
    }
    function climbX(c) {
      if (c.col) {
        const r = c.col.getBoundingClientRect();
        return (r.left + r.right) / 2;
      }
      if (c.to.type === 'perch') return c.to.el.getBoundingClientRect().left + c.xOff;
      return c.x;
    }
    function arriveXOf(c) {
      if (c.to.type === 'floor') {
        const [mn, mx] = floorRange();
        return clamp(c.arriveX, mn, mx);
      }
      const r = c.to.el.getBoundingClientRect();
      const sf = perchSurface(c.to.el, r);
      return clamp(r.left + c.arriveOff, sf.left, Math.max(sf.left, sf.right));
    }
    function climbTo(e, opt) {
      const op = opt || {};
      return new Promise((resolve) => {
        finishWalk(false);
        if (S.mode !== 'ground') {
          resolve(false);
          return;
        }
        const to = e.to.type === 'floor' ? { type: 'floor' } : { type: 'perch', el: e.to.el, off: 0 };
        const toRect = to.type === 'perch' ? to.el.getBoundingClientRect() : null;
        S.climb = {
          kind: e.kind,
          from: S.surface,
          to,
          col: e.kind === 'rail' ? e.col : null,
          x: e.x,
          xOff: toRect ? e.x - toRect.left : 0,
          arriveX: e.arriveX,
          arriveOff: toRect ? e.arriveX - toRect.left : 0,
          x0: S.x,
          phase: 'step',
          t: 0,
          p: 0,
          down: null,
          run: !!op.run,
          sitAfter: !!op.sitAfter,
          ladder: e.kind === 'ladder' ? makeLadder() : null,
          resolve,
        };
        S.mode = 'climb';
        S.surface = null;
        S.base = 'idle';
        S.sleeping = false;
        player.holdFrame('climb', 1);
        if (op.chatty && !bubble.visible && now() - S.lastSpeech > 9000 && Math.random() < 0.3) react('climb');
      });
    }
    /** 오르기를 그만둔다(끌기·숨기기 등). 사다리는 바로 치운다 */
    function abortClimb(instant) {
      const c = S.climb;
      if (!c) return;
      S.climb = null;
      removeLadder(c.ladder, instant !== false);
      player.speed = 1;
      player.hold = -1;
      c.resolve(false);
    }
    function finishClimb(tY) {
      const c = S.climb;
      S.climb = null;
      removeLadder(c.ladder, false);
      player.speed = 1;
      player.hold = -1;
      S.x = arriveXOf(c);
      const surf = c.to.type === 'floor' ? { type: 'floor' } : { type: 'perch', el: c.to.el, off: 0 };
      landOn(surf, tY, !c.down);
      // 레일 탭처럼 좁은 면에 닿으면 걸터앉는다 (내려온 경우는 착지 동작이 끝난 뒤)
      if (c.sitAfter && c.to.type === 'perch' && perchSurface(c.to.el, c.to.el.getBoundingClientRect()).narrow) setBase('sit');
      c.resolve(true);
    }
    function climbUpdate(dt, t) {
      const c = S.climb;
      const sY = surfY(c.from);
      const tY = surfY(c.to);
      // 출발 면·목표 면·기둥 중 하나라도 화면 이동으로 빠지면 사다리를 치우고 떨어진다
      if (sY === null || tY === null || (c.col && !c.col.isConnected)) {
        abortClimb();
        detachFall();
        return;
      }
      if (c.to.type === 'perch' && t - S.perchCheckT > 300) {
        S.perchCheckT = t;
        if (!perchVisible(c.to.el, c.to.el.getBoundingClientRect())) {
          abortClimb();
          detachFall();
          return;
        }
      }
      if (c.down === null) c.down = tY > sY + 1;
      const sc = S.scale;
      const k = S.size / 96;
      // 오를 때는 손이 위 면 가장자리에 닿는 높이(발은 그보다 아래)까지 오른 뒤 ledge로 올라선다
      const hang = c.down ? 0 : Math.max(0, (S.pack.anchor.y - bbox().top - 6) * sc * 0.9);
      const endY = c.down ? tY : Math.min(sY, tY + hang);
      const cx = climbX(c);
      if (c.ladder) placeLadder(c.ladder, cx, tY, sY);
      if (c.phase === 'step') {
        c.t += dt;
        const q = Math.min(1, c.t / 0.16);
        S.x = c.x0 + (cx - c.x0) * q;
        S.y = sY;
        if (q >= 1) {
          c.phase = 'climb';
          c.t = 0;
        }
        return;
      }
      if (c.phase === 'climb') {
        const dist = Math.abs(endY - sY);
        const speed = c.run ? Math.max(230 * k, dist / 2.4) : 120 * k;
        c.p = dist < 1 ? 1 : Math.min(1, c.p + (speed * dt) / dist);
        S.x = cx;
        S.y = sY + (endY - sY) * c.p;
        if (player.hold >= 0 || player.name !== player.resolve('climb')) player.set('climb', true);
        player.speed = clamp(speed / (120 * k), 0.8, 2.6);
        if (c.p >= 1) {
          player.speed = 1;
          if (c.down) {
            finishClimb(tY);
            return;
          }
          c.phase = 'ledge';
          c.t = 0;
        }
        return;
      }
      // ledge: 0 매달려 가장자리 잡기 → 1 무릎 들어 올라서기(이 사이에 위 면으로 끌어올림) → 2 숨 고르기
      c.t += dt;
      const ms = (i) => {
        const a = S.pack.anims.ledge;
        if (!a) return 0.09;
        const raw = Array.isArray(a.ms) ? a.ms[Math.min(i, a.ms.length - 1)] : a.ms;
        return Math.max(40, Number(raw) || 110) / 1000;
      };
      const d0 = ms(0);
      const d1 = ms(1);
      const d2 = ms(2) * 1.8;
      let f = 0;
      let q = 0;
      if (c.t >= d0 + d1) {
        f = 2;
        q = 1;
      } else if (c.t >= d0) {
        f = 1;
        q = (c.t - d0) / d1;
      }
      if (player.hold < 0 || player.name !== player.resolve('ledge') || player.frame !== f) player.holdFrame('ledge', f);
      const ax = arriveXOf(c);
      S.x = cx + (ax - cx) * q;
      S.y = endY + (tY - endY) * q;
      if (c.ladder && q > 0.6) removeLadder(c.ladder, false);
      if (c.t >= d0 + d1 + d2) finishClimb(tY);
    }

    // ── 면 사이 길 찾기 ──
    // 걷기(같은 면) · 점프(높이가 비슷한 옆 면) · 뛰어내리기(낮은 면) · 사다리(높은 면, 목표 옆 세로 틈) · 레일 타기(오르는 기둥 안의 탭)
    // 비용을 매겨 가장 싼 길을 고른다. 긴 사다리는 비싸서 바닥 → 아래 위젯 → 위 위젯처럼 짧은 사다리 여러 번이 된다.
    function floorNode() {
      const [l, r] = floorRange();
      return { type: 'floor', el: null, top: floorY(), bottom: H(), left: l, right: r, rawLeft: 0, rawRight: W(), narrow: false, col: null };
    }
    // 길 찾기는 노드 수의 제곱으로 늘어나므로, 화면에 보이는 면 가운데 펫·목표에서 가까운 것만 쓴다
    const MAX_NODES = 44;
    function graphNodes(goalEl) {
      const nodes = [floorNode()];
      let list = listPerches(true);
      if (list.length > MAX_NODES - 1) {
        const curEl = surfaceAlive() ? S.surface.el : null;
        const must = list.filter((p) => p.el === goalEl || p.el === curEl);
        const g = goalEl ? list.find((p) => p.el === goalEl) : null;
        const d = (p, x, y) => Math.abs((p.left + p.right) / 2 - x) + Math.abs(p.top - y) * 0.6;
        const score = (p) => Math.min(d(p, S.x, S.y), g ? d(p, (g.left + g.right) / 2, g.top) : Infinity);
        const others = list
          .filter((p) => !must.includes(p))
          .map((p) => ({ p, s: score(p) }))
          .sort((a, b) => a.s - b.s)
          .slice(0, Math.max(0, MAX_NODES - 1 - must.length))
          .map((x) => x.p);
        list = must.concat(others);
      }
      for (const p of list) nodes.push(Object.assign({ type: 'perch' }, p));
      return nodes;
    }
    /** 지금 선 면의 노드. 서 있던 perch가 화면에서 빠졌으면 null */
    function nodeOfSurface(nodes) {
      if (!S.surface || S.surface.type === 'floor') return nodes[0];
      if (!S.surface.el.isConnected) return null;
      let n = nodes.find((q) => q.el === S.surface.el);
      if (!n) {
        n = Object.assign({ type: 'perch' }, perchSurface(S.surface.el, S.surface.el.getBoundingClientRect()));
        nodes.push(n);
      }
      return n;
    }
    function obstacles() {
      freshCache();
      if (FC.obs) return FC.obs;
      const out = [];
      const vw = W();
      const vh = H();
      for (const { el, r } of rawPerches()) {
        if (!el.isConnected || climbColumnOf(el)) continue;
        if (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) out.push({ el, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
      doc.querySelectorAll('[data-pet-climb]').forEach((el) => {
        const r = rectOf(el);
        if (r.width > 0) out.push({ el, left: r.left, right: r.right, top: -1e6, bottom: 1e6, column: true });
      });
      FC.obs = out;
      return out;
    }
    function columnClear(x, yTop, yBottom, A, B, obs) {
      for (const o of obs) {
        if (x + 3 < o.left || x - 3 > o.right) continue;
        if (o.column) return false; // 레일 안에는 사다리를 세우지 않는다
        if (o.el === A.el || o.el === B.el) continue;
        if (B.el && (o.el.contains(B.el) || B.el.contains(o.el))) continue;
        if (A.el && o.el.contains(A.el)) continue;
        if (o.bottom <= yTop + 2 || o.top >= yBottom - 2) continue;
        return false;
      }
      return true;
    }
    const xGap = (a, b) => Math.max(0, Math.max(a.rawLeft, b.rawLeft) - Math.min(a.rawRight, b.rawRight));
    const inRange = (n, x) => clamp(x, n.left, Math.max(n.left, n.right));
    function colReachesFloor(col) {
      return rectOf(col).bottom >= floorY() - 40;
    }
    function edgeBetween(A, B, obs, posA) {
      if (A === B) return null;
      const dy = A.top - B.top; // + 이면 B가 더 높다
      const [fl, fr] = floorRange();
      // 레일 타기: 같은 기둥 안의 탭끼리, 기둥 아래 바닥과 탭
      let col = null;
      if (A.col && B.col && A.col === B.col) col = A.col;
      else if (A.type === 'floor' && B.col && colReachesFloor(B.col)) col = B.col;
      else if (B.type === 'floor' && A.col && colReachesFloor(A.col)) col = A.col;
      if (col) {
        const cr = rectOf(col);
        const cx = (cr.left + cr.right) / 2;
        return { kind: 'rail', col, x: cx, departX: A.type === 'floor' ? clamp(cx, fl, fr) : inRange(A, cx), arriveX: B.type === 'floor' ? clamp(cx, fl, fr) : inRange(B, cx), cost: 40 + Math.abs(dy) * 0.6 };
      }
      if (A.col && B.col) return null;
      // 레일에서 가운데 면으로 건너가는 길은 비싸게: 위젯에 갈 때 레일을 지름길로 쓰지 않고 사다리로 가게.
      // 가운데 면에서 바로 옆 레일 탭으로 건너가는 것(예: 공정 흐름 현황 윗면 → 수주 탭)은 괜찮다.
      const railPenalty = A.col && !B.col ? 600 : !A.col && B.col ? 60 : 0;
      const gap = xGap(A, B);
      if (Math.abs(dy) <= JUMP_DY) {
        if (gap > 300 || (A.type === 'floor' && B.type === 'floor')) return null;
        const departX = A.type === 'floor' ? clamp((B.left + B.right) / 2, fl, fr) : inRange(A, (B.left + B.right) / 2);
        const arriveX = B.type === 'floor' ? clamp(departX, fl, fr) : inRange(B, departX);
        return { kind: 'jump', departX, arriveX, cost: 60 + Math.hypot(arriveX - departX, dy) * 0.6 + railPenalty };
      }
      if (dy < 0) {
        // 낮은 면으로 뛰어내리기
        if (B.type === 'floor') {
          const departX = inRange(A, posA);
          return { kind: 'jump', departX, arriveX: clamp(departX, fl, fr), cost: 50 + -dy * 0.12 + railPenalty };
        }
        if (gap > 260) return null;
        const departX = inRange(A, (B.left + B.right) / 2);
        const arriveX = inRange(B, departX);
        return { kind: 'jump', departX, arriveX, cost: 50 + gap * 0.5 + -dy * 0.12 + railPenalty };
      }
      // 더 높은 면: 목표 옆 세로 틈에 사다리 (레일 탭에서 출발하거나 레일 탭으로 가는 사다리는 없다)
      if (A.col || B.col || B.type === 'floor') return null;
      let best = null;
      for (const x of [B.rawLeft - 8, B.rawRight + 8]) {
        if (x < 6 || x > W() - 6) continue;
        if (A.type !== 'floor' && (x < A.rawLeft - 34 || x > A.rawRight + 34)) continue;
        if (!columnClear(x, B.top, A.top, A, B, obs)) continue;
        const hgt = A.top - B.top;
        const edgePen = x < 60 || x > W() - 40 ? 120 : 0;
        const departX = A.type === 'floor' ? clamp(x, fl, fr) : inRange(A, x);
        const arriveX = x < B.rawLeft ? B.left : B.right;
        const cost = 60 + hgt * 0.8 + Math.max(0, hgt - 280) * 2.5 + edgePen;
        if (!best || cost < best.cost) best = { kind: 'ladder', x, departX, arriveX, cost };
      }
      return best;
    }
    /** 지금 면에서 goalEl(없으면 바닥)까지의 길. 못 가면 null, 이미 거기면 [] */
    function planPath(goalEl) {
      if (goalEl && !goalEl.isConnected) return null;
      const nodes = graphNodes(goalEl);
      const start = nodeOfSurface(nodes);
      const goal = goalEl ? nodes.find((n) => n.el === goalEl) : nodes[0];
      if (!start || !goal) return null;
      if (goal === start) return [];
      const obs = obstacles();
      const dist = new Map([[start, 0]]);
      const pos = new Map([[start, S.x]]);
      const prev = new Map();
      const done = new Set();
      for (let iter = 0; iter < nodes.length; iter++) {
        let u = null;
        let best = Infinity;
        for (const [node, d] of dist) {
          if (!done.has(node) && d < best) {
            best = d;
            u = node;
          }
        }
        if (!u || u === goal) break;
        done.add(u);
        const ux = pos.get(u);
        for (const v of nodes) {
          if (done.has(v) || v === u) continue;
          const e = edgeBetween(u, v, obs, ux);
          if (!e) continue;
          const nd = best + Math.abs(ux - e.departX) * 0.3 + e.cost;
          if (nd < (dist.has(v) ? dist.get(v) : Infinity)) {
            dist.set(v, nd);
            pos.set(v, e.arriveX);
            prev.set(v, Object.assign({ from: u, to: v, departOff: u.type === 'perch' ? e.departX - u.rawLeft : null }, e));
          }
        }
      }
      if (!prev.has(goal)) return null;
      const path = [];
      for (let cur = goal; cur !== start; ) {
        const e = prev.get(cur);
        path.unshift(e);
        cur = e.from;
        if (path.length > 12) return null;
      }
      path.cost = dist.get(goal);
      return path;
    }
    function departXOf(e) {
      if (e.from.type === 'perch' && e.from.el.isConnected) return e.from.el.getBoundingClientRect().left + e.departOff;
      return e.departX;
    }
    function jumpTargetOf(e) {
      if (e.to.type === 'floor') return { type: 'floor', x: e.arriveX };
      return { type: 'perch', el: e.to.el, off: e.arriveX - e.to.rawLeft };
    }
    /** 길을 따라간다. 하나라도 어긋나면(끌기·다른 행동·다른 면에 착지) false */
    async function followPath(path, tok, opt) {
      const op = opt || {};
      for (let i = 0; i < path.length; i++) {
        const e = path[i];
        if (tok !== S.seq || S.mode !== 'ground') return false;
        // 걷는 사이 화면이 바뀌어 목표 면·기둥이 빠졌으면 이 길은 버린다
        if ((e.to.type === 'perch' && !e.to.el.isConnected) || (e.col && !e.col.isConnected)) return false;
        const dx = departXOf(e);
        if (Math.abs(S.x - dx) > 2) {
          const ok = await walkTo(dx, { run: op.run, trot: !op.run });
          if (!ok || tok !== S.seq) return false;
        }
        const last = i === path.length - 1;
        const ok = e.kind === 'jump' ? await jumpTo(jumpTargetOf(e), { chatty: !op.run }) : await climbTo(e, { run: op.run, chatty: !op.run, sitAfter: op.sitAfter && last });
        if (!ok || tok !== S.seq) return false;
        if (S.mode !== 'ground') {
          const landed = await waitLanding();
          if (!landed || tok !== S.seq) return false;
        }
        const onIt = e.to.type === 'floor' ? !!S.surface && S.surface.type === 'floor' : !!S.surface && S.surface.el === e.to.el;
        if (!onIt) return false;
        if (last && op.sitAfter) {
          const sf = curSurfaceInfo();
          if (sf && sf.narrow) setBase('sit');
        }
        if (!op.run && !last && !(await wait(380, tok))) return false;
      }
      return true;
    }
    /** 요소가 보이게 스크롤한다. 화면보다 큰 Card(긴 표)는 가운데로 맞추면 윗면이 잘리므로 위쪽을 맞춘다 */
    function scrollToSee(el, r) {
      const rect = r || el.getBoundingClientRect();
      try {
        el.scrollIntoView({ block: rect.height > H() * 0.6 ? 'start' : 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      } catch (err) {
        el.scrollIntoView();
      }
    }
    /** 그 면으로 간다 (안 보이면 먼저 스크롤). 움직임 줄이기면 펑 하고 바로 옮긴다 */
    async function travelTo(el, tok, opt) {
      const op = opt || {};
      if (!el.isConnected || perchExcluded(el)) return false;
      if (S.mode !== 'ground') {
        const ok = await waitLanding();
        if (!ok || tok !== S.seq) return false;
      }
      let r = el.getBoundingClientRect();
      if (!perchVisible(el, r)) {
        scrollToSee(el, r);
        if (!(await wait(reduced ? 60 : 520, tok))) return false;
        if (!el.isConnected) return false;
        r = el.getBoundingClientRect();
        if (!perchVisible(el, r)) return false;
      }
      if (S.surface && S.surface.el === el) return true;
      if (reduced) {
        const c = petCenter();
        puff(c.x, c.y);
        const sf = perchSurface(el, r);
        S.base = 'idle';
        S.x = clamp(S.x, sf.left, Math.max(sf.left, sf.right));
        landOn({ type: 'perch', el, off: S.x - r.left }, r.top, true);
        if (op.sitAfter && sf.narrow) setBase('sit');
        return true;
      }
      const path = planPath(el);
      if (!path) return false;
      return followPath(path, tok, op);
    }

    // ── 위치 기억 ──
    function savePos() {
      if (surfaceAlive()) {
        const id = perchKey(S.surface.el);
        const r = S.surface.el.getBoundingClientRect();
        if (id && r.width > 0) {
          store.set('pos', { k: 'perch', id, r: +((S.x - r.left) / r.width).toFixed(4) });
          return;
        }
      }
      store.set('pos', { k: 'floor', r: +(S.x / Math.max(1, W())).toFixed(4) });
    }

    // ── 화면 그리기 ──
    function layoutPet() {
      const p = S.pack;
      const s = S.scale;
      const px = p.cell * s;
      canvas.style.width = `${px}px`;
      canvas.style.height = `${px}px`;
      spriteEl.style.width = `${px}px`;
      spriteEl.style.height = `${px}px`;
      petEl.style.width = `${px}px`;
      petEl.style.height = `${px}px`;
      const b = bbox();
      const pad = 3;
      Object.assign(hit.style, {
        left: `${b.left * s - pad}px`,
        top: `${b.top * s - pad}px`,
        width: `${(b.right - b.left) * s + pad * 2}px`,
        height: `${(b.bottom - b.top) * s + pad * 2}px`,
      });
      hit.setAttribute('aria-label', `${p.name} 도우미 · Enter 대화 · Shift+F10 메뉴 · Shift+P 숨기기`);
    }

    function render() {
      player.draw();
      const s = S.scale;
      const a = S.pack.anchor;
      const oy = drawOffsetY();
      petEl.style.transform = `translate3d(${(S.x - a.x * s).toFixed(1)}px,${(S.y + oy - a.y * s).toFixed(1)}px,0)`;
      const flip = S.facing < 0 && FLIP_ANIMS.has(player.name) ? -1 : 1;
      const sq = S.squash;
      const sx = (1 + sq * 0.14) * flip;
      const sy = 1 - sq * 0.16;
      spriteEl.style.transformOrigin = S.mode === 'drag' ? `${a.x * s}px ${bbox().top * s}px` : `${a.x * s}px ${a.y * s}px`;
      spriteEl.style.transform = `rotate(${S.rot.toFixed(2)}deg) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
      // 발 아래 그림자: 공중에 뜰수록 작고 옅게
      const b = bbox();
      let gy = S.y;
      let visible = true;
      if (S.mode === 'ground') visible = player.name !== 'sit';
      else if (S.mode === 'climb') visible = false;
      else gy = S.passThrough ? floorY() : groundBelow(S.x, S.y);
      const f = clamp(1 - Math.max(0, gy - S.y) / 360, 0.25, 1);
      const w = Math.max(8, (b.right - b.left) * s * 0.8 * f);
      const hh = Math.max(3, w * 0.2);
      shadowEl.style.display = visible ? '' : 'none';
      shadowEl.style.width = `${w.toFixed(1)}px`;
      shadowEl.style.height = `${hh.toFixed(1)}px`;
      shadowEl.style.opacity = (0.95 * f).toFixed(2);
      shadowEl.style.transform = `translate3d(${(S.x - w / 2).toFixed(1)}px,${(gy - hh / 2).toFixed(1)}px,0)`;
    }

    // ── 말풍선 ──
    // anchor: 설명하는 요소. 화면 이동으로 DOM에서 빠지면 말풍선도 닫는다
    const bubble = { visible: false, typing: false, sticky: false, hasActions: false, resolve: null, timer: 0, typeTimer: 0, w: 0, h: 0, anim: null, anchor: null };
    function closeBubble(reason) {
      if (!bubble.visible) return;
      cancel(bubble.timer);
      cancel(bubble.typeTimer);
      bubble.visible = false;
      bubble.typing = false;
      bubble.anchor = null;
      bubbleEl.style.display = 'none';
      if (bubble.anim && player.name === bubble.anim && S.mode === 'ground' && !S.walk) player.set(S.base);
      const r = bubble.resolve;
      bubble.resolve = null;
      if (r) r(reason);
    }
    function canAnimSpeech() {
      return S.mode === 'ground' && !S.walk && S.base === 'idle';
    }
    /**
     * 말풍선을 띄운다. actions가 있으면 버튼을 누를 때까지(또는 11초) 기다린다.
     * 돌려주는 값: 누른 버튼의 value, 'timeout', 'close', 'replaced' 등
     */
    function showBubble(text, opt) {
      const op = opt || {};
      const msg = fill(text || '');
      const title = op.title ? fill(op.title) : '';
      const actions = arr(op.actions).filter(Boolean);
      // fields: 항목 읽기의 [이름, 값] 목록. 화면에서 읽은 글자라 textContent로만 넣는다
      const fields = arr(op.fields).filter((f) => Array.isArray(f) && f[1]);
      return new Promise((resolve) => {
        if (S.mode === 'hidden' || (!msg && !fields.length)) {
          resolve('none');
          return;
        }
        closeBubble('replaced');
        bubble.resolve = resolve;
        bubble.sticky = !!op.sticky;
        bubble.hasActions = actions.length > 0;
        bubble.anchor = op.anchor && op.anchor.nodeType === 1 ? op.anchor : null;
        bubbleEl.textContent = '';
        if (title || op.tag || op.step) {
          bubbleEl.append(
            h('div', { class: 'fp-b-head' }, title ? h('span', { class: 'fp-b-title', text: title }) : null, op.tag ? h('span', { class: 'fp-b-tag', text: op.tag }) : null, op.step ? h('span', { class: 'fp-b-step', text: op.step }) : null),
          );
        }
        bubbleEl.classList.toggle('fp-bubble--data', fields.length > 0);
        if (fields.length) bubbleEl.append(fieldList(fields));
        const typed = h('span', { class: 'fp-b-typed', 'aria-hidden': 'true' });
        if (msg) bubbleEl.append(h('p', { class: 'fp-b-text' }, h('span', { class: 'fp-b-ghost', 'aria-hidden': 'true', text: msg }), typed, h('span', { class: 'fp-sr', text: msg })));
        if (op.note) bubbleEl.append(h('div', { class: 'fp-b-note', text: fill(op.note) }));
        if (bubble.hasActions) {
          const row = h('div', { class: 'fp-b-actions' });
          for (const a of actions) {
            row.append(
              h('button', {
                type: 'button',
                class: `fp-btn${a.primary ? ' fp-btn--primary' : ''}`,
                text: a.label,
                onclick: (ev) => {
                  ev.stopPropagation();
                  S.noHoverUntil = now() + 1500;
                  closeBubble(a.value);
                },
              }),
            );
          }
          bubbleEl.append(row);
        }
        // 설명·안내 말풍선은 끝까지 안 봐도 되게 오른쪽 위 X로 언제든 닫는다
        bubbleEl.classList.toggle('fp-bubble--x', !!op.closable);
        if (op.closable) {
          bubbleEl.append(
            h('button', {
              type: 'button',
              class: 'fp-b-x',
              'aria-label': '설명 닫기',
              title: '닫기 (Esc)',
              text: '×',
              onclick: (ev) => {
                ev.stopPropagation();
                S.noHoverUntil = now() + 1500;
                closeBubble('close');
              },
            }),
          );
        }
        bubbleEl.style.display = 'block';
        bubble.visible = true;
        bubble.w = bubbleEl.offsetWidth;
        bubble.h = bubbleEl.offsetHeight;
        positionBubble();
        if (!reduced && bubbleEl.animate) bubbleEl.animate([{ transform: 'scale(.86)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 160, easing: 'cubic-bezier(.3,1.4,.6,1)' });
        const anim = op.anim || 'talk';
        bubble.anim = null;
        if (canAnimSpeech() || (anim === 'point' && S.mode === 'ground' && !S.walk)) {
          bubble.anim = anim;
          player.set(anim, anim !== 'talk');
        }
        const chars = Array.from(msg);
        // 읽을 거리(필드)가 있으면 그만큼 더 오래 둔다
        const readLen = chars.length + fields.reduce((n, f) => n + String(f[1]).length * 0.5, 0);
        let i = 0;
        bubble.typing = true;
        const afterTyped = () => {
          bubble.typing = false;
          if (bubble.anim && bubble.anim !== 'point' && player.name === bubble.anim) player.set(S.base);
          if (!bubble.sticky) bubble.timer = later(() => closeBubble('timeout'), bubble.hasActions ? (fields.length ? 14000 : 11000) : clamp(1700 + readLen * 85, 2800, fields.length ? 11000 : 7800));
        };
        const step = () => {
          i = Math.min(chars.length, i + (reduced ? 4 : 1));
          typed.textContent = chars.slice(0, i).join('');
          if (i >= chars.length) {
            bubble.typeTimer = 0;
            afterTyped();
            return;
          }
          bubble.typeTimer = later(step, chars[i - 1] === ' ' ? 16 : 34);
        };
        step();
        bubbleEl.onclick = () => {
          if (bubble.typing) {
            cancel(bubble.typeTimer);
            typed.textContent = msg;
            afterTyped();
          } else if (!bubble.sticky && !bubble.hasActions) closeBubble('close');
        };
        S.lastSpeech = now();
      });
    }
    function positionBubble() {
      if (!bubble.visible) return;
      const vw = W();
      const vh = H();
      const bw = bubble.w;
      const bh = bubble.h;
      const box = petBox();
      const cx = (box.left + box.right) / 2;
      let side = 'top';
      let x;
      let y = box.top - bh - 12;
      if (y >= 8) x = clamp(cx - bw / 2, 8, Math.max(8, vw - bw - 8));
      else {
        const leftSpace = box.left - 14;
        const rightSpace = vw - box.right - 14;
        if (leftSpace >= bw + 8 || leftSpace > rightSpace) {
          side = 'left';
          x = Math.max(8, box.left - 14 - bw);
        } else {
          side = 'right';
          x = Math.min(vw - bw - 8, box.right + 14);
        }
        y = clamp(box.top, 8, Math.max(8, vh - bh - 8));
      }
      if (bubbleEl.dataset.side !== side) bubbleEl.dataset.side = side;
      bubbleEl.style.left = `${Math.round(x)}px`;
      bubbleEl.style.top = `${Math.round(y)}px`;
      if (side === 'top') {
        const tx = clamp(cx - x, 14, bw - 14);
        bubbleEl.style.setProperty('--fp-tail-x', `${Math.round(tx)}px`);
        bubbleEl.style.transformOrigin = `${Math.round(tx)}px 100%`;
      } else {
        const ty = clamp((box.top + box.bottom) / 2 - y - 8, 8, Math.max(8, bh - 24));
        bubbleEl.style.setProperty('--fp-tail-y', `${Math.round(ty)}px`);
        bubbleEl.style.transformOrigin = side === 'left' ? `100% ${Math.round(ty)}px` : `0 ${Math.round(ty)}px`;
      }
    }
    function react(kind) {
      if (bubble.visible && (bubble.sticky || bubble.hasActions)) return;
      const line = pick(guide.reactions[kind]);
      if (line) showBubble(line);
    }

    // ── 첫 방문 힌트 ──
    function showHint() {
      if (!o.hint || store.get('hinted')) return;
      store.set('hinted', true);
      hintEl.textContent = o.hint;
      hintEl.style.display = 'block';
      S.hintUntil = now() + 25000;
    }
    function hideHint() {
      S.hintUntil = 0;
      hintEl.style.display = 'none';
    }
    function positionHint(t) {
      if (!S.hintUntil) return;
      if (t > S.hintUntil || S.mode === 'hidden') {
        hideHint();
        return;
      }
      const box = petBox();
      const hw = hintEl.offsetWidth;
      const hh = hintEl.offsetHeight;
      const leftSide = (box.left + box.right) / 2 > W() / 2;
      const x = leftSide ? box.left - 12 - hw : box.right + 12;
      const y = clamp(box.top + (box.bottom - box.top) * 0.28 - hh / 2, 8, H() - hh - 8);
      hintEl.dataset.side = leftSide ? 'left' : 'right';
      hintEl.style.left = `${Math.round(clamp(x, 8, W() - hw - 8))}px`;
      hintEl.style.top = `${Math.round(y)}px`;
    }

    // ── 강조 (반짝) ──
    const flashes = [];
    function flash(el, ms, steady) {
      const f = h('div', { class: `fp-flash${steady ? ' fp-flash--steady' : ''}` });
      root.appendChild(f);
      const item = { el, f, until: steady ? Infinity : now() + (ms || 1900) };
      flashes.push(item);
      placeFlash(item);
      return item;
    }
    function placeFlash(it) {
      const r = it.el.getBoundingClientRect();
      const pad = 3;
      it.f.style.left = `${r.left - pad}px`;
      it.f.style.top = `${r.top - pad}px`;
      it.f.style.width = `${r.width + pad * 2}px`;
      it.f.style.height = `${r.height + pad * 2}px`;
    }
    // ── H빔 지시봉: 손끝에서 가리키는 요소까지 강철 H빔을 뻗는다 (가까우면 손으로만 가리킨다) ──
    let beam = null;
    function handPoint(toward) {
      const b = petBox();
      const right = toward >= S.x;
      return { x: right ? b.right - 2 * S.scale : b.left + 2 * S.scale, y: b.top + (b.bottom - b.top) * 0.55 };
    }
    function beamGeom(el) {
      const r = el.getBoundingClientRect();
      const hp = handPoint((r.left + r.right) / 2);
      const tx = clamp(hp.x, r.left + 3, r.right - 3);
      const ty = clamp(hp.y, r.top + 3, r.bottom - 3);
      const dx = tx - hp.x;
      const dy = ty - hp.y;
      return { x: hp.x, y: hp.y, len: Math.max(0, Math.hypot(dx, dy) - 3), ang: Math.atan2(dy, dx) };
    }
    /** 요소가 손에서 이만큼 멀 때만 빔을 뻗는다 */
    const BEAM_MIN = 26;
    function showBeam(el) {
      hideBeam(true);
      if (!el || !el.isConnected || S.mode !== 'ground') return null;
      const g = beamGeom(el);
      if (g.len < BEAM_MIN) return null;
      const th = Math.max(6, Math.round(4 * S.scale));
      const node = h('div', { class: 'fp-beam' }, h('div', { class: 'fp-beam-cap' }));
      node.style.height = `${th}px`;
      node.style.setProperty('--fl', `${Math.max(2, Math.round(th / 4))}px`);
      node.style.setProperty('--st', `${Math.max(8, Math.round(th * 1.5))}px`);
      root.appendChild(node);
      beam = { el, node, th, t0: now(), out: false, tOut: 0 };
      faceTo(el);
      placeBeam(now());
      return beam;
    }
    function hideBeam(instant) {
      if (!beam) return;
      if (instant || reduced) {
        beam.node.remove();
        beam = null;
        return;
      }
      if (!beam.out) {
        beam.out = true;
        beam.tOut = now();
      }
    }
    function placeBeam(t) {
      if (!beam) return;
      if (!beam.el.isConnected || S.mode !== 'ground') {
        hideBeam(true);
        return;
      }
      const g = beamGeom(beam.el);
      let k = reduced ? 1 : Math.min(1, (t - beam.t0) / 240);
      if (beam.out) {
        k = Math.max(0, 1 - (t - beam.tOut) / 160);
        if (k <= 0) {
          beam.node.remove();
          beam = null;
          return;
        }
      }
      // 처음엔 빠르게 뻗고 끝에서 천천히 멈춘다
      const e = k >= 1 ? 1 : 1 - Math.pow(1 - k, 3);
      const n = beam.node;
      n.style.width = `${Math.max(1, Math.round(g.len * e))}px`;
      n.style.transform = `translate(${Math.round(g.x)}px, ${Math.round(g.y - beam.th / 2)}px) rotate(${g.ang}rad)`;
    }
    /** 말풍선이 떠 있는 동안 빔으로 가리키고, 닫히면 접는다 */
    async function withBeam(el, fn) {
      const b = showBeam(el);
      try {
        return await fn();
      } finally {
        if (b && beam === b) hideBeam(false);
      }
    }
    function updateFlashes(t) {
      placeBeam(t);
      for (let i = flashes.length - 1; i >= 0; i--) {
        const it = flashes[i];
        if (t > it.until || !it.el.isConnected) {
          it.f.remove();
          flashes.splice(i, 1);
        } else placeFlash(it);
      }
    }
    function spotlight(el) {
      clearSpotlight();
      S.spot = flash(el, 0, true);
    }
    function clearSpotlight() {
      if (S.spot) S.spot.until = 0;
      S.spot = null;
    }

    // ── 펑 연기 ──
    function puff(x, y) {
      if (reduced) return;
      const k = S.size / 96;
      for (let i = 0; i < 11; i++) {
        const sz = Math.round((6 + Math.random() * 8) * k);
        const p = h('div', { class: 'fp-puff' });
        p.style.width = `${sz}px`;
        p.style.height = `${sz}px`;
        p.style.left = `${x - sz / 2}px`;
        p.style.top = `${y - sz / 2}px`;
        root.appendChild(p);
        const ang = (i / 11) * Math.PI * 2 + Math.random() * 0.5;
        const d = (26 + Math.random() * 30) * k;
        if (!p.animate) {
          later(() => p.remove(), 500);
          continue;
        }
        const an = p.animate(
          [
            { transform: 'translate(0,0) scale(1)', opacity: 1 },
            { transform: `translate(${Math.cos(ang) * d}px,${Math.sin(ang) * d - 12 * k}px) scale(.2)`, opacity: 0 },
          ],
          { duration: 480 + Math.random() * 240, easing: 'cubic-bezier(.2,.7,.3,1)' },
        );
        an.onfinish = () => p.remove();
      }
    }
    function petCenter() {
      const b = petBox();
      return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
    }

    // ── 기능 설명 ──
    function labelOf(el) {
      if (!el) return '';
      return (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    }
    function targetInfo(key, el) {
      const t = guide.targets[key];
      if (isObj(t) && (t.short || t.title)) {
        return { key, title: t.title || labelOf(el) || key, short: t.short || t.title, lines: arr(t.lines).filter(Boolean), req: arr(t.req).filter(Boolean), soon: t.soon || null };
      }
      if (!guide.real && el) {
        const label = labelOf(el);
        if (label) return { key, title: label, short: `${label} 메뉴예요.`, lines: ['설명 파일(guide-content.js)이 없어 자세한 설명은 아직 없어요.'], req: [], soon: null };
      }
      return null;
    }
    function besideX(el) {
      const r = el.getBoundingClientRect();
      const gap = halfW() + 10;
      if (S.x >= r.right) return r.right + gap;
      if (S.x <= r.left) return r.left - gap;
      return S.x;
    }
    function faceTo(el) {
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      if (Math.abs(cx - S.x) > 4) S.facing = cx < S.x ? -1 : 1;
    }
    function speechAnimFor(el) {
      if (!el) return 'talk';
      const r = el.getBoundingClientRect();
      const gap = Math.max(0, r.left - S.x, S.x - r.right);
      return gap > 12 && gap < 300 ? 'point' : 'talk';
    }
    async function sayInfo(info, tok, el) {
      const tag = info.soon ? `준비 중 (${info.soon})` : null;
      const ok = { label: '확인', value: 'ok' };
      // 레일 탭처럼 다른 화면으로 가는 링크를 설명할 때는 바로 그 화면으로 가는 버튼도 둔다
      const nav = navAction(el);
      const res = await showBubble(info.short, {
        title: info.title,
        tag,
        anim: speechAnimFor(el),
        closable: true,
        anchor: el,
        actions: info.lines.length ? [ok, nav, { label: '더 알려줘', value: 'more', primary: true }] : [nav, Object.assign({ primary: true }, ok)],
      });
      if (res === 'nav') {
        goNav(navHrefOf(el));
        return;
      }
      if (res !== 'more' || tok !== S.seq) return;
      for (let i = 0; i < info.lines.length; i++) {
        const last = i === info.lines.length - 1;
        const r = await showBubble(info.lines[i], {
          title: info.title,
          tag,
          step: info.lines.length > 1 ? `${i + 1}/${info.lines.length}` : null,
          note: last && info.req.length ? info.req.join(' · ') : null,
          closable: true,
          anchor: el,
          actions: last ? [navAction(el), Object.assign({ primary: true }, ok)] : [ok, { label: '다음', value: 'next', primary: true }],
        });
        if (r === 'nav') {
          goNav(navHrefOf(el));
          return;
        }
        if (tok !== S.seq || (!last && r !== 'next')) return;
      }
    }
    /** 마우스를 올려 설명할 수 없는 때 (기능 설명·항목 읽기·용어 설명이 같은 간격을 쓴다) */
    function hoverBlocked(key, t) {
      if (!S.explain || S.mode === 'hidden' || S.mode === 'drag' || S.mode === 'boot' || S.booting || S.tour || chat.el || S.menu || S.picker || S.press) return true;
      // 안내·'그 화면 알려줘' 같은 사용자가 시킨 흐름은 마우스가 지나가도 끊지 않는다
      if (t < S.noHoverUntil || S.flow === S.seq) return true;
      const data = /^(item|term):/.test(key || '');
      if (S.lastExplain.key === key && t - S.lastExplain.t < (data ? SAME_ITEM_GAP : SAME_EXPLAIN_GAP)) return true;
      if (t - S.lastExplain.t < (data ? ITEM_EXPLAIN_GAP : ANY_EXPLAIN_GAP)) return true;
      return bubble.visible && bubble.sticky;
    }
    /** 간격 때문에만 막혔으면 얼마 뒤 다시 볼지(ms). 0이면 다른 이유로 막혔거나 막히지 않았다 */
    function hoverRetryIn(kind, t) {
      if (!S.explain || S.mode === 'hidden' || S.mode === 'drag' || S.booting || S.tour || chat.el || S.menu || S.picker || S.press) return 0;
      if (bubble.visible && bubble.sticky) return 0;
      const gap = kind === 'target' ? ANY_EXPLAIN_GAP : ITEM_EXPLAIN_GAP;
      let w = Math.max(S.noHoverUntil - t, S.lastExplain.t + gap - t);
      // 펫이 사용자가 시킨 일을 하는 중이면 끝날 때까지 기다렸다 다시 본다
      if (S.flow === S.seq) w = Math.max(w, 400);
      return w > 0 ? w + 40 : 0;
    }
    async function explainEl(el, fromHover) {
      const key = el.getAttribute('data-pet-target');
      const info = targetInfo(key, el);
      if (!info) return;
      const t = now();
      if (!el.isConnected) return;
      if (fromHover && hoverBlocked(key, t)) return;
      S.lastExplain = { key, t };
      const tok = begin();
      if (!fromHover) S.flow = tok;
      finishWalk(false);
      if (S.sleeping) wake(true);
      try {
        const railTab = el.hasAttribute('data-pet-perch') && !!climbColumnOf(el);
        if (S.roam && !reduced && railTab) {
          // 레일 탭은 레일을 타고 그 탭까지 올라가 앉아서 설명한다
          if (S.mode !== 'ground' && S.mode !== 'hidden') {
            const landed = await waitLanding();
            if (!landed || tok !== S.seq) return;
          }
          if (S.mode === 'ground' && !(S.surface && S.surface.el === el)) {
            const ok = await travelTo(el, tok, { run: true, sitAfter: true });
            if (tok !== S.seq) return;
            if (!ok && S.mode !== 'ground') return;
          }
        } else if (S.roam && S.mode === 'ground' && !reduced) {
          const [mn, mx] = surfaceRange();
          const goal = clamp(besideX(el), mn, mx);
          if (Math.abs(goal - S.x) > 24) {
            const ok = await walkTo(goal, { run: true });
            if (!ok || tok !== S.seq) return;
          }
        }
        // 가는 사이 화면이 바뀌어 그 요소가 빠졌으면 설명하지 않는다
        if (tok !== S.seq || !el.isConnected) return;
        faceTo(el);
        await sayInfo(info, tok, el);
      } finally {
        end(tok);
      }
    }

    // ── 항목 읽기 (data-pet-item) · 용어 설명 (th · dt · data-pet-term) ──
    const MAX_FIELDS = 6;
    const clip = (s, n) => {
      const a = Array.from(String(s || ''));
      return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join('');
    };
    const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const textOf = (el) => (el ? el.innerText || el.textContent || '' : '');
    // 이름 없는 열(선택 체크박스·버튼 칸)이나 이런 이름의 열은 읽지 않는다
    const SKIP_HEAD = /^(선택|작업|관리|동작|액션|더보기)$/;
    // 대신 눌러 주면 안 되는 버튼(되돌릴 수 없는 일)
    const RISKY_BTN = /삭제|취소|반려|확정|승인|제거|보내기|저장|등록|해제|비활성/;
    function fieldList(fields) {
      const dl = h('dl', { class: 'fp-b-fields' });
      for (const [name, value] of fields) dl.append(h('dt', { text: name || '·' }), h('dd', { text: value }));
      return dl;
    }
    /** 행들을 colSpan·rowSpan을 따져 칸 위치로 편다. onRow(행 번호, 이 행에서 시작한 칸들, 위 행에서 내려온 칸들) */
    function layoutRows(rows, upto, onRow) {
      const carry = [];
      const last = Math.min(upto, rows.length - 1);
      for (let ri = 0; ri <= last; ri++) {
        const from = [];
        const seen = new Set();
        for (let c = 0; c < carry.length; c++) {
          const k = carry[c];
          if (k && k.until >= ri && !seen.has(k.cell)) {
            seen.add(k.cell);
            from.push(k);
          }
        }
        const own = [];
        let col = 0;
        for (const cell of rows[ri].cells) {
          while (carry[col] && carry[col].until >= ri) col++;
          const span = Math.max(1, cell.colSpan || 1);
          const k = { cell, col, span, until: ri + Math.max(1, cell.rowSpan || 1) - 1 };
          own.push(k);
          for (let j = 0; j < span; j++) carry[col + j] = k;
          col += span;
        }
        onRow(ri, own, from);
      }
    }
    function headText(th) {
      const t = th.getAttribute('data-pet-term') || textOf(th);
      return clip(flat(t).replace(/[▲▼△▽↑↓⇅↕]/g, '').trim(), 24);
    }
    /** 표 머리글: 칸 번호 → 머리글 글자 (여러 줄 머리글이면 가장 아래 줄) */
    function tableHeads(table) {
      let rows = table.tHead ? Array.from(table.tHead.rows) : [];
      if (!rows.length) {
        const first = table.rows[0];
        if (first && first.querySelector('th') && !first.querySelector('td')) rows = [first];
      }
      const heads = [];
      layoutRows(rows, rows.length - 1, (ri, own) => {
        for (const k of own) {
          const t = headText(k.cell);
          if (!t) continue;
          for (let j = 0; j < k.span; j++) heads[k.col + j] = t;
        }
      });
      return heads;
    }
    const SKIP_INPUT = /^(hidden|checkbox|radio|button|submit|reset|file|image)$/i;
    /** 칸의 값 글자. 입력칸(라우팅·배합 원단위 표 등)은 화면 글자가 비므로 입력값·고른 항목 이름을 대신 읽는다 */
    function valueText(el) {
      if (!el.querySelector('input,select,textarea') && !el.matches('input,select,textarea')) return flat(textOf(el));
      let out = '';
      const walk = (n, depth) => {
        if (depth > 12) return;
        if (n.nodeType === 3) {
          out += n.nodeValue;
          return;
        }
        if (n.nodeType !== 1) return;
        const tag = n.tagName;
        if (tag === 'SELECT') {
          const o = n.selectedOptions && n.selectedOptions[0];
          out += ` ${o && o.value !== '' ? o.textContent : ''} `;
          return;
        }
        if (tag === 'INPUT') {
          if (!SKIP_INPUT.test(n.type || '')) out += ` ${n.value} `;
          return;
        }
        if (tag === 'TEXTAREA') {
          out += ` ${n.value} `;
          return;
        }
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'OPTION' || n.hidden) return;
        for (const c of n.childNodes) walk(c, depth + 1);
      };
      walk(el, 0);
      return flat(out);
    }
    /** 버튼·체크박스만 있는 칸 */
    function onlyControls(cell) {
      const t = valueText(cell);
      if (!t) return true;
      const btns = cell.querySelectorAll('button,[role="button"]');
      if (!btns.length) return false;
      let bt = '';
      btns.forEach((b) => {
        bt += b.textContent || '';
      });
      return flat(bt).replace(/\s/g, '') === t.replace(/\s/g, '');
    }
    const sameAsTitle = (v, title) => !!title && (v === title || v.indexOf(title) >= 0);
    function tableFields(tr, title) {
      const table = tr.closest('table');
      const sec = tr.parentElement;
      if (!table || !sec || !sec.rows) return null;
      const heads = tableHeads(table);
      const rows = sec.rows;
      const idx = Array.prototype.indexOf.call(rows, tr);
      if (idx < 0) return null;
      let cells = [];
      // 위 행에서 rowSpan으로 내려온 칸(같은 수주의 수주번호·고객사 등)도 이 행의 값으로 읽는다
      layoutRows(rows, idx, (ri, own, from) => {
        if (ri === idx) cells = from.concat(own).sort((a, b) => a.col - b.col);
      });
      const out = [];
      for (const k of cells) {
        let name = '';
        for (let j = 0; j < k.span && !name; j++) name = heads[k.col + j] || '';
        if (!name || SKIP_HEAD.test(name) || onlyControls(k.cell)) continue;
        const v = clip(valueText(k.cell), 40);
        if (!v || sameAsTitle(v, title)) continue;
        out.push([name, v]);
        if (out.length >= MAX_FIELDS) break;
      }
      return out;
    }
    /** 표 행에서 위 행의 rowSpan으로 내려온 칸들 */
    function carriedCells(tr) {
      const sec = tr.parentElement;
      if (!sec || !sec.rows) return [];
      const idx = Array.prototype.indexOf.call(sec.rows, tr);
      if (idx <= 0) return [];
      let out = [];
      layoutRows(sec.rows, idx, (ri, own, from) => {
        if (ri === idx) out = from.map((k) => k.cell);
      });
      return out;
    }
    /** 글자가 없는 항목(막대 등)은 title·aria-label을 읽는다 (자신 → 안의 첫 요소). 줄바꿈·' · '·', '로 나눈다 */
    function labelParts(el) {
      let s = el.getAttribute('title') || el.getAttribute('aria-label') || '';
      if (!s.trim()) {
        const d = el.querySelector('[title],[aria-label]');
        if (d) s = d.getAttribute('title') || d.getAttribute('aria-label') || '';
      }
      return s
        .split(/\n+| · |·|, /)
        .map(flat)
        .filter(Boolean);
    }
    function partFields(parts, title) {
      const out = [];
      for (const p of parts) {
        if (sameAsTitle(p, title) && p.length <= title.length + 1) continue;
        const m = /^([^:：]{1,16})[:：]\s*(.+)$/.exec(p);
        out.push(m ? [flat(m[1]), clip(flat(m[2]), 40)] : ['', clip(p, 40)]);
        if (out.length >= MAX_FIELDS) break;
      }
      return out;
    }
    function boxFields(el, title, skip) {
      const out = [];
      let named = Array.from(el.querySelectorAll('[data-pet-field]'));
      // 표 행: rowSpan으로 위에서 내려온 칸의 이름 붙은 값(같은 수주의 수주번호·고객사)도 앞에 둔다
      if (named.length && el.tagName === 'TR') {
        const up = [];
        for (const c of carriedCells(el)) {
          if (c.hasAttribute('data-pet-field')) up.push(c);
          else up.push(...c.querySelectorAll('[data-pet-field]'));
        }
        named = up.concat(named);
      }
      if (named.length) {
        for (const f of named) {
          const v = clip(valueText(f), 40);
          if (v && !sameAsTitle(v, title)) out.push([clip(flat(f.getAttribute('data-pet-field')), 16), v]);
          if (out.length >= MAX_FIELDS) break;
        }
        return out;
      }
      const dts = el.querySelectorAll('dt');
      if (dts.length) {
        for (const dt of dts) {
          const dd = dt.nextElementSibling;
          if (!dd || dd.tagName !== 'DD') continue;
          const v = clip(valueText(dd), 40);
          if (v) out.push([clip(flat(textOf(dt)), 16), v]);
          if (out.length >= MAX_FIELDS) break;
        }
        if (out.length) return out;
      }
      // 이름 없는 상자: 줄 단위 글자를 그대로 (같은 줄·제목·종류 이름은 빼고)
      const seen = new Set([title, skip].filter(Boolean));
      for (const line of textOf(el).split(/[\n\t]+/)) {
        const v = clip(flat(line), 40);
        if (!v || seen.has(v) || sameAsTitle(v, title)) continue;
        seen.add(v);
        out.push(['', v]);
        if (out.length >= MAX_FIELDS) break;
      }
      return out;
    }
    function isClickable(el) {
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      if (el.matches('a[href],button,[role="button"],[role="link"],[role="option"],[role="tab"]')) return true;
      try {
        return global.getComputedStyle(el).cursor === 'pointer';
      } catch (e) {
        return false;
      }
    }
    /** '열기'로 대신 누를 요소: 항목 자체(링크·버튼·누를 수 있는 행) → 항목을 감싼 링크·버튼 → 안의 첫 링크 → 안의 버튼 하나(되돌릴 수 없는 일이 아닐 때) */
    function openTargetOf(el) {
      if (!el || !el.isConnected) return null;
      if (isClickable(el)) return el;
      const up = el.parentElement && el.parentElement.closest('a[href],button,[role="button"],[role="link"]');
      if (up && !root.contains(up)) return up;
      const link = el.querySelector('a[href]');
      if (link) return link;
      const btns = el.querySelectorAll('button:not([disabled]),[role="button"]:not([aria-disabled="true"])');
      if (btns.length === 1 && !RISKY_BTN.test(flat(btns[0].textContent) + (btns[0].getAttribute('aria-label') || ''))) return btns[0];
      return null;
    }
    function itemConfig(kind) {
      const c = kind ? guide.items[kind] : null;
      return isObj(c) ? c : {};
    }
    /** 항목 하나를 읽는다 → { kind, head, title, fields, tip, more, code } */
    function readItem(el) {
      const kind = el.getAttribute('data-pet-item') || '';
      const cfg = itemConfig(kind);
      const name = typeof cfg.name === 'string' ? cfg.name.trim() : '';
      let text = textOf(el);
      // 글자가 없는 항목(일자별 막대 등)은 title·aria-label이 곧 데이터다
      const parts = flat(text) ? null : labelParts(el);
      if (parts) text = parts.join('\n');
      const given = flat(el.getAttribute('data-pet-item-title'));
      const code = codeIn(given) || codeIn(text);
      // 표 행의 innerText는 칸을 탭으로 잇는다: 첫 줄의 첫 글자 칸
      const firstLine = text
        .split(/\n+/)
        .map((ln) => ln.split(/\t+/).map(flat).find(Boolean) || '')
        .find(Boolean) || '';
      const title = clip(given || code || flat(firstLine), 40);
      // 이름 붙은 값(data-pet-field)이 있으면 그것 → 표 행은 머리글과 짝 → 상자는 dt/dd·줄 단위
      let fields = null;
      if (parts) fields = partFields(parts, title);
      else if (el.tagName === 'TR' && !el.querySelector('[data-pet-field]')) fields = tableFields(el, title);
      if (!fields || !fields.length) fields = parts ? fields || [] : boxFields(el, title, name);
      // 상태 한마디: 배지·태그 글자와 똑같은 상태 이름 → 없으면 항목 글자에 들어 있는 가장 긴 상태 이름('승인'보다 '승인 대기')
      let tip = '';
      if (isObj(cfg.status)) {
        const keys = Object.keys(cfg.status).filter((k) => k && typeof cfg.status[k] === 'string');
        let best = '';
        const badges = el.querySelectorAll('[data-pet-term],[data-status],[class*="badge"],[class*="Badge"],[class*="tag"],[class*="Tag"]');
        for (const b of badges) {
          const bt = normTerm(b.textContent);
          if (!bt) continue;
          const k = keys.find((x) => normTerm(x) === bt);
          if (k) {
            best = k;
            break;
          }
        }
        if (!best) for (const k of keys) if (k.length > best.length && (text.indexOf(k) >= 0 || normTerm(text).indexOf(normTerm(k)) >= 0)) best = k;
        if (best) tip = cfg.status[best];
      }
      const tips = arr(cfg.tips).filter((s) => typeof s === 'string' && s.trim());
      const more = tip ? tips : tips.slice(1);
      if (!tip && tips.length) tip = tips[0];
      if (!tip && !fields.length) tip = '이 항목이에요.';
      return { kind, head: `${name} ${title}`.trim() || '항목', title, fields, tip, more, code };
    }
    /** 항목의 '열기'. 다른 화면으로 가는 링크면 라우터로, 아니면 그 요소를 누른다 */
    function openItem(el) {
      const c = openTargetOf(el);
      if (!c) return false;
      S.noHoverUntil = now() + 1500;
      const nav = c.matches('a[href]') ? navHrefOf(c) : null;
      if (nav) return goNav(nav);
      try {
        c.click();
      } catch (e) {
        return false;
      }
      return true;
    }
    /** 펫이 서 있는 면 위에서만 그 요소 옆으로 걸어간다 (레일·사다리는 타지 않는다) */
    async function approachEl(el, tok) {
      if (S.roam && S.mode === 'ground' && !reduced) {
        const [mn, mx] = surfaceRange();
        const goal = clamp(besideX(el), mn, mx);
        if (Math.abs(goal - S.x) > 24) {
          const ok = await walkTo(goal, { run: true });
          if (!ok || tok !== S.seq) return false;
        }
      }
      return tok === S.seq && el.isConnected;
    }
    /** 이 요소 바로 위(가장 가까운 윗면)에 있는 앉을 면. 레일 탭은 빼고, 데이터와 너무 멀면(600px) 쓰지 않는다 */
    function perchAbove(el) {
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      let best = null;
      for (const p of listPerches(true)) {
        if (p.col || p.el === el || climbColumnOf(p.el)) continue;
        if (cx < p.rawLeft - 4 || cx > p.rawRight + 4) continue;
        if (p.top > r.top + 4 || r.top - p.top > 600) continue;
        if (!best || p.top > best.top) best = p;
      }
      return best;
    }
    /**
     * 행·용어 쪽으로: 그 데이터를 품은 카드 윗면에 서서 가리킨다.
     * 이미 그 면이면 걸어가고, 아니면 펑 하고 옮겨 간다(사다리로 오르면 너무 오래 걸려 무엇을 읽는지 놓친다)
     */
    async function approachData(el, tok) {
      if (!S.roam || reduced || S.mode !== 'ground') return approachEl(el, tok);
      const r = el.getBoundingClientRect();
      const above = perchAbove(el);
      // 바로 위 카드 윗면이 가까우면 거기, 멀거나 없으면(목록 칸의 PP-… 상자 등) 그 항목 상자 위에 직접 올라선다
      let surfEl = above && r.top - above.top <= 220 ? above.el : null;
      if (!surfEl && el.hasAttribute('data-pet-item') && !climbColumnOf(el) && r.width >= 90 && r.height >= 16 && r.top > 70 && perchVisible(el, r)) surfEl = el;
      if (!surfEl && above) surfEl = above.el;
      if (!surfEl) return approachEl(el, tok);
      const p = { el: surfEl };
      const s = perchSurface(p.el, p.el.getBoundingClientRect());
      // 데이터 왼쪽 위에 서서 오른쪽을 보고 가리키게(왼쪽 끝이면 오른쪽 위)
      let gx = r.left + Math.min(36, r.width / 4);
      if (gx < s.left + 4) gx = Math.min(r.right - 12, s.right);
      gx = clamp(gx, s.left, Math.max(s.left, s.right));
      if (S.surface && S.surface.type === 'perch' && S.surface.el === p.el) {
        if (Math.abs(gx - S.x) > 24) {
          const ok = await walkTo(gx, { run: true });
          if (!ok || tok !== S.seq) return false;
        }
        return tok === S.seq && el.isConnected;
      }
      const from = petCenter();
      puff(from.x, from.y);
      S.base = 'idle';
      S.x = gx;
      landOn({ type: 'perch', el: p.el, off: gx - p.el.getBoundingClientRect().left }, p.el.getBoundingClientRect().top, true);
      const to = petCenter();
      puff(to.x, to.y);
      if (!(await wait(160, tok))) return false;
      return tok === S.seq && el.isConnected;
    }
    /** 읽는 동안 그 데이터를 테두리로 반짝여 무엇을 읽는지 보이게 한다 */
    async function withSpot(el, fn) {
      const f = flash(el, 0, true);
      try {
        return await fn();
      } finally {
        f.until = 0;
      }
    }
    async function sayItem(info, tok, el) {
      const ok = { label: '확인', value: 'ok' };
      const open = openTargetOf(el) ? { label: '열기', value: 'open' } : null;
      const acts = info.more.length ? [ok, open, { label: '더 알려줘', value: 'more', primary: true }] : [ok, open && Object.assign({ primary: true }, open)];
      if (!info.more.length && !open) acts[0] = Object.assign({ primary: true }, ok);
      const res = await showBubble(info.tip, { title: info.head, fields: info.fields, anim: speechAnimFor(el), closable: true, anchor: el, actions: acts });
      if (res === 'open') {
        openItem(el);
        return;
      }
      if (res !== 'more' || tok !== S.seq) return;
      for (let i = 0; i < info.more.length; i++) {
        const last = i === info.more.length - 1;
        const r = await showBubble(info.more[i], {
          title: info.head,
          step: info.more.length > 1 ? `${i + 1}/${info.more.length}` : null,
          closable: true,
          anchor: el,
          actions: last ? [openTargetOf(el) ? { label: '열기', value: 'open' } : null, Object.assign({ primary: true }, ok)] : [ok, { label: '다음', value: 'next', primary: true }],
        });
        if (r === 'open') {
          openItem(el);
          return;
        }
        if (tok !== S.seq || (!last && r !== 'next')) return;
      }
    }
    async function readItemEl(el, fromHover) {
      if (!el.isConnected) return;
      const info = readItem(el);
      const key = `item:${info.kind}:${info.title}`;
      const t = now();
      if (fromHover && hoverBlocked(key, t)) return;
      S.lastExplain = { key, t };
      const tok = begin();
      if (!fromHover) S.flow = tok;
      finishWalk(false);
      if (S.sleeping) wake(true);
      try {
        if (!(await approachData(el, tok))) return;
        faceTo(el);
        await withSpot(el, () => sayItem(info, tok, el));
      } finally {
        end(tok);
      }
    }
    /** 용어 설명 범위: 가까운 data-pet-target 키부터 바깥으로, 그다음 지금 화면, 그다음 '*' */
    function termScopes(el) {
      const out = [];
      let a = el.closest('[data-pet-target]');
      for (let guard = 0; a && guard < 12; guard++) {
        const k = a.getAttribute('data-pet-target');
        if (k && !out.includes(k)) out.push(k);
        a = a.parentElement ? a.parentElement.closest('[data-pet-target]') : null;
      }
      if (S.screen && !out.includes(S.screen)) out.push(S.screen);
      out.push('*');
      return out;
    }
    function lookupTerm(term, scopes) {
      const a = normTerm(term);
      const b = normTerm(bareTerm(term));
      if (!a) return null;
      for (const sc of scopes) {
        const m = guide.glossary[sc];
        if (!m) continue;
        const e = m.get(a) || (b ? m.get(b) : null);
        if (e) return { term: e.term, text: e.text, scope: sc };
      }
      return null;
    }
    /** 머리글·라벨 요소의 용어 설명. 용어집에 없으면 null (라벨을 그대로 읽지 않는다) */
    function termOf(el) {
      const attr = el.getAttribute('data-pet-term');
      const raw = attr !== null && attr.trim() ? attr : el.tagName === 'TH' ? headText(el) : flat(el.textContent);
      if (!raw || raw.length > 40) return null;
      return lookupTerm(raw, termScopes(el));
    }
    async function explainTerm(el, g, fromHover) {
      if (!el.isConnected || !g) return;
      const key = `term:${g.scope}:${g.term}`;
      const t = now();
      if (fromHover && hoverBlocked(key, t)) return;
      S.lastExplain = { key, t };
      const tok = begin();
      if (!fromHover) S.flow = tok;
      finishWalk(false);
      if (S.sleeping) wake(true);
      try {
        if (!(await approachData(el, tok))) return;
        faceTo(el);
        await withSpot(el, () => showBubble(g.text, { title: g.term, anim: speechAnimFor(el), closable: true, anchor: el }));
      } finally {
        end(tok);
      }
    }
    /** 레코드 번호로 화면의 항목을 찾는다. data-pet-item 먼저, 없으면 본문 글자에서 (펫 창 안은 빼고) */
    function findItemByCode(code) {
      const C = String(code || '').toUpperCase();
      if (!C) return null;
      const vis = (el) => {
        if (root.contains(el) || el.closest('[data-pet-ignore]')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      let loose = null;
      for (const el of doc.querySelectorAll('[data-pet-item]')) {
        const given = (el.getAttribute('data-pet-item-title') || '').toUpperCase();
        if (given === C && vis(el)) return el;
        // 항목 안에 항목이 있으면 더 안쪽 것
        if ((el.textContent || '').toUpperCase().indexOf(C) >= 0 && (!loose || loose.contains(el)) && vis(el)) loose = el;
      }
      if (loose) return loose;
      const scope = doc.querySelector('main') || doc.body;
      const walker = doc.createTreeWalker(scope, global.NodeFilter ? global.NodeFilter.SHOW_TEXT : 4);
      for (let n = walker.nextNode(), i = 0; n && i < 20000; n = walker.nextNode(), i++) {
        if (!n.nodeValue || n.nodeValue.toUpperCase().indexOf(C) < 0) continue;
        const p = n.parentElement;
        if (!p || root.contains(p)) continue;
        const host = p.closest('[data-pet-item],tr,li,[role="row"],[role="option"],a[href],button') || p;
        if (vis(host)) return host;
      }
      return null;
    }
    /** 대화창의 '가리켜 줘': 항목까지 가서 반짝이고 읽어 준다. 그 사이 다시 그려졌으면 번호로 다시 찾는다 */
    async function pointAtItem(el, code) {
      closeChat();
      S.noHoverUntil = now() + 1500;
      const target = el && el.isConnected ? el : findItemByCode(code);
      if (!target) return;
      const tok = begin();
      S.flow = tok;
      try {
        const ok = await goToEl(target, tok);
        if (!ok || tok !== S.seq || !target.isConnected) return;
        await withSpot(target, () => sayItem(readItem(target), tok, target));
      } finally {
        end(tok);
      }
    }

    // ── 요소 쪽으로 가기 (안내·대화의 '그 화면 알려줘') ──
    /**
     * 공중에 떠 있는 버튼처럼 올라설 수 없는 요소: 펫이 그 요소를 가리지 않으면서 손이 가장 가까워지는 자리.
     * 바닥과 보이는 윗면(레일 탭 제외)마다 요소 왼쪽·오른쪽 옆 자리를 재 보고 가장 가까운 곳을 고른다
     */
    function standSpotFor(el) {
      const r = el.getBoundingClientRect();
      const box = petBox();
      const pw = box.right - box.left;
      const ph = box.bottom - box.top;
      const cx = (r.left + r.right) / 2;
      const [fl, fr] = floorRange();
      const cands = [{ type: 'floor', el: null, top: floorY(), left: fl, right: fr, narrow: false }];
      for (const p of listPerches(true)) {
        if (p.col || p.el === el || el.contains(p.el)) continue;
        cands.push({ type: 'perch', el: p.el, top: p.top, left: p.left, right: p.right, narrow: p.narrow });
      }
      let best = null;
      const gapX = pw / 2 + 10;
      for (const c of cands) {
        const xs = c.narrow ? [c.left] : [r.left - gapX, r.right + gapX, cx];
        for (const want of xs) {
          const x = clamp(want, c.left, Math.max(c.left, c.right));
          const body = { left: x - pw / 2, right: x + pw / 2, top: c.top - ph, bottom: c.top };
          // 펫 몸이 요소를 가리면 그 자리는 쓰지 않는다
          if (body.right > r.left - 2 && body.left < r.right + 2 && body.bottom > r.top - 2 && body.top < r.bottom + 2) continue;
          const hx = x < cx ? body.right : body.left;
          const hy = c.top - ph * 0.55;
          const dx = Math.max(r.left - hx, 0, hx - r.right);
          const dy = Math.max(r.top - hy, 0, hy - r.bottom);
          // 바닥에서 멀리 가리키기보다 가까운 윗면으로 오르는 편을 고르되, 오르는 수고도 조금 친다
          const cost = Math.hypot(dx, dy) + (c.type === 'perch' ? 24 : 0) + Math.abs(x - S.x) * 0.02;
          if (!best || cost < best.cost) best = { c, x, cost };
        }
      }
      return best;
    }
    async function goToEl(el, tok) {
      if (!el || !el.isConnected) return false;
      if (S.mode === 'hidden') show(true);
      if (S.mode === 'air' || S.mode === 'jump' || S.mode === 'boot' || S.mode === 'climb') {
        const ok = await waitLanding();
        if (!ok) return false;
      }
      if (S.mode !== 'ground' || tok !== S.seq || !el.isConnected) return false;
      if (S.sleeping) wake(true);
      let r = el.getBoundingClientRect();
      const offscreen = r.bottom < 40 || r.top > H() - 40 || r.right < 0 || r.left > W();
      const covered = (() => {
        if (offscreen) return true;
        const px = clamp((r.left + r.right) / 2, 1, W() - 1);
        const py = clamp(r.top + Math.min(12, r.height / 2), 1, H() - 1);
        const at = probe(px, py);
        return !!at && at !== el && !el.contains(at) && !root.contains(at) && !at.contains(el);
      })();
      if (covered) {
        scrollToSee(el, r);
        if (!(await wait(reduced ? 60 : 520, tok))) return false;
        if (!el.isConnected) return false;
        r = el.getBoundingClientRect();
      }
      const isPerch = el.hasAttribute('data-pet-perch') && !perchExcluded(el) && perchVisible(el, r);
      if (reduced) {
        puff(petCenter().x, petCenter().y);
        S.base = 'idle';
        if (isPerch) {
          const s = perchSurface(el, r);
          S.x = clamp(S.x, s.left + 10, Math.max(s.left + 10, s.right - 10));
          landOn({ type: 'perch', el, off: S.x - r.left }, r.top, true);
        } else {
          // 공중의 요소: 움직임 없이 가장 가까운 설 자리로 바로 옮긴다
          const spot = standSpotFor(el);
          if (spot && spot.c.type === 'perch' && spot.c.el.isConnected) {
            const pr = spot.c.el.getBoundingClientRect();
            S.x = spot.x;
            landOn({ type: 'perch', el: spot.c.el, off: spot.x - pr.left }, pr.top, true);
          } else {
            const [mn, mx] = floorRange();
            S.x = clamp(spot ? spot.x : besideX(el), mn, mx);
            landOn({ type: 'floor' }, floorY(), true);
          }
        }
        faceTo(el);
        return true;
      }
      if (isPerch) {
        // 길 찾기: 바닥 → 짧은 사다리 여러 번 / 레일 타기 / 점프
        const path = S.surface && S.surface.el === el ? [] : planPath(el);
        if (path) {
          const ok = await followPath(path, tok, { run: true, sitAfter: true });
          if (!ok || tok !== S.seq) return false;
        } else if (!(S.surface && S.surface.type === 'perch' && S.surface.el === el)) {
          let s = perchSurface(el, r);
          let lx = clamp(S.x, s.left + 10, Math.max(s.left + 10, s.right - 10));
          if (Math.abs(lx - S.x) > 360) {
            const [mn, mx] = surfaceRange();
            const ok = await walkTo(clamp(lx - Math.sign(lx - S.x) * 260, mn, mx), { run: true });
            if (!ok || tok !== S.seq || !el.isConnected) return false;
            r = el.getBoundingClientRect();
            s = perchSurface(el, r);
            lx = clamp(S.x, s.left + 10, Math.max(s.left + 10, s.right - 10));
          }
          const ok = await jumpTo({ type: 'perch', el, off: lx - r.left });
          if (!ok || tok !== S.seq) return false;
          await waitLanding();
        }
      } else {
        // 공중의 요소: 가장 가까이 설 수 있는 윗면이 있으면 거기로 올라가 그 요소 옆에 선다 (가리키는 건 H빔이 한다)
        const spot = standSpotFor(el);
        if (spot && spot.c.type === 'perch' && spot.c.el.isConnected) {
          const onIt = S.surface && S.surface.type === 'perch' && S.surface.el === spot.c.el;
          if (!onIt) {
            const ok = await goToEl(spot.c.el, tok);
            if (!ok || tok !== S.seq || !el.isConnected) return false;
          }
          if (S.base === 'sit') setBase('idle');
          const [sl, sr] = surfaceRange();
          if (Math.abs(clamp(spot.x, sl, sr) - S.x) > 6) {
            const ok = await walkTo(clamp(spot.x, sl, sr), { run: true });
            if (!ok || tok !== S.seq) return false;
          }
          if (!el.isConnected) return false;
          faceTo(el);
          return tok === S.seq;
        }
        const [mn, mx] = floorRange();
        const goal = clamp(spot ? spot.x : besideX(el), mn, mx);
        if (S.surface && S.surface.type === 'perch') {
          // 바닥으로: 레일 탭이면 타고 내려오고, 위젯이면 뛰어내린다
          const down = planPath(null);
          if (down && down.length) {
            const ok = await followPath(down, tok, { run: true });
            if (!ok || tok !== S.seq) return false;
          } else {
            const jx = S.x + clamp(goal - S.x, -280, 280);
            const ok = await jumpTo({ type: 'floor', x: jx });
            if (!ok || tok !== S.seq) return false;
            await waitLanding();
          }
          if (tok !== S.seq || !el.isConnected) return false;
        }
        const ok = await walkTo(goal, { run: true });
        if (!ok || tok !== S.seq) return false;
      }
      if (!el.isConnected) return false;
      faceTo(el);
      return tok === S.seq;
    }
    async function goTo(key) {
      const el = findTarget(key);
      if (!el) return false;
      closePanels();
      const tok = begin();
      S.flow = tok;
      finishWalk(false);
      try {
        const ok = await goToEl(el, tok);
        if (ok && tok === S.seq) {
          flash(el, 2000);
          if (showBeam(el)) later(() => hideBeam(false), 2400);
          if (speechAnimFor(el) === 'point') {
            player.set('point', true);
            later(() => {
              if (player.name === 'point' && !bubble.visible && S.mode === 'ground') player.set(S.base);
            }, 1800);
          }
        }
        return ok;
      } finally {
        end(tok);
      }
    }
    async function showMe(key) {
      closeChat();
      S.noHoverUntil = now() + 1500;
      const el = findTarget(key);
      if (!el) return;
      const tok = begin();
      S.flow = tok;
      try {
        const ok = await goToEl(el, tok);
        if (!ok || tok !== S.seq || !el.isConnected) return;
        flash(el, 2200);
        const info = targetInfo(key, el);
        if (info) await withBeam(el, () => sayInfo(info, tok, el));
      } finally {
        end(tok);
      }
    }

    // ── 안내 (tour) ──
    // 처음 안내(guide.tour, kind 'main')와 화면 안내(guide.screens[키], kind 'screen')는 같은 모양으로 돈다.
    // 화면 안내는 intro 말풍선(가리키는 곳 없음)부터 보이고, 그 화면에 있는 target 단계만 이어 간다.
    function targetTitle(key) {
      const t = key ? guide.targets[key] : null;
      return isObj(t) && t.title ? t.title : null;
    }
    async function runTour(spec) {
      const steps = spec.steps.filter((st) => findTarget(st.target));
      const items = spec.intro.map((text) => ({ text, target: null })).concat(steps);
      if (S.mode === 'hidden') show(true);
      closePanels();
      if (S.tour) endTour();
      if (!items.length) {
        showBubble('이 화면에는 안내할 곳이 없어요.');
        return false;
      }
      const tok = begin();
      finishWalk(false);
      if (S.sleeping) wake(true);
      S.tour = { tok, kind: spec.kind, key: spec.key || null };
      hideHint();
      const screenTitle = spec.kind === 'screen' ? targetTitle(spec.key) : null;
      let finished = false;
      let nav = null;
      for (let i = 0; i < items.length; i++) {
        const st = items[i];
        const last = i === items.length - 1;
        let el = null;
        let ok = false;
        if (st.target) {
          el = findTarget(st.target);
          if (!el) {
            if (last) finished = true;
            continue;
          }
          ok = await goToEl(el, tok);
          if (tok !== S.seq || !S.tour || S.tour.tok !== tok) break;
          if (!el.isConnected) {
            if (last) finished = true;
            continue;
          }
          if (ok) spotlight(el);
        }
        const actions = [];
        if (!last || spec.kind === 'main') actions.push({ label: '건너뛰기', value: 'skip' });
        if (el) actions.push(navAction(el));
        actions.push({ label: last ? (spec.kind === 'main' ? '끝' : '확인') : '다음', value: 'next', primary: true });
        if (el && ok) showBeam(el);
        else hideBeam(false);
        const res = await showBubble(st.text, {
          title: (st.target ? targetTitle(st.target) : null) || screenTitle,
          step: `${i + 1}/${items.length}`,
          sticky: true,
          closable: true,
          anchor: el,
          anim: el && ok ? speechAnimFor(el) : 'talk',
          actions,
        });
        if (res === 'nav') {
          nav = navHrefOf(el);
          break;
        }
        if (res !== 'next') break;
        if (last) finished = true;
      }
      hideBeam(false);
      // 다른 안내가 이어받았으면(그 안내의 강조를 지우지 않게) 손대지 않는다
      if (S.tour && S.tour.tok === tok) {
        S.tour = null;
        clearSpotlight();
      } else if (!S.tour) clearSpotlight();
      if (spec.kind === 'main') {
        store.set('toured', true);
        if (S.screen === 'dashboard') store.set('seen:dashboard', true);
      }
      if (tok === S.seq) {
        if (nav) {
          end(tok);
          goNav(nav);
          return false;
        }
        if (spec.kind === 'main') showBubble(finished ? '안내 끝! 궁금하면 저를 눌러 주세요.' : '안내는 우클릭 메뉴에서 다시 볼 수 있어요.');
        else if (!finished) showBubble('이 화면 안내는 우클릭 메뉴의 "이 화면 안내"로 다시 볼 수 있어요.');
        showHint();
        end(tok);
      }
      return finished;
    }
    function startTour() {
      return runTour({ kind: 'main', key: null, intro: [], steps: guide.tour });
    }
    /** 화면 안내. auto는 화면을 옮겨 처음 왔을 때(안내할 게 없으면 조용히 넘어간다) */
    function startScreenTour(key, auto) {
      const k = typeof key === 'string' && key ? key : S.screen;
      const sc = k ? guide.screens[k] : null;
      if (!sc) {
        if (!auto) showBubble('이 화면에는 따로 안내할 게 없어요.');
        return Promise.resolve(false);
      }
      store.set(`seen:${k}`, true);
      // 저절로 시작할 때 소개 문장도 없고 가리킬 곳도 하나 없으면(권한으로 안 보이는 화면 등) 조용히 넘어간다
      if (auto && !sc.intro.length && !sc.tour.some((st) => findTarget(st.target))) return Promise.resolve(false);
      return runTour({ kind: 'screen', key: k, intro: sc.intro, steps: sc.tour });
    }
    function endTour() {
      if (!S.tour) return;
      S.tour = null;
      clearSpotlight();
      closeBubble('skip');
    }

    // ── 화면 이동 ──
    /** 그 화면에 처음 왔을 때 할 안내: 대시보드에서 아직 처음 안내를 안 봤으면 'main', 화면 안내를 안 봤으면 'screen' */
    function guideKindFor(key) {
      if (!key) return null;
      if (key === 'dashboard' && !store.get('toured') && store.get('visited') && guide.tour.length) return 'main';
      if (guide.screens[key] && !store.get(`seen:${key}`)) return 'screen';
      return null;
    }
    function setScreen(key) {
      const k = typeof key === 'string' && key ? key : null;
      if (k === S.screen) return;
      S.screen = k;
      // 하던 화면 안내는 조용히 끝낸다 (처음 안내는 레일·상단 바 중심이라 이어 간다)
      if (S.tour && S.tour.kind === 'screen') {
        endTour();
        if (!S.destroyed) {
          begin();
          rest(3000, 6000);
        }
      }
      // 마지막 화면 하나만 기억한다. 다시 옮기면 앞의 것은 버린다
      S.pending = k ? { key: k, since: now(), nextCheck: 0 } : null;
    }
    /** 사용자가 시킨 흐름·창·모달이 없고 땅에 서 있을 때만 안내를 시작한다 */
    function canStartGuide() {
      if (S.mode !== 'ground' || S.booting || S.press || S.tour || chat.el || S.menu || S.picker) return false;
      if (S.flow !== -1 && S.flow === S.seq) return false;
      if (bubble.visible && bubble.sticky) return false;
      const modal = doc.querySelector('[aria-modal="true"]');
      return !(modal && !root.contains(modal) && modal.getBoundingClientRect().width > 0);
    }
    /**
     * 화면을 옮긴 뒤 새 화면의 DOM이 그려질 때까지 기다린다 (최대 4초).
     * 레일·상단 바(header)는 어느 화면에나 있으므로, 그 밖의 target이 하나 보이거나 모든 target이 보여야 다 그려진 것으로 본다.
     */
    function stepsShown(steps) {
      if (!steps.length) return true;
      let found = 0;
      for (const st of steps) {
        const el = targetShown(st.target);
        if (!el) continue;
        if (!climbColumnOf(el) && !el.closest('header,[role="banner"]')) return true;
        found += 1;
      }
      return found === steps.length;
    }
    function pumpScreen(t) {
      const p = S.pending;
      if (!p || t < p.nextCheck) return;
      p.nextCheck = t + 200;
      if (p.key !== S.screen) {
        S.pending = null;
        return;
      }
      const kind = guideKindFor(p.key);
      if (!kind) {
        S.pending = null;
        return;
      }
      // 대화창에서 데려온 카드를 먼저 가리킨다. 화면 안내는 그다음 한가할 때
      if (S.afterNav || !canStartGuide() || t - p.since < 350) return;
      const steps = kind === 'main' ? guide.tour : guide.screens[p.key].tour;
      if (t - p.since < 4000 && !stepsShown(steps)) return;
      S.pending = null;
      if (kind === 'main') startTour();
      else startScreenTour(p.key, true);
    }
    /**
     * 대화창의 '그 화면으로 가기' 뒤: 그 화면이 되고 카드가 그려지면(최대 4초) 가리키고 설명한다.
     * 화면이 안 바뀌면 15초 뒤, 그 화면에 왔다가 다른 화면으로 가면 바로 그만둔다
     */
    function pumpAfterNav(t) {
      const a = S.afterNav;
      if (!a || t < a.nextCheck) return;
      a.nextCheck = t + 200;
      if (S.screen !== a.screen) {
        if (a.seenAt || t - a.t0 > 15000) S.afterNav = null;
        return;
      }
      if (!a.seenAt) a.seenAt = t;
      if (t - a.seenAt > 4000) {
        S.afterNav = null;
        return;
      }
      if (t - a.seenAt < 350 || !canStartGuide() || !targetShown(a.key)) return;
      S.afterNav = null;
      showMe(a.key);
    }

    // ── 대화창 ──
    const chat = { el: null, log: null, chips: null, input: null, h: 0, ro: null, asked: new Set() };
    const norm = (s) => String(s || '').toLowerCase().replace(/[\s?!.,~·'"()[\]{}:;/\\-]/g, '');
    function bigrams(s) {
      const out = new Set();
      for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
      return out;
    }
    function similarity(a, b) {
      const A = bigrams(a);
      const B = bigrams(b);
      if (!A.size || !B.size) return 0;
      let n = 0;
      A.forEach((x) => {
        if (B.has(x)) n++;
      });
      return n / Math.min(A.size, B.size);
    }
    /** 가장 잘 맞는 FAQ와 점수. 질문과 똑같으면 100점 이상, 키워드 하나에 2 + 글자 수 */
    function matchFaq(input) {
      const n = norm(input);
      if (!n) return null;
      let best = null;
      let bestScore = 0;
      for (const f of guide.faq) {
        let score = 0;
        const q = norm(f.q);
        if (q === n) score += 100;
        else if (n.length >= 2 && q.includes(n)) score += 3;
        for (const k of arr(f.keywords)) {
          const nk = norm(k);
          if (nk && n.includes(nk)) score += 2 + nk.length;
        }
        if (f.pet) score *= 0.9;
        if (score > bestScore) {
          best = f;
          bestScore = score;
        }
      }
      return bestScore >= 3 ? { f: best, score: bestScore } : null;
    }
    /**
     * 질문에 들어 있는 기능 이름(targets의 title). 지금 화면에 있는 카드·위젯을 먼저 고른다.
     * onPageOnly면 지금 화면에 있는 것만. → { key, score, on } | null
     */
    function matchTarget(input, onPageOnly) {
      const n = norm(input);
      if (n.length < 2) return null;
      let best = null;
      for (const key of Object.keys(guide.targets)) {
        const t = guide.targets[key];
        if (!isObj(t) || !t.title) continue;
        const nt = norm(t.title);
        if (nt.length < 2 || !n.includes(nt)) continue;
        const on = onPageKey(key);
        if (onPageOnly && !on) continue;
        const score = 3 + nt.length * 2 + (on ? 6 : 0);
        if (!best || score > best.score) best = { key, score, on };
      }
      return best;
    }
    /** 질문에 들어 있는 용어집 용어: 지금 화면 키 · '*' · 지금 화면에 있는 card:/widget: 범위에서 가장 긴 것 */
    function matchGlossary(input) {
      const n = norm(input);
      if (n.length < 2) return null;
      const scopes = [];
      for (const sc of Object.keys(guide.glossary)) {
        if (sc === '*' || sc === S.screen) scopes.push(sc);
        else if (sc.indexOf(':') >= 0 && pageKeys().has(sc)) scopes.unshift(sc);
      }
      let best = null;
      for (const sc of scopes) {
        const seen = new Set();
        for (const e of guide.glossary[sc].values()) {
          if (seen.has(e)) continue;
          seen.add(e);
          for (const k of [norm(e.term), norm(bareTerm(e.term))]) {
            if (k.length < 2 || !n.includes(k)) continue;
            if (!best || k.length > best.len) best = { term: e.term, text: e.text, scope: sc, len: k.length };
          }
        }
      }
      return best ? Object.assign(best, { score: 2 + best.len * 2 }) : null;
    }
    function suggestFaqs(input, count) {
      const n = norm(input);
      return guide.faq
        .map((f) => ({ f, s: similarity(n, norm(`${f.q}${arr(f.keywords).join('')}`)) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, count)
        .map((x) => x.f);
    }
    function targetAnswer(key) {
      const t = guide.targets[key];
      return `${t.title} · ${t.short || ''}${arr(t.lines)[0] ? ` ${arr(t.lines)[0]}` : ''}`.trim();
    }
    /**
     * 답: { text, target?, alt?, item?, code?, suggest? }
     * 순서: FAQ 질문과 똑같음 → 레코드 번호(화면의 항목) → FAQ·기능 이름·용어집 가운데 점수 높은 것
     */
    // ── 대화창에서 화면 데이터 찾기: 선택한 항목 · 이름으로 찾기 · 화면 요약 ──
    function visibleItems() {
      const out = [];
      for (const el of doc.querySelectorAll('[data-pet-item]')) {
        if (root.contains(el) || el.closest('[data-pet-ignore],[role="dialog"],[aria-modal="true"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        out.push(el);
      }
      return out;
    }
    const SELECTED_SEL = '[aria-current="true"],[aria-current="page"],[aria-selected="true"],[data-selected="true"],[aria-pressed="true"]';
    /** 지금 고른(열려 있는) 항목. 레일·상단 바의 aria-current는 빼고 본문에서만 */
    function selectedItem() {
      for (const el of visibleItems()) {
        if (climbColumnOf(el)) continue;
        if (el.matches(SELECTED_SEL) || el.closest(SELECTED_SEL)) {
          const sel = el.matches(SELECTED_SEL) ? el : el.closest(SELECTED_SEL);
          if (!climbColumnOf(sel) && !sel.closest('header')) return el;
        }
      }
      return null;
    }
    const ASK_TAIL = /(은|는|이|가|을|를|의|에|에서|로|으로|랑|하고|도|좀|요|거|건|것|꺼)$/;
    const ASK_STOP = new Set(['알려줘', '알려', '줘', '보여줘', '보여', '뭐야', '뭐예요', '뭔가요', '어때', '어떄', '어떻게', '찾아줘', '찾아', '읽어줘', '읽어', '설명해줘', '설명', '해줘', '있어', '있나', '상태', '항목', '데이터', '이거', '그거', '저거', '화면', '지금', '여기', '내용', '정보']);
    /** 질문에서 찾을 낱말: 조사·요청 말을 떼고 두 글자 이상만 */
    function askWords(input) {
      const out = [];
      for (let w of String(input || '').split(/[\s,?!.~·]+/)) {
        w = w.trim();
        for (let i = 0; i < 2 && w.length > 2 && ASK_TAIL.test(w); i++) w = w.replace(ASK_TAIL, '');
        if (w.length >= 2 && !ASK_STOP.has(w)) out.push(w.toLowerCase());
      }
      return out;
    }
    /** 낱말이 들어 있는 화면의 항목들. 거의 모든 항목에 들어 있는 흔한 낱말(예 '수주')은 점수를 적게 준다 */
    function itemsByWords(words) {
      if (!words.length) return [];
      const items = visibleItems();
      if (!items.length) return [];
      const texts = items.map((el) => `${el.getAttribute('data-pet-item-title') || ''} ${valueText(el)}`.toLowerCase());
      const scored = [];
      const df = words.map((w) => texts.filter((t) => t.indexOf(w) >= 0).length);
      items.forEach((el, i) => {
        let sc = 0;
        words.forEach((w, j) => {
          if (texts[i].indexOf(w) < 0) return;
          sc += df[j] / items.length > 0.6 ? 0.2 : 1 + Math.min(w.length, 6) / 6;
        });
        if (sc >= 1) scored.push({ el, sc });
      });
      scored.sort((a, b) => b.sc - a.sc);
      // 바깥 항목과 안쪽 항목이 같이 걸리면 안쪽만 남긴다
      return scored.filter((x) => !scored.some((y) => y !== x && x.el.contains(y.el) && y.sc >= x.sc)).map((x) => x.el);
    }
    /** 이 화면 데이터 요약: 항목 종류별 개수와 상태별 개수 */
    function screenSummary() {
      const items = visibleItems().filter((el) => !visibleItems().some((o) => o !== el && o.contains(el)));
      if (!items.length) return null;
      const byKind = new Map();
      for (const el of items) {
        const kind = el.getAttribute('data-pet-item') || '';
        const name = itemConfig(kind).name || kind;
        const e = byKind.get(name) || { n: 0, st: new Map() };
        e.n += 1;
        const status = itemConfig(kind).status;
        if (isObj(status)) {
          const txt = valueText(el);
          let hitKey = '';
          for (const k of Object.keys(status)) if (txt.indexOf(k) >= 0 && k.length > hitKey.length) hitKey = k;
          if (hitKey) e.st.set(hitKey, (e.st.get(hitKey) || 0) + 1);
        }
        byKind.set(name, e);
      }
      const lines = [];
      for (const [name, e] of Array.from(byKind.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 6)) {
        const st = Array.from(e.st.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(' · ');
        lines.push([`${name}`, `${e.n}개${st ? ` (${st})` : ''}`]);
      }
      return lines;
    }
    function answerFor(input) {
      const fm = matchFaq(input);
      if (fm && fm.score >= 100) return { text: fm.f.a, target: fm.f.target || null, alt: altTarget(input, fm.f.target) };
      const code = codeIn(String(input || '').toUpperCase());
      if (code) {
        const el = findItemByCode(code);
        if (el) return { item: el, code };
      }
      const q = String(input || '');
      // '선택한 거 알려줘' '지금 보는 계획' → 고른 항목
      if (/(선택|고른|열린|열려\s*있는|지금\s*보는|보고\s*있는|이거|이것)/.test(q)) {
        const sel = selectedItem();
        if (sel) return { item: sel, code: sel.getAttribute('data-pet-item-title') || '' };
        if (/(선택|고른|열린)/.test(q)) return { text: '지금 고른 항목이 없어요. 목록에서 하나를 누른 뒤 다시 물어봐 주세요. 행에 마우스를 올려도 읽어 드려요.' };
      }
      // '이 화면 요약' '몇 건이야' → 화면 데이터 요약
      if (/(요약|정리해|몇\s*(건|개|매)|얼마나\s*있|뭐가\s*있|무슨\s*데이터|데이터\s*알려)/.test(q)) {
        const sum = screenSummary();
        if (sum) return { summary: sum };
      }
      const tm = matchTarget(input, false);
      const gm = matchGlossary(input);
      const cands = [];
      if (fm) cands.push({ s: fm.score, r: 3, a: () => ({ text: fm.f.a, target: fm.f.target || null, alt: altTarget(input, fm.f.target) }) });
      if (tm) cands.push({ s: tm.score, r: 2, a: () => ({ text: targetAnswer(tm.key), target: tm.key }) });
      if (gm) cands.push({ s: gm.score, r: 1, a: () => ({ text: `${gm.term} · ${gm.text}`, target: gm.scope.indexOf(':') >= 0 ? gm.scope : null }) });
      cands.sort((a, b) => b.s - a.s || b.r - a.r);
      // 고객사·규격·강종 이름처럼 화면 데이터에 들어 있는 낱말이면 그 항목을 읽는다 (설명 쪽이 아주 잘 맞으면 그 답)
      // '…은 어떻게 정해요?' '…가 뭐예요?' 같은 뜻을 묻는 질문은 설명이 있으면 설명을 먼저 한다
      const meaningQ = /(어떻게|왜|뜻|의미|뭐예요|뭐야|무엇|무슨|이란|란\?)/.test(q);
      if (!code && !(cands.length && (cands[0].s >= 12 || meaningQ))) {
        const hits = itemsByWords(askWords(input));
        if (hits.length === 1) return { item: hits[0], code: hits[0].getAttribute('data-pet-item-title') || '' };
        if (hits.length > 1) return { items: hits.slice(0, 5), total: hits.length };
      }
      // 번호를 물었는데 화면에 없으면 통합 검색으로. 번호가 용어(규격 이름 등)로 꽤 잘 맞으면 그 답
      if (code && !(cands.length && cands[0].s >= 8)) return { text: `이 화면에는 ${code} 항목이 안 보여요. 위쪽 통합 검색 칸에 번호를 넣어 찾아보세요.`, target: 'topbar:search' };
      if (cands.length) return cands[0].a();
      return { text: '그건 아직 잘 몰라요. 이런 걸 물어볼 수 있어요.', suggest: suggestFaqs(input, 3) };
    }
    /** FAQ의 target이 이 화면에 없을 때, 질문에 지금 화면의 카드·위젯 이름이 있으면 그것을 대신 가리킨다 */
    function altTarget(input, key) {
      if (key && onPageKey(key)) return null;
      const m = matchTarget(input, true);
      return m && m.key !== key ? m.key : null;
    }
    const actBtn = (text, fn) => h('button', { type: 'button', class: 'fp-msg-act', text, onclick: fn });
    /**
     * 답의 target에 맞는 버튼들.
     * - 지금 화면에 있는 카드·위젯·상단 바: '가리켜 줘'
     * - 지금 화면 자체(SCREEN 키): 메뉴 탭을 가리키거나 지금 화면으로 '가기'를 두지 않는다. 화면 안내가 있으면 그것
     * - 다른 화면(SCREEN 키): '그 화면 알려줘'(레일 탭) + '그 화면으로 가기'
     * - 다른 화면의 카드·위젯: '그 화면으로 가기' → 옮긴 뒤 그 카드를 가리킨다
     */
    function targetActions(key) {
      const out = [];
      if (!key) return out;
      if (isScreenKey(key)) {
        if (key === S.screen) {
          if (guide.screens[key]) {
            out.push(
              actBtn('이 화면 안내 →', () => {
                closeChat();
                startScreenTour(key, false);
              }),
            );
          }
          return out;
        }
        if (findTarget(key)) out.push(actBtn('그 화면 알려줘 →', () => showMe(key)));
        if (screenNav(key)) {
          out.push(
            actBtn('그 화면으로 가기', () => {
              const nav = screenNav(key);
              closeChat();
              goNav(nav);
            }),
          );
        }
        return out;
      }
      if (targetShown(key)) {
        out.push(actBtn('가리켜 줘 →', () => showMe(key)));
        return out;
      }
      const scr = screenOfKey(key);
      if (scr && scr !== S.screen && screenNav(scr)) {
        out.push(
          actBtn('그 화면으로 가기', () => {
            const nav = screenNav(scr);
            if (!nav) return;
            closeChat();
            S.afterNav = { key, screen: scr, t0: now(), seenAt: 0, nextCheck: 0 };
            goNav(nav);
          }),
        );
      }
      return out;
    }
    /** 이 화면에 맞는 질문 칩: 이 화면을 겨냥한 FAQ 두 개 + 이 화면에 보이는 카드·위젯 이름 */
    function screenChips() {
      const out = [];
      const seen = new Set(chat.asked);
      const add = (q) => {
        if (q && !seen.has(q)) {
          seen.add(q);
          out.push({ q });
        }
      };
      if (!S.screen) return out;
      let nFaq = 0;
      for (const f of guide.faq) {
        if (nFaq >= 2) break;
        if (f.pet || !f.target || seen.has(f.q)) continue;
        if (screenOfKey(f.target) === S.screen || onPageKey(f.target)) {
          add(f.q);
          nFaq += 1;
        }
      }
      const page = pageKeys();
      const keys = [];
      const sc = guide.screens[S.screen];
      if (sc) sc.tour.forEach((st) => keys.push(st.target));
      if (S.screen === 'dashboard') guide.tour.forEach((st) => keys.push(st.target));
      page.forEach((k) => {
        if (screenOfKey(k) === S.screen && !isScreenKey(k)) keys.push(k);
      });
      for (const k of keys) {
        if (out.length >= 3) break;
        if (!page.has(k) || isScreenKey(k)) continue;
        const title = targetTitle(k);
        if (title) add(`${title} 알려줘`);
      }
      return out.slice(0, 3);
    }
    function defaultChips() {
      const local = [];
      if (visibleItems().length && !chat.asked.has('이 화면 요약해 줘')) local.push({ q: '이 화면 요약해 줘' });
      if (selectedItem() && !chat.asked.has('선택한 항목 알려줘')) local.push({ q: '선택한 항목 알려줘' });
      screenChips().forEach((c) => local.push(c));
      const has = new Set(local.map((c) => c.q));
      const fresh = guide.faq.filter((f) => !chat.asked.has(f.q) && !has.has(f.q));
      const domain = fresh.filter((f) => !f.pet);
      return local.concat(domain.length >= 3 ? domain : fresh).slice(0, 4);
    }
    function renderChips(list, label) {
      if (!chat.chips) return;
      chat.chips.textContent = '';
      if (label) chat.chips.append(h('span', { class: 'fp-chips-label', text: label }));
      for (const f of list) chat.chips.append(h('button', { type: 'button', class: 'fp-chip', text: f.q, title: f.q, onclick: () => ask(f.q) }));
    }
    function addMsg(who, text, extra) {
      const m = h('div', { class: `fp-msg fp-msg--${who}` }, who === 'pet' ? fill(text) : text);
      if (extra) m.append(h('div', null, extra));
      chat.log.append(m);
      chat.log.scrollTop = chat.log.scrollHeight;
      return m;
    }
    /** 화면의 항목을 읽은 답: 제목 · 한마디 + 필드 목록 + '가리켜 줘'·'열기' */
    function itemReply(el, code) {
      const info = readItem(el);
      const line = info.tip && info.tip !== '이 항목이에요.' ? `${info.head} · ${info.tip}` : `${info.head} 내용이에요.`;
      const acts = [actBtn('가리켜 줘 →', () => pointAtItem(el, code))];
      if (openTargetOf(el)) {
        acts.push(
          actBtn('열기', () => {
            const cur = el.isConnected ? el : findItemByCode(code);
            closeChat();
            if (cur) openItem(cur);
          }),
        );
      }
      addMsg('pet', line, [info.fields.length ? fieldList(info.fields) : null, ...acts]);
    }
    async function ask(q) {
      if (!chat.el) return;
      const text = String(q || '').trim();
      if (!text) return;
      chat.asked.add(text);
      addMsg('me', text);
      const typing = addMsg('pet', '•••');
      typing.classList.add('fp-msg--typing');
      if (S.mode === 'ground' && S.base === 'idle') player.set('think', true);
      await wait(reduced ? 120 : 650);
      if (!chat.el) return;
      typing.remove();
      const ans = answerFor(text);
      if (S.mode === 'ground' && S.base === 'idle') {
        player.set('talk', true);
        later(() => {
          if (player.name === 'talk') player.set(S.base);
        }, 1000);
      }
      if (ans.item) itemReply(ans.item, ans.code);
      else if (ans.summary) {
        addMsg('pet', '이 화면에 보이는 데이터예요. 궁금한 항목은 번호나 이름으로 물어보세요.', [fieldList(ans.summary)]);
      } else if (ans.items) {
        const btns = ans.items.map((el) => {
          const info = readItem(el);
          return actBtn(info.title || info.head, () => itemReply(el, info.title));
        });
        addMsg('pet', `찾는 말이 들어간 항목이 ${ans.total}개 있어요${ans.total > ans.items.length ? `(앞의 ${ans.items.length}개)` : ''}. 하나를 골라 주세요.`, btns);
      } else {
        // 지금 화면의 카드·위젯을 먼저 가리키고, 답의 target이 다른 화면이면 그 화면으로 가는 버튼을 뒤에 둔다
        let acts = [];
        if (ans.alt) acts = targetActions(ans.alt);
        acts = acts.concat(targetActions(ans.target)).slice(0, 3);
        addMsg('pet', ans.text, acts.length ? acts : null);
      }
      if (ans.suggest) renderChips(ans.suggest, '이런 질문은 어때요?');
      else renderChips(defaultChips());
    }
    function openChat() {
      if (chat.el) return;
      if (S.mode === 'hidden') show(true);
      closeMenu();
      closeBubble('chat');
      hideHint();
      endTour();
      const tok = begin();
      finishWalk(false);
      if (S.sleeping) wake(true);
      const ava = h('div', { class: 'fp-chat-ava' });
      const avaCv = h('canvas', { 'aria-hidden': 'true' });
      ava.append(avaCv);
      placeAvatar(avaCv, 34, 1);
      const closeBtn = h('button', { type: 'button', class: 'fp-x', 'aria-label': '대화 닫기', text: '×', onclick: () => closeChat() });
      chat.log = h('div', { class: 'fp-chat-log', 'aria-live': 'polite' });
      chat.chips = h('div', { class: 'fp-chips' });
      chat.input = h('input', { type: 'text', placeholder: '궁금한 걸 적어 주세요', 'aria-label': '질문 입력', maxlength: '80' });
      const form = h(
        'form',
        {
          class: 'fp-chat-form',
          onsubmit: (e) => {
            e.preventDefault();
            const v = chat.input.value;
            chat.input.value = '';
            ask(v);
          },
        },
        chat.input,
        h('button', { type: 'submit', class: 'fp-send', text: '보내기' }),
      );
      const el = h(
        'div',
        { class: 'fp-chat', role: 'dialog', 'aria-label': `${S.pack.name}에게 묻기` },
        h('div', { class: 'fp-chat-head' }, ava, h('div', { class: 'fp-chat-who' }, h('b', { text: S.pack.name }), h('small', { text: '화면 도우미 · 무엇이 궁금해요?' })), closeBtn),
        chat.log,
        chat.chips,
        form,
        h('div', { class: 'fp-chat-foot' }, h('i', { 'aria-hidden': 'true' }), 'AI 연결 전 · 정해진 답변'),
      );
      root.appendChild(el);
      chat.el = el;
      addMsg('pet', `${pick(guide.greeting) || '안녕하세요!'}${guide.real ? '' : ' (설명 파일이 없어 간단한 안내만 해요)'}`);
      renderChips(defaultChips());
      chat.h = el.offsetHeight;
      if (typeof ResizeObserver === 'function') {
        chat.ro = new ResizeObserver(() => {
          if (chat.el) chat.h = chat.el.offsetHeight;
        });
        chat.ro.observe(el);
      }
      positionChat();
      if (!reduced && el.animate) el.animate([{ transform: 'translateY(6px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 160, easing: 'ease-out' });
      if (!(S.press && S.press.type !== 'mouse') && !global.matchMedia('(pointer: coarse)').matches) chat.input.focus({ preventScroll: true });
      if (S.mode === 'ground' && S.base === 'idle') {
        player.set('wave', true);
        later(() => {
          if (player.name === 'wave' && tok === S.seq) player.set(S.base);
        }, 1300);
      }
    }
    function closeChat() {
      if (!chat.el) return;
      S.noHoverUntil = Math.max(S.noHoverUntil, now() + 900);
      if (chat.ro) chat.ro.disconnect();
      chat.ro = null;
      const hadFocus = chat.el.contains(doc.activeElement);
      chat.el.remove();
      chat.el = null;
      chat.log = null;
      chat.chips = null;
      chat.input = null;
      if (hadFocus) hit.focus({ preventScroll: true });
      rest();
    }
    function toggleChat() {
      if (chat.el) closeChat();
      else openChat();
    }
    function positionChat() {
      if (!chat.el) return;
      const vw = W();
      const vh = H();
      const cw = Math.min(300, vw - 16);
      if (chat.el.style.width !== `${cw}px`) chat.el.style.width = `${cw}px`;
      const ch = Math.min(chat.h || 360, vh - 16);
      const box = petBox();
      const preferLeft = (box.left + box.right) / 2 > vw / 2;
      const lx = box.left - 10 - cw;
      const rx = box.right + 10;
      let x = null;
      if (preferLeft && lx >= 8) x = lx;
      else if (!preferLeft && rx + cw <= vw - 8) x = rx;
      else if (lx >= 8) x = lx;
      else if (rx + cw <= vw - 8) x = rx;
      let y;
      if (x !== null) y = clamp(box.bottom - ch, 8, Math.max(8, vh - ch - 8));
      else {
        x = clamp((box.left + box.right) / 2 - cw / 2, 8, Math.max(8, vw - cw - 8));
        y = box.top - 10 - ch;
        if (y < 8) y = box.bottom + 10 + ch <= vh - 8 ? box.bottom + 10 : 8;
      }
      chat.el.style.left = `${Math.round(x)}px`;
      chat.el.style.top = `${Math.round(y)}px`;
    }
    function placeAvatar(cv, boxPx, mul) {
      const p = S.pack;
      drawStill(cv, p, 'idle', 0);
      const b = p._bbox || { top: 6, left: 8, right: 40, bottom: 46 };
      const bw = b.right - b.left;
      const s = Math.max(1, Math.floor((boxPx - 4) / Math.max(bw, (b.bottom - b.top) * 0.75)) * (mul || 1));
      cv.style.width = `${p.cell * s}px`;
      cv.style.height = `${p.cell * s}px`;
      cv.style.left = `${Math.round(boxPx / 2 - ((b.left + b.right) / 2) * s)}px`;
      cv.style.top = `${Math.round(3 - b.top * s)}px`;
    }

    // ── 우클릭 메뉴 ──
    function openMenu(x, y) {
      if (S.mode === 'hidden' || S.mode === 'boot') return;
      closeMenu();
      closeChat();
      if (!(bubble.visible && bubble.sticky)) closeBubble('menu');
      hideHint();
      begin();
      finishWalk(false);
      S.menuOpenedT = now();
      const m = h('div', { class: 'fp-menu', role: 'menu', 'aria-label': '펫 메뉴' });
      const ava = h('div', { class: 'fp-menu-ava' });
      const avaCv = h('canvas', { 'aria-hidden': 'true' });
      ava.append(avaCv);
      placeAvatar(avaCv, 28, 1);
      m.append(h('div', { class: 'fp-menu-head' }, ava, h('div', null, h('b', { text: S.pack.name }), h('small', { text: guide.real ? '화면 도우미' : '화면 도우미 · 간단 안내' }))));
      const item = (icon, label, fn, extra, sub) => {
        const b = h('button', { type: 'button', class: 'fp-mi', role: 'menuitem', html: pxIcon(icon) });
        const text = h('span', { class: 'fp-mi-text' }, h('span', { text: label }), sub ? h('span', { class: 'fp-mi-sub', text: sub }) : null);
        b.append(text);
        if (extra) b.append(extra);
        b.addEventListener('click', fn);
        m.append(b);
        return b;
      };
      const toggle = (icon, label, value, setter, sub) => {
        const state = h('span', { class: 'fp-state', 'data-on': String(value), text: value ? '켜짐' : '꺼짐' });
        const b = item(icon, label, () => {
          const v = state.dataset.on !== 'true';
          setter(v);
          state.dataset.on = String(v);
          state.textContent = v ? '켜짐' : '꺼짐';
          b.setAttribute('aria-checked', String(v));
        }, state, sub);
        b.setAttribute('role', 'menuitemcheckbox');
        b.setAttribute('aria-checked', String(value));
      };
      item('chat', '말 걸기', () => {
        closeMenu();
        openChat();
      }, h('span', { class: 'fp-kbd', text: 'Enter' }));
      toggle('info', '기능 설명', S.explain, setExplain, '마우스를 올리면 설명');
      toggle('walk', '돌아다니기', S.roam, setRoaming, reduced ? '움직임 줄이기 설정이 켜져 있어요' : null);
      item('flag', '안내 다시 보기', () => {
        closeMenu();
        startTour();
      });
      if (S.screen && guide.screens[S.screen]) {
        const key = S.screen;
        item('screen', '이 화면 안내', () => {
          closeMenu();
          startScreenTour(key, false);
        }, null, targetTitle(key));
      }
      item('swap', '캐릭터 바꾸기…', () => {
        closeMenu();
        openPicker(false);
      });
      const seg = h('div', { class: 'fp-seg', role: 'group', 'aria-label': '크기' });
      for (const k of Object.keys(SIZES)) {
        seg.append(
          h('button', {
            type: 'button',
            'aria-pressed': String(k === S.sizeKey),
            text: SIZE_LABEL[k],
            onclick: (ev) => {
              setSize(k);
              for (const btn of seg.children) btn.setAttribute('aria-pressed', String(btn === ev.currentTarget));
            },
          }),
        );
      }
      const row = h('div', { class: 'fp-menu-row', html: pxIcon('size') });
      row.append(h('span', { text: '크기' }), seg);
      m.append(row, h('div', { class: 'fp-menu-sep', role: 'separator' }));
      item('hide', '숨기기', () => {
        closeMenu();
        hide();
      }, h('span', { class: 'fp-kbd', text: 'Shift+P' }));
      m.addEventListener('keydown', (e) => {
        const items = Array.from(m.querySelectorAll('button'));
        const i = items.indexOf(doc.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
          items[next].focus();
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          items[e.key === 'Home' ? 0 : items.length - 1].focus();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const next = e.shiftKey ? (i - 1 + items.length) % items.length : (i + 1) % items.length;
          items[next].focus();
        }
      });
      root.appendChild(m);
      S.menu = m;
      const mw = m.offsetWidth;
      const mh = m.offsetHeight;
      let mx = x;
      let my = y;
      if (mx + mw > W() - 8) mx = x - mw;
      if (my + mh > H() - 8) my = y - mh;
      m.style.left = `${Math.round(clamp(mx, 8, Math.max(8, W() - mw - 8)))}px`;
      m.style.top = `${Math.round(clamp(my, 8, Math.max(8, H() - mh - 8)))}px`;
      if (!reduced && m.animate) m.animate([{ transform: 'scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 110, easing: 'ease-out' });
      const first = m.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    }
    function closeMenu(keepFocus) {
      if (!S.menu) return;
      S.noHoverUntil = now() + 900;
      const hadFocus = S.menu.contains(doc.activeElement);
      S.menu.remove();
      S.menu = null;
      if (hadFocus && !keepFocus) hit.focus({ preventScroll: true });
      rest();
    }

    // ── 내 펫 (캐릭터 바꾸기) ──
    function openPicker(showMake) {
      closeMenu(true);
      closeChat();
      closeBubble('picker');
      begin();
      finishWalk(false);
      const players = [];
      const grid = h('div', { class: 'fp-grid' });
      let selectedBtn = null;
      for (const p of packs) {
        const cv = h('canvas', { 'aria-hidden': 'true' });
        const stage = h('div', { class: 'fp-card-stage' }, h('div', { class: 'fp-card-shadow' }), cv);
        const selected = S.pack && p.id === S.pack.id;
        const btn = h(
          'button',
          { type: 'button', class: 'fp-card', 'aria-pressed': String(selected), 'aria-label': `${p.name} · ${p.desc}${selected ? ' · 사용 중' : ''}` },
          stage,
          h('b', { text: p.name }),
          h('span', { text: p.desc }),
          selected ? h('span', { class: 'fp-card-badge', text: '사용 중' }) : null,
        );
        const av = accentVars(p.accent);
        btn.style.setProperty('--fp-card-accent', av['--fp-accent-ink']);
        btn.style.setProperty('--fp-card-soft', av['--fp-accent-soft']);
        const pl = new Player(cv);
        players.push({ pl, p, cv });
        loadPack(p).then(() => {
          if (p._broken) {
            btn.disabled = true;
            btn.title = '그림을 불러오지 못했어요';
            return;
          }
          pl.setPack(p);
          // 도트가 고르게 보이도록 정수배로만 키운다
          const stagePx = stage.clientWidth || 112;
          const s = Math.max(1, Math.floor(stagePx / p.cell));
          cv.style.width = `${p.cell * s}px`;
          cv.style.height = `${p.cell * s}px`;
          cv.style.left = `${Math.round(stagePx / 2 - p.anchor.x * s)}px`;
          cv.style.top = `${Math.round(stagePx - 12 - p.anchor.y * s)}px`;
        });
        btn.addEventListener('mouseenter', () => pl.pack && pl.set('wave', true));
        btn.addEventListener('mouseleave', () => pl.pack && pl.set('idle', true));
        btn.addEventListener('click', () => choose(p.id));
        grid.append(btn);
        if (selected) selectedBtn = btn;
      }
      const make = h(
        'div',
        { class: 'fp-make', id: 'fp-make' },
        h('h3', { text: '새 펫 만들기' }),
        h(
          'ol',
          null,
          h('li', null, '48×48 칸, 17가지 동작(오르기·올라서기·점프 포함)을 담은 스프라이트 시트(288×816 PNG)를 그려요.'),
          h('li', null, h('code', { text: 'pet/characters/<id>.js' }), ' 파일에서 규격대로 ', h('code', { text: 'FANTA_PET_CHARACTERS' }), '에 넣어요.'),
          h('li', null, 'index.html에서 ', h('code', { text: 'pet-engine.js' }), '보다 먼저 그 파일을 불러와요.'),
        ),
        h('p', { text: '자세한 규격과 예시는 데모 폴더의 README.md "새 캐릭터 추가"에 있어요.' }),
      );
      make.hidden = !showMake;
      const makeBtn = h('button', { type: 'button', class: 'fp-pill', 'aria-expanded': String(!!showMake), 'aria-controls': 'fp-make', text: '펫 만들기' });
      makeBtn.addEventListener('click', () => {
        make.hidden = !make.hidden;
        makeBtn.setAttribute('aria-expanded', String(!make.hidden));
        if (!make.hidden) make.scrollIntoView({ block: 'nearest' });
      });
      const modal = h(
        'div',
        { class: 'fp-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fp-modal-title' },
        h('div', { class: 'fp-modal-head' }, h('h2', { id: 'fp-modal-title', text: '내 펫' }), h('small', { text: '고르면 바로 바뀌어요' }), makeBtn, h('button', { type: 'button', class: 'fp-x', 'aria-label': '닫기', text: '×', onclick: () => closePicker() })),
        grid,
        make,
      );
      const back = h('div', { class: 'fp-backdrop' }, modal);
      back.addEventListener('pointerdown', (e) => {
        if (e.target === back) closePicker();
      });
      modal.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const items = Array.from(modal.querySelectorAll('button:not([disabled])'));
        if (!items.length) return;
        const i = items.indexOf(doc.activeElement);
        e.preventDefault();
        items[e.shiftKey ? (i - 1 + items.length) % items.length : (i + 1) % items.length].focus();
      });
      root.appendChild(back);
      S.picker = { el: back, players };
      if (!reduced && modal.animate) modal.animate([{ transform: 'translateY(10px) scale(.98)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'ease-out' });
      (selectedBtn || grid.querySelector('button')).focus({ preventScroll: true });
    }
    function closePicker() {
      if (!S.picker) return;
      S.noHoverUntil = now() + 1200;
      S.picker.el.remove();
      S.picker = null;
      hit.focus({ preventScroll: true });
      rest();
    }
    function choose(id) {
      closePicker();
      if (S.pack && id === S.pack.id) {
        showBubble('지금 모습 그대로예요.');
        return;
      }
      setCharacter(id, true);
    }
    function applyPack(p) {
      S.pack = p;
      S.scale = S.size / p.cell;
      player.setPack(p);
      if (S.mode === 'ground') player.set(S.base, true);
      else if (S.mode === 'drag') player.set('drag', true);
      else if (S.mode === 'air' || S.mode === 'jump') player.set('fall', true);
      else if (S.mode === 'climb') player.set('climb', true);
      const av = accentVars(p.accent);
      for (const k of Object.keys(av)) root.style.setProperty(k, av[k]);
      layoutPet();
      tabPlayer.setPack(p);
      layoutTab();
    }
    async function setCharacter(id, fx) {
      const p = packs.find((q) => q.id === id);
      if (!p) return false;
      await loadPack(p);
      if (p._broken) return false;
      const visible = S.mode !== 'hidden' && S.mode !== 'boot';
      if (fx && visible) {
        const c = petCenter();
        puff(c.x, c.y);
      }
      applyPack(p);
      store.set('char', p.id);
      if (fx && visible) {
        if (S.mode === 'ground' && S.base === 'idle') player.set('happy', true, () => player.set(S.base));
        react('swap');
      }
      return true;
    }

    // ── 숨기기 ──
    function layoutTab() {
      const p = S.pack;
      const s = 1.5;
      const b = p._bbox || { top: 6, left: 8, right: 40, bottom: 46 };
      tabCanvas.style.width = `${p.cell * s}px`;
      tabCanvas.style.height = `${p.cell * s}px`;
      tabCanvas.style.left = `${Math.round(30 - ((b.left + b.right) / 2) * s)}px`;
      tabCanvas.style.top = `${Math.round(7 - b.top * s)}px`;
      tabEl.style.bottom = `${Math.round(Math.min(150, H() * 0.22))}px`;
    }
    function hide(silent) {
      if (S.mode === 'hidden') return;
      closePanels();
      endTour();
      begin();
      finishWalk(false);
      cancelJump();
      abortClimb(true);
      hideHint();
      if (!silent && S.mode !== 'boot') {
        const c = petCenter();
        puff(c.x, c.y);
      }
      flushLanding(false);
      S.mode = 'hidden';
      S.press = null;
      root.classList.remove('fp-dragging');
      petEl.style.display = 'none';
      shadowEl.style.display = 'none';
      tabEl.style.display = 'block';
      layoutTab();
      if (!silent && !reduced && tabEl.animate) tabEl.animate([{ transform: 'translateX(48px)' }, { transform: 'none' }], { duration: 260, delay: 120, easing: 'cubic-bezier(.3,1.3,.6,1)', fill: 'backwards' });
      store.set('hidden', true);
      if (!silent) {
        const line = pick(guide.reactions.hide);
        if (line) {
          tabTip.textContent = fill(line);
          tabTip.style.display = 'block';
          tabTip.style.bottom = `${parseFloat(tabEl.style.bottom) + 10}px`;
          later(() => {
            tabTip.style.display = 'none';
          }, 2600);
        }
      }
    }
    /** fromFlow: 안내·대화 같은 흐름 안에서 부를 때. 그 흐름이 다음 행동을 정하므로 인사·쉬기를 하지 않는다. */
    function show(fromFlow) {
      if (S.mode !== 'hidden') return;
      const tr = tabEl.getBoundingClientRect();
      tabEl.style.display = 'none';
      tabTip.style.display = 'none';
      petEl.style.display = '';
      shadowEl.style.display = '';
      store.set('hidden', false);
      const [, mx] = floorRange();
      S.x = mx;
      S.base = 'idle';
      S.sleeping = false;
      S.lastInput = now();
      if (reduced) landOn({ type: 'floor' }, floorY(), true);
      else {
        S.y = clamp(tr.bottom || H() - 150, minFootY(), floorY());
        S.mode = 'air';
        S.surface = null;
        S.vx = -360 * (S.size / 96);
        S.vy = -460;
        player.set('fall', true);
      }
      if (fromFlow) return;
      const tok = begin();
      waitLanding().then((ok) => {
        if (!ok || tok !== S.seq) return;
        player.set('wave', true);
        later(() => {
          if (player.name === 'wave') player.set(S.base);
        }, 1200);
        end(tok);
      });
      react('show');
    }
    function toggleHidden() {
      if (S.mode === 'hidden') show();
      else hide();
    }

    // ── 잠·깨기·콕 ──
    function startSleep() {
      if (S.sleeping || S.mode !== 'ground') return;
      begin();
      finishWalk(false);
      S.sleeping = true;
      setBase('sleep');
      if (!bubble.visible) react('sleep');
    }
    function wake(silent) {
      if (!S.sleeping) return;
      S.sleeping = false;
      S.lastInput = now();
      S.base = 'idle';
      player.set('surprised', true, () => player.set(S.base));
      // 흐름 안에서 깨울 때(silent)는 그 흐름이 쉬는 시간을 정한다
      if (!silent) {
        react('wake');
        rest(4000, 9000);
      }
    }
    function poke() {
      const t = now();
      begin();
      finishWalk(false);
      closeChat();
      if (S.sleeping) {
        wake();
        return;
      }
      if (S.mode === 'ground') {
        if (S.base === 'sit') S.base = 'idle';
        player.set('surprised', true, () => player.set('happy', true, () => player.set(S.base)));
        if (!reduced && S.surface && S.surface.type === 'floor') {
          S.mode = 'air';
          S.surface = null;
          S.vy = -340 * Math.sqrt(S.size / 96);
          S.vx = 0;
        }
      }
      if (t - S.lastPokeT > 1500) react('poke');
      S.lastPokeT = t;
      waitLanding().then(() => rest());
    }
    function onClickPet() {
      const t = now();
      if (S.sleeping) {
        wake();
        S.lastClickT = t;
        return;
      }
      if (t - S.lastClickT < 320) {
        cancel(S.clickTimer);
        S.clickTimer = 0;
        poke();
      } else {
        S.clickTimer = later(() => {
          S.clickTimer = 0;
          toggleChat();
        }, 300);
      }
      S.lastClickT = t;
    }

    // ── 끌어서 옮기기 ──
    function startDrag() {
      const p = S.press;
      p.dragging = true;
      cancel(p.longTimer);
      begin();
      finishWalk(false);
      cancelJump();
      abortClimb(true);
      closeMenu(true);
      closeChat();
      hideHint();
      if (S.tour) endTour();
      if (S.sleeping) S.sleeping = false;
      flushLanding(false);
      S.passThrough = false;
      S.mode = 'drag';
      S.surface = null;
      S.base = 'idle';
      player.set('drag', true);
      root.classList.add('fp-dragging');
      if (Math.random() < 0.6) react('drag');
    }
    function release(p) {
      root.classList.remove('fp-dragging');
      S.noHoverUntil = now() + 1600;
      const sm = p.samples;
      const last = sm[sm.length - 1];
      let first = sm[0];
      for (const q of sm) {
        if (last.t - q.t <= 90) {
          first = q;
          break;
        }
      }
      const dts = Math.max(16, last.t - first.t) / 1000;
      let vx = ((last.x - first.x) / dts) * 0.5;
      let vy = ((last.y - first.y) / dts) * 0.5;
      vx = clamp(vx, -850, 850);
      vy = clamp(vy, -800, 700);
      if (reduced) {
        vx = 0;
        vy = 0;
      }
      S.mode = 'air';
      S.vx = vx;
      S.vy = vy;
      player.set('fall', true);
      const tok = S.seq;
      waitLanding().then((ok) => {
        if (!ok) return;
        if (tok === S.seq && Math.random() < 0.5) react('drop');
        if (tok === S.seq) rest();
      });
    }
    on(hit, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (S.mode === 'hidden' || S.mode === 'boot') return;
      S.lastInput = now();
      const t = now();
      S.press = { id: e.pointerId, sx: e.clientX, sy: e.clientY, type: e.pointerType, dragging: false, samples: [{ t, x: e.clientX, y: e.clientY }], longTimer: 0, offX: S.x - e.clientX, offY: S.y - e.clientY, menuOpened: false };
      try {
        hit.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 캡처를 못 해도 끌기는 된다 */
      }
      if (e.pointerType !== 'mouse') {
        const px = e.clientX;
        const py = e.clientY;
        S.press.longTimer = later(() => {
          if (S.press && !S.press.dragging) {
            S.press.menuOpened = true;
            openMenu(px, py);
          }
        }, 550);
      } else e.preventDefault();
      hit.focus({ preventScroll: true });
    });
    on(hit, 'pointermove', (e) => {
      const p = S.press;
      if (!p || e.pointerId !== p.id) return;
      const t = now();
      p.samples.push({ t, x: e.clientX, y: e.clientY });
      if (p.samples.length > 10) p.samples.shift();
      if (!p.dragging) {
        if (p.menuOpened || Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < (p.type === 'mouse' ? 4 : 8)) return;
        startDrag();
      }
      S.x = clamp(e.clientX + p.offX, 0, W());
      S.y = clamp(e.clientY + p.offY, minFootY(), H() + 20);
    });
    const onUp = (e) => {
      const p = S.press;
      if (!p || e.pointerId !== p.id) return;
      S.press = null;
      cancel(p.longTimer);
      try {
        hit.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* 이미 풀렸다 */
      }
      if (p.dragging) {
        release(p);
        return;
      }
      if (p.menuOpened || e.type === 'pointercancel') return;
      onClickPet();
    };
    on(hit, 'pointerup', onUp);
    on(hit, 'pointercancel', onUp);
    on(hit, 'contextmenu', (e) => {
      e.preventDefault();
      if (S.press && S.press.menuOpened) return;
      if (now() - S.menuOpenedT < 600) return;
      openMenu(e.clientX, e.clientY);
    });
    on(hit, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleChat();
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const b = petBox();
        openMenu(b.left, b.top);
      }
    });
    on(tabEl, 'click', () => show());

    // ── 문서 전체 입력 ──
    const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
    function closePanels() {
      closeMenu(true);
      closeChat();
      closePicker();
    }
    function closeTopmost() {
      if (S.picker) closePicker();
      else if (S.menu) closeMenu();
      else if (chat.el) closeChat();
      else if (S.tour) endTour();
      else if (bubble.visible) closeBubble('close');
      else return false;
      return true;
    }
    on(
      doc,
      'keydown',
      (e) => {
        S.lastInput = now();
        if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) root.classList.remove('fp-mouse');
        if (e.key === 'Escape') {
          if (closeTopmost()) e.stopPropagation();
          return;
        }
        if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'KeyP' || e.key === 'P' || e.key === 'p') && !isTyping(e.target)) {
          e.preventDefault();
          toggleHidden();
        }
      },
      true,
    );
    on(
      doc,
      'pointermove',
      (e) => {
        S.lastInput = now();
        if (e.pointerType !== 'touch') {
          S.lastMoveT = S.lastInput;
          if (S.hoverEl && !S.hoverArmed) armHover();
        }
        if (S.sleeping && S.mode === 'ground') {
          const c = petCenter();
          if (Math.hypot(e.clientX - c.x, e.clientY - c.y) < 150) wake();
        }
      },
      { passive: true },
    );
    on(
      doc,
      'pointerdown',
      (e) => {
        S.lastInput = now();
        root.classList.add('fp-mouse');
        const t = e.target;
        if (S.menu && !S.menu.contains(t)) closeMenu(true);
        if (chat.el && !chat.el.contains(t) && !hit.contains(t)) closeChat();
      },
      true,
    );
    on(
      doc,
      'scroll',
      () => {
        S.lastInput = now();
      },
      { capture: true, passive: true },
    );
    on(global, 'resize', () => {
      if (S.mode === 'hidden') layoutTab();
    });
    // 기능 설명: data-pet-target 위에 0.6초 머물면.
    // 말풍선이 사라지거나 펫이 비켜서 커서 밑 요소가 바뀐 것은 '올린' 것이 아니므로, 실제로 움직였을 때만 센다.
    function armHover() {
      const target = S.hoverEl;
      S.hoverArmed = true;
      cancel(S.hoverTimer);
      if (!target || !S.explain) return;
      const cand = S.hoverCand;
      const startedAt = now();
      const fire = () => {
        if (S.hoverEl !== target || !target.isConnected || !cand) return;
        // 방금 다른 행을 읽었으면 그 간격이 지나고 다시 본다 (여러 행을 훑어도 마지막에 머문 행은 읽는다)
        const retry = hoverRetryIn(cand.kind, now());
        if (retry > 0 && now() - startedAt < 8000) {
          S.hoverTimer = later(fire, retry);
          return;
        }
        if (cand.kind === 'item') readItemEl(target, true);
        else if (cand.kind === 'term') explainTerm(target, termOf(target), true);
        else explainEl(target, true);
      };
      S.hoverTimer = later(fire, HOVER_DELAY);
    }
    const TERM_SEL = '[data-pet-term],th,dt';
    /**
     * 커서 밑에서 설명할 것: 기능(data-pet-target) · 항목(data-pet-item) · 용어(th·dt·data-pet-term) 가운데 가장 안쪽.
     * 용어는 용어집에 있을 때만 (없으면 바깥의 항목·기능이 이어받는다). closest()만 쓰므로 행이 수백 개여도 싸다
     */
    function hoverCandidate(t) {
      if (!t || !t.closest || root.contains(t)) return null;
      const list = [];
      const tm = t.closest(TERM_SEL);
      if (tm) list.push({ el: tm, kind: 'term' });
      const it = t.closest('[data-pet-item]');
      if (it) list.push({ el: it, kind: 'item' });
      const tg = t.closest('[data-pet-target]');
      if (tg) list.push({ el: tg, kind: 'target' });
      // 모두 t의 조상이라 서로 품는 관계다. 같은 요소면 넣은 순서(용어 → 항목 → 기능)
      list.sort((a, b) => (a.el === b.el ? 0 : a.el.contains(b.el) ? 1 : -1));
      for (const c of list) {
        // 모달(펫보다 위에 뜬다) 안의 요소는 설명해도 펫이 가려 보이지 않으므로 넘어간다
        if (perchExcluded(c.el)) continue;
        if (c.kind === 'term' && !termOf(c.el)) continue;
        return c;
      }
      return null;
    }
    on(
      doc,
      'pointerover',
      (e) => {
        if (e.pointerType === 'touch') return;
        const c = hoverCandidate(e.target);
        const target = c ? c.el : null;
        if (target === S.hoverEl) return;
        cancel(S.hoverTimer);
        S.hoverEl = target;
        S.hoverCand = c;
        S.hoverArmed = false;
        if (now() - S.lastMoveT < 120) armHover();
      },
      true,
    );
    on(doc, 'pointerleave', () => {
      cancel(S.hoverTimer);
      S.hoverEl = null;
      S.hoverCand = null;
    });

    // ── 혼자 있을 때 ──
    function lookAround(tok) {
      return (async () => {
        if (S.base !== 'idle' || S.mode !== 'ground') return;
        for (const f of [-1, 1]) {
          S.facing = f;
          player.holdFrame('walk', 0);
          if (!(await wait(650, tok))) {
            if (player.hold >= 0 && player.name === 'walk' && !S.walk && S.mode === 'ground') player.set(S.base, true);
            return;
          }
        }
        player.set(S.base, true);
      })();
    }
    async function wander() {
      const [mn, mx] = surfaceRange();
      const span = mx - mn;
      if (span < 24) return;
      const d = rand(70, Math.min(300, Math.max(80, span))) * (Math.random() < 0.5 ? -1 : 1);
      let tx = clamp(S.x + d, mn, mx);
      if (Math.abs(tx - S.x) < 30) tx = clamp(S.x - d, mn, mx);
      await walkTo(tx);
    }
    async function sitAWhile(tok) {
      setBase('sit');
      await wait(rand(9000, 20000), tok);
      if (tok === S.seq && S.base === 'sit') setBase('idle');
    }
    async function walkOffEdge(tok) {
      if (!surfaceAlive()) return wander();
      const r = S.surface.el.getBoundingClientRect();
      const dir = S.x - r.left < r.right - S.x ? -1 : 1;
      const edgeX = dir < 0 ? r.left - 26 : r.right + 26;
      if (edgeX < 12 || edgeX > W() - 12) return wander();
      await walkTo(edgeX, { allowOff: true });
      if (tok === S.seq) await waitLanding();
    }
    function curSurfaceInfo() {
      if (!surfaceAlive()) return null;
      return perchSurface(S.surface.el, S.surface.el.getBoundingClientRect());
    }
    /** 혼자 놀러 가기: 위젯 윗면·단계 박스·레일 탭 중 하나로 (가까울수록 자주) */
    async function travelRandom(tok) {
      const nodes = graphNodes();
      const cur = nodeOfSurface(nodes);
      if (!cur) return wander();
      const cands = nodes.filter((n) => n !== cur && n.type === 'perch');
      if (!cands.length) return wander();
      const weight = (n) => (n.col ? 0.8 : n.narrow ? 0.7 : 1.2) / (1 + Math.abs(n.top - S.y) / 500 + Math.abs((n.left + n.right) / 2 - S.x) / 900);
      for (let tries = 0; tries < 4; tries++) {
        let total = 0;
        for (const n of cands) total += weight(n);
        let r = Math.random() * total;
        let target = cands[0];
        for (const n of cands) {
          r -= weight(n);
          if (r <= 0) {
            target = n;
            break;
          }
        }
        const path = planPath(target.el);
        const ladders = path ? path.filter((e) => e.kind === 'ladder').length : 0;
        if (!path || !path.length || path.length > 5 || ladders > 3) {
          cands.splice(cands.indexOf(target), 1);
          if (!cands.length) break;
          continue;
        }
        const ok = await followPath(path, tok, { sitAfter: true });
        if (ok && tok === S.seq) {
          const sf = curSurfaceInfo();
          if (sf && sf.narrow) {
            setBase('sit');
            await wait(rand(8000, 16000), tok);
            if (tok === S.seq && S.base === 'sit') setBase('idle');
          }
        }
        return 'long';
      }
      return wander();
    }
    /** 바로 옆 면으로: 높이가 비슷하면 점프(최근 작업 로그 ↔ 제품 재고, 단계 박스끼리), 레일 탭이면 몇 칸 위아래로 */
    async function hopNeighbor(tok) {
      const nodes = graphNodes();
      const cur = nodeOfSurface(nodes);
      if (!cur) return wander();
      const cands = cur.col
        ? nodes.filter((n) => n !== cur && n.col === cur.col && Math.abs(n.top - cur.top) < 220)
        : nodes.filter((n) => n !== cur && n.type === 'perch' && !n.col && Math.abs(n.top - cur.top) <= JUMP_DY && xGap(cur, n) <= 140 && !(n.el.contains(cur.el) || (cur.el && cur.el.contains(n.el))));
      if (!cands.length) return travelRandom(tok);
      const target = pick(cands);
      const path = planPath(target.el);
      if (!path || !path.length || path.length > 2) return;
      await followPath(path, tok, { sitAfter: !!cur.col });
    }
    async function goDown(tok) {
      const path = planPath(null);
      if (path && path.length) await followPath(path, tok);
    }
    function pickRoam() {
      const r = Math.random();
      const sf = curSurfaceInfo();
      if (!sf) {
        if (r < 0.36) return wander;
        if (r < 0.74) return travelRandom;
        return lookAround;
      }
      if (sf.narrow) {
        if (r < 0.34) return sitAWhile;
        if (r < 0.6) return hopNeighbor;
        if (r < 0.8) return travelRandom;
        if (r < 0.94) return goDown;
        return lookAround;
      }
      if (r < 0.24) return wander;
      if (r < 0.42) return sitAWhile;
      if (r < 0.6) return hopNeighbor;
      if (r < 0.76) return travelRandom;
      if (r < 0.84) return walkOffEdge;
      if (r < 0.93) return goDown;
      return lookAround;
    }
    async function runAction(fn) {
      const tok = begin();
      let long = false;
      try {
        long = (await fn(tok)) === 'long';
      } catch (e) {
        /* 행동 하나가 실패해도 펫은 계속 산다 */
      }
      end(tok);
      // 멀리 다녀온 뒤에는 더 오래 쉰다 (바쁘게 돌아다니지 않게)
      if (long && tok === S.seq) rest(12000, 24000);
    }
    function brain(t) {
      if (S.mode !== 'ground' || S.press || S.tour || chat.el || S.menu || S.picker || S.walk) return;
      if (bubble.visible && (bubble.sticky || bubble.hasActions)) return;
      if (!S.sleeping && t - S.lastInput > SLEEP_AFTER) {
        startSleep();
        return;
      }
      if (S.sleeping) return;
      if (S.base === 'idle' && player.name === 'idle' && t > S.nextBlink) {
        S.nextBlink = t + rand(2600, 6800);
        player.set('blink', true, () => player.set(S.base));
      }
      if (t > S.nextIdleTalk) {
        S.nextIdleTalk = t + rand(55000, 110000);
        if (!bubble.visible && t - S.lastSpeech > IDLE_TALK_MIN_GAP) {
          const line = pick(guide.idle);
          if (line) showBubble(line);
        }
      }
      // 어떤 흐름이 rest()를 빠뜨려도 멈춰 있지 않게
      if (S.restUntil === Infinity && t - S.seqT > 45000 && !bubble.visible) rest(2000, 5000);
      if (t < S.restUntil) return;
      if (S.roam) runAction(pickRoam());
      else {
        S.restUntil = t + rand(22000, 42000);
        const tok = S.seq;
        lookAround(tok);
      }
    }

    // ── 설정 ──
    function setRoaming(v) {
      S.roam = !!v;
      store.set('roam', S.roam);
      if (!S.roam) {
        begin();
        finishWalk(false);
        rest();
      } else rest(1500, 3500);
    }
    function setExplain(v) {
      S.explain = !!v;
      store.set('explain', S.explain);
      if (!S.explain) cancel(S.hoverTimer);
    }
    function setSize(k) {
      if (!SIZES[k]) return;
      S.sizeKey = k;
      S.size = SIZES[k];
      S.scale = S.size / S.pack.cell;
      store.set('size', k);
      layoutPet();
      if (S.mode === 'ground' && S.surface && S.surface.type === 'floor') {
        const [mn, mx] = floorRange();
        S.x = clamp(S.x, mn, mx);
      }
    }

    // ── 시작 위치 ──
    function placeInitial() {
      const visited = !!store.get('visited');
      const [mn, mx] = floorRange();
      if (visited && store.get('hidden')) {
        S.x = mx;
        S.y = floorY();
        S.mode = 'ground';
        S.surface = { type: 'floor' };
        hide(true);
        return;
      }
      const pos = store.get('pos');
      if (visited && isObj(pos)) {
        if (pos.k === 'perch' && pos.id) {
          const el = findPerch(pos.id);
          if (el) {
            const r = el.getBoundingClientRect();
            if (perchVisible(el, r)) {
              const s = perchSurface(el, r);
              S.x = clamp(r.left + (Number(pos.r) || 0.5) * r.width, s.left, Math.max(s.left, s.right));
              landOn({ type: 'perch', el, off: S.x - r.left }, r.top, true);
              rest(4000, 9000);
              return;
            }
          }
        }
        S.x = clamp((Number.isFinite(Number(pos.r)) ? Number(pos.r) : 0.92) * W(), mn, mx);
        landOn({ type: 'floor' }, floorY(), true);
        rest(4000, 9000);
        return;
      }
      S.x = clamp(W() - 24 - S.size / 2, mn, mx); // 챗봇 버튼 자리
      if (!visited && o.firstVisit) firstVisit();
      else {
        store.set('visited', true);
        landOn({ type: 'floor' }, floorY(), true);
        rest(4000, 9000);
      }
    }
    async function firstVisit() {
      store.set('visited', true);
      const tok = begin();
      S.facing = -1;
      // 등장·인사 중에는 화면 안내·마우스 설명이 끼어들지 않는다 (중간에 끊겨도 finally에서 풀려 미뤄 둔 안내가 이어진다)
      S.booting = true;
      try {
        if (reduced) landOn({ type: 'floor' }, floorY(), true);
        else {
          // 오른쪽 아래(챗봇 버튼 자리)로 곧장 떨어지게 위젯 윗면은 지나친다
          S.y = Math.max(minFootY(), floorY() - Math.min(320, H() * 0.4));
          S.vx = 0;
          S.vy = 0;
          S.passThrough = true;
          petEl.style.visibility = 'hidden';
          shadowEl.style.visibility = 'hidden';
          S.mode = 'boot';
          await wait(500, tok);
          if (S.destroyed) return;
          petEl.style.visibility = '';
          shadowEl.style.visibility = '';
          if (S.mode === 'boot') {
            S.mode = 'air';
            player.set('fall', true);
          }
          const ok = await waitLanding();
          if (!ok || tok !== S.seq) return;
          await wait(260, tok);
        }
        if (tok !== S.seq) return;
        const greet = greetingLines();
        await showBubble(greet[0], { anim: 'wave' });
        if (tok !== S.seq) return;
        if (greet[1]) {
          await showBubble(greet[1]);
          if (tok !== S.seq) return;
        }
        S.booting = false;
        // 대시보드(또는 화면 안내가 없는 화면)면 처음 안내, 화면 안내가 있는 다른 화면이면 그 화면 안내부터.
        // 처음 안내는 그때 'toured'로 남기므로, 다른 화면에서 시작했으면 나중에 대시보드에 처음 올 때 돈다.
        const k = S.screen;
        if (k && k !== 'dashboard' && guide.screens[k] && !store.get(`seen:${k}`)) {
          S.pending = { key: k, since: now() - 350, nextCheck: 0 };
          end(tok);
        } else if (guide.tour.some((st) => findTarget(st.target)) && !store.get('toured')) {
          S.pending = null;
          startTour();
        } else {
          showHint();
          end(tok);
        }
      } finally {
        S.booting = false;
      }
    }

    // ── 매 프레임 ──
    function frame(ts) {
      if (S.destroyed) return;
      S.raf = global.requestAnimationFrame(frame);
      let dt = (ts - S.lastTs) / 1000;
      S.lastTs = ts;
      if (!(dt > 0)) dt = 0;
      dt = Math.min(dt, 0.05);
      const t = now();
      invalidateCache();
      // 설명하던 요소가 화면 이동으로 빠졌으면 그 말풍선은 닫는다
      if (bubble.visible && bubble.anchor && !bubble.anchor.isConnected) closeBubble('gone');
      if (S.mode === 'hidden') {
        tabPlayer.update(dt * 1000);
        tabPlayer.draw();
        updateFlashes(t);
        return;
      }
      if (S.mode === 'boot') return;
      if (S.mode === 'ground') groundUpdate(dt, t);
      else if (S.mode === 'climb') climbUpdate(dt, t);
      else if (S.mode === 'air') airUpdate(dt);
      else if (S.mode === 'jump') jumpUpdate(dt);
      let target = 0;
      if (S.mode === 'drag') {
        S.dragVx = S.dragVx * 0.8 + ((S.x - S.prevX) / Math.max(dt, 0.001)) * 0.2;
        target = clamp(S.dragVx * 0.03, -32, 32) + Math.sin(t / 170) * 3;
      } else if (S.mode === 'air') target = clamp(S.vx * 0.012, -14, 14);
      if (reduced) {
        S.rot = 0;
        S.rotV = 0;
      } else if (dt > 0) {
        const acc = 110 * (target - S.rot) - 11 * S.rotV;
        S.rotV += acc * dt;
        S.rot += S.rotV * dt;
        if (S.mode === 'ground' && Math.abs(S.rot) < 0.05 && Math.abs(S.rotV) < 0.05) {
          S.rot = 0;
          S.rotV = 0;
        }
      }
      S.prevX = S.x;
      S.squash = Math.max(0, S.squash - dt * 7);
      pumpAfterNav(t);
      pumpScreen(t);
      brain(t);
      player.update(dt * 1000);
      render();
      positionBubble();
      positionChat();
      positionHint(t);
      updateFlashes(t);
      if (S.picker) {
        for (const it of S.picker.players) {
          if (!it.pl.pack) continue;
          it.pl.update(dt * 1000);
          if (it.pl.done) it.pl.set('idle', true);
          it.pl.draw();
        }
      }
    }

    // ── 개발 확인용 상태 ──
    function debugState(name) {
      const b = petBox();
      if (typeof name === 'string' && name.startsWith('path:')) {
        // path:<perch 키 | floor> — 지금 자리에서 그 면까지 고른 길 (확인용 요약)
        const key = name.slice(5);
        const path = planPath(key === 'floor' ? null : findPerch(key));
        if (!path) return null;
        return path.map((e) => `${e.kind}${e.kind === 'ladder' ? `@${Math.round(e.x)}` : ''}:${e.to.type === 'floor' ? 'floor' : perchKey(e.to.el) || '?'}(${Math.round(e.from.top - e.to.top)})`).join(' > ');
      }
      if (typeof name === 'string' && (name.startsWith('go:') || name.startsWith('go!:'))) {
        // go:<perch 키> — 혼자 갈 때 속도로 그 면까지 간다 (go!: 빠르게)
        const fast = name.startsWith('go!:');
        const el = findPerch(name.slice(fast ? 4 : 3));
        if (!el) return false;
        const tok = begin();
        S.flow = tok;
        travelTo(el, tok, { run: fast, sitAfter: true }).finally(() => end(tok));
        return true;
      }
      if (typeof name === 'string' && name.startsWith('ask:')) {
        // ask:<질문> — 대화창을 열고 그 질문을 한다
        openChat();
        ask(name.slice(4));
        return true;
      }
      if (typeof name === 'string' && name.startsWith('read:')) {
        // read:<레코드 번호> — 그 항목을 읽은 결과(말풍선 없이)
        const el = findItemByCode(name.slice(5));
        return el ? readItem(el) : null;
      }
      if (typeof name === 'string' && name.startsWith('spot:')) {
        // spot:<target 키> — 공중의 요소를 가리키러 설 자리 (면 키 · x · 비용)
        const el = findTarget(name.slice(5));
        const sp = el ? standSpotFor(el) : null;
        return sp ? { surface: sp.c.type === 'floor' ? 'floor' : perchKey(sp.c.el) || 'perch', x: Math.round(sp.x), cost: Math.round(sp.cost) } : null;
      }
      switch (name) {
        case 'item': {
          // 화면에 보이는 첫 항목을 읽어 준다
          const el = Array.from(doc.querySelectorAll('[data-pet-item]')).find((x) => !root.contains(x) && x.getBoundingClientRect().height > 0);
          if (el) readItemEl(el, false);
          return el ? readItem(el) : null;
        }
        case 'term': {
          // 용어집에 있는 첫 머리글·라벨을 설명한다
          for (const el of doc.querySelectorAll(TERM_SEL)) {
            if (root.contains(el) || el.getBoundingClientRect().height <= 0) continue;
            const g = termOf(el);
            if (g) {
              explainTerm(el, g, false);
              return g;
            }
          }
          return null;
        }
        case 'menu':
          openMenu(b.left - 6, b.top + 10);
          break;
        case 'chat': {
          openChat();
          const f = guide.faq.find((q) => !q.pet && q.target && findTarget(q.target)) || guide.faq[0];
          if (f) ask(f.q);
          break;
        }
        case 'chat-miss':
          openChat();
          ask('오늘 점심 메뉴 뭐예요');
          break;
        case 'picker':
          openPicker(false);
          break;
        case 'make':
          openPicker(true);
          break;
        case 'hidden':
          hide();
          break;
        case 'explain': {
          const keys = ['widget:PROCESS_FLOW', 'salesOrders', 'dashboard'];
          const key = keys.find((k) => findTarget(k) && targetInfo(k, findTarget(k))) || null;
          const el = key ? findTarget(key) : doc.querySelector('[data-pet-target]');
          if (el) explainEl(el, false);
          break;
        }
        case 'more': {
          const el = findTarget('salesOrders') || doc.querySelector('[data-pet-target]');
          if (!el) break;
          const info = targetInfo(el.getAttribute('data-pet-target'), el);
          if (!info) break;
          const tok = begin();
          showBubble(info.lines[0] || info.short, { title: info.title, step: info.lines.length > 1 ? `1/${info.lines.length}` : null, closable: true, actions: info.lines.length > 1 ? [{ label: '확인', value: 'ok' }, { label: '다음', value: 'next', primary: true }] : [{ label: '확인', value: 'ok', primary: true }], note: info.req.join(' · ') || null }).then(() => end(tok));
          break;
        }
        case 'tour':
          startTour();
          break;
        case 'sleep':
          S.lastInput = -1e9;
          startSleep();
          break;
        case 'perch':
        case 'sit': {
          const ps = listPerches(true).slice().sort((a, c) => c.top - a.top);
          const p = ps[0];
          if (!p) break;
          begin();
          S.x = clamp(p.left + (p.right - p.left) * 0.7, p.left, p.right);
          landOn({ type: 'perch', el: p.el, off: S.x - p.el.getBoundingClientRect().left }, p.top, true);
          if (name === 'sit') setBase('sit');
          S.restUntil = Infinity;
          break;
        }
        case 'drag':
          begin();
          S.mode = 'drag';
          S.surface = null;
          S.x -= 140;
          S.y -= 220;
          S.prevX = S.x - 14;
          S.dragVx = 900;
          player.set('drag', true);
          root.classList.add('fp-dragging');
          break;
        case 'hint':
          store.set('hinted', false);
          showHint();
          break;
        case 'walk':
          S.restUntil = Infinity;
          walkTo(S.x - 300);
          break;
        default:
          break;
      }
    }

    // ── 시작 ──
    const ready = (async () => {
      const forced = o.character && packs.find((p) => p.id === o.character);
      const stored = store.get('char');
      let first = forced || packs.find((p) => p.id === stored) || packs.find((p) => p.id === o.defaultCharacter) || packs[0];
      await loadPack(first);
      if (first._broken) {
        first = packs.find((p) => !p._broken && p !== first) || normalizePack(buildFallbackCharacter());
        if (!packs.includes(first)) packs.push(first);
        await loadPack(first);
      }
      if (S.destroyed) return;
      applyPack(first);
      S.mode = 'ground';
      S.surface = { type: 'floor' };
      S.x = W() - 60;
      S.y = floorY();
      placeInitial();
      S.lastTs = performance.now();
      S.raf = global.requestAnimationFrame(frame);
      packs.forEach((p) => loadPack(p));
    })();

    function destroy() {
      if (S.destroyed) return;
      // later()는 이 표시를 보고 새 타이머를 걸지 않는다. 기다리던 흐름은 풀린 뒤 tok·destroyed를 보고 멈춘다
      S.destroyed = true;
      S.pending = null;
      global.cancelAnimationFrame(S.raf);
      S.raf = 0;
      offs.splice(0).forEach((f) => f());
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      if (chat.ro) chat.ro.disconnect();
      chat.ro = null;
      flushLanding(false);
      root.remove();
    }

    const whenReady = (fn) => ready.then(() => (S.destroyed ? undefined : fn()));
    return {
      ready,
      destroy,
      say: (text, opt) => whenReady(() => showBubble(text, opt)),
      show: () => whenReady(() => show()),
      hide: () => whenReady(() => hide()),
      toggle: () => whenReady(() => toggleHidden()),
      setCharacter: (id) => whenReady(() => setCharacter(id, true)),
      goTo: (key) => whenReady(() => goTo(key)),
      explain: (key) => whenReady(() => {
        const el = findTarget(key);
        if (el) explainEl(el, false);
        return !!el;
      }),
      startTour: () => whenReady(() => startTour()),
      startScreenTour: (key) => whenReady(() => startScreenTour(key, false)),
      // 준비 전에도 바로 기억한다 (안내는 준비된 뒤 한가할 때 돈다)
      setScreen: (key) => {
        if (!S.destroyed) setScreen(key);
      },
      openChat: () => whenReady(() => openChat()),
      closeChat: () => whenReady(() => closeChat()),
      openMenu: () => whenReady(() => {
        const b = petBox();
        openMenu(b.left, b.top);
      }),
      openPicker: () => whenReady(() => openPicker(false)),
      setRoaming: (v) => whenReady(() => setRoaming(v)),
      setExplain: (v) => whenReady(() => setExplain(v)),
      setSize: (k) => whenReady(() => setSize(k)),
      debug: (name) => whenReady(() => debugState(name)),
      characters: () => packs.map((p) => ({ id: p.id, name: p.name, desc: p.desc })),
      state: () => ({ mode: S.mode, character: S.pack ? S.pack.id : null, size: S.sizeKey, roaming: S.roam, explain: S.explain, hidden: S.mode === 'hidden', usingGuide: guide.real, x: Math.round(S.x), y: Math.round(S.y), anim: player.name, surface: S.surface ? (S.surface.type === 'perch' ? perchKey(S.surface.el) || 'perch' : 'floor') : null, climb: S.climb ? S.climb.kind : null, ladders: root.querySelectorAll('.fp-ladder').length, screen: S.screen, tour: S.tour ? S.tour.kind : null, pendingScreen: S.pending ? S.pending.key : null, perches: S.pack ? listPerches(false).length : 0 }),
    };
  }

  // ── 공개 API ──────────────────────────────────────────
  let inst = null;
  // 붙기 전(또는 떼었다 다시 붙는 사이)에 받은 화면. 다음 mount에 screen 옵션이 없으면 이것을 쓴다
  let lastScreen;
  const none = () => Promise.resolve(false);
  const api = {
    version: VERSION,
    /** 펫을 붙인다. 이미 있으면 떼고 다시 붙인다. */
    mount(options) {
      if (inst) inst.destroy();
      inst = null;
      const opts = Object.assign({}, options || {});
      if (opts.screen === undefined && lastScreen !== undefined) opts.screen = lastScreen;
      else if (opts.screen !== undefined) lastScreen = opts.screen;
      inst = createPet(opts);
      return api;
    },
    /** 화면이 바뀌면 부른다(SCREEN 키, 모르는 화면이면 null). 처음 온 화면이면 한가할 때 그 화면 안내를 한다 */
    setScreen(key) {
      lastScreen = typeof key === 'string' && key ? key : null;
      if (inst) inst.setScreen(lastScreen);
    },
    startScreenTour: (key) => (inst ? inst.startScreenTour(key) : none()),
    destroy() {
      if (inst) inst.destroy();
      inst = null;
      const st = doc.getElementById(STYLE_ID);
      if (st) st.remove();
    },
    say: (text, opt) => (inst ? inst.say(text, opt) : none()),
    show: () => (inst ? inst.show() : none()),
    hide: () => (inst ? inst.hide() : none()),
    toggle: () => (inst ? inst.toggle() : none()),
    setCharacter: (id) => (inst ? inst.setCharacter(id) : none()),
    goTo: (key) => (inst ? inst.goTo(key) : none()),
    explain: (key) => (inst ? inst.explain(key) : none()),
    startTour: () => (inst ? inst.startTour() : none()),
    openChat: () => (inst ? inst.openChat() : none()),
    closeChat: () => (inst ? inst.closeChat() : none()),
    openMenu: () => (inst ? inst.openMenu() : none()),
    openPicker: () => (inst ? inst.openPicker() : none()),
    setRoaming: (v) => (inst ? inst.setRoaming(v) : none()),
    setExplain: (v) => (inst ? inst.setExplain(v) : none()),
    setSize: (k) => (inst ? inst.setSize(k) : none()),
    /** 개발 확인용: 'ask:<질문>' | 'read:<번호>' | 'item' | 'term' | 'menu' | 'chat' |'chat-miss' | 'picker' | 'make' | 'hidden' | 'explain' | 'more' | 'tour' | 'sleep' | 'perch' | 'sit' | 'drag' | 'hint' | 'walk' */
    debug: (name) => (inst ? inst.debug(name) : none()),
    characters: () => (inst ? inst.characters() : []),
    state: () => (inst ? inst.state() : null),
    get ready() {
      return inst ? inst.ready : Promise.resolve();
    },
  };
  global.FantaPet = api;
})(window);
