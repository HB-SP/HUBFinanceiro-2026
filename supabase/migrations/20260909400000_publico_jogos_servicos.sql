-- publico_jogos: o formulário público monta a lista de funções de cada jogo a
-- partir de quais serviços têm provisionado > 0. Como os VALORES não podem
-- sair, devolve só a lista de chaves (servicosDisponiveis), sem número.
create or replace function public.publico_jogos(p_key text default 'jogos')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
           (j - 'orcado' - 'provisionado' - 'realizado' - 'fechado' - 'fechadoEm'
              - 'divergencia' - 'nota_divergencia' - 'codigo_orcamento')
           || jsonb_build_object('servicosDisponiveis',
                coalesce((select jsonb_agg(p.key) from jsonb_each(coalesce(j->'provisionado', '{}'::jsonb)) p
                          where jsonb_typeof(p.value) = 'number' and (p.value)::numeric > 0), '[]'::jsonb))
         ), '[]'::jsonb)
  from public.app_state s, jsonb_array_elements(s.value) j
  where s.key = p_key and p_key in ('jogos', 'paulistao_jogos') and jsonb_typeof(s.value) = 'array';
$$;
