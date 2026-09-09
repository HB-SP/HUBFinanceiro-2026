// ─── CONFIGURAÇÕES DO PORTAL (portal_settings) ───────────────────────────────
// Chave/valor jsonb no banco. Cache em memória + realtime. Admin escreve pela
// aba Configurações; o App lê ao logar (e a tela de cadastro lê o que é público:
// texto LGPD e entidades extras).
import { supabase } from "./supabase";
import { ENTIDADES_VISUALIZADOR } from "../config/entities";

export const CONFIG_PADRAO = {
  entidades_extras: [],   // [{ id, label }] — além das fixas (FFU, FPF, Outro)
  signup: { bloquear_desconhecidos: false, dominios_permitidos: [], google_dominios: ["livemode.com"] },
  lgpd: { itens: [] },    // [{ titulo, texto }]
  audit: { retencao_dias: 365, ultima_limpeza: null },
};

const cache = { ...CONFIG_PADRAO };
const ouvintes = new Set();
let canal = null;

export const getConfig = (key) => cache[key] ?? CONFIG_PADRAO[key];
export const onConfigChange = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
const notificar = () => ouvintes.forEach(fn => { try { fn({ ...cache }); } catch {} });

// Entidades extras entram na MESMA lista que o app inteiro usa (mutação do
// array exportado): os selects de entidade passam a oferecê-las sem mudar
// cada componente. As fixas nunca saem.
const FIXAS = ENTIDADES_VISUALIZADOR.slice(0, 3).map(e => e.id);
export function aplicarEntidadesExtras(extras = []) {
  for (let i = ENTIDADES_VISUALIZADOR.length - 1; i >= 0; i--) {
    if (!FIXAS.includes(ENTIDADES_VISUALIZADOR[i].id)) ENTIDADES_VISUALIZADOR.splice(i, 1);
  }
  const outroIdx = ENTIDADES_VISUALIZADOR.findIndex(e => e.id === "outro");
  const validas = (extras || []).filter(e => e?.id && e?.label && !FIXAS.includes(e.id));
  // extras ficam antes de "Outro"
  ENTIDADES_VISUALIZADOR.splice(outroIdx === -1 ? ENTIDADES_VISUALIZADOR.length : outroIdx, 0, ...validas.map(e => ({ id: String(e.id), label: String(e.label) })));
}

function absorver(rows) {
  (rows || []).forEach(r => { cache[r.key] = { ...(CONFIG_PADRAO[r.key] && !Array.isArray(CONFIG_PADRAO[r.key]) ? CONFIG_PADRAO[r.key] : {}), ...(Array.isArray(r.value) ? {} : r.value) }; if (Array.isArray(r.value)) cache[r.key] = r.value; });
  aplicarEntidadesExtras(cache.entidades_extras);
  notificar();
}

// Carrega tudo que o usuário logado pode ler (anon recebe só lgpd + entidades_extras pela RLS)
export async function carregarConfig() {
  const { data, error } = await supabase.from("portal_settings").select("key, value");
  if (error) { console.warn("portal_settings:", error.message); return cache; }
  absorver(data);
  if (!canal) {
    canal = supabase.channel("portal-settings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "portal_settings" }, p => { if (p.new?.key) absorver([p.new]); })
      .subscribe();
  }
  return cache;
}

export async function salvarConfig(key, value, userId = null) {
  const { error } = await supabase.from("portal_settings").upsert({ key, value, updated_at: new Date().toISOString(), updated_by: userId }, { onConflict: "key" });
  if (error) throw error;
  absorver([{ key, value }]);
}

// Slug simples para id de entidade nova (ex.: "Federação Mineira" → "federacao-mineira")
export const slugEntidade = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
