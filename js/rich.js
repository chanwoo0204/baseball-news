// ─────────────────────────────────────────────
// 기사 본문(서식 있는 글) 정리기
// 허용된 태그만 남기고 스크립트 등 위험한 것은 지웁니다.
// 기사 화면과 관리자 페이지가 함께 씁니다.
// ─────────────────────────────────────────────
(function () {
  // 남길 태그와, 그 태그에 남길 속성
  const KEEP = {
    P: [], H2: [], H3: [], STRONG: [], B: [], EM: [], I: [], U: [], S: [],
    BLOCKQUOTE: [], UL: [], OL: [], LI: [], A: ['href'], BR: [], HR: [],
    FIGURE: [], FIGCAPTION: [], IMG: ['src', 'alt'], SPAN: ['class'], DIV: [],
  };
  // 내용째 지울 태그
  const DROP = /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|FORM|INPUT|BUTTON|TEXTAREA|SELECT|LINK|META|SVG|MATH|NOSCRIPT|VIDEO|AUDIO|CANVAS|TITLE|HEAD)$/;
  // 글꼴·크기용으로 허용한 class
  const CLASSES = ['f-sans', 'f-serif', 's-sm', 's-lg', 's-xl'];
  const okUrl = (u) => /^https?:\/\/\S+$/i.test(String(u || '').trim());

  function unwrap(node) { node.replaceWith(...Array.from(node.childNodes)); }

  function clean(parent) {
    Array.from(parent.childNodes).forEach((node) => {
      if (node.nodeType === 3) return;              // 글자는 그대로
      if (node.nodeType !== 1) { node.remove(); return; }
      const tag = node.tagName.toUpperCase();
      if (DROP.test(tag)) { node.remove(); return; }
      clean(node);
      if (!KEEP[tag]) { unwrap(node); return; }     // 모르는 태그는 껍데기만 벗김
      Array.from(node.attributes).forEach((at) => {
        if (KEEP[tag].indexOf(at.name.toLowerCase()) === -1) node.removeAttribute(at.name);
      });
      if (tag === 'A') {
        if (okUrl(node.getAttribute('href'))) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener nofollow');
        } else node.removeAttribute('href');
      }
      if (tag === 'IMG') {
        if (!okUrl(node.getAttribute('src'))) { node.remove(); return; }
        node.setAttribute('loading', 'lazy');
      }
      if (tag === 'SPAN') {
        const cls = (node.getAttribute('class') || '').split(/\s+/).filter((c) => CLASSES.indexOf(c) !== -1);
        if (cls.length) node.setAttribute('class', cls.join(' '));
        else unwrap(node);
      }
    });
  }

  function sanitize(html) {
    const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
    clean(doc.body);
    return doc.body.innerHTML;
  }

  // 예전 방식(줄바꿈만 있는 글)을 문단으로 바꿉니다
  function fromText(text) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
      .map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
  }

  window.Rich = { sanitize: sanitize, fromText: fromText };
})();
