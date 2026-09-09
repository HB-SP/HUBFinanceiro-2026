-- ─── FECHAR A LEITURA ANÔNIMA DO app_state (passo 3) ─────────────────────────
-- Só muda REGRAS de acesso; nenhum dado é apagado ou alterado.
-- Antes: anon lia fornecedores (com CPF/RG), jogos (valores), envios e todos os
-- nf_file_* (PDFs). Agora as telas públicas usam as RPCs publico_* (passo 2),
-- então o anon deixa de ler essas chaves. Fica só o que o formulário de NF
-- ainda grava e as tabelas de fornecedores (sem dado pessoal), por segurança
-- de não quebrar fluxo antigo.
--
-- Rollback (reabrir exatamente como era): rodar os dois CREATE OR REPLACE do
-- bloco "VERSÃO ANTERIOR" ao final deste arquivo.

create or replace function public.app_state_anon_read(k text)
returns boolean language sql immutable as $$
  select k in ('forn_tabelas_preco', 'forn_campeonatos', 'forn_cidades')
      or public.app_state_anon_rw(k)
$$;

create or replace function public.app_state_anon_rw(k text)
returns boolean language sql immutable as $$
  select regexp_replace(k, '::backup.*$', '') in ('nf_submissions', 'paulistao_nf_submissions', 'forn_tabelas_preco')
$$;

-- INSERT de nf_file_* pelo anon continua (o formulário anexa o PDF); a LEITURA
-- de nf_file_* só pela RPC publico_nf_file(token, nota). As policies em si
-- não mudam — elas chamam estas duas funções.

-- ── VERSÃO ANTERIOR (rollback) ─────────────────────────────────────────────
-- create or replace function public.app_state_anon_read(k text) returns boolean language sql immutable as $$
--   select k in ('jogos','fornecedores','paulistao_jogos','paulistao_fornecedores',
--                'forn_tabelas_preco','forn_campeonatos','forn_cidades',
--                'nf_submissions','paulistao_nf_submissions','envios')
--       or k like '%\_envios' or k like 'nf\_file\_%' or public.app_state_anon_rw(k)
-- $$;
-- create or replace function public.app_state_anon_rw(k text) returns boolean language sql immutable as $$
--   select regexp_replace(k, '::backup.*$', '') in ('nf_submissions','paulistao_nf_submissions','forn_tabelas_preco','envios')
--       or regexp_replace(k, '::backup.*$', '') like '%\_envios'
-- $$;
