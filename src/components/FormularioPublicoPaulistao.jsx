import { patchNumeroNF, avisoChaveDetectada } from "../lib/nfNumero";
import { useState, useRef, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { DateInput } from "./ui";
import { getState, appendState, fileToDataUrl, saveNFFilePublico, hashDataUrl, publicoJogos, publicoFornecedores } from "../lib/supabase";
import { nfDuplicadaServidor } from "../lib/dedupeNF";

// Mensagem quando o servidor acusa que esta NF já entrou antes (mesmo
// fornecedor + nº, em qualquer grafia, ou o mesmo arquivo anexado).
const MSG_DUPLICADA = (numeroNF) =>
  `⚠️ Esta nota fiscal (nº ${numeroNF}) já foi enviada anteriormente.\n\n` +
  `Para evitar pagamento em duplicidade, o envio foi bloqueado.\n` +
  `Se você acredita que é um engano, fale com a equipe Livemode.`;

const DARK_T = {
  bg:"#060912", card:"#0f1623", border:"#1e293b", muted:"#334155",
  text:"#f8fafc", textMd:"#cbd5e1", textSm:"#94a3b8",
  surface:"#0f1623", surfaceAlt:"#0a0f1a",
  brand:"#65B32E", brandSoft:"rgba(101,179,46,0.14)", brandBorder:"rgba(101,179,46,0.32)",
};
const LIGHT_T = {
  bg:"#F2F3F5", card:"#FFFFFF", border:"rgba(0,0,0,0.08)", muted:"#E5E7EB",
  text:"#1A1A1A", textMd:"#6B7280", textSm:"#9CA3AF",
  surface:"#FFFFFF", surfaceAlt:"#F8F9FA",
  brand:"#65B32E", brandSoft:"rgba(101,179,46,0.10)", brandBorder:"rgba(101,179,46,0.30)",
};
const BRAND = "#65B32E";
const btnS = { color:"#fff", border:"none", borderRadius:10, padding:"13px 20px", cursor:"pointer", fontWeight:700, fontSize:14, width:"100%", letterSpacing:"-0.005em" };
const getIS = T => ({ background:T.surfaceAlt, border:`1px solid ${T.border}`, borderRadius:10, color:T.text, padding:"12px 14px", fontSize:14, width:"100%", boxSizing:"border-box", MozAppearance:"textfield", fontFamily:"'Poppins',sans-serif" });
const fmt = v => (v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:2});
// Valor digitado livre com centavos: aceita "1234,56", "1.234,56" e "1234.56"
// (vírgula é o separador decimal padrão BR; com vírgula presente, pontos são milhar).
const parseValorBR = v => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^\d.,]/g, "");
  if (!s) return 0;
  const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return parseFloat(norm) || 0;
};
const soDigitosValor = v => String(v ?? "").replace(/[^0-9.,]/g, "");
const HIDE_SPINNERS = `input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}`;

// ── Serviços por jogo ──────────────────────────────────────────────────────────
const SERVICOS_JOGO = [
  { catLabel:"Operações", catColor:"#D97706", subKey:"um_b3",      subLabel:"UM B3" },
  { catLabel:"Pessoal",   catColor:"#2563EB", subKey:"coord_um",   subLabel:"Coordenador de UM" },
  { catLabel:"Pessoal",   catColor:"#2563EB", subKey:"prod_um",    subLabel:"Produtor de UM" },
  { catLabel:"Pessoal",   catColor:"#2563EB", subKey:"prod_campo", subLabel:"Produtor de Campo" },
  { catLabel:"Pessoal",   catColor:"#2563EB", subKey:"supervisor1",subLabel:"Supervisor 1" },
  { catLabel:"Operações", catColor:"#D97706", subKey:"geradores",  subLabel:"Geradores" },
  { catLabel:"Operações", catColor:"#D97706", subKey:"sng",        subLabel:"SNG" },
  // Cai no bucket "Outros Logística" do realizado (mesmo destino da NF de
  // reembolso consolidada — alias reembolso_log→outros_log em notasFiscais.js)
  { catLabel:"Logística", catColor:"#16A34A", subKey:"outros_log", subLabel:"Logística" },
];

// ── Serviços mensais (IDs espelham o orçamento ATUAL do Paulistão no banco —
//    itens recriados ganham id novo; se divergir de novo, a religação por nome
//    no load do Paulistao.jsx (religarMensaisOrfas) recupera a NF) ─────────────
const SERVICOS_MENSAIS = [
  { id:1,             nome:"Coordenador de Sinal Internacional", secao:"Pessoal",                 color:"#2563EB" },
  { id:2,             nome:"Editor de Vídeos",                   secao:"Pessoal",                 color:"#2563EB" },
  { id:1777401124620, nome:"Editor de Vídeos 2",                 secao:"Pessoal",                 color:"#2563EB" },
  { id:1777401138162, nome:"Suporte Operacional Vmix",           secao:"Pessoal",                 color:"#2563EB" },
  { id:7,             nome:"Estatísticas",                       secao:"Serviços Complementares", color:"#D97706" },
  { id:1777401168030, nome:"Ingest/Edição (WSC)",                secao:"Serviços Complementares", color:"#D97706" },
];

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const STEPS_JOGO    = ["Fase/Rodada","Jogos","Serviços","Valores","Nota Fiscal"];
const STEPS_MENSAL  = ["Mês","Serviço","Valores","Nota Fiscal"];

