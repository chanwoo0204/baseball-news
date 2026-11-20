-- 12) 공지사항과 일정 — 누구나 보고, 쓰기·고치기·지우기는 운영진만
create table if not exists public.notices (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 100),
  body text not null default '' check (char_length(body) <= 10000),
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.events (
  id bigint generated always as identity primary key,
  day date not null,
  title text not null check (char_length(title) between 1 and 100),
  kind text not null default '기타' check (kind in ('경기', '행사', '매거진', '기타')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists events_day_idx on public.events (day);
alter table public.notices enable row level security;
alter table public.events enable row level security;
revoke all on public.notices, public.events from anon, authenticated;
grant select on public.notices, public.events to anon, authenticated;
grant insert, update, delete on public.notices, public.events to authenticated;
drop policy if exists "notices read" on public.notices;
drop policy if exists "notices staff write" on public.notices;
drop policy if exists "events read" on public.events;
drop policy if exists "events staff write" on public.events;
create policy "notices read" on public.notices for select using (true);
create policy "notices staff write" on public.notices for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "events read" on public.events for select using (true);
create policy "events staff write" on public.events for all to authenticated using (public.is_staff()) with check (public.is_staff());
