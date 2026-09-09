-- ─── CAMINHO PÚBLICO SEM PII (passo 1) ───────────────────────────────────────
-- Funções para os fluxos SEM login (formulários de NF e página #envio/<token>)
-- devolverem só o necessário. NADA é removido/alterado nos dados nem nas
-- policies atuais: o caminho antigo (leitura anônima direta do app_state)
-- continua valendo até as telas migrarem e o passo 3 fechá-lo.
-- Todas são SECURITY DEFINER (leem app_state como o dono) e STABLE.

-- 1) Fornecedores: só o que o autocomplete do formulário usa. Sem cpf/rg/cnpj/
--    telefone/email/preços.
create or replace function public.publico_fornecedores(p_key text default 'fornecedores')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f->'id', 'nome', f->'nome', 'apelido', f->'apelido', 'razaoSocial', f->'razaoSocial',
           'funcao', f->'funcao', 'tipo', f->'tipo', 'area', f->'area')), '[]'::jsonb)
  from public.app_state s, jsonb_array_elements(s.value) f
  where s.key = p_key and p_key in ('fornecedores', 'paulistao_fornecedores') and jsonb_typeof(s.value) = 'array';
$$;

-- 2) Jogos: sem colunas financeiras (orçado/provisionado/realizado, fechamento, divergência).
create or replace function public.publico_jogos(p_key text default 'jogos')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(j - 'orcado' - 'provisionado' - 'realizado' - 'fechado' - 'fechadoEm'
                              - 'divergencia' - 'nota_divergencia' - 'codigo_orcamento'), '[]'::jsonb)
  from public.app_state s, jsonb_array_elements(s.value) j
  where s.key = p_key and p_key in ('jogos', 'paulistao_jogos') and jsonb_typeof(s.value) = 'array';
$$;

-- 3) Envio pela chave pública: devolve SÓ o envio cujo publicToken bate (em
--    'envios' ou em qualquer '<camp>_envios'), com a chave de origem.
--    Token vazio/curto nunca casa.
create or replace function public.publico_envio(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('stateKey', s.key, 'envio', e)
  from public.app_state s, jsonb_array_elements(s.value) e
  where (s.key = 'envios' or s.key like '%\_envios')
    and s.key not like '%::backup%'
    and jsonb_typeof(s.value) = 'array'
    and length(coalesce(p_token, '')) >= 8
    and e->>'publicToken' = p_token
  limit 1;
$$;

-- 4) Arquivo de NF só para quem tem o token do envio ao qual a nota pertence
--    (notasIds / mensaisIds / livemodeIds ou os *Resumo). Devolve o data URL.
create or replace function public.publico_nf_file(p_token text, p_nota_id text)
returns text language sql stable security definer set search_path = public as $$
  with env as (select (public.publico_envio(p_token))->'envio' e)
  select (select value #>> '{}' from public.app_state where key = 'nf_file_' || p_nota_id)
  from env
  where e is not null
    and exists (
      select 1 from jsonb_array_elements(coalesce(e->'notasIds','[]') || coalesce(e->'mensaisIds','[]') || coalesce(e->'livemodeIds','[]')) x
      where x #>> '{}' = p_nota_id
      union all
      select 1 from jsonb_array_elements(coalesce(e->'notasResumo','[]') || coalesce(e->'mensaisResumo','[]') || coalesce(e->'livemodeResumo','[]')) r
      where r->>'id' = p_nota_id
    );
$$;

revoke all on function public.publico_fornecedores(text) from public;
revoke all on function public.publico_jogos(text) from public;
revoke all on function public.publico_envio(text) from public;
revoke all on function public.publico_nf_file(text, text) from public;
grant execute on function public.publico_fornecedores(text) to anon, authenticated;
grant execute on function public.publico_jogos(text) to anon, authenticated;
grant execute on function public.publico_envio(text) to anon, authenticated;
grant execute on function public.publico_nf_file(text, text) to anon, authenticated;
