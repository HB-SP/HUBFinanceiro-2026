import { useMemo, useState } from "react";
import { iSty, FONT } from "../../constants";
import { Card, SectionHeader, Button, Stat, Badge, tableStyles } from "../ui";
import { SUBS_LOGISTICA, logisticaDaPraca, calcOrcadoJogo } from "../../data/orcamentos";
import { fmt, fmtK } from "../../utils";
import { MapPin, Route, Plus, Trash2, Wallet, SlidersHorizontal, Link2, Unlink2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";

// ─── PRAÇAS & LOGÍSTICA ───────────────────────────────────────────────────────
// Como a logística de um jogo é montada (nesta ordem):
//   1. FAIXA de distância da praça → tabela de referência (SP / SP200 / SP400…)
//   2. PRAÇA com valores PRÓPRIOS → substitui a faixa inteira (mesmos 5 campos)
//   3. AJUSTE no jogo (override, aba Jogos) → vence tudo, só naquele jogo
// A tela mostra os 3 níveis nas MESMAS 5 colunas: a linha da faixa serve de
// referência e cada praça aparece embaixo dela com o valor que realmente vale.
const COR_FAIXA   = "#16A34A"; // verde  — valor herdado da faixa
const COR_PROPRIA = "#D97706"; // âmbar  — valor próprio da praça
const COR_AJUSTE  = "#7C3AED"; // roxo   — jogo com ajuste manual (override)

export default function SubPracas({ orc, setOrc, readOnly, T }) {
  const IS = iSty(T);
  const ts = tableStyles(T);
  const [novaFaixa, setNovaFaixa] = useState("");
  const [novaCidade, setNovaCidade] = useState("");
  const [novaCidadeFaixa, setNovaCidadeFaixa] = useState("");
  // Grupos (faixas) recolhidos na tabela de praças — persiste por orçamento no navegador
  const lsKeyRecolhidos = `hub_orc_pracas_recolhidos_${orc.id}`;
  const [recolhidos, setRecolhidos] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(lsKeyRecolhidos) || "[]")); } catch { return new Set(); }
  });
  const salvaRecolhidos = (next) => { try { localStorage.setItem(lsKeyRecolhidos, JSON.stringify([...next])); } catch {} return next; };
  const toggleGrupo = (key) => setRecolhidos(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return salvaRecolhidos(n); });

  const faixas = orc.faixas || [];
  const pracas = orc.pracas || [];
  const jogos  = orc.jogos  || [];

  const slugFaixa = (label) => String(label).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const somaLog = (log) => log ? SUBS_LOGISTICA.reduce((s, sub) => s + (Number(log[sub.key]) || 0), 0) : 0;
  const LOGK = SUBS_LOGISTICA.map(s => s.key);

  // ── Estatísticas por praça e por faixa (jogos, ajustes, total) ──
  const info = useMemo(() => {
    const porPraca = new Map();
    let totalLogistica = 0, jogosAjustados = 0;
    jogos.forEach(j => {
      const orcado = calcOrcadoJogo(orc, j);
      const log = LOGK.reduce((s, k) => s + (orcado[k] || 0), 0);
      totalLogistica += log;
      const ajustes = LOGK.filter(k => j.overrides && k in j.overrides);
      if (ajustes.length) jogosAjustados++;
      const st = porPraca.get(j.pracaId) || { jogos: 0, ajustados: [], total: 0 };
      st.jogos++; st.total += log;
      if (ajustes.length) st.ajustados.push({ jogo: j, ajustes });
      porPraca.set(j.pracaId, st);
    });
    const porFaixa = new Map();
    pracas.forEach(p => {
      const key = faixas.some(f => f.key === p.faixaKey) ? p.faixaKey : "__sem_faixa";
      const st = porFaixa.get(key) || { pracas: 0, jogos: 0, proprias: 0 };
      st.pracas++; st.jogos += porPraca.get(p.id)?.jogos || 0; if (p.logistica) st.proprias++;
      porFaixa.set(key, st);
    });
    return { porPraca, porFaixa, totalLogistica, jogosAjustados, pracasProprias: pracas.filter(p => p.logistica).length };
  }, [orc, jogos, pracas, faixas]);

  // ── Faixas ──
  const addFaixa = () => {
    const label = novaFaixa.trim();
    if (!label) return;
    const key = slugFaixa(label);
    if (!key || faixas.some(f => f.key === key)) { window.alert(`Já existe uma faixa "${label}".`); return; }
    setOrc(prev => ({
      ...prev,
      faixas: [...(prev.faixas || []), { key, label, logistica:{ transporte:0, uber:0, hospedagem:0, diaria:0, outros_log:0 } }],
    }));
    setNovaFaixa("");
  };
  const removeFaixa = (key) => {
    const emUso = pracas.filter(p => p.faixaKey === key).length;
    if (emUso > 0) { window.alert(`Esta faixa está em uso por ${emUso} praça(s). Troque a faixa dessas praças antes de remover.`); return; }
    if (!window.confirm("Remover esta faixa de distância?")) return;
    setOrc(prev => ({ ...prev, faixas: (prev.faixas || []).filter(f => f.key !== key) }));
  };
  const setValorFaixa = (key, subKey, raw) => {
    setOrc(prev => ({
      ...prev,
      faixas: (prev.faixas || []).map(f => {
        if (f.key !== key) return f;
        const v = String(raw).replace(/[^0-9.,\-]/g, "").replace(",", ".");
        return { ...f, logistica: { ...f.logistica, [subKey]: v === "" ? 0 : (parseFloat(v) || 0) } };
      }),
    }));
  };
  const renomearFaixa = (key, label) => {
    setOrc(prev => ({ ...prev, faixas: (prev.faixas || []).map(f => f.key === key ? { ...f, label } : f) }));
  };

  // ── Praças ──
  const addPraca = () => {
    const cidade = novaCidade.trim();
    if (!cidade) return;
    if (pracas.some(p => p.cidade.toLowerCase() === cidade.toLowerCase())) { window.alert(`A praça "${cidade}" já existe.`); return; }
    setOrc(prev => ({
      ...prev,
      pracas: [...(prev.pracas || []), {
        id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        cidade,
        faixaKey: novaCidadeFaixa || (prev.faixas || [])[0]?.key || "",
      }],
    }));
    setNovaCidade("");
  };
  const removePraca = (id) => {
    const emUso = jogos.filter(j => j.pracaId === id).length;
    if (emUso > 0) { window.alert(`Esta praça está em uso por ${emUso} jogo(s). Troque a praça desses jogos antes de remover.`); return; }
    setOrc(prev => ({ ...prev, pracas: (prev.pracas || []).filter(p => p.id !== id) }));
  };
  const patchPraca = (id, patch) => {
    setOrc(prev => ({ ...prev, pracas: (prev.pracas || []).map(p => p.id === id ? { ...p, ...patch } : p) }));
  };
  // Própria começa copiando a faixa (ponto de partida); voltar à faixa descarta a própria.
  const setModoPraca = (id, modo) => {
    setOrc(prev => ({
      ...prev,
      pracas: (prev.pracas || []).map(p => {
        if (p.id !== id) return p;
        if (modo === "propria") {
          if (p.logistica) return p;
          const faixa = (prev.faixas || []).find(f => f.key === p.faixaKey);
          return { ...p, logistica: { transporte:0, uber:0, hospedagem:0, diaria:0, outros_log:0, ...(faixa?.logistica || {}) } };
        }
        if (p.logistica && !window.confirm(`Voltar a herdar da faixa? Os valores próprios de "${p.cidade}" serão descartados.`)) return p;
        return { ...p, logistica: null };
      }),
    }));
  };
  const setValorPraca = (id, subKey, raw) => {
    setOrc(prev => ({
      ...prev,
      pracas: (prev.pracas || []).map(p => {
        if (p.id !== id || !p.logistica) return p;
        const v = String(raw).replace(/[^0-9.,\-]/g, "").replace(",", ".");
        return { ...p, logistica: { ...p.logistica, [subKey]: v === "" ? 0 : (parseFloat(v) || 0) } };
      }),
    }));
  };

  // ── Estilos de célula ──
  const inputNum = (cor, ativo) => ({
    ...IS, width:96, maxWidth:96, textAlign:"right",
    fontFamily:FONT.num, fontSize:12, padding:"5px 8px",
    background: ativo ? `${cor}14` : (T.surface||T.bg),
    borderColor: ativo ? `${cor}66` : undefined,
    opacity: readOnly ? 0.75 : 1,
  });
  const numMuted = { fontFamily:FONT.num, fontSize:12, color:T.textSm, fontVariantNumeric:"tabular-nums" };
  const Chip = ({ cor, children, title }) => (
    <span title={title} style={{
      display:"inline-flex", alignItems:"center", gap:4, fontSize:10, fontWeight:700, whiteSpace:"nowrap",
      padding:"1px 8px", borderRadius:999, background:`${cor}1a`, color:cor, border:`1px solid ${cor}44`,
    }}>{children}</span>
  );
  const Legenda = () => (
    <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"center",fontSize:11,color:T.textMd}}>
      {[[COR_FAIXA,"valor da faixa (herdado)"],[COR_PROPRIA,"valor próprio da praça"],[COR_AJUSTE,"jogo com ajuste manual (aba Jogos)"]].map(([c,l]) => (
        <span key={l} style={{display:"inline-flex",alignItems:"center",gap:6}}>
          <span style={{width:10,height:10,borderRadius:3,background:`${c}33`,border:`1px solid ${c}`}}/>{l}
        </span>
      ))}
    </div>
  );

  // Grupos da tabela de praças: uma seção por faixa (ordem do orçamento) + "sem faixa"
  const grupos = useMemo(() => {
    const byFaixa = faixas.map(f => ({
      key: f.key, faixa: f,
      pracas: pracas.filter(p => p.faixaKey === f.key).sort((a, b) => a.cidade.localeCompare(b.cidade, "pt-BR")),
    }));
    const orfas = pracas.filter(p => !faixas.some(f => f.key === p.faixaKey)).sort((a, b) => a.cidade.localeCompare(b.cidade, "pt-BR"));
    if (orfas.length) byFaixa.push({ key:"__sem_faixa", faixa:null, pracas:orfas });
    return byFaixa;
  }, [faixas, pracas]);

  const nCols = 3 + SUBS_LOGISTICA.length + 2 + (readOnly ? 0 : 1);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      {/* ── KPIs ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}>
        <Stat T={T} label="Logística do orçamento" value={fmtK(info.totalLogistica)} sub={`${fmt(info.totalLogistica)} em ${jogos.length} jogos`} color={T.info||"#2563EB"} icon={Wallet}/>
        <Stat T={T} label="Faixas de distância" value={String(faixas.length)} sub="tabela de referência por jogo" color={COR_FAIXA} icon={Route}/>
        <Stat T={T} label="Praças" value={String(pracas.length)} sub={`${info.pracasProprias} com valores próprios`} color={COR_PROPRIA} icon={MapPin}/>
        <Stat T={T} label="Jogos com ajuste" value={String(info.jogosAjustados)} sub="logística alterada na aba Jogos" color={COR_AJUSTE} icon={SlidersHorizontal}/>
      </div>

      {/* ── Faixas de distância (referência) ── */}
      <Card T={T} accent={COR_FAIXA}>
        <SectionHeader T={T} icon={Route} title="1 · Faixas de distância"
          subtitle="Tabela de referência: valores de logística POR JOGO. Toda praça sem valores próprios usa a linha da sua faixa."/>
        <div style={ts.wrap}>
          <table style={ts.table}>
            <thead style={ts.thead}>
              <tr>
                <th style={{...ts.th, ...ts.thLeft, minWidth:200}}>Faixa</th>
                {SUBS_LOGISTICA.map(sub => <th key={sub.key} style={{...ts.th, ...ts.thRight, minWidth:105}}>{sub.label}</th>)}
                <th style={{...ts.th, ...ts.thRight}}>Total / jogo</th>
                <th style={{...ts.th, ...ts.thRight}}>Praças · Jogos</th>
                {!readOnly && <th style={ts.th}/>}
              </tr>
            </thead>
            <tbody>
              {faixas.map(f => {
                const st = info.porFaixa.get(f.key) || { pracas:0, jogos:0, proprias:0 };
                return (
                  <tr key={f.key} style={ts.tr}>
                    <td style={{...ts.td, padding:"6px 14px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{width:8,height:8,borderRadius:2,background:COR_FAIXA,flexShrink:0}}/>
                        <input value={f.label} disabled={readOnly} onChange={e=>renomearFaixa(f.key, e.target.value)}
                          style={{...IS, maxWidth:150, fontWeight:600, fontSize:12, padding:"5px 8px", opacity:readOnly?0.75:1}}/>
                      </div>
                    </td>
                    {SUBS_LOGISTICA.map(sub => (
                      <td key={sub.key} style={{...ts.tdNum, padding:"6px 10px"}}>
                        <input value={f.logistica?.[sub.key] ?? ""} disabled={readOnly} placeholder="0" inputMode="decimal"
                          onChange={e=>setValorFaixa(f.key, sub.key, e.target.value)}
                          style={inputNum(COR_FAIXA, Number(f.logistica?.[sub.key]) > 0)}/>
                      </td>
                    ))}
                    <td className="num" style={{...ts.tdNum, fontWeight:700}}>{fmt(somaLog(f.logistica))}</td>
                    <td className="num" style={{...ts.tdNum, color:T.textMd, fontSize:12}}>
                      {st.pracas} · {st.jogos}
                      {st.proprias > 0 && <span style={{marginLeft:6}}><Chip cor={COR_PROPRIA} title={`${st.proprias} praça(s) desta faixa com valores próprios`}>{st.proprias} própria{st.proprias===1?"":"s"}</Chip></span>}
                    </td>
                    {!readOnly && (
                      <td style={{...ts.td, padding:"6px 10px"}}>
                        <button title="Remover faixa" onClick={()=>removeFaixa(f.key)}
                          style={{border:"none",background:"transparent",cursor:"pointer",color:T.danger||"#DC2626",padding:4,display:"flex"}}>
                          <Trash2 size={14}/>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {faixas.length === 0 && (
                <tr><td colSpan={SUBS_LOGISTICA.length + 3} style={{...ts.td, color:T.textSm, fontSize:12}}>Nenhuma faixa — adicione abaixo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <div style={{padding:"12px 20px 18px",display:"flex",gap:8,alignItems:"center",borderTop:`1px solid ${T.border}`}}>
            <input value={novaFaixa} onChange={e=>setNovaFaixa(e.target.value)}
              onKeyDown={e=>{ if (e.key === "Enter") addFaixa(); }}
              style={{...IS, maxWidth:180}} placeholder="Nova faixa (ex: SP600)..."/>
            <Button T={T} variant="secondary" size="sm" icon={Plus} onClick={addFaixa} disabled={!novaFaixa.trim()}>Adicionar faixa</Button>
          </div>
        )}
      </Card>

      {/* ── Praças agrupadas por faixa ── */}
      <Card T={T} accent={COR_PROPRIA}>
        <SectionHeader T={T} icon={MapPin} title="2 · Praças por faixa"
          subtitle="Cada praça mostra a logística que VALE nos seus jogos: herdada da faixa (verde) ou própria (âmbar). Ajustes por jogo ficam na aba Jogos."
          right={
            <span style={{display:"inline-flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <Legenda/>
              {grupos.length > 0 && (() => {
                const tudoRecolhido = grupos.every(g => recolhidos.has(g.key));
                return (
                  <Button T={T} variant="secondary" size="sm" icon={tudoRecolhido ? ChevronsUpDown : ChevronsDownUp}
                    onClick={() => setRecolhidos(() => salvaRecolhidos(tudoRecolhido ? new Set() : new Set(grupos.map(g => g.key))))}>
                    {tudoRecolhido ? "Expandir tudo" : "Recolher tudo"}
                  </Button>
                );
              })()}
            </span>
          }/>
        <div style={ts.wrap}>
          <table style={{...ts.table, minWidth:980}}>
            <thead style={ts.thead}>
              <tr>
                <th style={{...ts.th, ...ts.thLeft, minWidth:220}}>Praça</th>
                <th style={{...ts.th, ...ts.thLeft, minWidth:150}}>Faixa</th>
                <th style={{...ts.th, ...ts.thLeft, minWidth:120}}>Origem</th>
                {SUBS_LOGISTICA.map(sub => <th key={sub.key} style={{...ts.th, ...ts.thRight, minWidth:105}}>{sub.label}</th>)}
                <th style={{...ts.th, ...ts.thRight}}>Total / jogo</th>
                <th style={{...ts.th, ...ts.thRight}}>Jogos</th>
                {!readOnly && <th style={ts.th}/>}
              </tr>
            </thead>
            <tbody>
              {grupos.map(g => {
                const st = info.porFaixa.get(g.key) || { pracas:0, jogos:0, proprias:0 };
                const aberto = !recolhidos.has(g.key);
                return [
                  // Cabeçalho da faixa: os valores de referência nas mesmas colunas
                  <tr key={`fx-${g.key}`} onClick={()=>toggleGrupo(g.key)} title={aberto ? "Recolher faixa" : "Expandir faixa"}
                    style={{background:`${COR_FAIXA}0d`, borderTop:`2px solid ${COR_FAIXA}55`, cursor:"pointer", userSelect:"none"}}>
                    <td colSpan={3} style={{padding:"9px 14px"}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                        {aberto ? <ChevronDown size={14} color={T.textSm}/> : <ChevronRight size={14} color={T.textSm}/>}
                        <span style={{width:8,height:8,borderRadius:2,background:g.faixa ? COR_FAIXA : (T.danger||"#DC2626")}}/>
                        <span style={{fontSize:12,fontWeight:700,color:T.text}}>{g.faixa ? g.faixa.label : "Sem faixa válida"}</span>
                        <span style={{fontSize:11,color:T.textSm}}>{g.faixa ? "referência da faixa · por jogo" : "escolha uma faixa para estas praças"}</span>
                        <span style={{fontSize:11,color:T.textSm}}>— {st.pracas} praça{st.pracas===1?"":"s"} · {st.jogos} jogo{st.jogos===1?"":"s"}</span>
                      </span>
                    </td>
                    {SUBS_LOGISTICA.map(sub => (
                      <td key={sub.key} className="num" style={{...ts.tdNum, padding:"9px 14px", ...numMuted, color:COR_FAIXA, fontWeight:600}}>
                        {g.faixa ? (Number(g.faixa.logistica?.[sub.key]) ? fmt(g.faixa.logistica[sub.key]) : "—") : ""}
                      </td>
                    ))}
                    <td className="num" style={{...ts.tdNum, padding:"9px 14px", color:COR_FAIXA, fontWeight:700, fontSize:12}}>{g.faixa ? fmt(somaLog(g.faixa.logistica)) : ""}</td>
                    <td colSpan={readOnly ? 1 : 2}/>
                  </tr>,
                  ...(aberto ? g.pracas : []).map(p => {
                    const propria = !!p.logistica;
                    const { logistica } = logisticaDaPraca(orc, p);
                    const stP = info.porPraca.get(p.id) || { jogos:0, ajustados:[], total:0 };
                    const cor = propria ? COR_PROPRIA : COR_FAIXA;
                    return (
                      <tr key={p.id} style={{...ts.tr, background: propria ? `${COR_PROPRIA}06` : undefined}}>
                        <td style={{...ts.td, padding:"6px 14px 6px 30px"}}>
                          <input value={p.cidade} disabled={readOnly} onChange={e=>patchPraca(p.id, {cidade:e.target.value})}
                            style={{...IS, maxWidth:200, fontSize:12, fontWeight:600, padding:"5px 8px", opacity:readOnly?0.75:1}}/>
                        </td>
                        <td style={{...ts.td, padding:"6px 14px"}}>
                          <select value={p.faixaKey} disabled={readOnly} onChange={e=>patchPraca(p.id, {faixaKey:e.target.value})}
                            title={propria ? "A faixa segue classificando a distância (matriz padrão × faixa da aba Premissas), mas a logística vem dos valores próprios" : undefined}
                            style={{...IS, maxWidth:140, fontSize:12, padding:"5px 8px", opacity:readOnly?0.75:1,
                                    borderColor: g.faixa ? undefined : (T.danger||"#DC2626")}}>
                            {!g.faixa && <option value={p.faixaKey}>Faixa inválida</option>}
                            {faixas.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </td>
                        <td style={{...ts.td, padding:"6px 14px"}}>
                          {/* Alternador Faixa / Própria — dois estados, sem select */}
                          <div style={{display:"inline-flex",border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                            {[["faixa","Faixa",Link2,COR_FAIXA],["propria","Própria",Unlink2,COR_PROPRIA]].map(([modo,label,Icon,c]) => {
                              const on = propria ? modo === "propria" : modo === "faixa";
                              return (
                                <button key={modo} disabled={readOnly} onClick={()=>setModoPraca(p.id, modo)}
                                  title={modo === "faixa" ? "Herdar a logística da faixa" : "Definir valores próprios para esta praça"}
                                  style={{
                                    display:"inline-flex",alignItems:"center",gap:5,padding:"4px 9px",border:"none",
                                    cursor: readOnly ? "default" : "pointer", fontSize:11, fontWeight:700,
                                    background: on ? `${c}1f` : "transparent", color: on ? c : T.textSm,
                                  }}>
                                  <Icon size={12}/>{label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        {SUBS_LOGISTICA.map(sub => (
                          <td key={sub.key} className="num" style={{...ts.tdNum, padding:"6px 10px"}}>
                            {propria ? (
                              <input value={p.logistica?.[sub.key] ?? ""} disabled={readOnly} placeholder="0" inputMode="decimal"
                                onChange={e=>setValorPraca(p.id, sub.key, e.target.value)}
                                style={inputNum(COR_PROPRIA, Number(p.logistica?.[sub.key]) > 0)}/>
                            ) : (
                              <span style={{...numMuted, color: Number(logistica?.[sub.key]) ? T.textMd : T.textSm}}>
                                {Number(logistica?.[sub.key]) ? fmt(logistica[sub.key]) : "—"}
                              </span>
                            )}
                          </td>
                        ))}
                        <td className="num" style={{...ts.tdNum, fontWeight:700, color:cor}}>{logistica ? fmt(somaLog(logistica)) : "—"}</td>
                        <td className="num" style={{...ts.tdNum, fontSize:12}}>
                          <span style={{display:"inline-flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}>
                            <span style={{color: stP.jogos ? T.text : T.textSm}}>{stP.jogos}</span>
                            {stP.ajustados.length > 0 && (
                              <Chip cor={COR_AJUSTE}
                                title={stP.ajustados.map(a => `${a.jogo.codigoPlanilha || `Jogo ${a.jogo.id}`}: ${a.ajustes.map(k => SUBS_LOGISTICA.find(s => s.key === k)?.label || k).join(", ")}`).join("\n")}>
                                {stP.ajustados.length} ajuste{stP.ajustados.length===1?"":"s"}
                              </Chip>
                            )}
                          </span>
                        </td>
                        {!readOnly && (
                          <td style={{...ts.td, padding:"6px 10px"}}>
                            <button title="Remover praça" onClick={()=>removePraca(p.id)}
                              style={{border:"none",background:"transparent",cursor:"pointer",color:T.danger||"#DC2626",padding:4,display:"flex"}}>
                              <Trash2 size={14}/>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  }),
                  aberto && g.pracas.length === 0 && (
                    <tr key={`vazio-${g.key}`}>
                      <td colSpan={nCols} style={{...ts.td, padding:"8px 14px 10px 30px", color:T.textSm, fontSize:11, fontStyle:"italic"}}>Nenhuma praça nesta faixa.</td>
                    </tr>
                  ),
                ];
              })}
              {pracas.length === 0 && faixas.length === 0 && (
                <tr><td colSpan={nCols} style={{...ts.td, color:T.textSm, fontSize:12}}>Nenhuma praça — crie uma faixa e adicione abaixo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <div style={{padding:"12px 20px 18px",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",borderTop:`1px solid ${T.border}`}}>
            <input value={novaCidade} onChange={e=>setNovaCidade(e.target.value)}
              onKeyDown={e=>{ if (e.key === "Enter") addPraca(); }}
              style={{...IS, maxWidth:220}} placeholder="Nova praça (cidade)..."/>
            <select value={novaCidadeFaixa} onChange={e=>setNovaCidadeFaixa(e.target.value)} style={{...IS, maxWidth:170}}>
              <option value="">Faixa: {faixas[0]?.label || "—"}</option>
              {faixas.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <Button T={T} variant="secondary" size="sm" icon={Plus} onClick={addPraca} disabled={!novaCidade.trim() || faixas.length === 0}>
              Adicionar praça
            </Button>
            {faixas.length === 0 && <span style={{fontSize:11,color:T.textSm}}>Crie ao menos uma faixa antes.</span>}
          </div>
        )}
      </Card>
    </div>
  );
}
