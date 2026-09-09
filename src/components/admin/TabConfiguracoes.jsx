import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { logAcao } from "../../lib/audit";
import { carregarConfig, getConfig, salvarConfig, onConfigChange, slugEntidade } from "../../lib/portalConfig";
import { ENTIDADES_VISUALIZADOR } from "../../config/entities";
import { FONT, RADIUS } from "../../constants";
import { Button, Badge } from "../ui";
import { Shield, Globe, FileText, ScrollText, Plus, X, Check, Trash2, RefreshCw, AlertTriangle } from "lucide-react";

// ─── CONFIGURAÇÕES DO PORTAL ──────────────────────────────────────────────────
// 1) Entidades (fixas + extras)  2) Cadastro (domínios permitidos, Google)
// 3) Texto LGPD do cadastro       4) Retenção do audit log (+ limpeza manual)
const FIXAS = ["brasileirao-2026", "paulistao-feminino-2026", "outro"];
const normDominio = (d) => String(d || "").trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

export default function TabConfiguracoes({ T, currentUser }) {
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState("");
  const [teams, setTeams] = useState([]);
  const [purge, setPurge] = useState(null);      // { antigos, retencao_dias }
  // rascunhos locais
  const [extras, setExtras] = useState([]);
  const [novaEnt, setNovaEnt] = useState({ id: "", label: "" });
  const [signup, setSignup] = useState({ bloquear_desconhecidos: false, dominios_permitidos: [], google_dominios: [] });
  const [novoDom, setNovoDom] = useState(""); const [novoGoogle, setNovoGoogle] = useState("");
  const [lgpd, setLgpd] = useState([]);
  const [retencao, setRetencao] = useState(365);
  const [ultimaLimpeza, setUltimaLimpeza] = useState(null);

  const puxar = () => {
    setExtras([...(getConfig("entidades_extras") || [])]);
    const s = getConfig("signup") || {}; setSignup({ bloquear_desconhecidos: !!s.bloquear_desconhecidos, dominios_permitidos: [...(s.dominios_permitidos || [])], google_dominios: [...(s.google_dominios || [])] });
    setLgpd([...((getConfig("lgpd") || {}).itens || [])].map(i => ({ ...i })));
    const a = getConfig("audit") || {}; setRetencao(a.retencao_dias || 365); setUltimaLimpeza(a.ultima_limpeza || null);
    setTick(t => t + 1);
  };
  useEffect(() => {
    let vivo = true;
    (async () => {
      await carregarConfig();
      const { data } = await supabase.from("teams").select("id, nome, cor, dominios");
      if (!vivo) return;
      setTeams(data || []); puxar(); setLoading(false);
      const { data: p } = await supabase.rpc("audit_log_purge", { p_dry_run: true });
      if (vivo && p?.[0]) setPurge(p[0]);
    })();
    const off = onConfigChange(() => { if (vivo) setTick(t => t + 1); });
    return () => { vivo = false; off(); };
  }, []);

  const ok = (msg) => { setSalvo(msg); setErro(""); setTimeout(() => setSalvo(""), 2500); };
  const salvar = async (key, value, acaoDetalhe) => {
    try { await salvarConfig(key, value, currentUser?.id || null); await logAcao("config_update", { key, ...acaoDetalhe }); ok("Salvo."); }
    catch (e) { setErro(e.message); }
  };

  // ── Entidades ──
  const addExtra = () => {
    const label = novaEnt.label.trim(); const id = slugEntidade(novaEnt.id || label);
    if (!label || !id) return;
    if (FIXAS.includes(id) || extras.some(e => e.id === id)) { setErro(`Já existe uma entidade com o id "${id}".`); return; }
    const next = [...extras, { id, label }]; setExtras(next); setNovaEnt({ id: "", label: "" });
    salvar("entidades_extras", next, { entidade: id });
  };
  const rmExtra = (id) => {
    const emUso = teams.filter(t => (t.entidades || []).includes(id)).map(t => t.nome);
    if (emUso.length && !window.confirm(`A entidade "${id}" está em uso pelos times ${emUso.join(", ")}. Remover mesmo assim? (os times passam a não ver nada dela)`)) return;
    const next = extras.filter(e => e.id !== id); setExtras(next); salvar("entidades_extras", next, { removida: id });
  };

  // ── Cadastro ──
  const salvarSignup = (patch) => { const next = { ...signup, ...patch }; setSignup(next); salvar("signup", next, patch); };
  const dominiosTimes = useMemo(() => [...new Set(teams.flatMap(t => (t.dominios || []).map(d => d.toLowerCase())))], [teams]);

  // ── LGPD ──
  const salvarLgpd = () => salvar("lgpd", { itens: lgpd.filter(i => i.titulo?.trim() || i.texto?.trim()) }, { itens: lgpd.length });

  // ── Audit ──
  const salvarRetencao = async () => { await salvar("audit", { retencao_dias: Math.max(30, parseInt(retencao) || 365), ultima_limpeza: ultimaLimpeza }, { retencao_dias: retencao }); const { data } = await supabase.rpc("audit_log_purge", { p_dry_run: true }); if (data?.[0]) setPurge(data[0]); };
  const limparAgora = async () => {
    if (!purge?.antigos) return;
    if (!window.confirm(`Apagar ${purge.antigos} evento(s) com mais de ${purge.retencao_dias} dias do audit log? Não dá para desfazer.`)) return;
    const { data, error } = await supabase.rpc("audit_log_purge", { p_dry_run: false });
    if (error) { setErro(error.message); return; }
    await logAcao("audit_purge", { apagados: data?.[0]?.apagados || 0, retencao_dias: data?.[0]?.retencao_dias });
    ok(`${data?.[0]?.apagados || 0} evento(s) apagados.`);
    await carregarConfig(); puxar();
    const { data: p } = await supabase.rpc("audit_log_purge", { p_dry_run: true }); if (p?.[0]) setPurge(p[0]);
  };

  const IS = { background: T.surfaceAlt || T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 10px", fontSize: 12.5, color: T.text, fontFamily: FONT.ui, outline: "none" };
  const label = (txt) => <span style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.textSm, marginBottom: 6 }}>{txt}</span>;
  const Card = ({ icon: Icon, cor, titulo, sub, children }) => (
    <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${cor}`, borderRadius: RADIUS.lg, padding: 18, display: "flex", flexDirection: "column", gap: 14, boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: `${cor}16`, color: cor, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon size={16}/></span>
        <div><h4 style={{ margin: 0, fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text }}>{titulo}</h4>{sub && <p style={{ margin: "2px 0 0", fontSize: 11.5, color: T.textSm }}>{sub}</p>}</div>
      </div>
      {children}
    </div>
  );
  const Chip = ({ cor, children, onRemove }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, border: `1px solid ${cor}66`, background: `${cor}14`, color: cor, borderRadius: 999, padding: "3px 10px" }}>
      {children}{onRemove && <button type="button" onClick={onRemove} style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: 0, display: "flex" }}><X size={12}/></button>}
    </span>
  );
  const ChipInput = ({ value, setValue, onAdd, placeholder }) => (
    <input value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder} style={{ ...IS, width: 200 }}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }} onBlur={onAdd}/>
  );

  if (loading) return <p style={{ color: T.textMd, fontSize: 13 }}>Carregando configurações...</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {(erro || salvo) && <p style={{ margin: 0, fontSize: 12, color: erro ? (T.danger || "#DC2626") : "#16A34A" }}>{erro || salvo}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
        {/* 1 · Entidades */}
        <Card icon={Shield} cor="#2563EB" titulo="Entidades" sub="Quem paga e vê os campeonatos/orçamentos. As três fixas não saem; extras podem ser criadas para novos organizadores.">
          <div>
            {label("Fixas")}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{ENTIDADES_VISUALIZADOR.filter(e => FIXAS.includes(e.id)).map(e => <Chip key={e.id} cor="#6B7280">{e.label}</Chip>)}</div>
          </div>
          <div>
            {label(`Extras (${extras.length})`)}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {extras.map(e => <Chip key={e.id} cor="#2563EB" onRemove={() => rmExtra(e.id)}>{e.label} <span style={{ opacity: .6 }}>· {e.id}</span></Chip>)}
              {extras.length === 0 && <span style={{ fontSize: 12, color: T.textSm }}>nenhuma</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>{label("Nome")}<input value={novaEnt.label} onChange={e => setNovaEnt(s => ({ ...s, label: e.target.value, id: s.id || "" }))} placeholder="ex.: FMF - Federação Mineira" style={{ ...IS, width: "100%" }}/></div>
            <div style={{ width: 170 }}>{label("Id (opcional)")}<input value={novaEnt.id} onChange={e => setNovaEnt(s => ({ ...s, id: e.target.value }))} placeholder={slugEntidade(novaEnt.label) || "gerado do nome"} style={{ ...IS, width: "100%" }}/></div>
            <Button T={T} variant="primary" size="sm" icon={Plus} onClick={addExtra} disabled={!novaEnt.label.trim()}>Adicionar</Button>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: T.textSm }}>Uma entidade nova aparece nos selects de organizador (campeonato custom, orçamento) e nos toggles de times e usuários.</p>
        </Card>

        {/* 2 · Cadastro */}
        <Card icon={Globe} cor="#0891B2" titulo="Cadastro e login" sub="Quem pode criar conta no Hub e com quais domínios o login Google é aceito.">
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12.5, color: T.text, cursor: "pointer" }}>
            <input type="checkbox" checked={signup.bloquear_desconhecidos} onChange={e => salvarSignup({ bloquear_desconhecidos: e.target.checked })} style={{ accentColor: T.brand || "#65B32E", marginTop: 3 }}/>
            <span><b>Bloquear cadastro de domínios desconhecidos</b><span style={{ display: "block", fontSize: 11, color: T.textSm }}>Com isso ligado, só e-mails dos domínios dos times ou da lista abaixo conseguem criar conta. O bloqueio é no banco, antes de criar o usuário.</span></span>
          </label>
          <div>
            {label("Domínios dos times (já permitidos)")}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{dominiosTimes.length ? dominiosTimes.map(d => <Chip key={d} cor="#6B7280">@{d}</Chip>) : <span style={{ fontSize: 12, color: T.textSm }}>nenhum — cadastre em Times</span>}</div>
          </div>
          <div>
            {label("Outros domínios permitidos")}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {signup.dominios_permitidos.map(d => <Chip key={d} cor="#0891B2" onRemove={() => salvarSignup({ dominios_permitidos: signup.dominios_permitidos.filter(x => x !== d) })}>@{d}</Chip>)}
              <ChipInput value={novoDom} setValue={setNovoDom} placeholder="empresa.com.br + Enter" onAdd={() => { const d = normDominio(novoDom); if (d && !signup.dominios_permitidos.includes(d)) salvarSignup({ dominios_permitidos: [...signup.dominios_permitidos, d] }); setNovoDom(""); }}/>
            </div>
          </div>
          <div>
            {label("Login com Google aceito para")}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {signup.google_dominios.map(d => <Chip key={d} cor="#D97706" onRemove={() => salvarSignup({ google_dominios: signup.google_dominios.filter(x => x !== d) })}>@{d}</Chip>)}
              <ChipInput value={novoGoogle} setValue={setNovoGoogle} placeholder="dominio.com + Enter" onAdd={() => { const d = normDominio(novoGoogle); if (d && !signup.google_dominios.includes(d)) salvarSignup({ google_dominios: [...signup.google_dominios, d] }); setNovoGoogle(""); }}/>
            </div>
            {signup.google_dominios.length === 0 && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#D97706", display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={12}/> Sem domínio, qualquer conta Google entra. Adicione ao menos um.</p>}
          </div>
        </Card>

        {/* 3 · LGPD */}
        <Card icon={FileText} cor="#7C3AED" titulo="Texto de privacidade (LGPD)" sub="Itens exibidos na Política de Privacidade da tela de cadastro. Controlador, DPO e base legal são fixos.">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lgpd.map((it, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 1fr 28px", gap: 8, alignItems: "start" }}>
                <input value={it.titulo || ""} onChange={e => setLgpd(l => l.map((x, j) => j === i ? { ...x, titulo: e.target.value } : x))} placeholder="Título" style={{ ...IS, fontWeight: 600 }}/>
                <textarea value={it.texto || ""} onChange={e => setLgpd(l => l.map((x, j) => j === i ? { ...x, texto: e.target.value } : x))} placeholder="Texto" rows={2} style={{ ...IS, resize: "vertical", lineHeight: 1.4 }}/>
                <button onClick={() => setLgpd(l => l.filter((_, j) => j !== i))} title="Remover" style={{ border: "none", background: "transparent", color: T.textSm, cursor: "pointer", padding: 4 }}><Trash2 size={13}/></button>
              </div>
            ))}
            {lgpd.length === 0 && <span style={{ fontSize: 12, color: T.textSm }}>Sem itens — a tela de cadastro mostra só os fixos.</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button T={T} variant="secondary" size="sm" icon={Plus} onClick={() => setLgpd(l => [...l, { titulo: "", texto: "" }])}>Item</Button>
            <span style={{ flex: 1 }}/>
            <Button T={T} variant="secondary" size="sm" icon={RefreshCw} onClick={puxar}>Descartar</Button>
            <Button T={T} variant="primary" size="sm" icon={Check} onClick={salvarLgpd}>Salvar texto</Button>
          </div>
        </Card>

        {/* 4 · Audit log */}
        <Card icon={ScrollText} cor="#D97706" titulo="Retenção do audit log" sub="Eventos mais antigos que a retenção podem ser apagados. Não há agendamento automático neste projeto: a limpeza é feita aqui.">
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>{label("Reter por (dias, mínimo 30)")}<input value={retencao} onChange={e => setRetencao(e.target.value.replace(/\D/g, ""))} inputMode="numeric" style={{ ...IS, width: 120, textAlign: "right", fontFamily: FONT.num }}/></div>
            <Button T={T} variant="secondary" size="sm" icon={Check} onClick={salvarRetencao}>Salvar retenção</Button>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: T.textMd }}>
            <span><b style={{ color: T.text }}>{purge?.antigos ?? "—"}</b> evento{purge?.antigos === 1 ? "" : "s"} além da retenção</span>
            <span style={{ color: T.textSm }}>última limpeza: {ultimaLimpeza ? new Date(ultimaLimpeza).toLocaleString("pt-BR") : "nunca"}</span>
            <span style={{ flex: 1 }}/>
            <Button T={T} variant={purge?.antigos ? "danger" : "secondary"} size="sm" icon={Trash2} onClick={limparAgora} disabled={!purge?.antigos}>Limpar agora</Button>
          </div>
          {purge?.antigos > 0 && <Badge T={T} color="#D97706" size="sm">há eventos para apagar</Badge>}
        </Card>
      </div>
    </div>
  );
}
