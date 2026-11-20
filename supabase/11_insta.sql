-- 11) 첫 화면에 보여 줄 인스타그램 게시물 (운영진이 링크를 등록)
create table if not exists public.insta_posts (
  id bigint generated always as identity primary key,
  url text not null unique check (url ~ '^https://www\.instagram\.com/(p|reel)/[A-Za-z0-9_-]+/$'),
  created_at timestamptz not null default now()
);
alter table public.insta_posts enable row level security;
revoke all on public.insta_posts from anon, authenticated;
grant select on public.insta_posts to anon, authenticated;
grant insert (url), delete on public.insta_posts to authenticated;
drop policy if exists "insta read" on public.insta_posts;
drop policy if exists "insta staff insert" on public.insta_posts;
drop policy if exists "insta staff delete" on public.insta_posts;
create policy "insta read" on public.insta_posts for select using (true);
create policy "insta staff insert" on public.insta_posts for insert to authenticated with check (public.is_staff());
create policy "insta staff delete" on public.insta_posts for delete to authenticated using (public.is_staff());
