import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { logAcao } from "../lib/audit";
import LivemodeLogo from "./LivemodeLogo";
import { IconButton } from "./ui";
import { ArrowLeft, Sun, Moon, LogOut, Users, Plus, Trash2, Mail, UsersRound, ScrollText, ShieldCheck, Activity, Settings } from "lucide-react";
import { FONT, RADIUS } from "../constants";
import TabTimes from "./admin/TabTimes";
import TabAuditLog from "./admin/TabAuditLog";
import TabAcessos from "./admin/TabAcessos";
import TabConfiguracoes from "./admin/TabConfiguracoes";

// Abas da Administração do Portal (fase 1: Usuários · Times · Audit log)
const ABAS_ADMIN = [
  { key: "usuarios", label: "Convites & pendentes", icon: Users },
  { key: "times",    label: "Times",     icon: UsersRound },
  { key: "acessos",  label: "Acessos",   icon: Activity },
  { key: "audit",    label: "Audit log", icon: ScrollText },
  { key: "config",   label: "Configurações", icon: Settings },
];

// ─── Role helpers ─────────────────────────────────────────────────────────────
const ROLE_META = {
  admin:        { label: "Admin",        color: "#16A34A", bg: "rgba(22,163,74,0.10)",   border: "rgba(22,163,74,0.25)"  },
  visualizador: { label: "Visualizador", color: "#2563EB", bg: "rgba(37,99,235,0.10)",   border: "rgba(37,99,235,0.25)"  },
  fornecedor:   { label: "Fornecedor",   color: "#D97706", bg: "rgba(217,119,6,0.10)",   border: "rgba(217,119,6,0.25)"  },
  pendente:     { label: "Pendente",     color: "#9333EA", bg: "rgba(147,51,234,0.10)",  border: "rgba(147,51,234,0.25)" },
};

// ─── Entidade helpers ─────────────────────────────────────────────────────────
// profiles.entidade aceita múltiplos valores separados por vírgula
const ENTIDADE_OPTS = [
  { id: "brasileirao-2026",        label: "FFU"   },
  { id: "paulistao-feminino-2026", label: "FPF"   },
  { id: "outro",                   label: "Outro" },
];
const parseEntidades = (val) => String(val || "").split(",").map(s => s.trim()).filter(Boolean);
const entidadeNome = (id) =>
  id === "brasileirao-2026" ? "FFU - Futebol Forte União" :
  id === "paulistao-feminino-2026" ? "FPF - Federação Paulista de Futebol" : id;

// Texto editável inline: clique para editar, Enter/sair salva, Esc cancela
function InlineEditText({ value, onSave, T, textStyle = {}, width = 140 }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState("");
  const commit = async () => {
    setEditing(false);
    const v = local.trim();
    if (v !== (value || "")) await onSave(v);
  };
  if (!editing) return (
    <span
      onClick={() => { setLocal(value || ""); setEditing(true); }}
      title="Clique para editar"
      style={{ ...textStyle, cursor: "pointer", borderBottom: "1px dashed transparent", display: "inline-block" }}
      onMouseEnter={e => e.currentTarget.style.borderBottomColor = T.textSm}
      onMouseLeave={e => e.currentTarget.style.borderBottomColor = "transparent"}
    >
      {value || <span style={{ color: T.textSm, fontStyle: "italic" }}>—</span>}
    </span>
  );
  return (
    <input
      autoFocus
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setLocal(value || ""); setEditing(false); }
      }}
      style={{
        background: T.surfaceAlt || T.bg, border: `1px solid ${T.border}`,
        borderRadius: 6, padding: "3px 8px", fontSize: 12, color: T.text,
        fontFamily: "'Poppins',sans-serif", outline: "none", width,
      }}
    />
  );
}

function RoleBadge({ role }) {
  const m = ROLE_META[role] || { label: role, color: "#6B7280", bg: "rgba(107,114,128,0.10)", border: "rgba(107,114,128,0.25)" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      background: m.bg, border: `1px solid ${m.border}`, color: m.color,
      borderRadius: RADIUS.pill, padding: "0 10px", height: 22,
      fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
      textTransform: "uppercase", whiteSpace: "nowrap", fontFamily: FONT.ui,
    }}>
      {m.label}
    </span>
  );
}

