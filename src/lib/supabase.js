import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://buubjnddzsadzcumrvdt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1dWJqbmRkenNhZHpjdW1ydmR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjQ3OTUsImV4cCI6MjA5MDIwMDc5NX0.mMEoVzmgdT1nHj1TLUWfhXzd4tcnzFad-HtF6TKPMw4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Se o backend parar de responder (projeto pausado, quota estourada, outage),
// o fetch fica pendurado pra sempre e o app trava no "Carregando..." sem nunca
// mostrar erro (incidente 2026-08-03). O timeout transforma isso num erro real,
// que cai nas telas de "Tentar novamente" existentes.
const REQUEST_TIMEOUT_MS = 20000;
const comTimeout = (promise, oQue) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(
    () => reject(new Error(`O servidor não respondeu em ${REQUEST_TIMEOUT_MS / 1000}s (${oQue}). Verifique o status do projeto Supabase.`)),
    REQUEST_TIMEOUT_MS
  )),
]);

export async function getState(key) {
  const { data, error } = await comTimeout(supabase.from('app_state').select('value').eq('key', key).single(), `ler ${key}`);
  if (error) {
    // PGRST116 = nenhuma linha encontrada: a key realmente não existe ainda, pode
    // seedar com defaults. Qualquer outro erro (rede, timeout, etc.) precisa
    // propagar — se engolirmos e devolvermos null aqui, quem chama confunde
    // "erro transitório" com "linha não existe" e sobrescreve dados reais com
    // defaults (incidente 2026-05-01, que se repetiu por essa mesma causa).
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data?.value ?? null;
}

const MAX_BACKUPS = 5; // slots rolling v0..v4 (rotação: o mais antigo é sobrescrito)

// Antes de qualquer escrita, guarda o valor ATUAL (o que está sendo substituído).
// É a rede de segurança contra o incidente de perda de dados de 2026-07: mesmo
// que um bug futuro grave o valor errado em `jogos`/`notas`/etc., a versão de
// imediatamente antes fica preservada e restaurável com restoreBackup(key).
//
// Formato (desde 2026-08): UMA LINHA POR VERSÃO, em vez da pilha antiga (uma
// linha única com 15 cópias completas). A pilha obrigava a ler e regravar todas
// as cópias a cada edição — foi o maior consumidor do Disk IO que derrubou o
// projeto em 2026-08-03/04. Agora:
//   • `key::backup::v0..v4` — últimas 5 versões, rotação pelo slot mais antigo.
//   • `key::backup::d0..d6` — snapshot diário (slot = dia da semana UTC), gravado
//     na 1ª escrita do dia; guarda o estado de "fim do dia anterior" por 7 dias.
// Decidir o slot usa um SELECT só de key+updated_at (sem carregar valores), e a
// rotação dispensa DELETE — custo por edição: 1 consulta barata + 1 cópia gravada.
// A pilha legada `key::backup` não é mais gravada, mas segue legível no
// getBackups até ser naturalmente irrelevante.
async function pushBackup(key, valorAtual) {
  if (key.startsWith('nf_file_') || key.includes('::backup')) return;
  try {
    const agora = new Date();
    const at = agora.toISOString();
    const { data } = await comTimeout(
      supabase.from('app_state').select('key, updated_at').like('key', `${key}::backup::%`),
      `listar backups de ${key}`
    );
    const rows = data || [];
    // Slot rolling: o primeiro vazio, senão o mais antigo.
    const slots = Array.from({ length: MAX_BACKUPS }, (_, i) => {
      const k = `${key}::backup::v${i}`;
      return { k, at: rows.find(r => r.key === k)?.updated_at || '' };
    });
    const alvo = slots.reduce((a, b) => (a.at <= b.at ? a : b));
    const entry = { at, value: valorAtual };
    const writes = [
      supabase.from('app_state').upsert({ key: alvo.k, value: entry, updated_at: at }, { onConflict: 'key' }),
    ];
    // Snapshot diário: grava só na primeira escrita do dia (UTC) deste key.
    const dKey = `${key}::backup::d${agora.getUTCDay()}`;
    const dAt = rows.find(r => r.key === dKey)?.updated_at || '';
    if (String(dAt).slice(0, 10) !== at.slice(0, 10)) {
      writes.push(supabase.from('app_state').upsert({ key: dKey, value: entry, updated_at: at }, { onConflict: 'key' }));
    }
    await Promise.all(writes.map(w => comTimeout(w, `gravar backup de ${key}`)));
  } catch (err) {
    console.error(`Falha ao gravar backup de "${key}" (a escrita principal segue mesmo assim):`, err);
  }
}

// ─── MODO LEITURA (visualizador com hub completo) ────────────────────────────
// Rede de segurança do lado do app: com o modo ligado, nenhuma escrita sai
// daqui — setters otimistas não mudam o estado local e as gravações viram um
// aviso no console. O banco já nega escrita de não-admin por RLS; isso evita a
// UI "andar" e depois voltar. Ligado pelo App conforme o papel efetivo.
let modoLeitura = false;
let avisouLeitura = false;
export function setModoLeitura(on) { modoLeitura = !!on; if (!on) avisouLeitura = false; }
export function emModoLeitura() { return modoLeitura; }
function bloqueadoPorLeitura(oQue) {
  if (!modoLeitura) return false;
  if (!avisouLeitura) { avisouLeitura = true; console.warn(`Modo leitura: ${oQue} ignorado (perfil visualizador).`); }
  return true;
}

export async function setState(key, value) {
  if (bloqueadoPorLeitura(`gravar ${key}`)) return;
  const atual = await getState(key).catch(() => null);
  if (atual != null) await pushBackup(key, atual);
  const { error } = await comTimeout(supabase.from('app_state').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' }), `gravar ${key}`);
  if (error) throw error;
}

// ─── OPERAÇÕES ATÔMICAS DE LISTA (RPC) ───────────────────────────────────────
// append/remove viram um UPDATE atômico no Postgres (migration
// 20260724000000_atomic_list_ops): escritas concorrentes serializam no lock de
// linha, então duas NFs chegando juntas (ou duas pessoas aprovando em paralelo)
// não se sobrescrevem mais. Se a função ainda não existir no banco, cai no
// caminho antigo de ler-modificar-gravar (melhor do que quebrar o formulário).
const rpcIndisponivel = err =>
  err?.code === '42883' || err?.code === 'PGRST202' || /function .*does not exist/i.test(err?.message || '');

// Acrescenta `entry` (objeto ou array de objetos) na lista `key`. Se algum
// elemento com o mesmo clientRef já estiver lá (reenvio após falha), não grava.
export async function appendState(key, entry) {
  if (bloqueadoPorLeitura(`acrescentar em ${key}`)) return;
  const { error } = await comTimeout(supabase.rpc('append_app_state_list', { k: key, entry }), `acrescentar em ${key}`);
  if (!error) return;
  if (!rpcIndisponivel(error)) throw error;
  console.warn(`RPC append_app_state_list indisponível — usando caminho legado para "${key}"`);
  const itens = Array.isArray(entry) ? entry : [entry];
  const ref = itens[0]?.clientRef;
  const atual = (await getState(key)) || [];
  if (ref && atual.some(s => s.clientRef === ref)) return;
  await setState(key, [...atual, ...itens]);
}

// Remove da lista `key` o elemento com esse id. Retorna true se removeu,
// false se o item já não estava lá (alguém decidiu antes) — quem chama usa
// isso pra não repetir efeitos colaterais (ex.: criar a nota duas vezes).
export async function removeFromStateList(key, id) {
  if (bloqueadoPorLeitura(`remover de ${key}`)) return false;
  const { data, error } = await comTimeout(supabase.rpc('remove_app_state_list', { k: key, item_id: String(id) }), `remover de ${key}`);
  if (!error) return data === true;
  if (!rpcIndisponivel(error)) throw error;
  console.warn(`RPC remove_app_state_list indisponível — usando caminho legado para "${key}"`);
  const atual = (await getState(key)) || [];
  if (!atual.some(s => String(s.id) === String(id))) return false;
  await setState(key, atual.filter(s => String(s.id) !== String(id)));
  return true;
}

// Lista as versões anteriores de `key` (mais recente primeiro), juntando os
// slots novos (::backup::vN e ::backup::dN) com a pilha legada (::backup).
// Use para inspecionar antes de decidir restaurar.
export async function getBackups(key) {
  const { data, error } = await comTimeout(
    supabase.from('app_state').select('value').like('key', `${key}::backup::%`),
    `listar backups de ${key}`
  );
  if (error) throw error;
  const novas = (data || []).map(r => r.value).filter(v => v && v.at);
  const legada = await getState(`${key}::backup`).catch(() => null);
  const antigas = Array.isArray(legada) ? legada : [];
  // Dedupe por timestamp (o snapshot diário pode ser a mesma versão de um slot v)
  const vistos = new Set();
  return [...novas, ...antigas]
    .filter(v => { if (vistos.has(v.at)) return false; vistos.add(v.at); return true; })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// Restaura `key` para a versão `stepsBack` passos atrás (0 = a gravação
// imediatamente anterior à atual). Sobrescreve o valor atual — a versão que
// estava valendo entra na pilha de backup antes de ser substituída, então
// restaurar também não é uma via de mão única.
export async function restoreBackup(key, stepsBack = 0) {
  const pilha = await getBackups(key);
  const versao = pilha[stepsBack];
  if (!versao) throw new Error(`Não há backup ${stepsBack} passos atrás para "${key}"`);
  await setState(key, versao.value);
  return versao;
}

// Cria um setter que atualiza o estado local na hora (otimista), mas relê o
// valor atual do Supabase antes de gravar de volta, reaplicando as mudanças
// pendentes por cima dele em vez de um `prev` local que pode estar
// desatualizado (aba parada, realtime caído, etc.) — sem isso, dois clientes
// editando quase ao mesmo tempo podem fazer um sobrescrever o outro.
// `persistRefs` é um objeto estável (ex: useRef({}).current) compartilhado
// entre todos os setters do componente, uma entrada por key.
export function createPersistedSetter(key, setRaw, persistRefs, { empty = [], debounceMs = 0 } = {}) {
  if (!persistRefs[key]) persistRefs[key] = { pending: [], timer: null, queue: Promise.resolve(), inFlight: 0 };
  const s = persistRefs[key];
  const flush = () => {
    const fns = s.pending; s.pending = [];
    s.inFlight++;
    s.queue = s.queue.then(async () => {
      try {
        const atual = await getState(key);
        let next = atual != null ? atual : empty;
        for (const f of fns) next = typeof f === "function" ? f(next) : f;
        await setState(key, next);
      } catch (err) {
        console.error(`Falha ao persistir "${key}" no Supabase:`, err);
      } finally {
        s.inFlight--;
      }
    });
  };
  return fn => {
    if (bloqueadoPorLeitura(`editar ${key}`)) return;   // UI não anda: nada muda no local nem no banco
    setRaw(prev => (typeof fn === "function" ? fn(prev) : fn));
    s.pending.push(fn);
    if (debounceMs > 0) {
      if (s.timer) clearTimeout(s.timer);
      s.timer = setTimeout(() => { s.timer = null; flush(); }, debounceMs);
    } else {
      flush();
    }
  };
}

// Enquanto essa key tem uma escrita local pendente (aguardando debounce ou já
// em voo pro Supabase), o estado local já é mais atual do que qualquer eco de
// realtime que possa chegar -- aplicar o eco por cima causaria o "rollback"
// visual clássico (o campo que a pessoa está digitando volta pra um valor de
// alguns caracteres atrás). isPersistPending deixa o handler de realtime
// pular esses ecos com segurança: quando a escrita local terminar, o próprio
// eco dela (já com o valor final) chega e sincroniza normalmente.
export function isPersistPending(persistRefs, key) {
  const s = persistRefs[key];
  if (!s) return false;
  return s.pending.length > 0 || s.inFlight > 0 || !!s.timer;
}

// ─── ARQUIVOS NF ─────────────────────────────────────────────────────────────
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// sha-256 (hex) do dataUrl — mesma conta que o Postgres faz com
// digest(value #>> '{}', 'sha256'), então o hash gravado na nota pode ser
// comparado com o do arquivo armazenado. null quando não dá pra calcular
// (contexto inseguro sem crypto.subtle) — nunca bloqueia o fluxo.
export async function hashDataUrl(dataUrl) {
  try {
    if (!globalThis.crypto?.subtle || !dataUrl) return null;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

// Devolve o fileHash do arquivo salvo, para o caller guardar na nota — é o que
// permite detectar o mesmo PDF entrando de novo com outro nº (dedupeNF.js).
export async function saveNFFile(notaId, dataUrl) {
  await setState(`nf_file_${notaId}`, dataUrl);
  return hashDataUrl(dataUrl);
}

// Formulário PÚBLICO grava o PDF com INSERT puro. O setState usa upsert
// (INSERT ... ON CONFLICT DO UPDATE), e o Postgres exige que o anon possa LER e
// ATUALIZAR a linha para o upsert passar — desde 09/09 (passo 3) o anon não lê
// nf_file_*, então o upsert era recusado pelo RLS e o PDF se perdia em silêncio
// (submissão chegava com hasFile=false). O id da submissão é novo, nunca
// conflita; a policy de INSERT do anon permite nf_file_*. Erro aqui SOBE para o
// formulário avisar o fornecedor em vez de aceitar a NF sem arquivo.
export async function saveNFFilePublico(notaId, dataUrl) {
  const { error } = await comTimeout(
    supabase.from("app_state").insert({ key: `nf_file_${notaId}`, value: dataUrl, updated_at: new Date().toISOString() }),
    `anexar arquivo da NF`
  );
  if (error) throw new Error("não foi possível anexar o arquivo (" + (error.message || error.code) + "). Tente enviar de novo.");
  return hashDataUrl(dataUrl);
}

export async function getNFFile(notaId) {
  return getState(`nf_file_${notaId}`);
}

// ─── CAMINHO PÚBLICO (telas sem login) ───────────────────────────────────────
// Formulários de NF e página #envio/<token> não leem app_state direto: usam
// RPCs que devolvem só o necessário (sem CPF/RG/valores) e validam o token no
// servidor (migrations 20260909100000 / 20260909200000).
const rpc = async (fn, args, oQue) => {
  const { data, error } = await comTimeout(supabase.rpc(fn, args), oQue);
  if (error) throw error;
  return data;
};
export const publicoFornecedores = (key = 'fornecedores') => rpc('publico_fornecedores', { p_key: key }, 'carregar fornecedores');
export const publicoJogos        = (key = 'jogos')        => rpc('publico_jogos', { p_key: key }, 'carregar jogos');
// → { stateKey, envio } ou null
export const publicoEnvio        = (token)                => rpc('publico_envio', { p_token: token }, 'carregar envio');
export const publicoOrcamento    = (token)                => rpc('publico_orcamento', { p_token: token }, 'carregar orçamento');
export const publicoNFFile       = (token, notaId)        => rpc('publico_nf_file', { p_token: token, p_nota_id: String(notaId) }, `baixar NF ${notaId}`);
export const publicoEnvioMarcarPago = (token, nome)       => rpc('publico_envio_marcar_pago', { p_token: token, p_nome: nome || null }, 'confirmar pagamento');
export const publicoEnvioStatusNota = (token, campo, notaId, status, nome) =>
  rpc('publico_envio_status_nota', { p_token: token, p_campo: campo, p_nota_id: String(notaId), p_status: status, p_nome: nome }, 'atualizar status da NF');

// Existe arquivo para esta nota? Consulta só a chave — as linhas nf_file_ chegam
// a 1 MB e baixar o conteúdo inteiro só pra checar existência é desperdício (e
// dá timeout justamente quando o banco está lento).
// Devolve true/false quando dá pra afirmar e `null` quando a consulta falhou —
// nesse caso quem chama NÃO deve rebaixar hasFile, senão um erro transitório
// esconde um arquivo que está lá.
export async function nfFileExiste(notaId) {
  try {
    const { data, error } = await comTimeout(
      supabase.from('app_state').select('key').eq('key', `nf_file_${notaId}`).maybeSingle(),
      `checar arquivo da NF ${notaId}`
    );
    if (error) return null;
    return !!data;
  } catch {
    return null;
  }
}

export async function deleteNFFile(notaId) {
  await supabase.from('app_state').delete().eq('key', `nf_file_${notaId}`);
}

