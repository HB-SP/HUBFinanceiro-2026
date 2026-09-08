// ─── AUDIT LOG · lado do app ──────────────────────────────────────────────────
// Login é registrado por trigger no banco (auth.sessions → audit_log 'login').
// Aqui ficam os eventos que só o app conhece: navegação (page_view) e logout.
// Tudo passa pela RPC log_audit_action (SECURITY DEFINER, nunca lança erro).
import { supabase } from "./supabase";

export const AUDIT_ACOES = {
  login:           { label: "Login",               color: "#16A34A", grupo: "acesso" },
  logout:          { label: "Logout",              color: "#6B7280", grupo: "acesso" },
  page_view:       { label: "Abriu tela",          color: "#2563EB", grupo: "navegacao" },
  user_approved:   { label: "Aprovou usuário",     color: "#9333EA", grupo: "admin" },
  role_change:     { label: "Trocou papel",        color: "#D97706", grupo: "admin" },
  entidade_change: { label: "Trocou entidade",     color: "#D97706", grupo: "admin" },
  profile_update:  { label: "Editou perfil",       color: "#D97706", grupo: "admin" },
  team_change:     { label: "Trocou time",         color: "#D97706", grupo: "admin" },
  user_deleted:    { label: "Excluiu usuário",     color: "#DC2626", grupo: "admin" },
  user_invited:    { label: "Convidou usuário",    color: "#0891B2", grupo: "admin" },
  team_created:    { label: "Criou time",          color: "#0891B2", grupo: "admin" },
  team_updated:    { label: "Editou time",         color: "#D97706", grupo: "admin" },
  team_deleted:    { label: "Excluiu time",        color: "#DC2626", grupo: "admin" },
};
export const AUDIT_GRUPOS = [
  { key: "acesso",    label: "Acesso" },
  { key: "navegacao", label: "Navegação" },
  { key: "admin",     label: "Administração" },
];

export async function logAcao(action, details = null, targetUserId = null) {
  try {
    await supabase.rpc("log_audit_action", { p_action: action, p_target_user_id: targetUserId, p_details: details });
  } catch (err) {
    console.warn("audit:", action, err?.message || err);
  }
}

// Rótulo legível da página do App (pagina = chave de navegação do App.jsx)
export function descreverPagina(pagina, { customCampeonatos = [], orcamentos = [] } = {}) {
  if (!pagina || pagina === "home") return { tipo: "home", label: "Início" };
  if (pagina === "brasileirao-2026")        return { tipo: "campeonato", id: pagina, label: "Brasileirão 2026" };
  if (pagina === "paulistao-feminino-2026") return { tipo: "campeonato", id: pagina, label: "Paulistão Feminino 2026" };
  if (pagina.startsWith("custom:")) { const id = pagina.slice(7); const c = customCampeonatos.find(x => x.id === id); return { tipo: "campeonato", id, label: c ? `${c.nome} ${c.edicao || ""}`.trim() : id }; }
  if (pagina.startsWith("orc:"))    { const id = pagina.slice(4); const r = orcamentos.find(x => x.id === id); return { tipo: "orcamento", id, label: r ? `Orçamento ${r.nome} ${r.edicao}` : `Orçamento ${id}` }; }
  if (pagina === "hub-orcamentos")   return { tipo: "modulo", id: "orcamentos", label: "Hub de Orçamentos" };
  if (pagina === "hub-fornecedores") return { tipo: "modulo", id: "fornecedores", label: "Hub de Fornecedores" };
  if (pagina === "admin-usuarios")   return { tipo: "admin", id: "admin", label: "Administração do Portal" };
  return { tipo: "outro", id: pagina, label: pagina };
}

// Texto legível de um evento do audit_log (usado no Audit log e em Acessos).
// `nomeDe(userId)` resolve o nome do alvo.
export function descreverEvento(ev, nomeDe = (id) => id || "—") {
  const d = ev.details || {};
  switch (ev.action) {
    case "login":  { const ua = resumirUserAgent(d.user_agent); return `Entrou no Hub${ua.label && ua.label !== "—" ? ` · ${ua.label}` : ""}${d.ip ? ` · ${d.ip}` : ""}`; }
    case "logout": return "Saiu do Hub";
    case "page_view": return `Abriu ${d.label || d.pagina || "uma tela"}${d.tipo === "campeonato" ? " (campeonato)" : d.tipo === "orcamento" ? " (orçamento)" : ""}`;
    case "user_approved":   return `Aprovou ${nomeDe(ev.target_user_id)} como ${d.new_role || "—"}`;
    case "role_change":     return `Trocou o papel de ${nomeDe(ev.target_user_id)} para ${d.new_role || "—"}`;
    case "entidade_change": return `Entidade de ${nomeDe(ev.target_user_id)} → ${d.new_entidade || "nenhuma"}`;
    case "profile_update":  return `Editou ${d.campo || "perfil"} de ${nomeDe(ev.target_user_id)}${d.valor ? ` → ${d.valor}` : ""}`;
    case "team_change":     return `Time de ${nomeDe(ev.target_user_id)} → ${d.team || "nenhum"}${d.de ? ` (era ${d.de})` : ""}`;
    case "user_deleted":    return `Excluiu ${d.nome || d.email || nomeDe(ev.target_user_id)}`;
    case "user_invited":    return `Convidou ${d.email || "—"}${d.role ? ` como ${d.role}` : ""}`;
    case "team_created":    return `Criou o time ${d.nome || "—"}${(d.dominios || []).length ? ` (${d.dominios.join(", ")})` : ""}`;
    case "team_updated":    return `Editou o time ${d.nome || "—"}`;
    case "team_deleted":    return `Excluiu o time ${d.nome || "—"}`;
    default: return ev.action;
  }
}

// Navegador/SO resumidos a partir do user agent (para a linha do tempo)
export function resumirUserAgent(ua = "") {
  const s = String(ua);
  const nav = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : s ? "Outro" : "—";
  const so  = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad/.test(s) ? "iOS" : /Mac OS/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "";
  const mobile = /Mobile|Android|iPhone/.test(s);
  return { nav, so, mobile, label: [nav, so].filter(Boolean).join(" · ") + (mobile ? " · celular" : "") };
}
