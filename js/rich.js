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
    VIDEO: ['src'], IFRAME: ['src'],
  };
  // 내용째 지울 태그
  const DROP = /^(SCRIPT|STYLE|OBJECT|EMBED|TEMPLATE|FORM|INPUT|BUTTON|TEXTAREA|SELECT|LINK|META|SVG|MATH|NOSCRIPT|AUDIO|CANVAS|TITLE|HEAD)$/;
  // 글꼴·크기용으로 허용한 class
  const CLASSES = ['f-sans', 'f-serif', 's-sm', 's-lg', 's-xl',
    's-10', 's-11', 's-12', 's-14', 's-16', 's-18', 's-20', 's-24', 's-28',
    'c-black', 'c-gray', 'c-navy', 'c-blue', 'c-red', 'c-orange', 'c-green'];
  // 유튜브 영상만 넣을 수 있습니다
  const YT = /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/[\w-]{6,20}(\?[\w=&-]*)?$/;
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
      if (tag === 'IFRAME') {
        if (!YT.test(node.getAttribute('src') || '')) { node.remove(); return; }
        node.setAttribute('allowfullscreen', '');
        node.setAttribute('loading', 'lazy');
        node.setAttribute('title', '동영상');
        node.setAttribute('allow', 'accelerometer; encrypted-media; gyroscope; picture-in-picture');
        node.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      }
      if (tag === 'VIDEO') {
        if (!okUrl(node.getAttribute('src'))) { node.remove(); return; }
        node.textContent = '';
        node.setAttribute('controls', '');
        node.setAttribute('playsinline', '');
        node.setAttribute('preload', 'metadata');
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

  // 유튜브 주소를 넣을 수 있는 형식으로 바꿉니다 (아니면 빈 값)
  function youtubeEmbed(url) {
    const m = String(url || '').trim().match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{6,20})/);
    return m ? 'https://www.youtube-nocookie.com/embed/' + m[1] : '';
  }

  window.Rich = { sanitize: sanitize, fromText: fromText, youtubeEmbed: youtubeEmbed };
})();
