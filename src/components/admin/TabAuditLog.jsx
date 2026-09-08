import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { AUDIT_ACOES, AUDIT_GRUPOS, resumirUserAgent } from "../../lib/audit";
import { FONT, RADIUS } from "../../constants";
import { Button, Badge } from "../ui";
import { Download, RefreshCw, LogIn, LogOut, Eye, ShieldCheck, Search } from "lucide-react";

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────
// Linha do tempo única: logins (trigger no banco), navegação e logout (app) e
// ações administrativas. Só admin lê (RLS em audit_log).
const PERIODOS = [
  { key: "24h", label: "24 horas", ms: 24 * 3600e3 },
  { key: "7d",  label: "7 dias",   ms: 7 * 86400e3 },
  { key: "30d", label: "30 dias",  ms: 30 * 86400e3 },
  { key: "90d", label: "90 dias",  ms: 90 * 86400e3 },
];
const LIMITE = 1500;

const fmtDataHora = (d) => { try { return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return d; } };
const fmtDia = (d) => { try { return new Date(d).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }); } catch { return d; } };

// Texto da linha a partir de action + details
function descrever(ev, nomeDe) {
  const d = ev.details || {};
  switch (ev.action) {
    case "login":  { const ua = resumirUserAgent(d.user_agent); return `Entrou no Hub${ua.label && ua.label !== "—" ? ` · ${ua.label}` : ""}${d.ip ? ` · ${d.ip}` : ""}`; }
    case "logout": return "Saiu do Hub";
    case "page_view": return `Abriu ${d.label || d.pagina || "uma tela"}${d.tipo === "campeonato" ? " (campeonato)" : d.tipo === "orcamento" ? " (orçamento)" : ""}`;
    case "user_approved":   return `Aprovou ${nomeDe(ev.target_user_id)} como ${d.new_role || "—"}`;
    case "role_change":     return `Trocou o papel de ${nomeDe(ev.target_user_id)} para ${d.new_role || "—"}`;
    case "entidade_change": return `Entidade de ${nomeDe(ev.target_user_id)} → ${d.new_entidade || "nenhuma"}`;
    case "profile_update":  return `Editou ${d.campo || "perfil"} de ${nomeDe(ev.target_user_id)}${d.valor ? ` → ${d.valor}` : ""}`;
    case "team_change":     return `Time de ${nomeDe(ev.target_user_id)} → ${d.team || "—"}`;
    case "user_deleted":    return `Excluiu ${d.nome || d.email || nomeDe(ev.target_user_id)}`;
    case "user_invited":    return `Convidou ${d.email || "—"}${d.role ? ` como ${d.role}` : ""}`;
    case "team_created":    return `Criou o time ${d.nome || "—"}${(d.dominios || []).length ? ` (${d.dominios.join(", ")})` : ""}`;
    case "team_updated":    return `Editou o time ${d.nome || "—"}`;
    case "team_deleted":    return `Excluiu o time ${d.nome || "—"}`;
    default: return ev.action;
  }
}

