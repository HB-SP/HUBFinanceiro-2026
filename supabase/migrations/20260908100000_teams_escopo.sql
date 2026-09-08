-- Escopo de leitura do time dentro dos campeonatos:
--   notas    = visualizador vê só Notas Fiscais e Relatório (padrão; FFU/FPF)
--   completo = todo o hub em modo leitura (Livemode): todas as abas, sem editar
alter table public.teams add column if not exists escopo text not null default 'notas'
  check (escopo in ('notas','completo'));
update public.teams set escopo = 'completo' where nome = 'Livemode';
