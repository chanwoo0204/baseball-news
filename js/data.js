// ─────────────────────────────────────────────
// 데이터 담당 파일
// - Supabase 설정이 있으면: 실제 DB에서 읽고 씁니다.
// - 설정이 없으면: 샘플 기사만 보여 주는 "샘플 모드"입니다.
// 화면(app.js)은 여기의 window.API 함수만 사용합니다.
// ─────────────────────────────────────────────
(function () {
  const cfg = window.SITE_CONFIG || {};
  const live = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  // flowType 'pkce': 네이버 로그인 후 돌아올 때 주소의 # 부분(화면 주소)을 건드리지 않게 합니다
  const db = live
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { flowType: 'pkce' } })
    : null;
  const PAGE_SIZE = 20;      // 게시판 한 쪽에 보이는 글 수
  const NOTICE = '공지';     // 공지 말머리 (운영진만 쓸 수 있음)
  // 신고 사유 (DB 규칙과 같은 목록이어야 합니다)
  const REPORT_REASONS = [
    ['spam', '스팸·광고·홍보'],
    ['abuse', '욕설·비하·혐오 표현'],
    ['sexual', '음란·선정적인 내용'],
    ['privacy', '개인정보 노출'],
    ['flood', '도배·같은 내용 반복'],
    ['false', '허위 사실·사칭'],
    ['other', '기타'],
  ];
  const ART_COLS = 'id,title,summary,category,image_url,author_name,main_slot,created_at,comments(count)';

  // 메인 배치: 1=큰 기사, 2·3=옆 기사. 빈 자리는 최신 기사로 채웁니다
  function arrangeHome(slotted, latest) {
    const slots = [null, null, null];
    slotted.forEach((a) => { if (a.main_slot >= 1 && a.main_slot <= 3) slots[a.main_slot - 1] = a; });
    const used = slots.filter(Boolean).map((a) => a.id);
    const rest = latest.filter((a) => used.indexOf(a.id) === -1);
    for (let i = 0; i < 3; i++) if (!slots[i] && rest.length) slots[i] = rest.shift();
    return slots.filter(Boolean).concat(rest);
  }

  // Supabase 가 돌려준 줄에서 댓글 수를 꺼내 정리
  // 인스타그램 게시물 주소를 정리합니다 (아니면 빈 값)
  function instaUrl(u) {
    const m = String(u || '').trim().match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reel)\/([A-Za-z0-9_-]+)/);
    return m ? 'https://www.instagram.com/' + m[1] + '/' + m[2] + '/' : '';
  }

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
        .select(ART_COLS)
        .order('created_at', { ascending: false })
        .limit(limit || 60);
      if (category) q = q.eq('category', category);
      return check(await q).map(norm);
    },
    async homeArticles() {
      const res = await Promise.all([
        db.from('articles').select(ART_COLS).not('main_slot', 'is', null),
        db.from('articles').select(ART_COLS).order('created_at', { ascending: false }).limit(15),
      ]);
      return arrangeHome(check(res[0]).map(norm), check(res[1]).map(norm));
    },
    async getArticle(id) {
      return check(await db.from('articles').select('*').eq('id', id).maybeSingle());
    },
    // 공지사항 · 일정
    async listNotices(limit) {
      const res = await db.from('notices').select('id,title,pinned,created_at')
        .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(limit || 50);
      return res.error ? [] : res.data;
    },
    async getNotice(id) {
      return check(await db.from('notices').select('*').eq('id', id).maybeSingle());
    },
    async listEvents(from, to) {
      const res = await db.from('events').select('id,day,title,kind,note')
        .gte('day', from).lte('day', to).order('day', { ascending: true }).limit(300);
      return res.error ? [] : res.data;
    },
    async listInstaPosts(limit) {
      const res = await db.from('insta_posts').select('id,url,created_at')
        .order('created_at', { ascending: false }).limit(limit || 6);
      return res.error ? [] : res.data;
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

    // 신고: 누가 신고했는지는 저장하지 않습니다
    async createReport(r) {
      const row = { reason: r.reason, detail: (r.detail || '').slice(0, 300) || null };
      if (r.post_id) row.post_id = r.post_id; else row.comment_id = r.comment_id;
      check(await db.from('reports').insert(row));
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
      // 닉네임·역할·정지 여부는 profiles 표에 있습니다
      const r = await db.from('profiles').select('nickname,role,banned').eq('id', u.id).maybeSingle();
      const p = r.data || { nickname: '', role: 'member', banned: false };
      return {
        id: u.id, email: u.email || '', nickname: (p.nickname || '').trim(),
        role: p.role, banned: !!p.banned,
        isAdmin: p.role === 'admin', isStaff: p.role === 'admin' || p.role === 'reporter',
      };
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
    // 네이버 로그인: 네이버 화면으로 갔다가 이 사이트로 돌아옵니다
    async signInNaver() {
      const res = await db.auth.signInWithOAuth({
        provider: 'custom:naver',
        options: { redirectTo: location.origin + location.pathname },
      });
      if (res.error) throw res.error;
    },
    // 게시판에 표시될 닉네임 저장
    async setNickname(nickname) {
      const u = (await db.auth.getUser()).data.user;
      if (!u) throw new Error('로그인이 필요합니다.');
      const rows = check(await db.from('profiles').update({ nickname: nickname }).eq('id', u.id).select('id'));
      if (!rows.length) throw new Error('닉네임을 저장하지 못했습니다.');
    },

    // ── 운영진 전용 (기자·관리자가 아니면 DB 규칙이 거부합니다) ──
    async listAllArticles(q) {
      let query = db.from('articles').select(ART_COLS)
        .order('created_at', { ascending: false }).limit(200);
      if (q) query = query.ilike('title', '%' + q.replace(/[%_,()]/g, ' ').trim() + '%');
      return check(await query).map(norm);
    },
    async saveArticle(a) {
      const row = {
        title: a.title, summary: a.summary || null, body: a.body, format: 'html',
        category: a.category, image_url: a.image_url || null,
        image_caption: a.image_caption || null, author_name: a.author_name || null,
      };
      const saved = a.id
        ? check(await db.from('articles').update(row).eq('id', a.id).select().single())
        : check(await db.from('articles').insert(row).select().single());
      if ('slot' in a) await remote.setMainSlot(saved.id, a.slot);
      return saved;
    },
    async setMainSlot(id, slot) {
      check(await db.rpc('set_main_slot', { aid: id, slot: slot || null }));
    },
    async deleteArticle(id) {
      const rows = check(await db.from('articles').delete().eq('id', id).select('id'));
      if (!rows.length) throw new Error('삭제되지 않았습니다. 권한을 확인해 주세요.');
    },
    async uploadImage(file) {
      const ext = (String(file.name).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const res = await db.storage.from('images').upload(path, file, { cacheControl: '31536000', contentType: file.type });
      if (res.error) throw res.error;
      return db.storage.from('images').getPublicUrl(path).data.publicUrl;
    },
    async listMembers(q) {
      let query = db.from('profiles').select('id,nickname,role,banned,created_at')
        .order('created_at', { ascending: false }).limit(300);
      if (q) query = query.ilike('nickname', '%' + q.replace(/[%_,()]/g, ' ').trim() + '%');
      return check(await query);
    },
    async setMember(id, role, banned) {
      check(await db.rpc('staff_set_member', { uid: id, new_role: role, new_banned: banned }));
    },
    async listAllPosts(q) {
      let query = db.from('posts').select(POST_COLS)
        .order('created_at', { ascending: false }).limit(200);
      if (q) query = query.ilike('title', '%' + q.replace(/[%_,()]/g, ' ').trim() + '%');
      return check(await query).map(norm);
    },
    async listReports(status) {
      const q = db.from('reports')
        .select('id,reason,detail,status,created_at,post_id,comment_id,posts(id,title,nickname),comments(id,body,nickname,post_id,article_id)')
        .eq('status', status || 'open')
        .order('created_at', { ascending: false }).limit(300);
      return check(await q);
    },
    async countOpenReports() {
      const res = await db.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open');
      return res.error ? 0 : (res.count || 0);
    },
    async resolveReports(ids) {
      check(await db.from('reports').update({ status: 'done' }).in('id', ids));
    },
    async saveNotice(n) {
      const row = { title: n.title, body: n.body || '', pinned: !!n.pinned };
      if (n.id) check(await db.from('notices').update(row).eq('id', n.id));
      else check(await db.from('notices').insert(row));
    },
    async deleteNotice(id) {
      check(await db.from('notices').delete().eq('id', id));
    },
    async addEvent(e) {
      check(await db.from('events').insert({ day: e.day, title: e.title, kind: e.kind, note: e.note || null }));
    },
    async deleteEvent(id) {
      check(await db.from('events').delete().eq('id', id));
    },
    async addInstaPost(url) {
      const clean = instaUrl(url);
      if (!clean) throw new Error('인스타그램 게시물 주소가 아닙니다.');
      const res = await db.from('insta_posts').insert({ url: clean });
      if (res.error && res.error.code === '23505') throw new Error('이미 등록된 게시물입니다.');
      check(res);
    },
    async deleteInstaPost(id) {
      check(await db.from('insta_posts').delete().eq('id', id));
    },
    async listRecentComments(limit) {
      const q = db.from('comments')
        .select('id,body,nickname,user_id,created_at,post_id,article_id,posts(title),articles(title)')
        .order('created_at', { ascending: false }).limit(limit || 100);
      return check(await q);
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
    async homeArticles() { return SAMPLE_ARTICLES.slice(0, 15); },
    async listMembers() { return []; },
    async listRecentComments() { return []; },
    async listAllPosts() { return []; },
    async listInstaPosts() { return []; },
    async listNotices() { return []; },
    async getNotice() { return null; },
    async listEvents() { return []; },
    async listReports() { return []; },
    async countOpenReports() { return 0; },
    createPost: noDb, deletePost: noDb, createComment: noDb, deleteComment: noDb,
    signIn: noDb, signUp: noDb, signInNaver: noDb, setNickname: noDb, setMainSlot: noDb, setMember: noDb, createReport: noDb, resolveReports: noDb, addInstaPost: noDb, deleteInstaPost: noDb, saveNotice: noDb, deleteNotice: noDb, addEvent: noDb, deleteEvent: noDb, saveArticle: noDb, deleteArticle: noDb, uploadImage: noDb,
  };

  window.API = Object.assign({ live: live, NOTICE: NOTICE, REPORT_REASONS: REPORT_REASONS, instaUrl: instaUrl }, live ? remote : local);
})();
