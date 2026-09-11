import { useEffect, useMemo, useRef, useState } from "react";
import { publicoOrcamento } from "../../lib/supabase";
import { ORC_STATUS, calcTotais, diffBaseline } from "../../data/orcamentos";
import { fmt } from "../../utils";
import { SubTabNav } from "./OrcamentoEditor";
import SubResumo from "./SubResumo";
import { Radio, Lock, GitCompareArrows, LineChart, ExternalLink, Sparkles, MinusCircle, AlertCircle } from "lucide-react";

// ─── ORÇAMENTO PÚBLICO (#orcamento/<token>) ──────────────────────────────────
// Apresentação para a entidade, sem login: explicativa e no nível de GRUPO.
//   • Abertura: total pedido × base da edição anterior (orçado e realizado).
//   • Comparativo (aba principal): um bloco por grupo com base, pedido, variação
//     e a EXPLICAÇÃO escrita no Hub (orc.explicacoes[grupo]); embaixo só o que o
//     número não conta — add-ons, removidos, orçado sem gasto — por nome, sem valor.
//   • Resumo: os macro grupos do Hub (variáveis × fixos).
//   • Detalhe por jogo/linha NÃO entra: quem precisar é direcionado ao Hub.
// Relê o documento a cada POLL_MS e ao voltar o foco: edição no Hub aparece aqui
// em segundos. Nada grava (setOrc no-op, readOnly=true).
const POLL_MS = 4000;

const TEMA = (cor) => ({
  bg:"#eef0f4", card:"#ffffff", surface:"#ffffff", surfaceAlt:"#f1f5f9",
  border:"#e2e8f0", borderStrong:"#cbd5e1", muted:"#cbd5e1",
  text:"#0b1220", textMd:"#475569", textSm:"#64748b",
  brand: cor || "#059669", brandSoft:"rgba(5,150,105,0.10)", brandBorder:"rgba(5,150,105,0.32)",
  info:"#2563eb", warning:"#d97706", danger:"#dc2626", success:"#16a34a",
});
const COR_MAIS = "#DC2626", COR_MENOS = "#16A34A";
const TABS = [
  { key:"comparativo", label:"Comparativo", icon:GitCompareArrows },
  { key:"resumo",      label:"Resumo",      icon:LineChart },
];
const hora = (d) => { try { return new Date(d).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", second:"2-digit" }); } catch { return ""; } };
const pct = (delta, ref) => ref ? `${delta >= 0 ? "+" : "−"}${Math.abs((delta / ref) * 100).toFixed(1)}%` : null;
const fmtDelta = (d) => Math.round(d) === 0 ? "sem variação" : `${d > 0 ? "+" : "−"} ${fmt(Math.abs(d))}`;

// Número grande de abertura
const Numero = ({ T, label, valor, sub, cor }) => (
  <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px 18px", minWidth:200, flex:"1 1 200px" }}>
    <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:T.textSm }}>{label}</div>
    <div style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.02em", color: cor || T.text, marginTop:4, fontVariantNumeric:"tabular-nums" }}>{valor}</div>
    {sub && <div style={{ fontSize:12, color:T.textMd, marginTop:2 }}>{sub}</div>}
  </div>
);

// Bloco de um grupo do comparativo (nível de grupo, sem linhas com valor)
function BlocoGrupo({ T, titulo, cor, tot, refReal, blLabel, atualLabel, explicacao, rows }) {
  const refValor = refReal ? tot.totalReal : tot.totalBase;
  const delta = tot.totalAtual - refValor;
  const dcor = delta > 0 ? COR_MAIS : delta < 0 ? COR_MENOS : T.textSm;
  const status = refReal ? "statusReal" : "status";
  const addons = rows.filter(r => r[status] === "addon").map(r => r.label);
  const removidos = rows.filter(r => r[status] === "removido").map(r => r.labelBase || r.label);
  const naoReal = refReal ? rows.filter(r => r[status] === "nao_realizado").map(r => r.labelBase || r.label) : [];
  const Lista = ({ icon:Icon, cor:c, titulo:t, itens }) => itens.length ? (
    <div style={{ display:"flex", gap:8, alignItems:"flex-start", fontSize:12, color:T.textMd }}>
      <Icon size={14} color={c} style={{ flexShrink:0, marginTop:2 }}/>
      <span><b style={{ color:c }}>{t}:</b> {itens.join(", ")}</span>
    </div>
  ) : null;
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"18px 20px", display:"grid", gap:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:12, flexWrap:"wrap" }}>
        <h3 style={{ margin:0, fontSize:16, display:"inline-flex", alignItems:"center", gap:10 }}>
          <span style={{ width:10, height:10, borderRadius:3, background:cor, display:"inline-block" }}/>{titulo}
        </h3>
        <div style={{ display:"flex", gap:18, alignItems:"baseline", flexWrap:"wrap", fontVariantNumeric:"tabular-nums" }}>
          <span style={{ fontSize:12, color:T.textSm }}>{refReal ? "realizado" : "orçado"} {blLabel}: <b style={{ color:T.textMd }}>{fmt(refValor)}</b></span>
          <span style={{ fontSize:12, color:T.textSm }}>{atualLabel}: <b style={{ color:T.text, fontSize:15 }}>{fmt(tot.totalAtual)}</b></span>
          <span style={{ fontSize:13, fontWeight:800, color:dcor }}>{fmtDelta(delta)}{pct(delta, refValor) ? <span style={{ fontWeight:600, fontSize:11, marginLeft:6 }}>({pct(delta, refValor)})</span> : null}</span>
        </div>
      </div>
      {explicacao
        ? <p style={{ margin:0, fontSize:14, lineHeight:1.55, color:T.text, whiteSpace:"pre-wrap" }}>{explicacao}</p>
        : <p style={{ margin:0, fontSize:12, color:T.textSm, fontStyle:"italic" }}>Sem observações para este grupo.</p>}
      {(addons.length || removidos.length || naoReal.length) ? (
        <div style={{ display:"grid", gap:6, paddingTop:10, borderTop:`1px dashed ${T.border}` }}>
          <Lista icon={Sparkles} cor="#8b5cf6" titulo="Novos nesta edição" itens={addons}/>
          <Lista icon={MinusCircle} cor="#6b7280" titulo="Não constam mais" itens={removidos}/>
          <Lista icon={AlertCircle} cor="#D97706" titulo={`Orçados em ${blLabel} sem gasto`} itens={naoReal}/>
        </div>
      ) : null}
    </div>
  );
}

