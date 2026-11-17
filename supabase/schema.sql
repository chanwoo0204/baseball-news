-- ─────────────────────────────────────────────
-- Supabase 의 SQL Editor 에 이 파일 내용을 전부 붙여넣고 Run 을 누르세요.
-- (한 번만 실행하면 됩니다)
-- ─────────────────────────────────────────────

-- 1) 뉴스 기사
create table if not exists public.articles (
  id          bigint generated always as identity primary key,
  title       text not null,
  summary     text,
  body        text not null default '',
  category    text not null default '칼럼',
  image_url   text,
  created_at  timestamptz not null default now()
);

-- 2) 게시판 글
create table if not exists public.posts (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(title) between 1 and 100),
  body        text not null check (char_length(body) between 1 and 5000),
  nickname    text not null check (char_length(nickname) between 1 and 20),
  created_at  timestamptz not null default now()
);

-- 3) 댓글 (게시글 또는 기사 중 하나에 달림)
create table if not exists public.comments (
  id          bigint generated always as identity primary key,
  post_id     bigint references public.posts(id) on delete cascade,
  article_id  bigint references public.articles(id) on delete cascade,
  nickname    text not null check (char_length(nickname) between 1 and 20),
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now(),
  check ((post_id is null) <> (article_id is null))
);

create index if not exists comments_post_idx on public.comments (post_id);
create index if not exists comments_article_idx on public.comments (article_id);
create index if not exists articles_category_idx on public.articles (category, created_at desc);

-- 4) 권한 규칙
--    방문자: 읽기만 가능 / 회원: 글·댓글 쓰기와 본인 글 삭제 (아래 8번에서 설정)
alter table public.articles enable row level security;
alter table public.posts    enable row level security;
alter table public.comments enable row level security;

grant select         on public.articles to anon, authenticated;
grant select, insert on public.posts    to anon, authenticated;
grant select, insert on public.comments to anon, authenticated;

drop policy if exists "articles read"  on public.articles;
drop policy if exists "posts read"     on public.posts;
drop policy if exists "posts write"    on public.posts;
drop policy if exists "comments read"  on public.comments;
drop policy if exists "comments write" on public.comments;

create policy "articles read"  on public.articles for select using (true);
create policy "posts read"     on public.posts    for select using (true);
create policy "posts write"    on public.posts    for insert with check (true);
create policy "comments read"  on public.comments for select using (true);
create policy "comments write" on public.comments for insert with check (true);

-- 5) 관리자 — 관리자만 기사를 쓰고, 고치고, 지울 수 있습니다
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
grant select on public.admins to authenticated;
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

grant insert, update, delete on public.articles to authenticated;
drop policy if exists "articles admin insert" on public.articles;
drop policy if exists "articles admin update" on public.articles;
drop policy if exists "articles admin delete" on public.articles;
create policy "articles admin insert" on public.articles
  for insert to authenticated with check (public.is_admin());
create policy "articles admin update" on public.articles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "articles admin delete" on public.articles
  for delete to authenticated using (public.is_admin());

-- 6) 기사 사진 보관함 — 누구나 볼 수 있고, 올리는 것은 관리자만
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

drop policy if exists "images read" on storage.objects;
drop policy if exists "images admin upload" on storage.objects;
create policy "images read" on storage.objects
  for select using (bucket_id = 'images');
create policy "images admin upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'images' and public.is_admin());

-- 7) 확인용 첫 기사 (표가 비어 있을 때만 들어갑니다)
insert into public.articles (title, summary, body, category)
select
  '첫 기사: DB 연결 성공',
  '이 기사가 보이면 사이트와 Supabase 가 연결된 것입니다.',
  '관리자로 로그인한 뒤 메뉴의 기사 관리에서 이 기사를 고치거나 지울 수 있습니다.',
  '칼럼'
where not exists (select 1 from public.articles);

-- 8) 게시판: 회원만 글·댓글 쓰기, 말머리, 조회수, 본인 글 삭제
alter table public.posts add column if not exists category text not null default '잡담';
alter table public.posts add column if not exists views integer not null default 0;
alter table public.posts add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.comments add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists posts_category_idx on public.posts (category, created_at desc);

-- 글쓴이(계정·닉네임)는 사용자가 보낸 값이 아니라 로그인 정보로 DB가 직접 채웁니다
create or replace function public.set_author()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.user_id := (select auth.uid());
  new.nickname := coalesce(
    nullif(left(trim((select u.raw_user_meta_data->>'nickname' from auth.users u where u.id = (select auth.uid()))), 20), ''),
    '회원');
  if tg_table_name = 'posts' then
    new.views := 0;
    new.category := left(coalesce(nullif(trim(new.category), ''), '잡담'), 10);
  end if;
  return new;
end;
$$;

drop trigger if exists set_author on public.posts;
create trigger set_author before insert on public.posts
  for each row execute function public.set_author();
drop trigger if exists set_author on public.comments;
create trigger set_author before insert on public.comments
  for each row execute function public.set_author();

create or replace function public.increment_views(pid bigint)
returns void language sql security definer set search_path = ''
as $$
  update public.posts set views = views + 1 where id = pid;
$$;
grant execute on function public.increment_views(bigint) to anon, authenticated;

revoke insert, update, delete on public.posts, public.comments, public.articles, public.admins from anon;
revoke update on public.posts, public.comments from authenticated;
grant insert, delete on public.posts, public.comments to authenticated;

drop policy if exists "posts write" on public.posts;
drop policy if exists "comments write" on public.comments;
drop policy if exists "posts member insert" on public.posts;
drop policy if exists "posts delete own" on public.posts;
drop policy if exists "comments member insert" on public.comments;
drop policy if exists "comments delete own" on public.comments;

-- '공지' 말머리는 관리자만, 삭제는 본인 글 또는 관리자만
create policy "posts member insert" on public.posts
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (category <> '공지' or public.is_admin()));
create policy "posts delete own" on public.posts
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy "comments member insert" on public.comments
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "comments delete own" on public.comments
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- ─────────────────────────────────────────────
-- 관리자 지정 방법 (사이트에서 회원가입을 마친 뒤에 실행)
-- 아래 이메일을 관리자 계정의 이메일로 바꾸고, 맨 앞의 -- 두 개를 지운 다음 Run:
--
-- insert into public.admins (user_id)
-- select id from auth.users where email = '관리자@이메일.com'
-- on conflict do nothing;
-- ─────────────────────────────────────────────
