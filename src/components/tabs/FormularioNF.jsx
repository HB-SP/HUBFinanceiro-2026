import { patchNumeroNF, avisoChaveDetectada } from "../../lib/nfNumero";
import { useState, useRef } from "react";
import { Pill } from "../shared";
import { DateInput } from "../ui";
import { fmt, parseValorBR } from "../../utils";
import { CATS, btnStyle, iSty } from "../../constants";
import { fileToDataUrl, saveNFFile } from "../../lib/supabase";

const SUBS_MENSAL = new Set(["transporte","uber","hospedagem","seg_espacial"]);

function extrairServicos(jogo) {
  const servicos = [];
  CATS.forEach(cat => {
    cat.subs.forEach(sub => {
      if (SUBS_MENSAL.has(sub.key)) return;
      const valOrc = jogo.orcado?.[sub.key] || 0;
      const valProv = jogo.provisionado?.[sub.key] || 0;
      const val = valProv || valOrc;
      if (val > 0) servicos.push({ subKey: sub.key, subLabel: sub.label, catLabel: cat.label, catColor: cat.color, valorRef: val });
    });
  });
  return servicos;
}

function abreviar(nome) {
  if (!nome || nome === "A definir") return "TBD";
  const map = {"Fluminense":"FLU","Botafogo":"BOT","Flamengo":"FLA","Vasco":"VAS","Corinthians":"COR","Palmeiras":"PAL","São Paulo":"SAO","Athletico PR":"CAP","Grêmio":"GRE","Internacional":"INT","Cruzeiro":"CRU","Atlético MG":"CAM","Chapecoense":"CHA","Santos":"SAN","Vitória":"VIT","Mirassol":"MIR","Coritiba":"CFC"};
  return map[nome] || nome.slice(0,3).toUpperCase();
}

function gerarCodigo(rodada, mandante, visitante, valor, numeroNF) {
  return `RD${String(rodada).padStart(2,"0")}_${abreviar(mandante)}x${abreviar(visitante)}_${Math.round(valor||0)}_NF${(numeroNF||"SN").replace(/\s/g,"")}`;
}

