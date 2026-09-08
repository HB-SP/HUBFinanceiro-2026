import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { AUDIT_ACOES, descreverEvento, resumirUserAgent } from "../../lib/audit";
import { FONT, RADIUS } from "../../constants";
import { Button, Badge } from "../ui";
import {
  Download, RefreshCw, Search, LogIn, Users, Eye, AlertTriangle, ChevronDown, ChevronRight,
  Monitor, Smartphone, Globe, Clock, ShieldAlert, Trophy,
} from "lucide-react";

// ─── ACESSOS ──────────────────────────────────────────────────────────────────
// Leitura por PESSOA do audit log: último login, atividade no período,
// dispositivos, alertas de revisão de acesso. Os agregados vêm do banco
// (admin_acessos_*), o detalhe de um usuário lê o audit_log daquela pessoa.
const PERIODOS = [
  { key: 7,  label: "7 dias" },
  { key: 30, label: "30 dias" },
  { key: 90, label: "90 dias" },
];
const DIA = 86400e3;

const fmtRel = (d) => {
  if (!d) return "nunca";
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60e3) return "agora";
  if (ms < 3600e3) return `${Math.floor(ms / 60e3)} min`;
  if (ms < DIA) return `${Math.floor(ms / 3600e3)} h`;
  const dias = Math.floor(ms / DIA);
  return dias === 1 ? "ontem" : `${dias} dias`;
};
const fmtDataHora = (d) => { try { return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return d; } };
const fmtData = (d) => { try { return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); } catch { return d; } };

// Status de atividade do usuário
const statusDe = (r, u) => {
  if (u.role === "pendente") return { key: "pendente", label: "Pendente", color: "#9333EA" };
  if (!r?.ultimo_login) return { key: "nunca", label: "Nunca entrou", color: "#DC2626" };
  const dias = (Date.now() - new Date(r.ultimo_login).getTime()) / DIA;
  if (dias <= 7)  return { key: "ativo",   label: "Ativo na semana", color: "#16A34A" };
  if (dias <= 30) return { key: "mes",     label: "Ativo no mês",    color: "#2563EB" };
  return { key: "inativo", label: `Inativo há ${Math.floor(dias)} dias`, color: "#D97706" };
};

