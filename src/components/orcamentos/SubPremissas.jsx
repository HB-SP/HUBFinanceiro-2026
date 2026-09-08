import { useState } from "react";
import { iSty, FONT } from "../../constants";
import { Card, SectionHeader, Button, Badge, tableStyles } from "../ui";
import { PADROES_SUGERIDOS, GRUPOS_PREMISSA, GRUPO_LOGISTICA_PADRAO, SUBS_PADRAO_FAIXA_KEYS, SUBS_NAO_EDITAVEIS, DSLR_QTDS, MATRIZ_DSLR_QTD_KEY, valorDSLR, umKeyDoPadrao } from "../../data/orcamentos";
import { fmt } from "../../utils";
import { Layers, Plus, Trash2, Copy, ChevronDown, ChevronUp } from "lucide-react";

// Premissas por padrão: o que compõe um jogo daquele padrão (pessoal +
// operações). A logística NÃO entra aqui — vem da faixa da praça.
export default function SubPremissas({ orc, setOrc, readOnly, T }) {
  const IS = iSty(T);
  const ts = tableStyles(T);
  const [novoPadrao, setNovoPadrao] = useState("");
  // Grupos da matriz recolhidos por padrão — a tabela é grande; abre o que precisa.
  const [abertos, setAbertos] = useState({});
  const toggleAberto = (key) => setAbertos(prev => ({ ...prev, [key]: !prev[key] }));
  // Sub-linhas de faixa (UM/Geradores/SNG) começam ocultas — botão na linha base mostra.
  const [faixasVisiveis, setFaixasVisiveis] = useState({});
  const toggleFaixas = (subKey) => setFaixasVisiveis(prev => ({ ...prev, [subKey]: !prev[subKey] }));

  const padroes = orc.padroes || [];
  const faixas = orc.faixas || [];

  const addPadrao = (nome) => {
    const p = String(nome || "").trim();
    if (!p || padroes.includes(p)) return;
    setOrc(prev => ({
      ...prev,
      padroes: [...(prev.padroes || []), p],
      premissas: { ...prev.premissas, [p]: prev.premissas?.[p] || {} },
    }));
    setNovoPadrao("");
  };

  const removePadrao = (p) => {
    const emUso = (orc.jogos || []).filter(j => j.padrao === p).length;
    if (emUso > 0) { window.alert(`O padrão "${p}" está em uso por ${emUso} jogo(s). Troque o padrão desses jogos antes de remover.`); return; }
    if (!window.confirm(`Remover o padrão "${p}" e suas premissas?`)) return;
    setOrc(prev => {
      const premissas = { ...prev.premissas };
      delete premissas[p];
      return { ...prev, padroes: (prev.padroes || []).filter(x => x !== p), premissas };
    });
  };

  const duplicarPadrao = (p) => {
    const novo = window.prompt(`Duplicar as premissas de "${p}" para um novo padrão. Nome do novo padrão:`, `${p} copy`);
    const nome = String(novo || "").trim();
    if (!nome) return;
    if (padroes.includes(nome)) { window.alert(`O padrão "${nome}" já existe.`); return; }
    setOrc(prev => ({
      ...prev,
      padroes: [...(prev.padroes || []), nome],
      premissas: { ...prev.premissas, [nome]: { ...(prev.premissas?.[p] || {}) } },
    }));
  };

  const setValor = (p, subKey, raw) => {
    setOrc(prev => {
      const atual = { ...(prev.premissas?.[p] || {}) };
      const v = String(raw).replace(/[^0-9.,\-]/g, "").replace(",", ".");
      if (v === "" || v === "-") delete atual[subKey];
      else atual[subKey] = parseFloat(v) || 0;
      return { ...prev, premissas: { ...prev.premissas, [p]: atual } };
    });
  };

  // Linhas de UM já embutem a categoria (um_b1 = padrão B1): a célula só é
  // ativa na coluna do padrão correspondente — as demais mostram "—".
  const UM_KEYS = ["um_b1", "um_b2", "um_b3"];
  const celulaAtiva = (subKey, p) => !UM_KEYS.includes(subKey) || umKeyDoPadrao(orc, p) === subKey;

  const totalPadrao = (p) => {
    const prem = orc.premissas?.[p] || {};
    return Object.entries(prem).reduce((s, [k, v]) =>
      (SUBS_NAO_EDITAVEIS.includes(k) || !celulaAtiva(k, p)) ? s : s + (Number(v) || 0), 0) + valorDSLR(orc, p);
  };

  // Matriz padrão × faixa (sub-linhas de UM/Geradores/SNG): célula vazia
  // herda a premissa base do padrão para aquele subKey.
  const setValorFaixaMatriz = (p, faixaKey, subKey, raw) => {
    setOrc(prev => {
      const doPadrao = { ...(prev.premissasFaixa?.[p] || {}) };
      const daFaixa = { ...(doPadrao[faixaKey] || {}) };
      const v = String(raw).replace(/[^0-9.,\-]/g, "").replace(",", ".");
      if (v === "" || v === "-") delete daFaixa[subKey];
      else daFaixa[subKey] = parseFloat(v) || 0;
      if (Object.keys(daFaixa).length === 0) delete doPadrao[faixaKey];
      else doPadrao[faixaKey] = daFaixa;
      return { ...prev, premissasFaixa: { ...(prev.premissasFaixa || {}), [p]: doPadrao } };
    });
  };

  // Pessoal · Operações · Livemode (NF por jogo) · Logística ajustada por padrão × faixa
  const gruposPremissa = [...GRUPOS_PREMISSA, GRUPO_LOGISTICA_PADRAO];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      {/* ── Padrões ── */}
      <Card T={T}>
        <SectionHeader T={T} icon={Layers} title="Padrões deste orçamento"
          subtitle="Categorias de jogo (ex.: B1, B2, B3, B3+) — cada uma tem sua premissa de custos"/>
        <div style={{padding:20}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            {padroes.map(p => (
              <div key={p} style={{display:"inline-flex",alignItems:"center",gap:6}}>
                <Badge T={T} color={T.info||"#3b82f6"}>{p}</Badge>
                {!readOnly && (
                  <>
                    <button title={`Duplicar ${p}`} onClick={()=>duplicarPadrao(p)}
                      style={{border:"none",background:"transparent",cursor:"pointer",color:T.textSm,padding:2,display:"flex"}}>
                      <Copy size={12}/>
                    </button>
                    <button title={`Remover ${p}`} onClick={()=>removePadrao(p)}
                      style={{border:"none",background:"transparent",cursor:"pointer",color:T.danger||"#DC2626",padding:2,display:"flex"}}>
                      <Trash2 size={12}/>
                    </button>
                  </>
                )}
              </div>
            ))}
            {padroes.length === 0 && <p style={{margin:0,fontSize:12,color:T.textSm}}>Nenhum padrão ainda — adicione abaixo.</p>}
          </div>

          {!readOnly && (
            <div style={{display:"flex",gap:8,marginTop:14,alignItems:"center",flexWrap:"wrap"}}>
              <input value={novoPadrao} onChange={e=>setNovoPadrao(e.target.value)}
                onKeyDown={e=>{ if (e.key === "Enter") addPadrao(novoPadrao); }}
                style={{...IS, maxWidth:160}} placeholder="Novo padrão..."/>
              <Button T={T} variant="primary" size="sm" icon={Plus} onClick={()=>addPadrao(novoPadrao)} disabled={!novoPadrao.trim()}>
                Adicionar
              </Button>
              <span style={{fontSize:11,color:T.textSm}}>Sugestões:</span>
              {PADROES_SUGERIDOS.filter(s => !padroes.includes(s)).map(s => (
                <button key={s} onClick={()=>addPadrao(s)} style={{
                  border:`1px dashed ${T.borderStrong||T.border}`,
                  background:"transparent",
                  borderRadius:6,
                  padding:"3px 10px",
                  fontSize:11,
                  color:T.textMd,
                  cursor:"pointer",
                  fontFamily:FONT.ui,
                }}>{s}</button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ── Matriz de premissas (grupos recolhíveis) ── */}
      {padroes.length > 0 && gruposPremissa.map(cat => {
        const aberto = !!abertos[cat.key];
        const ehOperacoes = cat.key === "operacoes";
        const ehLivemode = cat.key === "livemode";
        // Logística por padrão: só a matriz (sub-linhas por faixa) é editável —
        // a base vem da faixa/praça (aba Praças & Logística) e não entra na premissa.
        const ehLogistica = cat.key === GRUPO_LOGISTICA_PADRAO.key;
        // dslr/dslrs_transmissor/infra não são editáveis linha a linha:
        // DSLR vira linha especial (qtd × tabela) e Infra+Distr é derivada.
        const subsEditaveis = cat.subs.filter(sub => !SUBS_NAO_EDITAVEIS.includes(sub.key));
        const totalGrupo = (p) =>
          subsEditaveis.reduce((s, sub) => celulaAtiva(sub.key, p) ? s + (Number(orc.premissas?.[p]?.[sub.key]) || 0) : s, 0)
          + (ehOperacoes ? valorDSLR(orc, p) : 0);
        const resumoFechado = padroes.map(p => `${p} ${fmt(totalGrupo(p))}`).join(" · ");
        return (
        <Card T={T} key={cat.key}>
          <button onClick={()=>toggleAberto(cat.key)} style={{
            width:"100%",
            padding:"14px 20px",
            border:"none",
            borderBottom: aberto ? `1px solid ${T.border}` : "none",
            background:"transparent",
            cursor:"pointer",
            display:"flex",
            alignItems:"center",
            justifyContent:"space-between",
            gap:12,
            textAlign:"left",
            fontFamily:FONT.ui,
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
              <div style={{
                width:32, height:32, borderRadius:8,
                background:cat.color+"14", color:cat.color,
                display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
              }}>
                <Layers size={16} strokeWidth={2.25}/>
              </div>
              <div style={{minWidth:0}}>
                <h3 style={{margin:0,fontSize:13,fontWeight:600,color:T.text,letterSpacing:"-0.005em"}}>{cat.label}</h3>
                <p style={{margin:"2px 0 0",fontSize:11,color:T.textSm,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                  {ehLogistica
                    ? "Só a matriz padrão × faixa — a base da logística vem da faixa/praça (aba Praças & Logística)"
                    : (aberto ? `Valores por jogo, para cada padrão — ${subsEditaveis.length + (ehOperacoes ? 1 : 0)} linhas` : resumoFechado)}
                </p>
              </div>
            </div>
            <span style={{display:"inline-flex",alignItems:"center",gap:6,color:T.textMd,fontSize:11,fontWeight:600,flexShrink:0}}>
              {aberto ? "Ocultar" : "Mostrar"}
              {aberto ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
            </span>
          </button>
          {aberto && <div style={ts.wrap}>
            <table style={ts.table}>
              <thead style={ts.thead}>
                <tr>
                  <th style={{...ts.th, ...ts.thLeft}}>Serviço</th>
                  {padroes.map(p => <th key={p} style={{...ts.th, ...ts.thRight, minWidth:110}}>{p}</th>)}
                </tr>
              </thead>
              <tbody>
                {subsEditaveis.map(sub => {
                  const porFaixa = SUBS_PADRAO_FAIXA_KEYS.includes(sub.key) && faixas.length > 0;
                  const faixasAbertas = porFaixa && !!faixasVisiveis[sub.key];
                  const celulasPreenchidas = porFaixa
                    ? padroes.reduce((n, p) => n + faixas.filter(f => {
                        const v = orc.premissasFaixa?.[p]?.[f.key]?.[sub.key];
                        return v != null && v !== "";
                      }).length, 0)
                    : 0;
                  return [
                    <tr key={sub.key} style={ts.tr}>
                      <td style={{...ts.td, color: cat.color, fontWeight:500, fontSize:12}}>
                        <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                          {sub.label}
                          {porFaixa && (
                            <button onClick={()=>toggleFaixas(sub.key)}
                              title={faixasAbertas ? "Ocultar valores por faixa" : "Mostrar valores por faixa de distância"}
                              style={{
                                display:"inline-flex", alignItems:"center", gap:4,
                                border:`1px solid ${faixasAbertas ? "#D9770688" : T.border}`,
                                background: faixasAbertas ? "#D9770614" : "transparent",
                                color: celulasPreenchidas > 0 || faixasAbertas ? "#D97706" : T.textSm,
                                borderRadius:6, padding:"2px 8px",
                                fontSize:10, fontWeight:600, cursor:"pointer",
                                fontFamily:FONT.ui, whiteSpace:"nowrap",
                              }}>
                              {faixasAbertas ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
                              faixas{celulasPreenchidas > 0 ? ` · ${celulasPreenchidas}` : ""}
                            </button>
                          )}
                        </span>
                      </td>
                      {padroes.map(p => {
                        const v = orc.premissas?.[p]?.[sub.key];
                        if (ehLogistica) {
                          const n = faixas.filter(f => { const x = orc.premissasFaixa?.[p]?.[f.key]?.[sub.key]; return x != null && x !== ""; }).length;
                          return (
                            <td key={p} style={{...ts.tdNum, color: n ? "#D97706" : T.textSm, fontSize:11}}
                              title="A base vem da faixa/praça (aba Praças & Logística); aqui só o ajuste por faixa">
                              {n ? `${n} faixa${n===1?"":"s"} ajustada${n===1?"":"s"}` : "faixa / praça"}
                            </td>
                          );
                        }
                        if (!celulaAtiva(sub.key, p)) return (
                          <td key={p} style={{...ts.tdNum, color:T.textSm, fontSize:11}}
                            title={`${sub.label} não se aplica ao padrão ${p}`}>—</td>
                        );
                        return (
                          <td key={p} style={{...ts.tdNum, padding:"6px 10px"}}>
                            <input
                              value={v ?? ""}
                              disabled={readOnly}
                              onChange={e=>setValor(p, sub.key, e.target.value)}
                              placeholder="0"
                              inputMode="decimal"
                              style={{
                                ...IS,
                                maxWidth:110,
                                textAlign:"right",
                                fontFamily:FONT.num,
                                fontSize:12,
                                padding:"5px 8px",
                                background: v ? (cat.color+"0d") : (T.surface||T.bg),
                                opacity: readOnly ? 0.7 : 1,
                              }}/>
                          </td>
                        );
                      })}
                    </tr>,
                    // Sub-linhas por faixa (UM/Geradores/SNG): valor absoluto para
                    // jogos naquela faixa; vazio herda a linha base acima.
                    ...(faixasAbertas ? faixas.map(f => (
                      <tr key={`${sub.key}-${f.key}`} style={{...ts.tr, background:T.surfaceAlt||T.bg}}>
                        <td style={{...ts.td, padding:"4px 14px 4px 28px", fontSize:11, color:T.textMd}}>
                          └ {f.label}
                        </td>
                        {padroes.map(p => {
                          const v = orc.premissasFaixa?.[p]?.[f.key]?.[sub.key];
                          const temValor = v != null && v !== "";
                          const base = ehLogistica
                            ? (Number(f.logistica?.[sub.key]) || 0)          // referência: valor da faixa
                            : (Number(orc.premissas?.[p]?.[sub.key]) || 0);
                          if (!celulaAtiva(sub.key, p)) return (
                            <td key={p} style={{...ts.tdNum, color:T.textSm, fontSize:11}}>—</td>
                          );
                          return (
                            <td key={p} style={{...ts.tdNum, padding:"4px 10px"}}>
                              <input
                                value={temValor ? v : ""}
                                disabled={readOnly}
                                onChange={e=>setValorFaixaMatriz(p, f.key, sub.key, e.target.value)}
                                placeholder={String(base)}
                                inputMode="decimal"
                                style={{
                                  ...IS,
                                  maxWidth:110,
                                  textAlign:"right",
                                  fontFamily:FONT.num,
                                  fontSize:11,
                                  padding:"3px 8px",
                                  background: temValor ? "#D9770614" : (T.surface||T.bg),
                                  borderColor: temValor ? "#D9770688" : undefined,
                                  opacity: readOnly ? 0.7 : 1,
                                }}/>
                            </td>
                          );
                        })}
                      </tr>
                    )) : []),
                  ];
                })}
                {/* DSLR unificado: quantidade por padrão × tabela de preço por quantidade */}
                {ehOperacoes && [
                  <tr key="dslr" style={ts.tr}>
                    <td style={{...ts.td, color: cat.color, fontWeight:500, fontSize:12}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                        DSLR (Microlink/Transmissor)
                        <span style={{color:T.textSm, fontWeight:400, fontSize:10}}>· quantidade por padrão</span>
                        {faixas.length > 0 && (() => {
                          const n = padroes.reduce((s, p) => s + faixas.filter(f => { const x = orc.premissasFaixa?.[p]?.[f.key]?.[MATRIZ_DSLR_QTD_KEY]; return x != null && x !== ""; }).length, 0);
                          const on = !!faixasVisiveis.__dslr;
                          return (
                            <button onClick={()=>toggleFaixas("__dslr")}
                              title={on ? "Ocultar quantidade por faixa" : "Quantidade de DSLRs por faixa de distância (ex.: B3 só em SP)"}
                              style={{display:"inline-flex",alignItems:"center",gap:4,border:`1px solid ${on ? "#D9770688" : T.border}`,
                                      background: on ? "#D9770614" : "transparent", color: n > 0 || on ? "#D97706" : T.textSm,
                                      borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:FONT.ui,whiteSpace:"nowrap"}}>
                              {on ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
                              faixas{n > 0 ? ` · ${n}` : ""}
                            </button>
                          );
                        })()}
                      </span>
                    </td>
                    {padroes.map(p => {
                      const qtd = orc.dslrQtd?.[p] ?? 0;
                      return (
                        <td key={p} style={{...ts.tdNum, padding:"6px 10px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}>
                            <select value={qtd} disabled={readOnly}
                              onChange={e=>setOrc(prev => ({ ...prev, dslrQtd: { ...(prev.dslrQtd || {}), [p]: parseInt(e.target.value) || 0 } }))}
                              style={{...IS, maxWidth:64, fontSize:12, padding:"5px 6px",
                                      background: qtd ? (cat.color+"0d") : (T.surface||T.bg),
                                      opacity: readOnly ? 0.7 : 1}}>
                              <option value={0}>—</option>
                              {DSLR_QTDS.map(q => <option key={q} value={q}>{q}</option>)}
                            </select>
                            <span className="num" style={{fontSize:11,color:T.textMd,fontFamily:FONT.num,minWidth:64,textAlign:"right"}}>
                              {fmt(valorDSLR(orc, p))}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>,
                  // Quantidade de DSLRs por faixa: vazio herda a quantidade do padrão
                  ...(faixasVisiveis.__dslr ? faixas.map(f => (
                    <tr key={`dslr-${f.key}`} style={{...ts.tr, background:T.surfaceAlt||T.bg}}>
                      <td style={{...ts.td, padding:"4px 14px 4px 28px", fontSize:11, color:T.textMd}}>└ {f.label}</td>
                      {padroes.map(p => {
                        const v = orc.premissasFaixa?.[p]?.[f.key]?.[MATRIZ_DSLR_QTD_KEY];
                        const temValor = v != null && v !== "";
                        const qtd = temValor ? Number(v) : (orc.dslrQtd?.[p] ?? 0);
                        return (
                          <td key={p} style={{...ts.tdNum, padding:"4px 10px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}>
                              <select value={temValor ? v : ""} disabled={readOnly}
                                onChange={e=>setValorFaixaMatriz(p, f.key, MATRIZ_DSLR_QTD_KEY, e.target.value)}
                                style={{...IS, maxWidth:84, fontSize:11, padding:"3px 6px",
                                        background: temValor ? "#D9770614" : (T.surface||T.bg),
                                        borderColor: temValor ? "#D9770688" : undefined, opacity: readOnly ? 0.7 : 1}}>
                                <option value="">herda ({orc.dslrQtd?.[p] ?? 0})</option>
                                <option value={0}>0</option>
                                {DSLR_QTDS.map(q => <option key={q} value={q}>{q}</option>)}
                              </select>
                              <span className="num" style={{fontSize:11,color:T.textMd,fontFamily:FONT.num,minWidth:64,textAlign:"right"}}>
                                {fmt(valorDSLR(orc, p, qtd))}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  )) : []),
                ]}
                {ehLogistica ? (
                  <tr style={ts.totalRow}>
                    <td colSpan={padroes.length + 1} style={{...ts.td, fontWeight:500, fontSize:11, color:T.textMd}}>
                      Abra "faixas" em uma linha para ajustar a logística de um padrão numa faixa (ex.: hospedagem só no B2 em SP200).
                      Célula vazia = vale a faixa ou a logística própria da praça.
                    </td>
                  </tr>
                ) : (
                <tr style={ts.totalRow}>
                  <td style={{...ts.td, fontWeight:700, fontSize:12}}>
                    {ehLivemode ? "Total Livemode = Infra + Distr." : `Total ${cat.label}`}
                    {ehLivemode && <span style={{color:T.textSm, fontWeight:400, fontSize:10}}> · derivado, não se repete no orçamento</span>}
                  </td>
                  {padroes.map(p => (
                    <td key={p} style={{...ts.tdNum, fontWeight:700}}>{fmt(totalGrupo(p))}</td>
                  ))}
                </tr>
                )}
              </tbody>
            </table>
          </div>}
          {/* Tabela de preço do DSLR por quantidade contratada */}
          {aberto && ehOperacoes && (
            <div style={{padding:"12px 20px 16px",borderTop:`1px solid ${T.border}`,display:"flex",gap:14,alignItems:"flex-end",flexWrap:"wrap"}}>
              <span style={{fontSize:11,color:cat.color,fontWeight:700,paddingBottom:6}}>Preço DSLR por quantidade:</span>
              {DSLR_QTDS.map(q => (
                <div key={q}>
                  <label style={{display:"block",fontSize:10,color:T.textSm,fontWeight:600,marginBottom:3,letterSpacing:"0.04em",textTransform:"uppercase"}}>{q} DSLR{q>1?"s":""}</label>
                  <input
                    value={orc.dslrTabela?.[q] ?? ""}
                    disabled={readOnly}
                    onChange={e=>{
                      const v = String(e.target.value).replace(/[^0-9.,\-]/g, "").replace(",", ".");
                      setOrc(prev => ({ ...prev, dslrTabela: { ...(prev.dslrTabela || {}), [q]: v === "" ? 0 : (parseFloat(v) || 0) } }));
                    }}
                    placeholder="0"
                    inputMode="decimal"
                    style={{...IS, maxWidth:110, textAlign:"right", fontFamily:FONT.num, fontSize:12, padding:"5px 8px",
                            background: Number(orc.dslrTabela?.[q]) ? (cat.color+"0d") : (T.surface||T.bg),
                            opacity: readOnly ? 0.7 : 1}}/>
                </div>
              ))}
              <span style={{fontSize:10,color:T.textSm,paddingBottom:8}}>O valor do jogo usa a quantidade do padrão (o jogo pode sobrepor no detalhe).</span>
            </div>
          )}
        </Card>
        );
      })}

      {/* ── Total geral por padrão ── */}
      {padroes.length > 0 && (
        <Card T={T}>
          <div style={{padding:"14px 20px",display:"flex",gap:24,flexWrap:"wrap"}}>
            {padroes.map(p => (
              <div key={p}>
                <p style={{margin:0,fontSize:10,color:T.textSm,letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:600}}>
                  Premissa {p} (sem logística)
                </p>
                <p className="num" style={{margin:"4px 0 0",fontSize:18,fontWeight:700,color:T.text,fontFamily:FONT.num}}>{fmt(totalPadrao(p))}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
