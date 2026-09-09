import { useState, useEffect } from "react";
import { zip } from "fflate";
import { getState, setState, getNFFile, publicoEnvio, publicoNFFile, publicoEnvioMarcarPago, publicoEnvioStatusNota } from "../lib/supabase";
import { countNotasFiscais, getEnvioMetricas } from "../lib/notasFiscais";
import { CheckCircle2, Clock, Printer, Download, Radio } from "lucide-react";

const T = {
  bg:"#eef0f4", card:"#ffffff", border:"#e2e8f0", muted:"#cbd5e1",
  text:"#0b1220", textMd:"#475569", textSm:"#64748b",
  brand:"#059669", brandSoft:"rgba(5,150,105,0.10)", brandBorder:"rgba(5,150,105,0.32)",
  info:"#2563eb", warning:"#d97706", danger:"#dc2626",
  surface:"#ffffff", surfaceAlt:"#f1f5f9",
};
const purple = "#a855f7";
const cyan = "#06b6d4";
const fmt = v => (v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
const STATUS_NOTA = ["Pendente","Em sistema","Pago","Alteração"];
const STATUS_NOTA_COLOR = {"Pendente":"#f59e0b","Em sistema":"#3b82f6","Pago":"#22c55e","Alteração":"#ef4444"};

const parseEnvioRef = ref => {
  const raw = decodeURIComponent(String(ref || ""));
  const [maybeKey, ...rest] = raw.split(":");
  if (rest.length > 0 && maybeKey) return { stateKey: maybeKey, target: rest.join(":") };
  return { stateKey: "envios", target: raw };
};

const envioMatches = (envio, target) => {
  if (!envio) return false;
  if (target?.startsWith("id:")) return String(envio.id) === target.slice(3);
  if (envio.publicToken && envio.publicToken === target) return true;
  if (/^\d+$/.test(String(target || ""))) return Number(envio.numero) === Number(target);
  return false;
};

export default function EnvioPublico({ numero, envioRef }) {
  const [envio, setEnvio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [payerName, setPayerName] = useState("");
  const [paying, setPaying] = useState(false);
  const [statusChange, setStatusChange] = useState(null); // {notaId, tipo, novoStatus, statusAtual}
  const [statusChangeName, setStatusChangeName] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const { stateKey, target } = parseEnvioRef(envioRef ?? numero);
  const dedupeNotasPorNF = stateKey === "paulistao_envios";

  // Token do link = `target` (links gerados pelo Hub sempre carregam publicToken).
  // Caminho novo: o servidor valida o token e devolve só este envio. Links
  // antigos por id/número caem no caminho legado enquanto ele existir.
  const ehToken = !!target && !target.startsWith("id:") && !/^\d+$/.test(String(target));
  useEffect(() => {
    (async () => {
      try {
        if (ehToken) {
          const r = await publicoEnvio(target);
          if (r?.envio) { setEnvio(r.envio); setLoading(false); return; }
        }
        const ev = await getState(stateKey);
        setEnvio((ev || []).find(e => envioMatches(e, target)) || null);
      } catch { setEnvio(null); }
      setLoading(false);
    })();
  }, [stateKey, target]);

  // Arquivo da NF: pelo token (servidor confere que a nota é deste envio); legado como fallback
  const baixarArquivo = async (id) => {
    if (ehToken) { try { const d = await publicoNFFile(target, id); if (d) return d; } catch {} }
    return getNFFile(id);
  };

  const confirmarPagamento = async () => {
    setPaying(true);
    try {
      if (ehToken) {
        // Servidor altera só este envio (e guarda a versão anterior em <chave>::backup::publico)
        const r = await publicoEnvioMarcarPago(target, (payerName||"").trim() || null);
        if (!r?.envio) throw new Error("envio não encontrado");
        setEnvio(r.envio); setShowConfirm(false); setPayerName(""); setPaying(false);
        return;
      }
      const todosEnvios = (await getState(stateKey)) || [];
      const hoje = new Date();
      const dataHoje = hoje.toLocaleDateString("pt-BR");
      const agora = hoje.toISOString();
      const nome = (payerName||"").trim() || null;
      const marcarPaga = n => ({...n, statusNota:"Pago", statusAlteradoEm: agora, statusAlteradoPor: nome});
      const atualizado = todosEnvios.map(e => envioMatches(e, target)
        ? {
            ...e,
            pago:true,
            pagoEm:agora,
            pagoPor:nome,
            dataPagamentoEfetiva:dataHoje,
            notasResumo: (e.notasResumo||[]).map(marcarPaga),
            mensaisResumo: (e.mensaisResumo||[]).map(marcarPaga),
            livemodeResumo: (e.livemodeResumo||[]).map(marcarPaga),
          }
        : e
      );
      await setState(stateKey, atualizado);
      setEnvio(atualizado.find(e => envioMatches(e, target)) || null);
      setShowConfirm(false);
      setPayerName("");
    } catch (e) {
      alert("Erro ao confirmar pagamento: " + e.message);
    }
    setPaying(false);
  };

  const downloadNF = async (id, filename) => {
    const data = await baixarArquivo(id);
    if (!data) { alert("Arquivo não encontrado"); return; }
    const a = document.createElement("a"); a.href = data; a.download = filename; a.click();
  };

  const downloadAll = async (ev) => {
    setDownloadingAll(true);
    const arquivos = [
      ...(ev.notasResumo||[]).filter(n=>n.hasFile).map(n=>({id:n.id, nome: n.codigo || `NF_${n.fornecedor}`})),
      ...(ev.mensaisResumo||[]).filter(n=>n.hasFile).map(n=>({id:n.id, nome: `NF_${n.fornecedor}_${n.mesLabel||n.mes}`})),
      ...(ev.livemodeResumo||[]).filter(n=>n.hasFile).map(n=>({id:n.id, nome: `NF_LM_${n.fornecedor}`})),
    ];

    const files = {};
    const usedNames = {};
    for (const arq of arquivos) {
      const data = await baixarArquivo(arq.id);
      if (!data) continue;
      const commaIdx = data.indexOf(',');
      const ext = data.slice(0, commaIdx).match(/\/([^;]+)/)?.[1] || 'pdf';
      const binary = atob(data.slice(commaIdx + 1));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const base = arq.nome.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60);
      const count = (usedNames[base] = (usedNames[base] || 0) + 1);
      files[count > 1 ? `${base}_${count}.${ext}` : `${base}.${ext}`] = [bytes, { level: 0 }];
    }

    if (!Object.keys(files).length) {
      alert('Nenhum arquivo com anexo encontrado');
      setDownloadingAll(false);
      return;
    }

    zip(files, (err, data) => {
      setDownloadingAll(false);
      if (err) { alert('Erro ao gerar ZIP'); return; }
      const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `NFs_Envio${ev.numero ? '_' + ev.numero : ''}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };

  // Toda alteração de status de NF pede o nome de quem alterou e registra
  // quando -- sem isso não tinha como saber se um atraso no pagamento veio de
  // alguém não ter olhado o envio ou de uma alteração que ninguém rastreou.
  const requestStatusChange = (notaId, tipo, novoStatus, statusAtual) => {
    if (novoStatus === statusAtual) return;
    setStatusChange({ notaId, tipo, novoStatus, statusAtual });
    setStatusChangeName("");
  };

  const confirmStatusChange = async () => {
    const nome = statusChangeName.trim();
    if (!statusChange || !nome) return;
    setSavingStatus(true);
    try {
      const { notaId, tipo, novoStatus } = statusChange;
      const campo = tipo === "jogo" ? "notasResumo" : tipo === "mensal" ? "mensaisResumo" : "livemodeResumo";
      if (ehToken) {
        const r = await publicoEnvioStatusNota(target, campo, notaId, novoStatus, nome);
        if (!r?.envio) throw new Error("envio não encontrado");
        setEnvio(r.envio); setStatusChange(null); setStatusChangeName(""); setSavingStatus(false);
        return;
      }
      const todosEnvios = (await getState(stateKey)) || [];
      const agora = new Date().toISOString();
      const atualizado = todosEnvios.map(e => !envioMatches(e, target) ? e : {
        ...e,
        [campo]: (e[campo]||[]).map(n => n.id === notaId ? {...n, statusNota: novoStatus, statusAlteradoEm: agora, statusAlteradoPor: nome} : n),
      });
      await setState(stateKey, atualizado);
      setEnvio(atualizado.find(e => envioMatches(e, target)) || null);
      setStatusChange(null);
      setStatusChangeName("");
    } catch (err) {
      alert("Erro ao atualizar status: " + err.message);
    }
    setSavingStatus(false);
  };

  if (loading) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Poppins',sans-serif"}}>
      <p style={{color:T.textMd,fontSize:16}}>Carregando...</p>
    </div>
  );

  if (!envio) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Poppins',sans-serif"}}>
      <p style={{color:T.textMd,fontSize:16}}>Envio não encontrado</p>
    </div>
  );

  const metricas = getEnvioMetricas(envio, { dedupeNotasPorNF });
  const qtdNotasJogos = countNotasFiscais(envio.notasResumo || [], { dedupe: dedupeNotasPorNF });
  const thS = { padding:"12px 14px", textAlign:"left", fontSize:10, color:T.textSm, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" };
  const tdS = { padding:"12px 14px", fontSize:12, borderBottom:`1px solid ${T.border}`, color:T.text };

  return (
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Poppins',sans-serif",color:T.text}}>
      <style>{`@media print { .no-print{display:none!important} body{margin:0} @page{margin:12mm} } .num { font-family:'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }`}</style>

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#047857 0%,#059669 60%,#10b981 100%)",padding:"32px 24px",color:"#fff",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-60,right:-60,width:240,height:240,borderRadius:"50%",background:"radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 60%)",pointerEvents:"none"}}/>
        <div style={{maxWidth:960,margin:"0 auto",position:"relative"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                <div style={{width:42,height:42,borderRadius:12,background:"rgba(255,255,255,0.18)",border:"1px solid rgba(255,255,255,0.25)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <Radio size={20} strokeWidth={2.25}/>
                </div>
                <p style={{fontSize:10,letterSpacing:"0.18em",textTransform:"uppercase",margin:0,color:"#bbf7d0",fontWeight:700}}>Livemode · Transmissões · Brasileirão 2026</p>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <h1 className="num" style={{fontSize:30,fontWeight:800,margin:0,letterSpacing:"-0.025em"}}>{envio.nome || `Envio ${envio.numero}`}</h1>
                <span style={{display:"inline-flex",alignItems:"center",gap:6,background:envio.pago?"rgba(34,197,94,0.25)":"rgba(239,68,68,0.25)",color:"#fff",border:`1px solid ${envio.pago?"#86efac":"#fca5a5"}`,borderRadius:999,padding:"5px 14px",fontSize:11,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase"}}>
                  {envio.pago ? <CheckCircle2 size={13} strokeWidth={2.5}/> : <Clock size={13} strokeWidth={2.5}/>}
                  {envio.pago?"Pago":"Aguardando"}
                </span>
              </div>
              <p style={{fontSize:13,margin:"8px 0 0",color:"#bbf7d0"}}>
                <span className="num">{new Date(envio.criadoEm).toLocaleDateString("pt-BR")}</span> · {metricas.qtdNotas} nota{metricas.qtdNotas!==1?"s":""}
              </p>
              {envio.dataPagamento && <p style={{fontSize:12,margin:"4px 0 0",color:"#86efac",fontWeight:600}}>Pagamento previsto: <span className="num">{envio.dataPagamento}</span></p>}
              {envio.pago && (envio.dataPagamentoEfetiva || envio.pagoPor) && (
                <p style={{fontSize:12,margin:"4px 0 0",color:"#86efac",fontWeight:600}}>
                  Pago{envio.dataPagamentoEfetiva?<> em <span className="num">{envio.dataPagamentoEfetiva}</span></>:""}{envio.pagoEm?<> às <span className="num">{new Date(envio.pagoEm).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span></>:""}{envio.pagoPor?` por ${envio.pagoPor}`:""}
                </p>
              )}
              {envio.obs && <p style={{fontSize:12,margin:"6px 0 0",color:"#bbf7d0",fontStyle:"italic"}}>{envio.obs}</p>}
              {!envio.pago && (
                <button onClick={()=>setShowConfirm(true)} className="no-print" style={{marginTop:14,background:"#fff",color:"#047857",border:"none",borderRadius:10,padding:"10px 22px",cursor:"pointer",fontWeight:700,fontSize:13,boxShadow:"0 4px 14px rgba(0,0,0,0.2)",display:"inline-flex",alignItems:"center",gap:8}}>
                  <CheckCircle2 size={15} strokeWidth={2.5}/>
                  Confirmar Pagamento
                </button>
              )}
            </div>
            <div style={{textAlign:"right"}}>
              <p className="num" style={{fontSize:34,fontWeight:800,color:"#fff",margin:0,letterSpacing:"-0.025em"}}>{fmt(metricas.totalGeral)}</p>
              <p style={{fontSize:11,color:"#bbf7d0",margin:"4px 0 0",letterSpacing:"0.04em",textTransform:"uppercase",fontWeight:600}}>Valor total do envio</p>
            </div>
          </div>
        </div>
      </div>

      <div style={{maxWidth:960,margin:"0 auto",padding:"20px 24px 0",display:"flex",justifyContent:"flex-end",gap:10,flexWrap:"wrap"}} className="no-print">
        {(() => {
          const total = [...(envio.notasResumo||[]),...(envio.mensaisResumo||[]),...(envio.livemodeResumo||[])].filter(n=>n.hasFile).length;
          return total > 0 ? (
            <button onClick={()=>downloadAll(envio)} disabled={downloadingAll} style={{background:T.info,color:"#fff",border:"none",borderRadius:10,padding:"10px 20px",cursor:downloadingAll?"default":"pointer",fontWeight:600,fontSize:13,display:"inline-flex",alignItems:"center",gap:8,boxShadow:"0 1px 3px rgba(15,23,42,0.12)",opacity:downloadingAll?0.7:1}}>
              <Download size={15} strokeWidth={2.25}/>
              {downloadingAll ? "Baixando..." : `Baixar todas (${total})`}
            </button>
          ) : null;
        })()}
        <button onClick={() => window.print()} style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 20px",cursor:"pointer",fontWeight:600,fontSize:13,display:"inline-flex",alignItems:"center",gap:8,boxShadow:"0 1px 3px rgba(15,23,42,0.06)"}}>
          <Printer size={15} strokeWidth={2.25}/>
          Imprimir / Salvar PDF
        </button>
      </div>

      <div style={{maxWidth:960,margin:"0 auto",padding:"20px 24px 48px"}}>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14,marginBottom:28}}>
          {metricas.totalJogos > 0 && (
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"18px 20px",position:"relative",overflow:"hidden",boxShadow:"0 4px 16px -8px rgba(15,23,42,0.15)"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:T.brand,boxShadow:`0 0 18px ${T.brand}88`}}/>
              <p style={{fontSize:10,color:T.textSm,margin:"4px 0 8px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>NFs de Jogos</p>
              <p className="num" style={{fontSize:24,fontWeight:800,color:T.text,margin:0,letterSpacing:"-0.025em"}}>{fmt(metricas.totalJogos)}</p>
              <p style={{fontSize:11,color:T.textSm,margin:"4px 0 0"}}>{qtdNotasJogos} notas</p>
            </div>
          )}
          {metricas.totalMensais > 0 && (
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"18px 20px",position:"relative",overflow:"hidden",boxShadow:"0 4px 16px -8px rgba(15,23,42,0.15)"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:cyan,boxShadow:`0 0 18px ${cyan}88`}}/>
              <p style={{fontSize:10,color:T.textSm,margin:"4px 0 8px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>NFs Mensais</p>
              <p className="num" style={{fontSize:24,fontWeight:800,color:T.text,margin:0,letterSpacing:"-0.025em"}}>{fmt(metricas.totalMensais)}</p>
              <p style={{fontSize:11,color:T.textSm,margin:"4px 0 0"}}>{(envio.mensaisResumo||[]).length} notas</p>
            </div>
          )}
          {metricas.totalLivemode > 0 && (
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"18px 20px",position:"relative",overflow:"hidden",boxShadow:"0 4px 16px -8px rgba(15,23,42,0.15)"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"#14b8a6",boxShadow:"0 0 18px #14b8a688"}}/>
              <p style={{fontSize:10,color:T.textSm,margin:"4px 0 8px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>NFs Livemode</p>
              <p className="num" style={{fontSize:24,fontWeight:800,color:T.text,margin:0,letterSpacing:"-0.025em"}}>{fmt(metricas.totalLivemode)}</p>
              <p style={{fontSize:11,color:T.textSm,margin:"4px 0 0"}}>{(envio.livemodeResumo||[]).length} notas</p>
            </div>
          )}
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"18px 20px",position:"relative",overflow:"hidden",boxShadow:"0 4px 16px -8px rgba(15,23,42,0.15)"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:purple,boxShadow:`0 0 18px ${purple}88`}}/>
            <p style={{fontSize:10,color:T.textSm,margin:"4px 0 8px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Total do Envio</p>
            <p className="num" style={{fontSize:24,fontWeight:800,color:T.text,margin:0,letterSpacing:"-0.025em"}}>{fmt(metricas.totalGeral)}</p>
            <p style={{fontSize:11,color:T.textSm,margin:"4px 0 0"}}>{metricas.qtdNotas} notas</p>
          </div>
        </div>

        {(envio.notasResumo||[]).length > 0 && (<>
          <h2 style={{fontSize:14,fontWeight:700,margin:"0 0 14px",color:T.text,letterSpacing:"-0.01em",display:"flex",alignItems:"center",gap:10}}>
            <span style={{width:4,height:18,background:T.brand,borderRadius:2,boxShadow:`0 0 12px ${T.brand}88`}}/>
            Notas Fiscais — Jogos
          </h2>
          <div style={{background:T.card,borderRadius:14,overflow:"hidden",marginBottom:32,border:`1px solid ${T.border}`,boxShadow:"0 4px 16px -8px rgba(15,23,42,0.12)"}}>
            {(envio.notasResumo||[]).map(n => (
              <div key={n.id} style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
                <code className="num" style={{color:T.brand,fontSize:11,background:T.brandSoft,padding:"3px 7px",borderRadius:4,fontWeight:700}}>{n.codigo}</code>
                <span style={{fontSize:12,fontWeight:600,color:T.text,flex:"1 1 120px",minWidth:80}}>{n.fornecedor}</span>
                <span className="num" style={{fontSize:13,fontWeight:700,color:purple,minWidth:80}}>{fmt(n.valorNF)}</span>
                <span style={{fontSize:11,color:T.textSm,minWidth:60}}>NF {n.numeroNF||"—"}</span>
                <span style={{fontSize:11,color:T.textSm}}>{n.jogoLabel}</span>
                <span style={{fontSize:10,color:T.textSm,background:T.surfaceAlt,padding:"2px 8px",borderRadius:4}}>Rd {n.rodada}</span>
                {n.dataEmissao && <span style={{fontSize:10,color:T.textSm}}>Em: {n.dataEmissao}</span>}
                {n.adicionadaEm && <span style={{fontSize:10,color:T.textSm}} title="Quando a NF foi adicionada ao envio">adicionada {new Date(n.adicionadaEm).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</span>}
                <select value={n.statusNota||"Pendente"} onChange={e=>requestStatusChange(n.id,"jogo",e.target.value,n.statusNota||"Pendente")} className="no-print"
                  style={{background:STATUS_NOTA_COLOR[n.statusNota||"Pendente"]+"22",color:STATUS_NOTA_COLOR[n.statusNota||"Pendente"],border:`1px solid ${STATUS_NOTA_COLOR[n.statusNota||"Pendente"]}55`,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                  {STATUS_NOTA.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                {n.statusAlteradoEm && <span style={{fontSize:10,color:T.textSm}}>alterado {new Date(n.statusAlteradoEm).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}{n.statusAlteradoPor?` por ${n.statusAlteradoPor}`:""}</span>}
                {(n.servicosLabels||[]).length > 0 && <span style={{fontSize:10,color:T.textSm,flex:"1 1 100%"}}>{(n.servicosLabels||[]).join(", ")}</span>}
                {n.hasFile && <button onClick={() => downloadNF(n.id, n.codigo)} className="no-print" style={{background:T.info,color:"#fff",border:"none",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:600,display:"inline-flex",alignItems:"center",gap:5,marginLeft:"auto"}}><Download size={12} strokeWidth={2.5}/>Baixar</button>}
              </div>
            ))}
            <div style={{padding:"14px 18px",background:T.surfaceAlt,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",color:T.text}}>Total</span>
              <span className="num" style={{fontSize:14,fontWeight:700,color:purple}}>{fmt(metricas.totalJogos)}</span>
            </div>
          </div>
        </>)}

        {(envio.mensaisResumo||[]).length > 0 && (<>
          <h2 style={{fontSize:14,fontWeight:700,margin:"0 0 14px",color:T.text,letterSpacing:"-0.01em",display:"flex",alignItems:"center",gap:10}}>
            <span style={{width:4,height:18,background:cyan,borderRadius:2,boxShadow:`0 0 12px ${cyan}88`}}/>
            Notas Fiscais — Mensais
          </h2>
          <div style={{background:T.card,borderRadius:14,overflow:"hidden",marginBottom:32,border:`1px solid ${T.border}`,boxShadow:"0 4px 16px -8px rgba(15,23,42,0.12)"}}>
            {(envio.mensaisResumo||[]).map(n => (
              <div key={n.id} style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
                <span style={{fontSize:12,fontWeight:600,color:T.text,flex:"1 1 120px",minWidth:80}}>{n.fornecedor}</span>
                <span style={{background:cyan+"22",color:cyan,border:`1px solid ${cyan}55`,padding:"3px 10px",borderRadius:999,fontSize:11,fontWeight:700}}>{n.categoria}</span>
                <span style={{fontSize:11,color:T.textSm}}>{n.mesLabel}</span>
                <span className="num" style={{fontSize:13,fontWeight:700,color:purple,minWidth:80}}>{fmt(n.valor)}</span>
                <span style={{fontSize:11,color:T.textSm}}>NF {n.numeroNF||"—"}</span>
                {n.dataEmissao && <span style={{fontSize:10,color:T.textSm}}>Em: {n.dataEmissao}</span>}
                {n.adicionadaEm && <span style={{fontSize:10,color:T.textSm}} title="Quando a NF foi adicionada ao envio">adicionada {new Date(n.adicionadaEm).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</span>}
                <select value={n.statusNota||"Pendente"} onChange={e=>requestStatusChange(n.id,"mensal",e.target.value,n.statusNota||"Pendente")} className="no-print"
                  style={{background:STATUS_NOTA_COLOR[n.statusNota||"Pendente"]+"22",color:STATUS_NOTA_COLOR[n.statusNota||"Pendente"],border:`1px solid ${STATUS_NOTA_COLOR[n.statusNota||"Pendente"]}55`,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                  {STATUS_NOTA.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                {n.statusAlteradoEm && <span style={{fontSize:10,color:T.textSm}}>alterado {new Date(n.statusAlteradoEm).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}{n.statusAlteradoPor?` por ${n.statusAlteradoPor}`:""}</span>}
                {n.hasFile && <button onClick={() => downloadNF(n.id, `NF_${n.fornecedor}`)} className="no-print" style={{background:T.info,color:"#fff",border:"none",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:600,display:"inline-flex",alignItems:"center",gap:5,marginLeft:"auto"}}><Download size={12} strokeWidth={2.5}/>Baixar</button>}
              </div>
            ))}
            <div style={{padding:"14px 18px",background:T.surfaceAlt,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",color:T.text}}>Total</span>
              <span className="num" style={{fontSize:14,fontWeight:700,color:purple}}>{fmt(metricas.totalMensais)}</span>
            </div>
          </div>
        </>)}

        {(envio.livemodeResumo||[]).length > 0 && (<>
          <h2 style={{fontSize:14,fontWeight:700,margin:"0 0 14px",color:T.text,letterSpacing:"-0.01em",display:"flex",alignItems:"center",gap:10}}>
            <span style={{width:4,height:18,background:"#14b8a6",borderRadius:2,boxShadow:"0 0 12px #14b8a688"}}/>
            Notas Fiscais — Livemode
          </h2>
          <div style={{background:T.card,borderRadius:14,overflow:"hidden",marginBottom:32,border:`1px solid ${T.border}`,boxShadow:"0 4px 16px -8px rgba(15,23,42,0.12)"}}>
            {(envio.livemodeResumo||[]).map(n => (
              <div key={n.id} style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
                <span style={{fontSize:12,fontWeight:600,color:T.text,flex:"1 1 120px",minWidth:80}}>{n.fornecedor}</span>
                <span className="num" style={{fontSize:13,fontWeight:700,color:purple,minWidth:80}}>{fmt(n.valor)}</span>
                <span style={{fontSize:10,color:T.textSm,background:T.surfaceAlt,padding:"2px 8px",borderRadius:4}}>Rd {n.rodada}</span>
                <span style={{fontSize:11,color:T.textSm}}>NF {n.numeroNF||"—"}</span>
                {(n.servicosLabels||[]).length > 0 && <span style={{fontSize:10,color:T.textSm}}>{(n.servicosLabels||[]).join(", ")}</span>}
                {n.dataEmissao && <span style={{fontSize:10,color:T.textSm}}>Em: {n.dataEmissao}</span>}
                {n.adicionadaEm && <span style={{fontSize:10,color:T.textSm}} title="Quando a NF foi adicionada ao envio">adicionada {new Date(n.adicionadaEm).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</span>}
                <select value={n.statusNota||"Pendente"} onChange={e=>requestStatusChange(n.id,"livemode",e.target.value,n.statusNota||"Pendente")} className="no-print"
                  style={{background:STATUS_NOTA_COLOR[n.statusNota||"Pendente"]+"22",color:STATUS_NOTA_COLOR[n.statusNota||"Pendente"],border:`1px solid ${STATUS_NOTA_COLOR[n.statusNota||"Pendente"]}55`,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                  {STATUS_NOTA.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                {n.statusAlteradoEm && <span style={{fontSize:10,color:T.textSm}}>alterado {new Date(n.statusAlteradoEm).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}{n.statusAlteradoPor?` por ${n.statusAlteradoPor}`:""}</span>}
                {n.hasFile && <button onClick={() => downloadNF(n.id, `NF_LM_${n.fornecedor}`)} className="no-print" style={{background:T.info,color:"#fff",border:"none",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:600,display:"inline-flex",alignItems:"center",gap:5,marginLeft:"auto"}}><Download size={12} strokeWidth={2.5}/>Baixar</button>}
              </div>
            ))}
            <div style={{padding:"14px 18px",background:T.surfaceAlt,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",color:T.text}}>Total</span>
              <span className="num" style={{fontSize:14,fontWeight:700,color:purple}}>{fmt(metricas.totalLivemode)}</span>
            </div>
          </div>
        </>)}

        <div style={{marginTop:32,paddingTop:20,borderTop:`1px solid ${T.border}`,fontSize:11,color:T.textSm,textAlign:"center",letterSpacing:"0.04em"}}>
          Livemode · Transmissões · Brasileirão Série A 2026 · Envio {envio.numero} · <span className="num">{new Date(envio.criadoEm).toLocaleDateString("pt-BR")}</span>
        </div>
      </div>

      {showConfirm && (
        <div className="no-print" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(4px)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:T.card,borderRadius:18,padding:32,maxWidth:460,width:"100%",boxShadow:"0 30px 80px rgba(0,0,0,0.4)",border:`1px solid ${T.border}`}}>
            <div style={{width:48,height:48,borderRadius:14,background:T.brandSoft,border:`1px solid ${T.brandBorder}`,color:T.brand,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:16}}>
              <CheckCircle2 size={24} strokeWidth={2.25}/>
            </div>
            <h3 style={{margin:"0 0 8px",fontSize:20,color:T.text,fontWeight:800,letterSpacing:"-0.02em"}}>Confirmar Pagamento</h3>
            <p style={{margin:"0 0 6px",color:T.textMd,fontSize:13}}>
              Você está prestes a marcar o <b>{envio.nome || `Envio ${envio.numero}`}</b> como pago.
            </p>
            <p style={{margin:"0 0 22px",color:T.textMd,fontSize:13}}>
              Valor total: <b className="num" style={{color:T.brand,fontWeight:700}}>{fmt(metricas.totalGeral)}</b> · {metricas.qtdNotas} nota{metricas.qtdNotas!==1?"s":""}
            </p>
            <div style={{marginBottom:22}}>
              <label style={{display:"block",fontSize:10,color:T.textSm,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6,fontWeight:700}}>Seu nome</label>
              <input value={payerName} onChange={e=>setPayerName(e.target.value)} placeholder="Ex: Maria Silva"
                style={{width:"100%",boxSizing:"border-box",border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 14px",fontSize:13,color:T.text,background:T.bg,fontFamily:"'Poppins',sans-serif"}}/>
              <p style={{margin:"6px 0 0",fontSize:11,color:T.textSm}}>Obrigatório — registro de quem confirmou o pagamento, com data e horário.</p>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>{setShowConfirm(false);setPayerName("");}} disabled={paying}
                style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 18px",cursor:"pointer",fontWeight:600,fontSize:13,opacity:paying?0.5:1}}>
                Cancelar
              </button>
              <button onClick={confirmarPagamento} disabled={paying || !payerName.trim()}
                style={{background:(paying||!payerName.trim())?"#1f3d24":"linear-gradient(135deg,#047857,#059669)",color:"#fff",border:"none",borderRadius:10,padding:"10px 22px",cursor:(paying||!payerName.trim())?"default":"pointer",fontWeight:700,fontSize:13,display:"inline-flex",alignItems:"center",gap:8,boxShadow:"0 4px 14px rgba(5,150,105,0.35)",opacity:(paying||!payerName.trim())?0.6:1}}>
                <CheckCircle2 size={15} strokeWidth={2.5}/>
                {paying ? "Confirmando..." : "Confirmar"}
              </button>
            </div>
            <p style={{margin:"16px 0 0",fontSize:11,color:T.textSm,textAlign:"center"}}>
              Esta ação só pode ser revertida pela equipe administrativa.
            </p>
          </div>
        </div>
      )}

      {statusChange && (
        <div className="no-print" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(4px)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:T.card,borderRadius:18,padding:32,maxWidth:420,width:"100%",boxShadow:"0 30px 80px rgba(0,0,0,0.4)",border:`1px solid ${T.border}`}}>
            <h3 style={{margin:"0 0 8px",fontSize:18,color:T.text,fontWeight:800,letterSpacing:"-0.02em"}}>Confirmar alteração</h3>
            <p style={{margin:"0 0 22px",color:T.textMd,fontSize:13}}>
              Mudar status de <b>{statusChange.statusAtual}</b> para <b style={{color:STATUS_NOTA_COLOR[statusChange.novoStatus]}}>{statusChange.novoStatus}</b>.
            </p>
            <div style={{marginBottom:22}}>
              <label style={{display:"block",fontSize:10,color:T.textSm,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6,fontWeight:700}}>Seu nome</label>
              <input value={statusChangeName} onChange={e=>setStatusChangeName(e.target.value)} placeholder="Ex: Maria Silva" autoFocus
                style={{width:"100%",boxSizing:"border-box",border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 14px",fontSize:13,color:T.text,background:T.bg,fontFamily:"'Poppins',sans-serif"}}/>
              <p style={{margin:"6px 0 0",fontSize:11,color:T.textSm}}>Obrigatório — fica registrado com a data e o horário da alteração.</p>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>{setStatusChange(null);setStatusChangeName("");}} disabled={savingStatus}
                style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 18px",cursor:"pointer",fontWeight:600,fontSize:13,opacity:savingStatus?0.5:1}}>
                Cancelar
              </button>
              <button onClick={confirmStatusChange} disabled={savingStatus || !statusChangeName.trim()}
                style={{background:(savingStatus||!statusChangeName.trim())?"#1f3d24":"linear-gradient(135deg,#047857,#059669)",color:"#fff",border:"none",borderRadius:10,padding:"10px 22px",cursor:(savingStatus||!statusChangeName.trim())?"default":"pointer",fontWeight:700,fontSize:13,opacity:(savingStatus||!statusChangeName.trim())?0.6:1}}>
                {savingStatus ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
