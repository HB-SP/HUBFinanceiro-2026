-- ─── ADMINISTRAÇÃO DO PORTAL · fase 3: Acessos ───────────────────────────────
-- Agregados do audit_log por usuário (só admin), para a aba Acessos não
-- precisar baixar todos os eventos para o navegador.

-- Resumo por usuário no período: último login, contagens, dispositivos (por
-- user agent) com primeira/última vez vistos, IPs distintos, última atividade.
create or replace function public.admin_acessos_resumo(p_dias integer default 30)
returns table (
  user_id           uuid,
  ultimo_login      timestamptz,
  ultima_atividade  timestamptz,
  logins_periodo    integer,
  telas_periodo     integer,
  logins_total      integer,
  ips_distintos     integer,
  dispositivos      jsonb
)
language sql stable security definer set search_path = public as $$
  with ok as (select public.get_my_role() = 'admin' as e),
  desde as (select now() - make_interval(days => greatest(coalesce(p_dias, 30), 1)) as t),
  ev as (
    select a.user_id, a.action, a.created_at, a.details
    from public.audit_log a, ok
    where ok.e and a.user_id is not null
  ),
  disp as (
    select user_id,
           coalesce(details->>'user_agent', '') as ua,
           min(created_at) as first_seen, max(created_at) as last_seen, count(*)::int as n,
           (array_agg(details->>'ip' order by created_at desc))[1] as ip
    from ev where action = 'login'
    group by user_id, coalesce(details->>'user_agent', '')
  )
  select
    p.id as user_id,
    (select max(created_at) from ev where ev.user_id = p.id and action = 'login') as ultimo_login,
    (select max(created_at) from ev where ev.user_id = p.id) as ultima_atividade,
    (select count(*)::int from ev, desde where ev.user_id = p.id and action = 'login' and created_at >= desde.t) as logins_periodo,
    (select count(*)::int from ev, desde where ev.user_id = p.id and action = 'page_view' and created_at >= desde.t) as telas_periodo,
    (select count(*)::int from ev where ev.user_id = p.id and action = 'login') as logins_total,
    (select count(distinct details->>'ip')::int from ev where ev.user_id = p.id and action = 'login' and details->>'ip' is not null) as ips_distintos,
    coalesce((select jsonb_agg(jsonb_build_object('ua', d.ua, 'ip', d.ip, 'first_seen', d.first_seen, 'last_seen', d.last_seen, 'n', d.n) order by d.last_seen desc)
              from disp d where d.user_id = p.id), '[]'::jsonb) as dispositivos
  from public.profiles p, ok
  where ok.e;
$$;

-- Telas mais abertas no período (todo o hub) — label/tipo/id vêm do page_view.
create or replace function public.admin_acessos_top_telas(p_dias integer default 30, p_limite integer default 10)
returns table (label text, tipo text, id text, aberturas integer, usuarios integer)
language sql stable security definer set search_path = public as $$
  select coalesce(details->>'label', details->>'pagina', '—') as label,
         details->>'tipo' as tipo,
         details->>'id' as id,
         count(*)::int as aberturas,
         count(distinct user_id)::int as usuarios
  from public.audit_log
  where public.get_my_role() = 'admin'
    and action = 'page_view'
    and created_at >= now() - make_interval(days => greatest(coalesce(p_dias, 30), 1))
  group by 1, 2, 3
  order by aberturas desc
  limit greatest(coalesce(p_limite, 10), 1);
$$;

-- Logins por dia no período (para o gráfico de barras), opcionalmente de um usuário.
create or replace function public.admin_acessos_por_dia(p_dias integer default 30, p_user uuid default null)
returns table (dia date, logins integer, telas integer, usuarios integer)
language sql stable security definer set search_path = public as $$
  select (created_at at time zone 'America/Sao_Paulo')::date as dia,
         count(*) filter (where action = 'login')::int as logins,
         count(*) filter (where action = 'page_view')::int as telas,
         count(distinct user_id)::int as usuarios
  from public.audit_log
  where public.get_my_role() = 'admin'
    and user_id is not null
    and (p_user is null or user_id = p_user)
    and created_at >= now() - make_interval(days => greatest(coalesce(p_dias, 30), 1))
  group by 1 order by 1;
$$;

grant execute on function public.admin_acessos_resumo(integer) to authenticated;
grant execute on function public.admin_acessos_top_telas(integer, integer) to authenticated;
grant execute on function public.admin_acessos_por_dia(integer, uuid) to authenticated;
