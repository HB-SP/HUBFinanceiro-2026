import { useState, useMemo } from "react";
import { iSty, CATS, FONT } from "../../constants";
import { Card, SectionHeader, Button, Badge, tableStyles } from "../ui";
import { calcOrcadoJogo, blocosJogo, GRUPOS_PREMISSA, SUBS_NAO_EDITAVEIS, DSLR_QTDS, valorDSLR, dslrQtdEfetiva } from "../../data/orcamentos";
import { fmt } from "../../utils";
import { CalendarDays, Plus, Trash2, Copy, ChevronDown, ChevronUp, Eraser, Zap } from "lucide-react";

// Modos de agrupamento da lista de jogos. Cada grupo mostra nº de jogos e total.
export const MODOS_AGRUPAR = [
  { key:"mandante",     label:"Time (mandante)" },
  { key:"padrao_faixa", label:"Padrão × Faixa" },
  { key:"fase",         label:"Fase" },
  { key:"praca",        label:"Praça" },
  { key:"nenhum",       label:"Sem agrupamento" },
];

// Jogos estimados do orçamento. O orçado de cada linha é DERIVADO ao vivo
// (premissa do padrão + logística da faixa da praça); a linha expandida
// permite override pontual de qualquer subKey (vence premissa e faixa).
export default function SubJogos({ orc, setOrc, readOnly, T }) {
  const IS = iSty(T);
  const ts = tableStyles(T);
  const [expandido, setExpandido] = useState(null);
  // Modo de agrupamento da lista (persiste por orçamento no navegador)
  const lsKeyAgrupar = `hub_orc_jogos_agrupar_${orc.id}`;
  const [agrupar, setAgruparState] = useState(() => {
    try { const v = localStorage.getItem(lsKeyAgrupar); return MODOS_AGRUPAR.some(m => m.key === v) ? v : "mandante"; }
    catch { return "mandante"; }
  });
  const setAgrupar = (v) => { setAgruparState(v); try { localStorage.setItem(lsKeyAgrupar, v); } catch {} };
  const [loteQtd, setLoteQtd]     = useState("2");
  const [loteFase, setLoteFase]   = useState("");
  const [lotePraca, setLotePraca] = useState("");
  const [lotePadrao, setLotePadrao] = useState("");

  const jogos   = orc.jogos || [];
  const pracas  = orc.pracas || [];
  const padroes = orc.padroes || [];
  const times   = orc.times || [];
  const totalPrevisto = Object.values(orc.meta.jogosPrevistos || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const faixasDoc = orc.faixas || [];

  // Linhas da tabela: sem agrupamento = ordem original; agrupado = seções
  // padrão × faixa de distância (ordem dos padrões e das faixas do orçamento)
  // com cabeçalho somando os jogos do grupo.
  const pontosCorridos = orc.meta.formato === "pontos_corridos";
  const fases = pontosCorridos ? [] : (orc.meta.fases || []);

  // Linhas da tabela conforme o modo: sem agrupamento = ordem original; nos
  // outros modos, seções com cabeçalho (rótulo · nº de jogos · total). Cada
  // modo define a chave do grupo, o rótulo, a ordem dos grupos e a ordem
  // interna (fase → rodada), para a lista ler como calendário do mandante.
  const linhasRender = useMemo(() => {
    const comIdx = jogos.map((jogo, idx) => ({ tipo: "jogo", jogo, idx }));
    if (agrupar === "nenhum") return comIdx;
    const pracaDe  = (j) => pracas.find(p => p.id === j.pracaId) || null;
    const faixaDe  = (j) => faixasDoc.find(f => f.key === pracaDe(j)?.faixaKey) || null;
    const rankIdx  = (arr, v) => { const i = arr.indexOf(v); return i === -1 ? 999 : i; };
    const rankFase = (j) => pontosCorridos ? 0 : rankIdx(fases.map(f => f.key), j.fase);
    const faseLabel = (j) => fases.find(f => f.key === j.fase)?.label || j.fase || "—";
    const timesOrdem = [...times, ...[...new Set(jogos.map(j => j.mandante).filter(Boolean))].filter(t => !times.includes(t)).sort((a, b) => a.localeCompare(b, "pt-BR"))];

    const MODOS = {
      padrao_faixa: (j) => {
        const faixa = faixaDe(j);
        return { key:`${j.padrao || "—"}|${faixa?.key || "—"}`, destaque:j.padrao || "—", label:faixa?.label || "sem faixa",
                 rank: rankIdx(padroes, j.padrao) * 100 + rankIdx(faixasDoc.map(f => f.key), faixa?.key) };
      },
      // Time: jogos da 1ª fase agrupam pelo mandante; mata-mata (sem time
      // definido) agrupa pela fase, depois dos times.
      mandante: (j) => {
        const primeiraFase = pontosCorridos || rankFase(j) === 0;
        if (primeiraFase && j.mandante) return { key:`t|${j.mandante}`, destaque:j.mandante, label:pracaDe(j)?.cidade || "", rank: rankIdx(timesOrdem, j.mandante) };
        return { key:`f|${j.fase}`, destaque:faseLabel(j), label:"mata-mata", rank: 10000 + rankFase(j) };
      },
      fase:  (j) => ({ key:`f|${j.fase}`, destaque:faseLabel(j), label:"", rank: rankFase(j) }),
      praca: (j) => { const p = pracaDe(j); const faixa = faixaDe(j);
        return { key:`p|${p?.id || "—"}`, destaque:p?.cidade || "sem praça", label:faixa?.label || "", rank: rankIdx(pracas.map(x => x.id), p?.id) }; },
    };
    const modo = MODOS[agrupar] || MODOS.padrao_faixa;
    const grupos = new Map();
    comIdx.forEach(item => {
      const info = modo(item.jogo);
      if (!grupos.has(info.key)) grupos.set(info.key, { ...info, itens: [], total: 0 });
      const g = grupos.get(info.key);
      g.itens.push(item);
      g.total += blocosJogo(orc, item.jogo).total;
    });
    const ordemInterna = (a, b) => (rankFase(a.jogo) - rankFase(b.jogo)) || ((Number(a.jogo.rodada) || 0) - (Number(b.jogo.rodada) || 0)) || (a.idx - b.idx);
    return [...grupos.values()]
      .sort((a, b) => a.rank - b.rank || a.destaque.localeCompare(b.destaque, "pt-BR"))
      .flatMap(g => [{ tipo: "grupo", grupo: g }, ...g.itens.sort(ordemInterna)]);
  }, [jogos, agrupar, pracas, faixasDoc, padroes, times, fases, pontosCorridos, orc]);

  const proximoId = () => jogos.reduce((m, j) => Math.max(m, Number(j.id) || 0), 0) + 1;

  const novoJogo = (base = {}) => ({
    id: proximoId(),
    fase: pontosCorridos ? "rodadas" : (base.fase || fases[0]?.key || "grupos"),
    rodada: base.rodada || (jogos.length + 1),
    mandante: base.mandante || "",
    visitante: base.visitante || "",
    pracaId: base.pracaId || pracas[0]?.id || "",
    padrao: base.padrao || padroes[0] || "",
    data: base.data || "",
    obs: base.obs || "",
    overrides: base.overrides ? { ...base.overrides } : {},
  });

  const addJogo = () => setOrc(prev => ({ ...prev, jogos: [...(prev.jogos || []), novoJogo()] }));

  const gerarLote = () => {
    const n = Math.min(parseInt(loteQtd) || 0, 50);
    if (n < 1) return;
    setOrc(prev => {
      const atuais = prev.jogos || [];
      let nextId = atuais.reduce((m, j) => Math.max(m, Number(j.id) || 0), 0);
      const novos = Array.from({ length: n }, (_, i) => ({
        id: ++nextId,
        fase: pontosCorridos ? "rodadas" : (loteFase || fases[0]?.key || "grupos"),
        rodada: atuais.length + i + 1,
        mandante: "", visitante: "",
        pracaId: lotePraca || pracas[0]?.id || "",
        padrao: lotePadrao || padroes[0] || "",
        data: "", obs: "", overrides: {},
      }));
      return { ...prev, jogos: [...atuais, ...novos] };
    });
  };

  const duplicarJogo = (j) => setOrc(prev => {
    const nextId = (prev.jogos || []).reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
    return { ...prev, jogos: [...(prev.jogos || []), { ...j, id: nextId, overrides: { ...(j.overrides || {}) } }] };
  });

  const removerJogo = (id) => {
    if (!window.confirm("Remover este jogo do orçamento?")) return;
    setOrc(prev => ({ ...prev, jogos: (prev.jogos || []).filter(j => j.id !== id) }));
    if (expandido === id) setExpandido(null);
  };

  const patchJogo = (id, patch) =>
    setOrc(prev => ({ ...prev, jogos: (prev.jogos || []).map(j => j.id === id ? { ...j, ...patch } : j) }));

  const setOverride = (id, subKey, raw) => {
    setOrc(prev => ({
      ...prev,
      jogos: (prev.jogos || []).map(j => {
        if (j.id !== id) return j;
        const overrides = { ...(j.overrides || {}) };
        const v = String(raw).replace(/[^0-9.,\-]/g, "").replace(",", ".");
        if (v === "" || v === "-") delete overrides[subKey];
        else overrides[subKey] = parseFloat(v) || 0;
        return { ...j, overrides };
      }),
    }));
  };

  const limparOverrides = (id) => {
    if (!window.confirm("Limpar todos os overrides deste jogo? Ele volta a usar só premissa + faixa.")) return;
    patchJogo(id, { overrides: {} });
  };

  const selSty = { ...IS, fontSize:12, padding:"5px 8px", opacity:readOnly?0.7:1 };
  const inpSty = { ...selSty };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <Card T={T}>
        {/* Sugestões de time (Configuração → Times participantes) */}
        {times.length > 0 && (
          <datalist id="orc-times">
            {times.map(t => <option key={t} value={t}/>)}
          </datalist>
        )}
        <SectionHeader T={T} icon={CalendarDays}
          title={`Jogos estimados (${jogos.length}${totalPrevisto ? ` de ${totalPrevisto} previstos` : ""})`}
          subtitle="Lista placeholder — a lista real chega quando o campeonato existir; célula laranja = override manual"
          right={!readOnly && <Button T={T} variant="primary" size="sm" icon={Plus} onClick={addJogo} disabled={pracas.length===0 || padroes.length===0}>Adicionar jogo</Button>}/>

        {(pracas.length === 0 || padroes.length === 0) && (
          <p style={{margin:0,padding:"14px 20px",fontSize:12,color:T.warning||"#D97706"}}>
            Antes de criar jogos, defina ao menos um <b>padrão</b> (aba Padrões & Premissas) e uma <b>praça</b> (aba Praças & Logística).
          </p>
        )}

        {jogos.length > 0 && (
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 20px 0"}}>
            <span style={{fontSize:10,color:T.textSm,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Agrupar</span>
            {MODOS_AGRUPAR.map(m => {
              const ativo = agrupar === m.key;
              return (
                <button key={m.key} onClick={()=>setAgrupar(m.key)} style={{
                  padding:"4px 12px",borderRadius:14,fontSize:11,fontWeight:600,cursor:"pointer",
                  border:`1px solid ${ativo ? (T.brand||"#65B32E") : T.border}`,
                  background: ativo ? (T.brand||"#65B32E") : "transparent",
                  color: ativo ? "#fff" : T.textMd,
                }}>{m.label}</button>
              );
            })}
          </div>
        )}

        <div style={ts.wrap}>
          <table style={{...ts.table, minWidth:1120}}>
            <thead style={ts.thead}>
              <tr>
                <th style={{...ts.th, ...ts.thLeft}}>{pontosCorridos ? "Rodada" : "Fase"}</th>
                {!pontosCorridos && <th style={{...ts.th, ...ts.thRight}}>Rod.</th>}
                <th style={{...ts.th, ...ts.thLeft}}>Mandante</th>
                <th style={{...ts.th, ...ts.thLeft}}>Visitante</th>
                <th style={{...ts.th, ...ts.thLeft}}>Praça</th>
                <th style={{...ts.th, ...ts.thLeft}}>Padrão</th>
                <th style={{...ts.th, ...ts.thLeft}}>Data</th>
                <th style={{...ts.th, textAlign:"center"}} title="Jogo antes das 13h monta na véspera: +50% do gerador e +30% da UM na linha Montagem Véspera">{"< 13h"}</th>
                <th style={{...ts.th, ...ts.thRight}}>Logística</th>
                <th style={{...ts.th, ...ts.thRight}}>Pessoal</th>
                <th style={{...ts.th, ...ts.thRight}}>Operações</th>
                <th style={{...ts.th, ...ts.thRight}}>Livemode</th>
                <th style={{...ts.th, ...ts.thRight}}>Total</th>
                <th style={ts.th}/>
              </tr>
            </thead>
            <tbody>
              {linhasRender.flatMap(item => {
                if (item.tipo === "grupo") {
                  const g = item.grupo;
                  return [(
                    <tr key={`g-${g.key}`} style={{background:T.surfaceAlt||T.bg}}>
                      <td colSpan={pontosCorridos ? 13 : 14} style={{
                        padding:"8px 14px",
                        borderTop:`2px solid ${T.borderStrong||T.border}`,
                        fontSize:11, fontWeight:700, color:T.text, fontFamily:FONT.ui,
                      }}>
                        <span style={{color:T.brand||"#65B32E"}}>{g.destaque}</span>
                        {g.label && <><span style={{color:T.textSm, fontWeight:500}}> · </span>{g.label}</>}
                        <span style={{color:T.textSm, fontWeight:500}}> — {g.itens.length} jogo{g.itens.length===1?"":"s"} · </span>
                        <span className="num" style={{fontFamily:FONT.num}}>{fmt(g.total)}</span>
                      </td>
                    </tr>
                  )];
                }
                const { jogo: j, idx } = item;
                const blocos = blocosJogo(orc, j);
                const nOverrides = Object.keys(j.overrides || {}).length;
                const aberto = expandido === j.id;
                return [
                  <tr key={j.id} style={{...ts.tr, background: aberto ? (T.surfaceAlt||T.bg) : undefined}}>
                    <td style={{...ts.td, padding:"6px 10px"}}>
                      {pontosCorridos ? (
                        <input value={j.rodada ?? ""} disabled={readOnly} inputMode="numeric"
                          onChange={e=>patchJogo(j.id, {rodada: parseInt(e.target.value.replace(/[^0-9]/g,"")) || ""})}
                          style={{...inpSty, maxWidth:64, textAlign:"right", fontFamily:FONT.num}}/>
                      ) : (
                        <select value={j.fase} disabled={readOnly} onChange={e=>patchJogo(j.id, {fase:e.target.value})} style={{...selSty, maxWidth:130}}>
                          {fases.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                      )}
                    </td>
                    {!pontosCorridos && (
                      <td style={{...ts.td, padding:"6px 10px"}}>
                        <input value={j.rodada ?? ""} disabled={readOnly} inputMode="numeric"
                          onChange={e=>patchJogo(j.id, {rodada: parseInt(e.target.value.replace(/[^0-9]/g,"")) || ""})}
                          style={{...inpSty, maxWidth:52, textAlign:"right", fontFamily:FONT.num}}/>
                      </td>
                    )}
                    <td style={{...ts.td, padding:"6px 10px"}}>
                      <input value={j.mandante} disabled={readOnly} placeholder={`Time ${idx*2+1}`}
                        list={times.length ? "orc-times" : undefined}
                        onChange={e=>patchJogo(j.id, {mandante:e.target.value})} style={{...inpSty, minWidth:110}}/>
                    </td>
                    <td style={{...ts.td, padding:"6px 10px"}}>
                      <input value={j.visitante} disabled={readOnly} placeholder={`Time ${idx*2+2}`}
                        list={times.length ? "orc-times" : undefined}
                        onChange={e=>patchJogo(j.id, {visitante:e.target.value})} style={{...inpSty, minWidth:110}}/>
                    </td>
                    <td style={{...ts.td, padding:"6px 10px"}}>
                      <select value={j.pracaId} disabled={readOnly} onChange={e=>patchJogo(j.id, {pracaId:e.target.value})}
                        style={{...selSty, maxWidth:150, borderColor: pracas.some(p=>p.id===j.pracaId) ? undefined : (T.danger||"#DC2626")}}>
                        {!pracas.some(p=>p.id===j.pracaId) && <option value={j.pracaId}>— praça? —</option>}
                        {pracas.map(p => <option key={p.id} value={p.id}>{p.cidade}</option>)}
                      </select>
                    </td>
                    <td style={{...ts.td, padding:"6px 10px"}}>
                      <select value={j.padrao} disabled={readOnly} onChange={e=>patchJogo(j.id, {padrao:e.target.value})}
                        style={{...selSty, maxWidth:100, borderColor: padroes.includes(j.padrao) ? undefined : (T.danger||"#DC2626")}}>
                        {!padroes.includes(j.padrao) && <option value={j.padrao}>—</option>}
                        {padroes.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td style={{...ts.td, padding:"6px 10px"}}>
                      <input value={j.data} disabled={readOnly} placeholder="dd/mm"
                        onChange={e=>patchJogo(j.id, {data:e.target.value})} style={{...inpSty, maxWidth:90}}/>
                    </td>
                    <td style={{...ts.td, textAlign:"center", padding:"6px 8px"}}>
                      <input type="checkbox" checked={!!j.antes13h} disabled={readOnly}
                        title="Jogo antes das 13h — montagem na véspera (+50% gerador, +30% UM em Montagem Véspera)"
                        onChange={e=>patchJogo(j.id, {antes13h:e.target.checked})}
                        style={{cursor:readOnly?"default":"pointer",accentColor:T.warning||"#D97706"}}/>
                    </td>
                    <td className="num" style={ts.tdNum}>{fmt(blocos.logistica)}</td>
                    <td className="num" style={ts.tdNum}>{fmt(blocos.pessoal)}</td>
                    <td className="num" style={ts.tdNum}>{fmt(blocos.operacoes)}</td>
                    <td className="num" style={{...ts.tdNum, color:"#7C3AED"}}>{fmt(blocos.livemode)}</td>
                    <td className="num" style={{...ts.tdNum, fontWeight:700}}>
                      {fmt(blocos.total)}
                      {nOverrides > 0 && (
                        <span title={`${nOverrides} override(s) manual(is)`} style={{marginLeft:6}}>
                          <Badge T={T} color={T.warning||"#D97706"} size="sm">{nOverrides}</Badge>
                        </span>
                      )}
                    </td>
                    <td style={{...ts.td, padding:"6px 10px", whiteSpace:"nowrap"}}>
                      <button title={aberto ? "Fechar detalhe" : "Abrir detalhe / overrides"} onClick={()=>setExpandido(aberto ? null : j.id)}
                        style={{border:"none",background:"transparent",cursor:"pointer",color:T.textMd,padding:4}}>
                        {aberto ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
                      </button>
                      {!readOnly && (
                        <>
                          <button title="Duplicar jogo" onClick={()=>duplicarJogo(j)}
                            style={{border:"none",background:"transparent",cursor:"pointer",color:T.textMd,padding:4}}>
                            <Copy size={14}/>
                          </button>
                          <button title="Remover jogo" onClick={()=>removerJogo(j.id)}
                            style={{border:"none",background:"transparent",cursor:"pointer",color:T.danger||"#DC2626",padding:4}}>
                            <Trash2 size={14}/>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>,
                  aberto && (
                    <tr key={`${j.id}-det`} style={{background:T.surfaceAlt||T.bg}}>
                      <td colSpan={pontosCorridos ? 13 : 14} style={{padding:"14px 20px", borderTop:`1px dashed ${T.border}`}}>
                        <DetalheOverrides orc={orc} jogo={j} readOnly={readOnly} T={T}
                          onSetOverride={(k, v)=>setOverride(j.id, k, v)}
                          onLimpar={()=>limparOverrides(j.id)}
                          onPatch={(patch)=>patchJogo(j.id, patch)}/>
                      </td>
                    </tr>
                  ),
                ];
              })}
              {jogos.length === 0 && (
                <tr><td colSpan={14} style={{...ts.td, color:T.textSm, fontSize:12}}>Nenhum jogo estimado ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Gerar em lote ── */}
        {!readOnly && pracas.length > 0 && padroes.length > 0 && (
          <div style={{padding:"14px 20px 18px",borderTop:`1px solid ${T.border}`,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <Zap size={14} color={T.brand||"#65B32E"}/>
            <span style={{fontSize:12,color:T.textMd,fontWeight:600}}>Gerar em lote:</span>
            <input value={loteQtd} onChange={e=>setLoteQtd(e.target.value.replace(/[^0-9]/g,""))} style={{...IS, maxWidth:56, textAlign:"right"}} placeholder="N"/>
            <span style={{fontSize:12,color:T.textSm}}>jogos</span>
            {!pontosCorridos && (
              <select value={loteFase} onChange={e=>setLoteFase(e.target.value)} style={{...IS, maxWidth:150}}>
                <option value="">Fase: {fases[0]?.label || "—"}</option>
                {fases.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            )}
            <select value={lotePraca} onChange={e=>setLotePraca(e.target.value)} style={{...IS, maxWidth:170}}>
              <option value="">Praça: {pracas[0]?.cidade || "—"}</option>
              {pracas.map(p => <option key={p.id} value={p.id}>{p.cidade}</option>)}
            </select>
            <select value={lotePadrao} onChange={e=>setLotePadrao(e.target.value)} style={{...IS, maxWidth:120}}>
              <option value="">Padrão: {padroes[0] || "—"}</option>
              {padroes.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <Button T={T} variant="secondary" size="sm" icon={Plus} onClick={gerarLote} disabled={!parseInt(loteQtd)}>Gerar</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

// Linha expandida: overrides por subKey — placeholder mostra o valor derivado
// (premissa + faixa); digitar cria o override; limpar o campo remove.
function DetalheOverrides({ orc, jogo, readOnly, T, onSetOverride, onLimpar, onPatch }) {
  const IS = iSty(T);
  const semOverrides = { ...jogo, overrides: {} };
  const base = calcOrcadoJogo(orc, semOverrides);
  const nOverrides = Object.keys(jogo.overrides || {}).length;
  // Quantidade herdada: matriz padrão × faixa da praça, senão a do padrão
  const faixaJogo = (orc.pracas || []).find(p => p.id === jogo.pracaId)?.faixaKey;
  const qtdPadrao = dslrQtdEfetiva(orc, jogo.padrao, faixaJogo, null);

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <p style={{margin:0,fontSize:12,fontWeight:700,color:T.text}}>
          Overrides do jogo {jogo.mandante || "—"} × {jogo.visitante || "—"}
        </p>
        <p style={{margin:0,fontSize:11,color:T.textSm}}>
          Cinza = valor derivado (premissa + faixa). Digite para sobrescrever; apague para voltar ao derivado.
        </p>
        {/* DSLR: o jogo pode sobrepor a quantidade do padrão */}
        <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:11,color:T.textMd,fontWeight:600}}>
          DSLRs:
          <select value={jogo.dslrQtd ?? ""} disabled={readOnly}
            onChange={e=>onPatch({ dslrQtd: e.target.value === "" ? null : (parseInt(e.target.value) || 0) })}
            style={{...IS, maxWidth:120, fontSize:11, padding:"3px 6px",
                    borderColor: jogo.dslrQtd != null ? (T.warning||"#D97706")+"88" : undefined,
                    opacity: readOnly ? 0.7 : 1}}>
            <option value="">Herda ({qtdPadrao || "—"})</option>
            <option value={0}>0</option>
            {DSLR_QTDS.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
          <span className="num" style={{fontFamily:FONT.num,color:T.textSm}}>{fmt(valorDSLR(orc, jogo.padrao, jogo.dslrQtd))}</span>
        </span>
        {!readOnly && nOverrides > 0 && (
          <Button T={T} variant="ghost" size="sm" icon={Eraser} onClick={onLimpar}>Limpar overrides ({nOverrides})</Button>
        )}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:16}}>
        {[{ key:CATS[0].key, label:CATS[0].label, color:CATS[0].color, subs:CATS[0].subs }, ...GRUPOS_PREMISSA]
          .map(g => ({ ...g, subs: g.subs.filter(s => s.key === "dslr" || !SUBS_NAO_EDITAVEIS.includes(s.key)) }))
          .map(cat => (
          <div key={cat.key}>
            <p style={{margin:"0 0 8px",fontSize:10,fontWeight:700,color:cat.color,letterSpacing:"0.08em",textTransform:"uppercase"}}>{cat.label}</p>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {cat.subs.map(sub => {
                const temOverride = jogo.overrides != null && sub.key in jogo.overrides;
                return (
                  <div key={sub.key} style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,color:T.textMd,flex:1,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sub.label}</span>
                    <input
                      value={temOverride ? jogo.overrides[sub.key] : ""}
                      disabled={readOnly}
                      placeholder={String(base[sub.key] || 0)}
                      inputMode="decimal"
                      onChange={e=>onSetOverride(sub.key, e.target.value)}
                      style={{
                        ...IS,
                        maxWidth:96,
                        textAlign:"right",
                        fontFamily:FONT.num,
                        fontSize:11,
                        padding:"3px 7px",
                        background: temOverride ? (T.warning||"#D97706")+"1a" : (T.surface||T.bg),
                        borderColor: temOverride ? (T.warning||"#D97706")+"88" : undefined,
                        opacity: readOnly ? 0.7 : 1,
                      }}/>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
