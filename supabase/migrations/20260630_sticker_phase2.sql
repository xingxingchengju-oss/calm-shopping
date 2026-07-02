-- Calm Shopping sticker achievement system phase 2.
begin;

do $$
begin
  if to_regclass('public.user_stats') is null then
    raise exception 'public.user_stats is required before the sticker migration';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='user_stats' and column_name='user_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='user_stats' and column_name='coins') then
    raise exception 'public.user_stats must contain user_id and coins';
  end if;
end $$;

create table if not exists public.sticker_definitions (
  sticker_id text primary key,
  source_type text not null check (source_type in ('default','achievement','shop','hybrid','hidden')),
  rarity text not null check (rarity in ('common','rare','epic','limited','hidden')),
  price integer check (price is null or price >= 0),
  unlock_rule jsonb not null default '{}'::jsonb,
  hidden boolean not null default false,
  active boolean not null default true
);

create table if not exists public.user_stickers (
  user_id uuid not null references auth.users(id) on delete cascade,
  sticker_id text not null references public.sticker_definitions(sticker_id),
  unlock_source text not null,
  obtained_at timestamptz not null default now(),
  is_new boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  primary key (user_id, sticker_id)
);

create table if not exists public.user_achievement_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  report_count integer not null default 0 check (report_count >= 0),
  pool_item_count integer not null default 0 check (pool_item_count >= 0),
  calm_decision_count integer not null default 0 check (calm_decision_count >= 0),
  purchase_cancel_count integer not null default 0 check (purchase_cancel_count >= 0),
  price_judgement_count integer not null default 0 check (price_judgement_count >= 0),
  sticker_purchase_count integer not null default 0 check (sticker_purchase_count >= 0),
  scene_save_count integer not null default 0 check (scene_save_count >= 0),
  daily_visit_count integer not null default 0 check (daily_visit_count >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.achievement_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, event_type, event_id)
);

create table if not exists public.user_scene_layouts (
  user_id uuid not null references auth.users(id) on delete cascade,
  scene_id text not null check (scene_id in ('scene_riverside','scene_room','scene_pool')),
  layout_json jsonb not null default '[]'::jsonb check (jsonb_typeof(layout_json) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (user_id, scene_id)
);

insert into public.sticker_definitions(sticker_id,source_type,rarity,price,unlock_rule,hidden) values
('sticker_begin_think','default','common',null,'{"kind":"default"}',false),
('sticker_first_calm','achievement','common',null,'{"stat":"report_count","gte":1}',false),
('sticker_put_pool','achievement','common',null,'{"stat":"pool_item_count","gte":1}',false),
('sticker_hold_buy','achievement','common',null,'{"stat":"purchase_cancel_count","gte":1}',false),
('sticker_price_detective','achievement','common',null,'{"stat":"price_judgement_count","gte":1}',false),
('sticker_need_check','achievement','rare',null,'{"stat":"report_count","gte":3}',false),
('sticker_wallet_guard','achievement','rare',null,'{"stat":"purchase_cancel_count","gte":3}',false),
('sticker_cooling','achievement','common',null,'{"stat":"scene_save_count","gte":1}',false),
('sticker_rational_start','achievement','rare',null,'{"stat":"owned_count","gte":5}',false),
('sticker_wait_more','shop','common',50,'{"kind":"purchase"}',false),
('sticker_today_safe','shop','rare',100,'{"kind":"purchase"}',false),
('sticker_let_go','hybrid','epic',180,'{"stat":"purchase_cancel_count","gte":5}',false)
on conflict (sticker_id) do update set
  source_type=excluded.source_type, rarity=excluded.rarity, price=excluded.price,
  unlock_rule=excluded.unlock_rule, hidden=excluded.hidden, active=true;

alter table public.sticker_definitions enable row level security;
alter table public.user_stickers enable row level security;
alter table public.user_achievement_stats enable row level security;
alter table public.achievement_events enable row level security;
alter table public.user_scene_layouts enable row level security;

drop policy if exists sticker_definitions_read on public.sticker_definitions;
create policy sticker_definitions_read on public.sticker_definitions for select using (true);
drop policy if exists user_stickers_read_own on public.user_stickers;
create policy user_stickers_read_own on public.user_stickers for select using (auth.uid() = user_id);
drop policy if exists achievement_stats_read_own on public.user_achievement_stats;
create policy achievement_stats_read_own on public.user_achievement_stats for select using (auth.uid() = user_id);
drop policy if exists achievement_events_read_own on public.achievement_events;
create policy achievement_events_read_own on public.achievement_events for select using (auth.uid() = user_id);
drop policy if exists scene_layouts_own on public.user_scene_layouts;
create policy scene_layouts_own on public.user_scene_layouts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public._sticker_payload(p_user uuid, p_new text[] default array[]::text[])
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'owned_ids', coalesce((select jsonb_agg(us.sticker_id order by us.obtained_at) from public.user_stickers us where us.user_id=p_user),'[]'::jsonb),
    'new_stickers', to_jsonb(coalesce(p_new,array[]::text[])),
    'stats', coalesce((select to_jsonb(s)-'user_id'-'updated_at' from public.user_achievement_stats s where s.user_id=p_user),'{}'::jsonb),
    'coins', coalesce((select coins from public.user_stats where user_id=p_user),0)
  );
$$;

create or replace function public._grant_eligible_stickers(p_user uuid)
returns text[] language plpgsql security definer set search_path=public,pg_temp as $$
declare
  d record; s public.user_achievement_stats%rowtype; threshold integer; current_value integer;
  added integer; pass integer; new_ids text[] := array[]::text[];
