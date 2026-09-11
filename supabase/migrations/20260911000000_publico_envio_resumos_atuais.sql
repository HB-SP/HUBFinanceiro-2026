-- ─── publico_envio: resumos sempre alinhados às notas vivas ──────────────────
-- A página pública #envio/<token> lê o envio por esta RPC. O envio guarda uma
-- CÓPIA de cada nota; se a nota foi corrigida depois (nº, data, valor, anexo),
-- a cópia ficava velha e o Portal mostrava dado errado ou escondia o download
-- (só aparece quando o resumo diz hasFile=true). Casos reais em 10-11/09/2026.
-- Agora a RPC devolve cada resumo mesclado com a nota atual (nº, código,
-- fornecedor, valor, data de emissão) e com a existência REAL do arquivo (linha
-- nf_file_<id>). Campos descritivos (categoria, mês, serviços, jogo) ficam como
-- no envio — ele é o registro do que foi enviado à entidade. Mesmo critério do
-- espelho no Hub (src/lib/sincronizarEnvios.js). Só leitura; nada é gravado.

create or replace function public.envio_resumos_atuais(e jsonb, p_prefix text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb; n jsonb;
  out_n jsonb := '[]'; out_m jsonb := '[]'; out_l jsonb := '[]';
  tem_arq boolean;
begin
  -- notasResumo ← <prefix>notas
  for r in select x from jsonb_array_elements(coalesce(e->'notasResumo','[]')) x loop
    select x into n from public.app_state s, jsonb_array_elements(s.value) x where s.key = p_prefix||'notas' and x->>'id' = r->>'id' limit 1;
    if n is not null then
      r := r || jsonb_strip_nulls(jsonb_build_object('codigo', n->'codigo', 'fornecedor', n->'fornecedor', 'valorNF', n->'valorNF', 'numeroNF', n->'numeroNF', 'dataEmissao', n->'dataEmissao'));
    end if;
    select exists(select 1 from public.app_state f where f.key = 'nf_file_'||(r->>'id')) into tem_arq;
    out_n := out_n || (r || jsonb_build_object('hasFile', tem_arq));
  end loop;
  -- mensaisResumo ← <prefix>notas_mensais
  for r in select x from jsonb_array_elements(coalesce(e->'mensaisResumo','[]')) x loop
    select x into n from public.app_state s, jsonb_array_elements(s.value) x where s.key = p_prefix||'notas_mensais' and x->>'id' = r->>'id' limit 1;
    if n is not null then
      r := r || jsonb_strip_nulls(jsonb_build_object('fornecedor', n->'fornecedor', 'valor', n->'valor', 'numeroNF', n->'numeroNF', 'dataEmissao', n->'dataEmissao'));
    end if;
    select exists(select 1 from public.app_state f where f.key = 'nf_file_'||(r->>'id')) into tem_arq;
    out_m := out_m || (r || jsonb_build_object('hasFile', tem_arq));
  end loop;
  -- livemodeResumo ← <prefix>notas_livemode | <prefix>notas_liveu | reembolso em <prefix>notas (valor = valorNF)
  for r in select x from jsonb_array_elements(coalesce(e->'livemodeResumo','[]')) x loop
    select x into n from public.app_state s, jsonb_array_elements(s.value) x where s.key in (p_prefix||'notas_livemode', p_prefix||'notas_liveu') and x->>'id' = r->>'id' limit 1;
    if n is not null then
      r := r || jsonb_strip_nulls(jsonb_build_object('fornecedor', n->'fornecedor', 'valor', n->'valor', 'numeroNF', n->'numeroNF', 'dataEmissao', n->'dataEmissao'));
    else
      select x into n from public.app_state s, jsonb_array_elements(s.value) x where s.key = p_prefix||'notas' and x->>'id' = r->>'id' and x->>'tipo' = 'reembolso_livemode' limit 1;
      if n is not null then
        r := r || jsonb_strip_nulls(jsonb_build_object('codigo', n->'codigo', 'fornecedor', n->'fornecedor', 'valor', n->'valorNF', 'numeroNF', n->'numeroNF', 'dataEmissao', n->'dataEmissao'));
      end if;
    end if;
    select exists(select 1 from public.app_state f where f.key = 'nf_file_'||(r->>'id')) into tem_arq;
    out_l := out_l || (r || jsonb_build_object('hasFile', tem_arq));
  end loop;
  return e || jsonb_build_object('notasResumo', out_n, 'mensaisResumo', out_m, 'livemodeResumo', out_l);
end $$;
revoke all on function public.envio_resumos_atuais(jsonb, text) from public, anon, authenticated;

create or replace function public.publico_envio(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('stateKey', s.key, 'envio', public.envio_resumos_atuais(e, regexp_replace(s.key, 'envios$', '')))
  from public.app_state s, jsonb_array_elements(s.value) e
  where (s.key = 'envios' or s.key like '%\_envios')
    and s.key not like '%::backup%'
    and jsonb_typeof(s.value) = 'array'
    and length(coalesce(p_token, '')) >= 8
    and e->>'publicToken' = p_token
  limit 1;
$$;
-- Rollback: recriar publico_envio como na migration 20260909100000 (sem envio_resumos_atuais).