function FornecedorInput({ value, onChange, fornecedores, T }) {
  const IS = iSty(T);
  const [open, setOpen] = useState(false);
  const query = value.toLowerCase();
  const filtered = query.length > 0
    ? fornecedores.filter(f => f.apelido.toLowerCase().includes(query) || f.razaoSocial.toLowerCase().includes(query) || f.funcao.toLowerCase().includes(query)).slice(0,8) : [];
  return (
    <div style={{position:"relative"}}>
      <input value={value} onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Digite para buscar..." style={IS}/>
      {open && filtered.length > 0 && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,marginTop:4,maxHeight:200,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.3)"}}>
          {filtered.map(f => (
            <div key={f.id} onMouseDown={() => { onChange(f.apelido); setOpen(false); }}
              style={{padding:"8px 12px",cursor:"pointer",borderBottom:`1px solid ${T.border}`}}
              onMouseEnter={e => e.currentTarget.style.background = T.bg}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{fontSize:13,fontWeight:600,color:T.text}}>{f.apelido}</span>
              <span style={{fontSize:11,color:T.textSm,marginLeft:8}}>{f.funcao}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STEPS = ["Rodada","Jogos","Serviços","Valores","Nota Fiscal"];

export default function FormularioNF({ jogos, fornecedores = [], onSubmit, T }) {
  const IS = iSty(T);
  const [step, setStep] = useState(0);
  const [rodadaSel, setRodadaSel] = useState(null);
  const [qtdJogos, setQtdJogos] = useState(1);
  const [jogosSel, setJogosSel] = useState([]);
  const [servicosSel, setServicosSel] = useState({}); // { jogoId: [subKey, ...] }
  const [valores, setValores] = useState({}); // { "jogoId_subKey": valor }
  const [nfData, setNfData] = useState({ fornecedor:"", numeroNF:"", dataEmissao:"", dataEnvio:"", obs:"" });
  const [arquivo, setArquivo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);

  const divulgados = jogos.filter(j => j.mandante !== "A definir");
  const rodadas = Array.from(new Set(divulgados.map(j => j.rodada))).sort((a, b) => a - b);
  const jogosRodada = divulgados.filter(j => j.rodada === rodadaSel);

  const canNext = () => {
    if (step === 0) return rodadaSel != null;
    if (step === 1) return jogosSel.length === qtdJogos;
    if (step === 2) return Object.values(servicosSel).some(arr => arr.length > 0);
    if (step === 3) return Object.values(valores).some(v => parseValorBR(v) > 0);
    if (step === 4) return nfData.fornecedor.length > 0;
    return false;
  };

  const toggleJogo = (id) => {
    setJogosSel(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= qtdJogos) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const toggleServico = (jogoId, subKey) => {
    setServicosSel(prev => {
      const arr = prev[jogoId] || [];
      const next = arr.includes(subKey) ? arr.filter(k => k !== subKey) : [...arr, subKey];
      return {...prev, [jogoId]: next};
    });
  };

  const setValor = (key, val) => setValores(prev => ({...prev, [key]: val}));

  const totalGeral = Object.values(valores).reduce((s, v) => s + parseValorBR(v), 0);

  const handleSubmit = async () => {
    setSubmitting(true);
    // Criar uma NF por jogo
    for (const jogoId of jogosSel) {
      const jogo = divulgados.find(j => j.id === jogoId);
      if (!jogo) continue;
      const subs = servicosSel[jogoId] || [];
      if (subs.length === 0) continue;

      const servicosValores = {};
      let valorNF = 0;
      subs.forEach(sk => {
        const v = parseValorBR(valores[`${jogoId}_${sk}`]);
        servicosValores[sk] = v;
        valorNF += v;
      });

      const codigo = gerarCodigo(jogo.rodada, jogo.mandante, jogo.visitante, valorNF, nfData.numeroNF);
      const notaId = Date.now() + jogoId;

      let hasFile = false;
      if (arquivo) {
        try {
          const dataUrl = await fileToDataUrl(arquivo);
          await saveNFFile(notaId, dataUrl);
          hasFile = true;
        } catch(_){}
      }

      const allServicos = extrairServicos(jogo);

      onSubmit({
        id: notaId,
        codigo,
        ...nfData,
        valorNF,
        rodada: jogo.rodada,
        jogoId: jogo.id,
        jogoLabel: `${jogo.mandante} x ${jogo.visitante}`,
        mandante: jogo.mandante,
        visitante: jogo.visitante,
        servicosKeys: subs.map(sk => `${jogo.id}_${sk}`),
        servicosLabels: allServicos.filter(s => subs.includes(s.subKey)).map(s => s.subLabel),
        servicosValores,
        tipo: "prevista",
        status: "Conferida",
        hasFile,
      });
    }
    setSubmitting(false);
    setDone(true);
  };

  const reset = () => {
    setStep(0); setRodadaSel(null); setQtdJogos(1); setJogosSel([]);
    setServicosSel({}); setValores({}); setNfData({ fornecedor:"", numeroNF:"", dataEmissao:"", dataEnvio:"", obs:"" });
    setArquivo(null); setDone(false);
  };

  if (done) return (
    <div style={{background:T.card,borderRadius:16,padding:40,textAlign:"center",maxWidth:500,margin:"0 auto"}}>
      <div style={{fontSize:48,marginBottom:16}}>✅</div>
      <h3 style={{color:T.text,margin:"0 0 8px",fontSize:18}}>NF registrada com sucesso!</h3>
      <p style={{color:T.textMd,fontSize:13,margin:"0 0 24px"}}>Os valores foram adicionados ao realizado dos jogos.</p>
      <button onClick={reset} style={{...btnStyle,background:"#8b5cf6",padding:"10px 28px",fontSize:14}}>Registrar outra NF</button>
    </div>
  );

  return (
    <div style={{maxWidth:640,margin:"0 auto"}}>
      {/* Progress */}
      <div style={{display:"flex",gap:4,marginBottom:24}}>
        {STEPS.map((s, i) => (
          <div key={s} style={{flex:1,textAlign:"center"}}>
            <div style={{height:4,borderRadius:2,background:i<=step?"#8b5cf6":T.border,marginBottom:6,transition:"background 0.3s"}}/>
            <span style={{fontSize:11,color:i<=step?"#8b5cf6":T.textSm,fontWeight:i===step?700:400}}>{s}</span>
          </div>
        ))}
      </div>

      <div style={{background:T.card,borderRadius:16,padding:28,minHeight:300}}>

        {/* STEP 0: Rodada */}
        {step === 0 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Selecione a Rodada</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 20px"}}>Qual rodada essa nota fiscal se refere?</p>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {rodadas.map(r => (
                <button key={r} onClick={() => setRodadaSel(r)} style={{padding:"12px 20px",borderRadius:12,border:"none",cursor:"pointer",fontSize:15,fontWeight:700,
                  background:rodadaSel===r?"#8b5cf6":T.bg,color:rodadaSel===r?"#fff":T.textMd,transition:"all 0.2s",
                  boxShadow:rodadaSel===r?"0 4px 12px rgba(139,92,246,0.3)":"none"}}>
                  Rodada {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP 1: Quantidade + Jogos */}
        {step === 1 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Selecione os Jogos</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Quantos jogos essa NF cobre na rodada {rodadaSel}?</p>
            <div style={{display:"flex",gap:8,marginBottom:20}}>
              {[1,2].map(n => (
                <button key={n} onClick={() => { setQtdJogos(n); setJogosSel([]); }} style={{padding:"10px 24px",borderRadius:10,border:"none",cursor:"pointer",fontSize:14,fontWeight:700,
                  background:qtdJogos===n?"#8b5cf6":T.bg,color:qtdJogos===n?"#fff":T.textMd}}>
                  {n} jogo{n>1?"s":""}
                </button>
              ))}
            </div>
            <p style={{color:T.textMd,fontSize:12,margin:"0 0 12px",fontWeight:600}}>Selecione {qtdJogos} jogo{qtdJogos>1?"s":""}:</p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {jogosRodada.map(j => {
                const sel = jogosSel.includes(j.id);
                return (
                  <button key={j.id} onClick={() => toggleJogo(j.id)}
                    style={{padding:"14px 20px",borderRadius:12,border:`2px solid ${sel?"#8b5cf6":T.border}`,cursor:"pointer",
                      background:sel?"#8b5cf622":T.bg,textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <span style={{fontWeight:700,fontSize:14,color:T.text}}>{j.mandante} x {j.visitante}</span>
                      <span style={{color:T.textSm,fontSize:12,marginLeft:12}}>{j.data} · {j.cidade}</span>
                    </div>
                    <Pill label={j.categoria} color={j.categoria==="B1"?"#22c55e":"#f59e0b"}/>
                  </button>
                );
              })}
              {jogosRodada.length === 0 && <p style={{color:T.textSm,fontSize:13}}>Nenhum jogo divulgado nesta rodada</p>}
            </div>
          </div>
        )}

        {/* STEP 2: Serviços */}
        {step === 2 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Serviços Prestados</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 20px"}}>Selecione os serviços cobertos por esta nota em cada jogo</p>
            {jogosSel.map(jogoId => {
              const jogo = divulgados.find(j => j.id === jogoId);
              if (!jogo) return null;
              const servicos = extrairServicos(jogo);
              const selected = servicosSel[jogoId] || [];
              // Group by category
              const byCat = {};
              servicos.forEach(s => {
                if (!byCat[s.catLabel]) byCat[s.catLabel] = { color: s.catColor, items: [] };
                byCat[s.catLabel].items.push(s);
              });
              return (
                <div key={jogoId} style={{marginBottom:20}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                    <Pill label={jogo.categoria} color={jogo.categoria==="B1"?"#22c55e":"#f59e0b"}/>
                    <span style={{fontWeight:700,fontSize:14,color:T.text}}>{jogo.mandante} x {jogo.visitante}</span>
                  </div>
                  {Object.entries(byCat).map(([catName, { color, items }]) => (
                    <div key={catName} style={{marginBottom:12}}>
                      <p style={{color,fontSize:12,fontWeight:700,margin:"0 0 6px"}}>{catName}</p>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {items.map(s => {
                          const sel = selected.includes(s.subKey);
                          return (
                            <button key={s.subKey} onClick={() => toggleServico(jogoId, s.subKey)}
                              style={{padding:"8px 14px",borderRadius:8,border:`2px solid ${sel?color:T.border}`,cursor:"pointer",fontSize:12,fontWeight:sel?700:400,
                                background:sel?color+"22":"transparent",color:sel?color:T.textMd,transition:"all 0.15s"}}>
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

        {/* STEP 3: Valores */}
        {step === 3 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Valores por Serviço</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 20px"}}>Preencha o valor de cada serviço na nota</p>
            {jogosSel.map(jogoId => {
              const jogo = divulgados.find(j => j.id === jogoId);
              if (!jogo) return null;
              const subs = servicosSel[jogoId] || [];
              const allServicos = extrairServicos(jogo);
              return (
                <div key={jogoId} style={{marginBottom:20}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                    <Pill label={jogo.categoria} color={jogo.categoria==="B1"?"#22c55e":"#f59e0b"}/>
                    <span style={{fontWeight:700,fontSize:14,color:T.text}}>{jogo.mandante} x {jogo.visitante}</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {subs.map(sk => {
                      const s = allServicos.find(x => x.subKey === sk);
                      if (!s) return null;
                      const key = `${jogoId}_${sk}`;
                      return (
                        <div key={sk} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:T.bg,borderRadius:8}}>
                          <span style={{flex:1,fontSize:13,color:T.text,fontWeight:600}}>{s.subLabel}</span>
                          <span style={{fontSize:11,color:T.textSm}}>Ref: {fmt(s.valorRef)}</span>
                          <div style={{display:"flex",alignItems:"center",gap:4}}>
                            <span style={{fontSize:12,color:T.textMd}}>R$</span>
                            <input type="text" inputMode="decimal" placeholder="0,00" value={valores[key] ?? ""} onChange={e => setValor(key, e.target.value)}
                              placeholder={String(s.valorRef)}
                              style={{...IS,width:110,textAlign:"right",padding:"6px 10px",fontWeight:600,color:"#8b5cf6"}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div style={{borderTop:`2px solid ${T.border}`,marginTop:12,paddingTop:12,display:"flex",justifyContent:"flex-end"}}>
              <span style={{fontSize:16,fontWeight:700,color:"#8b5cf6"}}>Total: {fmt(totalGeral)}</span>
            </div>
          </div>
        )}

        {/* STEP 4: Dados da NF */}
        {step === 4 && (
          <div>
            <h3 style={{color:T.text,margin:"0 0 4px",fontSize:16}}>Dados da Nota Fiscal</h3>
            <p style={{color:T.textSm,fontSize:12,margin:"0 0 20px"}}>Preencha as informações da NF</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
              <div style={{marginBottom:14}}>
                <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Fornecedor</label>
                <FornecedorInput value={nfData.fornecedor} onChange={v => setNfData(d => ({...d, fornecedor: v}))} fornecedores={fornecedores} T={T}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Nº da Nota</label>
                <input value={nfData.numeroNF} onChange={e => setNfData(d => ({...d, ...patchNumeroNF(e.target.value)}))} style={IS} title="Pode colar a chave de acesso da NFS-e: o número é extraído automaticamente"/>
                {nfData.chaveAcesso && <p style={{color:"#059669",fontSize:11,margin:"4px 0 0"}}>{avisoChaveDetectada(nfData.chaveAcesso, nfData.numeroNF)}</p>}
              </div>
              <div style={{marginBottom:14}}>
                <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Data Emissão</label>
                <DateInput value={nfData.dataEmissao} onChange={v => setNfData(d => ({...d, dataEmissao: v}))} style={IS}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Data Envio</label>
                <DateInput value={nfData.dataEnvio} onChange={v => setNfData(d => ({...d, dataEnvio: v}))} style={IS}/>
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Observações</label>
              <input value={nfData.obs} onChange={e => setNfData(d => ({...d, obs: e.target.value}))} style={IS}/>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Arquivo da NF (PDF/imagem)</label>
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e => setArquivo(e.target.files[0] || null)} style={{display:"none"}}/>
              <div onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {e.preventDefault(); setArquivo(e.dataTransfer.files[0] || null);}}
                style={{border:`2px dashed ${arquivo?"#22c55e":T.muted}`,borderRadius:8,padding:"14px 16px",cursor:"pointer",textAlign:"center",
                  background:arquivo?"#22c55e11":T.bg}}>
                {arquivo
                  ? <p style={{margin:0,color:"#22c55e",fontSize:13,fontWeight:600}}>{arquivo.name} ({(arquivo.size/1024).toFixed(0)} KB)</p>
                  : <p style={{margin:0,color:T.textSm,fontSize:12}}>Clique ou arraste o arquivo aqui</p>}
              </div>
            </div>

            {/* Resumo */}
            <div style={{background:T.bg,borderRadius:10,padding:"14px 18px",marginTop:8}}>
              <p style={{color:T.textMd,fontSize:11,fontWeight:600,margin:"0 0 8px"}}>Resumo</p>
              {jogosSel.map(jogoId => {
                const jogo = divulgados.find(j => j.id === jogoId);
                if (!jogo) return null;
                const subs = servicosSel[jogoId] || [];
                const allServicos = extrairServicos(jogo);
                const total = subs.reduce((s, sk) => s + parseValorBR(valores[`${jogoId}_${sk}`]), 0);
                return (
                  <div key={jogoId} style={{marginBottom:6}}>
                    <span style={{fontSize:12,color:T.text,fontWeight:600}}>{jogo.mandante} x {jogo.visitante}</span>
                    <span style={{fontSize:11,color:T.textSm,marginLeft:8}}>
                      {subs.map(sk => allServicos.find(x => x.subKey === sk)?.subLabel).filter(Boolean).join(", ")}
                    </span>
                    <span style={{fontSize:12,color:"#8b5cf6",fontWeight:700,marginLeft:8}}>{fmt(total)}</span>
                  </div>
                );
              })}
              <div style={{borderTop:`1px solid ${T.border}`,marginTop:8,paddingTop:8,display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:13,fontWeight:700,color:T.text}}>Total NF</span>
                <span style={{fontSize:15,fontWeight:700,color:"#8b5cf6"}}>{fmt(totalGeral)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div style={{display:"flex",justifyContent:"space-between",marginTop:16}}>
        <button onClick={() => setStep(s => Math.max(0, s-1))} disabled={step===0}
          style={{...btnStyle,background:step===0?T.border:"#475569",padding:"10px 24px",opacity:step===0?0.4:1}}>
          Voltar
        </button>
        {step < 4 ? (
          <button onClick={() => setStep(s => s+1)} disabled={!canNext()}
            style={{...btnStyle,background:canNext()?"#8b5cf6":"#475569",padding:"10px 24px",opacity:canNext()?1:0.4}}>
            Próximo
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={!canNext()||submitting}
            style={{...btnStyle,background:canNext()&&!submitting?"#22c55e":"#475569",padding:"10px 28px",fontSize:14,opacity:canNext()&&!submitting?1:0.5}}>
            {submitting ? "Registrando..." : "Registrar NF"}
          </button>
        )}
      </div>
    </div>
  );
}
