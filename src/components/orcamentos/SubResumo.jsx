import { useMemo, useState } from "react";
import { FONT } from "../../constants";
import { Card, SectionHeader, Button, Progress, Badge } from "../ui";
import {
  calcTotais, calcOrcadoJogo, diffBaseline, ORC_STATUS,
  MACRO_GRUPOS_VARIAVEIS, MACRO_OUTROS,
} from "../../data/orcamentos";
import { fmt, fmtK } from "../../utils";
import {
  Wallet, CalendarDays, Briefcase, Trophy, AlertCircle,
  ChevronRight, GitCompareArrows, TrendingUp, TrendingDown,
} from "lucide-react";

const COR_VAR  = "#2563EB"; // custos variáveis (por jogo)
const COR_FIXO = "#a855f7"; // custos fixos (por edição)

const thStyle = (T, left) => ({
  padding:"11px 16px", textAlign:left ? "left" : "right", color:T.textSm, fontSize:10, fontWeight:700,
  letterSpacing:"0.06em", textTransform:"uppercase", whiteSpace:"nowrap", borderBottom:`1px solid ${T.border}`,
});
const tdNum = (T, extra = {}) => ({ padding:"12px 16px", textAlign:"right", whiteSpace:"nowrap", color:T.text, fontSize:13, fontFamily:FONT.num, fontVariantNumeric:"tabular-nums", ...extra });
const pctOf = (v, tot) => tot > 0 ? `${((v / tot) * 100).toFixed(1)}%` : "—";
const deltaCor = (d, T) => d > 0 ? "#DC2626" : d < 0 ? "#16A34A" : T.textSm;
const fmtDelta = (d) => d === 0 ? "—" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`;

// ─── RESUMO MACRO ─────────────────────────────────────────────────────────────
// Dois blocos — CUSTOS VARIÁVEIS (por jogo) e CUSTOS FIXOS (por edição) — cada
// um com seus macro grupos (variáveis: blocos da planilha; fixos: as seções do
// próprio orçamento). Clique no macro grupo abre as linhas. Se houver base
// (edição anterior), cada macro grupo mostra a base e a variação.
export default function SubResumo({ orc, readOnly, T, canAprovar, errosAprovacao = [], onAprovar }) {
  const totais = calcTotais(orc);
  const jogos = orc.jogos || [];
  const numJogos = jogos.length;
  const st = ORC_STATUS[orc.meta.status] || ORC_STATUS.rascunho;
  const totalGeral = totais.totalGeral || 0;
  const [abertos, setAbertos] = useState(() => new Set());
  const toggle = key => setAbertos(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const diff = useMemo(() => orc.baseline ? diffBaseline(orc) : null, [orc]);

  // Base (edição anterior) por subKey e por fixo (seção|nome normalizado) — só rótulo/valor, sem mexer na base.
  const baseVar = useMemo(() => {
    const m = {};
    (diff?.grupos || []).forEach(g => g.rows.forEach(r => { if (!r.soBase) m[r.key] = (m[r.key] || 0) + r.base; }));
    return m;
  }, [diff]);
  const baseFixo = useMemo(() => {
    const m = {};
    (diff?.fixos || []).forEach(sec => sec.rows.forEach(r => { if (!r.soBase) m[`${sec.secao}|${r.key}`] = r.base; }));
    return m;
  }, [diff]);
  // Só-base (linhas de 2026 sem equivalente em 2027) entram no total da base do bloco, para o delta fechar com o Comparativo.
  const soBaseVar  = (diff?.grupos || []).reduce((s, g) => s + g.rows.filter(r => r.soBase).reduce((a, r) => a + r.base, 0), 0);
  const soBaseFixo = (diff?.fixos  || []).reduce((s, f) => s + f.rows.filter(r => r.soBase).reduce((a, r) => a + r.base, 0), 0);

  // ── Variáveis: macro grupos → linhas (subKey) ──
  const variaveis = useMemo(() => {
    const porSub = {};
    jogos.forEach(j => { const o = calcOrcadoJogo(orc, j); for (const [k, v] of Object.entries(o)) porSub[k] = (porSub[k] || 0) + (v || 0); });
    const usados = new Set();
    const grupos = MACRO_GRUPOS_VARIAVEIS.map(g => {
      const itens = g.subs.map(sub => { usados.add(sub.key); return { key:sub.key, label:sub.label, valor:porSub[sub.key] || 0, base:baseVar[sub.key] || 0 }; })
        .filter(it => it.valor > 0 || it.base > 0).sort((a, b) => b.valor - a.valor);
      return { ...g, itens, total: itens.reduce((s, it) => s + it.valor, 0), base: itens.reduce((s, it) => s + it.base, 0) };
    });
    const sobra = Object.keys(porSub).filter(k => !usados.has(k) && porSub[k] > 0);
    if (sobra.length) grupos.push({ ...MACRO_OUTROS, itens: sobra.map(k => ({ key:k, label:k, valor:porSub[k], base:baseVar[k] || 0 })), total: sobra.reduce((s, k) => s + porSub[k], 0), base: sobra.reduce((s, k) => s + (baseVar[k] || 0), 0) });
    return grupos.filter(g => g.total > 0 || g.base > 0);
  }, [orc, jogos, baseVar]);

  // ── Fixos: seções do orçamento → itens ──
  const fixos = useMemo(() => (orc.servicosFixos || []).map((sec, i) => {
    const itens = (sec.itens || []).map(it => ({ key:`fx_${it.id}`, label:it.nome, valor:Number(it.orcado) || 0, base:baseFixo[`${sec.secao}|fx_${it.id}`] || 0 }))
      .filter(it => it.valor > 0 || it.base > 0).sort((a, b) => b.valor - a.valor);
    return { key:`sec_${i}`, label:sec.secao, color:COR_FIXO, itens, total: itens.reduce((s, it) => s + it.valor, 0), base: itens.reduce((s, it) => s + it.base, 0) };
  }).filter(g => g.total > 0 || g.base > 0), [orc.servicosFixos, baseFixo]);

  const blocos = [
    { key:"var",  titulo:"Custos variáveis", sub:`por jogo · ${numJogos} jogo${numJogos===1?"":"s"}`, cor:COR_VAR,  icon:CalendarDays, grupos:variaveis, total:totais.totalJogos, base: variaveis.reduce((s, g) => s + g.base, 0) + soBaseVar,  porJogo:true },
    { key:"fixo", titulo:"Custos fixos",     sub:"por edição",                                          cor:COR_FIXO, icon:Briefcase,    grupos:fixos,     total:totais.totalFixos, base: fixos.reduce((s, g) => s + g.base, 0) + soBaseFixo, porJogo:false },
  ];
  const temBase = !!diff;
  const nCols = 4 + (temBase ? 2 : 0) + 1;

  const renderBloco = (b) => (
    <Card T={T} key={b.key} accent={b.cor}>
      {/* Cabeçalho do bloco: total grande + % do geral (+ base/variação) */}
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",borderBottom:`1px solid ${T.border}`}}>
        <span style={{width:38,height:38,borderRadius:10,background:`${b.cor}16`,color:b.cor,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><b.icon size={18} strokeWidth={2.25}/></span>
        <div style={{minWidth:0,flex:1}}>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:b.cor}}>{b.titulo}</div>
          <div style={{fontSize:11.5,color:T.textSm,marginTop:2}}>{b.sub} · {pctOf(b.total, totalGeral)} do orçamento</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div className="num" style={{fontSize:24,fontWeight:700,color:T.text,fontFamily:FONT.num,lineHeight:1.1}}>{fmt(b.total)}</div>
          {b.porJogo && numJogos > 0 && <div style={{fontSize:11,color:T.textSm}}>média {fmt(Math.round(b.total / numJogos))} por jogo</div>}
        </div>
        {temBase && (
          <div style={{textAlign:"right",paddingLeft:16,borderLeft:`1px solid ${T.border}`}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:T.textSm}}>{orc.baseline.label}</div>
            <div className="num" style={{fontSize:14,fontWeight:600,color:T.textMd,fontFamily:FONT.num}}>{fmt(b.base)}</div>
            <div className="num" style={{fontSize:12,fontWeight:700,color:deltaCor(b.total - b.base, T),fontFamily:FONT.num}}>
              {fmtDelta(b.total - b.base)}{b.base ? ` (${b.total - b.base >= 0 ? "+" : ""}${(((b.total - b.base) / b.base) * 100).toFixed(1)}%)` : ""}
            </div>
          </div>
        )}
      </div>

      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:temBase ? 820 : 620}}>
          <thead>
            <tr style={{background:T.surfaceAlt||T.bg}}>
              <th style={thStyle(T, true)}>Grupo</th>
              <th style={thStyle(T)}>Orçado</th>
              {b.porJogo && <th style={thStyle(T)}>Por jogo</th>}
              <th style={thStyle(T)}>% do bloco</th>
              {temBase && <th style={thStyle(T)}>{orc.baseline.label}</th>}
              {temBase && <th style={thStyle(T)}>Δ</th>}
              <th style={{...thStyle(T), textAlign:"left", paddingLeft:20}}>Peso</th>
            </tr>
          </thead>
          <tbody>
            {b.grupos.map(g => {
              const pct = b.total ? (g.total / b.total) * 100 : 0;
              const aberto = abertos.has(`${b.key}:${g.key}`);
              const delta = g.total - g.base;
              return [
                <tr key={g.key} onClick={() => g.itens.length && toggle(`${b.key}:${g.key}`)}
                  title={g.itens.length ? (aberto ? "Fechar linhas" : "Ver linhas do grupo") : undefined}
                  style={{borderTop:`1px solid ${T.border}`,cursor:g.itens.length ? "pointer" : "default"}}
                  onMouseEnter={e => { if (g.itens.length) e.currentTarget.style.background = T.surfaceAlt||T.bg; }}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{padding:"13px 16px",fontWeight:600,whiteSpace:"nowrap",color:T.text,fontSize:13.5}}>
                    <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                      <ChevronRight size={14} strokeWidth={2.5} style={{color:g.itens.length ? T.textMd : "transparent",transform:aberto ? "rotate(90deg)" : "none",transition:"transform .15s",flexShrink:0}}/>
                      <span style={{width:9,height:9,borderRadius:2,background:g.color,flexShrink:0}}/>
                      {g.label}
                      <span style={{fontSize:10.5,color:T.textSm,fontWeight:500}}>{g.itens.length} linha{g.itens.length===1?"":"s"}</span>
                    </span>
                  </td>
                  <td style={tdNum(T, { fontWeight:700, fontSize:13.5 })}>{fmt(g.total)}</td>
                  {b.porJogo && <td style={tdNum(T, { color:T.textMd })}>{numJogos ? fmt(Math.round(g.total / numJogos)) : "—"}</td>}
                  <td style={tdNum(T, { color:T.textMd })}>{pct.toFixed(1)}%</td>
                  {temBase && <td style={tdNum(T, { color:T.textMd })}>{g.base ? fmt(g.base) : "—"}</td>}
                  {temBase && <td style={tdNum(T, { color:deltaCor(delta, T), fontWeight:600 })}>{fmtDelta(delta)}</td>}
                  <td style={{padding:"13px 20px",minWidth:140}}><Progress value={pct} T={T} color={g.color}/></td>
                </tr>,
                ...(aberto ? g.itens.map(it => {
                  const d = it.valor - it.base;
                  return (
                    <tr key={`${g.key}_${it.key}`} style={{borderTop:`1px solid ${T.border}`,background:T.surfaceAlt||T.bg}}>
                      <td style={{padding:"8px 16px 8px 54px",whiteSpace:"nowrap",color:T.textMd,fontSize:12}}>{it.label}</td>
                      <td style={tdNum(T, { padding:"8px 16px", fontSize:12, color:T.textMd })}>{it.valor ? fmt(it.valor) : "—"}</td>
                      {b.porJogo && <td style={tdNum(T, { padding:"8px 16px", fontSize:11, color:T.textSm })}>{numJogos && it.valor ? fmt(Math.round(it.valor / numJogos)) : ""}</td>}
                      <td style={tdNum(T, { padding:"8px 16px", fontSize:11, color:T.textSm })}>{g.total ? `${((it.valor / g.total) * 100).toFixed(1)}%` : ""}</td>
                      {temBase && <td style={tdNum(T, { padding:"8px 16px", fontSize:11, color:T.textSm })}>{it.base ? fmt(it.base) : "—"}</td>}
                      {temBase && <td style={tdNum(T, { padding:"8px 16px", fontSize:11, color:deltaCor(d, T) })}>{fmtDelta(d)}</td>}
                      <td style={{padding:"8px 20px",minWidth:140}}><Progress value={g.total ? (it.valor / g.total) * 100 : 0} T={T} color={`${g.color}88`} height={3}/></td>
                    </tr>
                  );
                }) : []),
              ];
            })}
            {b.grupos.length === 0 && (
              <tr><td colSpan={nCols} style={{padding:"14px 16px",fontSize:12,color:T.textSm}}>Nada orçado neste bloco ainda.</td></tr>
            )}
            <tr style={{borderTop:`2px solid ${T.borderStrong||T.border}`,background:`${b.cor}0c`,fontWeight:700}}>
              <td style={{padding:"13px 16px",color:b.cor,fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase"}}>Total {b.titulo.toLowerCase()}</td>
              <td style={tdNum(T, { color:b.cor, fontSize:14, fontWeight:700 })}>{fmt(b.total)}</td>
              {b.porJogo && <td style={tdNum(T, { color:T.textMd })}>{numJogos ? fmt(Math.round(b.total / numJogos)) : "—"}</td>}
              <td style={tdNum(T)}>100%</td>
              {temBase && <td style={tdNum(T, { color:T.textMd })}>{fmt(b.base)}</td>}
              {temBase && <td style={tdNum(T, { color:deltaCor(b.total - b.base, T) })}>{fmtDelta(b.total - b.base)}</td>}
              <td/>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      {/* ── Total geral ── */}
      <Card T={T}>
        <div style={{padding:"18px 22px",display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
          <span style={{width:44,height:44,borderRadius:12,background:`${T.brand||"#65B32E"}16`,color:T.brand||"#65B32E",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Wallet size={20} strokeWidth={2.25}/></span>
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.textSm}}>Orçamento total · {orc.meta.nome} {orc.meta.edicao}</div>
            <div className="num" style={{fontSize:30,fontWeight:700,color:T.text,fontFamily:FONT.num,letterSpacing:"-0.01em",lineHeight:1.1,marginTop:2}}>{fmt(totalGeral)}</div>
          </div>
          {blocos.map(b => (
            <div key={b.key} style={{textAlign:"right",paddingLeft:20,borderLeft:`1px solid ${T.border}`}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:b.cor}}>{b.titulo}</div>
              <div className="num" style={{fontSize:16,fontWeight:700,color:T.text,fontFamily:FONT.num}}>{fmtK(b.total)}</div>
              <div style={{fontSize:11,color:T.textSm}}>{pctOf(b.total, totalGeral)}</div>
            </div>
          ))}
          {diff && (
            <div style={{textAlign:"right",paddingLeft:20,borderLeft:`1px solid ${T.border}`}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:T.textSm}}>vs {orc.baseline.label}</div>
              <div className="num" style={{fontSize:16,fontWeight:700,color:deltaCor(diff.delta, T),fontFamily:FONT.num,display:"inline-flex",alignItems:"center",gap:6}}>
                {diff.delta >= 0 ? <TrendingUp size={15}/> : <TrendingDown size={15}/>}{fmtDelta(diff.delta)}
              </div>
              <div style={{fontSize:11,color:T.textSm,display:"inline-flex",alignItems:"center",gap:6}}>
                {diff.totalBase ? `${diff.delta >= 0 ? "+" : ""}${((diff.delta / diff.totalBase) * 100).toFixed(1)}%` : "—"}
                {diff.numAddons > 0 && <Badge T={T} color="#8b5cf6" size="sm">{diff.numAddons} add-on{diff.numAddons===1?"":"s"}</Badge>}
                <GitCompareArrows size={12}/>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ── Blocos: Variáveis · Fixos ── */}
      {blocos.map(renderBloco)}

      {/* ── Status / aprovação ── */}
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
