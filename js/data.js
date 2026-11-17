// ─────────────────────────────────────────────
// 데이터 담당 파일
// - Supabase 설정이 있으면: 실제 DB에서 읽고 씁니다.
// - 설정이 없으면: 샘플 기사만 보여 주는 "샘플 모드"입니다.
// 화면(app.js)은 여기의 window.API 함수만 사용합니다.
// ─────────────────────────────────────────────
(function () {
  const cfg = window.SITE_CONFIG || {};
  const live = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const db = live ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const PAGE_SIZE = 20;      // 게시판 한 쪽에 보이는 글 수
  const NOTICE = '공지';     // 공지 말머리 (관리자만 쓸 수 있음)

  // Supabase 가 돌려준 줄에서 댓글 수를 꺼내 정리
  function norm(row) {
    const c = row.comments;
    const count = Array.isArray(c) && c[0] ? c[0].count : 0;
    const out = Object.assign({}, row, { comment_count: count });
    delete out.comments;
    return out;
  }
  function check(res) {
    if (res.error) throw res.error;
    return res.data;
  }
  // 검색어를 DB 검색 형식으로 (특수문자 제거)
  function like(word) {
    return '"%' + String(word).replace(/[,()%*\\"]/g, ' ').trim() + '%"';
  }
  const POST_COLS = 'id,title,category,nickname,views,created_at,comments(count)';

  // ── 실제 DB (Supabase) ──────────────────────
  const remote = {
    // 기사
    async listArticles(category, limit) {
      let q = db.from('articles')
        .select('id,title,summary,category,image_url,created_at,comments(count)')
        .order('created_at', { ascending: false })
        .limit(limit || 60);
      if (category) q = q.eq('category', category);
      return check(await q).map(norm);
    },
    async getArticle(id) {
      return check(await db.from('articles').select('*').eq('id', id).maybeSingle());
    },

    // 게시판: opt = { category, page, q, size }
    async listPosts(opt) {
      opt = opt || {};
      const size = opt.size || PAGE_SIZE;
      const page = Math.max(1, opt.page || 1);
      let q = db.from('posts').select(POST_COLS, { count: 'exact' })
        .neq('category', NOTICE)
        .order('created_at', { ascending: false })
        .range((page - 1) * size, page * size - 1);
      if (opt.category) q = q.eq('category', opt.category);
      if (opt.q) q = q.or('title.ilike.' + like(opt.q) + ',body.ilike.' + like(opt.q));
      const res = await q;
      // 없는 쪽 번호를 요청하면 빈 목록으로 처리
      const rows = res.error ? [] : res.data.map(norm);
      const total = res.error ? 0 : (res.count || 0);
      let notices = [];
      if (!opt.noNotices) {
        const n = await db.from('posts').select(POST_COLS).eq('category', NOTICE)
          .order('created_at', { ascending: false }).limit(5);
        notices = n.error ? [] : n.data.map(norm);
      }
      return { rows: rows, total: total, size: size, page: page, notices: notices };
    },
    async getPost(id) {
      // 조회수 +1 (실패해도 글은 보여 줍니다)
      try { await db.rpc('increment_views', { pid: id }); } catch (e) { /* 무시 */ }
      return check(await db.from('posts').select('*').eq('id', id).maybeSingle());
    },
    // 글쓴이(닉네임·계정)는 DB가 로그인 정보로 직접 채웁니다
    async createPost(post) {
      const row = { title: post.title, body: post.body, category: post.category };
      return check(await db.from('posts').insert(row).select().single());
    },
    async deletePost(id) {
      const rows = check(await db.from('posts').delete().eq('id', id).select('id'));
      if (!rows.length) throw new Error('삭제 권한이 없습니다.');
    },

    // 댓글
    async listComments(target) {
      const key = target.post_id ? 'post_id' : 'article_id';
      const q = db.from('comments').select('*').eq(key, target[key])
        .order('created_at', { ascending: true });
      return check(await q);
    },
    async createComment(comment) {
      const row = { body: comment.body };
      if (comment.post_id) row.post_id = comment.post_id;
      else row.article_id = comment.article_id;
      return check(await db.from('comments').insert(row).select().single());
    },
    async deleteComment(id) {
      const rows = check(await db.from('comments').delete().eq('id', id).select('id'));
      if (!rows.length) throw new Error('삭제 권한이 없습니다.');
    },

    // 검색: 제목·요약·본문에 검색어가 들어간 기사와 게시글
    async search(word) {
      const w = like(word);
      const a = db.from('articles').select('id,title,category,created_at')
        .or('title.ilike.' + w + ',summary.ilike.' + w + ',body.ilike.' + w)
        .order('created_at', { ascending: false }).limit(30);
      const p = db.from('posts').select('id,title,nickname,created_at')
        .or('title.ilike.' + w + ',body.ilike.' + w)
        .order('created_at', { ascending: false }).limit(30);
      const res = await Promise.all([a, p]);
      return { articles: check(res[0]), posts: check(res[1]) };
    },

    // 로그인
    async getUser() {
      const res = await db.auth.getSession();
      const u = res.data && res.data.session ? res.data.session.user : null;
      if (!u) return null;
      const nick = u.user_metadata && u.user_metadata.nickname;
      // admins 표에 내 줄이 있으면 관리자
      let isAdmin = false;
      try {
        const r = await db.from('admins').select('user_id').eq('user_id', u.id).maybeSingle();
        isAdmin = !!r.data;
      } catch (e) { /* 표가 없으면 관리자가 아님 */ }
      return { id: u.id, email: u.email, nickname: nick || String(u.email).split('@')[0], isAdmin: isAdmin };
    },
    async signIn(email, password) {
      const res = await db.auth.signInWithPassword({ email: email, password: password });
      if (res.error) throw res.error;
    },
    async signUp(email, password, nickname) {
      const res = await db.auth.signUp({
        email: email, password: password, options: { data: { nickname: nickname } },
      });
      if (res.error) throw res.error;
      // 메일 인증이 켜져 있으면 가입 직후에는 아직 로그인 상태가 아닙니다
      return { needsConfirm: !res.data.session };
    },
    async signOut() {
      await db.auth.signOut();
    },

    // ── 관리자 전용 (DB 규칙이 관리자가 아니면 거부합니다) ──
    async listAllArticles() {
      const q = db.from('articles').select('id,title,category,created_at')
        .order('created_at', { ascending: false }).limit(200);
      return check(await q);
    },
    async saveArticle(a) {
      const row = {
        title: a.title, summary: a.summary || null, body: a.body,
        category: a.category, image_url: a.image_url || null,
      };
      if (a.id) return check(await db.from('articles').update(row).eq('id', a.id).select().single());
      return check(await db.from('articles').insert(row).select().single());
    },
    async deleteArticle(id) {
      const rows = check(await db.from('articles').delete().eq('id', id).select('id'));
      if (!rows.length) throw new Error('삭제되지 않았습니다. 관리자 권한을 확인해 주세요.');
    },
    async uploadImage(file) {
      const ext = (String(file.name).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const res = await db.storage.from('images').upload(path, file, { cacheControl: '31536000', contentType: file.type });
      if (res.error) throw res.error;
      return db.storage.from('images').getPublicUrl(path).data.publicUrl;
    },
  };

  // ── 샘플 모드 (DB 설정이 없을 때만) ─────────
  const now = Date.now();
  const ago = (h) => new Date(now - h * 3600 * 1000).toISOString();
  const SAMPLE_BODY =
    '이 글은 화면 확인용 샘플입니다.\n\n' +
    'Supabase 를 연결하고 관리자로 로그인하면 기사 관리에서 실제 기사를 올릴 수 있습니다.';
  const SAMPLE_ARTICLES = [
    { id: 1, category: '이적', title: '샘플 기사: 이적 소식 제목이 여기에 들어갑니다', summary: '가장 최근 기사가 첫 화면에서 가장 크게 보입니다.', hours: 2 },
    { id: 2, category: '인터뷰', title: '샘플 기사: 선수 인터뷰 제목 자리', summary: '그다음 두 기사는 옆에 작게 놓입니다.', hours: 9 },
    { id: 3, category: '스카우팅', title: '샘플 기사: 스카우팅 리포트 제목 자리', summary: '사진에 마우스를 올려 보세요.', hours: 26 },
    { id: 4, category: '드래프트', title: '샘플 기사: 드래프트 예상 제목 자리', summary: '위쪽 카테고리를 누르면 해당 기사만 모아 볼 수 있습니다.', hours: 50 },
    { id: 5, category: '칼럼', title: '샘플 기사: 칼럼 제목 자리', summary: '기사를 누르면 본문과 댓글로 이어집니다.', hours: 75 },
    { id: 6, category: '이적', title: '샘플 기사: 두 번째 이적 소식 제목 자리', summary: '나머지 기사는 아래에 나란히 놓입니다.', hours: 100 },
  ].map((a) => ({
    id: a.id, category: a.category, title: a.title, summary: a.summary,
    body: SAMPLE_BODY, image_url: '', created_at: ago(a.hours), comment_count: 0,
  }));
  const noDb = async function () { throw new Error('NO_DB'); };

  const local = {
    async listArticles(category, limit) {
      return SAMPLE_ARTICLES.filter((a) => !category || a.category === category).slice(0, limit || 60);
    },
    async getArticle(id) { return SAMPLE_ARTICLES.find((a) => a.id === id) || null; },
    async listPosts(opt) {
      return { rows: [], total: 0, size: (opt && opt.size) || PAGE_SIZE, page: 1, notices: [] };
    },
    async getPost() { return null; },
    async listComments() { return []; },
    async search(word) {
      const w = word.toLowerCase();
      const has = (t) => String(t || '').toLowerCase().indexOf(w) !== -1;
      return { articles: SAMPLE_ARTICLES.filter((a) => has(a.title) || has(a.summary)), posts: [] };
    },
    async getUser() { return null; },
    async signOut() {},
    async listAllArticles() { return SAMPLE_ARTICLES; },
    createPost: noDb, deletePost: noDb, createComment: noDb, deleteComment: noDb,
    signIn: noDb, signUp: noDb, saveArticle: noDb, deleteArticle: noDb, uploadImage: noDb,
  };

  window.API = Object.assign({ live: live, NOTICE: NOTICE }, live ? remote : local);
})();
