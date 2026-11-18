-- 9) 회원 프로필 · 역할(회원/기자/관리자) · 이용 정지 · 메인 배치
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default '' check (char_length(nickname) <= 20),
  role text not null default 'member' check (role in ('member', 'reporter', 'admin')),
  banned boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- 가입하면 프로필이 자동으로 만들어집니다
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, left(coalesce(trim(new.raw_user_meta_data->>'nickname'), ''), 20))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이미 가입한 회원도 채우고, 기존 관리자는 관리자 역할로
insert into public.profiles (id, nickname)
select id, left(coalesce(trim(raw_user_meta_data->>'nickname'), ''), 20) from auth.users
on conflict (id) do nothing;
update public.profiles set role = 'admin' where id in (select user_id from public.admins);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and not banned);
$$;
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles
    where id = (select auth.uid()) and role in ('reporter', 'admin') and not banned);
$$;
create or replace function public.is_banned()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and banned);
$$;

-- 프로필: 본인 것은 보기·닉네임 수정만, 운영진은 전체 보기
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (nickname) on public.profiles to authenticated;
drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_staff());
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- 역할 변경·이용 정지 (기자는 일반 회원 정지만, 역할 변경은 관리자만)
create or replace function public.staff_set_member(uid uuid, new_role text, new_banned boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare old_role text;
begin
  if not public.is_staff() then raise exception '권한이 없습니다'; end if;
  if uid = (select auth.uid()) then raise exception '자기 계정은 바꿀 수 없습니다'; end if;
  if new_role not in ('member', 'reporter', 'admin') then raise exception '잘못된 역할입니다'; end if;
  select role into old_role from public.profiles where id = uid;
  if old_role is null then raise exception '회원을 찾을 수 없습니다'; end if;
  if (new_role <> old_role or old_role <> 'member') and not public.is_admin() then
    raise exception '관리자만 할 수 있습니다';
  end if;
  update public.profiles set role = new_role, banned = new_banned where id = uid;
end;
$$;
revoke all on function public.staff_set_member(uuid, text, boolean) from public, anon;
grant execute on function public.staff_set_member(uuid, text, boolean) to authenticated;

-- 글쓴이 닉네임은 프로필에서 가져옵니다
create or replace function public.set_author()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.user_id := (select auth.uid());
  new.nickname := coalesce(nullif((select p.nickname from public.profiles p
    where p.id = (select auth.uid())), ''), '회원');
  if tg_table_name = 'posts' then
    new.views := 0;
    new.category := left(coalesce(nullif(trim(new.category), ''), '잡담'), 10);
  end if;
  return new;
end;
$$;

-- 게시판: 정지된 회원은 글·댓글 금지, 운영진은 모든 글·댓글 삭제 가능
drop policy if exists "posts member insert" on public.posts;
drop policy if exists "posts delete own" on public.posts;
drop policy if exists "comments member insert" on public.comments;
drop policy if exists "comments delete own" on public.comments;
create policy "posts member insert" on public.posts for insert to authenticated
  with check (user_id = (select auth.uid()) and not public.is_banned()
    and (category <> '공지' or public.is_staff()));
create policy "posts delete own" on public.posts for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());
create policy "comments member insert" on public.comments for insert to authenticated
  with check (user_id = (select auth.uid()) and not public.is_banned());
create policy "comments delete own" on public.comments for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());

-- 기사: 서식 있는 본문, 기자명, 사진 설명, 메인 배치 자리, 수정 시각
alter table public.articles add column if not exists format text not null default 'text';
alter table public.articles add column if not exists author_id uuid references auth.users(id) on delete set null;
alter table public.articles add column if not exists author_name text;
alter table public.articles add column if not exists image_caption text;
alter table public.articles add column if not exists main_slot smallint check (main_slot between 1 and 3);
alter table public.articles add column if not exists updated_at timestamptz;
create unique index if not exists articles_main_slot_idx on public.articles (main_slot) where main_slot is not null;

create or replace function public.article_meta()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := (select auth.uid());
    if coalesce(trim(new.author_name), '') = '' then
      new.author_name := (select nullif(p.nickname, '') from public.profiles p where p.id = (select auth.uid()));
    end if;
    new.main_slot := null;
  elsif new.title is distinct from old.title or new.body is distinct from old.body
     or new.summary is distinct from old.summary or new.image_url is distinct from old.image_url then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists article_meta on public.articles;
create trigger article_meta before insert or update on public.articles
  for each row execute function public.article_meta();

drop policy if exists "articles admin insert" on public.articles;
drop policy if exists "articles admin update" on public.articles;
drop policy if exists "articles admin delete" on public.articles;
drop policy if exists "articles staff insert" on public.articles;
drop policy if exists "articles staff update" on public.articles;
drop policy if exists "articles staff delete" on public.articles;
create policy "articles staff insert" on public.articles for insert to authenticated
  with check (public.is_staff());
create policy "articles staff update" on public.articles for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "articles staff delete" on public.articles for delete to authenticated
  using (public.is_staff());

-- 메인 배치: 1=큰 기사, 2·3=옆 기사. 한 자리에 한 기사만
create or replace function public.set_main_slot(aid bigint, slot integer)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_staff() then raise exception '권한이 없습니다'; end if;
  if slot is not null and (slot < 1 or slot > 3) then raise exception '잘못된 자리입니다'; end if;
  update public.articles set main_slot = null
    where id = aid or (slot is not null and main_slot = slot);
  if slot is not null then
    update public.articles set main_slot = slot where id = aid;
  end if;
end;
$$;
revoke all on function public.set_main_slot(bigint, integer) from public, anon;
grant execute on function public.set_main_slot(bigint, integer) to authenticated;

-- 사진 올리기: 기자·관리자
drop policy if exists "images admin upload" on storage.objects;
drop policy if exists "images staff upload" on storage.objects;
create policy "images staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and public.is_staff());
