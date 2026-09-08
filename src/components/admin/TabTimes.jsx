import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { logAcao } from "../../lib/audit";
import { ENTIDADES_VISUALIZADOR } from "../../config/entities";
import { FONT, RADIUS } from "../../constants";
import { Button, Badge } from "../ui";
import { Plus, Trash2, Check, X, Users, Globe, Shield, Layers, Pencil, UserMinus } from "lucide-react";

// ─── TIMES ────────────────────────────────────────────────────────────────────
// Time = grupo de usuários por domínio de e-mail. Define o que o time vê
// (entidades, módulos) e como um cadastro novo entra (papel padrão, aprovação
// automática). Usuário herda do time; a entidade individual do perfil, quando
// preenchida, vence a do time.
const ROLES = [
  { id: "visualizador", label: "Visualizador" },
  { id: "admin",        label: "Admin" },
  { id: "fornecedor",   label: "Fornecedor" },
  { id: "pendente",     label: "Pendente (aprovação manual)" },
];
const MODULOS = [
  { id: "orcamentos",   label: "Orçamentos" },
  { id: "fornecedores", label: "Hub de Fornecedores" },
];
const CORES = ["#65B32E", "#2563EB", "#DC2626", "#FACC15", "#7C3AED", "#0891B2", "#D97706", "#6B7280"];
const NOVO = () => ({ nome: "", cor: "#2563EB", dominios: [], role_padrao: "visualizador", aprovacao_automatica: false, entidades: [], modulos: ["orcamentos"], escopo: "notas", descricao: "" });
// Escopo do visualizador dentro dos campeonatos
const ESCOPOS = [
  { id: "notas",    label: "Só Notas Fiscais e Relatório", desc: "Padrão das entidades (FFU, FPF)." },
  { id: "completo", label: "Todo o hub em leitura",        desc: "Todas as abas, sem editar, cadastrar ou aprovar." },
];
const normDominio = (d) => String(d || "").trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