function FornecedorInput({ value, onChange, fornecedores, T }) {
  const [open, setOpen] = useState(false);
  const IS = getIS(T);
  const q = value.toLowerCase();
  const filtered = q.length > 0
    ? fornecedores.filter(f => f.apelido.toLowerCase().includes(q) || f.razaoSocial.toLowerCase().includes(q) || f.funcao?.toLowerCase().includes(q)).slice(0,6) : [];
  return (
    <div style={{position:"relative"}}>
      <input value={value} onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Digite seu nome ou empresa..." style={IS}/>
      {open && filtered.length > 0 && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:T.card,border:`1px solid ${T.border}`,borderRadius:10,marginTop:4,maxHeight:240,overflowY:"auto",boxShadow:"0 12px 32px rgba(0,0,0,0.3)"}}>
          {filtered.map(f => (
            <div key={f.id} onMouseDown={() => { onChange(f.apelido); setOpen(false); }}
              style={{padding:"12px 16px",cursor:"pointer",borderBottom:`1px solid ${T.border}`}}
              onMouseEnter={e => e.currentTarget.style.background = T.bg}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{fontSize:14,fontWeight:600,color:T.text}}>{f.apelido}</div>
              <div style={{fontSize:12,color:T.textSm,marginTop:2}}>{f.funcao}{f.razaoSocial ? ` · ${f.razaoSocial.slice(0,35)}${f.razaoSocial.length>35?"...":""}` : ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Só PDF: um fornecedor mandou a NF em .xlsx (Contra Ataque, 09/2026) e o
// arquivo não abria no visualizador do Hub. O accept do input é só dica —
// o navegador deixa escolher "todos os arquivos" — então valida de verdade.
const MAX_NF_MB = 10;
const validarArquivoNF = (f) => {
  if (!f) return null;
  const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
  if (!isPdf) return "Só aceitamos a nota em PDF. Planilhas, fotos e outros formatos não são aceitos.";
  if (f.size > MAX_NF_MB * 1024 * 1024) return `Arquivo muito grande (máx. ${MAX_NF_MB}MB).`;
  return null;
};

function NFDataStep({ nfData, setNfData, arquivo, setArquivo, fileRef, fornecedores, resumo, T }) {
  const [erroArquivo, setErroArquivo] = useState(null);
  const escolherArquivo = (f) => {
    const erro = validarArquivoNF(f);
    setErroArquivo(erro);
    setArquivo(erro ? null : (f || null));
    if (erro && fileRef.current) fileRef.current.value = "";
  };
  const IS = getIS(T);
  return (
    <div>
      <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Dados da Nota Fiscal</h3>
      <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Preencha os dados e anexe o arquivo</p>
      <div style={{marginBottom:14}}>
        <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Fornecedor / Razão Social</label>
        <FornecedorInput value={nfData.fornecedor} onChange={v => setNfData(d => ({...d, fornecedor:v}))} fornecedores={fornecedores} T={T}/>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Nº da Nota Fiscal <span style={{color:"#ef4444"}}>*</span></label>
        {/* Colou a chave de acesso da NFS-e (50 dígitos)? Extrai o número real e guarda a chave. */}
        <input value={nfData.numeroNF} onChange={e => setNfData(d => ({...d, ...patchNumeroNF(e.target.value)}))} placeholder="obrigatório" style={IS}/>
        {!nfData.numeroNF.trim() && <p style={{color:"#ef4444",fontSize:11,margin:"4px 0 0"}}>Informe o número da nota fiscal para enviar</p>}
        {nfData.chaveAcesso && <p style={{color:"#059669",fontSize:11,margin:"4px 0 0"}}>{avisoChaveDetectada(nfData.chaveAcesso, nfData.numeroNF)}</p>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        <div>
          <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Data de Emissão</label>
          <DateInput value={nfData.dataEmissao} onChange={v => setNfData(d => ({...d, dataEmissao:v}))} style={IS}/>
        </div>
        <div>
          <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Data de Envio</label>
          <DateInput value={nfData.dataEnvio} onChange={v => setNfData(d => ({...d, dataEnvio:v}))} style={IS}/>
        </div>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Observações (opcional)</label>
        <input value={nfData.obs} onChange={e => setNfData(d => ({...d, obs:e.target.value}))} style={IS}/>
      </div>
      <div style={{marginBottom:16}}>
        <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Arquivo da NF (obrigatório)</label>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={e => escolherArquivo(e.target.files[0]||null)} style={{display:"none"}}/>
        <div onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {e.preventDefault(); escolherArquivo(e.dataTransfer.files[0]||null);}}
          style={{border:`2px dashed ${arquivo?BRAND:(erroArquivo?"#ef4444":T.muted)}`,borderRadius:10,padding:"20px 16px",cursor:"pointer",textAlign:"center",background:arquivo?"#22c55e11":(erroArquivo?"#ef444411":T.bg)}}>
          {arquivo
            ? <p style={{margin:0,color:BRAND,fontSize:14,fontWeight:600}}>{arquivo.name}<br/><span style={{fontSize:12,fontWeight:400}}>({(arquivo.size/1024).toFixed(0)} KB)</span></p>
            : <p style={{margin:0,color:T.textSm,fontSize:13}}>Toque para selecionar ou arraste o arquivo<br/><span style={{fontSize:11}}>Somente PDF (máx. {MAX_NF_MB}MB)</span></p>}
        </div>
        {erroArquivo && <p style={{margin:"6px 0 0",color:"#ef4444",fontSize:12,fontWeight:600}}>{erroArquivo}</p>}
      </div>
      {resumo}
    </div>
  );
}

// ── Formulário por JOGO ────────────────────────────────────────────────────────
function FormJogo({ divulgados, fornecedores, onDone, T }) {
  const IS = getIS(T);
  const [step, setStep] = useState(0);
  const [rodadaSel, setRodadaSel] = useState(null);
  const [qtdJogos, setQtdJogos] = useState(1);
  const [jogosSel, setJogosSel] = useState([]);
  const [servicosSel, setServicosSel] = useState({});
  const [valores, setValores] = useState({});
  const [nfData, setNfData] = useState({ fornecedor:"", numeroNF:"", dataEmissao:"", dataEnvio:"", obs:"" });
  const [arquivo, setArquivo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);
  // Identificador estável deste preenchimento: retry após falha não duplica a
  // submissão (checamos no servidor se este clientRef já chegou antes de gravar).
  const clientRef = useRef("cr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9)).current;

  const rodadas = Array.from(
    new Map(divulgados.map(j => [`${j.fase}__${j.rodada}`, { fase: j.fase, rodada: j.rodada }])).values()
  ).sort((a, b) => a.rodada - b.rodada);

  const jogosRodada = rodadaSel
    ? divulgados.filter(j => j.fase === rodadaSel.fase && j.rodada === rodadaSel.rodada)
    : [];

  const totalGeral = Object.values(valores).reduce((s, v) => s + parseValorBR(v), 0);

  const canNext = () => {
    if (step === 0) return rodadaSel != null;
    if (step === 1) return jogosSel.length === qtdJogos;
    if (step === 2) return Object.values(servicosSel).some(a => a.length > 0);
    if (step === 3) return Object.values(valores).some(v => parseValorBR(v) > 0);
    if (step === 4) return nfData.fornecedor.length > 0 && nfData.numeroNF.trim().length > 0 && !!arquivo; // PDF obrigatório (regra do financeiro)
    return false;
  };

  const toggleJogo = id => setJogosSel(prev => {
    if (prev.includes(id)) return prev.filter(x => x !== id);
    if (prev.length >= qtdJogos) return [...prev.slice(1), id];
    return [...prev, id];
  });

  const toggleServico = (jogoId, subKey) => setServicosSel(prev => {
    const arr = prev[jogoId] || [];
    return {...prev, [jogoId]: arr.includes(subKey) ? arr.filter(k => k !== subKey) : [...arr, subKey]};
  });

  // Guarda o texto cru enquanto digita (senão o separador decimal some a cada tecla)
  const setValor = (key, val) => setValores(prev => ({...prev, [key]: soDigitosValor(val)}));

  const handleSubmit = async () => {
    // Janela FPF: cobre a página deixada aberta de um dia pro outro
    if (new Date().getDate() > 20) { alert("A FPF só aceita notas até o dia 20 do mês. O formulário reabre no dia 1º do mês seguinte."); return; }
    setSubmitting(true);
    try {
      const submissionId = Date.now();
      const servicosDetalhe = {};
      const servicosValores = {};
      const servicosKeys = [];
      const servicosLabels = new Set();
      const jogosResumo = [];
      let hasFile = false;

      // Trava de duplicata ANTES de gravar (mesma do Brasileirão — ver
      // FormularioPublico.jsx e a migration 20260821000000).
      const dataUrlNF = arquivo ? await fileToDataUrl(arquivo).catch(() => null) : null;
      const fileHash = dataUrlNF ? await hashDataUrl(dataUrlNF) : null;
      const dup = await nfDuplicadaServidor('paulistao', { ...nfData, fileHash });
      if (dup?.dup) { alert(MSG_DUPLICADA(nfData.numeroNF)); setSubmitting(false); return; }

      if (dataUrlNF) {
        await saveNFFilePublico(submissionId, dataUrlNF); hasFile = true; // falha aborta o envio (catch externo avisa)
      }

      for (const jogoId of jogosSel) {
        const jogo = divulgados.find(j => j.id === jogoId);
        if (!jogo) continue;
        const subs = servicosSel[jogoId] || [];
        if (subs.length === 0) continue;
        jogosResumo.push(jogo);
        subs.forEach(sk => {
          const key = `${jogo.id}_${sk}`;
          const v = parseValorBR(valores[key]);
          servicosDetalhe[key] = v;
          servicosValores[sk] = (servicosValores[sk] || 0) + v;
          servicosKeys.push(key);
          const servico = SERVICOS_JOGO.find(s => s.subKey === sk);
          if (servico) servicosLabels.add(servico.subLabel);
        });
      }
      const valorNF = Object.values(servicosDetalhe).reduce((s, v) => s + (v || 0), 0);
      const firstJogo = jogosResumo[0];
      const submission = {
        id: submissionId, clientRef, tipo:"jogo", ...nfData, ...(fileHash ? { fileHash } : {}), valorNF, valorFiscalTotal: valorNF,
        fase: firstJogo?.fase, rodada: firstJogo?.rodada, jogoId: firstJogo?.id,
        jogoIds: jogosResumo.map(j => j.id),
        jogoLabel: jogosResumo.map(j => `${j.mandante} x ${j.visitante}`).join(" + "),
        mandante: firstJogo?.mandante, visitante: firstJogo?.visitante,
        servicosKeys,
        servicosLabels: [...servicosLabels],
        servicosValores,
        servicosDetalhe,
        status:"pendente", hasFile, enviadoEm: new Date().toISOString(),
      };
      // Append atômico no servidor: envios simultâneos de outros fornecedores
      // não se sobrescrevem, e reenvio deste form (mesmo clientRef) não duplica.
      await appendState('paulistao_nf_submissions', submission);
      onDone();
    } catch (err) {
      alert("Erro ao enviar a NF, tente novamente: " + err.message);
    }
    setSubmitting(false);
  };

  const STEPS = STEPS_JOGO;
  const byCat = {};
  SERVICOS_JOGO.forEach(s => { if (!byCat[s.catLabel]) byCat[s.catLabel] = {color:s.catColor,items:[]}; byCat[s.catLabel].items.push(s); });

  return (
    <>
      {/* Progress */}
      <div style={{display:"flex",gap:6,marginBottom:24}}>
        {STEPS.map((s, i) => (
          <div key={s} style={{flex:1,textAlign:"center"}}>
            <div style={{height:4,borderRadius:2,background:i<=step?BRAND:T.border,marginBottom:6,boxShadow:i<=step?`0 0 12px ${BRAND}aa`:"none"}}/>
            <span style={{fontSize:10,color:i<=step?BRAND:T.textSm,fontWeight:i===step?700:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>{s}</span>
          </div>
        ))}
      </div>

      <div style={{background:T.card,borderRadius:16,padding:"24px 20px",minHeight:200}}>

        {step === 0 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Qual a fase/rodada?</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Selecione a rodada referente à nota fiscal</p>
            <select
              value={rodadaSel ? `${rodadaSel.fase}__${rodadaSel.rodada}` : ""}
              onChange={e => {
                if (!e.target.value) { setRodadaSel(null); return; }
                const [fase, rodada] = e.target.value.split("__");
                setRodadaSel({ fase, rodada: parseInt(rodada) });
              }}
              style={{...IS,fontSize:16,fontWeight:600,padding:"14px",color:rodadaSel?T.text:T.textSm}}>
              <option value="" disabled>Selecione a rodada...</option>
              {rodadas.map(r => (
                <option key={`${r.fase}__${r.rodada}`} value={`${r.fase}__${r.rodada}`}>
                  {r.fase} — Rodada {r.rodada}
                </option>
              ))}
            </select>
          </div>
        )}

        {step === 1 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Quantos jogos?</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Essa NF cobre quantos jogos?</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:20}}>
              {[1,2,3,4].map(n => (
                <button key={n} onClick={() => { setQtdJogos(n); setJogosSel([]); }}
                  style={{padding:"14px",borderRadius:10,border:`2px solid ${qtdJogos===n?BRAND:T.border}`,cursor:"pointer",fontSize:15,fontWeight:700,
                    background:qtdJogos===n?T.brandSoft:T.bg,color:qtdJogos===n?BRAND:T.textMd,textAlign:"center"}}>
                  {n} jogo{n>1?"s":""}
                </button>
              ))}
            </div>
            <p style={{color:T.textMd,fontSize:12,margin:"0 0 10px",fontWeight:600}}>Selecione o{qtdJogos>1?"s":""} jogo{qtdJogos>1?"s":""}:</p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {jogosRodada.map(j => {
                const sel = jogosSel.includes(j.id);
                return (
                  <button key={j.id} onClick={() => toggleJogo(j.id)}
                    style={{padding:"14px 16px",borderRadius:12,border:`2px solid ${sel?BRAND:T.border}`,cursor:"pointer",
                      background:sel?T.brandSoft:T.bg,textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:14,color:T.text}}>{j.mandante} x {j.visitante}</div>
                      <div style={{color:T.textSm,fontSize:12,marginTop:2}}>{j.data}{j.cidade ? ` · ${j.cidade}` : ""}</div>
                    </div>
                    {j.grupo && <span style={{fontSize:11,fontWeight:700,color:BRAND,background:T.brandSoft,padding:"3px 8px",borderRadius:6}}>{j.grupo}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Serviços prestados</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Selecione os serviços que você realizou</p>
            {jogosSel.map(jogoId => {
              const jogo = divulgados.find(j => j.id === jogoId);
              if (!jogo) return null;
              const selected = servicosSel[jogoId] || [];
              return (
                <div key={jogoId} style={{marginBottom:20}}>
                  {jogosSel.length > 1 && <div style={{marginBottom:12}}><span style={{fontWeight:700,fontSize:14,color:T.text}}>{jogo.mandante} x {jogo.visitante}</span></div>}
                  {Object.entries(byCat).map(([catName, {color, items}]) => (
                    <div key={catName} style={{marginBottom:12}}>
                      <p style={{color,fontSize:12,fontWeight:700,margin:"0 0 8px"}}>{catName}</p>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                        {items.map(s => {
                          const sel = selected.includes(s.subKey);
                          return (
                            <button key={s.subKey} onClick={() => toggleServico(jogoId, s.subKey)}
                              style={{padding:"10px 12px",borderRadius:8,border:`2px solid ${sel?color:T.border}`,cursor:"pointer",fontSize:13,fontWeight:sel?700:400,
                                background:sel?color+"22":"transparent",color:sel?color:T.textMd,textAlign:"center"}}>
                              {s.subLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {step === 3 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Valores</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Informe o valor de cada serviço</p>
            {jogosSel.map(jogoId => {
              const jogo = divulgados.find(j => j.id === jogoId);
              if (!jogo) return null;
              const subs = servicosSel[jogoId] || [];
              return (
                <div key={jogoId} style={{marginBottom:20}}>
                  {jogosSel.length > 1 && <div style={{marginBottom:12}}><span style={{fontWeight:700,fontSize:13,color:T.text}}>{jogo.mandante} x {jogo.visitante}</span></div>}
                  {subs.map(sk => {
                    const s = SERVICOS_JOGO.find(x => x.subKey === sk);
                    if (!s) return null;
                    const key = `${jogoId}_${sk}`;
                    return (
                      <div key={sk} style={{marginBottom:10}}>
                        <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>{s.subLabel}</label>
                        <div style={{display:"flex",alignItems:"center"}}>
                          <span style={{background:T.muted,color:T.text,padding:"12px 12px",borderRadius:"8px 0 0 8px",fontSize:14,fontWeight:600}}>R$</span>
                          <input type="text" inputMode="decimal" value={valores[key] || ""} onChange={e => setValor(key, e.target.value)}
                            placeholder="0,00" style={{...IS,borderRadius:"0 8px 8px 0",borderLeft:"none",fontWeight:600,color:BRAND,fontSize:16}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div style={{background:T.bg,borderRadius:10,padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:T.textMd,fontWeight:600,fontSize:14}}>Total</span>
              <span style={{fontSize:20,fontWeight:700,color:BRAND}}>{fmt(totalGeral)}</span>
            </div>
          </div>
        )}

        {step === 4 && (
          <NFDataStep nfData={nfData} setNfData={setNfData} arquivo={arquivo} setArquivo={setArquivo} fileRef={fileRef} fornecedores={fornecedores} T={T}
            resumo={
              <div style={{background:T.bg,borderRadius:10,padding:"14px 16px"}}>
                <p style={{color:T.textMd,fontSize:11,fontWeight:600,margin:"0 0 8px"}}>Resumo</p>
                {jogosSel.map(jogoId => {
                  const jogo = divulgados.find(j => j.id === jogoId);
                  if (!jogo) return null;
                  const subs = servicosSel[jogoId] || [];
                  const total = subs.reduce((s, sk) => s + parseValorBR(valores[`${jogoId}_${sk}`]), 0);
                  return (
                    <div key={jogoId} style={{marginBottom:8}}>
                      <div style={{fontWeight:600,fontSize:13,color:T.text}}>{jogo.mandante} x {jogo.visitante}</div>
                      <div style={{fontSize:11,color:T.textSm,margin:"2px 0"}}>{subs.map(sk => SERVICOS_JOGO.find(x => x.subKey === sk)?.subLabel).filter(Boolean).join(", ")}</div>
                      <div style={{fontSize:13,color:BRAND,fontWeight:700}}>{fmt(total)}</div>
                    </div>
                  );
                })}
                <div style={{borderTop:`1px solid ${T.border}`,marginTop:8,paddingTop:8,display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:14,fontWeight:700,color:T.text}}>Total</span>
                  <span style={{fontSize:18,fontWeight:700,color:BRAND}}>{fmt(totalGeral)}</span>
                </div>
              </div>
            }
          />
        )}
      </div>

      <div style={{display:"grid",gridTemplateColumns:step===0?"1fr":"1fr 1fr",gap:10,marginTop:16}}>
        {step > 0 && <button onClick={() => setStep(s => s-1)} style={{...btnS,background:"#475569"}}>Voltar</button>}
        {step < 4
          ? <button onClick={() => setStep(s => s+1)} disabled={!canNext()} style={{...btnS,background:canNext()?BRAND:"#334155",opacity:canNext()?1:0.5}}>Próximo</button>
          : <button onClick={handleSubmit} disabled={!canNext()||submitting} style={{...btnS,background:canNext()&&!submitting?BRAND:"#334155",opacity:canNext()&&!submitting?1:0.5,fontSize:16}}>{submitting?"Enviando...":"Enviar NF"}</button>
        }
      </div>
    </>
  );
}

// ── Formulário MENSAL ──────────────────────────────────────────────────────────
function FormMensal({ fornecedores, onDone, T }) {
  const IS = getIS(T);
  const [step, setStep] = useState(0);
  const [mesSel, setMesSel] = useState(new Date().getMonth());
  const [servicoSel, setServicoSel] = useState(null);
  const [valor, setValorState] = useState("");
  const [nfData, setNfData] = useState({ fornecedor:"", numeroNF:"", dataEmissao:"", dataEnvio:"", obs:"" });
  const [arquivo, setArquivo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);
  // Retry após falha não duplica: ver comentário no FormJogo.
  const clientRef = useRef("cr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9)).current;

  const canNext = () => {
    if (step === 0) return mesSel != null;
    if (step === 1) return servicoSel != null;
    if (step === 2) return parseValorBR(valor) > 0;
    if (step === 3) return nfData.fornecedor.length > 0 && nfData.numeroNF.trim().length > 0 && !!arquivo; // PDF obrigatório (regra do financeiro)
    return false;
  };

  const handleSubmit = async () => {
    // Janela FPF: cobre a página deixada aberta de um dia pro outro
    if (new Date().getDate() > 20) { alert("A FPF só aceita notas até o dia 20 do mês. O formulário reabre no dia 1º do mês seguinte."); return; }
    setSubmitting(true);
    try {
      // Trava de duplicata: ver comentário no FormJogo.
      const dataUrlNF = arquivo ? await fileToDataUrl(arquivo).catch(() => null) : null;
      const fileHash = dataUrlNF ? await hashDataUrl(dataUrlNF) : null;
      const dup = await nfDuplicadaServidor('paulistao', { ...nfData, fileHash });
      if (dup?.dup) { alert(MSG_DUPLICADA(nfData.numeroNF)); setSubmitting(false); return; }

      const submissionId = Date.now();
      let hasFile = false;
      if (dataUrlNF) {
        await saveNFFilePublico(submissionId, dataUrlNF); hasFile = true; // falha aborta o envio (catch externo avisa)
      }
      const submission = {
        id: submissionId, clientRef, tipo:"mensal", ...nfData, ...(fileHash ? { fileHash } : {}),
        valorNF: parseValorBR(valor),
        mes: mesSel, mesLabel: MESES[mesSel],
        servicoId: servicoSel.id,
        servicoNome: servicoSel.nome,
        servicosLabels: [servicoSel.nome],
        status:"pendente", hasFile, enviadoEm: new Date().toISOString(),
      };
      // Append atômico no servidor: ver comentário no FormJogo.
      await appendState('paulistao_nf_submissions', submission);
      onDone();
    } catch (err) {
      alert("Erro ao enviar a NF, tente novamente: " + err.message);
    }
    setSubmitting(false);
  };

  const STEPS = STEPS_MENSAL;
  const bySec = {};
  SERVICOS_MENSAIS.forEach(s => { if (!bySec[s.secao]) bySec[s.secao] = {color:s.color,items:[]}; bySec[s.secao].items.push(s); });

  return (
    <>
      {/* Progress */}
      <div style={{display:"flex",gap:6,marginBottom:24}}>
        {STEPS.map((s, i) => (
          <div key={s} style={{flex:1,textAlign:"center"}}>
            <div style={{height:4,borderRadius:2,background:i<=step?BRAND:T.border,marginBottom:6,boxShadow:i<=step?`0 0 12px ${BRAND}aa`:"none"}}/>
            <span style={{fontSize:10,color:i<=step?BRAND:T.textSm,fontWeight:i===step?700:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>{s}</span>
          </div>
        ))}
      </div>

      <div style={{background:T.card,borderRadius:16,padding:"24px 20px",minHeight:200}}>

        {step === 0 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Qual o mês trabalhado?</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Mês em que o serviço foi prestado (competência), não o da emissão. Ex.: NF pedida em 1º de setembro = Setembro.</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {MESES.map((m, i) => (
                <button key={m} onClick={() => setMesSel(i)}
                  style={{padding:"12px",borderRadius:10,border:`2px solid ${mesSel===i?BRAND:T.border}`,cursor:"pointer",fontSize:14,fontWeight:mesSel===i?700:400,
                    background:mesSel===i?T.brandSoft:T.bg,color:mesSel===i?BRAND:T.textMd,textAlign:"center"}}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Qual o serviço?</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Selecione o serviço prestado em {MESES[mesSel]}</p>
            {Object.entries(bySec).map(([secNome, {color, items}]) => (
              <div key={secNome} style={{marginBottom:16}}>
                <p style={{color,fontSize:12,fontWeight:700,margin:"0 0 8px"}}>{secNome}</p>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {items.map(s => {
                    const sel = servicoSel?.id === s.id;
                    return (
                      <button key={s.id} onClick={() => setServicoSel(s)}
                        style={{padding:"12px 16px",borderRadius:10,border:`2px solid ${sel?color:T.border}`,cursor:"pointer",
                          background:sel?color+"22":T.bg,color:sel?color:T.textMd,textAlign:"left",fontWeight:sel?700:400,fontSize:14}}>
                        {s.nome}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 2 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Valor da NF</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>{servicoSel?.nome} · {MESES[mesSel]}</p>
            <div style={{display:"flex",alignItems:"center"}}>
              <span style={{background:T.muted,color:T.text,padding:"12px 12px",borderRadius:"8px 0 0 8px",fontSize:14,fontWeight:600}}>R$</span>
              <input type="text" inputMode="decimal" value={valor} onChange={e => setValorState(soDigitosValor(e.target.value))}
                placeholder="0,00" style={{...IS,borderRadius:"0 8px 8px 0",borderLeft:"none",fontWeight:700,color:BRAND,fontSize:20}} autoFocus/>
            </div>
            {parseValorBR(valor) > 0 && (
              <div style={{background:T.bg,borderRadius:10,padding:"14px 16px",marginTop:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{color:T.textMd,fontWeight:600,fontSize:14}}>Total</span>
                <span style={{fontSize:20,fontWeight:700,color:BRAND}}>{fmt(parseValorBR(valor))}</span>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <NFDataStep nfData={nfData} setNfData={setNfData} arquivo={arquivo} setArquivo={setArquivo} fileRef={fileRef} fornecedores={fornecedores} T={T}
            resumo={
              <div style={{background:T.bg,borderRadius:10,padding:"14px 16px"}}>
                <p style={{color:T.textMd,fontSize:11,fontWeight:600,margin:"0 0 8px"}}>Resumo</p>
                <div style={{fontWeight:600,fontSize:13,color:T.text}}>{servicoSel?.nome}</div>
                <div style={{fontSize:11,color:T.textSm,margin:"2px 0"}}>{MESES[mesSel]}</div>
                <div style={{fontSize:13,color:BRAND,fontWeight:700}}>{fmt(parseValorBR(valor))}</div>
              </div>
            }
          />
        )}
      </div>

      <div style={{display:"grid",gridTemplateColumns:step===0?"1fr":"1fr 1fr",gap:10,marginTop:16}}>
        {step > 0 && <button onClick={() => setStep(s => s-1)} style={{...btnS,background:"#475569"}}>Voltar</button>}
        {step < 3
          ? <button onClick={() => setStep(s => s+1)} disabled={!canNext()} style={{...btnS,background:canNext()?BRAND:"#334155",opacity:canNext()?1:0.5}}>Próximo</button>
          : <button onClick={handleSubmit} disabled={!canNext()||submitting} style={{...btnS,background:canNext()&&!submitting?BRAND:"#334155",opacity:canNext()&&!submitting?1:0.5,fontSize:16}}>{submitting?"Enviando...":"Enviar NF"}</button>
        }
      </div>
    </>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────
export default function FormularioPublicoPaulistao() {
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("ffu_darkmode_v1") !== "false"; } catch { return true; }
  });
  const T = darkMode ? DARK_T : LIGHT_T;
  const toggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    try { localStorage.setItem("ffu_darkmode_v1", String(next)); } catch {}
  };
  const [jogos, setJogos] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tipo, setTipo] = useState(null); // null | "jogo" | "mensal"
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Caminho público sem PII/valores (RPC); se a RPC falhar, cai no caminho antigo
    Promise.all([publicoJogos('paulistao_jogos'), publicoFornecedores('fornecedores')])
      .catch(() => Promise.all([getState('paulistao_jogos'), getState('fornecedores')]))
      .then(([j, f]) => {
        if (j) setJogos(j);
        if (f) setFornecedores(f);
        setLoading(false);
      });
  }, []);

  // Só jogos liberados pelo operador (botão na aba Notas Fiscais) aparecem aqui —
  // evita envio de NF antes do provisionado ser acertado.
  const divulgados = jogos.filter(j => j.mandante !== "A definir" && j.formLiberado);

  const reset = () => { setTipo(null); setDone(false); };

  // Janela FPF: a federação só aceita notas até o dia 20 de cada mês.
  // Do dia 21 em diante o formulário fecha e reabre no dia 1º do mês seguinte.
  const hoje = new Date();
  const formFechado = hoje.getDate() > 20;
  const reabreEm = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1)
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });

  if (loading) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <p style={{color:T.textMd,fontSize:16}}>Carregando...</p>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Poppins',sans-serif"}}>
      <style>{HIDE_SPINNERS}</style>
      {/* Header */}
      <div style={{background:darkMode?"linear-gradient(135deg,#060912 0%,#0f1623 60%,#0a1a0f 100%)":"linear-gradient(135deg,#ffffff 0%,#f8f9fa 100%)",borderBottom:`1px solid ${T.border}`,padding:"24px 16px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-60,right:-60,width:200,height:200,borderRadius:"50%",background:`radial-gradient(circle, ${BRAND}1f 0%, transparent 60%)`,pointerEvents:"none"}}/>
        <div style={{maxWidth:560,margin:"0 auto",position:"relative",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <p style={{color:BRAND,fontSize:10,letterSpacing:"0.18em",textTransform:"uppercase",margin:"0 0 6px",fontWeight:700}}>Livemode · Transmissões</p>
            <h1 style={{fontSize:22,fontWeight:800,margin:0,color:T.text,letterSpacing:"-0.025em"}}>Envio de Nota Fiscal</h1>
            <p style={{color:T.textMd,fontSize:12,margin:"4px 0 0"}}>Paulistão F 2026</p>
          </div>
          <button onClick={toggleDark} title={darkMode?"Modo claro":"Modo escuro"}
            style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:8,padding:"8px",cursor:"pointer",color:T.textMd,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:4}}>
            {darkMode ? <Sun size={16}/> : <Moon size={16}/>}
          </button>
        </div>
      </div>

      <div style={{padding:"20px 16px",maxWidth:560,margin:"0 auto"}}>

        {formFechado ? (
          <div style={{background:T.card,borderRadius:18,padding:"48px 28px",textAlign:"center",border:`1px solid ${T.border}`,boxShadow:"0 20px 40px -12px rgba(0,0,0,0.6)"}}>
            <div style={{width:64,height:64,borderRadius:18,background:"rgba(245,158,11,0.14)",border:"1px solid rgba(245,158,11,0.35)",color:"#f59e0b",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px",fontSize:30}}>🔒</div>
            <h3 style={{color:T.text,margin:"0 0 8px",fontSize:20,fontWeight:800,letterSpacing:"-0.02em"}}>Envios encerrados neste mês</h3>
            <p style={{color:T.textMd,fontSize:13,margin:"0 0 6px",lineHeight:1.6}}>A FPF só aceita notas fiscais até o dia 20 de cada mês.</p>
            <p style={{color:T.textMd,fontSize:13,margin:0,lineHeight:1.6}}>O formulário reabre em <b style={{color:BRAND}}>{reabreEm}</b>.</p>
          </div>

        ) : done ? (
          <div style={{background:T.card,borderRadius:18,padding:"48px 28px",textAlign:"center",border:`1px solid ${T.border}`,boxShadow:"0 20px 40px -12px rgba(0,0,0,0.6)"}}>
            <div style={{width:64,height:64,borderRadius:18,background:T.brandSoft,border:`1px solid ${T.brandBorder}`,color:BRAND,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px",fontSize:32}}>✓</div>
            <h3 style={{color:T.text,margin:"0 0 8px",fontSize:20,fontWeight:800,letterSpacing:"-0.02em"}}>Nota fiscal enviada!</h3>
            <p style={{color:T.textMd,fontSize:13,margin:"0 0 28px"}}>Sua NF será analisada pela equipe. Obrigado!</p>
            <button onClick={reset} style={{...btnS,background:`linear-gradient(135deg,#3a7a1a,${BRAND})`,maxWidth:280,margin:"0 auto",boxShadow:`0 4px 14px ${BRAND}55`}}>Enviar outra NF</button>
          </div>

        ) : !tipo ? (
          /* Seletor de tipo */
          <div style={{background:T.card,borderRadius:16,padding:"28px 20px"}}>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Tipo de nota fiscal</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 20px"}}>Selecione o tipo de NF que deseja enviar</p>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <button onClick={() => setTipo("jogo")}
                style={{padding:"18px 20px",borderRadius:12,border:`2px solid ${T.border}`,cursor:"pointer",background:T.bg,textAlign:"left",
                  display:"flex",alignItems:"center",gap:16,transition:"border-color 0.15s"}}
                onMouseEnter={e => e.currentTarget.style.borderColor = BRAND}
                onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                <div style={{width:44,height:44,borderRadius:10,background:T.brandSoft,border:`1px solid ${T.brandBorder}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>⚽</div>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:T.text}}>Por Jogo</div>
                  <div style={{fontSize:12,color:T.textSm,marginTop:2}}>UM B3, Produtor de UM, Produtor de Campo, Supervisor 1, Geradores, SNG</div>
                </div>
              </button>
              <button onClick={() => setTipo("mensal")}
                style={{padding:"18px 20px",borderRadius:12,border:`2px solid ${T.border}`,cursor:"pointer",background:T.bg,textAlign:"left",
                  display:"flex",alignItems:"center",gap:16,transition:"border-color 0.15s"}}
                onMouseEnter={e => e.currentTarget.style.borderColor = BRAND}
                onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                <div style={{width:44,height:44,borderRadius:10,background:"rgba(124,58,237,0.14)",border:"1px solid rgba(124,58,237,0.32)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>📅</div>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:T.text}}>Mensal</div>
                  <div style={{fontSize:12,color:T.textSm,marginTop:2}}>Coord. Sinal Internacional, Editor de Vídeos, Vmix, Estatísticas, Ingest/WSC</div>
                </div>
              </button>
            </div>
          </div>

        ) : tipo === "jogo" ? (
          <FormJogo divulgados={divulgados} fornecedores={fornecedores} onDone={() => setDone(true)} T={T}/>
        ) : (
          <FormMensal fornecedores={fornecedores} onDone={() => setDone(true)} T={T}/>
        )}

        {tipo && !done && (
          <button onClick={() => setTipo(null)} style={{...btnS,background:"transparent",color:T.textSm,fontSize:12,marginTop:8,border:`1px solid ${T.border}`}}>
            ← Voltar ao início
          </button>
        )}
      </div>

      <div style={{textAlign:"center",padding:"20px",color:T.textSm,fontSize:10}}>
        FFU — Transmissões · Paulistão F 2026
      </div>
    </div>
  );
}
