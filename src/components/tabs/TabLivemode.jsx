import { patchNumeroNF } from "../../lib/nfNumero";
import { useState, useMemo, useRef } from "react";
import { KPI, Pill } from "../shared";
import { RADIUS, iSty, btnStyle } from "../../constants";
import { Card, PanelTitle, Button, Chip, Progress, tableStyles, DateInput } from "../ui";
import { CheckCircle2, Clock, Edit2, Plus, Trash2, Eye, Upload } from "lucide-react";
import { fileToDataUrl, saveNFFile, getNFFile, deleteNFFile } from "../../lib/supabase";

const fmt = v => (v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});

export const SERVICOS_LM = [
  { key:"grafismo",     orcadoKey:"maquinas",    label:"Máquinas de Grafismo", valorPadrao:1974 },
  { key:"starlink",     orcadoKey:"starlink",    label:"Starlink",             valorPadrao:329  },
  { key:"downlink",     orcadoKey:"downlink",    label:"Downlink",             valorPadrao:1500 },
  { key:"distribuicao", orcadoKey:"distribuicao",label:"Distribuição",         valorPadrao:1000 },
];

const LIVEU_VALOR_PADRAO = 1974;

const lmOrcado = (j) => (j.orcado?.downlink||0) + (j.orcado?.distribuicao||0) + (j.orcado?.maquinas||0);

function abreviar(nome) {
  if (!nome || nome === "A definir") return "TBD";
  const map = {"Fluminense":"FLU","Botafogo":"BOT","Flamengo":"FLA","Vasco":"VAS","Corinthians":"COR","Palmeiras":"PAL","São Paulo":"SAO","Athletico PR":"CAP","Grêmio":"GRE","Internacional":"INT","Cruzeiro":"CRU","Atlético MG":"CAM","Chapecoense":"CHA","Santos":"SAN","Vitória":"VIT","Mirassol":"MIR","Coritiba":"CFC"};
  return map[nome] || nome.slice(0,3).toUpperCase();
}

function jogoLabel(j) {
  return `${abreviar(j.mandante)}x${abreviar(j.visitante)}`;
}

