-- ─── ADMINISTRAÇÃO DO PORTAL · fase 4: Configurações ─────────────────────────
-- Configurações do portal em chave/valor (jsonb). Logado lê; admin escreve.
-- Anon lê só o que a tela de cadastro precisa (texto LGPD e entidades).
create table if not exists public.portal_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.portal_settings enable row level security;
drop policy if exists "settings: logado le" on public.portal_settings;
create policy "settings: logado le" on public.portal_settings
  for select using (auth.role() = 'authenticated' or key in ('lgpd', 'entidades_extras'));
drop policy if exists "settings: admin escreve" on public.portal_settings;
create policy "settings: admin escreve" on public.portal_settings
  for all using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

drop trigger if exists portal_settings_set_updated_at on public.portal_settings;
create trigger portal_settings_set_updated_at before update on public.portal_settings
  for each row execute function public.trg_set_updated_at();

-- Semente (não sobrescreve se já existir)
insert into public.portal_settings (key, value) values
  ('entidades_extras', '[]'::jsonb),
  ('signup', jsonb_build_object(
      'bloquear_desconhecidos', false,          -- true ⇒ só domínios dos times ou da lista abaixo podem se cadastrar
      'dominios_permitidos', '[]'::jsonb,      -- além dos domínios dos times
      'google_dominios', '["livemode.com"]'::jsonb)),
  ('lgpd', jsonb_build_object('itens', jsonb_build_array(
      jsonb_build_object('titulo', 'Dados coletados', 'texto', 'nome completo, e-mail, função e entidade vinculada.'),
      jsonb_build_object('titulo', 'Finalidade',      'texto', 'controle de acesso ao HUB Financeiro Livemode.'),
      jsonb_build_object('titulo', 'Compartilhamento','texto', 'os dados não são compartilhados com terceiros fora da operação do HUB.'),
      jsonb_build_object('titulo', 'Segurança',       'texto', 'dados armazenados com criptografia em repouso e em trânsito (TLS 1.2+), com controle de acesso baseado em perfis.'),
      jsonb_build_object('titulo', 'Seus direitos',   'texto', 'você pode pedir acesso, correção ou exclusão dos seus dados a um administrador do HUB.')
    ))),
  ('audit', jsonb_build_object('retencao_dias', 365, 'ultima_limpeza', null))
on conflict (key) do nothing;

-- Domínios que podem se cadastrar: times + lista das configurações
create or replace function public.dominio_permitido(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  with s as (select value from public.portal_settings where key = 'signup'),
       dom as (select lower(split_part(p_email, '@', 2)) d)
  select
    coalesce((select not (value->>'bloquear_desconhecidos')::boolean from s), true)
    or exists (select 1 from public.teams t, dom where dom.d = any (select lower(x) from unnest(t.dominios) x))
    or exists (select 1 from s, dom where dom.d in (select lower(jsonb_array_elements_text(s.value->'dominios_permitidos'))));
$$;

-- Bloqueio no cadastro (antes de criar o usuário no Auth)
create or replace function public.bloquear_cadastro_dominio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and not public.dominio_permitido(new.email) then
    raise exception 'Cadastro não permitido para o domínio %', split_part(new.email, '@', 2)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists before_auth_user_created_dominio on auth.users;
create trigger before_auth_user_created_dominio before insert on auth.users
  for each row execute function public.bloquear_cadastro_dominio();

-- Retenção do audit log: apaga eventos mais antigos que retencao_dias.
-- p_dry_run = true só conta. Só admin. (Sem pg_cron neste projeto: roda pela tela.)
create or replace function public.audit_log_purge(p_dry_run boolean default true)
returns table (antigos integer, retencao_dias integer, apagados integer)
language plpgsql security definer set search_path = public as $$
declare
  v_dias integer;
  v_antigos integer;
  v_apagados integer := 0;
begin
  if public.get_my_role() <> 'admin' then raise exception 'Unauthorized'; end if;
  select coalesce((value->>'retencao_dias')::integer, 365) into v_dias from public.portal_settings where key = 'audit';
  v_dias := greatest(coalesce(v_dias, 365), 30);
  select count(*) into v_antigos from public.audit_log where created_at < now() - make_interval(days => v_dias);
  if not p_dry_run then
    delete from public.audit_log where created_at < now() - make_interval(days => v_dias);
    get diagnostics v_apagados = row_count;
    update public.portal_settings set value = value || jsonb_build_object('ultima_limpeza', now()), updated_by = auth.uid() where key = 'audit';
  end if;
  return query select v_antigos, v_dias, v_apagados;
end;
$$;
grant execute on function public.audit_log_purge(boolean) to authenticated;
grant execute on function public.dominio_permitido(text) to anon, authenticated;
