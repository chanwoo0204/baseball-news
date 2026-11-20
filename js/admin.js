// ─────────────────────────────────────────────
// 관리자 페이지 (기자·관리자 전용)
//   #/articles   기사 목록 (?q=검색어)
//   #/write      새 기사 쓰기   (#/write/3 은 3번 기사 수정)
//   #/main       메인 배치
//   #/insta      첫 화면에 보여 줄 인스타그램 게시물
//   #/reports    신고 관리 (?status=done 은 처리한 신고)
//   #/board      게시판 관리 (?q=검색어)
//   #/comments   댓글 관리
//   #/members    회원 관리 (?q=닉네임)
// 이 화면은 편의를 위한 것이고, 권한은 DB 규칙이 최종적으로 확인합니다.
// ─────────────────────────────────────────────
(function () {
  const cfg = window.SITE_CONFIG || {};
  const API = window.API;
  const Rich = window.Rich;
  const main = document.getElementById('adm');
  const CATEGORIES = cfg.CATEGORIES || [];
  const SLOT_NAMES = { 1: '큰 기사', 2: '옆 기사 (위)', 3: '옆 기사 (아래)' };
  const ROLE_NAMES = { member: '회원', reporter: '기자', admin: '관리자' };
  // 편집기의 글씨 크기(pt)와 색 — css/rich.css · js/rich.js 와 같은 목록
  const SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28];
  const COLORS = [['c-black', '검정', '#111111'], ['c-gray', '회색', '#777777'], ['c-navy', '남색', '#10264a'], ['c-blue', '파랑', '#1e5bd8'], ['c-red', '빨강', '#d0302f'], ['c-orange', '주황', '#e07a00'], ['c-green', '초록', '#1f8a4c']];
  let me = null;
  let dirty = false;      // 쓰던 기사가 저장되지 않았는지
  let lastHash = '';

  // ── 도우미 ──────────────────────────────────
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return String(d.getFullYear()).slice(2) + '.' + two(d.getMonth() + 1) + '.' + two(d.getDate()) +
      ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
  function toast(text) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2800);
  }
  function fail(err) {
    console.error(err);
    toast('처리하지 못했습니다. ' + (err && err.message ? err.message : ''));
  }
  // 위험한 버튼은 두 번 눌러야 실행됩니다
  function twoStep(btn, label, run) {
    btn.addEventListener('click', async function () {
      if (!btn.dataset.sure) {
        btn.dataset.sure = '1';
        btn.textContent = label;
        setTimeout(() => { if (!btn.disabled) { delete btn.dataset.sure; btn.textContent = btn.dataset.text; } }, 4000);
        return;
      }
      btn.disabled = true;
      try { await run(); } catch (err) { fail(err); btn.disabled = false; }
    });
    btn.dataset.text = btn.textContent;
  }
  function head(title, right) {
    return '<header class="head"><h1>' + title + '</h1>' + (right ? '<div class="head-right">' + right + '</div>' : '') + '</header>';
  }
  function searchBox(q, placeholder) {
    return '<form class="search" id="admSearch" role="search">' +
      '<input type="search" name="q" value="' + esc(q) + '" placeholder="' + placeholder + '" aria-label="' + placeholder + '">' +
      '<button class="btn ghost" type="submit">찾기</button>' +
      (q ? '<a class="link" href="' + location.hash.split('?')[0] + '">전체 보기</a>' : '') +
    '</form>';
  }
  function table(cols, rows, empty) {
    if (!rows) return '<div class="card"><p class="empty">' + empty + '</p></div>';
    return '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
      cols.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // 사진이 크면 올리기 전에 줄입니다 (저장 공간 절약, 긴 변 1800px)
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch (e) { return file; }
  }
  async function upload(file) { return API.uploadImage(await shrink(file)); }

  // ── 기사 목록 ───────────────────────────────
  async function viewArticles(arg, query) {
    const q = query.q || '';
    const list = await API.listAllArticles(q);
    const rows = list.map((a) =>
      '<tr>' +
        '<td class="t-title"><a href="#/write/' + a.id + '">' + esc(a.title) + '</a>' +
          (a.main_slot ? ' <span class="pill">' + SLOT_NAMES[a.main_slot] + '</span>' : '') + '</td>' +
        '<td>' + esc(a.category) + '</td>' +
        '<td>' + esc(a.author_name || '') + '</td>' +
        '<td class="num">' + (a.comment_count || 0) + '</td>' +
        '<td class="num">' + fmt(a.created_at) + '</td>' +
        '<td class="acts">' +
          '<a href="index.html#/article/' + a.id + '" target="_blank" rel="noopener">보기</a>' +
          '<a href="#/write/' + a.id + '">수정</a>' +
          '<button type="button" class="danger" data-del="' + a.id + '">삭제</button>' +
        '</td>' +
      '</tr>').join('');
    return head('기사 목록', '<a class="btn" href="#/write">새 기사 쓰기</a>') +
      searchBox(q, '제목으로 찾기') +
      table(['제목', '카테고리', '기자', '댓글', '입력', ''], rows,
        q ? '찾은 기사가 없습니다.' : '아직 기사가 없습니다. 새 기사 쓰기를 눌러 첫 기사를 올려 보세요.');
  }

  // ── 기사 쓰기 · 수정 ────────────────────────
  function toolbar() {
    const b = (cmd, label, title) =>
      '<button type="button" data-cmd="' + cmd + '" title="' + title + '" aria-label="' + title + '">' + label + '</button>';
    return '<div class="toolbar" id="toolbar" role="toolbar" aria-label="본문 서식">' +
      b('p', '본문', '본문 문단') + b('h2', '소제목', '소제목') + b('quote', '인용', '인용문') +
      '<span class="sep"></span>' +
      b('bold', '<b>B</b>', '굵게') + b('italic', '<i>I</i>', '기울임') + b('underline', '<u>U</u>', '밑줄') +
      '<select data-style="font" aria-label="글꼴"><option value="">글꼴</option>' +
        '<option value="f-sans">고딕</option><option value="f-serif">명조</option></select>' +
      '<select data-style="size" aria-label="글자 크기"><option value="">크기</option>' +
        '<option value="s-md">기본</option>' +
        SIZES.map((p) => '<option value="s-' + p + '">' + p + 'pt</option>').join('') + '</select>' +
      '<select data-style="color" aria-label="글씨 색"><option value="">글씨 색</option>' +
        '<option value="c-none">기본</option>' +
        COLORS.map((c) => '<option value="' + c[0] + '" style="color:' + c[2] + '">■ ' + c[1] + '</option>').join('') + '</select>' +
      '<span class="sep"></span>' +
      b('ul', '목록', '글머리 목록') + b('link', '링크', '링크 걸기') + b('hr', '구분선', '구분선') +
      b('image', '사진', '커서 위치에 사진 넣기') +
      b('video', '동영상', '커서 위치에 동영상 파일 넣기 (50MB 이하)') +
      b('youtube', '유튜브', '커서 위치에 유튜브 영상 넣기') +
      '<span class="sep"></span>' +
      b('clear', '서식 지우기', '고른 부분의 서식 지우기') +
    '</div>';
  }

  async function viewWrite(arg) {
    const id = Number(arg) || 0;
    const a = id ? await API.getArticle(id) : null;
    if (id && !a) return head('기사 수정') + '<div class="card"><p class="empty">기사를 찾을 수 없습니다.</p></div>';
    const art = a || {
      title: '', summary: '', body: '', format: 'html', category: CATEGORIES[0] || '',
      image_url: '', image_caption: '', author_name: me.nickname ? me.nickname + ' 기자' : '', main_slot: null,
    };
    const cats = (CATEGORIES.indexOf(art.category) === -1 && art.category ? CATEGORIES.concat([art.category]) : CATEGORIES)
      .map((c) => '<option' + (c === art.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
    const slots = '<option value="">배치 안 함 (최신순 자동)</option>' + [1, 2, 3].map((n) =>
      '<option value="' + n + '"' + (art.main_slot === n ? ' selected' : '') + '>' + SLOT_NAMES[n] + '</option>').join('');
    const bodyHtml = (art.format === 'html' ? Rich.sanitize(art.body) : Rich.fromText(art.body)) || '<p><br></p>';
    const img = safeUrl(art.image_url);
    return head(a ? '기사 수정' : '새 기사 쓰기',
        a ? '<a class="btn ghost" href="index.html#/article/' + a.id + '" target="_blank" rel="noopener">사이트에서 보기</a>' : '') +
      '<form class="write" id="articleForm" data-id="' + (a ? a.id : '') + '" novalidate>' +
        '<div class="write-main card">' +
          '<input class="in-title" name="title" maxlength="100" placeholder="제목을 입력하세요" aria-label="제목" value="' + esc(art.title) + '">' +
          '<input class="in-dek" name="summary" maxlength="200" placeholder="부제 (한 줄 요약, 선택)" aria-label="부제" value="' + esc(art.summary || '') + '">' +
          toolbar() +
          '<div class="editor rich" id="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="본문">' + bodyHtml + '</div>' +
          '<input type="file" id="bodyImage" accept="image/*" hidden>' +
          '<input type="file" id="bodyVideo" accept="video/mp4,video/webm,video/quicktime" hidden>' +
          '<p class="hint">사진·동영상·유튜브는 커서를 둔 자리에 들어갑니다. 그 아래 회색 칸에 설명을 쓰고, 넣은 뒤에는 바로 아래에 이어서 본문을 쓸 수 있습니다. 설명 칸에서 Enter 를 누르면 본문으로 넘어갑니다. 다른 곳에서 글을 복사해 붙여넣으면 서식이 정리되어 들어갑니다.</p>' +
        '</div>' +
        '<div class="write-side">' +
          '<div class="card box">' +
            '<label>카테고리<select name="category">' + cats + '</select></label>' +
            '<label>기자명<input name="author_name" maxlength="30" placeholder="예: 홍길동 기자" value="' + esc(art.author_name || '') + '"></label>' +
            '<label>메인 배치<select name="main_slot">' + slots + '</select></label>' +
          '</div>' +
          '<div class="card box">' +
            '<span class="lbl">대표 사진</span>' +
            '<label class="drop">' +
              '<img id="heroImg" alt=""' + (img ? ' src="' + esc(img) + '"' : ' hidden') + '>' +
              '<span>' + (img ? '사진 바꾸기' : '사진 고르기') + '</span>' +
              '<input type="file" id="heroFile" accept="image/*">' +
            '</label>' +
            '<input type="hidden" name="image_url" value="' + esc(art.image_url || '') + '">' +
            '<label>사진 설명<input name="image_caption" maxlength="120" placeholder="예: 사진=베이스볼 코리아" value="' + esc(art.image_caption || '') + '"></label>' +
            '<button type="button" class="link danger" id="heroRemove"' + (img ? '' : ' hidden') + '>대표 사진 빼기</button>' +
          '</div>' +
          '<p class="form-error" hidden></p>' +
          '<button class="btn big" type="submit">' + (a ? '수정한 내용 저장' : '기사 올리기') + '</button>' +
        '</div>' +
      '</form>';
  }

  function bindWrite() {
    const form = document.getElementById('articleForm');
    if (!form) return;
    const editor = document.getElementById('editor');
    let saved = null;
    const changed = () => { dirty = true; };
    document.execCommand('defaultParagraphSeparator', false, 'p');

    // 편집기 안에서 마지막으로 고른 위치를 기억합니다 (도구 버튼을 눌러도 잃지 않도록)
    const keep = () => {
      const s = getSelection();
      if (s.rangeCount && editor.contains(s.getRangeAt(0).commonAncestorContainer)) saved = s.getRangeAt(0).cloneRange();
    };
    const restore = () => {
      editor.focus();
      if (saved) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved); }
    };
    document.onselectionchange = keep;
    const exec = (cmd, value) => {
      restore();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(cmd, false, value);
      keep();
      changed();
    };

    // 글꼴·크기: 고른 글자를 class 가 붙은 span 으로 감쌉니다
    function styleSpan(kind, cls) {
      restore();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontName', false, 'bn_' + kind);
      const family = kind === 'font' ? ['f-sans', 'f-serif']
        : kind === 'color' ? COLORS.map((c) => c[0])
          : ['s-sm', 's-lg', 's-xl'].concat(SIZES.map((p) => 's-' + p));
      const made = [];
      editor.querySelectorAll('font[face="bn_' + kind + '"]').forEach((f) => {
        f.querySelectorAll('span').forEach((sp) => {
          family.forEach((x) => sp.classList.remove(x));
          if (!sp.classList.length) sp.replaceWith(...Array.from(sp.childNodes));
        });
        const span = document.createElement('span');
        if (cls !== 's-md' && cls !== 'c-none') span.className = cls;
        while (f.firstChild) span.appendChild(f.firstChild);
        if (span.className) { f.replaceWith(span); made.push(span); }
        else f.replaceWith(...Array.from(span.childNodes));
      });
      // 바꾼 글자를 다시 선택해 두어 이어서 다른 서식을 줄 수 있게 합니다
      if (made.length) {
        const r = document.createRange();
        r.setStart(made[0], 0);
        r.setEnd(made[made.length - 1], made[made.length - 1].childNodes.length);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      keep();
      changed();
    }
    function clearSpans() {
      const s = getSelection();
      if (!s.rangeCount) return;
      const r = s.getRangeAt(0);
      editor.querySelectorAll('span').forEach((sp) => {
        if (r.intersectsNode(sp)) sp.replaceWith(...Array.from(sp.childNodes));
      });
    }
    // 커서를 문단 맨 앞에 둡니다
    function caretInto(p) {
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      keep();
    }
    // 사진·동영상 바로 아래 문단을 찾고, 없으면 만듭니다
    function paragraphAfter(fig) {
      let next = fig.nextElementSibling;
      if (!next || next.tagName !== 'P') {
        next = document.createElement('p');
        next.innerHTML = '<br>';
        fig.after(next);
      }
      return next;
    }
    // 사진·동영상을 넣고, 커서를 그 아래 새 문단으로 옮겨 바로 이어서 글을 쓸 수 있게 합니다
    function insertMedia(inner) {
      const mark = 'm' + Date.now();
      exec('insertHTML', '<figure data-new="' + mark + '">' + inner + '<figcaption></figcaption></figure><p><br></p>');
      const fig = editor.querySelector('figure[data-new="' + mark + '"]');
      if (!fig) return;
      fig.removeAttribute('data-new');
      // 문단 안에 끼어 들어갔으면 문단 밖으로 꺼냅니다
      const holder = fig.parentElement;
      if (holder && holder !== editor && holder.tagName === 'P') holder.after(fig);
      caretInto(paragraphAfter(fig));
      ensureTail();
    }
    // 본문 맨 끝이 사진·동영상·구분선이면 빈 문단을 붙여, 그 아래를 눌러 글을 쓸 수 있게 합니다
    function ensureTail() {
      const last = editor.lastElementChild;
      if (last && /^(FIGURE|HR|BLOCKQUOTE|UL|OL)$/.test(last.tagName)) {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        editor.appendChild(p);
      }
    }
    function insertFigure(url) {
      insertMedia('<img src="' + esc(url) + '" alt="">');
    }
    ensureTail();
    // 사진 설명 칸에서 Enter 를 누르면 사진 아래 본문으로 넘어갑니다 (Shift+Enter 는 설명 줄바꿈)
    editor.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      const sel = getSelection();
      const cap = sel.rangeCount && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('figcaption');
      if (!cap || !editor.contains(cap)) return;
      e.preventDefault();
      caretInto(paragraphAfter(cap.closest('figure')));
    });
    // 사진·동영상 아래 빈 곳을 누르면 그 아래 문단으로 커서를 옮깁니다
    editor.addEventListener('click', (e) => {
      const fig = e.target.closest('figure');
      if (!fig || e.target.closest('figcaption')) return;
      caretInto(paragraphAfter(fig));
    });

    const bar = document.getElementById('toolbar');
    bar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cmd]');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      if (cmd === 'p' || cmd === 'h2') exec('formatBlock', '<' + cmd + '>');
      else if (cmd === 'quote') exec('formatBlock', '<blockquote>');
      else if (cmd === 'ul') exec('insertUnorderedList');
      else if (cmd === 'hr') exec('insertHorizontalRule');
      else if (cmd === 'link') {
        const url = window.prompt('연결할 주소를 입력하세요 (https:// 로 시작)', 'https://');
        if (url && /^https?:\/\/\S+$/i.test(url.trim())) exec('createLink', url.trim());
      } else if (cmd === 'image') document.getElementById('bodyImage').click();
      else if (cmd === 'video') document.getElementById('bodyVideo').click();
      else if (cmd === 'youtube') {
        const src = Rich.youtubeEmbed(window.prompt('유튜브 영상 주소를 붙여넣으세요', 'https://www.youtube.com/watch?v='));
        if (src) insertMedia('<iframe src="' + esc(src) + '"></iframe>');
        else toast('유튜브 영상 주소를 확인해 주세요');
      }
      else if (cmd === 'clear') { exec('removeFormat'); clearSpans(); }
      else exec(cmd);
    });
    bar.querySelectorAll('select[data-style]').forEach((sel) => {
      sel.addEventListener('change', () => {
        if (sel.value) styleSpan(sel.dataset.style, sel.value);
        sel.value = '';
      });
    });

    document.getElementById('bodyImage').addEventListener('change', async function () {
      const file = this.files[0];
      this.value = '';
      if (!file) return;
      toast('사진 올리는 중');
      try {
        insertFigure(await upload(file));
        toast('사진을 넣었습니다. 사진 아래에 설명을 쓸 수 있습니다.');
      } catch (err) { fail(err); }
    });

    document.getElementById('bodyVideo').addEventListener('change', async function () {
      const file = this.files[0];
      this.value = '';
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) {
        toast('50MB 이하 영상만 올릴 수 있습니다. 큰 영상은 유튜브에 올린 뒤 유튜브 버튼으로 넣어 주세요.');
        return;
      }
      toast('동영상 올리는 중. 크기에 따라 시간이 걸립니다.');
      try {
        const url = await API.uploadImage(file);
        insertMedia('<video src="' + esc(url) + '" controls></video>');
        toast('동영상을 넣었습니다');
      } catch (err) { fail(err); }
    });

    // 붙여넣기: 사진은 올려서 넣고, 글은 서식을 정리해서 넣습니다
    editor.addEventListener('paste', async (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      e.preventDefault();
      const file = Array.from(cd.files || []).find((f) => /^image\//.test(f.type));
      if (file) {
        toast('사진 올리는 중');
        try { insertFigure(await upload(file)); } catch (err) { fail(err); }
        return;
      }
      const html = cd.getData('text/html');
      if (html) exec('insertHTML', Rich.sanitize(html));
      else exec('insertText', cd.getData('text/plain'));
    });
    editor.addEventListener('input', () => { changed(); ensureTail(); });
    form.addEventListener('input', changed);

    // 대표 사진
    const heroFile = document.getElementById('heroFile');
    const heroImg = document.getElementById('heroImg');
    const heroRemove = document.getElementById('heroRemove');
    heroFile.addEventListener('change', async () => {
      const file = heroFile.files[0];
      heroFile.value = '';
      if (!file) return;
      toast('대표 사진 올리는 중');
      try {
        const url = await upload(file);
        form.image_url.value = url;
        heroImg.src = url;
        heroImg.hidden = false;
        heroRemove.hidden = false;
        changed();
        toast('대표 사진을 올렸습니다');
      } catch (err) { fail(err); }
    });
    heroRemove.addEventListener('click', () => {
      form.image_url.value = '';
      heroImg.hidden = true;
      heroRemove.hidden = true;
      changed();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = form.querySelector('.form-error');
      const title = form.title.value.trim();
      const copy = editor.cloneNode(true);
      copy.querySelectorAll('figcaption').forEach((c) => { if (!c.textContent.trim()) c.remove(); });
      const hasBody = copy.textContent.trim() || copy.querySelector('img');
      if (!title || !hasBody) {
        msg.textContent = !title ? '제목을 입력해 주세요.' : '본문을 입력해 주세요.';
        msg.hidden = false;
        return;
      }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      msg.hidden = true;
      try {
        await API.saveArticle({
          id: Number(form.dataset.id) || null,
          title: title,
          summary: form.summary.value.trim(),
          author_name: form.author_name.value.trim(),
          category: form.category.value,
          image_url: form.image_url.value,
          image_caption: form.image_caption.value.trim(),
          body: Rich.sanitize(copy.innerHTML).trim(),
          slot: form.main_slot.value ? Number(form.main_slot.value) : null,
        });
        dirty = false;
        toast(form.dataset.id ? '저장했습니다' : '기사를 올렸습니다');
        location.hash = '#/articles';
      } catch (err) {
        console.error(err);
        msg.textContent = '저장하지 못했습니다. ' + (err && err.message ? err.message : '');
        msg.hidden = false;
        btn.disabled = false;
      }
    });
  }

  // ── 메인 배치 ───────────────────────────────
  async function viewMain() {
    const list = await API.listAllArticles('');
    const holder = {};
    list.forEach((a) => { if (a.main_slot) holder[a.main_slot] = a; });
    const box = (slot) => {
      const h = holder[slot];
      const img = h ? safeUrl(h.image_url) : '';
      return '<div class="slot slot-' + slot + '">' +
        '<span class="slot-ph">' + (img ? '<img src="' + esc(img) + '" alt="">' : '') + '</span>' +
        '<span class="lbl">' + SLOT_NAMES[slot] + '</span>' +
        '<select data-slot="' + slot + '" data-current="' + (h ? h.id : '') + '" aria-label="' + SLOT_NAMES[slot] + '">' +
          '<option value="">자동 (최신 기사)</option>' +
          list.slice(0, 80).map((a) => '<option value="' + a.id + '"' + (h && h.id === a.id ? ' selected' : '') + '>' + esc(a.title) + '</option>').join('') +
        '</select></div>';
    };
    return head('메인 배치') +
      '<p class="hint">첫 화면 맨 위 세 자리에 놓을 기사를 고르세요. 고르는 즉시 사이트에 반영됩니다. ' +
        '자동으로 두면 최신 기사가 들어갑니다. 큰 기사 자리는 옆으로 넘기는 슬라이드라서, 여기서 고른 기사가 첫 장에 나오고 ' +
        '이어서 최신 기사가 최대 4장 더 나옵니다.</p>' +
      '<div class="card slots"><div class="slot-side">' + box(2) + box(3) + '</div>' + box(1) + '</div>';
  }

  // ── 신고 관리 ───────────────────────────────
  const REASON_NAMES = {};
  (API.REPORT_REASONS || []).forEach((r) => { REASON_NAMES[r[0]] = r[1]; });
  async function refreshBadge() {
    const n = await API.countOpenReports().catch(() => 0);
    const badge = document.getElementById('reportBadge');
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = !n;
  }
  async function viewReports(arg, query) {
    const status = query.status === 'done' ? 'done' : 'open';
    const list = await API.listReports(status);
    // 같은 글·댓글에 들어온 신고를 하나로 묶습니다
    const groups = [];
    const byKey = {};
    list.forEach((r) => {
      const key = r.post_id ? 'p' + r.post_id : 'c' + r.comment_id;
      if (!byKey[key]) { byKey[key] = { key: key, items: [], r: r }; groups.push(byKey[key]); }
      byKey[key].items.push(r);
    });
    const rows = groups.map((g) => {
      const r = g.r;
      let what;
      let link;
      if (r.post_id) {
        what = '<span class="pill">게시글</span> ' + esc(r.posts ? r.posts.title : '삭제된 글');
        link = 'index.html#/board/' + r.post_id;
      } else {
        const c = r.comments || {};
        what = '<span class="pill">댓글</span> ' + esc(c.body || '삭제된 댓글');
        link = c.post_id ? 'index.html#/board/' + c.post_id : 'index.html#/article/' + c.article_id;
      }
      const who = r.post_id ? (r.posts && r.posts.nickname) : (r.comments && r.comments.nickname);
      const counts = {};
      g.items.forEach((i) => { counts[i.reason] = (counts[i.reason] || 0) + 1; });
      const reasons = Object.keys(counts).map((k) => esc(REASON_NAMES[k] || k) + (counts[k] > 1 ? ' ' + counts[k] : '')).join(', ');
      const details = g.items.filter((i) => i.detail).map((i) => '<li>' + esc(i.detail) + '</li>').join('');
      const ids = g.items.map((i) => i.id).join(',');
      return '<tr>' +
        '<td class="t-body"><p>' + what + '</p><span class="where">작성자 ' + esc(who || '-') +
          ' · <a href="' + link + '" target="_blank" rel="noopener">사이트에서 보기</a></span>' +
          (details ? '<ul class="details">' + details + '</ul>' : '') + '</td>' +
        '<td><b class="num-big">' + g.items.length + '</b></td>' +
        '<td>' + reasons + '</td>' +
        '<td class="num">' + fmt(r.created_at) + '</td>' +
        '<td class="acts">' + (status === 'open'
          ? '<button type="button" data-resolve="' + ids + '">문제 없음</button>' +
            '<button type="button" class="danger" data-rdel="' + (r.post_id ? 'post:' + r.post_id : 'comment:' + r.comment_id) + '">' + (r.post_id ? '글 삭제' : '댓글 삭제') + '</button>'
          : '<span class="muted">처리함</span>') + '</td>' +
      '</tr>';
    }).join('');
    return head('신고 관리',
        status === 'open' ? '<a class="btn ghost" href="#/reports?status=done">처리한 신고 보기</a>' : '<a class="btn ghost" href="#/reports">처리 전 신고 보기</a>') +
      '<p class="hint">신고는 익명이라 신고한 사람은 저장되지 않습니다. 같은 글에 들어온 신고는 한 줄로 묶어 보여 줍니다. ' +
        '글이나 댓글을 삭제하면 그 신고도 함께 지워집니다.</p>' +
      table(['신고된 내용', '신고 수', '사유', '최근 신고', ''], rows,
        status === 'open' ? '처리할 신고가 없습니다.' : '처리한 신고가 없습니다.');
  }

  // ── 게시판 관리 ─────────────────────────────
  async function viewBoard(arg, query) {
    const q = query.q || '';
    const list = await API.listAllPosts(q);
    const rows = list.map((p) =>
      '<tr>' +
        '<td class="t-title"><a href="index.html#/board/' + p.id + '" target="_blank" rel="noopener">' + esc(p.title) + '</a></td>' +
        '<td>' + esc(p.category) + '</td>' +
        '<td>' + esc(p.nickname) + '</td>' +
        '<td class="num">' + (p.comment_count || 0) + '</td>' +
        '<td class="num">' + (p.views || 0) + '</td>' +
        '<td class="num">' + fmt(p.created_at) + '</td>' +
        '<td class="acts"><button type="button" class="danger" data-pdel="' + p.id + '">삭제</button></td>' +
      '</tr>').join('');
    return head('게시판 관리') +
      '<p class="hint">최근 게시글 200개입니다. 사이트에서는 글쓴이 본인만 지울 수 있고, 다른 사람의 글은 여기서 지웁니다.</p>' +
      searchBox(q, '제목으로 찾기') +
      table(['제목', '말머리', '글쓴이', '댓글', '조회', '작성', ''], rows, q ? '찾은 글이 없습니다.' : '아직 글이 없습니다.');
  }

  // ── 인스타그램 ──────────────────────────────
  async function viewInsta() {
    const list = await API.listInstaPosts(30);
    const rows = list.map((p, i) =>
      '<tr>' +
        '<td class="t-title"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.url) + '</a>' +
          (i < 6 ? ' <span class="pill">첫 화면 표시</span>' : '') + '</td>' +
        '<td class="num">' + fmt(p.created_at) + '</td>' +
        '<td class="acts"><button type="button" class="danger" data-idel="' + p.id + '">빼기</button></td>' +
      '</tr>').join('');
    return head('인스타그램') +
      '<p class="hint">첫 화면 아래 인스타그램 칸에 보여 줄 게시물을 고르세요. 인스타그램 게시물에서 공유 → 링크 복사를 누른 뒤 ' +
        '아래에 붙여넣으면 됩니다. 가장 최근에 넣은 6개가 첫 화면에 나옵니다.</p>' +
      '<form class="search" id="instaForm">' +
        '<input name="url" placeholder="https://www.instagram.com/p/..." aria-label="인스타그램 게시물 주소" required>' +
        '<button class="btn" type="submit">게시물 넣기</button>' +
      '</form>' +
      table(['게시물', '넣은 때', ''], rows, '아직 넣은 게시물이 없습니다. 게시물이 없으면 첫 화면에는 인스타그램 바로가기 버튼만 나옵니다.');
  }

  // ── 댓글 관리 ───────────────────────────────
  async function viewComments() {
    const list = await API.listRecentComments(150);
    const rows = list.map((c) => {
      const where = c.post_id
        ? '게시판 · <a href="index.html#/board/' + c.post_id + '" target="_blank" rel="noopener">' + esc(c.posts ? c.posts.title : '삭제된 글') + '</a>'
        : '기사 · <a href="index.html#/article/' + c.article_id + '" target="_blank" rel="noopener">' + esc(c.articles ? c.articles.title : '삭제된 기사') + '</a>';
      return '<tr>' +
        '<td class="t-who">' + esc(c.nickname) + '</td>' +
        '<td class="t-body"><p>' + esc(c.body) + '</p><span class="where">' + where + '</span></td>' +
        '<td class="num">' + fmt(c.created_at) + '</td>' +
        '<td class="acts"><button type="button" class="danger" data-cdel="' + c.id + '">삭제</button></td>' +
      '</tr>';
    }).join('');
    return head('댓글 관리') +
      '<p class="hint">최근 댓글 150개입니다. 게시판 글은 사이트의 글 화면에서 운영진이 바로 삭제할 수 있습니다.</p>' +
      table(['닉네임', '댓글', '작성', ''], rows, '아직 댓글이 없습니다.');
  }

  // ── 회원 관리 ───────────────────────────────
  async function viewMembers(arg, query) {
    const q = query.q || '';
    const list = await API.listMembers(q);
    const rows = list.map((m) => {
      const self = m.id === me.id;
      let role = esc(ROLE_NAMES[m.role] || m.role);
      if (me.isAdmin && !self) {
        role = '<select data-role="' + m.id + '" data-banned="' + m.banned + '" aria-label="역할">' +
          ['member', 'reporter', 'admin'].map((r) =>
            '<option value="' + r + '"' + (r === m.role ? ' selected' : '') + '>' + ROLE_NAMES[r] + '</option>').join('') +
          '</select>';
      }
      const canBan = !self && (me.isAdmin || m.role === 'member');
      return '<tr' + (m.banned ? ' class="is-banned"' : '') + '>' +
        '<td>' + (m.nickname ? esc(m.nickname) : '<span class="muted">닉네임 없음</span>') + (self ? ' <span class="pill">나</span>' : '') + '</td>' +
        '<td>' + role + '</td>' +
        '<td>' + (m.banned ? '<span class="pill red">정지</span>' : '정상') + '</td>' +
        '<td class="num">' + fmt(m.created_at) + '</td>' +
        '<td class="acts">' + (canBan
          ? '<button type="button" class="' + (m.banned ? '' : 'danger') + '" data-ban="' + m.id + '" data-role-now="' + m.role + '" data-banned="' + m.banned + '">' +
              (m.banned ? '정지 풀기' : '이용 정지') + '</button>'
          : '') + '</td>' +
      '</tr>';
    }).join('');
    return head('회원 관리') +
      '<p class="hint">기자를 추가하려면, 그 사람이 먼저 사이트에 네이버로 로그인해 닉네임을 정하게 한 뒤 ' +
        '여기서 닉네임으로 찾아 역할을 기자로 바꾸세요. 기자는 관리자 페이지를 쓸 수 있습니다.' +
        (me.isAdmin ? '' : ' 역할 변경은 관리자만 할 수 있습니다.') + '</p>' +
      searchBox(q, '닉네임으로 찾기') +
      table(['닉네임', '역할', '상태', '가입', ''], rows, q ? '찾은 회원이 없습니다.' : '회원이 없습니다.');
  }

  // ── 화면 공통 연결 ──────────────────────────
  function bindCommon(name) {
    const search = document.getElementById('admSearch');
    if (search) {
      search.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = search.q.value.trim();
        location.hash = '#/' + name + (q ? '?q=' + encodeURIComponent(q) : '');
      });
    }
    main.querySelectorAll('[data-del]').forEach((btn) => {
      twoStep(btn, '정말 삭제', async () => { await API.deleteArticle(Number(btn.dataset.del)); toast('기사를 삭제했습니다'); render(); });
    });
    main.querySelectorAll('[data-cdel]').forEach((btn) => {
      twoStep(btn, '정말 삭제', async () => { await API.deleteComment(Number(btn.dataset.cdel)); toast('댓글을 삭제했습니다'); render(); });
    });
    const instaForm = document.getElementById('instaForm');
    if (instaForm) {
      instaForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = instaForm.querySelector('button');
        btn.disabled = true;
        try {
          await API.addInstaPost(instaForm.url.value);
          toast('게시물을 넣었습니다');
          render();
        } catch (err) { fail(err); btn.disabled = false; }
      });
    }
    main.querySelectorAll('[data-idel]').forEach((btn) => {
      twoStep(btn, '정말 빼기', async () => { await API.deleteInstaPost(Number(btn.dataset.idel)); toast('게시물을 뺐습니다'); render(); });
    });
    main.querySelectorAll('[data-pdel]').forEach((btn) => {
      twoStep(btn, '정말 삭제', async () => { await API.deletePost(Number(btn.dataset.pdel)); toast('게시글을 삭제했습니다'); render(); });
    });
    main.querySelectorAll('[data-rdel]').forEach((btn) => {
      twoStep(btn, '정말 삭제', async () => {
        const t = btn.dataset.rdel.split(':');
        if (t[0] === 'post') await API.deletePost(Number(t[1])); else await API.deleteComment(Number(t[1]));
        toast('삭제했습니다');
        render();
      });
    });
    main.querySelectorAll('[data-resolve]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await API.resolveReports(btn.dataset.resolve.split(',').map(Number));
          toast('문제 없음으로 처리했습니다');
          render();
        } catch (err) { fail(err); btn.disabled = false; }
      });
    });
    main.querySelectorAll('select[data-slot]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const slot = Number(sel.dataset.slot);
        try {
          if (sel.value) await API.setMainSlot(Number(sel.value), slot);
          else if (sel.dataset.current) await API.setMainSlot(Number(sel.dataset.current), null);
          toast(SLOT_NAMES[slot] + ' 자리를 바꿨습니다');
          render();
        } catch (err) { fail(err); }
      });
    });
    main.querySelectorAll('select[data-role]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try {
          await API.setMember(sel.dataset.role, sel.value, sel.dataset.banned === 'true');
          toast('역할을 ' + ROLE_NAMES[sel.value] + '(으)로 바꿨습니다');
          render();
        } catch (err) { fail(err); render(); }
      });
    });
    main.querySelectorAll('[data-ban]').forEach((btn) => {
      const banning = btn.dataset.banned !== 'true';
      const run = async () => {
        await API.setMember(btn.dataset.ban, btn.dataset.roleNow, banning);
        toast(banning ? '이용을 정지했습니다' : '정지를 풀었습니다');
        render();
      };
      if (banning) twoStep(btn, '정말 정지', run);
      else btn.addEventListener('click', () => run().catch(fail));
    });
    bindWrite();
  }

  // ── 주소 → 화면 ─────────────────────────────
  const VIEWS = { articles: viewArticles, write: viewWrite, main: viewMain, insta: viewInsta, reports: viewReports, board: viewBoard, comments: viewComments, members: viewMembers };
  let turn = 0;
  async function render() {
    const mine = ++turn;
    const raw = location.hash.replace(/^#\/?/, '');
    const cutAt = raw.indexOf('?');
    const parts = (cutAt === -1 ? raw : raw.slice(0, cutAt)).split('/');
    const name = parts[0] || 'articles';
    const query = {};
    if (cutAt !== -1) {
      raw.slice(cutAt + 1).split('&').forEach((pair) => {
        const eq = pair.indexOf('=');
        if (eq > 0) { try { query[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1)); } catch (e) { /* 무시 */ } }
      });
    }
    const view = VIEWS[name];
    if (!view) { location.hash = '#/articles'; return; }
    document.querySelectorAll('[data-nav]').forEach((a) => {
      a.classList.toggle('on', a.dataset.nav === name && !(name === 'write' && parts[1]));
    });
    document.onselectionchange = null;
    main.classList.add('is-loading');
    let html;
    try { html = await view(parts[1] || '', query); }
    catch (err) {
      console.error(err);
      html = '<div class="card"><p class="empty">불러오지 못했습니다. ' + esc(err && err.message ? err.message : '') + '</p></div>';
    }
    if (mine !== turn) return;
    main.innerHTML = html;
    main.classList.remove('is-loading');
    window.scrollTo(0, 0);
    bindCommon(name);
    refreshBadge();
  }

  function gate(title, body) {
    main.innerHTML = '<div class="gate card"><h1>' + title + '</h1>' + body + '</div>';
  }

  async function start() {
    if (!API.live) { gate('DB가 연결되지 않았습니다', '<p>js/config.js 의 Supabase 설정을 확인해 주세요.</p>'); return; }
    try { me = await API.getUser(); } catch (e) { me = null; }
    if (!me) {
      gate('운영진 로그인이 필요합니다',
        '<p>기자·관리자 계정으로 로그인하면 이 페이지를 쓸 수 있습니다.</p>' +
        '<a class="btn" href="index.html#/login?next=admin">로그인하러 가기</a>');
      return;
    }
    if (!me.isStaff) {
      gate('관리자 페이지를 쓸 권한이 없습니다', '<p>관리자에게 기자 권한을 요청해 주세요.</p><a class="btn ghost" href="index.html">사이트로 돌아가기</a>');
      return;
    }
    document.body.classList.add('ready');
    document.getElementById('admWho').textContent = (me.nickname || '이름 없음') + ' · ' + ROLE_NAMES[me.role];
    const logout = document.getElementById('admLogout');
    logout.hidden = false;
    logout.addEventListener('click', async () => { await API.signOut(); location.href = 'index.html'; });

    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('hashchange', () => {
      if (dirty && !window.confirm('저장하지 않은 내용이 있습니다. 이 화면을 나갈까요?')) {
        history.replaceState(null, '', lastHash || '#/articles');
        return;
      }
      dirty = false;
      lastHash = location.hash;
      render();
    });
    lastHash = location.hash;
    render();
  }
  start();
})();
