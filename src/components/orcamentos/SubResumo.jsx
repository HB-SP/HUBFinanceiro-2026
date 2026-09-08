import { useMemo, useState } from "react";
import { FONT, CATS } from "../../constants";
import { Card, SectionHeader, Button, Progress, Badge } from "../ui";
import { calcTotais, calcOrcadoJogo, diffBaseline, ORC_STATUS, GRUPOS_PREMISSA } from "../../data/orcamentos";
import { fmt, fmtK } from "../../utils";
import {
  LineChart, Wallet, CalendarDays, Briefcase, Trophy, AlertCircle,
  LayoutDashboard, LayoutGrid, Users, ChevronRight, ChevronDown, ChevronUp,
  GitCompareArrows, Layers, TrendingUp, TrendingDown,
} from "lucide-react";

const COR_VAR  = "#2563EB"; // custos variáveis (por jogo)
const COR_FIXO = "#a855f7"; // custos fixos (por edição)

const thStyle = (T, left) => ({
  padding:"11px 16px",
  textAlign:left ? "left" : "right",
  color:T.textSm,
  fontSize:10,
  fontWeight:700,
  letterSpacing:"0.06em",
  textTransform:"uppercase",
  whiteSpace:"nowrap",
  borderBottom:`1px solid ${T.border}`,
});
const tdNum = (T, extra = {}) => ({ padding:"10px 16px", textAlign:"right", whiteSpace:"nowrap", color:T.text, fontSize:12.5, fontFamily:FONT.num, fontVariantNumeric:"tabular-nums", ...extra });
const pctOf = (v, tot) => tot > 0 ? `${((v / tot) * 100).toFixed(1)}%` : "—";
const deltaCor = (d, T) => d > 0 ? "#DC2626" : d < 0 ? "#16A34A" : T.textSm;
const fmtDelta = (d) => d === 0 ? "—" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`;

// Card de bloco (Variáveis / Fixos / Total): número grande + duas linhas de apoio.
const BlocoCard = ({ T, cor, icon: Icon, titulo, valor, linha1, linha2, rodape }) => (
  <Card T={T} accent={cor}>
    <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{width:30,height:30,borderRadius:8,background:`${cor}16`,color:cor,display:"inline-flex",alignItems:"center",justifyContent:"center"}}><Icon size={15} strokeWidth={2.25}/></span>
        <span style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:cor}}>{titulo}</span>
      </div>
      <div className="num" style={{fontSize:26,fontWeight:700,color:T.text,fontFamily:FONT.num,letterSpacing:"-0.01em",lineHeight:1.1}}>{valor}</div>
      {linha1 && <div style={{fontSize:12,color:T.textMd}}>{linha1}</div>}
      {linha2 && <div style={{fontSize:11.5,color:T.textSm}}>{linha2}</div>}
      {rodape}
    </div>
  </Card>
);

// Resumo consolidado — é a peça que a entidade pagadora lê. Ordem de leitura:
// blocos variável × fixo × total (com delta vs edição anterior) → matriz
// padrão × faixa (o que se aprova) → por fase → por categoria/serviço →
// por mandante (retrátil) → status/aprovação.
export default function SubResumo({ orc, readOnly, T, canAprovar, errosAprovacao = [], onAprovar }) {
  const totais = calcTotais(orc);
  const jogos = orc.jogos || [];
  const pracas = orc.pracas || [];
  const faixas = orc.faixas || [];
  const padroes = orc.padroes || [];
  const fases = orc.meta.formato === "pontos_corridos" ? [] : (orc.meta.fases || []);
  const numJogos = jogos.length;
  const st = ORC_STATUS[orc.meta.status] || ORC_STATUS.rascunho;
  const totalGeral = totais.totalGeral || 0;
  const [abertas, setAbertas] = useState(() => new Set());
  const [mandantesAberto, setMandantesAberto] = useState(false);

  const faseLabel = (key) => fases.find(f => f.key === key)?.label || key || "—";
  const rankFase = (key) => { const i = fases.findIndex(f => f.key === key); return i === -1 ? 999 : i; };
  const pracaDe = (j) => pracas.find(p => p.id === j.pracaId) || null;
  const faixaDe = (j) => faixas.find(f => f.key === pracaDe(j)?.faixaKey) || null;

  // Orçado de cada jogo (uma vez) — alimenta todas as quebras abaixo.
  const jogosCalc = useMemo(() => jogos.map(j => {
    const orcado = calcOrcadoJogo(orc, j);
    const total = Object.values(orcado).reduce((s, v) => s + (v || 0), 0);
    return { j, orcado, total, faixa: faixaDe(j), praca: pracaDe(j) };
  }), [orc]);

  // ── 2. Matriz padrão × faixa: nº de jogos, média por jogo e total por célula ──
  const matriz = useMemo(() => {
    const cel = {}; // `${padrao}|${faixaKey}` → { n, total }
    const porPadrao = {}, porFaixa = {};
    jogosCalc.forEach(({ j, total, faixa }) => {
      const fk = faixa?.key || "__sem";
      const k = `${j.padrao || "—"}|${fk}`;
      cel[k] = cel[k] || { n:0, total:0 }; cel[k].n++; cel[k].total += total;
      porPadrao[j.padrao || "—"] = porPadrao[j.padrao || "—"] || { n:0, total:0 }; porPadrao[j.padrao || "—"].n++; porPadrao[j.padrao || "—"].total += total;
      porFaixa[fk] = porFaixa[fk] || { n:0, total:0 }; porFaixa[fk].n++; porFaixa[fk].total += total;
    });
    const linhas = [...padroes, ...Object.keys(porPadrao).filter(p => !padroes.includes(p))].filter(p => porPadrao[p]);
    const colunas = [...faixas.map(f => ({ key:f.key, label:f.label })), ...(porFaixa.__sem ? [{ key:"__sem", label:"Sem faixa" }] : [])].filter(c => porFaixa[c.key]);
    return { cel, porPadrao, porFaixa, linhas, colunas };
  }, [jogosCalc, padroes, faixas]);

  // ── 3. Por fase: jogos, total, média ──
  const porFase = useMemo(() => {
    const acc = {};
    jogosCalc.forEach(({ j, total }) => { const k = j.fase || "—"; acc[k] = acc[k] || { n:0, total:0 }; acc[k].n++; acc[k].total += total; });
    return Object.entries(acc).sort((a, b) => rankFase(a[0]) - rankFase(b[0])).map(([k, v]) => ({ key:k, label:faseLabel(k), ...v }));
  }, [jogosCalc, fases]);

  // ── 4. Por mandante (1ª fase) + mata-mata por fase ──
  const porMandante = useMemo(() => {
    const acc = new Map();
    const primeira = fases[0]?.key;
    jogosCalc.forEach(({ j, total, praca }) => {
      const ehGrupos = !fases.length || j.fase === primeira;
      const k = ehGrupos && j.mandante ? `t|${j.mandante}` : `f|${j.fase}`;
      const cur = acc.get(k) || { key:k, label: ehGrupos && j.mandante ? j.mandante : faseLabel(j.fase), praca: praca?.cidade || "", faixa: faixaDe(j)?.label || "", n:0, total:0, pads:{}, mata: !(ehGrupos && j.mandante) };
      cur.n++; cur.total += total; cur.pads[j.padrao || "—"] = (cur.pads[j.padrao || "—"] || 0) + 1;
      if (cur.praca && praca?.cidade && cur.praca !== praca.cidade && !cur.praca.includes("+")) cur.praca = `${cur.praca} +`;
      acc.set(k, cur);
    });
    const times = orc.times || [];
    return [...acc.values()].sort((a, b) => (a.mata - b.mata) || (a.mata ? rankFase(a.key.slice(2)) - rankFase(b.key.slice(2)) : (times.indexOf(a.label) === -1 ? 999 : times.indexOf(a.label)) - (times.indexOf(b.label) === -1 ? 999 : times.indexOf(b.label))) || a.label.localeCompare(b.label, "pt-BR"));
  }, [jogosCalc, fases, orc.times]);

  // ── 5. Categoria → serviço ──
  const linhas = useMemo(() => {
    const porSub = {};
    jogosCalc.forEach(({ orcado }) => { for (const [k, v] of Object.entries(orcado)) porSub[k] = (porSub[k] || 0) + (v || 0); });
    const grupos = [
      { key:"logistica", label:CATS[0].label, color:CATS[0].color, subs:CATS[0].subs },
      ...GRUPOS_PREMISSA,
    ].map(g => ({
      key: g.key, label: g.label, color: g.color, tipo: "variavel",
      itens: g.subs.map(sub => ({ key: sub.key, label: sub.label, valor: porSub[sub.key] || 0 })).filter(it => it.valor > 0).sort((a, b) => b.valor - a.valor),
    }));
    const fixosItens = (orc.servicosFixos || []).flatMap(sec => {
      const itens = (sec.itens || []).filter(it => (Number(it.orcado) || 0) > 0);
      if (itens.length === 0) return [];
      return [
        { key:`sec_${sec.secao}`, label:sec.secao, valor:itens.reduce((s, it) => s + (Number(it.orcado) || 0), 0), secao:true },
        ...itens.map(it => ({ key:`it_${it.id}`, label:it.nome, valor:Number(it.orcado) || 0 })),
      ];
    });
    grupos.push({ key:"fixos", label:"Serviços Fixos", color:COR_FIXO, tipo:"fixo", itens:fixosItens });
    return grupos.map(g => ({ ...g, total: g.key === "fixos" ? totais.totalFixos : g.itens.reduce((s, it) => s + it.valor, 0) }));
  }, [jogosCalc, orc.servicosFixos, totais.totalFixos]);

  // ── 6. Delta vs edição anterior (só se houver base) ──
  const diff = useMemo(() => orc.baseline ? diffBaseline(orc) : null, [orc]);

  const toggle = key => setAbertas(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const numFixos = (orc.servicosFixos || []).reduce((s, sec) => s + (sec.itens || []).filter(it => (Number(it.orcado) || 0) > 0).length, 0);
  const numSecoes = (orc.servicosFixos || []).filter(sec => (sec.itens || []).some(it => (Number(it.orcado) || 0) > 0)).length;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      {/* ── 1 + 6. Blocos: Variáveis · Fixos · Total (com delta vs base) ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
        <BlocoCard T={T} cor={COR_VAR} icon={CalendarDays} titulo="Custos variáveis"
          valor={fmtK(totais.totalJogos)}
          linha1={`${numJogos} jogo${numJogos===1?"":"s"} · média ${numJogos ? fmt(totais.totalJogos / numJogos) : "—"} por jogo`}
          linha2={`${pctOf(totais.totalJogos, totalGeral)} do total · ${fmt(totais.totalJogos)}`}/>
        <BlocoCard T={T} cor={COR_FIXO} icon={Briefcase} titulo="Custos fixos"
          valor={fmtK(totais.totalFixos)}
          linha1={`${numFixos} serviço${numFixos===1?"":"s"} em ${numSecoes} seç${numSecoes===1?"ão":"ões"} · por edição`}
          linha2={`${pctOf(totais.totalFixos, totalGeral)} do total · ${fmt(totais.totalFixos)}`}/>
        <BlocoCard T={T} cor={T.text || "#111827"} icon={Wallet} titulo="Total geral"
          valor={fmtK(totalGeral)}
          linha1={fmt(totalGeral)}
          linha2={diff ? null : "Sem base de comparação — crie na aba Comparativo"}
          rodape={diff && (
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:2,fontSize:12}}>
              {diff.delta >= 0 ? <TrendingUp size={14} color={deltaCor(diff.delta, T)}/> : <TrendingDown size={14} color={deltaCor(diff.delta, T)}/>}
              <span style={{color:T.textMd}}>vs {orc.baseline.label}:</span>
              <span className="num" style={{fontFamily:FONT.num,fontWeight:700,color:deltaCor(diff.delta, T)}}>
                {fmtDelta(diff.delta)}{diff.totalBase ? ` (${diff.delta >= 0 ? "+" : ""}${((diff.delta / diff.totalBase) * 100).toFixed(1)}%)` : ""}
              </span>
              {diff.numAddons > 0 && <Badge T={T} color="#8b5cf6" size="sm">{diff.numAddons} add-on{diff.numAddons===1?"":"s"}</Badge>}
              <span style={{fontSize:11,color:T.textSm,display:"inline-flex",alignItems:"center",gap:4}}><GitCompareArrows size={12}/> detalhe na aba Comparativo</span>
            </div>
          )}/>
      </div>

      {/* ── 2. Matriz padrão × faixa ── */}
      <Card T={T} accent={COR_VAR}>
        <SectionHeader T={T} icon={LayoutGrid} title="Jogos por padrão × distância"
          subtitle="Cada célula: nº de jogos · valor médio por jogo · total. É a grade que sustenta o custo variável."/>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:640}}>
            <thead>
              <tr style={{background:T.surfaceAlt||T.bg}}>
                <th style={thStyle(T, true)}>Padrão</th>
                {matriz.colunas.map(c => <th key={c.key} style={thStyle(T)}>{c.label}</th>)}
                <th style={{...thStyle(T), borderLeft:`1px solid ${T.border}`}}>Total padrão</th>
              </tr>
            </thead>
            <tbody>
              {matriz.linhas.map(p => {
                const tp = matriz.porPadrao[p];
                return (
                  <tr key={p} style={{borderTop:`1px solid ${T.border}`}}>
                    <td style={{padding:"10px 16px",fontWeight:700,color:T.text,fontSize:13,whiteSpace:"nowrap"}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:8}}><Layers size={13} color={COR_VAR}/>{p}</span>
                    </td>
                    {matriz.colunas.map(c => {
                      const cel = matriz.cel[`${p}|${c.key}`];
                      if (!cel) return <td key={c.key} style={tdNum(T, { color:T.textSm })}>—</td>;
                      return (
                        <td key={c.key} style={tdNum(T)}>
                          <div style={{fontWeight:700}}>{fmt(cel.total)}</div>
                          <div style={{fontSize:10.5,color:T.textSm,fontFamily:FONT.ui}}>
                            <b style={{color:T.textMd}}>{cel.n}</b> jogo{cel.n===1?"":"s"} · <span className="num" style={{fontFamily:FONT.num}}>{fmt(Math.round(cel.total / cel.n))}</span>/jogo
                          </div>
                        </td>
                      );
                    })}
                    <td style={tdNum(T, { borderLeft:`1px solid ${T.border}`, background:T.surfaceAlt||T.bg })}>
                      <div style={{fontWeight:700}}>{fmt(tp.total)}</div>
                      <div style={{fontSize:10.5,color:T.textSm,fontFamily:FONT.ui}}><b style={{color:T.textMd}}>{tp.n}</b> jogo{tp.n===1?"":"s"} · {pctOf(tp.total, totais.totalJogos)}</div>
                    </td>
                  </tr>
                );
              })}
              <tr style={{borderTop:`2px solid ${T.borderStrong||T.border}`,background:T.surfaceAlt||T.bg}}>
                <td style={{padding:"12px 16px",fontWeight:700,color:T.text,fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase"}}>Total faixa</td>
                {matriz.colunas.map(c => {
                  const tf = matriz.porFaixa[c.key];
                  return (
                    <td key={c.key} style={tdNum(T)}>
                      <div style={{fontWeight:700}}>{fmt(tf.total)}</div>
                      <div style={{fontSize:10.5,color:T.textSm,fontFamily:FONT.ui}}><b style={{color:T.textMd}}>{tf.n}</b> jogo{tf.n===1?"":"s"} · {pctOf(tf.total, totais.totalJogos)}</div>
                    </td>
                  );
                })}
                <td style={tdNum(T, { borderLeft:`1px solid ${T.border}`, color:COR_VAR, fontSize:14, fontWeight:700 })}>
                  <div>{fmt(totais.totalJogos)}</div>
                  <div style={{fontSize:10.5,color:T.textSm,fontFamily:FONT.ui,fontWeight:500}}><b style={{color:T.textMd}}>{numJogos}</b> jogos</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── 3. Por fase ── */}
      {fases.length > 0 && (
        <Card T={T}>
          <SectionHeader T={T} icon={Trophy} title="Por fase" subtitle="Jogos, total e custo médio por jogo em cada fase da competição"/>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:560}}>
              <thead>
                <tr style={{background:T.surfaceAlt||T.bg}}>
                  <th style={thStyle(T, true)}>Fase</th>
                  <th style={thStyle(T)}>Jogos</th>
                  <th style={thStyle(T)}>Total</th>
                  <th style={thStyle(T)}>Média / jogo</th>
                  <th style={thStyle(T)}>% variável</th>
                  <th style={{...thStyle(T), textAlign:"left", paddingLeft:20}}>Peso</th>
                </tr>
              </thead>
              <tbody>
                {porFase.map(f => {
                  const fase = fases.find(x => x.key === f.key);
                  const pct = totais.totalJogos ? (f.total / totais.totalJogos) * 100 : 0;
                  return (
                    <tr key={f.key} style={{borderTop:`1px solid ${T.border}`}}>
                      <td style={{padding:"11px 16px",fontWeight:600,color:T.text,fontSize:13,whiteSpace:"nowrap"}}>
                        <span style={{display:"inline-flex",alignItems:"center",gap:8}}><span style={{width:8,height:8,borderRadius:2,background:fase?.color||COR_VAR}}/>{f.label}</span>
                      </td>
                      <td style={tdNum(T)}>{f.n}</td>
                      <td style={tdNum(T, { fontWeight:700 })}>{fmt(f.total)}</td>
                      <td style={tdNum(T, { color:T.textMd })}>{fmt(Math.round(f.total / f.n))}</td>
                      <td style={tdNum(T, { color:T.textMd })}>{pct.toFixed(1)}%</td>
                      <td style={{padding:"11px 20px",minWidth:140}}><Progress value={pct} T={T} color={fase?.color||COR_VAR}/></td>
                    </tr>
                  );
                })}
                <tr style={{borderTop:`2px solid ${T.borderStrong||T.border}`,background:T.surfaceAlt||T.bg,fontWeight:700}}>
                  <td style={{padding:"12px 16px",color:T.text,fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase"}}>Total variável</td>
                  <td style={tdNum(T)}>{numJogos}</td>
                  <td style={tdNum(T, { color:COR_VAR, fontSize:14 })}>{fmt(totais.totalJogos)}</td>
                  <td style={tdNum(T, { color:T.textMd })}>{numJogos ? fmt(Math.round(totais.totalJogos / numJogos)) : "—"}</td>
                  <td style={tdNum(T)}>100%</td>
                  <td/>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── 5. Categoria → serviço (com "por jogo" nas variáveis) ── */}
      <Card T={T}>
        <SectionHeader T={T} icon={LayoutDashboard} title="Por categoria de despesa"
          subtitle="Clique na linha para abrir o detalhamento por serviço. Variáveis mostram também o valor médio por jogo."/>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:680}}>
            <thead>
              <tr style={{background:T.surfaceAlt||T.bg}}>
                <th style={thStyle(T, true)}>Categoria</th>
                <th style={thStyle(T)}>Orçado</th>
                <th style={thStyle(T)}>Por jogo</th>
                <th style={thStyle(T)}>% do total</th>
                <th style={{...thStyle(T), textAlign:"left", paddingLeft:20}}>Peso</th>
              </tr>
            </thead>
            <tbody>
              {/* Faixa "Variáveis" e "Fixos" como divisórias, com subtotais */}
              {[
                { key:"var",  label:"Custos variáveis · por jogo", cor:COR_VAR,  total:totais.totalJogos, grupos:linhas.filter(g => g.tipo === "variavel") },
                { key:"fixo", label:"Custos fixos · por edição",    cor:COR_FIXO, total:totais.totalFixos, grupos:linhas.filter(g => g.tipo === "fixo") },
              ].map(bloco => [
                <tr key={`b-${bloco.key}`} style={{background:`${bloco.cor}10`,borderTop:`3px solid ${bloco.cor}`}}>
                  <td style={{padding:"9px 16px",fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:bloco.cor}}>{bloco.label}</td>
                  <td style={tdNum(T, { fontWeight:700, color:bloco.cor })}>{fmt(bloco.total)}</td>
                  <td style={tdNum(T, { color:T.textSm, fontSize:11 })}>{bloco.key === "var" && numJogos ? fmt(Math.round(bloco.total / numJogos)) : ""}</td>
                  <td style={tdNum(T, { color:T.textMd })}>{pctOf(bloco.total, totalGeral)}</td>
                  <td/>
                </tr>,
                ...bloco.grupos.flatMap(g => {
                  const pct = totalGeral ? (g.total / totalGeral) * 100 : 0;
                  const aberta = abertas.has(g.key);
                  const temItens = g.itens.length > 0;
                  return [
                    <tr key={g.key} onClick={() => temItens && toggle(g.key)}
                      title={temItens ? (aberta ? "Fechar detalhamento" : "Ver detalhamento por serviço") : undefined}
                      style={{borderTop:`1px solid ${T.border}`,cursor:temItens?"pointer":"default"}}
                      onMouseEnter={e => { if (temItens) e.currentTarget.style.background = T.surfaceAlt||T.bg; }}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <td style={{padding:"12px 16px",fontWeight:600,whiteSpace:"nowrap",color:T.text,fontSize:13}}>
                        <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                          <ChevronRight size={14} strokeWidth={2.5} style={{color:temItens ? T.textMd : "transparent",transform:aberta ? "rotate(90deg)" : "none",transition:"transform .15s",flexShrink:0}}/>
                          <span style={{width:8,height:8,borderRadius:2,background:g.color,flexShrink:0}}/>
                          {g.label}
                        </span>
                      </td>
                      <td style={tdNum(T, { fontWeight:600 })}>{fmt(g.total)}</td>
                      <td style={tdNum(T, { color:T.textMd })}>{g.tipo === "variavel" && numJogos ? fmt(Math.round(g.total / numJogos)) : "—"}</td>
                      <td style={tdNum(T, { color:T.textMd })}>{pct.toFixed(1)}%</td>
                      <td style={{padding:"12px 20px",minWidth:120}}><Progress value={pct} T={T} color={g.color}/></td>
                    </tr>,
                    ...(aberta ? g.itens.map(it => {
                      const pctIt = totalGeral ? (it.valor / totalGeral) * 100 : 0;
                      return (
                        <tr key={`${g.key}_${it.key}`} style={{borderTop:`1px solid ${T.border}`,background:T.surfaceAlt||T.bg}}>
                          <td style={{padding:`${it.secao?"10px":"7px"} 16px ${it.secao?"6px":"7px"} 52px`,whiteSpace:"nowrap",
                            color:it.secao ? T.textSm : T.textMd, fontSize:it.secao ? 10 : 12, fontWeight:it.secao ? 700 : 500,
                            letterSpacing:it.secao ? "0.06em" : 0, textTransform:it.secao ? "uppercase" : "none"}}>
                            {it.label}
                          </td>
                          <td style={tdNum(T, { padding:"7px 16px", color:it.secao ? T.textSm : T.textMd, fontSize:12, fontWeight:it.secao?600:400 })}>{fmt(it.valor)}</td>
                          <td style={tdNum(T, { padding:"7px 16px", color:T.textSm, fontSize:11 })}>{g.tipo === "variavel" && !it.secao && numJogos ? fmt(Math.round(it.valor / numJogos)) : ""}</td>
                          <td style={tdNum(T, { padding:"7px 16px", color:T.textSm, fontSize:11 })}>{it.secao ? "" : `${pctIt.toFixed(1)}%`}</td>
                          <td style={{padding:"7px 20px",minWidth:120}}>{!it.secao && <Progress value={g.total ? (it.valor / g.total) * 100 : 0} T={T} color={`${g.color}88`} height={3}/>}</td>
                        </tr>
                      );
                    }) : []),
                  ];
                }),
              ])}
              <tr style={{borderTop:`3px solid ${T.borderStrong||T.border}`,background:T.surfaceAlt||T.bg,fontWeight:700}}>
                <td style={{padding:"14px 16px",color:T.text,fontSize:12,letterSpacing:"0.04em",textTransform:"uppercase"}}>Total geral</td>
                <td style={tdNum(T, { color:T.info||COR_VAR, fontSize:14, fontWeight:700 })}>{fmt(totalGeral)}</td>
                <td/>
                <td style={tdNum(T, { fontSize:14 })}>100%</td>
                <td/>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── 4. Por mandante (retrátil) ── */}
      <Card T={T}>
        <button onClick={() => setMandantesAberto(v => !v)} style={{
          width:"100%",padding:"14px 20px",border:"none",background:"transparent",cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,textAlign:"left",fontFamily:FONT.ui,
          borderBottom: mandantesAberto ? `1px solid ${T.border}` : "none",
        }}>
          <span style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{width:32,height:32,borderRadius:8,background:`${COR_VAR}14`,color:COR_VAR,display:"inline-flex",alignItems:"center",justifyContent:"center"}}><Users size={16} strokeWidth={2.25}/></span>
            <span>
              <span style={{display:"block",fontSize:13,fontWeight:600,color:T.text}}>Por mandante</span>
              <span style={{display:"block",fontSize:11,color:T.textSm,marginTop:2}}>{porMandante.filter(m => !m.mata).length} mandantes · jogos em casa, categorias e custo · mata-mata ao final</span>
            </span>
          </span>
          <span style={{display:"inline-flex",alignItems:"center",gap:6,color:T.textMd,fontSize:11,fontWeight:600}}>
            {mandantesAberto ? "Ocultar" : "Mostrar"}{mandantesAberto ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
          </span>
        </button>
        {mandantesAberto && (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:720}}>
              <thead>
                <tr style={{background:T.surfaceAlt||T.bg}}>
                  <th style={thStyle(T, true)}>Mandante / fase</th>
                  <th style={thStyle(T, true)}>Praça · faixa</th>
                  <th style={thStyle(T)}>Jogos</th>
                  <th style={thStyle(T, true)}>Categorias</th>
                  <th style={thStyle(T)}>Total</th>
                  <th style={thStyle(T)}>Média / jogo</th>
                </tr>
              </thead>
              <tbody>
                {porMandante.map((mnd, i) => {
                  const primeiroMata = mnd.mata && (i === 0 || !porMandante[i - 1].mata);
                  return [
                    primeiroMata && (
                      <tr key="sep-mata" style={{background:T.surfaceAlt||T.bg}}>
                        <td colSpan={6} style={{padding:"7px 16px",fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.textSm,borderTop:`2px solid ${T.borderStrong||T.border}`}}>Mata-mata</td>
                      </tr>
                    ),
                    <tr key={mnd.key} style={{borderTop:`1px solid ${T.border}`}}>
                      <td style={{padding:"10px 16px",fontWeight:600,color:T.text,fontSize:12.5,whiteSpace:"nowrap"}}>{mnd.label}</td>
                      <td style={{padding:"10px 16px",color:T.textMd,fontSize:12,whiteSpace:"nowrap"}}>{mnd.praca}{mnd.faixa ? <span style={{color:T.textSm}}> · {mnd.faixa}</span> : ""}</td>
                      <td style={tdNum(T)}>{mnd.n}</td>
                      <td style={{padding:"10px 16px",whiteSpace:"nowrap"}}>
                        <span style={{display:"inline-flex",gap:6,flexWrap:"wrap"}}>
                          {Object.entries(mnd.pads).sort((a, b) => padroes.indexOf(a[0]) - padroes.indexOf(b[0])).map(([p, n]) => (
                            <Badge key={p} T={T} color={COR_VAR} size="sm">{n}× {p}</Badge>
                          ))}
                        </span>
                      </td>
                      <td style={tdNum(T, { fontWeight:700 })}>{fmt(mnd.total)}</td>
                      <td style={tdNum(T, { color:T.textMd })}>{fmt(Math.round(mnd.total / mnd.n))}</td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── 7. Status / aprovação ── */}
      {readOnly ? (
        <Card T={T} accent={st.color}>
          <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <Badge T={T} color={st.color}>{st.label}</Badge>
            <span style={{fontSize:12.5,color:T.textMd}}>
              {orc.meta.status === "aprovado"
                ? <>Orçamento aprovado{orc.meta.aprovadoEm ? ` em ${new Date(orc.meta.aprovadoEm).toLocaleDateString("pt-BR")}` : ""}{orc.meta.campeonatoCriadoId ? ` · campeonato ${orc.meta.campeonatoCriadoId}` : ""}.</>
                : <>Proposta em construção pela Livemode · última atualização {orc.meta.updatedAt ? new Date(orc.meta.updatedAt).toLocaleDateString("pt-BR") : "—"}.</>}
            </span>
          </div>
        </Card>
      ) : (
        <Card T={T} accent={st.color}>
          <div style={{padding:20,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:240}}>
              <p style={{margin:0,fontSize:13,fontWeight:700,color:T.text}}>
                {orc.meta.status === "em_revisao" ? "Pronto para aprovar?" : "Este orçamento ainda está em rascunho."}
              </p>
              <p style={{margin:"4px 0 0",fontSize:12,color:T.textMd,lineHeight:1.5}}>
                {orc.meta.status === "em_revisao"
                  ? "Aprovar cria o campeonato com o orçado carimbado em cada jogo e congela este orçamento."
                  : "Envie para revisão na aba Configuração para liberar a aprovação."}
              </p>
              {errosAprovacao.length > 0 && (
                <div style={{marginTop:10}}>
                  {errosAprovacao.map((e, i) => (
                    <p key={i} style={{margin:"3px 0 0",fontSize:11,color:T.danger||"#DC2626",display:"flex",alignItems:"center",gap:6}}>
                      <AlertCircle size={12} style={{flexShrink:0}}/> {e}
                    </p>
                  ))}
                </div>
              )}
            </div>
            {canAprovar && (
              <Button T={T} variant="primary" size="lg" icon={Trophy} onClick={onAprovar}>Aprovar orçamento</Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
