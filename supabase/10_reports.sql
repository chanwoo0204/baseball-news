-- 10) 익명 신고 — 누구나 신고할 수 있고, 신고한 사람은 저장하지 않습니다. 보는 것은 운영진만.
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  post_id bigint references public.posts(id) on delete cascade,
  comment_id bigint references public.comments(id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'sexual', 'privacy', 'flood', 'false', 'other')),
  detail text check (char_length(detail) <= 300),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  check ((post_id is null) <> (comment_id is null))
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant insert (post_id, comment_id, reason, detail) on public.reports to anon, authenticated;
grant select, delete on public.reports to authenticated;
grant update (status) on public.reports to authenticated;
drop policy if exists "reports anyone insert" on public.reports;
drop policy if exists "reports staff read" on public.reports;
drop policy if exists "reports staff update" on public.reports;
drop policy if exists "reports staff delete" on public.reports;
create policy "reports anyone insert" on public.reports for insert to anon, authenticated with check (status = 'open');
create policy "reports staff read" on public.reports for select to authenticated using (public.is_staff());
create policy "reports staff update" on public.reports for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "reports staff delete" on public.reports for delete to authenticated using (public.is_staff());
