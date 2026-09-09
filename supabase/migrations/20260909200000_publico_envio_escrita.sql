-- ─── PÁGINA PÚBLICA DO ENVIO · escritas via token (passo 2) ──────────────────
-- A página #envio/<chave>:<token> marca o envio como pago e muda o status de
-- notas. Hoje faz isso reescrevendo a lista inteira de envios com a escrita
-- anônima direta. Estas funções fazem SÓ a alteração do envio cujo token bate,
-- no servidor, sem apagar nada; antes de alterar guardam a versão anterior da
-- lista em '<chave>::backup::publico'.
create or replace function public.publico_envio_backup(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_state (key, value, updated_at)
  select p_key || '::backup::publico', jsonb_build_object('at', now(), 'value', value), now()
    from public.app_state where key = p_key
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.publico_envio_backup(text) from public;

-- Marca o envio como pago (todas as notas → "Pago"), com nome de quem confirmou.
create or replace function public.publico_envio_marcar_pago(p_token text, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key text; v_idx integer; v_env jsonb; v_agora timestamptz := now();
  v_marca jsonb := jsonb_build_object('statusNota', 'Pago', 'statusAlteradoEm', to_char(v_agora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'statusAlteradoPor', nullif(trim(p_nome), ''));
begin
  if length(coalesce(p_token, '')) < 8 then return null; end if;
  select s.key, (o.ord - 1)::integer, o.e into v_key, v_idx, v_env
    from public.app_state s, jsonb_array_elements(s.value) with ordinality o(e, ord)
   where (s.key = 'envios' or s.key like '%\_envios') and s.key not like '%::backup%'
     and jsonb_typeof(s.value) = 'array' and o.e->>'publicToken' = p_token
   limit 1;
  if v_key is null then return null; end if;
  perform public.publico_envio_backup(v_key);
  v_env := v_env || jsonb_build_object(
    'pago', true,
    'pagoEm', to_char(v_agora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'pagoPor', nullif(trim(p_nome), ''),
    'dataPagamentoEfetiva', to_char(v_agora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
    'notasResumo',    coalesce((select jsonb_agg(n || v_marca) from jsonb_array_elements(coalesce(v_env->'notasResumo','[]')) n), '[]'::jsonb),
    'mensaisResumo',  coalesce((select jsonb_agg(n || v_marca) from jsonb_array_elements(coalesce(v_env->'mensaisResumo','[]')) n), '[]'::jsonb),
    'livemodeResumo', coalesce((select jsonb_agg(n || v_marca) from jsonb_array_elements(coalesce(v_env->'livemodeResumo','[]')) n), '[]'::jsonb));
  update public.app_state set value = jsonb_set(value, array[v_idx::text], v_env), updated_at = now() where key = v_key;
  return jsonb_build_object('stateKey', v_key, 'envio', v_env);
end;
$$;

-- Muda o status de UMA nota do envio (campo: notasResumo | mensaisResumo | livemodeResumo).
create or replace function public.publico_envio_status_nota(p_token text, p_campo text, p_nota_id text, p_status text, p_nome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key text; v_idx integer; v_env jsonb; v_lista jsonb;
  v_marca jsonb := jsonb_build_object('statusNota', p_status, 'statusAlteradoEm', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'statusAlteradoPor', nullif(trim(p_nome), ''));
begin
  if length(coalesce(p_token, '')) < 8 then return null; end if;
  if p_campo not in ('notasResumo', 'mensaisResumo', 'livemodeResumo') then raise exception 'campo inválido'; end if;
  if p_status not in ('Pendente', 'Em sistema', 'Pago', 'Alteração') then raise exception 'status inválido'; end if;
  if nullif(trim(p_nome), '') is null then raise exception 'informe quem alterou'; end if;
  select s.key, (o.ord - 1)::integer, o.e into v_key, v_idx, v_env
    from public.app_state s, jsonb_array_elements(s.value) with ordinality o(e, ord)
   where (s.key = 'envios' or s.key like '%\_envios') and s.key not like '%::backup%'
     and jsonb_typeof(s.value) = 'array' and o.e->>'publicToken' = p_token
   limit 1;
  if v_key is null then return null; end if;
  perform public.publico_envio_backup(v_key);
  select coalesce(jsonb_agg(case when n->>'id' = p_nota_id then n || v_marca else n end), '[]'::jsonb)
    into v_lista from jsonb_array_elements(coalesce(v_env->p_campo, '[]')) n;
  v_env := jsonb_set(v_env, array[p_campo], v_lista);
  update public.app_state set value = jsonb_set(value, array[v_idx::text], v_env), updated_at = now() where key = v_key;
  return jsonb_build_object('stateKey', v_key, 'envio', v_env);
end;
$$;

revoke all on function public.publico_envio_marcar_pago(text, text) from public;
revoke all on function public.publico_envio_status_nota(text, text, text, text, text) from public;
grant execute on function public.publico_envio_marcar_pago(text, text) to anon, authenticated;
grant execute on function public.publico_envio_status_nota(text, text, text, text, text) to anon, authenticated;