function StatCard({ label, value, color, T }) {
  return (
    <div style={{
      background: T.surface || T.card,
      border: `1px solid ${T.border}`,
      borderRadius: RADIUS.lg,
      padding: "16px 20px",
      display: "flex", flexDirection: "column", gap: 4,
      flex: 1, minWidth: 120,
    }}>
      <p style={{ color: T.textSm, fontSize: 10, margin: 0, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, fontFamily: FONT.ui }}>{label}</p>
      <p className="num" style={{ color: color || T.text, fontFamily: FONT.display, fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: "-0.005em", lineHeight: 1 }}>{value}</p>
    </div>
  );
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────
function InviteModal({ T, onClose, onSuccess }) {
  const [nome, setNome]     = useState("");
  const [email, setEmail]   = useState("");
  const [role, setRole]     = useState("visualizador");
  const [loading, setLoading] = useState(false);
  const [erro, setErro]     = useState("");

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true); setErro("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('admin-invite', {
        body: { action: 'invite', email, nome, role },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) {
        setErro(data?.error || error?.message || "Erro ao convidar");
        setLoading(false);
        return;
      }
      await logAcao("user_invited", { email, nome, role });
      onSuccess();
      onClose();
    } catch (err) {
      setErro(String(err));
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: T.surfaceAlt || T.bg,
    border: `1px solid ${T.borderStrong || T.border}`,
    borderRadius: 8, padding: "10px 14px",
    fontSize: 13, color: T.text,
    fontFamily: "'Poppins',sans-serif",
    outline: "none",
  };

  const labelStyle = {
    display: "block",
    fontSize: 11, fontWeight: 600, color: T.textMd,
    letterSpacing: "0.06em", textTransform: "uppercase",
    marginBottom: 6, fontFamily: FONT.ui,
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: T.surface || T.card,
        border: `1px solid ${T.border}`,
        borderRadius: RADIUS.xl || 16,
        padding: 28,
        width: "100%", maxWidth: 420,
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text, letterSpacing: "-0.005em" }}>
              Convidar usuário
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: T.textMd, fontFamily: FONT.ui }}>
              O convite é enviado por e-mail via Supabase
            </p>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: T.textMd, fontSize: 18, padding: 4, lineHeight: 1,
          }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Nome</label>
            <input
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Nome completo"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>E-mail *</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="usuario@livemode.com"
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Perfil de acesso</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="admin">Admin</option>
              <option value="visualizador">Visualizador</option>
              <option value="fornecedor">Fornecedor</option>
            </select>
          </div>

          {erro && (
            <p style={{ color: "#DC2626", fontSize: 12, margin: 0, fontWeight: 500, textAlign: "center" }}>{erro}</p>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, background: "transparent",
              border: `1px solid ${T.border}`, borderRadius: 7,
              padding: "10px", fontSize: 13, fontWeight: 500,
              cursor: "pointer", color: T.textMd, fontFamily: "'Poppins',sans-serif",
            }}>Cancelar</button>
            <button type="submit" disabled={loading} style={{
              flex: 1,
              background: T.brand || "#65B32E", color: "#fff",
              border: "none", borderRadius: 7,
              padding: "10px", fontSize: 13, fontWeight: 500,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
              fontFamily: "'Poppins',sans-serif",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
              <Mail size={14} strokeWidth={2.25}/>
              {loading ? "Enviando..." : "Enviar convite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Approval Modal ───────────────────────────────────────────────────────────
function ApprovalModal({ user, T, onApprove, onDeny, onClose }) {
  const [role, setRole] = useState("visualizador");
  const [loading, setLoading] = useState(false);

  const inputStyle = {
    width:"100%", boxSizing:"border-box",
    background:T.surfaceAlt||T.bg, border:`1px solid ${T.border}`,
    borderRadius:8, padding:"10px 14px", fontSize:13, color:T.text,
    fontFamily:"'Poppins',sans-serif", outline:"none", cursor:"pointer",
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:1100, background:"rgba(0,0,0,0.65)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:T.surface||T.card, border:`1px solid ${T.border}`, borderRadius:16, padding:28, width:"100%", maxWidth:400, boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>
        <h3 style={{ margin:"0 0 4px", fontFamily:FONT.display, fontSize:18, fontWeight:700, color:T.text }}>Aprovar cadastro</h3>
        <p style={{ margin:"0 0 20px", fontSize:12, color:T.textMd, fontFamily:FONT.ui, lineHeight:1.8 }}>
          <strong style={{ color:T.text }}>{user.nome || user.email}</strong>
          {user.funcao && <span> · {user.funcao}</span>}
          {user.entidade && <><br/><span>{parseEntidades(user.entidade).map(entidadeNome).join(", ")}</span></>}
          <br/><span style={{ color:T.textSm }}>{user.email}</span>
        </p>

        <label style={{ display:"block", fontSize:11, fontWeight:600, color:T.textMd, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6, fontFamily:FONT.ui }}>
          Perfil de acesso
        </label>
        <select value={role} onChange={e => setRole(e.target.value)} style={inputStyle}>
          <option value="visualizador">Visualizador</option>
          <option value="fornecedor">Fornecedor</option>
          <option value="admin">Admin</option>
        </select>

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={async () => { setLoading(true); await onDeny(user); onClose(); }} disabled={loading} style={{
            flex:1, background:"rgba(220,38,38,0.08)", border:"1px solid rgba(220,38,38,0.25)",
            color:"#DC2626", borderRadius:7, padding:"10px", fontSize:13, fontWeight:500,
            cursor:"pointer", fontFamily:"'Poppins',sans-serif",
          }}>Negar</button>
          <button onClick={async () => { setLoading(true); await onApprove(user.id, role); onClose(); }} disabled={loading} style={{
            flex:2, background:T.brand||"#65B32E", color:"#fff",
            border:"none", borderRadius:7, padding:"10px", fontSize:13, fontWeight:500,
            cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1,
            fontFamily:"'Poppins',sans-serif",
          }}>{loading ? "Salvando..." : "Aprovar"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminUsuarios({ onBack, T, darkMode, setDarkMode, onSignOut, currentUser }) {
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [roleUpdating, setRoleUpdating] = useState({});
  const [entUpdating, setEntUpdating]   = useState({});
  const [approving, setApproving]   = useState(null);
  const [aba, setAba]               = useState("usuarios");
  const [teamsRef, setTeamsRef]     = useState([]);   // só para mostrar o time na lista (controles ficam na aba Times)
  useEffect(() => {
    const load = () => supabase.from('teams').select('id, nome, cor').order('created_at').then(({ data }) => setTeamsRef(data || []));
    load();
    const ch = supabase.channel('admin-teams-ref').on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    setUsers(data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();

    const channel = supabase
      .channel('profiles-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' },
        payload => setUsers(prev => [payload.new, ...prev]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' },
        payload => setUsers(prev => prev.map(u => u.id === payload.new.id ? payload.new : u)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'profiles' },
        payload => setUsers(prev => prev.filter(u => u.id !== payload.old.id)))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleRoleChange = async (userId, newRole) => {
    setRoleUpdating(r => ({ ...r, [userId]: true }));
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    await supabase.rpc('log_audit_action', { p_action: 'role_change', p_target_user_id: userId, p_details: { new_role: newRole } });
    setUsers(us => us.map(u => u.id === userId ? { ...u, role: newRole } : u));
    setRoleUpdating(r => ({ ...r, [userId]: false }));
  };

  const handleCampoChange = async (userId, campo, valor) => {
    const v = valor || null;
    await supabase.from('profiles').update({ [campo]: v }).eq('id', userId);
    await supabase.rpc('log_audit_action', { p_action: 'profile_update', p_target_user_id: userId, p_details: { campo, valor: v } });
    setUsers(us => us.map(u => u.id === userId ? { ...u, [campo]: v } : u));
  };

  const handleToggleEntidade = async (u, entId) => {
    const atual = parseEntidades(u.entidade);
    const novas = atual.includes(entId) ? atual.filter(e => e !== entId) : [...atual, entId];
    const newEntidade = novas.join(",") || null;
    setEntUpdating(r => ({ ...r, [u.id]: true }));
    await supabase.from('profiles').update({ entidade: newEntidade }).eq('id', u.id);
    await supabase.rpc('log_audit_action', { p_action: 'entidade_change', p_target_user_id: u.id, p_details: { new_entidade: newEntidade } });
    setUsers(us => us.map(x => x.id === u.id ? { ...x, entidade: newEntidade } : x));
    setEntUpdating(r => ({ ...r, [u.id]: false }));
  };

  const handleApprove = async (userId, newRole) => {
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    await supabase.rpc('log_audit_action', { p_action: 'user_approved', p_target_user_id: userId, p_details: { new_role: newRole } });
    setUsers(us => us.map(u => u.id === userId ? { ...u, role: newRole } : u));
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Excluir o usuário "${u.nome || u.email}"?\n\nEsta ação é irreversível.`)) return;
    await supabase.rpc('log_audit_action', { p_action: 'user_deleted', p_target_user_id: u.id, p_details: { email: u.email, nome: u.nome } });
    const { error } = await supabase.rpc('admin_delete_user', { user_id: u.id });
    if (error) { alert(`Erro ao excluir: ${error.message}`); return; }
    setUsers(us => us.filter(x => x.id !== u.id));
  };

  // Stats
  const total          = users.length;
  const adminCount     = users.filter(u => u.role === 'admin').length;
  const vizCount       = users.filter(u => u.role === 'visualizador').length;
  const fornCount      = users.filter(u => u.role === 'fornecedor').length;
  const pendCount      = users.filter(u => u.role === 'pendente').length;

  // Pendentes primeiro
  const sortedUsers = [...users].sort((a, b) => {
    if (a.role === 'pendente' && b.role !== 'pendente') return -1;
    if (b.role === 'pendente' && a.role !== 'pendente') return 1;
    return 0;
  });

  const thStyle = {
    padding: "11px 16px",
    textAlign: "left",
    color: T.textSm,
    fontSize: 10, fontWeight: 700,
    letterSpacing: "0.06em", textTransform: "uppercase",
    whiteSpace: "nowrap",
    borderBottom: `1px solid ${T.border}`,
    fontFamily: FONT.ui,
  };

  const tdStyle = {
    padding: "13px 16px",
    borderTop: `1px solid ${T.border}`,
    fontSize: 13, color: T.text,
    fontFamily: "'Poppins',sans-serif",
    verticalAlign: "middle",
  };

  const fmtDate = d => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  return (
    <div className="page-enter" style={{
      minHeight: "100vh", background: T.bg, color: T.text,
      fontFamily: "'Poppins',sans-serif", display: "flex",
    }}>
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside style={{
        width: 72, minHeight: "100vh",
        background: T.gradSidebar || "linear-gradient(180deg,#111111 0%,#0d0d0d 100%)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        display: "flex", flexDirection: "column",
        alignItems: "center",
        paddingTop: 16, paddingBottom: 16, gap: 6,
        flexShrink: 0, position: "sticky", top: 0, height: "100vh",
      }}>
        <div style={{ marginBottom: 12 }}>
          <LivemodeLogo size={40} onClick={onBack} title="Voltar ao portal"/>
        </div>
        <div style={{ width: 32, height: 1, background: "rgba(255,255,255,0.06)", marginBottom: 8 }}/>
        <IconButton icon={ArrowLeft} title="Voltar" onClick={onBack} size={44} T={T}/>
        <div style={{ flex: 1 }}/>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <IconButton
            icon={darkMode ? Sun : Moon}
            title={darkMode ? "Modo claro" : "Modo escuro"}
            onClick={() => setDarkMode(d => !d)}
            size={40} T={T}
          />
          <IconButton icon={LogOut} title="Sair" onClick={onSignOut} size={40} T={T}/>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 60, background: T.bg }}>
        {/* Header */}
        <div style={{
          background: T.surface || T.card,
          borderBottom: `1px solid ${T.border}`,
          padding: "20px 32px",
          display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: 16, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12,
              background: "rgba(101,179,46,0.12)",
              border: "1px solid rgba(101,179,46,0.28)",
              color: T.brand || "#65B32E",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Users size={20} strokeWidth={2.25}/>
            </div>
            <div>
              <p style={{
                color: T.brand || "#65B32E", fontSize: 10,
                letterSpacing: "0.16em", textTransform: "uppercase",
                margin: "0 0 3px", fontWeight: 600, fontFamily: FONT.ui,
              }}>Livemode · Admin</p>
              <h1 style={{
                fontFamily: FONT.display, fontSize: 22, fontWeight: 700,
                margin: 0, color: T.text, letterSpacing: "-0.005em", lineHeight: 1.1,
              }}>Administração do Portal</h1>
            </div>
          </div>

        </div>

        {/* Abas da administração */}
        <div style={{ background: T.surface || T.card, borderBottom: `1px solid ${T.border}`, padding: "0 32px", display: "flex", gap: 4 }}>
          {ABAS_ADMIN.map(({ key, label, icon: Icon }) => {
            const on = aba === key;
            return (
              <button key={key} onClick={() => setAba(key)} style={{
                display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 16px",
                border: "none", borderBottom: `2px solid ${on ? (T.brand || "#65B32E") : "transparent"}`,
                background: "transparent", cursor: "pointer", fontFamily: FONT.ui,
                fontSize: 12.5, fontWeight: 600, color: on ? (T.brand || "#65B32E") : T.textMd,
              }}>
                <Icon size={14} strokeWidth={2.25}/>{label}
                {key === "usuarios" && pendCount > 0 && <span style={{ background: "#9333EA", color: "#fff", borderRadius: 999, fontSize: 10, padding: "0 7px", height: 18, display: "inline-flex", alignItems: "center", fontWeight: 700 }}>{pendCount}</span>}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "28px 32px" }}>
          {aba === "times" && <TabTimes T={T} users={users} onUsersChanged={loadUsers}/>}
          {aba === "audit" && <TabAuditLog T={T} users={users}/>}
          {aba === "acessos" && <TabAcessos T={T} users={users}/>}
          {aba === "config" && <TabConfiguracoes T={T} currentUser={currentUser}/>}
          {aba === "usuarios" && (<>
          {/* ── Convites ── */}
          <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "16px 20px", marginBottom: 18, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)" }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(8,145,178,0.12)", color: "#0891B2", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Mail size={18} strokeWidth={2.25}/></span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: T.text }}>Convites</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: T.textMd, lineHeight: 1.5 }}>
                O convidado recebe um e-mail para criar a senha. Se o domínio casar com um time com aprovação automática, entra direto; senão aparece em Pendentes.
                Time, papel e entidades de cada um são decididos na aba <b>Times</b>.
              </p>
            </div>
            <button onClick={() => setShowInvite(true)} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.brand || "#65B32E", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "'Poppins',sans-serif" }}>
              <Plus size={15} strokeWidth={2.25}/> Convidar por e-mail
            </button>
          </div>

          {/* ── Pendentes ── */}
          <div style={{ background: T.surface || T.card, border: `1px solid ${pendCount ? "rgba(147,51,234,0.35)" : T.border}`, borderRadius: RADIUS.lg, marginBottom: 18, overflow: "hidden", boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>⏳</span>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: pendCount ? "#9333EA" : T.text }}>
                Pendentes de aprovação {pendCount > 0 && <span style={{ background: "#9333EA", color: "#fff", borderRadius: 999, fontSize: 10, padding: "1px 8px", marginLeft: 6 }}>{pendCount}</span>}
              </p>
            </div>
            {pendCount === 0 ? (
              <p style={{ margin: 0, padding: "14px 20px", fontSize: 12.5, color: T.textSm }}>Nenhum cadastro aguardando aprovação.</p>
            ) : (
              <div>
                {sortedUsers.filter(u => u.role === 'pendente').map(u => (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 20px", borderTop: `1px solid ${T.border}`, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{u.nome || <span style={{ color: T.textSm, fontStyle: "italic" }}>sem nome</span>}</div>
                      <div style={{ fontSize: 11.5, color: T.textSm }}>{u.email}{u.funcao ? ` · ${u.funcao}` : ""}{u.entidade ? ` · pediu: ${parseEntidades(u.entidade).map(entidadeNome).join(", ")}` : ""} · cadastro em {fmtDate(u.created_at)}</div>
                    </div>
                    <button onClick={() => setApproving(u)} style={{ background: "rgba(147,51,234,0.1)", border: "1px solid rgba(147,51,234,0.3)", color: "#9333EA", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins',sans-serif" }}>Revisar e aprovar ▸</button>
                    <button onClick={() => handleDelete(u)} title="Recusar e excluir" style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", color: T.danger || "#DC2626", borderRadius: 7, width: 32, height: 32, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={14}/></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Todos os usuários (lista simples; controles ficam na aba Times) ── */}
          <div style={{ display: "flex", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
            <StatCard label="Total" value={total} color={T.text} T={T}/>
            <StatCard label="Admins" value={adminCount} color="#16A34A" T={T}/>
            <StatCard label="Visualizadores" value={vizCount} color="#2563EB" T={T}/>
            <StatCard label="Fornecedores" value={fornCount} color="#D97706" T={T}/>
          </div>
          <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, overflow: "hidden", boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)" }}>
            {loading ? (
              <div style={{ padding: 48, textAlign: "center" }}><p style={{ color: T.textMd, fontSize: 13 }}>Carregando usuários...</p></div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: T.surfaceAlt || T.bg }}>
                      <th style={thStyle}>Nome</th>
                      <th style={thStyle}>Função</th>
                      <th style={thStyle}>E-mail</th>
                      <th style={thStyle}>Time</th>
                      <th style={thStyle}>Papel</th>
                      <th style={thStyle}>Criado em</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>Excluir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedUsers.filter(u => u.role !== 'pendente').map(u => {
                      const isMe = u.id === currentUser?.id;
                      const t = teamsRef.find(x => x.id === u.team_id) || null;
                      return (
                        <tr key={u.id} style={{ background: isMe ? (T.brandSoft || "rgba(101,179,46,0.04)") : "transparent" }}>
                          <td style={tdStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 30, height: 30, borderRadius: "50%", background: T.surfaceAlt || T.bg, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: T.textMd, flexShrink: 0 }}>
                                {(u.nome || u.email || "?").charAt(0).toUpperCase()}
                              </div>
                              <InlineEditText value={u.nome} onSave={v => handleCampoChange(u.id, 'nome', v)} T={T} textStyle={{ fontWeight: isMe ? 600 : 400, fontSize: 13, color: T.text }}/>
                              {isMe && <span style={{ fontSize: 10, color: T.textSm, fontWeight: 500, background: T.surfaceAlt || T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.pill, padding: "0 7px", height: 18, display: "inline-flex", alignItems: "center", fontFamily: FONT.ui, letterSpacing: "0.04em" }}>você</span>}
                            </div>
                          </td>
                          <td style={{ ...tdStyle, color: T.textMd, fontSize: 12 }}>
                            <InlineEditText value={u.funcao} onSave={v => handleCampoChange(u.id, 'funcao', v)} T={T} textStyle={{ fontSize: 12, color: T.textMd }}/>
                          </td>
                          <td style={{ ...tdStyle, color: T.textMd, fontSize: 12 }}>{u.email || "—"}</td>
                          <td style={{ ...tdStyle, fontSize: 12 }}>
                            {t ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.text }}><span style={{ width: 8, height: 8, borderRadius: 2, background: t.cor || "#65B32E" }}/>{t.nome}</span>
                               : <button onClick={() => setAba("times")} style={{ border: "1px dashed #D9770688", background: "transparent", color: "#D97706", borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer", fontFamily: FONT.ui }}>sem time · definir</button>}
                          </td>
                          <td style={tdStyle}><RoleBadge role={u.role}/></td>
                          <td style={{ ...tdStyle, color: T.textMd, fontSize: 12 }}>{fmtDate(u.created_at)}</td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            {!isMe && (
                              <button onClick={() => handleDelete(u)} title="Excluir usuário" style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", color: T.danger || "#DC2626", borderRadius: 7, width: 32, height: 32, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                                <Trash2 size={14} strokeWidth={2.25}/>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>)}
        </div>
      </div>

      {showInvite && (
        <InviteModal T={T} onClose={() => setShowInvite(false)} onSuccess={loadUsers}/>
      )}
      {approving && (
        <ApprovalModal
          user={approving}
          T={T}
          onApprove={handleApprove}
          onDeny={handleDelete}
          onClose={() => setApproving(null)}
        />
      )}
    </div>
  );
}