export default function TabTimes({ T, users = [], onUsersChanged }) {
  const [teams, setTeams]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(null);   // objeto em edição (novo ou existente)
  const [erro, setErro]       = useState("");
  const [salvando, setSalvando] = useState(false);
  const [novoDominio, setNovoDominio] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("teams").select("*").order("created_at");
    if (error) setErro(error.message); else setTeams(data || []);
    setLoading(false);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("teams-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const membros = useMemo(() => {
    const m = {};
    users.forEach(u => { if (u.team_id) m[u.team_id] = (m[u.team_id] || 0) + 1; });
    return m;
  }, [users]);
  const semTime = users.filter(u => !u.team_id);
  // Usuários cujo domínio casa com um time mas ainda não estão nele (sugestão de vínculo)
  const sugestoes = useMemo(() => semTime.map(u => {
    const dom = String(u.email || "").split("@")[1]?.toLowerCase();
    const t = teams.find(t => (t.dominios || []).map(d => d.toLowerCase()).includes(dom));
    return t ? { u, t } : null;
  }).filter(Boolean), [semTime, teams]);

  const salvar = async () => {
    const e = editando;
    if (!e.nome.trim()) { setErro("Dê um nome ao time."); return; }
    setSalvando(true); setErro("");
    const payload = { nome: e.nome.trim(), cor: e.cor, dominios: e.dominios, role_padrao: e.role_padrao, aprovacao_automatica: !!e.aprovacao_automatica, entidades: e.entidades, modulos: e.modulos, escopo: e.escopo === "completo" ? "completo" : "notas", descricao: e.descricao || null };
    let res;
    if (e.id) res = await supabase.from("teams").update(payload).eq("id", e.id).select().single();
    else      res = await supabase.from("teams").insert(payload).select().single();
    if (res.error) { setErro(res.error.message); setSalvando(false); return; }
    await logAcao(e.id ? "team_updated" : "team_created", { team_id: res.data.id, nome: payload.nome, dominios: payload.dominios });
    setSalvando(false); setEditando(null); load();
  };

  const excluir = async (t) => {
    const n = membros[t.id] || 0;
    if (!window.confirm(`Excluir o time "${t.nome}"?${n ? `\n\n${n} usuário(s) ficam sem time (perfil e entidade individuais não mudam).` : ""}`)) return;
    const { error } = await supabase.from("teams").delete().eq("id", t.id);
    if (error) { setErro(error.message); return; }
    await logAcao("team_deleted", { team_id: t.id, nome: t.nome });
    load(); onUsersChanged && onUsersChanged();
  };

  // Controles por usuário (lista no fim da aba): time, papel, entidades
  const setTime = async (u, teamId) => {
    const t = teams.find(x => x.id === teamId) || null;
    const { error } = await supabase.from("profiles").update({ team_id: t ? t.id : null }).eq("id", u.id);
    if (error) { setErro(error.message); return; }
    await logAcao("team_change", { team_id: t?.id || null, team: t?.nome || null }, u.id);
    onUsersChanged && onUsersChanged();
  };
  const setPapel = async (u, role) => {
    if (u.role === role) return;
    const { error } = await supabase.from("profiles").update({ role }).eq("id", u.id);
    if (error) { setErro(error.message); return; }
    await logAcao(u.role === "pendente" ? "user_approved" : "role_change", { new_role: role }, u.id);
    onUsersChanged && onUsersChanged();
  };
  const toggleEntidade = async (u, entId) => {
    const atual = String(u.entidade || "").split(",").map(s => s.trim()).filter(Boolean);
    const novas = atual.includes(entId) ? atual.filter(e => e !== entId) : [...atual, entId];
    const entidade = novas.join(",") || null;
    const { error } = await supabase.from("profiles").update({ entidade }).eq("id", u.id);
    if (error) { setErro(error.message); return; }
    await logAcao("entidade_change", { new_entidade: entidade }, u.id);
    onUsersChanged && onUsersChanged();
  };
  const desvincular = async (u, t) => {
    if (!window.confirm(`Tirar ${u.nome || u.email} do time ${t.nome}? O perfil e a entidade individual não mudam.`)) return;
    const { error } = await supabase.from("profiles").update({ team_id: null }).eq("id", u.id);
    if (error) { setErro(error.message); return; }
    await logAcao("team_change", { team_id: null, team: null, de: t.nome }, u.id);
    onUsersChanged && onUsersChanged();
  };
  const vincular = async (u, t) => {
    const { error } = await supabase.from("profiles").update({ team_id: t.id }).eq("id", u.id);
    if (error) { setErro(error.message); return; }
    await logAcao("team_change", { team_id: t.id, team: t.nome }, u.id);
    onUsersChanged && onUsersChanged();
  };
  const vincularTodos = async () => { for (const s of sugestoes) await vincular(s.u, s.t); };

  const IS = { background: T.surfaceAlt || T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 10px", fontSize: 12.5, color: T.text, fontFamily: FONT.ui, outline: "none" };
  const label = (txt) => <span style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.textSm, marginBottom: 6 }}>{txt}</span>;
  const entLabel = (id) => ENTIDADES_VISUALIZADOR.find(e => e.id === id)?.label?.split(" - ")[0] || id;

  const Toggle = ({ on, onClick, children, cor }) => (
    <button type="button" onClick={onClick} style={{
      padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: FONT.ui,
      border: `1px solid ${on ? (cor || T.brand || "#65B32E") : T.border}`,
      background: on ? `${cor || T.brand || "#65B32E"}1f` : "transparent",
      color: on ? (cor || T.brand || "#65B32E") : T.textMd,
    }}>{children}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Cabeçalho da aba */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 12.5, color: T.textMd, maxWidth: 720, lineHeight: 1.55 }}>
          Um <b>time</b> agrupa usuários pelo domínio do e-mail e define o que eles veem (entidades e módulos) e como um cadastro novo entra.
          Se o cadastro casar com um domínio de time com <b>aprovação automática</b>, o usuário já entra com o papel padrão; senão fica pendente.
        </p>
        <Button T={T} variant="primary" size="md" icon={Plus} onClick={() => { setErro(""); setEditando(NOVO()); }}>Novo time</Button>
      </div>

      {erro && <p style={{ margin: 0, fontSize: 12, color: T.danger || "#DC2626" }}>{erro}</p>}

      {/* Sugestões de vínculo por domínio */}
      {sugestoes.length > 0 && (
        <div style={{ background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.25)", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Users size={16} color="#2563EB"/>
          <p style={{ margin: 0, fontSize: 12.5, color: T.text, flex: 1 }}>
            {sugestoes.length} usuário{sugestoes.length > 1 ? "s" : ""} sem time com domínio conhecido: {sugestoes.slice(0, 4).map(s => `${s.u.email} → ${s.t.nome}`).join(" · ")}{sugestoes.length > 4 ? " …" : ""}
          </p>
          <Button T={T} variant="secondary" size="sm" icon={Check} onClick={vincularTodos}>Vincular todos</Button>
        </div>
      )}

      {/* Cards de times */}
      {loading ? <p style={{ color: T.textMd, fontSize: 13 }}>Carregando times...</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {teams.map(t => (
            <div key={t.id} style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${t.cor || "#65B32E"}`, borderRadius: RADIUS.lg, padding: 18, display: "flex", flexDirection: "column", gap: 12, boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <h4 style={{ margin: 0, fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text }}>{t.nome}</h4>
                  {t.descricao && <p style={{ margin: "2px 0 0", fontSize: 11.5, color: T.textSm }}>{t.descricao}</p>}
                </div>
                <div style={{ display: "inline-flex", gap: 4 }}>
                  <button title="Editar" onClick={() => { setErro(""); setEditando({ ...t, dominios: [...(t.dominios || [])], entidades: [...(t.entidades || [])], modulos: [...(t.modulos || [])] }); }}
                    style={{ border: `1px solid ${T.border}`, background: "transparent", color: T.textMd, borderRadius: 7, width: 30, height: 30, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Pencil size={13}/></button>
                  <button title="Excluir time" onClick={() => excluir(t)}
                    style={{ border: "1px solid rgba(220,38,38,0.2)", background: "rgba(220,38,38,0.08)", color: T.danger || "#DC2626", borderRadius: 7, width: 30, height: 30, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={13}/></button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
                <div>
                  {label("Domínios")}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {(t.dominios || []).length ? t.dominios.map(d => <Badge key={d} T={T} color={t.cor} size="sm"><Globe size={10}/> {d}</Badge>) : <span style={{ color: T.textSm }}>nenhum</span>}
                  </div>
                </div>
                <div>
                  {label("Membros")}
                  <span className="num" style={{ fontFamily: FONT.num, fontSize: 18, fontWeight: 700, color: T.text }}>{membros[t.id] || 0}</span>
                </div>
                <div>
                  {label("Cadastro novo")}
                  <span style={{ color: T.text }}>{ROLES.find(r => r.id === t.role_padrao)?.label || t.role_padrao}</span>
                  <span style={{ display: "block", fontSize: 11, color: t.aprovacao_automatica ? "#16A34A" : T.textSm }}>{t.aprovacao_automatica ? "entra direto" : "fica pendente até aprovar"}</span>
                  <span style={{ display: "block", fontSize: 11, color: t.escopo === "completo" ? "#2563EB" : T.textSm, marginTop: 2 }}>{t.escopo === "completo" ? "todo o hub em leitura" : "só Notas e Relatório"}</span>
                </div>
                <div>
                  {label("Vê")}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {(t.entidades || []).map(e => <Badge key={e} T={T} color="#2563EB" size="sm"><Shield size={10}/> {entLabel(e)}</Badge>)}
                    {(t.modulos || []).map(m => <Badge key={m} T={T} color="#7C3AED" size="sm"><Layers size={10}/> {MODULOS.find(x => x.id === m)?.label || m}</Badge>)}
                    {!(t.entidades || []).length && !(t.modulos || []).length && <span style={{ color: T.textSm }}>—</span>}
                  </div>
                </div>
              </div>
              {/* Membros do time */}
              {(() => {
                const lista = users.filter(u => u.team_id === t.id).sort((a, b) => (a.nome || a.email || "").localeCompare(b.nome || b.email || "", "pt-BR"));
                const ROLE_COR = { admin: "#16A34A", visualizador: "#2563EB", fornecedor: "#D97706", pendente: "#9333EA" };
                return (
                  <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
                    {label(`Membros (${lista.length})`)}
                    {lista.length === 0 ? <span style={{ fontSize: 12, color: T.textSm }}>nenhum usuário vinculado</span> : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                        {lista.map(u => (
                          <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "4px 6px", borderRadius: 6, background: T.surfaceAlt || T.bg }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: ROLE_COR[u.role] || "#6B7280", flexShrink: 0 }} title={u.role}/>
                            <span style={{ color: T.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }} title={u.email}>
                              {u.nome || u.email}
                              {u.nome && <span style={{ color: T.textSm, fontWeight: 400 }}> · {u.email}</span>}
                            </span>
                            <span style={{ fontSize: 10, color: ROLE_COR[u.role] || T.textSm, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>{u.role}</span>
                            <button title="Tirar do time" onClick={() => desvincular(u, t)}
                              style={{ border: "none", background: "transparent", color: T.textSm, cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}
                              onMouseEnter={e => e.currentTarget.style.color = T.danger || "#DC2626"} onMouseLeave={e => e.currentTarget.style.color = T.textSm}>
                              <UserMinus size={13}/>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
          {teams.length === 0 && <p style={{ color: T.textMd, fontSize: 13 }}>Nenhum time ainda.</p>}
        </div>
      )}

      {/* ── Usuários: lista completa com os controles de cada um (time · papel · entidades) ── */}
      {(() => {
        const ROLE_COR = { admin: "#16A34A", visualizador: "#2563EB", fornecedor: "#D97706", pendente: "#9333EA" };
        const ordem = [...users].sort((a, b) =>
          ((a.role === "pendente") === (b.role === "pendente") ? 0 : a.role === "pendente" ? -1 : 1)
          || ((a.team_id ? 1 : 0) - (b.team_id ? 1 : 0))
          || (teams.findIndex(t => t.id === a.team_id) - teams.findIndex(t => t.id === b.team_id))
          || (a.nome || a.email || "").localeCompare(b.nome || b.email || "", "pt-BR"));
        const th = { padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.textSm, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
        const td = { padding: "9px 14px", borderTop: `1px solid ${T.border}`, fontSize: 12.5, color: T.text, verticalAlign: "middle" };
        return (
          <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, overflow: "hidden", boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Users size={16} color={T.brand || "#65B32E"}/>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Usuários ({users.length})</span>
              <span style={{ fontSize: 11.5, color: T.textSm }}>Decida aqui o time, o papel e as entidades de cada um. Pendentes primeiro, depois quem está sem time.</span>
              {semTime.length > 0 && <span style={{ marginLeft: "auto" }}><Badge T={T} color="#D97706" size="sm">{semTime.length} sem time</Badge></span>}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead>
                  <tr style={{ background: T.surfaceAlt || T.bg }}>
                    <th style={th}>Usuário</th>
                    <th style={th}>Time</th>
                    <th style={th}>Papel</th>
                    <th style={th}>Entidades (individual)</th>
                    <th style={th}>Efetivo</th>
                  </tr>
                </thead>
                <tbody>
                  {ordem.map(u => {
                    const t = teams.find(x => x.id === u.team_id) || null;
                    const ents = String(u.entidade || "").split(",").map(s => s.trim()).filter(Boolean);
                    const efetivas = ents.length ? ents : (t?.entidades || []);
                    const pend = u.role === "pendente";
                    return (
                      <tr key={u.id} style={{ background: pend ? "rgba(147,51,234,0.05)" : undefined }}>
                        <td style={td}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_COR[u.role] || "#6B7280", flexShrink: 0 }}/>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{u.nome || <span style={{ color: T.textSm, fontStyle: "italic" }}>sem nome</span>}</div>
                              <div style={{ fontSize: 11, color: T.textSm, whiteSpace: "nowrap" }}>{u.email}{u.funcao ? ` · ${u.funcao}` : ""}</div>
                            </div>
                          </div>
                        </td>
                        <td style={td}>
                          <select value={u.team_id || ""} onChange={e => setTime(u, e.target.value)}
                            style={{ ...IS, padding: "5px 8px", fontSize: 12, minWidth: 130, borderColor: u.team_id ? undefined : "#D9770688", color: t ? T.text : "#D97706" }}>
                            <option value="">— sem time —</option>
                            {teams.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
                          </select>
                        </td>
                        <td style={td}>
                          <select value={u.role} onChange={e => setPapel(u, e.target.value)}
                            style={{ ...IS, padding: "5px 8px", fontSize: 12, minWidth: 130, color: ROLE_COR[u.role] || T.text, fontWeight: 600, borderColor: pend ? "#9333EA88" : undefined }}>
                            {pend && <option value="pendente">Pendente — aprovar como…</option>}
                            <option value="visualizador">Visualizador</option>
                            <option value="admin">Admin</option>
                            <option value="fornecedor">Fornecedor</option>
                          </select>
                        </td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {ENTIDADES_VISUALIZADOR.map(e => <Toggle key={e.id} cor="#2563EB" on={ents.includes(e.id)} onClick={() => toggleEntidade(u, e.id)}>{e.label.split(" - ")[0]}</Toggle>)}
                          </div>
                        </td>
                        <td style={{ ...td, fontSize: 11.5, color: T.textMd, whiteSpace: "nowrap" }}>
                          {u.role === "admin" ? "tudo" : efetivas.length ? efetivas.map(entLabel).join(", ") : <span style={{ color: T.textSm }}>—</span>}
                          <div style={{ fontSize: 10.5, color: T.textSm }}>{ents.length ? "do perfil" : t ? `herdado de ${t.nome}` : "sem time"}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Modal de edição */}
      {editando && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={() => setEditando(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, width: "100%", maxWidth: 620, padding: 24, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontFamily: FONT.display, fontSize: 18, color: T.text }}>{editando.id ? `Editar time · ${editando.nome}` : "Novo time"}</h3>
              <button onClick={() => setEditando(null)} style={{ border: "none", background: "transparent", color: T.textSm, cursor: "pointer" }}><X size={18}/></button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <div>{label("Nome")}<input value={editando.nome} onChange={e => setEditando(s => ({ ...s, nome: e.target.value }))} style={{ ...IS, width: "100%" }} placeholder="ex.: FPF"/></div>
              <div>{label("Cor")}<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{CORES.map(c => <button key={c} type="button" onClick={() => setEditando(s => ({ ...s, cor: c }))} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: editando.cor === c ? `2px solid ${T.text}` : "2px solid transparent", cursor: "pointer" }}/>)}</div></div>
            </div>
            <div>{label("Descrição")}<input value={editando.descricao || ""} onChange={e => setEditando(s => ({ ...s, descricao: e.target.value }))} style={{ ...IS, width: "100%" }} placeholder="opcional"/></div>

            <div>
              {label("Domínios de e-mail")}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {editando.dominios.map(d => (
                  <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, border: `1px solid ${editando.cor}66`, background: `${editando.cor}14`, color: editando.cor, borderRadius: 999, padding: "3px 10px" }}>
                    @{d}<button type="button" onClick={() => setEditando(s => ({ ...s, dominios: s.dominios.filter(x => x !== d) }))} style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: 0, display: "flex" }}><X size={12}/></button>
                  </span>
                ))}
                <input value={novoDominio} onChange={e => setNovoDominio(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const d = normDominio(novoDominio); if (d && !editando.dominios.includes(d)) setEditando(s => ({ ...s, dominios: [...s.dominios, d] })); setNovoDominio(""); } }}
                  onBlur={() => { const d = normDominio(novoDominio); if (d && !editando.dominios.includes(d)) setEditando(s => ({ ...s, dominios: [...s.dominios, d] })); setNovoDominio(""); }}
                  placeholder="empresa.com.br + Enter" style={{ ...IS, width: 200 }}/>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                {label("Papel padrão do cadastro novo")}
                <select value={editando.role_padrao} onChange={e => setEditando(s => ({ ...s, role_padrao: e.target.value }))} style={{ ...IS, width: "100%" }}>
                  {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
              <div>
                {label("Aprovação")}
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.text, cursor: "pointer", paddingTop: 6 }}>
                  <input type="checkbox" checked={!!editando.aprovacao_automatica} onChange={e => setEditando(s => ({ ...s, aprovacao_automatica: e.target.checked }))} style={{ accentColor: T.brand || "#65B32E" }}/>
                  automática pelo domínio
                </label>
                <span style={{ display: "block", fontSize: 11, color: T.textSm }}>Desmarcado: cadastro fica pendente até um admin aprovar.</span>
              </div>
            </div>

            <div>
              {label("Entidades que o time vê")}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ENTIDADES_VISUALIZADOR.map(e => <Toggle key={e.id} cor="#2563EB" on={editando.entidades.includes(e.id)} onClick={() => setEditando(s => ({ ...s, entidades: s.entidades.includes(e.id) ? s.entidades.filter(x => x !== e.id) : [...s.entidades, e.id] }))}>{e.label}</Toggle>)}
              </div>
              <span style={{ display: "block", fontSize: 11, color: T.textSm, marginTop: 6 }}>Vale para visualizadores sem entidade própria no perfil. Campeonatos e orçamentos filtram por essas entidades.</span>
            </div>
            <div>
              {label("Dentro dos campeonatos, o visualizador vê")}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ESCOPOS.map(e => <Toggle key={e.id} cor="#2563EB" on={(editando.escopo || "notas") === e.id} onClick={() => setEditando(s => ({ ...s, escopo: e.id }))}>{e.label}</Toggle>)}
              </div>
              <span style={{ display: "block", fontSize: 11, color: T.textSm, marginTop: 6 }}>{ESCOPOS.find(e => e.id === (editando.escopo || "notas"))?.desc}</span>
            </div>
            <div>
              {label("Módulos liberados ao visualizador")}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {MODULOS.map(m => <Toggle key={m.id} cor="#7C3AED" on={editando.modulos.includes(m.id)} onClick={() => setEditando(s => ({ ...s, modulos: s.modulos.includes(m.id) ? s.modulos.filter(x => x !== m.id) : [...s.modulos, m.id] }))}>{m.label}</Toggle>)}
              </div>
            </div>

            {erro && <p style={{ margin: 0, fontSize: 12, color: T.danger || "#DC2626" }}>{erro}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button T={T} variant="secondary" size="md" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button T={T} variant="primary" size="md" icon={Check} onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar time"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
