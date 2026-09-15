import { useState, useMemo, Fragment, Component } from "react";
import { btnStyle, iSty } from "../../constants";
import { parseBR, fmtNum, fmtR, fmtRs } from "../../utils";
import { Card, Button } from "../ui";
import { KPI } from "../shared";
import { BarChart3, Lock, LayoutGrid, ChevronDown, ChevronRight, Settings2, X, Receipt } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { calcVariaveis, calcFixos, calcVisaoGeral, fmtBRL, MESES_FIX, MESES_SHORT } from "../../lib/apresentacoesCalc";
import { buildFechamentoPorRodada } from "../../lib/fechamentoRodada";

// Error Boundary para capturar erros de render e exibir mensagem em vez de tela branca
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:32,color:"#ef4444",background:"#1e1e2e",borderRadius:12,margin:24,fontFamily:"monospace"}}>
          <p style={{fontWeight:700,marginBottom:8}}>Erro ao carregar — copie e envie para suporte:</p>
          <pre style={{whiteSpace:"pre-wrap",fontSize:12}}>{this.state.error?.stack || String(this.state.error)}</pre>
          <button onClick={()=>this.setState({error:null})} style={{marginTop:16,padding:"6px 16px",background:"#ef4444",color:"#fff",border:"none",borderRadius:6,cursor:"pointer"}}>Tentar novamente</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── PEÇAS COMPARTILHADAS DAS VIEWS ──────────────────────────────────────────
