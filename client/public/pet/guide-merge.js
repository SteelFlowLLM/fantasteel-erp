/* 영역별 화면 설명(public/pet/guide/<영역>.js → window.FANTA_PET_GUIDE_PARTS)을 기본 설명(window.FANTA_PET_GUIDE)에 합친다.
 * 묶음 하나: { area, screens: { <SCREEN 키>: { intro, tour: [{ target, text }], locked } }, targets: { <키>: {...} }, faq: [...], idle: [...],
 *   (locked = 열 권한이 없어 잠긴 화면에서 intro 대신 할 말. 누가 쓰는 곳인지·무엇을 하는 곳인지만 적는다)
 *   glossary: { <범위 키>: { <용어>: 설명 } }, items: { <항목 종류>: { name, tips, status } } }
 * 같은 키는 나중 묶음이 이긴다. 엔진보다 먼저 불러야 한다. */
(function (global) {
  'use strict';
  var base = global.FANTA_PET_GUIDE || {};
  var parts = global.FANTA_PET_GUIDE_PARTS || [];
  base.targets = base.targets || {};
  base.faq = base.faq || [];
  base.idle = base.idle || [];
  base.screens = base.screens || {};
  base.glossary = base.glossary || {};
  base.items = base.items || {};
  parts.forEach(function (part) {
    if (!part || typeof part !== 'object') return;
    if (part.targets) Object.keys(part.targets).forEach(function (k) { base.targets[k] = part.targets[k]; });
    if (part.screens) Object.keys(part.screens).forEach(function (k) { base.screens[k] = part.screens[k]; });
    if (part.glossary) Object.keys(part.glossary).forEach(function (scope) {
      var src = part.glossary[scope];
      if (!src || typeof src !== 'object') return;
      var dst = base.glossary[scope] || (base.glossary[scope] = {});
      Object.keys(src).forEach(function (term) { dst[term] = src[term]; });
    });
    // 같은 항목 종류를 여러 영역이 설명하면 덮어쓰지 않고 합친다: 이름은 먼저 것, 한마디는 이어 붙이고, 상태별 한마디는 나중 것이 이긴다
    if (part.items) Object.keys(part.items).forEach(function (k) {
      var src = part.items[k];
      if (!src || typeof src !== 'object') return;
      var dst = base.items[k];
      if (!dst) { base.items[k] = { name: src.name, tips: (src.tips || []).slice(), status: Object.assign({}, src.status || {}) }; return; }
      if (!dst.name) dst.name = src.name;
      (src.tips || []).forEach(function (t) { if (dst.tips.indexOf(t) < 0) dst.tips.push(t); });
      Object.assign(dst.status, src.status || {});
    });
    if (Array.isArray(part.faq)) base.faq = base.faq.concat(part.faq);
    if (Array.isArray(part.idle)) base.idle = base.idle.concat(part.idle);
  });
  global.FANTA_PET_GUIDE = base;
})(typeof window !== 'undefined' ? window : this);
