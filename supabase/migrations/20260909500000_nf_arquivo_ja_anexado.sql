-- Um mesmo PDF anexado em notas de fornecedores diferentes = anexo trocado
-- (casos OneSolve 492 / Conecta 202648 / Hispasat / Guilherme Sanches 121, 09/09/2026).
-- Esta função devolve, para um fileHash (SHA-256 do dataUrl, o mesmo que o app
-- grava em nota.fileHash), todas as notas que já têm esse arquivo — em todas as
-- listas de notas (por jogo, mensais, Livemode, de qualquer campeonato).
create or replace function public.nf_arquivo_ja_anexado(p_hash text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'lista', s.key, 'id', n->>'id', 'fornecedor', n->>'fornecedor', 'numeroNF', n->>'numeroNF',
           'codigo', n->>'codigo', 'jogoLabel', n->>'jogoLabel', 'mesLabel', n->>'mesLabel',
           'valor', coalesce(n->>'valorNF', n->>'valor'))), '[]'::jsonb)
  from public.app_state s, jsonb_array_elements(s.value) n
  where length(coalesce(p_hash, '')) >= 32
    and s.key not like '%::backup%'
    and (s.key in ('notas','notas_mensais','notas_livemode','notas_liveu')
         or s.key like '%\_notas' or s.key like '%\_notas\_mensais' or s.key like '%\_notas\_livemode' or s.key like '%\_notas\_liveu')
    and jsonb_typeof(s.value) = 'array'
    and n->>'fileHash' = p_hash;
$$;
revoke all on function public.nf_arquivo_ja_anexado(text) from public, anon;
grant execute on function public.nf_arquivo_ja_anexado(text) to authenticated;