begin
  select * into s from public.user_achievement_stats where user_id=p_user;
  for pass in 1..4 loop
    added := 0;
    for d in select * from public.sticker_definitions where active and source_type in ('achievement','hybrid') order by sticker_id loop
      threshold := coalesce((d.unlock_rule->>'gte')::integer,2147483647);
      current_value := case d.unlock_rule->>'stat'
        when 'report_count' then s.report_count
        when 'pool_item_count' then s.pool_item_count
        when 'purchase_cancel_count' then s.purchase_cancel_count
        when 'price_judgement_count' then s.price_judgement_count
        when 'scene_save_count' then s.scene_save_count
        when 'owned_count' then (select count(*) from public.user_stickers where user_id=p_user)
        else -1 end;
      if current_value >= threshold then
        insert into public.user_stickers(user_id,sticker_id,unlock_source)
        values(p_user,d.sticker_id,'achievement') on conflict do nothing;
        if found then new_ids := array_append(new_ids,d.sticker_id); added := added+1; end if;
      end if;
    end loop;
    exit when added=0;
  end loop;
  return new_ids;
end $$;

create or replace function public.bootstrap_stickers()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid(); unseen text[];
begin
  if u is null then raise exception 'authentication required' using errcode='28000'; end if;
  insert into public.user_achievement_stats(user_id) values(u) on conflict do nothing;
  insert into public.user_stickers(user_id,sticker_id,unlock_source)
  select u,sticker_id,'default' from public.sticker_definitions where active and source_type='default'
  on conflict do nothing;
  select coalesce(array_agg(sticker_id order by obtained_at),array[]::text[]) into unseen
  from public.user_stickers where user_id=u and is_new;
  return public._sticker_payload(u,unseen);
end $$;

create or replace function public.record_sticker_event(p_event_type text,p_event_id text,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid(); inserted_count integer; new_ids text[] := array[]::text[];
begin
  if u is null then raise exception 'authentication required' using errcode='28000'; end if;
  if p_event_type not in ('report_generated','decision_saved','item_added_to_pool','purchase_cancelled','scene_saved','daily_visit') then
    raise exception 'unsupported sticker event';
  end if;
  if nullif(trim(p_event_id),'') is null then raise exception 'event id required'; end if;
  perform public.bootstrap_stickers();
  insert into public.achievement_events(user_id,event_type,event_id,metadata)
  values(u,p_event_type,p_event_id,coalesce(p_metadata,'{}'::jsonb)) on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count=1 then
    update public.user_achievement_stats set
      report_count=report_count+(p_event_type='report_generated')::integer,
      pool_item_count=pool_item_count+(p_event_type='item_added_to_pool')::integer,
      calm_decision_count=calm_decision_count+(p_event_type='decision_saved')::integer,
      purchase_cancel_count=purchase_cancel_count+(p_event_type='purchase_cancelled')::integer,
      price_judgement_count=price_judgement_count+
        ((p_event_type='report_generated') and coalesce((p_metadata->>'has_pricing')::boolean,false))::integer,
      scene_save_count=scene_save_count+(p_event_type='scene_saved')::integer,
      daily_visit_count=daily_visit_count+(p_event_type='daily_visit')::integer,
      updated_at=now() where user_id=u;
    new_ids := public._grant_eligible_stickers(u);
  end if;
  return public._sticker_payload(u,new_ids);
end $$;

create or replace function public.purchase_sticker(p_sticker_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid(); d public.sticker_definitions%rowtype; balance integer; new_ids text[] := array[]::text[]; cascaded text[];
begin
  if u is null then raise exception 'authentication required' using errcode='28000'; end if;
  perform public.bootstrap_stickers();
  select * into d from public.sticker_definitions where sticker_id=p_sticker_id and active for share;
  if not found or d.source_type not in ('shop','hybrid') or d.price is null then raise exception 'sticker is not purchasable'; end if;
  if exists(select 1 from public.user_stickers where user_id=u and sticker_id=p_sticker_id) then raise exception 'sticker already owned'; end if;
  select coins into balance from public.user_stats where user_id=u for update;
  if balance is null then raise exception 'user_stats row missing'; end if;
  if balance < d.price then raise exception 'insufficient coins'; end if;
  update public.user_stats set coins=coins-d.price where user_id=u;
  insert into public.user_stickers(user_id,sticker_id,unlock_source,metadata)
  values(u,p_sticker_id,'shop',jsonb_build_object('price',d.price));
  new_ids := array_append(new_ids,p_sticker_id);
  update public.user_achievement_stats set sticker_purchase_count=sticker_purchase_count+1,updated_at=now() where user_id=u;
  insert into public.achievement_events(user_id,event_type,event_id,metadata)
  values(u,'sticker_purchased',p_sticker_id,jsonb_build_object('price',d.price)) on conflict do nothing;
  cascaded := public._grant_eligible_stickers(u);
  new_ids := new_ids || cascaded;
  return public._sticker_payload(u,new_ids);
end $$;

create or replace function public.mark_stickers_seen(p_sticker_ids text[])
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'authentication required' using errcode='28000'; end if;
  update public.user_stickers set is_new=false where user_id=u and sticker_id=any(coalesce(p_sticker_ids,array[]::text[]));
  return true;
end $$;

revoke all on function public._sticker_payload(uuid,text[]) from public;
revoke all on function public._grant_eligible_stickers(uuid) from public;
grant execute on function public.bootstrap_stickers() to authenticated;
grant execute on function public.record_sticker_event(text,text,jsonb) to authenticated;
grant execute on function public.purchase_sticker(text) to authenticated;
grant execute on function public.mark_stickers_seen(text[]) to authenticated;

commit;