export default function OrcamentoPublico({ token }) {
  const [orc, setOrc] = useState(null);
  const [estado, setEstado] = useState("carregando"); // carregando | ok | invalido | offline
  const [sub, setSub] = useState("comparativo");
  const [ultimaLeitura, setUltimaLeitura] = useState(null);
  const [piscou, setPiscou] = useState(false);
  const versao = useRef(null);
  const jaCarregou = useRef(false);

  useEffect(() => {
    let vivo = true, timer = null;
    const ler = async () => {
      try {
        const doc = await publicoOrcamento(token);
        if (!vivo) return;
        if (!doc) { setEstado("invalido"); return; }
        const v = doc?.meta?.updatedAt || JSON.stringify(doc).length;
        if (v !== versao.current) {
          versao.current = v; setOrc(doc);
          if (jaCarregou.current) { setPiscou(true); setTimeout(() => vivo && setPiscou(false), 1500); }
          jaCarregou.current = true;
        }
        setUltimaLeitura(new Date()); setEstado("ok");
      } catch {
        if (vivo) setEstado(prev => prev === "ok" ? "offline" : prev === "carregando" ? "invalido" : prev);
      } finally { if (vivo) timer = setTimeout(ler, POLL_MS); }
    };
    ler();
    const onFocus = () => { if (document.visibilityState === "visible") { clearTimeout(timer); ler(); } };
    document.addEventListener("visibilitychange", onFocus);
    return () => { vivo = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onFocus); };
  }, [token]);

  const T = useMemo(() => TEMA(orc?.meta?.cor), [orc?.meta?.cor]);
  const totais = useMemo(() => (orc ? calcTotais(orc) : null), [orc]);
  const diff = useMemo(() => (orc ? diffBaseline(orc) : null), [orc]);

  const shell = (children) => (
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:"Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth:1100, margin:"0 auto", padding:"20px 20px 60px" }}>{children}</div>
    </div>
  );
  if (estado === "carregando") return shell(<p style={{ color:T.textMd, fontSize:14 }}>Carregando orçamento…</p>);
  if (estado === "invalido" || !orc) return shell(
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:28, maxWidth:520, margin:"60px auto", textAlign:"center" }}>
      <Lock size={28} color={T.textSm}/>
      <h2 style={{ margin:"12px 0 6px", fontSize:18 }}>Link inválido ou revogado</h2>
      <p style={{ margin:0, color:T.textMd, fontSize:13 }}>Peça um novo link a quem compartilhou este orçamento.</p>
    </div>
  );

  const m = orc.meta || {};
  const st = ORC_STATUS[m.status] || ORC_STATUS.rascunho;
  const bl = orc.baseline || null;
  const blLabel = bl?.label || "edição anterior";
  const atualLabel = `${m.nome} ${m.edicao}`;
  const refReal = !!diff?.temRealizado;
  const refValor = refReal ? diff.totalReal : diff.totalBase;
  const delta = (totais?.totalGeral || 0) - refValor;
  const ex = orc.explicacoes || {};
  const hubUrl = `${window.location.origin}${window.location.pathname}`;
  const numJogos = (orc.jogos || []).length;

  return shell(
    <>
      {/* Cabeçalho */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, flexWrap:"wrap", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:44, height:44, borderRadius:12, background:`${T.brand}22`, display:"grid", placeItems:"center", fontSize:22 }}>{m.icon || "🏆"}</div>
          <div>
            <h1 style={{ margin:0, fontSize:22, letterSpacing:"-0.01em" }}>{m.nome} <span style={{ color:T.textMd, fontWeight:500 }}>{m.edicao}</span></h1>
            <p style={{ margin:"2px 0 0", color:T.textSm, fontSize:12 }}>Proposta de orçamento · {numJogos} jogos · <span style={{ color:st.color, fontWeight:700 }}>{st.label}</span></p>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, color:T.textSm, background:T.card, border:`1px solid ${piscou ? T.brand : T.border}`, borderRadius:999, padding:"6px 12px", transition:"border-color .3s" }}>
          <Radio size={13} color={estado === "offline" ? T.warning : T.brand}/>
          {estado === "offline" ? "Sem conexão — tentando de novo" : `Ao vivo · ${ultimaLeitura ? hora(ultimaLeitura) : ""}`}
          <span style={{ color:T.muted }}>·</span><Lock size={12}/> somente leitura
        </div>
      </div>

      {/* Números de abertura */}
      <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:14 }}>
        <Numero T={T} label={`Pedido ${atualLabel}`} valor={fmt(totais?.totalGeral || 0)} sub={`${fmt(totais?.totalJogos || 0)} variáveis · ${fmt(totais?.totalFixos || 0)} fixos`} cor={T.brand}/>
        {bl && <Numero T={T} label={`Orçado ${blLabel}`} valor={fmt(diff.totalBase)} sub="aprovado na edição anterior"/>}
        {bl && refReal && <Numero T={T} label={`Realizado ${blLabel}`} valor={fmt(diff.totalReal)} sub="efetivamente gasto"/>}
        {bl && <Numero T={T} label={`Variação vs ${refReal ? "realizado" : "orçado"}`} valor={fmtDelta(delta)} sub={pct(delta, refValor) ? `${pct(delta, refValor)} sobre ${fmt(refValor)}` : "—"} cor={delta > 0 ? COR_MAIS : delta < 0 ? COR_MENOS : T.text}/>}
      </div>

      {/* Texto de abertura escrito no Hub */}
      {ex.geral && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`4px solid ${T.brand}`, borderRadius:14, padding:"16px 20px", marginBottom:14 }}>
          <p style={{ margin:0, fontSize:15, lineHeight:1.6, color:T.text, whiteSpace:"pre-wrap" }}>{ex.geral}</p>
        </div>
      )}

      <SubTabNav active={sub} onChange={setSub} T={T} tabs={TABS}/>

      {sub === "comparativo" && (
        !bl ? (
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:24, color:T.textMd, fontSize:13 }}>Este orçamento ainda não tem uma edição anterior importada para comparação.</div>
        ) : (
          <div style={{ display:"grid", gap:12 }}>
            <p style={{ margin:"0 0 2px", fontSize:12, color:T.textSm }}>
              Variação calculada contra o <b>{refReal ? "realizado" : "orçado"} de {blLabel}</b>. Valores por grupo de serviço; o detalhamento por jogo e por linha está no HUB Financeiro.
            </p>
            <h2 style={{ margin:"6px 0 0", fontSize:13, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:T.textSm }}>Custos variáveis · por jogo</h2>
            {diff.grupos.filter(g => g.rows.length > 0).map(g => (
              <BlocoGrupo key={g.key} T={T} titulo={g.label} cor={g.color} tot={g} rows={g.rows} refReal={refReal} blLabel={blLabel} atualLabel={atualLabel} explicacao={ex[g.key]}/>
            ))}
            {diff.fixos.length > 0 && <h2 style={{ margin:"14px 0 0", fontSize:13, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:T.textSm }}>Custos fixos · por edição</h2>}
            {diff.fixos.map(sec => (
              <BlocoGrupo key={sec.secao} T={T} titulo={sec.secao} cor="#a855f7" tot={sec} rows={sec.rows} refReal={refReal} blLabel={blLabel} atualLabel={atualLabel} explicacao={ex[`sec:${sec.secao}`]}/>
            ))}
          </div>
        )
      )}

      {sub === "resumo" && <SubResumo orc={orc} setOrc={() => {}} readOnly T={T} canAprovar={false}/>}

      {/* Direcionamento ao Hub */}
      <div style={{ marginTop:24, background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <div style={{ fontSize:13, color:T.textMd }}>
          <b style={{ color:T.text }}>Precisa do detalhe?</b> O orçamento jogo a jogo, as premissas e a tabela linha a linha estão no HUB Financeiro, para usuários com acesso.
        </div>
        <a href={hubUrl} target="_blank" rel="noopener" style={{ display:"inline-flex", alignItems:"center", gap:6, background:T.brand, color:"#fff", textDecoration:"none", fontSize:12, fontWeight:700, padding:"8px 14px", borderRadius:8 }}>
          <ExternalLink size={14}/> Abrir o HUB Financeiro
        </a>
      </div>
      <p style={{ marginTop:14, color:T.textSm, fontSize:11, textAlign:"center" }}>
        Visualização externa do HUB Financeiro · valores em reais · última edição no Hub {m.updatedAt ? new Date(m.updatedAt).toLocaleString("pt-BR") : "—"}
      </p>
    </>
  );
}
