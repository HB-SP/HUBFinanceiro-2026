-- ─── nf_arquivo_ja_anexado: de 25 s para milissegundos ────────────────────────
-- Sintoma (14/09/2026): ao anexar uma nota na rodada, a trava de "PDF já anexado
-- em outra nota" estourava o timeout de 20 s do Hub e mostrava erro.
-- Causa: o planner avaliava jsonb_typeof(value) ANTES do filtro por chave e, com
-- isso, descompactava o `value` de TODAS as ~1.600 linhas do app_state — inclusive
-- os 1.221 PDFs em base64 (~227 MB) — a cada chamada (Seq Scan, 36 mil buffers).
-- Fix: CTE materializada escolhe as chaves das listas de notas olhando só `key`
-- (sem tocar em value); só depois entra no jsonb das ~20 linhas que interessam.
-- Mesmo contrato e mesmo retorno da versão anterior (20260909500000).

create or replace function public.nf_arquivo_ja_anexado(p_hash text)
returns jsonb language sql stable security definer set search_path = public as $$
  with chaves as materialized (
    select key
    from public.app_state
    where key not like '%::backup%'
      and (key in ('notas','notas_mensais','notas_livemode','notas_liveu')
           or key like '%\_notas' or key like '%\_notas\_mensais'
           or key like '%\_notas\_livemode' or key like '%\_notas\_liveu')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'lista', s.key, 'id', n->>'id', 'fornecedor', n->>'fornecedor', 'numeroNF', n->>'numeroNF',
           'codigo', n->>'codigo', 'jogoLabel', n->>'jogoLabel', 'mesLabel', n->>'mesLabel',
           'valor', coalesce(n->>'valorNF', n->>'valor'))), '[]'::jsonb)
  from chaves c
  join public.app_state s on s.key = c.key
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) n
  where length(coalesce(p_hash, '')) >= 32
    and n->>'fileHash' = p_hash;
$$;
-- Rollback: reaplicar a versão da migration 20260909500000.
