// ─────────────────────────────────────────────
// 화면 담당 파일
// 주소 뒤의 # 부분을 보고 어떤 화면을 그릴지 정합니다.
//   #/              첫 화면 (큰 기사 1 + 작은 기사 2 + 최신 기사)
//   #/c/이적        카테고리별 기사
//   #/article/3     기사 본문 + 댓글
//   #/board         게시판 (?cat=잡담&page=2&q=검색어 를 붙일 수 있음)
//   #/board/12      게시글 + 댓글
//   #/write         글쓰기 (로그인 필요)
//   #/store         매거진 구매 안내
//   #/search/검색어 전체 검색 결과
//   #/login         로그인 · 회원가입
//   #/admin         관리자 페이지(admin.html)로 이동
// ─────────────────────────────────────────────
(function () {
  const cfg = window.SITE_CONFIG || {};
  const API = window.API;
  const app = document.getElementById('app');
  const CATEGORIES = cfg.CATEGORIES || [];
  const BOARD_CATEGORIES = cfg.BOARD_CATEGORIES || ['잡담'];
  const NOTICE = API.NOTICE;
  let user = null;      // 로그인한 사람 ({ id, nickname, isStaff, isAdmin, banned }) 또는 null
  let returnTo = '';    // 로그인 후 돌아갈 주소
  let loginError = '';  // 네이버 로그인에서 돌아왔을 때의 오류 안내
  let textSize = 18;    // 기사 본문 글자 크기 (독자가 조절)
  try { textSize = Number(localStorage.getItem('bn_fs')) || 18; } catch (e) { /* 무시 */ }

  // ── 도우미 ──────────────────────────────────
  // 사용자가 쓴 글을 화면에 넣기 전에 반드시 거치는 함수 (악성 코드 방지)
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const sameDay = d.toDateString() === new Date().toDateString();
    if (sameDay) return two(d.getHours()) + ':' + two(d.getMinutes());
    return String(d.getFullYear()).slice(2) + '.' + two(d.getMonth() + 1) + '.' + two(d.getDate());
  }
  // 기사에 붙는 날짜: 26.11.20 처럼
  function ymd(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return String(d.getFullYear()).slice(2) + '.' + two(d.getMonth() + 1) + '.' + two(d.getDate());
  }
  // http(s) 주소만 사진/링크로 허용
  function safeUrl(url) {
    return /^https?:\/\//i.test(url || '') ? url : '';
  }
  function errorBox(err) {
    console.error(err);
    return '<div class="page"><p class="notice">불러오지 못했습니다. 잠시 후 다시 시도해 주세요.<br><small>' +
      esc(err && err.message ? err.message : err) + '</small></p></div>';
  }
  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const cut = raw.indexOf('?');
    const query = {};
    if (cut !== -1) {
      raw.slice(cut + 1).split('&').forEach((pair) => {
        const eq = pair.indexOf('=');
        if (eq > 0) {
          try { query[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1)); } catch (e) { /* 잘못된 주소는 무시 */ }
        }
      });
    }
    return { path: cut === -1 ? raw : raw.slice(0, cut), query: query };
  }
  function canDelete(row) {
    // 사이트에서는 본인 글만 지울 수 있습니다 (다른 사람 글은 관리자 페이지에서)
    return !!user && !!row.user_id && row.user_id === user.id;
  }
  // 삭제 버튼: 실수 방지를 위해 두 번 눌러야 실행됩니다
  function armDelete(btn, run) {
    btn.addEventListener('click', async function () {
      if (!btn.dataset.sure) {
        btn.dataset.sure = '1';
        btn.textContent = '정말 삭제';
        return;
      }
      btn.disabled = true;
      try { await run(); }
      catch (err) { console.error(err); btn.textContent = '삭제 실패'; }
    });
  }
  function bannedNote() {
    return '<p class="login-prompt">이용이 정지된 계정이라 글과 댓글을 쓸 수 없습니다.</p>';
  }
  function nickPrompt() {
    return '<p class="login-prompt">글을 쓰기 전에 닉네임을 먼저 정해 주세요. <a class="text-link" href="#/login" data-return>닉네임 정하기</a></p>';
  }
  function loginPrompt(text) {
    return '<p class="login-prompt">' + text + ' <a class="text-link" href="#/login" data-return>로그인</a></p>';
  }

  // ── 기사 카드 ───────────────────────────────
  // 사진이 없으면 네이비 줄무늬 바탕에 카테고리 이름이 들어갑니다
  function photo(a, eager) {
    const img = safeUrl(a.image_url);
    return '<span class="ph">' +
      (img ? '<img src="' + esc(img) + '" alt="" loading="' + (eager ? 'eager' : 'lazy') + '">'
           : '<span class="ph-word">' + esc(a.category) + '</span>') +
      '</span>';
  }
  function story(a, kind) {
    return '<a class="story story-' + kind + '" href="#/article/' + a.id + '">' +
      photo(a, kind === 'lead') +
      '<span class="story-text">' +
        '<span class="cat">' + esc(a.category) + '</span>' +
        '<strong class="story-title"><span>' + esc(a.title) + '</span></strong>' +
        (kind === 'lead' && a.summary ? '<span class="story-sum">' + esc(a.summary) + '</span>' : '') +
        '<span class="meta">' + (a.author_name ? '<span>' + esc(a.author_name) + '</span>' : '') + '<span>' + ymd(a.created_at) + '</span>' +
          (a.comment_count ? '<span>댓글 ' + a.comment_count + '</span>' : '') + '</span>' +
      '</span></a>';
  }
  function chips(active) {
    return '<nav class="chips" aria-label="기사 카테고리">' +
      '<a class="chip' + (active ? '' : ' on') + '" href="#/">전체</a>' +
      CATEGORIES.map((c) =>
        '<a class="chip' + (c === active ? ' on' : '') + '" href="#/c/' + encodeURIComponent(c) + '">' + esc(c) + '</a>').join('') +
      '</nav>';
  }

  // ── 첫 화면 ─────────────────────────────────
  function storeWide() {
    const url = safeUrl(cfg.STORE_URL);
    return '<a class="store-wide" ' + (url ? 'href="' + esc(url) + '" target="_blank" rel="noopener"' : 'href="#/store"') + '>' +
      '<span class="store-wide-text"><small>종이 매거진</small><strong>이번 호 매거진, 종이로 소장하세요</strong></span>' +
      '<span class="store-wide-go">매거진 구매하러 가기</span>' +
    '</a>';
  }
  // 큰 기사 자리: 옆으로 넘기는 슬라이드
  const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  function leadSlider(items) {
    if (items.length === 1) return story(items[0], 'lead');
    return '<div class="lead-slider" aria-roledescription="carousel" aria-label="주요 기사">' +
      '<div class="slides">' + items.map((a, i) =>
        '<div class="slide" role="group" aria-label="' + (i + 1) + ' / ' + items.length + '">' + story(a, 'lead') + '</div>').join('') + '</div>' +
      '<div class="sl-over">' +
        '<button type="button" class="sl-btn sl-prev" aria-label="이전 기사">' + ARROW + '</button>' +
        '<button type="button" class="sl-btn sl-next" aria-label="다음 기사">' + ARROW + '</button>' +
        '<div class="sl-dots">' + items.map((a, i) =>
          '<button type="button" class="sl-dot' + (i ? '' : ' on') + '" data-go="' + i + '" aria-label="' + (i + 1) + '번째 기사"></button>').join('') + '</div>' +
      '</div>' +
    '</div>';
  }
  let sliderTimer = null;
  function bindSlider() {
    clearInterval(sliderTimer);
    const box = app.querySelector('.lead-slider');
    if (!box) return;
    const track = box.querySelector('.slides');
    const dots = Array.from(box.querySelectorAll('.sl-dot'));
    const count = dots.length;
    const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    const go = (i) => { track.scrollTo({ left: ((i + count) % count) * track.clientWidth, behavior: 'smooth' }); };
    box.querySelector('.sl-prev').addEventListener('click', () => go(current() - 1));
    box.querySelector('.sl-next').addEventListener('click', () => go(current() + 1));
    dots.forEach((d) => d.addEventListener('click', () => go(Number(d.dataset.go))));
    track.addEventListener('scroll', () => {
      const n = current();
      dots.forEach((d, i) => d.classList.toggle('on', i === n));
    }, { passive: true });
    // 6초마다 자동으로 넘기고, 마우스를 올리거나 만지는 동안은 멈춥니다
    let paused = false;
    ['mouseenter', 'focusin', 'touchstart'].forEach((ev) => box.addEventListener(ev, () => { paused = true; }, { passive: true }));
    ['mouseleave', 'focusout'].forEach((ev) => box.addEventListener(ev, () => { paused = false; }));
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) sliderTimer = setInterval(() => { if (!paused && !document.hidden) go(current() + 1); }, 6000);
  }
  // 인스타그램 게시물 (인스타그램이 제공하는 퍼가기 방식)
  function instaSection(posts) {
    const url = safeUrl(cfg.INSTAGRAM_URL);
    if (!url) return '';
    const handle = (url.match(/instagram\.com\/([^/?#]+)/) || [])[1] || 'instagram';
    const go = '<a class="insta-go" href="' + esc(url) + '" target="_blank" rel="noopener">' +
      '<img class="insta-logo" src="img/instagram.png" alt=""><span>@' + esc(handle) + '</span><b>인스타그램 바로가기</b></a>';
    const list = posts.map((p) => API.instaUrl(p.url)).filter(Boolean);
    return '<section class="insta-sec">' +
      '<div class="insta-head"><h2 class="sec">인스타그램</h2>' + go + '</div>' +
      (list.length
        ? '<div class="insta-grid">' + list.map((u) =>
            '<blockquote class="instagram-media" data-instgrm-permalink="' + esc(u) + '" data-instgrm-version="14">' +
              '<a href="' + esc(u) + '" target="_blank" rel="noopener">인스타그램에서 보기</a></blockquote>').join('') + '</div>'
        : '') +
    '</section>';
  }
  function loadInstaEmbeds() {
    if (!app.querySelector('.instagram-media')) return;
    if (window.instgrm && window.instgrm.Embeds) { window.instgrm.Embeds.process(); return; }
    if (document.getElementById('instaEmbedJs')) return;
    const sc = document.createElement('script');
    sc.id = 'instaEmbedJs';
    sc.async = true;
    sc.src = 'https://www.instagram.com/embed.js';
    document.body.appendChild(sc);
  }
  async function viewHome() {
    const res = await Promise.all([API.homeArticles(), API.listInstaPosts(6).catch(() => []),
      API.popularArticles ? API.popularArticles(6).catch(() => []) : []]);
    const popular = res[2] || [];
    const list = res[0];
    const bottom = instaSection(res[1]) + storeWide();
    if (!list.length) {
      return chips('') + '<div class="wide"><p class="notice">아직 올라온 기사가 없습니다.</p>' + bottom + '</div>';
    }
    // 큰 기사 자리: 첫 장은 메인 배치의 큰 기사, 이어서 옆 기사 다음 순서의 최신 기사 최대 4개
    const side = list.slice(1, 3);
    const slides = [list[0]].concat(list.slice(3, 7));
    const rest = list.slice(7);
    return chips('') +
      '<div class="wide">' +
        '<section class="top-stories' + (side.length ? '' : ' solo') + '">' +
          leadSlider(slides) +
          (side.length ? '<div class="side">' + side.map((a) => story(a, 'side')).join('') + '</div>' : '') +
          (popular.length ? '<aside class="popular"><h2>가장 많이 읽은 기사</h2><ol>' + popular.map((a, i) =>
            '<li><a href="#/article/' + a.id + '"><span class="rank">' + (i + 1) + '</span>' +
              '<span class="pop-text"><small>' + esc(a.category) + '</small><span class="pop-title">' + esc(a.title) + '</span></span></a></li>').join('') +
            '</ol></aside>' : '') +
        '</section>' +
        (rest.length
          ? '<section><h2 class="sec">최신 기사</h2><div class="grid">' +
              rest.map((a) => story(a, 'grid')).join('') + '</div></section>'
          : '') +
        bottom +
      '</div>';
  }

  // ── 카테고리별 기사 ─────────────────────────
  async function viewCategory(category) {
    const list = await API.listArticles(category, 60);
    return chips(category) +
      '<div class="wide">' +
        '<h1 class="cat-title">' + esc(category) + '</h1>' +
        (list.length
          ? '<div class="grid">' + list.map((a) => story(a, 'grid')).join('') + '</div>'
          : '<p class="notice">아직 이 카테고리에 기사가 없습니다.</p>') +
      '</div>';
  }

  // ── 기사 본문 ───────────────────────────────
  function fullDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '.' + two(d.getMonth() + 1) + '.' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  async function viewArticle(id) {
    const a = await API.getArticle(id);
    if (!a) return '<div class="page"><p class="notice">기사를 찾을 수 없습니다.</p></div>';
    const img = safeUrl(a.image_url);
    const related = (await API.listArticles(a.category, 4).catch(() => []))
      .filter((r) => r.id !== a.id).slice(0, 3);
    const edited = a.updated_at && (new Date(a.updated_at) - new Date(a.created_at) > 60000);
    const body = a.format === 'html'
      ? '<div class="body rich">' + Rich.sanitize(a.body) + '</div>'
      : '<div class="body plain">' + esc(a.body) + '</div>';
    return '<article class="page article" style="--fs:' + textSize + 'px">' +
      '<a class="cat" href="#/c/' + encodeURIComponent(a.category) + '">' + esc(a.category) + '</a>' +
      '<h1>' + esc(a.title) + '</h1>' +
      (a.summary ? '<p class="dek">' + esc(a.summary) + '</p>' : '') +
      '<div class="byline">' +
        '<div class="byline-who">' +
          (a.author_name ? '<b>' + esc(a.author_name) + '</b>' : '') +
          '<span>입력 ' + ymd(a.created_at) + '</span>' +
          (edited ? '<span>수정 ' + ymd(a.updated_at) + '</span>' : '') +
        '</div>' +
        '<div class="byline-tools">' +
          '<button type="button" class="tool-btn" data-size="-1" aria-label="글자 작게">가<small>−</small></button>' +
          '<button type="button" class="tool-btn" data-size="1" aria-label="글자 크게">가<small>+</small></button>' +
          '<button type="button" class="tool-btn" id="copyLink">링크 복사</button>' +
        '</div>' +
      '</div>' +
      (img ? '<figure class="hero"><img src="' + esc(img) + '" alt="">' +
        (a.image_caption ? '<figcaption>' + esc(a.image_caption) + '</figcaption>' : '') + '</figure>' : '') +
      body +
      '<a class="store-banner" href="#/store"><b>이번 호 매거진, 종이로 읽기</b><span>스마트스토어에서 구매</span></a>' +
      (related.length
        ? '<section class="related"><h2 class="sec">' + esc(a.category) + ' 기사 더 보기</h2>' +
            '<div class="grid grid-3">' + related.map((r) => story(r, 'grid')).join('') + '</div></section>'
        : '') +
      '<section class="comments" data-target="article_id" data-id="' + a.id + '"></section>' +
    '</article>';
  }
  function bindArticle() {
    const art = app.querySelector('.article');
    if (!art) return;
    art.querySelectorAll('[data-size]').forEach((b) => {
      b.addEventListener('click', function () {
        textSize = Math.min(24, Math.max(15, textSize + Number(b.dataset.size)));
        art.style.setProperty('--fs', textSize + 'px');
        try { localStorage.setItem('bn_fs', String(textSize)); } catch (e) { /* 무시 */ }
      });
    });
    const copy = document.getElementById('copyLink');
    if (copy) {
      copy.addEventListener('click', async function () {
        try { await navigator.clipboard.writeText(location.href); copy.textContent = '복사했습니다'; }
        catch (e) { copy.textContent = '주소창의 링크를 복사해 주세요'; }
        setTimeout(() => { copy.textContent = '링크 복사'; }, 2000);
      });
    }
  }

  // ── 게시판 목록 ─────────────────────────────
  function boardHref(o) {
    const parts = [];
    if (o.cat) parts.push('cat=' + encodeURIComponent(o.cat));
    if (o.page && o.page > 1) parts.push('page=' + o.page);
    if (o.q) parts.push('q=' + encodeURIComponent(o.q));
    return '#/board' + (parts.length ? '?' + parts.join('&') : '');
  }
  function boardRow(p, isNotice) {
    return '<a class="brow' + (isNotice ? ' is-notice' : '') + '" href="#/board/' + p.id + '">' +
      '<span class="b-no">' + (isNotice ? NOTICE : p.id) + '</span>' +
      '<span class="b-cat">' + esc(p.category) + '</span>' +
      '<span class="b-title"><span class="t">' + esc(p.title) + '</span>' +
        (p.comment_count ? '<em>[' + p.comment_count + ']</em>' : '') + '</span>' +
      '<span class="b-nick">' + esc(p.nickname) + '</span>' +
      '<span class="b-date">' + fmtDate(p.created_at) + '</span>' +
      '<span class="b-views">' + (p.views || 0) + '</span>' +
    '</a>';
  }
  async function viewBoard(match, query) {
    const cat = query.cat || '';
    const q = (query.q || '').trim();
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const res = await API.listPosts({ category: cat, page: page, q: q });

    const tabs = [''].concat(BOARD_CATEGORIES).map((c) =>
      '<a class="chip' + (c === cat ? ' on' : '') + '" href="' + boardHref({ cat: c, q: q }) + '">' + esc(c || '전체') + '</a>').join('');

    const pages = Math.max(1, Math.ceil(res.total / res.size));
    const from = Math.max(1, Math.min(page - 2, pages - 4));
    const to = Math.min(pages, from + 4);
    let pager = '';
    if (pages > 1) {
      if (page > 1) pager += '<a href="' + boardHref({ cat: cat, q: q, page: page - 1 }) + '">이전</a>';
      for (let i = from; i <= to; i++) {
        pager += '<a class="' + (i === page ? 'on' : '') + '" href="' + boardHref({ cat: cat, q: q, page: i }) + '">' + i + '</a>';
      }
      if (page < pages) pager += '<a href="' + boardHref({ cat: cat, q: q, page: page + 1 }) + '">다음</a>';
    }

    const rows = res.notices.map((p) => boardRow(p, true)).join('') + res.rows.map((p) => boardRow(p, false)).join('');
    return '<div class="page board">' +
      '<div class="page-head"><h1>게시판</h1><a class="btn" href="#/write">글쓰기</a></div>' +
      (API.live ? '' : '<p class="sample-badge">DB가 연결되지 않아 게시판을 쓸 수 없습니다.</p>') +
      '<nav class="chips board-tabs" aria-label="말머리">' + tabs + '</nav>' +
      (q ? '<p class="result-line">‘' + esc(q) + '’ 검색 결과 ' + res.total + '건 <a class="text-link" href="' + boardHref({ cat: cat }) + '">검색 지우기</a></p>' : '') +
      '<div class="brows">' +
        '<div class="brow brow-head"><span class="b-no">번호</span><span class="b-cat">말머리</span><span class="b-title">제목</span>' +
          '<span class="b-nick">글쓴이</span><span class="b-date">날짜</span><span class="b-views">조회</span></div>' +
        (rows || '<p class="notice">' + (q ? '찾은 글이 없습니다.' : '아직 글이 없습니다. 첫 글을 남겨 보세요.') + '</p>') +
      '</div>' +
      (pager ? '<nav class="pager" aria-label="쪽 번호">' + pager + '</nav>' : '') +
      '<form class="board-search" id="boardSearch" data-cat="' + esc(cat) + '" role="search">' +
        '<input type="search" name="q" placeholder="게시판 안에서 검색" aria-label="게시판 검색어" maxlength="50" value="' + esc(q) + '">' +
        '<button class="btn" type="submit">검색</button>' +
      '</form>' +
    '</div>';
  }

  // ── 게시글 ──────────────────────────────────
  async function viewPost(id) {
    const p = await API.getPost(id);
    if (!p) return '<div class="page"><p class="notice">글을 찾을 수 없습니다.</p></div>';
    return '<article class="page post">' +
      '<a class="back" href="#/board">게시판 목록</a>' +
      '<span class="cat">' + esc(p.category) + '</span>' +
      '<h1>' + esc(p.title) + '</h1>' +
      '<p class="meta"><b>' + esc(p.nickname) + '</b><span>' + fmtDate(p.created_at) + '</span><span>조회 ' + (p.views || 0) + '</span>' +
        (canDelete(p) ? '<button type="button" class="link-btn" id="postDelete" data-id="' + p.id + '">삭제</button>'
          : '<button type="button" class="report-btn" data-report="post:' + p.id + '">신고</button>') +
      '</p>' +
      '<div class="body">' + esc(p.body) + '</div>' +
      '<section class="comments" data-target="post_id" data-id="' + p.id + '"></section>' +
    '</article>';
  }

  // ── 글쓰기 ──────────────────────────────────
  async function viewWrite() {
    if (!user) {
      return '<div class="page narrow"><h1>글쓰기</h1>' + loginPrompt('글을 쓰려면 로그인이 필요합니다.') + '</div>';
    }
    if (user.banned) return '<div class="page narrow"><h1>글쓰기</h1>' + bannedNote() + '</div>';
    if (!user.nickname) {
      return '<div class="page narrow"><h1>글쓰기</h1>' + nickPrompt() + '</div>';
    }
    const cats = BOARD_CATEGORIES.concat(user.isStaff ? [NOTICE] : []);
    return '<div class="page">' +
      '<a class="back" href="#/board">게시판 목록</a>' +
      '<h1>글쓰기</h1>' +
      '<form class="form" id="writeForm">' +
        '<label>말머리<select name="category">' + cats.map((c) => '<option>' + esc(c) + '</option>').join('') + '</select></label>' +
        '<label>제목<input name="title" maxlength="100" required></label>' +
        '<label>내용<textarea name="body" rows="14" maxlength="5000" required></textarea></label>' +
        '<p class="meta">글쓴이는 ' + esc(user.nickname) + ' (으)로 표시됩니다.</p>' +
        '<p class="form-error" hidden></p>' +
        '<button class="btn big" type="submit">글 등록</button>' +
      '</form></div>';
  }
  function bindBoard() {
    const search = document.getElementById('boardSearch');
    if (search) {
      search.addEventListener('submit', function (e) {
        e.preventDefault();
        location.hash = boardHref({ cat: search.dataset.cat, q: search.q.value.trim() });
      });
    }
    const del = document.getElementById('postDelete');
    if (del) {
      armDelete(del, async function () {
        await API.deletePost(Number(del.dataset.id));
        location.hash = '#/board';
      });
    }
    const form = document.getElementById('writeForm');
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const post = {
        category: form.category.value,
        title: form.title.value.trim(),
        body: form.body.value.trim(),
      };
      if (!post.title || !post.body) return;
      const button = form.querySelector('button[type=submit]');
      const msg = form.querySelector('.form-error');
      button.disabled = true;
      try {
        const row = await API.createPost(post);
        location.hash = '#/board/' + row.id;
      } catch (err) {
        console.error(err);
        msg.textContent = '글을 등록하지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요.';
        msg.hidden = false;
        button.disabled = false;
      }
    });
  }

  // ── 댓글 (기사·게시글 공통) ─────────────────
  async function mountComments(box) {
    const key = box.dataset.target;
    const target = {};
    target[key] = Number(box.dataset.id);

    async function draw() {
      let list;
      try { list = await API.listComments(target); }
      catch (err) { box.innerHTML = errorBox(err); return; }
      box.innerHTML =
        '<h3>댓글 ' + list.length + '</h3>' +
        '<ul class="comment-list">' + list.map((c) =>
          '<li><p class="meta"><b>' + esc(c.nickname) + '</b><span>' + fmtDate(c.created_at) + '</span>' +
            (canDelete(c) ? '<button type="button" class="link-btn" data-cdel="' + c.id + '">삭제</button>'
              : '<button type="button" class="report-btn" data-report="comment:' + c.id + '">신고</button>') + '</p>' +
          '<p class="comment-body">' + esc(c.body) + '</p></li>').join('') + '</ul>' +
        (user && user.banned ? bannedNote() : user && !user.nickname ? nickPrompt() : user
          ? '<form class="form comment-form">' +
              '<textarea name="body" rows="3" placeholder="' + esc(user.nickname) + ' (으)로 댓글 남기기" aria-label="댓글 내용" maxlength="1000" required></textarea>' +
              '<p class="form-error" hidden></p>' +
              '<button class="btn" type="submit">댓글 등록</button>' +
            '</form>'
          : loginPrompt('댓글을 쓰려면 로그인이 필요합니다.'));
      const form = box.querySelector('form');
      if (form) form.addEventListener('submit', onSubmit);
      box.querySelectorAll('[data-cdel]').forEach((btn) => {
        armDelete(btn, async function () {
          await API.deleteComment(Number(btn.dataset.cdel));
          await draw();
        });
      });
      bindReturnLinks(box);
    }

    async function onSubmit(e) {
      e.preventDefault();
      const form = e.currentTarget;
      const body = form.body.value.trim();
      if (!body) return;
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        await API.createComment(Object.assign({ body: body }, target));
        await draw();
      } catch (err) {
        console.error(err);
        const msg = form.querySelector('.form-error');
        msg.textContent = '댓글을 등록하지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요.';
        msg.hidden = false;
        button.disabled = false;
      }
    }

    await draw();
  }

  // ── 신고 (익명) ─────────────────────────────
  function reported() {
    try { return JSON.parse(localStorage.getItem('bn_reported') || '[]'); } catch (e) { return []; }
  }
  function openReport(target) {
    let modal = document.getElementById('reportModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'reportModal';
      modal.className = 'modal';
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) modal.hidden = true; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });
    }
    const kind = target.split(':')[0] === 'post' ? '게시글' : '댓글';
    const done = reported().indexOf(target) !== -1;
    modal.innerHTML = '<form class="modal-box form" id="reportForm" role="dialog" aria-modal="true" aria-labelledby="reportTitle">' +
      '<h3 id="reportTitle">' + kind + ' 신고</h3>' +
      '<p class="meta">신고는 익명으로 처리되며, 신고한 사람은 누구에게도 공개되지 않습니다.</p>' +
      (done
        ? '<p class="login-prompt">이미 신고한 ' + kind + '입니다. 운영진이 확인할 예정입니다.</p>' +
          '<div class="modal-acts"><button type="button" class="btn ghost" data-close>닫기</button></div>'
        : '<fieldset class="reasons"><legend>신고 사유</legend>' +
            API.REPORT_REASONS.map((r, i) =>
              '<label class="reason"><input type="radio" name="reason" value="' + r[0] + '"' + (i ? '' : ' required') + '>' + esc(r[1]) + '</label>').join('') +
          '</fieldset>' +
          '<label>자세한 내용 (선택)<textarea name="detail" rows="3" maxlength="300" placeholder="필요하면 적어 주세요"></textarea></label>' +
          '<p class="form-error" hidden></p>' +
          '<div class="modal-acts"><button type="button" class="btn ghost" data-close>취소</button>' +
          '<button class="btn" type="submit">신고하기</button></div>') +
    '</form>';
    modal.hidden = false;
    const form = document.getElementById('reportForm');
    const first = form.querySelector('input, button');
    if (first) first.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = (form.querySelector('input[name=reason]:checked') || {}).value;
      const msg = form.querySelector('.form-error');
      if (!reason) { msg.textContent = '신고 사유를 골라 주세요.'; msg.hidden = false; return; }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      const id = Number(target.split(':')[1]);
      try {
        await API.createReport(Object.assign({ reason: reason, detail: form.detail.value.trim() },
          target.indexOf('post:') === 0 ? { post_id: id } : { comment_id: id }));
        try { localStorage.setItem('bn_reported', JSON.stringify(reported().concat([target]).slice(-300))); } catch (e2) { /* 무시 */ }
        form.innerHTML = '<h3>신고했습니다</h3><p class="login-prompt">운영진이 확인한 뒤 조치합니다. 감사합니다.</p>' +
          '<div class="modal-acts"><button type="button" class="btn" data-close>닫기</button></div>';
      } catch (err) {
        console.error(err);
        msg.textContent = '신고하지 못했습니다. 잠시 후 다시 시도해 주세요.';
        msg.hidden = false;
        btn.disabled = false;
      }
    });
  }

  // ── 매거진 구매 ─────────────────────────────
  async function viewStore() {
    const url = safeUrl(cfg.STORE_URL);
    return '<div class="page store">' +
      '<h1>매거진 구매</h1>' +
      '<p class="lead">종이 매거진은 네이버 스마트스토어에서 구매하실 수 있습니다.</p>' +
      (url
        ? '<a class="btn big" href="' + esc(url) + '" target="_blank" rel="noopener">스마트스토어에서 구매하기</a>'
        : '<p class="notice">스마트스토어 주소가 아직 설정되지 않았습니다.</p>') +
    '</div>';
  }

  // ── 전체 검색 결과 ──────────────────────────
  async function viewSearch(word) {
    word = word.trim();
    if (!word) return '<div class="page"><h1>검색</h1><p class="notice">왼쪽 위 돋보기를 눌러 검색어를 입력하세요.</p></div>';
    const res = await API.search(word);
    const articles = res.articles.map((a) =>
      '<a class="row" href="#/article/' + a.id + '">' +
        '<span class="row-title">' + esc(a.title) + '</span>' +
        '<span class="row-nick">' + esc(a.category) + '</span>' +
        '<span class="row-date">' + fmtDate(a.created_at) + '</span></a>').join('');
    const posts = res.posts.map((p) =>
      '<a class="row" href="#/board/' + p.id + '">' +
        '<span class="row-title">' + esc(p.title) + '</span>' +
        '<span class="row-nick">' + esc(p.nickname) + '</span>' +
        '<span class="row-date">' + fmtDate(p.created_at) + '</span></a>').join('');
    return '<div class="page">' +
      '<h1>‘' + esc(word) + '’ 검색 결과</h1>' +
      '<h3 class="sub">기사 ' + res.articles.length + '</h3>' +
      '<div class="rows">' + (articles || '<p class="notice">찾은 기사가 없습니다.</p>') + '</div>' +
      '<h3 class="sub">게시글 ' + res.posts.length + '</h3>' +
      '<div class="rows">' + (posts || '<p class="notice">찾은 게시글이 없습니다.</p>') + '</div>' +
    '</div>';
  }

  // ── 로그인 · 내 계정 ────────────────────────
  async function viewLogin(match, query) {
    if (user) {
      return '<div class="page narrow">' +
        '<h1>내 계정</h1>' +
        (user.banned ? '<p class="sample-badge">이용이 정지된 계정입니다. 글과 댓글을 쓸 수 없습니다.</p>' : '') +
        (user.nickname ? '' : '<p class="sample-badge">게시판에서 쓸 닉네임을 정해 주세요. 정하기 전에는 글과 댓글을 쓸 수 없습니다.</p>') +
        '<form class="form" id="nickForm">' +
          '<label>닉네임<input name="nickname" maxlength="20" required value="' + esc(user.nickname) + '"></label>' +
          '<p class="form-error" hidden></p>' +
          '<button class="btn" type="submit">닉네임 저장</button>' +
        '</form>' +
        (user.email ? '<p class="meta account-mail">' + esc(user.email) + '</p>' : '') +
        (user.isStaff ? '<p><a class="text-link" href="admin.html">관리자 페이지로 이동</a></p>' : '') +
        '<button class="btn ghost" type="button" id="logoutBtn">로그아웃</button>' +
      '</div>';
    }
    const staff = query && query.next === 'admin';
    return '<div class="page narrow">' +
      '<h1>로그인</h1>' +
      (API.live ? '' : '<p class="sample-badge">DB가 연결되지 않아 로그인할 수 없습니다.</p>') +
      (loginError ? '<p class="form-error">' + esc(loginError) + '</p>' : '') +
      '<button type="button" class="naver-btn" id="naverBtn"><span class="naver-n" aria-hidden="true">N</span><span class="naver-label">네이버로 로그인</span></button>' +
      '<p class="meta login-note">네이버 아이디로 바로 가입하고 로그인합니다. 처음 로그인하면 게시판에서 쓸 닉네임을 정합니다.</p>' +
      '<details class="staff-login"' + (staff ? ' open' : '') + '>' +
        '<summary>운영진 이메일 로그인</summary>' +
        '<form class="form" id="loginForm">' +
          '<label>이메일<input type="email" name="email" autocomplete="email" required></label>' +
          '<label>비밀번호<input type="password" name="password" autocomplete="current-password" required></label>' +
          '<p class="form-error" hidden></p>' +
          '<button class="btn" type="submit">로그인</button>' +
        '</form>' +
      '</details>' +
    '</div>';
  }
  function bindLoginForm() {
    const toAdmin = parseHash().query.next === 'admin';
    const out = document.getElementById('logoutBtn');
    if (out) {
      out.addEventListener('click', async function () {
        await API.signOut();
        await refreshUser();
        render();
      });
    }
    const naver = document.getElementById('naverBtn');
    if (naver) {
      naver.addEventListener('click', async function () {
        naver.disabled = true;
        // 네이버에 다녀온 뒤 보던 화면으로 돌아오도록 기억
        try { sessionStorage.setItem('bn_return', toAdmin ? 'admin.html' : (returnTo || '#/')); } catch (e) { /* 무시 */ }
        try { await API.signInNaver(); }
        catch (err) {
          console.error(err);
          naver.disabled = false;
          naver.querySelector('.naver-label').textContent = '네이버 로그인을 시작하지 못했습니다. 다시 눌러 주세요';
        }
      });
    }
    const nick = document.getElementById('nickForm');
    if (nick) {
      nick.addEventListener('submit', async function (e) {
        e.preventDefault();
        const value = nick.nickname.value.trim();
        if (!value) return;
        const button = nick.querySelector('button');
        const msg = nick.querySelector('.form-error');
        button.disabled = true;
        try {
          await API.setNickname(value);
          await refreshUser();
          const next = returnTo;
          returnTo = '';
          if (next && next !== '#/login') location.hash = next; else render();
        } catch (err) {
          console.error(err);
          msg.textContent = '닉네임을 저장하지 못했습니다. 다시 시도해 주세요.';
          msg.hidden = false;
          button.disabled = false;
        }
      });
    }
    const form = document.getElementById('loginForm');
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const button = form.querySelector('button[type=submit]');
      const msg = form.querySelector('.form-error');
      button.disabled = true;
      msg.hidden = true;
      try {
        await API.signIn(form.email.value.trim(), form.password.value);
        await refreshUser();
        if (toAdmin) { location.href = 'admin.html'; return; }
        const next = returnTo || '#/';
        returnTo = '';
        location.hash = next;
      } catch (err) {
        console.error(err);
        msg.textContent = err && err.message === 'NO_DB'
          ? 'DB가 연결되지 않아 로그인할 수 없습니다.'
          : '이메일 또는 비밀번호가 맞지 않습니다.';
        msg.hidden = false;
        button.disabled = false;
      }
    });
  }
  // "로그인" 링크를 누르면, 로그인 후 지금 보던 화면으로 돌아오게 기억합니다
  function bindReturnLinks(root) {
    root.querySelectorAll('[data-return]').forEach((a) => {
      a.addEventListener('click', function () { returnTo = location.hash || '#/'; });
    });
  }

  // 로그인 상태를 확인하고 상단·메뉴의 글자를 바꿉니다
  async function refreshUser() {
    try { user = await API.getUser(); } catch (e) { user = null; }
    const top = document.getElementById('authLink');
    const side = document.getElementById('drawerAuth');
    if (top) top.textContent = user ? (user.nickname || '내 계정') : '로그인';
    if (side) side.textContent = user ? '내 계정' : '로그인';
    const admin = document.getElementById('adminLink');
    if (admin) admin.hidden = !(user && user.isStaff);
  }

  // 예전 관리자 주소(#/admin)로 오면 새 관리자 페이지로 보냅니다
  async function goAdmin() {
    location.href = 'admin.html';
    return '<div class="page"><p class="notice">관리자 페이지로 이동합니다.</p></div>';
  }

  // ── 왼쪽 메뉴 · 검색 ────────────────────────
  const drawer = document.getElementById('drawer');
  const scrim = document.getElementById('scrim');
  const menuOpen = document.getElementById('menuOpen');
  function openDrawer(focusSearch) {
    drawer.inert = false;
    drawer.classList.add('open');
    scrim.hidden = false;
    menuOpen.setAttribute('aria-expanded', 'true');
    const target = focusSearch ? drawer.querySelector('input[name=q]') : document.getElementById('menuClose');
    if (target) target.focus();
  }
  function closeDrawer() {
    if (!drawer.classList.contains('open')) return;
    drawer.classList.remove('open');
    drawer.inert = true;
    scrim.hidden = true;
    menuOpen.setAttribute('aria-expanded', 'false');
  }
  function setupChrome() {
    menuOpen.addEventListener('click', () => openDrawer(false));
    document.getElementById('searchOpen').addEventListener('click', () => openDrawer(true));
    document.getElementById('menuClose').addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
    drawer.addEventListener('click', (e) => { if (e.target.closest('a[href^="#"]')) closeDrawer(); });

    document.getElementById('searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const word = e.currentTarget.q.value.trim();
      if (!word) return;
      closeDrawer();
      location.hash = '#/search/' + encodeURIComponent(word);
    });

    document.getElementById('drawerCats').innerHTML = CATEGORIES.map((c) =>
      '<a href="#/c/' + encodeURIComponent(c) + '">' + esc(c) + '</a>').join('');

    const insta = document.getElementById('instaLink');
    const instaUrl = safeUrl(cfg.INSTAGRAM_URL);
    if (instaUrl) insta.href = instaUrl;
    else insta.hidden = true;
  }

  // ── 주소 → 화면 연결 ────────────────────────
  const routes = [
    { re: /^\/?$/, nav: 'news', view: viewHome },
    { re: /^\/c\/(.+)$/, nav: 'news', view: (m) => viewCategory(decodeURIComponent(m[1])) },
    { re: /^\/article\/(\d+)$/, nav: 'news', view: (m) => viewArticle(Number(m[1])) },
    { re: /^\/board$/, nav: 'board', view: viewBoard },
    { re: /^\/board\/(\d+)$/, nav: 'board', view: (m) => viewPost(Number(m[1])) },
    { re: /^\/write$/, nav: 'board', view: viewWrite },
    { re: /^\/store$/, nav: 'store', view: viewStore },
    { re: /^\/search\/(.*)$/, nav: '', view: (m) => viewSearch(decodeURIComponent(m[1])) },
    { re: /^\/login$/, nav: 'login', view: viewLogin },
    { re: /^\/admin(\/\d+)?$/, nav: '', view: goAdmin },
  ];

  let turn = 0; // 화면을 빠르게 바꿀 때 늦게 도착한 결과를 버리기 위한 번호
  async function render() {
    const mine = ++turn;
    const here = parseHash();
    let match = null;
    let route = null;
    for (const r of routes) {
      match = here.path.match(r.re);
      if (match) { route = r; break; }
    }
    if (!route) { location.hash = '#/'; return; }

    document.querySelectorAll('[data-nav]').forEach((a) => {
      a.classList.toggle('on', a.dataset.nav === route.nav);
    });

    app.classList.add('is-loading');
    let html;
    try { html = await route.view(match, here.query); }
    catch (err) { html = errorBox(err); }
    if (mine !== turn) return;

    app.innerHTML = html;
    app.classList.remove('is-loading');
    window.scrollTo(0, 0);
    bindBoard();
    bindLoginForm();
    bindArticle();
    bindSlider();
    loadInstaEmbeds();
    bindReturnLinks(app);
    app.querySelectorAll('.comments').forEach(mountComments);
  }

  const logo = document.getElementById('logo');
  const logoText = document.getElementById('logoText');
  if (logoText && cfg.SITE_NAME) {
    logoText.textContent = cfg.SITE_NAME;
    document.title = cfg.SITE_NAME;
  }
  setupChrome();
  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-report]');
    if (b) openReport(b.dataset.report);
  });
  window.addEventListener('hashchange', function () { closeDrawer(); render(); });

  // 네이버 로그인에서 돌아온 직후 처리
  (function () {
    const m = location.search.match(/[?&]error_description=([^&]*)/);
    if (m) {
      let detail = '';
      try { detail = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { /* 무시 */ }
      loginError = '네이버 로그인을 마치지 못했습니다. ' + detail;
      try { history.replaceState(null, '', location.pathname + '#/login'); } catch (e) { /* 무시 */ }
    }
  })();
  refreshUser().then(function () {
    let back = '';
    try { back = sessionStorage.getItem('bn_return') || ''; sessionStorage.removeItem('bn_return'); } catch (e) { /* 무시 */ }
    if (user && back === 'admin.html') { location.href = 'admin.html'; return; }
    if (user && back) {
      // 닉네임이 없으면 먼저 닉네임을 정하게 합니다
      if (!user.nickname) { returnTo = back; back = '#/login'; }
      if (location.hash !== back) { location.hash = back; return; }
    }
    render();
  });
})();