export default function TabAcessos({ T, users = [] }) {
  const [dias, setDias] = useState(30);
  const [resumo, setResumo] = useState([]);
  const [topTelas, setTopTelas] = useState([]);
  const [porDia, setPorDia] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [fTime, setFTime] = useState("");
  const [fRole, setFRole] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(null);          // user_id expandido
  const [detalhe, setDetalhe] = useState({});          // user_id → { eventos, porDia }

  const load = async () => {
    setLoading(true); setErro("");
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.rpc("admin_acessos_resumo", { p_dias: dias }),
      supabase.rpc("admin_acessos_top_telas", { p_dias: dias, p_limite: 8 }),
      supabase.rpc("admin_acessos_por_dia", { p_dias: dias }),
      supabase.from("teams").select("id, nome, cor, dominios"),
    ]);
    const e = r1.error || r2.error || r3.error || r4.error;
    if (e) setErro(e.message);
    setResumo(r1.data || []); setTopTelas(r2.data || []); setPorDia(r3.data || []); setTeams(r4.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); setDetalhe({}); }, [dias]);

  const byId = useMemo(() => Object.fromEntries(resumo.map(r => [r.user_id, r])), [resumo]);
  const teamDe = (u) => teams.find(t => t.id === u.team_id) || null;
  const dominiosConhecidos = useMemo(() => new Set(teams.flatMap(t => (t.dominios || []).map(d => d.toLowerCase()))), [teams]);

  // ── Linhas por usuário ──
  const linhas = useMemo(() => users.map(u => {
    const r = byId[u.id] || null;
    const st = statusDe(r, u);
    const disp = (r?.dispositivos || []);
    const top = [...disp].sort((a, b) => b.n - a.n)[0];
    const uaTop = top ? resumirUserAgent(top.ua) : null;
    const novos = disp.filter(d => Date.now() - new Date(d.first_seen).getTime() <= dias * DIA && disp.length > 1);
    const dom = String(u.email || "").split("@")[1]?.toLowerCase();
    const domDesconhecido = !!dom && dominiosConhecidos.size > 0 && !dominiosConhecidos.has(dom);
    return { u, r, st, t: teamDe(u), uaTop, novos, domDesconhecido };
  }), [users, byId, teams, dias, dominiosConhecidos]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter(l =>
      (!fTime || (fTime === "__sem" ? !l.u.team_id : l.u.team_id === fTime)) &&
      (!fRole || l.u.role === fRole) &&
      (!fStatus || l.st.key === fStatus) &&
      (!q || `${l.u.nome || ""} ${l.u.email || ""} ${l.t?.nome || ""}`.toLowerCase().includes(q))
    ).sort((a, b) => String(b.r?.ultima_atividade || "").localeCompare(String(a.r?.ultima_atividade || "")));
  }, [linhas, fTime, fRole, fStatus, busca]);

  // ── KPIs e alertas ──
  const kpis = useMemo(() => {
    const ativosSemana = linhas.filter(l => l.st.key === "ativo").length;
    const ativosMes = linhas.filter(l => ["ativo", "mes"].includes(l.st.key)).length;
    const logins = resumo.reduce((s, r) => s + (r.logins_periodo || 0), 0);
    const telas = resumo.reduce((s, r) => s + (r.telas_periodo || 0), 0);
    return { ativosSemana, ativosMes, logins, telas };
  }, [linhas, resumo]);
  const alertas = useMemo(() => {
    const a = [];
    linhas.filter(l => l.domDesconhecido && l.u.role !== "pendente").forEach(l => a.push({ tipo: "dominio", cor: "#DC2626", texto: `${l.u.email} tem domínio fora dos times cadastrados`, u: l.u }));
    linhas.filter(l => l.st.key === "nunca" && l.u.role !== "pendente").forEach(l => a.push({ tipo: "nunca", cor: "#D97706", texto: `${l.u.nome || l.u.email} tem acesso liberado e nunca entrou`, u: l.u }));
    linhas.filter(l => l.st.key === "inativo").forEach(l => a.push({ tipo: "inativo", cor: "#D97706", texto: `${l.u.nome || l.u.email} está ${l.st.label.toLowerCase()} — revisar acesso`, u: l.u }));
    linhas.filter(l => l.novos.length > 0).forEach(l => a.push({ tipo: "dispositivo", cor: "#2563EB", texto: `${l.u.nome || l.u.email} entrou de ${l.novos.length} dispositivo${l.novos.length > 1 ? "s" : ""} novo${l.novos.length > 1 ? "s" : ""} no período`, u: l.u }));
    return a;
  }, [linhas]);

  // ── Detalhe de um usuário ──
  const abrir = async (u) => {
    if (aberto === u.id) { setAberto(null); return; }
    setAberto(u.id);
    if (detalhe[u.id]) return;
    const [ev, pd] = await Promise.all([
      supabase.from("audit_log").select("*").eq("user_id", u.id).order("created_at", { ascending: false }).limit(400),
      supabase.rpc("admin_acessos_por_dia", { p_dias: dias, p_user: u.id }),
    ]);
    setDetalhe(prev => ({ ...prev, [u.id]: { eventos: ev.data || [], porDia: pd.data || [] } }));
  };
  const nomeDe = (id) => { const x = users.find(y => y.id === id); return x ? (x.nome || x.email) : "—"; };

  const exportarCSV = () => {
    const L = [["nome", "email", "time", "papel", "status", "ultimo_login", "ultima_atividade", `logins_${dias}d`, `telas_${dias}d`, "logins_total", "ips_distintos", "dispositivos", "navegador_principal"]];
    filtradas.forEach(({ u, r, st, t, uaTop }) => L.push([u.nome || "", u.email || "", t?.nome || "", u.role, st.label, r?.ultimo_login || "", r?.ultima_atividade || "", r?.logins_periodo || 0, r?.telas_periodo || 0, r?.logins_total || 0, r?.ips_distintos || 0, (r?.dispositivos || []).length, uaTop?.label || ""]));
    const csv = L.map(l => l.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `acessos_${dias}d_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const IS = { background: T.surfaceAlt || T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 10px", fontSize: 12.5, color: T.text, fontFamily: FONT.ui, outline: "none" };
  const th = { padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.textSm, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
  const td = { padding: "10px 14px", borderTop: `1px solid ${T.border}`, fontSize: 12.5, color: T.text, verticalAlign: "middle", whiteSpace: "nowrap" };
  const num = { fontFamily: FONT.num, fontVariantNumeric: "tabular-nums", textAlign: "right" };
  const Pill = ({ on, onClick, children }) => (
    <button onClick={onClick} style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: FONT.ui, border: `1px solid ${on ? (T.brand || "#65B32E") : T.border}`, background: on ? (T.brand || "#65B32E") : "transparent", color: on ? "#fff" : T.textMd }}>{children}</button>
  );
  const Kpi = ({ label, value, sub, color, icon: Icon }) => (
    <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 170 }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: `${color}16`, color, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={16}/></span>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, color: T.textSm }}>{label}</p>
        <p className="num" style={{ margin: 0, fontFamily: FONT.display, fontSize: 22, fontWeight: 700, color: T.text, lineHeight: 1.1 }}>{value}</p>
        {sub && <p style={{ margin: 0, fontSize: 10.5, color: T.textSm, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</p>}
      </div>
    </div>
  );
  // Barras por dia (logins) — CSS puro
  const Barras = ({ dados, campo = "logins", altura = 54 }) => {
    const max = Math.max(1, ...dados.map(d => d[campo] || 0));
    if (!dados.length) return <span style={{ fontSize: 11, color: T.textSm }}>sem dados no período</span>;
    return (
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: altura }}>
        {dados.map(d => (
          <div key={d.dia} title={`${fmtData(d.dia)}: ${d.logins} login${d.logins === 1 ? "" : "s"} · ${d.telas} tela${d.telas === 1 ? "" : "s"}${d.usuarios != null ? ` · ${d.usuarios} usuário${d.usuarios === 1 ? "" : "s"}` : ""}`}
            style={{ flex: 1, minWidth: 3, height: `${Math.max(4, ((d[campo] || 0) / max) * 100)}%`, background: (d[campo] || 0) ? (T.brand || "#65B32E") : `${T.border}`, borderRadius: 2 }}/>
        ))}
      </div>
    );
  };
  const topMaisAcessado = topTelas.find(t => t.tipo === "campeonato" || t.tipo === "orcamento");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* KPIs */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Kpi label="Ativos na semana" value={kpis.ativosSemana} sub={`${kpis.ativosMes} ativos no mês · ${users.length} usuários`} color="#16A34A" icon={Users}/>
        <Kpi label={`Logins · ${dias} dias`} value={kpis.logins} sub={`${kpis.telas} telas abertas`} color="#2563EB" icon={LogIn}/>
        <Kpi label="Tela mais aberta" value={topTelas[0]?.aberturas ?? "—"} sub={topTelas[0]?.label || "sem navegação no período"} color="#7C3AED" icon={Eye}/>
        <Kpi label="Campeonato / orçamento" value={topMaisAcessado?.aberturas ?? "—"} sub={topMaisAcessado?.label || "—"} color="#D97706" icon={Trophy}/>
      </div>

      {/* Atividade por dia + top telas */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "14px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Logins por dia</span>
            <span style={{ display: "inline-flex", gap: 4 }}>{PERIODOS.map(p => <Pill key={p.key} on={dias === p.key} onClick={() => setDias(p.key)}>{p.label}</Pill>)}</span>
          </div>
          <Barras dados={porDia} altura={70}/>
        </div>
        <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "14px 18px" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text, display: "block", marginBottom: 8 }}>Telas mais abertas</span>
          {topTelas.length === 0 ? <span style={{ fontSize: 11, color: T.textSm }}>sem navegação no período</span> : topTelas.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "3px 0", color: T.textMd }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</span>
              <span className="num" style={{ ...num, color: T.text, fontWeight: 600 }}>{t.aberturas} <span style={{ color: T.textSm, fontWeight: 400 }}>· {t.usuarios} usr</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "12px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <ShieldAlert size={15} color="#D97706"/><span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Alertas de acesso ({alertas.length})</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {alertas.map((a, i) => (
              <button key={i} onClick={() => abrir(a.u)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.textMd, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: "3px 0", fontFamily: FONT.ui }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.cor, flexShrink: 0 }}/>{a.texto}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={fTime} onChange={e => setFTime(e.target.value)} style={IS}>
          <option value="">Todos os times</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          <option value="__sem">Sem time</option>
        </select>
        <select value={fRole} onChange={e => setFRole(e.target.value)} style={IS}>
          <option value="">Todos os papéis</option>
          <option value="admin">Admin</option><option value="visualizador">Visualizador</option><option value="fornecedor">Fornecedor</option><option value="pendente">Pendente</option>
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={IS}>
          <option value="">Todos os status</option>
          <option value="ativo">Ativo na semana</option><option value="mes">Ativo no mês</option><option value="inativo">Inativo +30 dias</option><option value="nunca">Nunca entrou</option><option value="pendente">Pendente</option>
        </select>
        <span style={{ position: "relative" }}>
          <Search size={13} color={T.textSm} style={{ position: "absolute", left: 9, top: 9 }}/>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="buscar…" style={{ ...IS, paddingLeft: 28, width: 200 }}/>
        </span>
        <span style={{ flex: 1 }}/>
        <Button T={T} variant="secondary" size="sm" icon={RefreshCw} onClick={load}>Atualizar</Button>
        <Button T={T} variant="secondary" size="sm" icon={Download} onClick={exportarCSV} disabled={!filtradas.length}>CSV ({filtradas.length})</Button>
      </div>
      {erro && <p style={{ margin: 0, fontSize: 12, color: T.danger || "#DC2626" }}>{erro}</p>}

      {/* Tabela por usuário */}
      <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, overflow: "hidden", boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)" }}>
        {loading ? <p style={{ padding: 40, textAlign: "center", color: T.textMd, fontSize: 13, margin: 0 }}>Carregando acessos...</p> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt || T.bg }}>
                  <th style={th}>Usuário</th>
                  <th style={th}>Time · papel</th>
                  <th style={th}>Status</th>
                  <th style={th}>Último login</th>
                  <th style={{ ...th, textAlign: "right" }}>Logins</th>
                  <th style={{ ...th, textAlign: "right" }}>Telas</th>
                  <th style={th}>Dispositivo principal</th>
                  <th style={{ ...th, textAlign: "right" }}>Disp. · IPs</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map(({ u, r, st, t, uaTop, novos, domDesconhecido }) => {
                  const on = aberto === u.id;
                  const det = detalhe[u.id];
                  return [
                    <tr key={u.id} onClick={() => abrir(u)} style={{ cursor: "pointer", background: on ? (T.surfaceAlt || T.bg) : undefined }}
                      onMouseEnter={e => { if (!on) e.currentTarget.style.background = T.surfaceAlt || T.bg; }} onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {on ? <ChevronDown size={14} color={T.textSm}/> : <ChevronRight size={14} color={T.textSm}/>}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                              {u.nome || <span style={{ color: T.textSm, fontStyle: "italic" }}>sem nome</span>}
                              {domDesconhecido && <span title="Domínio fora dos times cadastrados"><AlertTriangle size={12} color="#DC2626"/></span>}
                              {novos.length > 0 && <span title="Dispositivo novo no período"><Monitor size={12} color="#2563EB"/></span>}
                            </div>
                            <div style={{ fontSize: 11, color: T.textSm }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...td, fontSize: 12, color: T.textMd }}>
                        {t ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: t.cor }}/>{t.nome}</span> : <span style={{ color: "#D97706" }}>sem time</span>}
                        <span style={{ color: T.textSm }}> · {u.role}</span>
                      </td>
                      <td style={td}><Badge T={T} color={st.color} size="sm">{st.label}</Badge></td>
                      <td style={{ ...td, color: T.textMd, fontSize: 12 }} title={r?.ultimo_login ? new Date(r.ultimo_login).toLocaleString("pt-BR") : ""}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Clock size={12} color={T.textSm}/>{fmtRel(r?.ultimo_login)}</span>
                      </td>
                      <td className="num" style={{ ...td, ...num }}>{r?.logins_periodo ?? 0}<span style={{ color: T.textSm, fontSize: 10.5 }}> / {r?.logins_total ?? 0}</span></td>
                      <td className="num" style={{ ...td, ...num }}>{r?.telas_periodo ?? 0}</td>
                      <td style={{ ...td, fontSize: 12, color: T.textMd }}>
                        {uaTop ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{uaTop.mobile ? <Smartphone size={12}/> : <Monitor size={12}/>}{uaTop.label}</span> : <span style={{ color: T.textSm }}>—</span>}
                      </td>
                      <td className="num" style={{ ...td, ...num, color: T.textMd }}>{(r?.dispositivos || []).length} · {r?.ips_distintos ?? 0}</td>
                    </tr>,
                    on && (
                      <tr key={`${u.id}-det`} style={{ background: T.surfaceAlt || T.bg }}>
                        <td colSpan={8} style={{ padding: "14px 20px 18px", borderTop: `1px dashed ${T.border}` }}>
                          {!det ? <span style={{ fontSize: 12, color: T.textSm }}>Carregando…</span> : (
                            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 18 }}>
                              {/* Linha do tempo */}
                              <div>
                                <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.textSm }}>Linha do tempo · {det.eventos.length} eventos</p>
                                <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                                  {det.eventos.length === 0 && <span style={{ fontSize: 12, color: T.textSm }}>sem eventos</span>}
                                  {det.eventos.map(ev => {
                                    const meta = AUDIT_ACOES[ev.action] || { color: "#6B7280", label: ev.action };
                                    const primeiroDisp = ev.action === "login" && (r?.dispositivos || []).some(d => d.ua === (ev.details?.user_agent || "") && Math.abs(new Date(d.first_seen) - new Date(ev.created_at)) < 1000);
                                    return (
                                      <div key={ev.id} style={{ display: "grid", gridTemplateColumns: "84px 8px 1fr", gap: 8, alignItems: "center", fontSize: 12 }}>
                                        <span className="num" style={{ fontFamily: FONT.num, color: T.textSm, fontSize: 11 }}>{fmtDataHora(ev.created_at)}</span>
                                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color }}/>
                                        <span style={{ color: T.textMd, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={descreverEvento(ev, nomeDe)}>
                                          {descreverEvento(ev, nomeDe)}{primeiroDisp && <span style={{ marginLeft: 6, fontSize: 10, color: "#2563EB", fontWeight: 700 }}>novo dispositivo</span>}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              {/* Telas mais abertas + barras */}
                              <div>
                                <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.textSm }}>Telas mais abertas</p>
                                {(() => {
                                  const cnt = {};
                                  det.eventos.filter(e => e.action === "page_view").forEach(e => { const k = e.details?.label || e.details?.pagina || "—"; cnt[k] = (cnt[k] || 0) + 1; });
                                  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8);
                                  return top.length === 0 ? <span style={{ fontSize: 12, color: T.textSm }}>nenhuma tela registrada</span> : top.map(([k, n]) => (
                                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textMd, padding: "2px 0" }}><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span><span className="num" style={{ ...num, color: T.text, fontWeight: 600 }}>{n}</span></div>
                                  ));
                                })()}
                                <p style={{ margin: "14px 0 6px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.textSm }}>Logins por dia</p>
                                <Barras dados={det.porDia} altura={44}/>
                              </div>
                              {/* Dispositivos e IPs */}
                              <div>
                                <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.textSm }}>Dispositivos e IPs</p>
                                {(r?.dispositivos || []).length === 0 ? <span style={{ fontSize: 12, color: T.textSm }}>nenhum login registrado</span> : (r.dispositivos).map((d, i) => {
                                  const ua = resumirUserAgent(d.ua);
                                  const novo = Date.now() - new Date(d.first_seen).getTime() <= dias * DIA && r.dispositivos.length > 1;
                                  return (
                                    <div key={i} style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, background: T.surface || T.card, border: `1px solid ${novo ? "#2563EB66" : T.border}`, marginBottom: 4 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: T.text, fontWeight: 600 }}>{ua.mobile ? <Smartphone size={12}/> : <Monitor size={12}/>}{ua.label}{novo && <Badge T={T} color="#2563EB" size="sm">novo</Badge>}</div>
                                      <div style={{ fontSize: 11, color: T.textSm, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        <span><Globe size={10}/> {d.ip || "ip —"}</span><span>{d.n} login{d.n === 1 ? "" : "s"}</span><span>1º {fmtData(d.first_seen)} · últ. {fmtData(d.last_seen)}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })}
                {filtradas.length === 0 && <tr><td colSpan={8} style={{ ...td, color: T.textSm, textAlign: "center", padding: 30 }}>Nenhum usuário com esses filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