// ── Modal para registrar NF Livemode ──
function NFLivemodeModal({ onSave, onClose, jogos, T, servicosLm = SERVICOS_LM }) {
  const IS = iSty(T);
  const divulgados = jogos.filter(j => j.mandante !== "A definir").sort((a,b) => a.rodada - b.rodada);
  const [selJogos, setSelJogos] = useState(new Set());
  const [servicos, setServicos] = useState({});
  const [form, setForm] = useState({ numeroNF:"", fornecedor:"Livemode", dataEmissao:"", obs:"" });
  const [arquivo, setArquivo] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const set = (k,v) => setForm(f => ({...f,[k]:v}));

  const toggleJogo = (id) => setSelJogos(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectByRodada = (rod) => {
    const ids = divulgados.filter(j => j.rodada === rod).map(j => j.id);
    setSelJogos(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
  };
  const selectRange = (fromRd, toRd) => {
    const ids = divulgados.filter(j => j.rodada >= fromRd && j.rodada <= toRd).map(j => j.id);
    setSelJogos(new Set(ids));
  };

  const toggleServico = (key) => {
    setServicos(prev => {
      const s = {...prev};
      if (s[key] !== undefined) { delete s[key]; } else { s[key] = servicosLm.find(x=>x.key===key)?.valorPadrao || 0; }
      return s;
    });
  };
  const setServicoValor = (key, val) => setServicos(prev => ({...prev, [key]: parseFloat(val)||0}));

  const valorPorJogo = Object.values(servicos).reduce((s,v) => s+(v||0), 0);
  const totalNF = valorPorJogo * selJogos.size;
  const selCount = Object.keys(servicos).length;
  const servicosLabels = Object.keys(servicos).map(k => servicosLm.find(x=>x.key===k)?.label||k);

  const selJogosArr = divulgados.filter(j => selJogos.has(j.id));
  const jogosIds = [...selJogos];
  const rodadasSet = new Set(selJogosArr.map(j => j.rodada));
  const rodadasArr = [...rodadasSet].sort((a,b) => a-b);
  const jogosResumoLabel = selJogos.size === 0 ? "" :
    selJogos.size <= 4 ? selJogosArr.map(j => `Rd${j.rodada} ${jogoLabel(j)}`).join(", ") :
    `${selJogos.size} jogos (Rd ${rodadasArr[0]}-${rodadasArr[rodadasArr.length-1]})`;

  const handleSave = async () => {
    if (selCount === 0 || selJogos.size === 0 || (!form.numeroNF && !form.fornecedor)) return;
    setUploading(true);
    const notaId = Date.now();
    let hasFile = false;
    if (arquivo) {
      try { const dataUrl = await fileToDataUrl(arquivo); await saveNFFile(notaId, dataUrl); hasFile = true; } catch(_){}
    }
    onSave({
      id: notaId,
      jogosIds,
      jogosResumoLabel,
      rodadas: rodadasArr,
      rodadasLabel: jogosResumoLabel,
      servicos: {...servicos},
      servicosLabels,
      numeroNF: form.numeroNF,
      fornecedor: form.fornecedor || "Livemode",
      valor: totalNF,
      valorPorJogo,
      dataEmissao: form.dataEmissao,
      obs: form.obs,
      hasFile,
    });
    setUploading(false);
  };

  const rodadasComJogos = useMemo(() => {
    const map = {};
    divulgados.forEach(j => {
      if (!map[j.rodada]) map[j.rodada] = [];
      map[j.rodada].push(j);
    });
    return Object.entries(map).sort(([a],[b]) => a-b);
  }, [divulgados]);

  return (
    <div style={{position:"fixed",inset:0,background:"#00000099",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:T.card,borderRadius:16,padding:28,width:"100%",maxWidth:620,maxHeight:"90vh",overflowY:"auto"}}>
        <h3 style={{margin:"0 0 4px",fontSize:16,color:T.text}}>Registrar NF Livemode</h3>
        <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Selecione os jogos cobertos por esta nota</p>

        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <label style={{color:T.textMd,fontSize:12}}>Jogos <span style={{color:T.textSm,fontSize:11}}>({selJogos.size} selecionado{selJogos.size!==1?"s":""})</span></label>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>selectRange(1,9)} style={{...btnStyle,background:T.border,padding:"3px 8px",fontSize:10,color:T.text}}>Rd 1-9</button>
              <button onClick={()=>selectRange(1,19)} style={{...btnStyle,background:T.border,padding:"3px 8px",fontSize:10,color:T.text}}>Rd 1-19</button>
              <button onClick={()=>setSelJogos(new Set(divulgados.map(j=>j.id)))} style={{...btnStyle,background:T.border,padding:"3px 8px",fontSize:10,color:T.text}}>Todos</button>
              <button onClick={()=>setSelJogos(new Set())} style={{...btnStyle,background:T.border,padding:"3px 8px",fontSize:10,color:T.text}}>Limpar</button>
            </div>
          </div>
          <div style={{maxHeight:240,overflowY:"auto",background:T.bg,borderRadius:8,padding:4}}>
            {rodadasComJogos.map(([rod, jgs]) => (
              <div key={rod}>
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px"}}>
                  <button onClick={()=>selectByRodada(parseInt(rod))} style={{background:"none",border:"none",color:T.textSm,fontSize:10,cursor:"pointer",fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",padding:0}}>Rd {rod}</button>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4,padding:"0 8px 6px"}}>
                  {jgs.map(j => {
                    const sel = selJogos.has(j.id);
                    return (
                      <button key={j.id} onClick={()=>toggleJogo(j.id)}
                        style={{
                          padding:"4px 10px", borderRadius:6,
                          border:`1px solid ${sel?"#14b8a6":T.muted}`,
                          background:sel?"#14b8a622":"transparent",
                          color:sel?"#14b8a6":T.textMd,
                          fontSize:11, fontWeight:sel?700:500, cursor:"pointer",
                          whiteSpace:"nowrap",
                        }}>
                        {j.mandante} x {j.visitante}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {selJogos.size > 0 && <p style={{color:"#14b8a6",fontSize:11,margin:"6px 0 0",fontWeight:600}}>{jogosResumoLabel} · {fmt(valorPorJogo)}/jogo · Total: {fmt(totalNF)}</p>}
        </div>

        <div style={{marginBottom:12}}>
          <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:6}}>Serviços (valor por jogo)</label>
          <div style={{background:T.bg,borderRadius:8,padding:8}}>
            {servicosLm.map(s => {
              const checked = servicos[s.key] !== undefined;
              return (
                <div key={s.key} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,background:checked?"#22c55e18":"transparent"}}>
                  <input type="checkbox" checked={checked} onChange={()=>toggleServico(s.key)} style={{accentColor:"#22c55e"}}/>
                  <span style={{flex:1,fontSize:13,color:T.text}}>{s.label}</span>
                  {checked
                    ? <input type="number" value={servicos[s.key]} onChange={e=>setServicoValor(s.key, e.target.value)}
                        style={{...IS,width:100,textAlign:"right",padding:"3px 6px",fontSize:12,color:"#a855f7",fontWeight:600}}/>
                    : <span className="num" style={{fontSize:11,color:T.textSm,width:100,textAlign:"right"}}>{fmt(s.valorPadrao)}</span>
                  }
                </div>
              );
            })}
            {selCount > 0 && selJogos.size > 0 && (
              <div style={{borderTop:`1px solid ${T.border}`,marginTop:6,paddingTop:6,display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:12,color:T.textMd}}>{fmt(valorPorJogo)}/jogo × {selJogos.size} jogos</span>
                <span style={{fontSize:14,fontWeight:700,color:"#a855f7"}}>Total: {fmt(totalNF)}</span>
              </div>
            )}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Fornecedor</label>
            <input value={form.fornecedor} onChange={e=>set("fornecedor",e.target.value)} placeholder="Livemode" style={IS}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Nº da Nota</label>
            <input value={form.numeroNF} onChange={e=>{ const p = patchNumeroNF(e.target.value); set("numeroNF", p.numeroNF); set("chaveAcesso", p.chaveAcesso); }} style={IS} title="Pode colar a chave de acesso da NFS-e: o número é extraído automaticamente"/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Data Emissão</label>
            <DateInput value={form.dataEmissao} onChange={v=>set("dataEmissao",v)} style={IS}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Observações</label>
            <input value={form.obs} onChange={e=>set("obs",e.target.value)} style={IS}/>
          </div>
        </div>

        <div style={{marginBottom:16}}>
          <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Arquivo da NF (PDF/imagem)</label>
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e=>setArquivo(e.target.files[0]||null)} style={{display:"none"}}/>
          <div onClick={()=>fileRef.current?.click()}
            onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();setArquivo(e.dataTransfer.files[0]||null);}}
            style={{border:`2px dashed ${arquivo?"#22c55e":T.muted}`,borderRadius:8,padding:"14px 16px",cursor:"pointer",textAlign:"center",background:arquivo?"#22c55e11":T.bg}}>
            {arquivo
              ? <p style={{margin:0,color:"#22c55e",fontSize:13,fontWeight:600}}>{arquivo.name} ({(arquivo.size/1024).toFixed(0)} KB)</p>
              : <p style={{margin:0,color:T.textSm,fontSize:12}}>Clique ou arraste o arquivo aqui</p>}
          </div>
        </div>

        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{...btnStyle,background:"#475569"}}>Cancelar</button>
          <button onClick={handleSave} disabled={selCount===0||selJogos.size===0||uploading} style={{...btnStyle,background:selCount>0&&selJogos.size>0?"#22c55e":"#475569",opacity:selCount>0&&selJogos.size>0&&!uploading?1:0.5}}>
            {uploading ? "Enviando..." : "Salvar NF"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal para registrar NF liveU ──
function NFLiveUModal({ onSave, onClose, jogos, T }) {
  const IS = iSty(T);
  const amber = "#f59e0b";
  const divulgados = jogos.filter(j => j.mandante !== "A definir").sort((a,b) => a.rodada - b.rodada);
  const [selJogos, setSelJogos] = useState(new Set());
  const [form, setForm] = useState({ numeroNF:"", fornecedor:"", dataEmissao:"", obs:"" });
  // Valor Real fica em branco por padrao -- so sugere o projetado (LIVEU_VALOR_PADRAO
  // x qtd de jogos) como referencia. Precisa ser digitado pra bater com a NF de verdade.
  const [valorRealStr, setValorRealStr] = useState("");
  const [arquivo, setArquivo] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const set = (k,v) => setForm(f => ({...f,[k]:v}));

  const toggleJogo = (id) => setSelJogos(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectByRodada = (rod) => {
    const ids = divulgados.filter(j => j.rodada === rod).map(j => j.id);
    setSelJogos(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
  };
  const selectRange = (fromRd, toRd) => {
    const ids = divulgados.filter(j => j.rodada >= fromRd && j.rodada <= toRd).map(j => j.id);
    setSelJogos(new Set(ids));
  };

  const totalProjetado = LIVEU_VALOR_PADRAO * selJogos.size;
  const totalNF = valorRealStr !== "" ? (parseFloat(valorRealStr) || 0) : totalProjetado;
  const valorPorJogo = selJogos.size > 0 ? totalNF / selJogos.size : 0;

  const selJogosArr = divulgados.filter(j => selJogos.has(j.id));
  const jogosIds = [...selJogos];
  const rodadasSet = new Set(selJogosArr.map(j => j.rodada));
  const rodadasArr = [...rodadasSet].sort((a,b) => a-b);
  const jogosResumoLabel = selJogos.size === 0 ? "" :
    selJogos.size <= 4 ? selJogosArr.map(j => `Rd${j.rodada} ${jogoLabel(j)}`).join(", ") :
    `${selJogos.size} jogos (Rd ${rodadasArr[0]}-${rodadasArr[rodadasArr.length-1]})`;

  const rodadasComJogos = useMemo(() => {
    const map = {};
    divulgados.forEach(j => {
      if (!map[j.rodada]) map[j.rodada] = [];
      map[j.rodada].push(j);
    });
    return Object.entries(map).sort(([a],[b]) => a-b);
  }, [divulgados]);

  const handleSave = async () => {
    if (selJogos.size === 0) return;
    setUploading(true);
    const notaId = Date.now();
    let hasFile = false;
    if (arquivo) {
      try { const dataUrl = await fileToDataUrl(arquivo); await saveNFFile(notaId, dataUrl); hasFile = true; } catch(_){}
    }
    onSave({
      id: notaId,
      jogosIds,
      jogosResumoLabel,
      rodadas: rodadasArr,
      rodadasLabel: jogosResumoLabel,
      servicosLabels: ["liveU"],
      numeroNF: form.numeroNF,
      fornecedor: form.fornecedor,
      valor: totalNF,
      valorPorJogo,
      dataEmissao: form.dataEmissao,
      obs: form.obs,
      hasFile,
    });
    setUploading(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000099",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:T.card,borderRadius:16,padding:28,width:"100%",maxWidth:620,maxHeight:"90vh",overflowY:"auto"}}>
        <h3 style={{margin:"0 0 4px",fontSize:16,color:T.text}}>Registrar NF liveU</h3>
        <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>{fmt(LIVEU_VALOR_PADRAO)}/jogo é só o projetado — selecione os jogos e informe o valor real da NF</p>

        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <label style={{color:T.textMd,fontSize:12}}>Jogos <span style={{color:T.textSm,fontSize:11}}>({selJogos.size} selecionado{selJogos.size!==1?"s":""})</span></label>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>selectRange(1,9)} style={{...btnStyle,background:T.border,padding:"3px 8px",fontSize:10,color:T.text}}>Rd 1-9</button>
              <button onClick={()=>selectRange(1,19)} style={{...btnStyle,background:T.border,padding:"3px 8px",fontSize:10,color:T.text}}>Rd 1-19</button>
              <button onClick={()=>setSelJogos(new Set(divulgados.map(j=>j.id)))} style={{...btnStyle,background:T.border,padding:"3px 8px",fontSize:10,color:T.text}}>Todos</button>
              <button onClick={()=>setSelJogos(new Set())} style={{...btnStyle,background:T.border,padding:"3px 8px",fontSize:10,color:T.text}}>Limpar</button>
            </div>
          </div>
          <div style={{maxHeight:240,overflowY:"auto",background:T.bg,borderRadius:8,padding:4}}>
            {rodadasComJogos.map(([rod, jgs]) => (
              <div key={rod}>
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px"}}>
                  <button onClick={()=>selectByRodada(parseInt(rod))} style={{background:"none",border:"none",color:T.textSm,fontSize:10,cursor:"pointer",fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",padding:0}}>Rd {rod}</button>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4,padding:"0 8px 6px"}}>
                  {jgs.map(j => {
                    const sel = selJogos.has(j.id);
                    return (
                      <button key={j.id} onClick={()=>toggleJogo(j.id)}
                        style={{
                          padding:"4px 10px", borderRadius:6,
                          border:`1px solid ${sel?amber:T.muted}`,
                          background:sel?amber+"22":"transparent",
                          color:sel?amber:T.textMd,
                          fontSize:11, fontWeight:sel?700:500, cursor:"pointer",
                          whiteSpace:"nowrap",
                        }}>
                        {j.mandante} x {j.visitante}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {selJogos.size > 0 && <p style={{color:amber,fontSize:11,margin:"6px 0 0",fontWeight:600}}>{jogosResumoLabel} · {fmt(valorPorJogo)}/jogo · Total: {fmt(totalNF)}</p>}
        </div>

        <div style={{marginBottom:12,padding:"12px 16px",background:T.bg,borderRadius:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <p style={{margin:0,fontSize:13,color:T.text,fontWeight:600}}>Valor Real da NF</p>
            <p style={{margin:0,fontSize:11,color:T.textSm}}>Projetado: {fmt(totalProjetado)} ({fmt(LIVEU_VALOR_PADRAO)}/jogo)</p>
          </div>
          <input type="number" value={valorRealStr} onChange={e=>setValorRealStr(e.target.value)}
            placeholder={`Sugestão: ${totalProjetado}`} style={{...IS,fontSize:18,fontWeight:800,color:amber}}/>
          <p style={{margin:"6px 0 0",fontSize:11,color:T.textSm}}>Digite o valor total que está na nota fiscal, pra bater o realizado com o que foi cobrado de verdade. Em branco, usa o projetado.</p>
        </div>

        {selJogos.size > 0 && (
          <div style={{marginBottom:12,padding:"8px 16px",background:amber+"11",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:T.textMd}}>{fmt(valorPorJogo)}/jogo × {selJogos.size} jogos</span>
            <span style={{fontSize:14,fontWeight:700,color:amber}}>Total: {fmt(totalNF)}</span>
          </div>
        )}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Fornecedor</label>
            <input value={form.fornecedor} onChange={e=>set("fornecedor",e.target.value)} placeholder="Fornecedor liveU" style={IS}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Nº da Nota</label>
            <input value={form.numeroNF} onChange={e=>{ const p = patchNumeroNF(e.target.value); set("numeroNF", p.numeroNF); set("chaveAcesso", p.chaveAcesso); }} style={IS} title="Pode colar a chave de acesso da NFS-e: o número é extraído automaticamente"/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Data Emissão</label>
            <DateInput value={form.dataEmissao} onChange={v=>set("dataEmissao",v)} style={IS}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Observações</label>
            <input value={form.obs} onChange={e=>set("obs",e.target.value)} style={IS}/>
          </div>
        </div>

        <div style={{marginBottom:16}}>
          <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Arquivo da NF (PDF/imagem)</label>
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e=>setArquivo(e.target.files[0]||null)} style={{display:"none"}}/>
          <div onClick={()=>fileRef.current?.click()}
            onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();setArquivo(e.dataTransfer.files[0]||null);}}
            style={{border:`2px dashed ${arquivo?amber:T.muted}`,borderRadius:8,padding:"14px 16px",cursor:"pointer",textAlign:"center",background:arquivo?amber+"11":T.bg}}>
            {arquivo
              ? <p style={{margin:0,color:amber,fontSize:13,fontWeight:600}}>{arquivo.name} ({(arquivo.size/1024).toFixed(0)} KB)</p>
              : <p style={{margin:0,color:T.textSm,fontSize:12}}>Clique ou arraste o arquivo aqui</p>}
          </div>
        </div>

        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{...btnStyle,background:"#475569"}}>Cancelar</button>
          <button onClick={handleSave} disabled={selJogos.size===0||uploading} style={{...btnStyle,background:selJogos.size>0?amber:"#475569",opacity:selJogos.size>0&&!uploading?1:0.5}}>
            {uploading ? "Enviando..." : "Salvar NF"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Componente Principal ──
export default function TabLivemode({ livemode, setLivemode, notasLivemode, setNotasLivemode, notasLiveU, setNotasLiveU, jogos, fornecedores, T, useOrcadoLivemode = false, servicosLm = SERVICOS_LM, role = 'admin' }) {
  const [tab, setTab] = useState("notas");
  const canEdit = role === 'admin';
  const [showModal, setShowModal] = useState(false);
  const [showModalLiveU, setShowModalLiveU] = useState(false);

  const IS = iSty(T);
  const TS = tableStyles(T);
  const purple = "#a855f7";
  const green = "#22c55e";
  const teal = "#14b8a6";
  const amber = "#f59e0b";

  const divulgados = jogos.filter(j => j.mandante !== "A definir").sort((a,b) => a.rodada - b.rodada || a.id - b.id);

  // ── NFs Livemode ──
  const nfs = Array.isArray(notasLivemode) ? notasLivemode : [];
  const totalNFs = nfs.length;
  const totalValorNFs = nfs.reduce((s,n) => s + (n.valor||0), 0);

  const addNota = (nota) => {
    setNotasLivemode(ns => [...(ns||[]), nota]);
    setShowModal(false);
  };

  const deleteNota = (id) => {
    if (!window.confirm("Excluir esta NF?")) return;
    deleteNFFile(id);
    setNotasLivemode(ns => (ns||[]).filter(n => n.id !== id));
  };

  // ── NFs liveU ──
  const liveUNfs = Array.isArray(notasLiveU) ? notasLiveU : [];
  const totalLiveUNFs = liveUNfs.length;
  const totalValorLiveU = liveUNfs.reduce((s,n) => s + (n.valor||0), 0);

  const addNotaLiveU = (nota) => {
    setNotasLiveU(ns => [...(ns||[]), nota]);
    setShowModalLiveU(false);
  };

  const deleteNotaLiveU = (id) => {
    if (!window.confirm("Excluir esta NF liveU?")) return;
    deleteNFFile(id);
    setNotasLiveU(ns => (ns||[]).filter(n => n.id !== id));
  };

  // ── Realizado Livemode por jogo ──
  const realizadoPorJogo = useMemo(() => {
    const map = {};
    nfs.forEach(n => {
      const ids = n.jogosIds || [];
      const valorPorJ = ids.length > 0 ? (n.valorPorJogo || (n.valor / ids.length)) : 0;
      ids.forEach(id => {
        map[id] = (map[id] || 0) + valorPorJ;
      });
    });
    return map;
  }, [nfs]);

  // ── Realizado liveU por jogo ──
  const realizadoLiveUPorJogo = useMemo(() => {
    const map = {};
    liveUNfs.forEach(n => {
      const ids = n.jogosIds || [];
      const valorPorJ = ids.length > 0 ? (n.valorPorJogo || (n.valor / ids.length)) : 0;
      ids.forEach(id => {
        map[id] = (map[id] || 0) + valorPorJ;
      });
    });
    return map;
  }, [liveUNfs]);

  // ── Orçado por jogo ──
  const jogoOrcadoFn = useOrcadoLivemode ? lmOrcado : () => servicosLm.reduce((s,x) => s+x.valorPadrao, 0);
  const totalOrcado = divulgados.reduce((s,j) => s + jogoOrcadoFn(j), 0);

  // Totais por serviço Livemode
  const totaisPorServico = servicosLm.map(s => ({
    ...s,
    total: useOrcadoLivemode
      ? divulgados.reduce((sum,j) => sum + (j.orcado?.[s.orcadoKey]||0), 0)
      : divulgados.length * s.valorPadrao,
    realizado: nfs.reduce((sum,n) => {
      const ids = n.jogosIds || [];
      return sum + (n.servicos?.[s.key] || 0) * ids.length;
    }, 0),
  }));

  // Jogos com NF (livemode ou liveU)
  const jogosComNF = new Set([
    ...nfs.flatMap(n => n.jogosIds || []),
    ...liveUNfs.flatMap(n => n.jogosIds || []),
  ]);

  const TABS_LM = [
    {value:"notas", label:"Notas Fiscais"},
    {value:"liveu", label:"liveU"},
    {value:"controle", label:"Controle por Jogo"},
  ];

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:16,marginBottom:16}}>
        <KPI label="Orçado Total" value={fmt(totalOrcado)} sub={`${divulgados.length} jogos`} color={purple} T={T}/>
        <KPI label="NFs Livemode" value={String(totalNFs)} sub={fmt(totalValorNFs)} color={green} T={T}/>
        <KPI label="NFs liveU" value={String(totalLiveUNFs)} sub={fmt(totalValorLiveU)} color={amber} T={T}/>
        {role !== 'visualizador' && <KPI label="Saldo" value={fmt(totalOrcado - totalValorNFs - totalValorLiveU)} sub={`${totalOrcado ? (((totalValorNFs+totalValorLiveU)/totalOrcado)*100).toFixed(1) : 0}% executado`} color={totalOrcado-totalValorNFs-totalValorLiveU>=0?teal:T.danger} T={T}/>}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginBottom:20}}>
        {totaisPorServico.map(s => (
          <Card key={s.key} T={T}>
            <div style={{padding:"14px 18px"}}>
              <p style={{color:T.textSm,fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",margin:"0 0 6px"}}>{s.label}</p>
              <p className="num" style={{color:T.text,fontSize:18,fontWeight:800,margin:"0 0 4px"}}>{fmt(s.total)}</p>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
                <span style={{color:green}}>NFs: {fmt(s.realizado)}</span>
                <span style={{color:T.textSm}}>{s.total ? ((s.realizado/s.total)*100).toFixed(0) : 0}%</span>
              </div>
              <div style={{marginTop:6}}><Progress value={s.total ? (s.realizado/s.total)*100 : 0} T={T}/></div>
            </div>
          </Card>
        ))}
        <Card T={T}>
          <div style={{padding:"14px 18px"}}>
            <p style={{color:T.textSm,fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",margin:"0 0 6px"}}>liveU</p>
            <p className="num" style={{color:T.text,fontSize:18,fontWeight:800,margin:"0 0 4px"}}>{fmt(divulgados.length * LIVEU_VALOR_PADRAO)}</p>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
              <span style={{color:amber}}>NFs: {fmt(totalValorLiveU)}</span>
              <span style={{color:T.textSm}}>{divulgados.length ? ((totalValorLiveU/(divulgados.length*LIVEU_VALOR_PADRAO))*100).toFixed(0) : 0}%</span>
            </div>
            <div style={{marginTop:6}}><Progress value={divulgados.length ? (totalValorLiveU/(divulgados.length*LIVEU_VALOR_PADRAO))*100 : 0} T={T}/></div>
          </div>
        </Card>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:12}}>
        <div style={{display:"flex",gap:4}}>
          {TABS_LM.map(t => (
            <button key={t.value} onClick={()=>setTab(t.value)} style={{
              padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
              background:tab===t.value?teal:"transparent",color:tab===t.value?"#fff":T.textMd,
            }}>{t.label}</button>
          ))}
        </div>
        {canEdit && <div style={{display:"flex",gap:8}}>
          <Button T={T} variant="primary" size="md" icon={Plus} onClick={()=>setShowModal(true)}>Nova NF</Button>
          <Button T={T} variant="secondary" size="md" icon={Plus} onClick={()=>setShowModalLiveU(true)} style={{background:amber+"22",color:amber,border:`1px solid ${amber}44`}}>Nova NF liveU</Button>
        </div>}
      </div>

      {/* ── ABA NOTAS LIVEMODE ── */}
      {tab === "notas" && (
        <div>
          {nfs.length === 0 ? (
            <Card T={T}>
              <div style={{padding:50,textAlign:"center"}}>
                <p style={{color:T.text,fontSize:14,margin:"0 0 4px",fontWeight:600}}>Nenhuma NF Livemode registrada</p>
                <p style={{color:T.textSm,fontSize:12,margin:0}}>Clique em "Nova NF" para registrar</p>
              </div>
            </Card>
          ) : (
            <Card T={T}>
              <div style={TS.wrap}>
                <table style={{...TS.table, minWidth:700}}>
                  <thead>
                    <tr style={TS.thead}>
                      {["Jogos","Nº NF","Fornecedor","Serviços","Valor","Emissão","Obs",""].map(h =>
                        <th key={h} style={{...TS.th, ...(h==="Valor"?TS.thRight:TS.thLeft)}}>{h}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {[...nfs].sort((a,b) => (a.jogosIds?.[0]||0) - (b.jogosIds?.[0]||0)).map(n => (
                      <tr key={n.id} style={TS.tr}>
                        <td style={{...TS.td, fontWeight:600, fontSize:12, maxWidth:200}}>{n.jogosResumoLabel || n.rodadasLabel || `${(n.jogosIds||[]).length} jogos`}</td>
                        <td className="num" style={{...TS.td, fontSize:12}}>{n.numeroNF||"—"}</td>
                        <td style={{...TS.td, fontWeight:600, fontSize:12}}>{n.fornecedor}</td>
                        <td style={{...TS.td, fontSize:11}}>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                            {(n.servicosLabels||[]).map(s => <Pill key={s} label={s} color={teal}/>)}
                          </div>
                        </td>
                        <td className="num" style={{...TS.tdNum, color:purple, fontWeight:700}}>{fmt(n.valor)}</td>
                        <td className="num" style={{...TS.td, color:T.textSm, fontSize:11}}>{n.dataEmissao||"—"}</td>
                        <td style={{...TS.td, color:T.textSm, fontSize:11}}>{n.obs||""}</td>
                        <td style={TS.td}>
                          {canEdit && <Button T={T} variant="danger" size="sm" icon={Trash2} onClick={()=>deleteNota(n.id)}/>}
                        </td>
                      </tr>
                    ))}
                    <tr style={{borderTop:`2px solid ${T.borderStrong||T.border}`,background:T.surfaceAlt||T.bg,fontWeight:700}}>
                      <td colSpan={4} style={{...TS.td,fontSize:11,letterSpacing:"0.04em",textTransform:"uppercase"}}>Total ({nfs.length} notas)</td>
                      <td className="num" style={{...TS.tdNum, color:purple, fontWeight:700, fontSize:14}}>{fmt(totalValorNFs)}</td>
                      <td colSpan={3}/>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── ABA liveU ── */}
      {tab === "liveu" && (
        <div>
          {liveUNfs.length === 0 ? (
            <Card T={T}>
              <div style={{padding:50,textAlign:"center"}}>
                <p style={{color:T.text,fontSize:14,margin:"0 0 4px",fontWeight:600}}>Nenhuma NF liveU registrada</p>
                <p style={{color:T.textSm,fontSize:12,margin:0}}>Clique em "Nova NF liveU" para registrar</p>
              </div>
            </Card>
          ) : (
            <Card T={T}>
              <div style={TS.wrap}>
                <table style={{...TS.table, minWidth:600}}>
                  <thead>
                    <tr style={TS.thead}>
                      {["Jogos","Nº NF","Fornecedor","Valor","Emissão","Obs",""].map(h =>
                        <th key={h} style={{...TS.th, ...(h==="Valor"?TS.thRight:TS.thLeft)}}>{h}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {[...liveUNfs].sort((a,b) => (a.jogosIds?.[0]||0) - (b.jogosIds?.[0]||0)).map(n => (
                      <tr key={n.id} style={TS.tr}>
                        <td style={{...TS.td, fontWeight:600, fontSize:12, maxWidth:200}}>{n.jogosResumoLabel || `${(n.jogosIds||[]).length} jogos`}</td>
                        <td className="num" style={{...TS.td, fontSize:12}}>{n.numeroNF||"—"}</td>
                        <td style={{...TS.td, fontWeight:600, fontSize:12}}>{n.fornecedor||"—"}</td>
                        <td className="num" style={{...TS.tdNum, color:amber, fontWeight:700}}>{fmt(n.valor)}</td>
                        <td className="num" style={{...TS.td, color:T.textSm, fontSize:11}}>{n.dataEmissao||"—"}</td>
                        <td style={{...TS.td, color:T.textSm, fontSize:11}}>{n.obs||""}</td>
                        <td style={TS.td}>
                          {canEdit && <Button T={T} variant="danger" size="sm" icon={Trash2} onClick={()=>deleteNotaLiveU(n.id)}/>}
                        </td>
                      </tr>
                    ))}
                    <tr style={{borderTop:`2px solid ${T.borderStrong||T.border}`,background:T.surfaceAlt||T.bg,fontWeight:700}}>
                      <td colSpan={3} style={{...TS.td,fontSize:11,letterSpacing:"0.04em",textTransform:"uppercase"}}>Total ({liveUNfs.length} notas)</td>
                      <td className="num" style={{...TS.tdNum, color:amber, fontWeight:700, fontSize:14}}>{fmt(totalValorLiveU)}</td>
                      <td colSpan={3}/>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── ABA CONTROLE POR JOGO ── */}
      {tab === "controle" && (
        <Card T={T}>
          <div style={TS.wrap}>
            <table style={{...TS.table, minWidth:680}}>
              <thead>
                <tr style={TS.thead}>
                  {["Rd","Jogo","Orçado","Livemode","liveU","Total NFs",...(role !== 'visualizador' ? ["Saldo"] : []),"Status"].map(h =>
                    <th key={h} style={{...TS.th, ...(["Orçado","Livemode","liveU","Total NFs","Saldo"].includes(h)?TS.thRight:TS.thLeft)}}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {divulgados.map(j => {
                  const realLM = realizadoPorJogo[j.id] || 0;
                  const realLU = realizadoLiveUPorJogo[j.id] || 0;
                  const realTotal = realLM + realLU;
                  const jogoOrcado = jogoOrcadoFn(j);
                  const saldo = jogoOrcado - realTotal;
                  const temNF = jogosComNF.has(j.id);
                  return (
                    <tr key={j.id} style={{...TS.tr, background:temNF ? green+"08" : "transparent"}}>
                      <td className="num" style={{...TS.td, fontWeight:700, fontSize:12}}>Rd {j.rodada}</td>
                      <td style={{...TS.td, fontSize:12, whiteSpace:"nowrap"}}>{j.mandante} x {j.visitante}</td>
                      <td className="num" style={{...TS.tdNum, color:purple}}>{fmt(jogoOrcado)}</td>
                      <td className="num" style={{...TS.tdNum, color:realLM>0?green:T.textSm}}>{fmt(realLM)}</td>
                      <td className="num" style={{...TS.tdNum, color:realLU>0?amber:T.textSm}}>{fmt(realLU)}</td>
                      <td className="num" style={{...TS.tdNum, color:realTotal>0?teal:T.textSm, fontWeight:700}}>{fmt(realTotal)}</td>
                      {role !== 'visualizador' && <td className="num" style={{...TS.tdNum, fontWeight:700, color:saldo<0?T.danger:teal}}>{fmt(saldo)}</td>}
                      <td style={TS.td}>
                        <span style={{
                          display:"inline-flex",alignItems:"center",gap:4,
                          background:temNF?green+"22":T.warning+"22",
                          color:temNF?green:T.warning,
                          border:`1px solid ${temNF?green:T.warning}55`,
                          borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:700,
                        }}>
                          {temNF ? <CheckCircle2 size={10} strokeWidth={2.5}/> : <Clock size={10} strokeWidth={2.5}/>}
                          {temNF ? "Com NF" : "Pendente"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {divulgados.length > 0 && (
                  <tr style={{borderTop:`2px solid ${T.borderStrong||T.border}`,background:T.surfaceAlt||T.bg,fontWeight:700}}>
                    <td colSpan={2} style={{...TS.td,fontSize:11,letterSpacing:"0.04em",textTransform:"uppercase"}}>Total ({divulgados.length} jogos)</td>
                    <td className="num" style={{...TS.tdNum, fontWeight:700, color:purple}}>{fmt(totalOrcado)}</td>
                    <td className="num" style={{...TS.tdNum, fontWeight:700, color:green}}>{fmt(totalValorNFs)}</td>
                    <td className="num" style={{...TS.tdNum, fontWeight:700, color:amber}}>{fmt(totalValorLiveU)}</td>
                    <td className="num" style={{...TS.tdNum, fontWeight:700, color:teal}}>{fmt(totalValorNFs + totalValorLiveU)}</td>
                    {role !== 'visualizador' && <td className="num" style={{...TS.tdNum, fontWeight:700, color:totalOrcado-totalValorNFs-totalValorLiveU>=0?teal:T.danger}}>{fmt(totalOrcado - totalValorNFs - totalValorLiveU)}</td>}
                    <td style={TS.td}>
                      <span style={{fontSize:10,color:T.textSm}}>{jogosComNF.size}/{divulgados.length} com NF</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showModal && <NFLivemodeModal onSave={addNota} onClose={()=>setShowModal(false)} jogos={jogos} T={T} servicosLm={servicosLm}/>}
      {showModalLiveU && <NFLiveUModal onSave={addNotaLiveU} onClose={()=>setShowModalLiveU(false)} jogos={jogos} T={T}/>}
    </div>
  );
}
