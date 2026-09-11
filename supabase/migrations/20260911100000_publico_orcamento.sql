-- ─── ORÇAMENTO: link externo de visualização ─────────────────────────────────
-- Mesmo desenho do envio público (#envio/<token>): o admin gera um token no Hub
-- (fica em orc_<id>.meta.publicToken) e a página #orcamento/<token> lê o
-- documento por esta RPC, sem login. Só leitura; só o orçamento daquele token;
-- revogar = apagar o token no Hub e a página deixa de abrir.
-- A página consulta a cada poucos segundos: qualquer edição no Hub aparece na
-- apresentação quase em tempo real (o documento tem ~10 KB).

create or replace function public.publico_orcamento(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select s.value
  from public.app_state s
  where s.key like 'orc\_%'
    and s.key not like '%\_eventos'
    and s.key not like '%::backup%'
    and s.key <> 'orc_registry'
    and jsonb_typeof(s.value) = 'object'
    and length(coalesce(p_token, '')) >= 16
    and s.value->'meta'->>'publicToken' = p_token
  limit 1;
$$;
grant execute on function public.publico_orcamento(text) to anon, authenticated;
-- Rollback: drop function public.publico_orcamento(text);
