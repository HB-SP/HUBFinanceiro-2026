-- ─── ADMINISTRAÇÃO DO PORTAL · fase 1: Times + Audit log de acesso ───────────
-- Times agrupam usuários por domínio de e-mail e definem o que o time vê
-- (entidades, módulos) e como um cadastro novo entra (papel padrão, aprovação
-- automática). Login passa a ser registrado no audit_log por trigger na criação
-- da sessão (auth.sessions) — funciona mesmo fora do app.

-- 1) Times
create table if not exists public.teams (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null unique,
  cor                   text not null default '#65B32E',
  dominios              text[] not null default '{}',          -- ex.: {livemode.com}
  role_padrao           text not null default 'visualizador'
                        check (role_padrao in ('admin','visualizador','fornecedor','pendente')),
  aprovacao_automatica  boolean not null default false,        -- domínio casou ⇒ entra direto com role_padrao
  entidades             text[] not null default '{}',          -- ids de ENTIDADES_VISUALIZADOR (brasileirao-2026, paulistao-feminino-2026, outro)
  modulos               text[] not null default '{}',          -- módulos transversais liberados ao visualizador: orcamentos, fornecedores
  descricao             text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists teams_nome_lower_idx on public.teams (lower(nome));

alter table public.profiles add column if not exists team_id uuid references public.teams(id) on delete set null;
create index if not exists profiles_team_id_idx on public.profiles (team_id);

drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at before update on public.teams
  for each row execute function public.trg_set_updated_at();

alter table public.teams enable row level security;
drop policy if exists "teams: logado le" on public.teams;
create policy "teams: logado le" on public.teams
  for select using (auth.role() = 'authenticated');
drop policy if exists "teams: admin escreve" on public.teams;
create policy "teams: admin escreve" on public.teams
  for all using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- 2) Time pelo domínio do e-mail (usado no cadastro e disponível ao app)
create or replace function public.team_por_email(p_email text)
returns public.teams
language sql stable security definer set search_path = public as $$
  select t.* from public.teams t
  where lower(split_part(p_email, '@', 2)) = any (select lower(d) from unnest(t.dominios) d)
  order by t.created_at limit 1;
$$;

-- 3) Cadastro novo: casa o domínio com um time; aprovação automática ⇒ entra
--    com o papel padrão e as entidades do time; senão fica pendente (como hoje).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.teams;
  v_role text := 'pendente';
  v_entidade text := new.raw_user_meta_data->>'entidade';
begin
  select * into t from public.team_por_email(new.email);
  if t.id is not null then
    if t.aprovacao_automatica then
      v_role := t.role_padrao;
      if coalesce(array_length(t.entidades, 1), 0) > 0 then
        v_entidade := array_to_string(t.entidades, ',');
      end if;
    end if;
  end if;
  insert into public.profiles (id, email, role, nome, funcao, entidade, team_id)
  values (new.id, new.email, v_role, new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'funcao', v_entidade, t.id)
  on conflict (id) do update set
    email    = excluded.email,
    nome     = coalesce(excluded.nome, profiles.nome),
    funcao   = coalesce(excluded.funcao, profiles.funcao),
    entidade = coalesce(excluded.entidade, profiles.entidade),
    team_id  = coalesce(profiles.team_id, excluded.team_id);
  return new;
exception when others then
  return new;
end;
$$;

-- 4) Login no audit_log: toda sessão nova em auth.sessions vira uma linha 'login'
--    com navegador e IP. Logout e navegação são registrados pelo app via
--    log_audit_action (page_view / logout).
create or replace function public.audit_login_from_session()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (user_id, action, target_user_id, details)
  values (new.user_id, 'login', null,
          jsonb_build_object('session_id', new.id, 'user_agent', new.user_agent, 'ip', new.ip::text, 'aal', new.aal));
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists on_auth_session_created on auth.sessions;
create trigger on_auth_session_created after insert on auth.sessions
  for each row execute function public.audit_login_from_session();

-- 5) Índices para a linha do tempo
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_user_id_idx on public.audit_log (user_id, created_at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, created_at desc);

-- 6) Semente: times já evidentes nos perfis existentes
insert into public.teams (nome, cor, dominios, role_padrao, aprovacao_automatica, entidades, modulos, descricao) values
  ('Livemode', '#65B32E', '{livemode.com}', 'visualizador', false, '{outro}', '{orcamentos,fornecedores}', 'Equipe interna Livemode'),
  ('FFU',      '#FACC15', '{cforteuniao.com}', 'visualizador', false, '{brasileirao-2026}', '{orcamentos}', 'Futebol Forte União — Brasileirão'),
  ('FPF',      '#DC2626', '{}', 'visualizador', false, '{paulistao-feminino-2026}', '{orcamentos}', 'Federação Paulista de Futebol — Paulistão')
on conflict (nome) do nothing;

update public.profiles p set team_id = t.id
from public.teams t
where p.team_id is null and p.email is not null
  and lower(split_part(p.email, '@', 2)) = any (select lower(d) from unnest(t.dominios) d);
