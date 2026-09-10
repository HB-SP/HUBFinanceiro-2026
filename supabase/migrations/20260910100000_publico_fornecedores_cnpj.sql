-- ─── publico_fornecedores: inclui o CNPJ ─────────────────────────────────────
-- O formulário público passou a ler o PDF anexado e avisa o fornecedor se o
-- CNPJ do emissor impresso não for o do fornecedor selecionado (anexo trocado).
-- CNPJ é dado cadastral público da empresa; CPF/RG/telefone/e-mail continuam
-- fora. Só muda a RPC; nenhum dado é alterado.
create or replace function public.publico_fornecedores(p_key text default 'fornecedores')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f->'id', 'nome', f->'nome', 'apelido', f->'apelido', 'razaoSocial', f->'razaoSocial',
           'funcao', f->'funcao', 'tipo', f->'tipo', 'area', f->'area', 'cnpj', f->'cnpj')), '[]'::jsonb)
  from public.app_state s, jsonb_array_elements(s.value) f
  where s.key = p_key and p_key in ('fornecedores', 'paulistao_fornecedores') and jsonb_typeof(s.value) = 'array';
$$;
-- Rollback: rodar a versão da migration 20260909100000 (sem 'cnpj').
