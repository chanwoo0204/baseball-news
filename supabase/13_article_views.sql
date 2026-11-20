-- 기사 조회수: "가장 많이 읽은 기사"에 씁니다
alter table public.articles add column if not exists views integer not null default 0;
create index if not exists articles_views_idx on public.articles (views desc, created_at desc);

create or replace function public.increment_article_views(aid bigint)
returns void language sql security definer set search_path = ''
as $$ update public.articles set views = views + 1 where id = aid; $$;
revoke all on function public.increment_article_views(bigint) from public;
grant execute on function public.increment_article_views(bigint) to anon, authenticated;
