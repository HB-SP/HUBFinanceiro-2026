-- ─── FECHAR LEITURA/ESCRITA ANÔNIMA DAS TABELAS DE FORNECEDORES ──────────────
-- Só muda REGRAS de acesso; nenhum dado é apagado ou alterado.
--
-- forn_tabelas_preco (preços negociados), forn_campeonatos e forn_cidades eram
-- lidas pelo anon — e a tabela de preços até GRAVADA — por causa do link público
-- "fornecedor preenche sua tabela" (Fase C.2, abr/2026). Esse fluxo foi removido
-- na reformulação de 05/08/2026 (commit fc9f482, TabelaPrecoPublica.jsx apagado).
-- Hoje só o Hub de Fornecedores (usuário logado) usa essas chaves; os formulários
-- públicos de NF usam as RPCs publico_*; o Portal exige login. Verificado 10/09.
--
-- O que o anon ainda pode: ler/gravar nf_submissions e paulistao_nf_submissions
-- (fila do formulário) e INSERIR nf_file_* (anexo do formulário). Nada mais.
--
-- Rollback (reabrir exatamente como era): rodar o bloco "VERSÃO ANTERIOR" no fim.

create or replace function public.app_state_anon_read(k text)
returns boolean language sql immutable as $$
  select public.app_state_anon_rw(k)
$$;

create or replace function public.app_state_anon_rw(k text)
returns boolean language sql immutable as $$
  select regexp_replace(k, '::backup.*$', '') in ('nf_submissions', 'paulistao_nf_submissions')
$$;

-- As policies "app_state anon read/insert/update" não mudam — chamam estas funções.

-- ── VERSÃO ANTERIOR (rollback) ─────────────────────────────────────────────
-- create or replace function public.app_state_anon_read(k text) returns boolean language sql immutable as $$
--   select k in ('forn_tabelas_preco', 'forn_campeonatos', 'forn_cidades')
--       or public.app_state_anon_rw(k)
-- $$;
-- create or replace function public.app_state_anon_rw(k text) returns boolean language sql immutable as $$
--   select regexp_replace(k, '::backup.*$', '') in ('nf_submissions', 'paulistao_nf_submissions', 'forn_tabelas_preco')
-- $$;
