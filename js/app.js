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
//   #/admin         기사 관리 (관리자만) — #/admin/3 은 3번 기사 수정
// ─────────────────────────────────────────────
(function () {
  const cfg = window.SITE_CONFIG || {};
  const API = window.API;
  const app = document.getElementById('app');
  const CATEGORIES = cfg.CATEGORIES || [];
  const BOARD_CATEGORIES = cfg.BOARD_CATEGORIES || ['잡담'];
  const NOTICE = API.NOTICE;
  let user = null;      // 로그인한 사람 ({ id, email, nickname, isAdmin }) 또는 null
  let returnTo = '';    // 로그인 후 돌아갈 주소

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
    return !!user && (user.isAdmin || (row.user_id && row.user_id === user.id));
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
        '<span class="meta"><span>' + fmtDate(a.created_at) + '</span>' +
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
  async function viewHome() {
    const res = await Promise.all([
      API.listArticles(null, 15),
      API.listPosts({ size: 6, noNotices: true }).catch(() => ({ rows: [] })),
    ]);
    const list = res[0];
    const posts = res[1].rows;
    if (!list.length) {
      return chips('') + '<div class="wide"><p class="notice">아직 올라온 기사가 없습니다.</p></div>';
    }
    const lead = list[0];
    const side = list.slice(1, 3);
    const rest = list.slice(3);
    const postRows = posts.map((p) =>
      '<a class="mini" href="#/board/' + p.id + '">' +
        '<span class="mini-title"><span>' + esc(p.title) + '</span>' +
          (p.comment_count ? '<em>[' + p.comment_count + ']</em>' : '') + '</span>' +
        '<span class="mini-date">' + fmtDate(p.created_at) + '</span></a>').join('');
    return chips('') +
      '<div class="wide">' +
        '<section class="top-stories' + (side.length ? '' : ' solo') + '">' +
          story(lead, 'lead') +
          (side.length ? '<div class="side">' + side.map((a) => story(a, 'side')).join('') + '</div>' : '') +
        '</section>' +
        (rest.length
          ? '<section><h2 class="sec">최신 기사</h2><div class="grid">' +
              rest.map((a) => story(a, 'grid')).join('') + '</div></section>'
          : '') +
        '<section class="home-bottom">' +
          '<div>' +
            '<h2 class="sec"><a href="#/board">게시판</a></h2>' +
            '<div class="minis">' + (postRows || '<p class="notice">아직 글이 없습니다. 첫 글을 남겨 보세요.</p>') + '</div>' +
          '</div>' +
          '<a class="store-card" href="#/store">' +
            '<span class="store-card-small">종이 매거진</span>' +
            '<strong>이번 호 매거진,<br>종이로 읽기</strong>' +
            '<span class="store-card-go">스마트스토어에서 구매</span>' +
          '</a>' +
        '</section>' +
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
  async function viewArticle(id) {
    const a = await API.getArticle(id);
    if (!a) return '<div class="page"><p class="notice">기사를 찾을 수 없습니다.</p></div>';
    const img = safeUrl(a.image_url);
    return '<article class="page article">' +
      '<a class="back" href="#/c/' + encodeURIComponent(a.category) + '">' + esc(a.category) + ' 기사 목록</a>' +
      '<h1>' + esc(a.title) + '</h1>' +
      '<p class="meta">' + fmtDate(a.created_at) + '</p>' +
      (img ? '<img class="hero" src="' + esc(img) + '" alt="">' : '') +
      (a.summary ? '<p class="lead">' + esc(a.summary) + '</p>' : '') +
      '<div class="body">' + esc(a.body) + '</div>' +
      '<a class="store-banner" href="#/store"><b>이번 호 매거진, 종이로 읽기</b><span>스마트스토어에서 구매</span></a>' +
      '<section class="comments" data-target="article_id" data-id="' + a.id + '"></section>' +
    '</article>';
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
        (canDelete(p) ? '<button type="button" class="link-btn" id="postDelete" data-id="' + p.id + '">삭제</button>' : '') +
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
    const cats = BOARD_CATEGORIES.concat(user.isAdmin ? [NOTICE] : []);
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
            (canDelete(c) ? '<button type="button" class="link-btn" data-cdel="' + c.id + '">삭제</button>' : '') + '</p>' +
          '<p class="comment-body">' + esc(c.body) + '</p></li>').join('') + '</ul>' +
        (user
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

  // ── 로그인 · 회원가입 ───────────────────────
  async function viewLogin() {
    if (user) {
      return '<div class="page narrow">' +
        '<h1>내 계정</h1>' +
        '<p class="lead">' + esc(user.nickname) + ' 님으로 로그인되어 있습니다.</p>' +
        '<p class="meta">' + esc(user.email) + '</p>' +
        (user.isAdmin ? '<p><a class="text-link" href="#/admin">기사 관리로 이동</a></p>' : '') +
        '<button class="btn big" type="button" id="logoutBtn">로그아웃</button>' +
      '</div>';
    }
    return '<div class="page narrow">' +
      '<h1>로그인</h1>' +
      (API.live ? '' : '<p class="sample-badge">DB가 연결되지 않아 로그인할 수 없습니다.</p>') +
      '<div class="tabs" role="tablist">' +
        '<button type="button" class="tab on" data-mode="in">로그인</button>' +
        '<button type="button" class="tab" data-mode="up">회원가입</button>' +
      '</div>' +
      '<form class="form" id="loginForm" data-mode="in">' +
        '<label>이메일<input type="email" name="email" autocomplete="email" required></label>' +
        '<label>비밀번호<input type="password" name="password" autocomplete="current-password" minlength="6" required></label>' +
        '<label class="only-up" hidden>닉네임<input name="nickname" maxlength="20"></label>' +
        '<p class="form-error" hidden></p>' +
        '<button class="btn big" type="submit">로그인</button>' +
      '</form></div>';
  }
  function bindLoginForm() {
    const out = document.getElementById('logoutBtn');
    if (out) {
      out.addEventListener('click', async function () {
        await API.signOut();
        await refreshUser();
        render();
      });
    }
    const form = document.getElementById('loginForm');
    if (!form) return;
    const button = form.querySelector('button[type=submit]');
    const nickLabel = form.querySelector('.only-up');
    const msg = form.querySelector('.form-error');
    app.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', function () {
        const mode = tab.dataset.mode;
        form.dataset.mode = mode;
        app.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t === tab));
        nickLabel.hidden = mode !== 'up';
        form.nickname.required = mode === 'up';
        button.textContent = mode === 'up' ? '회원가입' : '로그인';
        msg.hidden = true;
      });
    });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const mode = form.dataset.mode;
      button.disabled = true;
      msg.hidden = true;
      try {
        if (mode === 'up') {
          const r = await API.signUp(form.email.value.trim(), form.password.value, form.nickname.value.trim());
          if (r.needsConfirm) {
            msg.textContent = '확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요.';
            msg.hidden = false;
            button.disabled = false;
            return;
          }
        } else {
          await API.signIn(form.email.value.trim(), form.password.value);
        }
        await refreshUser();
        const next = returnTo || '#/';
        returnTo = '';
        location.hash = next;
      } catch (err) {
        console.error(err);
        const code = (err && (err.code || '')) + ' ' + (err && (err.message || ''));
        let text;
        if (err && err.message === 'NO_DB') text = 'DB가 연결되지 않아 로그인할 수 없습니다.';
        else if (/rate.?limit/i.test(code) || (err && err.status === 429)) text = '요청이 너무 잦습니다. 잠시 뒤에 다시 시도해 주세요.';
        else if (/not.?confirmed/i.test(code)) text = '아직 이메일 인증이 끝나지 않았습니다. 확인 메일의 링크를 먼저 눌러 주세요.';
        else if (/already.?(registered|exists)/i.test(code)) text = '이미 가입된 이메일입니다. 로그인 탭에서 로그인해 주세요.';
        else if (mode === 'up') text = '가입하지 못했습니다. 이메일 형식과 비밀번호(6자 이상)를 확인해 주세요.';
        else text = '이메일 또는 비밀번호가 맞지 않습니다.';
        msg.textContent = text;
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
    if (top) top.textContent = user ? user.nickname : '로그인';
    if (side) side.textContent = user ? '내 계정' : '로그인';
    const admin = document.getElementById('adminLink');
    if (admin) admin.hidden = !(user && user.isAdmin);
  }

  // ── 기사 관리 (관리자만) ────────────────────
  async function viewAdmin(editId) {
    if (!API.live) {
      return '<div class="page"><h1>기사 관리</h1><p class="sample-badge">DB가 연결되지 않아 기사 관리를 쓸 수 없습니다.</p></div>';
    }
    if (!user) {
      return '<div class="page narrow"><h1>기사 관리</h1>' + loginPrompt('관리자 계정으로 로그인해 주세요.') + '</div>';
    }
    if (!user.isAdmin) {
      return '<div class="page"><h1>기사 관리</h1><p class="notice">이 계정에는 관리자 권한이 없습니다.</p></div>';
    }
    const editing = editId ? await API.getArticle(editId) : null;
    if (editId && !editing) return '<div class="page"><p class="notice">기사를 찾을 수 없습니다.</p></div>';
    const a = editing || { title: '', summary: '', body: '', category: CATEGORIES[0] || '', image_url: '' };
    const cats = CATEGORIES.indexOf(a.category) === -1 && a.category ? CATEGORIES.concat([a.category]) : CATEGORIES;
    const options = cats.map((c) =>
      '<option' + (c === a.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
    const list = await API.listAllArticles();
    const rows = list.map((r) =>
      '<div class="row">' +
        '<a class="row-title" href="#/admin/' + r.id + '">' + esc(r.title) + '</a>' +
        '<span class="row-nick">' + esc(r.category) + '</span>' +
        '<button type="button" class="link-btn" data-del="' + r.id + '">삭제</button>' +
      '</div>').join('');
    const current = safeUrl(a.image_url);
    return '<div class="page">' +
      '<h1>' + (editing ? '기사 수정' : '새 기사 쓰기') + '</h1>' +
      (editing ? '<a class="back" href="#/admin">새 기사 쓰기로 돌아가기</a>' : '') +
      '<form class="form" id="articleForm" data-id="' + (editing ? editing.id : '') + '">' +
        '<label>제목<input name="title" maxlength="100" required value="' + esc(a.title) + '"></label>' +
        '<label>카테고리<select name="category">' + options + '</select></label>' +
        '<label>한 줄 요약<input name="summary" maxlength="200" value="' + esc(a.summary) + '"></label>' +
        '<label>썸네일 사진 올리기<input type="file" name="file" accept="image/*"></label>' +
        '<img class="preview" id="preview" alt="사진 미리보기"' + (current ? ' src="' + esc(current) + '"' : ' hidden') + '>' +
        '<label>또는 사진 주소<input name="image_url" placeholder="https://" value="' + esc(a.image_url) + '"></label>' +
        '<label>본문<textarea name="body" rows="16" required>' + esc(a.body) + '</textarea></label>' +
        '<p class="form-error" hidden></p>' +
        '<button class="btn big" type="submit">' + (editing ? '수정한 내용 저장' : '기사 올리기') + '</button>' +
      '</form>' +
      '<h3 class="sub">올린 기사 ' + list.length + '</h3>' +
      '<div class="rows">' + (rows || '<p class="notice">아직 올린 기사가 없습니다.</p>') + '</div>' +
    '</div>';
  }
  function bindAdmin() {
    const form = document.getElementById('articleForm');
    if (form) {
      // 고른 사진을 올리기 전에 미리 보여 줍니다
      const preview = document.getElementById('preview');
      form.file.addEventListener('change', function () {
        const file = form.file.files[0];
        if (!file) return;
        preview.src = URL.createObjectURL(file);
        preview.hidden = false;
      });
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const button = form.querySelector('button[type=submit]');
        const msg = form.querySelector('.form-error');
        button.disabled = true;
        msg.hidden = true;
        try {
          let image = form.image_url.value.trim();
          const file = form.file.files[0];
          if (file) {
            button.textContent = '사진 올리는 중';
            image = await API.uploadImage(file);
          }
          const saved = await API.saveArticle({
            id: form.dataset.id ? Number(form.dataset.id) : null,
            title: form.title.value.trim(),
            category: form.category.value,
            summary: form.summary.value.trim(),
            image_url: image,
            body: form.body.value.trim(),
          });
          location.hash = '#/article/' + saved.id;
        } catch (err) {
          console.error(err);
          msg.textContent = '저장하지 못했습니다. ' + (err && err.message ? err.message : '');
          msg.hidden = false;
          button.disabled = false;
          button.textContent = form.dataset.id ? '수정한 내용 저장' : '기사 올리기';
        }
      });
    }
    app.querySelectorAll('[data-del]').forEach((btn) => {
      armDelete(btn, async function () {
        await API.deleteArticle(Number(btn.dataset.del));
        render();
      });
    });
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
    { re: /^\/admin$/, nav: '', view: () => viewAdmin(0) },
    { re: /^\/admin\/(\d+)$/, nav: '', view: (m) => viewAdmin(Number(m[1])) },
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
    bindAdmin();
    bindReturnLinks(app);
    app.querySelectorAll('.comments').forEach(mountComments);
  }

  const logo = document.getElementById('logo');
  if (logo && cfg.SITE_NAME) {
    logo.textContent = cfg.SITE_NAME;
    document.title = cfg.SITE_NAME;
  }
  setupChrome();
  window.addEventListener('hashchange', function () { closeDrawer(); render(); });
  refreshUser().then(render);
})();
