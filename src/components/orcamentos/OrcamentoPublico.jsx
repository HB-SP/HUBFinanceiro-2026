import { useEffect, useMemo, useRef, useState } from "react";
import { publicoOrcamento } from "../../lib/supabase";
import { ORC_STATUS, calcTotais, diffBaseline } from "../../data/orcamentos";
import { fmt } from "../../utils";
import { SubTabNav } from "./OrcamentoEditor";
import SubResumo from "./SubResumo";
import { Radio, Lock, GitCompareArrows, LineChart, ExternalLink, Layers, Briefcase } from "lucide-react";

// ─── ORÇAMENTO PÚBLICO (#orcamento/<token>) ──────────────────────────────────
// Apresentação para a entidade, sem login.
//   • Abertura: total pedido × base da edição anterior (orçado e realizado).
//   • Resumo (padrão): os macro grupos do Hub (variáveis × fixos).
//   • Comparativo: a MESMA tabela do Hub — blocos Variáveis/Fixos, grupos na
//     mesma ordem, linhas na mesma ordem (manual salva no Hub ou por |Δ|),
//     colunas orçado base / realizado base / pedido / Δ / selo — mais a
//     EXPLICAÇÃO escrita no Hub sob o cabeçalho de cada grupo (orc.explicacoes).
//   • Detalhe por jogo e premissas NÃO entram: quem precisar é direcionado ao Hub.
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
  { key:"resumo",      label:"Resumo",      icon:LineChart },
  { key:"comparativo", label:"Comparativo", icon:GitCompareArrows },
];
// Mesmos selos do Hub (SubComparativo): só o que o número sozinho não conta.
const SELOS = {
  addon:         { label: "ADD-ON",        color: "#8b5cf6" },
  removido:      { label: "removido",      color: "#6b7280" },
  nao_realizado: { label: "não realizado", color: "#D97706" },
};
const hora = (d) => { try { return new Date(d).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", second:"2-digit" }); } catch { return ""; } };
const pct = (delta, ref) => ref ? `${delta >= 0 ? "+" : "−"}${Math.abs((delta / ref) * 100).toFixed(1)}%` : null;
const fmtDelta = (d) => Math.round(d) === 0 ? "—" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`;
const deltaCor = (d, T) => d > 0 ? COR_MAIS : d < 0 ? COR_MENOS : T.textSm;

// Número grande de abertura
const Numero = ({ T, label, valor, sub, cor }) => (
  <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px 18px", minWidth:200, flex:"1 1 200px" }}>
    <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:T.textSm }}>{label}</div>
    <div style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.02em", color: cor || T.text, marginTop:4, fontVariantNumeric:"tabular-nums" }}>{valor}</div>
    {sub && <div style={{ fontSize:12, color:T.textMd, marginTop:2 }}>{sub}</div>}
  </div>
);

// ── Tabela comparativa: espelho da tabela do Hub ─────────────────────────────
export function TabelaComparativo({ T, orc, diff, explicacoes }) {
  const bl = orc.baseline;
  const atualLabel = `${orc.meta.nome} ${orc.meta.edicao}`;
  const refReal = !!diff.temRealizado;                    // Hub: realizado é a referência padrão quando existe
  const ordemManual = orc.comparativo?.ordem || {};
  const PADX = 12;

  // Mesma visão do Hub: delta/status conforme a referência; ordem manual salva ou por |Δ|.
  const V = useMemo(() => {
    const mapRow = r => refReal ? { ...r, delta: r.deltaReal, status: r.statusReal } : r;
    const mapTot = t => refReal ? { ...t, delta: t.deltaReal } : t;
    const porDelta = rows => [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const ordena = (rows, gKey) => {
      const base = porDelta(rows);
      const lista = ordemManual[gKey];
      if (!lista) return base;
      const pos = new Map(lista.map((k, i) => [k, i]));
      return base.sort((a, b) => (pos.has(a.key) ? pos.get(a.key) : 1e9) - (pos.has(b.key) ? pos.get(b.key) : 1e9));
    };
    const grupos = diff.grupos.map(g => ({ ...mapTot(g), rows: ordena(g.rows.map(mapRow), g.key) })).filter(g => g.rows.length > 0);
    const fixos  = diff.fixos.map(s => ({ ...mapTot(s), key:`sec:${s.secao}`, label:s.secao, color:"#a855f7", rows: ordena(s.rows.map(mapRow), `sec:${s.secao}`) })).filter(s => s.rows.length > 0);
    const soma = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);
    const bloco = (key, label, sub, color, gs) => ({ key, label, sub, color, totalBase: soma(gs, "totalBase"), totalReal: soma(gs, "totalReal"), totalAtual: soma(gs, "totalAtual"), delta: soma(gs, "delta") });
    return {
      grupos, fixos,
      variaveis: bloco("variaveis", "Custos Variáveis", `por jogo · ${(orc.jogos || []).length} jogos na edição atual`, T.info, grupos),
      bfixos:    bloco("fixos", "Custos Fixos", "por edição · pessoal fixo, serviços e reembolsos", "#a855f7", fixos),
      totalRef: refReal ? diff.totalReal : diff.totalBase,
      delta: refReal ? diff.deltaReal : diff.delta,
    };
  }, [diff, refReal, ordemManual, orc.jogos, T.info]);

  const th = (extra) => ({ padding:`9px ${PADX}px`, fontSize:10.5, fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase", color:T.textSm, textAlign:"right", whiteSpace:"nowrap", ...extra });
  const num = (extra) => ({ padding:`7px ${PADX}px`, textAlign:"right", fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap", fontSize:12, ...extra });
  const nCols = refReal ? 6 : 5;

  const Selo = ({ status }) => { const s = SELOS[status]; return s ? <span style={{ fontSize:9.5, fontWeight:700, letterSpacing:"0.06em", whiteSpace:"nowrap", padding:"2px 8px", borderRadius:999, background:`${s.color}1c`, color:s.color, border:`1px solid ${s.color}44` }}>{s.label}</span> : null; };
  // prop chama-se refValor de propósito: `ref` é reservado pelo React (um número ali derruba a página)
  const Delta = ({ delta, refValor, peso }) => (
    <td style={num({ fontWeight: peso ? 800 : 600, color: deltaCor(delta, T), lineHeight:1.15 })}>
      {fmtDelta(delta)}{Math.round(delta) !== 0 && pct(delta, refValor) && <div style={{ fontSize:9.5, fontWeight:500, color:T.textSm }}>{pct(delta, refValor)}</div>}
    </td>
  );

  const linhaBloco = (b, Icon) => (
    <tr key={`bloco_${b.key}`} style={{ borderTop:`3px solid ${b.color}`, background:`${b.color}12` }}>
      <td style={{ padding:`11px ${PADX}px` }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:10 }}>
          <Icon size={15} color={b.color}/>
          <span style={{ display:"flex", flexDirection:"column", gap:1 }}>
            <span style={{ fontSize:11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase", color:b.color }}>{b.label}</span>
            <span style={{ fontSize:10, color:T.textSm }}>{b.sub}</span>
          </span>
        </span>
      </td>
      <td style={num({ fontWeight:700 })}>{fmt(b.totalBase)}</td>
      {refReal && <td style={num({ fontWeight:700 })}>{fmt(b.totalReal)}</td>}
      <td style={num({ fontWeight:800, color:T.info })}>{fmt(b.totalAtual)}</td>
      <Delta delta={b.delta} refValor={refReal ? b.totalReal : b.totalBase} peso/>
      <td/>
    </tr>
  );
  const linhaGrupo = (g) => (
    <tr key={`hd_${g.key}`} style={{ borderTop:`2px solid ${T.borderStrong}`, background:T.surfaceAlt }}>
      <td style={{ padding:`9px ${PADX}px`, fontWeight:700, color:T.text, fontSize:12 }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:8 }}><span style={{ width:8, height:8, borderRadius:2, background:g.color }}/>{g.label}</span>
      </td>
      <td style={num({ fontWeight:700 })}>{fmt(g.totalBase)}</td>
      {refReal && <td style={num({ fontWeight:700 })}>{fmt(g.totalReal)}</td>}
      <td style={num({ fontWeight:700, color:T.info })}>{fmt(g.totalAtual)}</td>
      <Delta delta={g.delta} refValor={refReal ? g.totalReal : g.totalBase} peso/>
      <td/>
    </tr>
  );
  const linhaExplicacao = (g) => explicacoes[g.key] ? (
    <tr key={`ex_${g.key}`} style={{ background:T.card }}>
      <td colSpan={nCols} style={{ padding:`8px ${PADX}px 12px ${PADX + 18}px`, borderLeft:`3px solid ${g.color}55` }}>
        <p style={{ margin:0, fontSize:13, lineHeight:1.55, color:T.text, whiteSpace:"pre-wrap" }}>{explicacoes[g.key]}</p>
      </td>
    </tr>
  ) : null;
  const linhaRow = (row) => (
    <tr key={row.key} style={{ borderTop:`1px solid ${T.border}` }}>
      <td style={{ padding:`7px ${PADX}px ${PADX}px ${PADX + 18}px`, fontSize:12, color: row.soBase ? T.textSm : T.text }}>
        {row.label}
        {row.labelBase && row.labelBase.trim().toLowerCase() !== String(row.label).trim().toLowerCase() && (
          <div style={{ fontSize:10, color:T.textSm }}>na base: {row.labelBase}{row.baseItens?.length > 1 ? ` (${row.baseItens.length} linhas)` : ""}</div>
        )}
      </td>
      <td style={num({ color:T.textMd })}>{fmt(row.base)}</td>
      {refReal && <td style={num({ color:T.textMd })}>{row.real == null ? "—" : fmt(row.real)}</td>}
      <td style={num({ color:T.text, fontWeight:600 })}>{fmt(row.atual)}</td>
      <Delta delta={row.delta} refValor={refReal ? row.real : row.base}/>
      <td style={{ padding:`7px ${PADX}px`, whiteSpace:"nowrap" }}><Selo status={row.status}/></td>
    </tr>
  );
  const subtotal = (b) => (
    <tr key={`sub_${b.key}`} style={{ borderTop:`2px solid ${b.color}55`, background:`${b.color}08` }}>
      <td style={{ padding:`9px ${PADX}px`, fontSize:11, fontWeight:700, color:b.color, letterSpacing:"0.04em", textTransform:"uppercase" }}>Subtotal · {b.label}</td>
      <td style={num({ fontWeight:700 })}>{fmt(b.totalBase)}</td>
      {refReal && <td style={num({ fontWeight:700 })}>{fmt(b.totalReal)}</td>}
      <td style={num({ fontWeight:700, color:T.info })}>{fmt(b.totalAtual)}</td>
      <Delta delta={b.delta} refValor={refReal ? b.totalReal : b.totalBase} peso/>
      <td/>
    </tr>
  );

  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, overflow:"hidden" }}>
      <div style={{ padding:"14px 20px 10px", borderBottom:`1px solid ${T.border}` }}>
        <h3 style={{ margin:0, fontSize:15, display:"inline-flex", alignItems:"center", gap:8 }}><GitCompareArrows size={16} color={T.brand}/>Comparativo · {bl.label} × {atualLabel}</h3>
        <p style={{ margin:"4px 0 0", fontSize:12, color:T.textSm }}>
          Δ = orçado {orc.meta.edicao} − {refReal ? "realizado" : "orçado"} {bl.label} · mesma ordem e mesmas linhas do HUB · selo marca o que o número não diz (add-on, removido, não realizado)
        </p>
      </div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:720 }}>
          <thead>
            <tr style={{ background:T.surfaceAlt }}>
              <th style={th({ textAlign:"left", width:"30%" })}>Serviço</th>
              <th style={th()}>Orçado {bl.label}</th>
              {refReal && <th style={th({ color:T.warning })}>Realizado {bl.label} · ref.</th>}
              <th style={th({ color:T.info })}>Orçado {atualLabel}</th>
              <th style={th()}>Δ vs {refReal ? "realizado" : "orçado"}</th>
              <th style={th({ textAlign:"left" })}>Selo</th>
            </tr>
          </thead>
          <tbody>
            {linhaBloco(V.variaveis, Layers)}
            {V.grupos.map(g => [linhaGrupo(g), linhaExplicacao(g), ...g.rows.map(linhaRow)])}
            {subtotal(V.variaveis)}
            {V.fixos.length > 0 && linhaBloco(V.bfixos, Briefcase)}
            {V.fixos.map(s => [linhaGrupo(s), linhaExplicacao(s), ...s.rows.map(linhaRow)])}
            {V.fixos.length > 0 && subtotal(V.bfixos)}
            <tr style={{ borderTop:`3px solid ${T.borderStrong}`, background:T.surfaceAlt, fontWeight:700 }}>
              <td style={{ padding:`13px ${PADX}px`, fontSize:12, letterSpacing:"0.04em", textTransform:"uppercase", color:T.text }}>Total Geral</td>
              <td style={num({ fontWeight:800 })}>{fmt(diff.totalBase)}</td>
              {refReal && <td style={num({ fontWeight:800 })}>{fmt(diff.totalReal)}</td>}
              <td style={num({ fontWeight:800, color:T.info, fontSize:13 })}>{fmt(diff.totalAtual)}</td>
              <Delta delta={V.delta} refValor={V.totalRef} peso/>
              <td/>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OrcamentoPublico({ token }) {
  const [orc, setOrc] = useState(null);
  const [estado, setEstado] = useState("carregando"); // carregando | ok | invalido | offline
  const [sub, setSub] = useState("resumo");
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
      <div style={{ maxWidth:1180, margin:"0 auto", padding:"20px 20px 60px" }}>{children}</div>
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

      <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:14 }}>
        <Numero T={T} label={`Pedido ${atualLabel}`} valor={fmt(totais?.totalGeral || 0)} sub={`${fmt(totais?.totalJogos || 0)} variáveis · ${fmt(totais?.totalFixos || 0)} fixos`} cor={T.brand}/>
        {bl && <Numero T={T} label={`Orçado ${blLabel}`} valor={fmt(diff.totalBase)} sub="aprovado na edição anterior"/>}
        {bl && refReal && <Numero T={T} label={`Realizado ${blLabel}`} valor={fmt(diff.totalReal)} sub="efetivamente gasto"/>}
        {bl && <Numero T={T} label={`Variação vs ${refReal ? "realizado" : "orçado"}`} valor={fmtDelta(delta) === "—" ? "sem variação" : fmtDelta(delta)} sub={pct(delta, refValor) ? `${pct(delta, refValor)} sobre ${fmt(refValor)}` : "—"} cor={delta > 0 ? COR_MAIS : delta < 0 ? COR_MENOS : T.text}/>}
      </div>

      {ex.geral && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`4px solid ${T.brand}`, borderRadius:14, padding:"16px 20px", marginBottom:14 }}>
          <p style={{ margin:0, fontSize:15, lineHeight:1.6, color:T.text, whiteSpace:"pre-wrap" }}>{ex.geral}</p>
        </div>
      )}

      <SubTabNav active={sub} onChange={setSub} T={T} tabs={TABS}/>

      {sub === "resumo" && <SubResumo orc={orc} setOrc={() => {}} readOnly T={T} canAprovar={false}/>}
      {sub === "comparativo" && (
        !bl
          ? <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:24, color:T.textMd, fontSize:13 }}>Este orçamento ainda não tem uma edição anterior importada para comparação.</div>
          : <TabelaComparativo T={T} orc={orc} diff={diff} explicacoes={ex}/>
      )}

      <div style={{ marginTop:24, background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <div style={{ fontSize:13, color:T.textMd }}>
          <b style={{ color:T.text }}>Precisa do detalhe?</b> O orçamento jogo a jogo e as premissas estão no HUB Financeiro, para usuários com acesso.
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