export default function TabAuditLog({ T, users = [] }) {
  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [periodo, setPeriodo] = useState("7d");
  const [grupo, setGrupo]   = useState("");       // acesso | navegacao | admin | ""
  const [usuario, setUsuario] = useState("");     // user_id | ""
  const [busca, setBusca]   = useState("");

  const nomeDe = (id) => { const u = users.find(x => x.id === id); return u ? (u.nome || u.email) : (id ? "usuário removido" : "—"); };
  const emailDe = (id) => users.find(x => x.id === id)?.email || "";

  const load = async () => {
    setLoading(true); setErro("");
    const desde = new Date(Date.now() - (PERIODOS.find(p => p.key === periodo)?.ms || 7 * 86400e3)).toISOString();
    const { data, error } = await supabase.from("audit_log").select("*").gte("created_at", desde).order("created_at", { ascending: false }).limit(LIMITE);
    if (error) setErro(error.message); else setEventos(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [periodo]);
  useEffect(() => {
    const ch = supabase.channel("audit-log-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log" }, p => setEventos(prev => [p.new, ...prev].slice(0, LIMITE)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return eventos.filter(ev => {
      const meta = AUDIT_ACOES[ev.action];
      if (grupo && (meta?.grupo || "admin") !== grupo) return false;
      if (usuario && ev.user_id !== usuario && ev.target_user_id !== usuario) return false;
      if (q) {
        const txt = `${nomeDe(ev.user_id)} ${emailDe(ev.user_id)} ${descrever(ev, nomeDe)} ${ev.action}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }, [eventos, grupo, usuario, busca, users]);

  // KPIs do período filtrado
  const kpis = useMemo(() => {
    const logins = eventos.filter(e => e.action === "login");
    const ativos = new Set(eventos.filter(e => e.user_id).map(e => e.user_id)).size;
    const telas = eventos.filter(e => e.action === "page_view").length;
    const admin = eventos.filter(e => (AUDIT_ACOES[e.action]?.grupo || "admin") === "admin").length;
    return { logins: logins.length, ativos, telas, admin };
  }, [eventos]);

  // Agrupa por dia para a linha do tempo
  const porDia = useMemo(() => {
    const m = new Map();
    filtrados.forEach(ev => { const k = new Date(ev.created_at).toDateString(); if (!m.has(k)) m.set(k, []); m.get(k).push(ev); });
    return [...m.entries()];
  }, [filtrados]);

  const exportarCSV = () => {
    const linhas = [["data_hora", "usuario", "email", "acao", "descricao", "alvo", "detalhes"]];
    filtrados.forEach(ev => linhas.push([
      new Date(ev.created_at).toISOString(), nomeDe(ev.user_id), emailDe(ev.user_id), ev.action,
      descrever(ev, nomeDe), ev.target_user_id ? nomeDe(ev.target_user_id) : "", JSON.stringify(ev.details || {}),
    ]));
    const csv = linhas.map(l => l.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `audit_log_${periodo}_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const IS = { background: T.surfaceAlt || T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 10px", fontSize: 12.5, color: T.text, fontFamily: FONT.ui, outline: "none" };
  const Kpi = ({ label, value, color, icon: Icon }) => (
    <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 160 }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: `${color}16`, color, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon size={16}/></span>
      <div>
        <p style={{ margin: 0, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, color: T.textSm }}>{label}</p>
        <p className="num" style={{ margin: 0, fontFamily: FONT.display, fontSize: 22, fontWeight: 700, color: T.text, lineHeight: 1.1 }}>{value}</p>
      </div>
    </div>
  );
  const Pill = ({ on, onClick, children }) => (
    <button onClick={onClick} style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: FONT.ui, border: `1px solid ${on ? (T.brand || "#65B32E") : T.border}`, background: on ? (T.brand || "#65B32E") : "transparent", color: on ? "#fff" : T.textMd }}>{children}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Kpi label="Logins no período" value={kpis.logins} color="#16A34A" icon={LogIn}/>
        <Kpi label="Usuários ativos" value={kpis.ativos} color="#2563EB" icon={Eye}/>
        <Kpi label="Telas abertas" value={kpis.telas} color="#7C3AED" icon={Eye}/>
        <Kpi label="Ações de admin" value={kpis.admin} color="#D97706" icon={ShieldCheck}/>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", gap: 4 }}>{PERIODOS.map(p => <Pill key={p.key} on={periodo === p.key} onClick={() => setPeriodo(p.key)}>{p.label}</Pill>)}</span>
        <span style={{ width: 1, height: 22, background: T.border }}/>
        <span style={{ display: "inline-flex", gap: 4 }}>
          <Pill on={!grupo} onClick={() => setGrupo("")}>Tudo</Pill>
          {AUDIT_GRUPOS.map(g => <Pill key={g.key} on={grupo === g.key} onClick={() => setGrupo(g.key)}>{g.label}</Pill>)}
        </span>
        <select value={usuario} onChange={e => setUsuario(e.target.value)} style={{ ...IS, maxWidth: 240 }}>
          <option value="">Todos os usuários</option>
          {[...users].sort((a, b) => (a.nome || a.email || "").localeCompare(b.nome || b.email || "", "pt-BR")).map(u => <option key={u.id} value={u.id}>{u.nome || u.email}</option>)}
        </select>
        <span style={{ position: "relative" }}>
          <Search size={13} color={T.textSm} style={{ position: "absolute", left: 9, top: 9 }}/>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="buscar…" style={{ ...IS, paddingLeft: 28, width: 200 }}/>
        </span>
        <span style={{ flex: 1 }}/>
        <Button T={T} variant="secondary" size="sm" icon={RefreshCw} onClick={load}>Atualizar</Button>
        <Button T={T} variant="secondary" size="sm" icon={Download} onClick={exportarCSV} disabled={!filtrados.length}>CSV ({filtrados.length})</Button>
      </div>

      {erro && <p style={{ margin: 0, fontSize: 12, color: T.danger || "#DC2626" }}>{erro}</p>}

      {/* Linha do tempo */}
      <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, overflow: "hidden", boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)" }}>
        {loading ? <p style={{ padding: 40, textAlign: "center", color: T.textMd, fontSize: 13, margin: 0 }}>Carregando eventos...</p>
        : filtrados.length === 0 ? <p style={{ padding: 40, textAlign: "center", color: T.textMd, fontSize: 13, margin: 0 }}>Nenhum evento no período com esses filtros.</p>
        : porDia.map(([dia, evs]) => (
          <div key={dia}>
            <div style={{ padding: "8px 18px", background: T.surfaceAlt || T.bg, borderBottom: `1px solid ${T.border}`, borderTop: `1px solid ${T.border}`, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.textSm, display: "flex", justifyContent: "space-between" }}>
              <span>{fmtDia(evs[0].created_at)}</span><span>{evs.length} evento{evs.length === 1 ? "" : "s"}</span>
            </div>
            {evs.map(ev => {
              const meta = AUDIT_ACOES[ev.action] || { label: ev.action, color: "#6B7280", grupo: "admin" };
              const Icon = ev.action === "login" ? LogIn : ev.action === "logout" ? LogOut : ev.action === "page_view" ? Eye : ShieldCheck;
              return (
                <div key={ev.id} style={{ display: "grid", gridTemplateColumns: "76px 26px 190px 1fr 150px", gap: 12, alignItems: "center", padding: "9px 18px", borderTop: `1px solid ${T.border}`, fontSize: 12.5 }}>
                  <span className="num" style={{ fontFamily: FONT.num, color: T.textSm, fontSize: 12 }}>{fmtDataHora(ev.created_at).slice(-5)}</span>
                  <span style={{ width: 24, height: 24, borderRadius: 7, background: `${meta.color}16`, color: meta.color, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon size={13}/></span>
                  <span style={{ color: T.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={emailDe(ev.user_id)}>{nomeDe(ev.user_id)}</span>
                  <span style={{ color: T.textMd, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={JSON.stringify(ev.details || {})}>{descrever(ev, nomeDe)}</span>
                  <span style={{ textAlign: "right" }}><Badge T={T} color={meta.color} size="sm">{meta.label}</Badge></span>
                </div>
              );
            })}
          </div>
        ))}
        {!loading && eventos.length >= LIMITE && <p style={{ margin: 0, padding: "10px 18px", fontSize: 11, color: T.textSm }}>Mostrando os {LIMITE} eventos mais recentes do período. Reduza o período para ver tudo.</p>}
      </div>
    </div>
  );
}