function TituloView({ icone: Icone, cor, corFundo, titulo, subtitulo, T }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
      <div style={{width:40,height:40,borderRadius:12,background:corFundo,border:`1px solid ${cor}45`,color:cor,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <Icone size={18} strokeWidth={2.25}/>
      </div>
      <div>
        <h2 style={{margin:0,fontSize:18,color:T.text,fontWeight:800,letterSpacing:"-0.02em"}}>{titulo}</h2>
        <p style={{margin:"2px 0 0",fontSize:12,color:T.textMd}}>{subtitulo}</p>
      </div>
    </div>
  );
}

const thSty = (T, right) => ({padding:"10px 12px",textAlign:right?"right":"left",color:T.textSm,fontSize:11,borderBottom:`1px solid ${T.border}`,textTransform:"uppercase",letterSpacing:1});
const tdSty = right => ({padding:"8px 12px",textAlign:right?"right":"left",fontSize:12});

// ─── VIEW CUSTOS VARIÁVEIS ───────────────────────────────────────────────────
function SlideVariaveis({ d, T }) {
  const rodadaComEstouro = d.rows.find(r => r.orcado - r.realizado < 0)?.label ?? null;
  const subtitulo = d.savPct >= 0
    ? `Operação jogo a jogo gera saving de ${Math.abs(d.savPct).toFixed(1)}%, dentro do orçado até a Rodada ${d.rodadaAtual}.`
    : `Operação jogo a jogo com estouro de ${Math.abs(d.savPct).toFixed(1)}%${rodadaComEstouro ? ", alerta isolado na " + rodadaComEstouro : ""}.`;
  const chartData = d.rows.map(r => ({ name: r.label, "Orçado": r.orcado, "Realizado": r.realizado }));
  return (
    <div>
      <TituloView icone={BarChart3} cor="#10b981" corFundo="rgba(16,185,129,0.12)" titulo="Custos Variáveis" subtitulo={subtitulo} T={T}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:16,marginBottom:20}}>
        <KPI label="Orçado Total" value={fmtR(d.orcGlobal)} sub="Campeonato (fixo)" color={T.textSm} T={T}/>
        <KPI label={`Orçado até R${d.rodadaAtual}`} value={fmtR(d.totOrc)} sub={`${d.rows.length} rodadas`} color="#94a3b8" T={T}/>
        <KPI label={`Realizado até R${d.rodadaAtual}`} value={fmtR(d.totReal)} sub="Base: provisionado (Savings)" color="#22c55e" T={T}/>
        <KPI label="Saving Acumulado" value={(d.saving>=0?"▲ ":"▼ ")+fmtR(Math.abs(d.saving))} sub={`${Math.abs(d.savPct).toFixed(1)}% vs. orçado`} color={d.saving>=0?"#22c55e":"#ef4444"} T={T}/>
      </div>
      {/* Altura presa na janela: com 20+ rodadas a tabela rolava a página toda;
          agora ela rola por dentro, com cabeçalho e Total fixos, e tudo cabe
          numa tela só (mesmo padrão do Hub de Fornecedores). */}
      <div style={{display:"grid",gridTemplateColumns:"minmax(340px,3fr) minmax(320px,2fr)",gap:16,marginBottom:12,height:"calc(100vh - 350px)",minHeight:380}}>
        <Card T={T} style={{display:"flex",flexDirection:"column",minHeight:0}}>
          <div style={{padding:"16px 20px",flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
            <h4 style={{margin:"0 0 12px",color:T.text,fontSize:13,fontWeight:700}}>Orçado vs Realizado por Rodada</h4>
            <div style={{flex:1,minHeight:0}}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false}/>
                  <XAxis dataKey="name" tick={{fill:T.textMd,fontSize:11}}/>
                  <YAxis tick={{fill:T.textMd,fontSize:11}} tickFormatter={v=>`R$${(v/1000).toFixed(0)}k`}/>
                  <Tooltip formatter={v=>fmtBRL(v)} contentStyle={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8}} labelStyle={{color:T.text}}/>
                  <Legend wrapperStyle={{fontSize:12}}/>
                  <Bar dataKey="Orçado" fill="#94a3b8" radius={[3,3,0,0]}/>
                  <Bar dataKey="Realizado" fill="#22c55e" radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
        <Card T={T} style={{display:"flex",flexDirection:"column",minHeight:0}}>
          <div style={{padding:"16px 20px",flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
            <h4 style={{margin:"0 0 12px",color:T.text,fontSize:13,fontWeight:700}}>Saving por Rodada</h4>
            <div style={{flex:1,minHeight:0,overflowY:"auto",overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
                <thead><tr>
                  {["Rodada","Orçado","Realizado","Saving"].map((h,i)=><th key={h} style={{...thSty(T,i>0),position:"sticky",top:0,background:T.surface||T.card,zIndex:1}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.rows.map(r => {
                    const sav = r.orcado - r.realizado;
                    return (
                      <tr key={r.label}>
                        <td style={{...tdSty(false),fontWeight:700,color:"#22c55e",borderBottom:`1px solid ${T.border}`}}>{r.label}</td>
                        <td style={{...tdSty(true),color:T.textMd,borderBottom:`1px solid ${T.border}`}} className="num">{fmtR(r.orcado)}</td>
                        <td style={{...tdSty(true),color:T.text,borderBottom:`1px solid ${T.border}`}} className="num">{fmtR(r.realizado)}</td>
                        <td style={{...tdSty(true),fontWeight:700,color:sav>=0?"#a3e635":"#ef4444",borderBottom:`1px solid ${T.border}`}} className="num">{sav>=0?"▲ ":"▼ "}{fmtR(Math.abs(sav))}</td>
                      </tr>
                    );
                  })}
                  {d.rows.length === 0 && <tr><td colSpan={4} style={{padding:24,textAlign:"center",color:T.textSm,fontSize:12}}>Nenhuma rodada disponível</td></tr>}
                </tbody>
                <tfoot><tr>
                  <td style={{...tdSty(false),fontWeight:700,color:T.textSm,textTransform:"uppercase",fontSize:11,letterSpacing:1,position:"sticky",bottom:0,background:T.surface||T.card,borderTop:`2px solid ${T.border}`}}>Total</td>
                  <td style={{...tdSty(true),fontWeight:700,color:T.text,position:"sticky",bottom:0,background:T.surface||T.card,borderTop:`2px solid ${T.border}`}} className="num">{fmtR(d.totOrc)}</td>
                  <td style={{...tdSty(true),fontWeight:700,color:T.text,position:"sticky",bottom:0,background:T.surface||T.card,borderTop:`2px solid ${T.border}`}} className="num">{fmtR(d.totReal)}</td>
                  <td style={{...tdSty(true),fontWeight:700,color:d.saving>=0?"#a3e635":"#ef4444",position:"sticky",bottom:0,background:T.surface||T.card,borderTop:`2px solid ${T.border}`}} className="num">{d.saving>=0?"▲ ":"▼ "}{fmtR(Math.abs(d.saving))}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── VIEW CUSTOS FIXOS ───────────────────────────────────────────────────────
// Regra: orçado e realizado = aba Serviços rateada até o mês/rodada (realizado
// é o provisionado do item — comprometido, com ou sem NF); NFs recebidas são
// informativas; saldo = orçado − realizado. Sem overrides.
const corTipo = (tipo, T) => tipo === "pontual" ? "#d97706" : tipo === "por_rodada" ? "#2563eb" : tipo === "misto" ? "#7c3aed" : tipo === "encerrado" ? "#6b7280" : T.textSm;
const seta = v => (v >= 0 ? "▲ " : "▼ ") + fmtR(Math.abs(v));
const corSaldo = v => v >= 0 ? "#22c55e" : "#ef4444";

function SlideFixos({ d, T }) {
  const [expandedSecs, setExpandedSecs] = useState({});
  const toggleSec = secao => setExpandedSecs(prev => ({...prev, [secao]: !prev[secao]}));
  const pctProv = Math.min(1, d.provTotal / (d.orcTotal || 1));
  return (
    <div>
      <TituloView icone={Lock} cor={T.info} corFundo={T.info+"1f"} titulo="Custos Fixos" subtitulo={`Aba Serviços rateada até ${d.mesLabel} · saldo = orçado − realizado`} T={T}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:16,marginBottom:20}}>
        <KPI label="Orçamento Total" value={fmtR(d.orcAnualTotal)} color={T.textSm} T={T}/>
        <KPI label={`Orçado até ${d.mesLabel}`} value={fmtR(d.orcTotal)} color="#94a3b8" T={T}/>
        <KPI label={`Realizado até ${d.mesLabel}`} value={fmtR(d.provTotal)} color={T.info} T={T}/>
        <KPI label="Saldo" value={seta(d.saldoTotal)} color={corSaldo(d.saldoTotal)} T={T}/>
      </div>
      <Card T={T} style={{marginBottom:16}}>
        <div style={{padding:"16px 20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:11,color:T.textSm,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Realizado sobre Orçado</span>
            <span style={{fontSize:11,color:T.textMd}}>Realizado: <b style={{color:T.text}}>{fmtRs(d.provTotal)}</b> · Saldo: <b style={{color:corSaldo(d.saldoTotal)}}>{fmtRs(d.saldoTotal)}</b></span>
          </div>
          <div style={{height:20,borderRadius:10,background:T.bg,border:`1px solid ${T.border}`,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${(pctProv*100).toFixed(1)}%`,background:"linear-gradient(90deg,#1e3a8a,#3b82f6)",transition:"width .3s"}}/>
          </div>
        </div>
      </Card>
      <Card T={T} style={{marginBottom:20}}>
        <div style={{padding:"16px 20px"}}>
          <h4 style={{margin:"0 0 12px",color:T.text,fontSize:13,fontWeight:700}}>Seções — Orçado × Realizado × NFs recebidas × Saldo</h4>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:640}}>
              <thead><tr style={{background:T.bg}}>
                {["Seção","Orçado","Realizado","NFs recebidas","Saldo"].map((h,i)=><th key={h} style={thSty(T,i>0)}>{h}</th>)}
              </tr></thead>
              <tbody>
                {d.sections.map(s => {
                  const expanded = !!expandedSecs[s.secao];
                  return (
                    <Fragment key={s.secao}>
                    <tr style={{borderBottom:`1px solid ${T.border}`}}>
                      <td style={{...tdSty(false),fontWeight:700,color:T.info}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          {s.itens.length > 0 && (
                            <button onClick={()=>toggleSec(s.secao)} style={{background:"none",border:"none",cursor:"pointer",padding:0,color:T.textSm,display:"flex",alignItems:"center"}}>
                              {expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                            </button>
                          )}
                          {s.secao}
                        </div>
                      </td>
                      <td style={{...tdSty(true),color:T.textMd}} className="num">{s.outros ? "—" : fmtR(s.orc)}</td>
                      <td style={{...tdSty(true),color:T.text}} className="num">{s.outros ? "—" : fmtR(s.prov)}</td>
                      <td style={{...tdSty(true),color:"#16a34a"}} className="num">{fmtR(s.gasto)}</td>
                      <td style={{...tdSty(true),fontWeight:700,color:s.outros?T.textSm:corSaldo(s.saldo)}} className="num">{s.outros ? "—" : seta(s.saldo)}</td>
                    </tr>
                    {expanded && s.itens.length > 0 && (
                      <tr style={{background:T.bg}}>
                        <td colSpan={5} style={{padding:"6px 12px 10px 24px"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                            <thead><tr>
                              {["Item","Tipo","Fator","Orçado","Realizado","NFs recebidas","Saldo"].map((h,i)=>(
                                <th key={h} style={{padding:"3px 8px",textAlign:i===0?"left":"right",color:T.textSm,borderBottom:`1px solid ${T.border}`}}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {s.itens.map(it => (
                                <tr key={it.id}>
                                  <td style={{padding:"3px 8px",color:T.textMd}}>{it.nome}</td>
                                  <td style={{padding:"3px 8px",textAlign:"right",color:corTipo(it.tipo,T)}} title={it.mesesAlocacao.length ? "Meses: "+it.mesesAlocacao.map(m => MESES_SHORT[m] ?? m).join(", ") : it.rodadasTotal ? `${it.rodadasTotal} rodadas` : ""}>{it.tipo}</td>
                                  <td style={{padding:"3px 8px",textAlign:"right",color:T.textSm}}>{it.tipo === "encerrado" ? "congelado" : `${(it.fator*100).toFixed(0)}%`}</td>
                                  <td style={{padding:"3px 8px",textAlign:"right",color:T.textMd}} className="num" title={`Anual: ${fmtBRL(it.orcAnual)}`}>{fmtBRL(it.orc)}</td>
                                  <td style={{padding:"3px 8px",textAlign:"right",color:T.text}} className="num" title={`Anual: ${fmtBRL(it.provAnual)}`}>{fmtBRL(it.prov)}</td>
                                  <td style={{padding:"3px 8px",textAlign:"right",color:"#16a34a"}} className="num">{fmtBRL(it.nf)}</td>
                                  <td style={{padding:"3px 8px",textAlign:"right",fontWeight:700,color:corSaldo(it.orc-it.prov)}} className="num">{seta(it.orc-it.prov)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
                {d.sections.length === 0 && <tr><td colSpan={5} style={{padding:24,textAlign:"center",color:T.textSm,fontSize:12}}>Nenhuma seção na aba Serviços</td></tr>}
              </tbody>
              <tfoot><tr style={{background:T.bg}}>
                <td style={{...tdSty(false),fontWeight:700,color:T.textSm,textTransform:"uppercase",fontSize:11,letterSpacing:1}}>Total</td>
                <td style={{...tdSty(true),fontWeight:700,color:T.text}} className="num">{fmtR(d.orcTotal)}</td>
                <td style={{...tdSty(true),fontWeight:700,color:T.text}} className="num">{fmtR(d.provTotal)}</td>
                <td style={{...tdSty(true),fontWeight:700,color:"#16a34a"}} className="num">{fmtR(d.gastoTotal)}</td>
                <td style={{...tdSty(true),fontWeight:700,color:corSaldo(d.saldoTotal)}} className="num">{seta(d.saldoTotal)}</td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── VIEW VISÃO GERAL ────────────────────────────────────────────────────────
function SlideVisaoGeral({ vg, T }) {
  const pilar = (titulo, orcLabel, orc, prov, saldo) => (
    <Card T={T}>
      <div style={{padding:"18px 22px",textAlign:"center"}}>
        <p style={{fontSize:12,fontWeight:800,color:T.text,margin:"0 0 10px"}}>{titulo}</p>
        <p style={{fontSize:12,color:T.textMd,margin:"0 0 4px"}}>{orcLabel}: <b style={{color:T.text}}>{fmtR(orc)}</b></p>
        <p style={{fontSize:12,color:T.textMd,margin:"0 0 8px"}}>Realizado: <b style={{color:T.text}}>{fmtR(prov)}</b></p>
        <p style={{fontSize:15,fontWeight:800,color:saldo>=0?"#16a34a":"#dc2626",margin:0}}>Saldo: {seta(saldo)}</p>
      </div>
    </Card>
  );
  const mkRow = (label, orc, prov, sal, pct) => (
    <tr key={label} style={{borderBottom:`1px solid ${T.border}`}}>
      <td style={{...tdSty(false),color:T.text,fontWeight:600}}>{label}</td>
      <td style={{...tdSty(true),color:T.textMd}} className="num">{fmtR(orc)}</td>
      <td style={{...tdSty(true),color:T.text}} className="num">{fmtR(prov)}</td>
      <td style={{...tdSty(true),fontWeight:700,color:sal>=0?"#a3e635":"#ef4444"}} className="num">{seta(sal)}</td>
      <td style={{...tdSty(true),fontWeight:700,color:sal>=0?"#a3e635":"#ef4444"}} className="num">{sal>=0?"▲ ":"▼ "}{Math.abs(pct).toFixed(1)}%</td>
    </tr>
  );
  return (
    <div>
      <TituloView icone={LayoutGrid} cor="#7c3aed" corFundo="rgba(124,58,237,0.12)" titulo="Visão Geral Orçamentária" subtitulo="Consolidado dos pilares: Variáveis + Fixos · saldo = orçado − realizado" T={T}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:16,marginBottom:20}}>
        <KPI label="Orçamento Total do Campeonato" value={fmtR(vg.orcTotalCampeonato)} color={T.textSm} T={T}/>
        <KPI label="Realizado (Atual)" value={fmtR(vg.provTotalGlobal)} color={T.text} T={T}/>
        <KPI label="Saldo Global" value={seta(vg.saldoGlobal)} color={vg.saldoGlobal>=0?"#22c55e":"#ef4444"} T={T}/>
      </div>
      <p style={{textAlign:"center",fontSize:11,color:T.textSm,fontWeight:700,letterSpacing:2,textTransform:"uppercase",margin:"0 0 12px"}}>Síntese dos Pilares</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:16,marginBottom:20}}>
        {pilar("Dinâmica Operacional (Custos Variáveis)", `Orçado até R${vg.rodadaAtual}`, vg.varOrc, vg.varProv, vg.varSaldo)}
        {pilar("Estrutura (Custos Fixos)", `Orçado até ${vg.mesLabel}`, vg.fixOrcAcum, vg.fixProv, vg.fixSaldo)}
      </div>
      <Card T={T} style={{marginBottom:20}}>
        <div style={{padding:"16px 20px"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:560}}>
              <thead><tr style={{background:T.bg}}>
                {["Bloco","Orçado (Período)","Realizado","Saldo","%"].map((h,i)=><th key={h} style={thSty(T,i>0)}>{h}</th>)}
              </tr></thead>
              <tbody>
                {mkRow(`1  Serviços Variáveis (R1–R${vg.rodadaAtual})`, vg.varOrc, vg.varProv, vg.varSaldo, vg.savVarPct)}
                {mkRow(`2  Custos Fixos (até ${vg.mesLabel})`, vg.fixOrcAcum, vg.fixProv, vg.fixSaldo, vg.savFixPct)}
              </tbody>
              <tfoot><tr style={{background:T.bg}}>
                <td style={{...tdSty(false),fontWeight:700,color:T.textSm,textTransform:"uppercase",fontSize:11,letterSpacing:1}}>Total</td>
                <td style={{...tdSty(true),fontWeight:700,color:T.text}} className="num">{fmtR(vg.orcTotalPeriodo)}</td>
                <td style={{...tdSty(true),fontWeight:700,color:T.text}} className="num">{fmtR(vg.provTotalGlobal)}</td>
                <td style={{...tdSty(true),fontWeight:700,color:vg.saldoGlobal>=0?"#a3e635":"#ef4444"}} className="num">{seta(vg.saldoGlobal)}</td>
                <td style={{...tdSty(true),fontWeight:700,color:vg.saldoGlobal>=0?"#a3e635":"#ef4444"}} className="num">{vg.saldoGlobal>=0?"▲ ":"▼ "}{Math.abs(vg.saldoGlobalPct).toFixed(1)}%</td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── PAINÉIS DE AJUSTE (modo edição) ─────────────────────────────────────────
function AjustesVariaveis({ d, T, nfEspOvr, nfRecOvr, setField, setVarField, resetVar, orcGlobal }) {
  const IS = {...iSty(T), width:"100%"};
  const IS_RO = {...IS, background:T.bg, cursor:"default"};
  const grid3 = {display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20};
  const secHdr = {fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.text,marginBottom:16};
  const secNum = {fontSize:10,color:T.textSm,fontWeight:700,marginRight:8};
  const lbl = {color:T.textSm,fontSize:11,display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:1};
  const badge = (bg,fg,txt) => <span style={{background:bg,color:fg,fontSize:9,padding:"1px 5px",borderRadius:2,marginLeft:4}}>{txt}</span>;
  return (
    <div>
      <div style={{background:T.card,borderRadius:12,padding:"20px 24px",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:18}}><span style={secNum}>01</span><span style={secHdr}>Configuração Base</span></div>
        <div style={grid3}>
          <div style={{marginBottom:16}}>
            <label style={lbl}>Rodada Atual *</label>
            <select value={d.rodadaAtual} onChange={e=>setField("varRodada",parseInt(e.target.value))} style={{...IS}}>
              {d.rodadasDisp.length === 0
                ? <option value={1}>—</option>
                : d.rodadasDisp.map(r => <option key={r} value={r}>Rodada {r}</option>)}
            </select>
          </div>
          <div style={{marginBottom:16}}>
            <label style={lbl}>Orçado Total – Campeonato {badge("#1e3a5f","#93c5fd","FIXO")}</label>
            <input readOnly value={fmtNum(orcGlobal)} style={{...IS_RO}}/>
          </div>
          <div style={{marginBottom:16}}>
            <label style={lbl}>Orçado Acumulado até a Rodada {badge("#052e16","#4ade80","AUTO")}</label>
            <input readOnly value={fmtNum(d.totOrc)} style={{...IS_RO,color:"#22c55e"}}/>
          </div>
        </div>
      </div>

      <div style={{background:T.card,borderRadius:12,padding:"20px 24px",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:18}}>
          <div style={{display:"flex",alignItems:"baseline",gap:8}}><span style={secNum}>02</span><span style={secHdr}>Dados por Rodada</span></div>
          <button onClick={resetVar} style={{...btnStyle,background:T.border,color:T.text,padding:"5px 12px",fontSize:11}}>🔄 Re-sincronizar com portal</button>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:500}}>
            <thead><tr style={{background:T.bg}}>{["Rodada","Orçado (R$)","Realizado (R$)","Saving (R$)"].map((h,i)=>(<th key={h} style={{padding:"10px 12px",textAlign:i===0?"left":"right",color:T.textSm,fontSize:11,borderBottom:`1px solid ${T.border}`}}>{h}</th>))}</tr></thead>
            <tbody>
              {d.rodadasView.map(r => {
                const sav = parseBR(r.orcado) - parseBR(r.realizado);
                return (
                  <tr key={r.rodada} style={{borderBottom:`1px solid ${T.border}`}}>
                    <td style={{padding:"6px 12px",fontWeight:700,color:"#22c55e",fontSize:13}}>{r.label}</td>
                    <td style={{padding:"4px 12px",textAlign:"right"}}><input value={r.orcado} onChange={e=>setVarField(r.rodada,"orcado",e.target.value)} style={{...iSty(T),width:120,textAlign:"right",padding:"4px 8px"}}/></td>
                    <td style={{padding:"4px 12px",textAlign:"right"}}><input value={r.realizado} onChange={e=>setVarField(r.rodada,"realizado",e.target.value)} style={{...iSty(T),width:120,textAlign:"right",padding:"4px 8px",color:"#22c55e"}}/></td>
                    <td style={{padding:"6px 12px",textAlign:"right",fontWeight:700,color:sav>=0?"#a3e635":"#ef4444"}}>{sav>=0?"▲ ":"▼ "}{fmtR(Math.abs(sav))}</td>
                  </tr>
                );
              })}
              {d.rodadasView.length === 0 && (
                <tr><td colSpan={4} style={{padding:24,textAlign:"center",color:T.textSm,fontSize:12}}>Nenhuma rodada disponível</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{background:T.card,borderRadius:12,padding:"20px 24px",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:18}}><span style={secNum}>03</span><span style={secHdr}>Notas Fiscais</span></div>
        <div style={grid3}>
          <div><label style={lbl}>Notas Esperadas {badge("#052e16","#4ade80","AUTO · editável")}</label><input value={nfEspOvr !== "" ? nfEspOvr : fmtNum(d.autoNfEspV)} onChange={e=>setField("nfEsp",e.target.value)} style={{...IS}}/></div>
          <div><label style={lbl}>Notas Recebidas {badge("#052e16","#4ade80","AUTO · editável")}</label><input value={nfRecOvr !== "" ? nfRecOvr : fmtNum(d.autoNfRecV)} onChange={e=>setField("nfRec",e.target.value)} style={{...IS,color:"#22c55e"}}/></div>
          <div><label style={lbl}>Pendentes {badge("#052e16","#4ade80","AUTO")}</label><input readOnly value={fmtNum(d.nfPend)} style={{...IS_RO,color:"#d97706"}}/></div>
        </div>
      </div>
    </div>
  );
}

// ─── EXPORT PRINCIPAL ─────────────────────────────────────────────────────────
// A aba renderiza o acompanhamento orçamentário direto no Hub (antes gerava
// PPTX). Estado compartilhado: `apres` vive no app_state (uma chave por
// campeonato, wire nos componentes-pai) — overrides valem para todos os
// usuários, não mais por navegador.
// ─── VIEW EXTRATO POR RODADA ─────────────────────────────────────────────────
// A dor da entidade pagadora: o extrato bancário traz cada NF pelo valor cheio,
// mas parte das NFs é compartilhada entre rodadas (mensais rateadas, blocos de
// infra, reembolsos multi-rodada). Esta view mostra, NF a NF: valor no extrato,
// parcela que pertence à rodada selecionada e ONDE está o restante — assim a
// diferença "extrato × total da rodada" se explica sozinha na apresentação.
const NATUREZA = {
  exclusiva:     { label: "Exclusiva da rodada",      color: "#22c55e" },
  compartilhada: { label: "Compartilhada entre rodadas", color: "#d97706" },
  "Seg. Espacial":  { label: "Mensal rateada (Seg. Espacial)", color: "#f59e0b" },
  "Infra Livemode": { label: "Infra Livemode (bloco)", color: "#a855f7" },
  "liveU":          { label: "liveU (bloco)",          color: "#0ea5e9" },
  "Reembolso Logística": { label: "Reembolso Logística (consolidada)", color: "#16A34A" },
};
const PillNat = ({ nat }) => {
  const n = NATUREZA[nat] || NATUREZA.compartilhada;
  return (
    <span style={{background:n.color+"1a",color:n.color,border:`1px solid ${n.color}40`,borderRadius:99,
      padding:"1px 10px",fontSize:11,fontWeight:600,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",height:20}}>
      {n.label}
    </span>
  );
};

function SlideExtrato({ fech, rodada, T }) {
  // destino de cada NF em todos os grupos — pra dizer "onde está o restante"
  const destinosPorNota = useMemo(() => {
    const map = new Map();
    const add = (k, label, valor) => { if (!map.has(k)) map.set(k, []); map.get(k).push({ label, valor }); };
    fech.rodadas.forEach(r => {
      r.diretas.forEach(l => add(`d${l.id}`, r.label, l.valor));
      r.rateios.forEach(l => add(`${l.origem}_${l.notaId}`, r.label, l.valor));
    });
    fech.naoAlocado.forEach(l => add(`${l.origem}_${l.notaId}`, "Não alocado a rodadas", l.valor));
    return map;
  }, [fech]);

  const r = rodada;
  const linhas = useMemo(() => {
    if (!r) return [];
    const rows = [];
    r.diretas.forEach(l => {
      const chave = `d${l.id}`;
      const extrato = l.valorNF || 0;
      const destinos = (destinosPorNota.get(chave) || []).filter(d => d.label !== r.label);
      const mapeado = l.valor + destinos.reduce((s, d) => s + d.valor, 0);
      const restoNaoMapeado = extrato * (l.scale ?? 1) - mapeado;
      if (Math.abs(restoNaoMapeado) > 0.01) destinos.push({ label: "Outros (vínculo parcial / fora de rodadas)", valor: restoNaoMapeado });
      rows.push({
        key: chave, fornecedor: l.fornecedor, numeroNF: l.numeroNF || l.codigo || "—",
        natureza: destinos.length === 0 ? "exclusiva" : "compartilhada",
        extrato, parcela: l.valor, destinos,
      });
    });
    r.rateios.forEach(l => {
      const chave = `${l.origem}_${l.notaId}`;
      const destinos = (destinosPorNota.get(chave) || []).filter(d => d.label !== r.label);
      const resto = (l.valorNF || 0) - l.valor - destinos.reduce((s, d) => s + d.valor, 0);
      if (Math.abs(resto) > 0.01) destinos.push({ label: "Outros (não alocado)", valor: resto });
      rows.push({
        key: `${chave}_${r.key}`, fornecedor: l.fornecedor, numeroNF: l.numeroNF || "—",
        natureza: l.origem, extrato: l.valorNF || 0, parcela: l.valor, destinos,
        memoria: l.fatiaPorJogo != null
          ? `${fmtRs(l.valorNF||0)} ÷ ${l.cobreLabel} = ${fmtRs(l.fatiaPorJogo)}/jogo × ${l.jogosIds.length} jogo${l.jogosIds.length>1?"s":""}`
          : `NF consolidada de ${l.cobre} jogos — quebra própria por jogo`,
      });
    });
    return rows.sort((a, b) => b.parcela - a.parcela);
  }, [r, destinosPorNota]);

  if (!r) return <p style={{ color: T.textSm, padding: 24 }}>Nenhuma rodada com jogos divulgados.</p>;

  const exclusivas = linhas.filter(l => l.natureza === "exclusiva");
  const compartilhadas = linhas.filter(l => l.natureza !== "exclusiva");
  const somaExcl = exclusivas.reduce((s, l) => s + l.parcela, 0);
  const somaComp = compartilhadas.reduce((s, l) => s + l.parcela, 0);

  return (
    <div>
      <TituloView icone={Receipt} cor="#0ea5e9" corFundo="rgba(14,165,233,0.12)" titulo={`Extrato — ${r.label}`}
        subtitulo="Cada NF pelo valor que aparece no extrato bancário, a parcela que pertence a esta rodada e onde está o restante" T={T}/>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:16,marginBottom:20}}>
        <KPI label={`Custo da ${r.label}`} value={fmtR(r.total)} sub={`${r.jogos.length} jogo${r.jogos.length>1?"s":""} · ${linhas.length} NFs envolvidas`} color={T.text} T={T}/>
        <KPI label="Em NFs exclusivas da rodada" value={fmtR(somaExcl)} sub={`${exclusivas.length} NFs — extrato bate 1:1`} color="#22c55e" T={T}/>
        <KPI label="Em NFs compartilhadas/rateadas" value={fmtR(somaComp)} sub={`${compartilhadas.length} NFs — só a parcela pertence à rodada`} color="#d97706" T={T}/>
        <KPI label="Documentos no extrato" value={`${linhas.length} NFs`} sub={`${compartilhadas.length} compartilhada${compartilhadas.length===1?"":"s"} com outras rodadas`} color={T.textSm} T={T}/>
      </div>

      <Card T={T} style={{marginBottom:16}}>
        <div style={{padding:"16px 20px",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:760,color:T.text}}>
            <thead><tr>
              <th style={thSty(T)}>Fornecedor</th>
              <th style={thSty(T)}>NF</th>
              <th style={thSty(T)}>Natureza</th>
              <th style={thSty(T,true)}>Valor no extrato</th>
              <th style={thSty(T,true)}>Parcela desta rodada</th>
              <th style={thSty(T)}>Onde está o restante</th>
            </tr></thead>
            <tbody>
              {linhas.map(l => (
                <tr key={l.key} style={{borderBottom:`1px solid ${T.border}`}}>
                  <td style={tdSty()}>{l.fornecedor}</td>
                  <td style={{...tdSty(),maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={l.numeroNF}>{l.numeroNF}</td>
                  <td style={tdSty()}>
                    <PillNat nat={l.natureza}/>
                    {l.memoria && <div style={{fontSize:10,color:T.textSm,marginTop:2}}>{l.memoria}</div>}
                  </td>
                  <td style={{...tdSty(true),color:T.textMd,fontVariantNumeric:"tabular-nums"}}>{fmtNum(l.extrato)}</td>
                  <td style={{...tdSty(true),fontWeight:700,color:l.natureza==="exclusiva"?"#22c55e":"#d97706",fontVariantNumeric:"tabular-nums"}}>{fmtNum(l.parcela)}</td>
                  <td style={{...tdSty(),fontSize:11,color:T.textMd}}>
                    {l.destinos.length === 0 ? "—" : l.destinos.map(d => `${d.label}: ${fmtNum(d.valor)}`).join(" · ")}
                  </td>
                </tr>
              ))}
              {/* O total da coluna "Valor no extrato" não é somado de propósito:
                  documentos compartilhados aparecem pelo valor cheio em cada
                  rodada que tocam — somá-los duplicaria entre rodadas. */}
              <tr style={{background:T.bg}}>
                <td style={{...tdSty(),fontWeight:700}} colSpan={3}>Custo da rodada (soma das parcelas)</td>
                <td style={{...tdSty(true),color:T.textSm}}>—</td>
                <td style={{...tdSty(true),fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmtNum(r.total)}</td>
                <td style={tdSty()}/>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{padding:"12px 16px",borderRadius:10,border:`1px solid #0ea5e940`,background:"rgba(14,165,233,0.07)",marginBottom:12}}>
        <p style={{margin:0,fontSize:12,color:T.textMd,lineHeight:1.5}}>
          <b style={{color:T.text}}>Por que o extrato não bate 1:1 com a rodada:</b> as NFs marcadas como
          compartilhadas/rateadas passam no extrato pelo <b>valor cheio</b>, mas apenas a <b>parcela</b> indicada
          pertence a esta rodada — o restante está nas rodadas listadas ao lado. A soma das parcelas ({fmtNum(r.total)})
          é o custo exato da rodada.
        </p>
      </div>

    </div>
  );
}

export default function TabApresentacoes({ T, jogos = [], servicos = [], notasMensais = [], apres, setApres, orcGlobal = 0, mesInicio = 0, mesFim = 11, nomeCampeonato = "", notas = [], notasLivemode = [], notasLiveU = [], dedupeNotasPorNF = false, grupoDoJogo = null }) {
  const a = apres || {};
  const upd = updater => setApres(prev => updater(prev || {}));
  const setField = (field, v) => upd(p => ({ ...p, [field]: v }));
  const setVarField = (rodada, field, v) => upd(p => ({ ...p, varOverrides: { ...(p.varOverrides || {}), [rodada]: { ...((p.varOverrides || {})[rodada] || {}), [field]: v } } }));
  const resetVar = () => upd(p => ({ ...p, varOverrides: {}, nfEsp: "", nfRec: "" }));

  const nfEspOvr = a.nfEsp ?? "";
  const nfRecOvr = a.nfRec ?? "";

  const dadosVar = useMemo(() => calcVariaveis({
    jogos, rodadaSel: a.varRodada ?? null, overrides: a.varOverrides || {},
    nfEspOvr, nfRecOvr, orcGlobal,
  }), [jogos, a.varRodada, a.varOverrides, nfEspOvr, nfRecOvr, orcGlobal]);

  const dadosFix = useMemo(() => calcFixos({
    servicos, notasMensais, jogos,
    mesSel: a.fixMes ?? null, rodadaSel: a.fixRodada ?? null, mesInicio, mesFim,
  }), [servicos, notasMensais, jogos, a.fixMes, a.fixRodada, mesInicio, mesFim]);

  const vg = useMemo(() => calcVisaoGeral({ dadosVar, dadosFix, orcGlobalVar: orcGlobal }), [dadosVar, dadosFix, orcGlobal]);

  // Extrato por Rodada: mesmo motor da Rastreabilidade — bate com o dashboard
  const fech = useMemo(
    () => buildFechamentoPorRodada({ jogos, notas, notasMensais, notasLivemode, notasLiveU, dedupeNotasPorNF, grupoDoJogo }),
    [jogos, notas, notasMensais, notasLivemode, notasLiveU, dedupeNotasPorNF, grupoDoJogo]
  );
  const [extratoKey, setExtratoKey] = useState(null);
  const rodadasComMovimento = fech.rodadas.filter(r => r.total > 0 || r.diretas.length > 0);
  const rodadaExtrato = fech.rodadas.find(r => r.key === extratoKey)
    || rodadasComMovimento[rodadasComMovimento.length - 1]
    || fech.rodadas[0]
    || null;

  const [view, setView] = useState("visaogeral");
  const [editMode, setEditMode] = useState(false);

  const TABS = [
    {value:"visaogeral", label:"Visão Geral",      icon:LayoutGrid},
    {value:"variaveis",  label:"Custos Variáveis", icon:BarChart3},
    {value:"fixos",      label:"Custos Fixos",     icon:Lock},
    {value:"extrato",    label:"Extrato por Rodada", icon:Receipt},
  ];
  const temAjustes = view === "variaveis"; // fixos não têm ajuste manual: fonte é a aba Serviços
  const teal = "#14b8a6";

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:4}}>
          {TABS.map(t => (
            <button key={t.value} onClick={()=>{setView(t.value); setEditMode(false);}} style={{
              padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
              display:"flex",alignItems:"center",gap:6,
              background:view===t.value?teal:"transparent",color:view===t.value?"#fff":T.textMd,
            }}><t.icon size={14}/>{t.label}</button>
          ))}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          {view === "variaveis" && (
            <select value={dadosVar.rodadaAtual} onChange={e=>setField("varRodada",parseInt(e.target.value))} style={{...iSty(T),padding:"6px 10px"}}>
              {dadosVar.rodadasDisp.length === 0
                ? <option value={1}>—</option>
                : dadosVar.rodadasDisp.map(r => <option key={r} value={r}>Rodada {r}</option>)}
            </select>
          )}
          {view === "fixos" && (
            <>
              <select value={dadosFix.mesAtual} onChange={e=>setField("fixMes",parseInt(e.target.value))} style={{...iSty(T),padding:"6px 10px"}}>
                {MESES_FIX.map((m,i) => <option key={i} value={i}>{m}</option>)}
              </select>
              {dadosFix.rodadasDisp.length > 0 && (
                <select value={dadosFix.rodadaAtual} onChange={e=>setField("fixRodada",parseInt(e.target.value))} style={{...iSty(T),padding:"6px 10px"}}>
                  {dadosFix.rodadasDisp.map(r => <option key={r} value={r}>Rodada {r}</option>)}
                </select>
              )}
            </>
          )}
          {view === "extrato" && fech.rodadas.length > 0 && (
            <select value={rodadaExtrato?.key || ""} onChange={e=>setExtratoKey(e.target.value)} style={{...iSty(T),padding:"6px 10px"}}>
              {fech.rodadas.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          )}
          {temAjustes && (
            <Button T={T} variant={editMode?"primary":"secondary"} size="md" icon={editMode?X:Settings2} onClick={()=>setEditMode(m=>!m)}>
              {editMode ? "Fechar ajustes" : "Ajustar dados"}
            </Button>
          )}
        </div>
      </div>

      {view === "visaogeral" && <SlideVisaoGeral vg={vg} T={T}/>}
      {view === "variaveis" && (
        <>
          <SlideVariaveis d={dadosVar} T={T}/>
          {editMode && <AjustesVariaveis d={dadosVar} T={T} nfEspOvr={nfEspOvr} nfRecOvr={nfRecOvr} setField={setField} setVarField={setVarField} resetVar={resetVar} orcGlobal={orcGlobal}/>}
        </>
      )}
      {view === "fixos" && (
        <ErrorBoundary>
          <SlideFixos d={dadosFix} T={T}/>
        </ErrorBoundary>
      )}
      {view === "extrato" && (
        <ErrorBoundary>
          <SlideExtrato fech={fech} rodada={rodadaExtrato} T={T}/>
        </ErrorBoundary>
      )}

      <p style={{textAlign:"center",fontSize:11,color:T.textSm,margin:"8px 0 0"}}>Acompanhamento Orçamentário – {nomeCampeonato}</p>
    </div>
  );
}
