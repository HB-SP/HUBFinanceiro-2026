-- ─── publico_envio: espelho completo da nota (organismo único) ───────────────
-- Complemento da 20260911000000. Decisão do financeiro (11/09/2026): a nota é um
-- organismo único — o que muda nela muda no envio e no Portal. Além de nº,
-- código, fornecedor, valor e emissão, o resumo passa a refletir também
-- categoria, mês, rótulos de serviço, jogo e rodada da nota atual. Dados de
-- pagamento (statusNota, pago, dataPagamento, pagoPor) continuam do envio.
-- Só leitura; nada é gravado. Mesmo critério de src/lib/sincronizarEnvios.js.

create or replace function public.envio_resumos_atuais(e jsonb, p_prefix text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb; n jsonb;
  out_n jsonb := '[]'; out_m jsonb := '[]'; out_l jsonb := '[]';
  tem_arq boolean;
begin
  for r in select x from jsonb_array_elements(coalesce(e->'notasResumo','[]')) x loop
    select x into n from public.app_state s, jsonb_array_elements(s.value) x where s.key = p_prefix||'notas' and x->>'id' = r->>'id' limit 1;
    if n is not null then
      r := r || jsonb_strip_nulls(jsonb_build_object('codigo', n->'codigo', 'fornecedor', n->'fornecedor', 'valorNF', n->'valorNF', 'numeroNF', n->'numeroNF',
                 'jogoLabel', n->'jogoLabel', 'rodada', n->'rodada', 'servicosLabels', n->'servicosLabels', 'dataEmissao', n->'dataEmissao'));
    end if;
    select exists(select 1 from public.app_state f where f.key = 'nf_file_'||(r->>'id')) into tem_arq;
    out_n := out_n || (r || jsonb_build_object('hasFile', tem_arq));
  end loop;
  for r in select x from jsonb_array_elements(coalesce(e->'mensaisResumo','[]')) x loop
    select x into n from public.app_state s, jsonb_array_elements(s.value) x where s.key = p_prefix||'notas_mensais' and x->>'id' = r->>'id' limit 1;
    if n is not null then
      r := r || jsonb_strip_nulls(jsonb_build_object('fornecedor', n->'fornecedor', 'valor', n->'valor', 'numeroNF', n->'numeroNF',
                 'categoria', n->'categoria', 'mesLabel', n->'mesLabel', 'dataEmissao', n->'dataEmissao'));
    end if;
    select exists(select 1 from public.app_state f where f.key = 'nf_file_'||(r->>'id')) into tem_arq;
    out_m := out_m || (r || jsonb_build_object('hasFile', tem_arq));
  end loop;
  for r in select x from jsonb_array_elements(coalesce(e->'livemodeResumo','[]')) x loop
    select x into n from public.app_state s, jsonb_array_elements(s.value) x where s.key in (p_prefix||'notas_livemode', p_prefix||'notas_liveu') and x->>'id' = r->>'id' limit 1;
    if n is not null then
      r := r || jsonb_strip_nulls(jsonb_build_object('fornecedor', n->'fornecedor', 'valor', n->'valor', 'numeroNF', n->'numeroNF',
                 'rodada', n->'rodada', 'rodadas', n->'rodadas', 'rodadasLabel', n->'rodadasLabel', 'servicosLabels', n->'servicosLabels', 'dataEmissao', n->'dataEmissao'));
    else
      select x into n from public.app_state s, jsonb_array_elements(s.value) x where s.key = p_prefix||'notas' and x->>'id' = r->>'id' and x->>'tipo' = 'reembolso_livemode' limit 1;
      if n is not null then
        r := r || jsonb_strip_nulls(jsonb_build_object('codigo', n->'codigo', 'fornecedor', n->'fornecedor', 'valor', n->'valorNF', 'numeroNF', n->'numeroNF',
                   'rodada', n->'rodada', 'rodadas', n->'rodadas', 'rodadasLabel', n->'rodadasLabel', 'jogoLabel', n->'jogoLabel', 'servicosLabels', n->'servicosLabels', 'dataEmissao', n->'dataEmissao'));
      end if;
    end if;
    select exists(select 1 from public.app_state f where f.key = 'nf_file_'||(r->>'id')) into tem_arq;
    out_l := out_l || (r || jsonb_build_object('hasFile', tem_arq));
  end loop;
  return e || jsonb_build_object('notasResumo', out_n, 'mensaisResumo', out_m, 'livemodeResumo', out_l);
end $$;
-- Rollback: reaplicar a versão da migration 20260911000000.
