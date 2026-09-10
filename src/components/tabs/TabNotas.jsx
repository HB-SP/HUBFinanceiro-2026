import AnexoNF from "../AnexoNF";
import LeituraNF from "../LeituraNF";
import { confirmarArquivoRepetido } from "../../lib/dedupeNF";
import { patchNumeroNF } from "../../lib/nfNumero";
import { useState, useMemo, useRef, useEffect } from "react";
import { KPI, Pill } from "../shared";
import { fmt, subTotal, parseValorBR } from "../../utils";
import { CATS, btnStyle, iSty, RADIUS } from "../../constants";
import { fileToDataUrl, saveNFFile, getNFFile, nfFileExiste, deleteNFFile, getState, setState as setSupabaseState, appendState, removeFromStateList } from "../../lib/supabase";
import { pushHistorico } from "../../lib/historico";
import { usePortalLink } from "../../hooks/usePortalLink";
import { getOperacionaisPorSubKey, findFornecedorTolerante, emiteNF } from "../../lib/portalLink";
import { countNotasFiscais, groupNotasFiscais, normalizeEnvioMetricas, notaFiscalKey, sumNotasFiscais } from "../../lib/notasFiscais";
import { acharDuplicatasNF, confirmarDuplicatas, grafiaCanonica } from "../../lib/dedupeNF";
import { ReembolsoLogisticaModal } from "../modals/ReembolsoLogisticaModal";
import { Card, PanelTitle, Button, Chip, Segmented, Progress, tableStyles, DateInput } from "../ui";
import { Plus, Eye, Trash2, Upload, Paperclip, Copy as CopyIcon, FileText } from "lucide-react";

const STATUS_NF = ["Pendente","Solicitada","Recebida","Conferida"];
const STATUS_COLOR = {"Pendente":"#f59e0b","Solicitada":"#3b82f6","Recebida":"#8b5cf6","Conferida":"#22c55e"};

function FornecedorInput({ value, onChange, fornecedores, T }) {
  const IS = iSty(T);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const query = value.toLowerCase();
  const filtered = query.length > 0
    ? fornecedores.filter(f => f.apelido.toLowerCase().includes(query) || f.razaoSocial.toLowerCase().includes(query) || f.funcao.toLowerCase().includes(query)).slice(0, 8)
    : [];

  return (
    <div style={{position:"relative"}} ref={ref}>
      <input value={value} onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Digite para buscar..." style={IS}/>
      {open && filtered.length > 0 && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,marginTop:4,maxHeight:200,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.3)"}}>
          {filtered.map(f => (
            <div key={f.id} onMouseDown={() => { onChange(f.apelido); setOpen(false); }}
              style={{padding:"8px 12px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,display:"flex",flexDirection:"column",gap:2}}
              onMouseEnter={e => e.currentTarget.style.background = T.bg}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:13,fontWeight:600,color:T.text}}>{f.apelido}</span>
                <span style={{fontSize:10,color:T.textSm,background:T.bg,padding:"1px 6px",borderRadius:4}}>{f.tipo}</span>
              </div>
              <span style={{fontSize:11,color:T.textSm}}>{f.funcao} · {f.razaoSocial.slice(0,40)}{f.razaoSocial.length>40?"...":""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Uma ação por linha, sem ambiguidade: nota com arquivo mostra "ver", nota sem
// arquivo mostra o clipe de "anexar". Substituir o arquivo de uma nota que já
// tem um vive dentro do visualizador — é lá que dá pra conferir o que está
// trocando. Quando o arquivo some do banco, abrir a nota corrige a marcação e
// o clipe aparece aqui, então nenhuma NF fica sem caminho para receber o PDF.
function AcoesArquivo({ nota, canEdit, onVer, onEnviar, T }) {
  if (nota.hasFile) {
    return <Button T={T} variant="secondary" size="sm" icon={Eye} title="Ver arquivo" onClick={() => onVer(nota)}/>;
  }
  return canEdit
    ? <Button T={T} variant="secondary" size="sm" icon={Paperclip} title="Anexar arquivo" onClick={() => onEnviar(nota)}/>
    : null;
}

function PreviewModal({ nota, onClose, onArquivoAusente, onSubstituir, T }) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!nota) return;
    setLoading(true);
    setSrc(null);
    getNFFile(nota.id).then(data => {
      setSrc(data);
      setLoading(false);
      // O arquivo sumiu do banco mas a nota ainda promete que existe: corrige a
      // marcação na hora, para o resto do sistema parar de prometer o que não tem.
      if (!data && nota.hasFile) onArquivoAusente?.(nota);
    }).catch(() => setLoading(false));
  }, [nota?.id]);

  if (!nota) return null;
  const isPdf = src?.startsWith('data:application/pdf');
  return (
    <div style={{position:"fixed",inset:0,background:"#000000dd",zIndex:200,display:"flex",flexDirection:"column"}}
      onClick={onClose}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",flexShrink:0}}
        onClick={e => e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <code style={{color:"#22c55e",fontSize:13,fontWeight:700}}>{nota.codigo}</code>
          <span style={{color:"#fff",fontSize:13}}>{nota.fornecedor}</span>
          <span style={{color:"#8b5cf6",fontWeight:600,fontSize:13}}>{fmt(nota.valorNF)}</span>
          <span style={{color:"#94a3b8",fontSize:12}}>{nota.jogoLabel} · Rd {nota.rodada}</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          {src && <a href={src} download={nota.codigo} style={{...btnStyle,background:"#3b82f6",padding:"6px 14px",fontSize:12,textDecoration:"none"}}>Download</a>}
          {onSubstituir && (
            <button onClick={() => { onSubstituir(nota); onClose(); }}
              style={{...btnStyle,background:"transparent",border:"1px solid #64748b",color:"#cbd5e1",padding:"6px 14px",fontSize:12}}>
              Substituir arquivo
            </button>
          )}
          <button onClick={onClose} style={{...btnStyle,background:"#475569",padding:"6px 14px",fontSize:12}}>Fechar</button>
        </div>
      </div>
      <div style={{flex:1,padding:"0 20px 20px",minHeight:0}} onClick={e => e.stopPropagation()}>
        {loading ? (
          <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <p style={{color:"#94a3b8",fontSize:16}}>Carregando...</p>
          </div>
        ) : !src ? (
          <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <p style={{color:"#94a3b8",fontSize:16}}>Arquivo não encontrado</p>
          </div>
        ) : isPdf ? (
          <iframe src={src} style={{width:"100%",height:"100%",border:"none",borderRadius:12,background:"#fff"}}/>
        ) : (
          <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",overflow:"auto"}}>
            <img src={src} alt={nota.codigo} style={{maxWidth:"100%",maxHeight:"100%",borderRadius:12,objectFit:"contain"}}/>
          </div>
        )}
      </div>
    </div>
  );
}

const SUBS_EXCLUIR = new Set(["transporte","uber","hospedagem","seg_espacial","infra","seg_extra"]);
// Subs que aceitam várias NFs compondo o mesmo provisionado (ex: diária, extras)
const SUBS_MULTI_NF = new Set(["diaria","extra"]);

function extrairServicos(jogo, extraExcluir) {
  const servicos = [];
  CATS.forEach(cat => {
    cat.subs.forEach(sub => {
      if (SUBS_EXCLUIR.has(sub.key)) return;
      if (extraExcluir?.has(sub.key)) return;
      const valorRef = jogo.provisionado?.[sub.key] || 0;
      if (valorRef > 0) {
        servicos.push({ subKey: sub.key, subLabel: sub.label, catLabel: cat.label, catColor: cat.color, valorRef });
      }
    });
  });
  return servicos;
}

function labelServico(sk) {
  for (const cat of CATS) {
    const s = cat.subs.find(x => x.key === sk);
    if (s) return s.label;
  }
  return sk;
}

function abreviar(nome) {
  if (!nome || nome === "A definir") return "TBD";
  const map = {"Fluminense":"FLU","Botafogo":"BOT","Flamengo":"FLA","Vasco":"VAS","Corinthians":"COR","Palmeiras":"PAL","São Paulo":"SAO","Athletico PR":"CAP","Grêmio":"GRE","Internacional":"INT","Cruzeiro":"CRU","Atlético MG":"CAM","Chapecoense":"CHA","Santos":"SAN","Vitória":"VIT","Mirassol":"MIR","Coritiba":"CFC"};
  return map[nome] || nome.slice(0,3).toUpperCase();
}

function gerarCodigo(rodada, mandante, visitante, valorNF, numeroNF) {
  const rd = String(rodada).padStart(2, "0");
  const m = abreviar(mandante);
  const v = abreviar(visitante);
  const val = Math.round(valorNF || 0);
  const nf = (numeroNF || "SN").replace(/\s/g, "");
  return `RD${rd}_${m}x${v}_${val}_NF${nf}`;
}

// ─── Modal para registrar NF (suporta multi-jogo e multi-serviço) ────────────
const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function RegistrarNFModal({ jogosRodada, notasExistentes, fornecedores, onSave, onClose, T, portal, subsExcluir = SUBS_EXCLUIR }) {
  const IS = iSty(T);
  const [form, setForm] = useState({
    numeroNF: "", fornecedor: "", dataEmissao: "", dataEnvio: "", obs: "", valorNF: "",
  });
  // selecionados: { "jogoId_subKey": valor }
  const [selecionados, setSelecionados] = useState({});
  const [arquivo, setArquivo] = useState(null);
  const [avisoArquivo, setAvisoArquivo] = useState(null);   // { hash, matches } do AnexoNF — arquivo já em outra nota?
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const set = (k, v) => setForm(f => ({...f, [k]: v}));

  // Soma de NFs já lançadas por (jogoId, subKey) — usado para subs multi-NF
  const valoresLancados = {};
  notasExistentes.forEach(n => {
    if (n.servicosDetalhe) {
      Object.entries(n.servicosDetalhe).forEach(([k, v]) => {
        valoresLancados[k] = (valoresLancados[k] || 0) + (v || 0);
      });
    } else if (n.servicosValores && n.jogoId) {
      Object.entries(n.servicosValores).forEach(([subKey, v]) => {
        const k = `${n.jogoId}_${subKey}`;
        valoresLancados[k] = (valoresLancados[k] || 0) + (v || 0);
      });
    }
  });

  // Serviços livres por jogo (provisionado > 0 + extras com fornecedor no Portal)
  const jogosComServicos = jogosRodada.map(jogo => {
    const base = extrairServicos(jogo, subsExcluir);
    const baseKeys = new Set(base.map(s => s.subKey));
    const portalExtras = [];
    // Mantém todas as linhas UM com provisionado > 0 (categoria pode mudar entre orcamento e execução)
    let baseFinal = base;
    const baseTemUM = base.some(s => /^um_b/.test(s.subKey));
    if (portal) {
      const opCat = CATS.find(c => c.key === 'operacoes') || CATS[0];
      // SNG: divide em Premiere e Host (usam buckets financeiros diferentes — sng_extra e sng)
      const sngP = getOperacionaisPorSubKey(jogo.id, 'sng_premiere', portal);
      if (sngP.length) {
        baseFinal = base.filter(s => s.subKey !== 'sng_extra');
        portalExtras.push({ subKey: 'sng_premiere', subLabel: 'SNG Premiere', catLabel: opCat.label, catColor: opCat.color, valorRef: jogo.provisionado?.sng_extra || 0, fromPortal: true });
      }
      // sng_host = sng: se não há linha sng no base (provisionado=0) mas Portal tem provider externo, cria
      if (!baseKeys.has('sng')) {
        const sngOpers = getOperacionaisPorSubKey(jogo.id, 'sng', portal, jogo.categoria);
        if (sngOpers.length) portalExtras.push({ subKey: 'sng', subLabel: 'SNG', catLabel: opCat.label, catColor: opCat.color, valorRef: 0, fromPortal: true });
      }
      CATS.forEach(cat => {
        cat.subs.forEach(sub => {
          if (sub.key === 'sng') return;
          if (baseKeys.has(sub.key)) return;
          if (subsExcluir.has(sub.key)) return;
          if (/^um_b/.test(sub.key) && baseTemUM) return;
          const opers = getOperacionaisPorSubKey(jogo.id, sub.key, portal, jogo.categoria);
          if (opers.length > 0) {
            portalExtras.push({
              subKey: sub.key, subLabel: sub.label,
              catLabel: cat.label, catColor: cat.color,
              valorRef: 0, fromPortal: true,
            });
          }
        });
      });
    }
    const servicos = [...baseFinal, ...portalExtras].map(s => {
      const key = `${jogo.id}_${s.subKey}`;
      const lancado = valoresLancados[key] || 0;
      const restante = Math.max(0, s.valorRef - lancado);
      return { ...s, lancado, restante, multi: SUBS_MULTI_NF.has(s.subKey) };
    }).filter(s => {
      if (s.multi) return true; // multi-NF sempre visível (pode lançar além do provisionado)
      const key = `${jogo.id}_${s.subKey}`;
      const nota = notasExistentes.find(n => n.servicosKeys?.includes(key));
      return !nota || nota.status !== "Conferida";
    });
    return { jogo, servicos };
  }).filter(j => j.servicos.length > 0);

  const toggleServico = (jogoId, subKey, valorSugerido) => {
    const key = `${jogoId}_${subKey}`;
    setSelecionados(prev => {
      if (prev[key] !== undefined) {
        const n = {...prev};
        delete n[key];
        if (Object.keys(n).length === 0) setForm(f => ({...f, valorNF: ""}));
        return n;
      }
      const next = {...prev, [key]: valorSugerido};
      if (Object.keys(prev).length === 0) setForm(f => ({...f, valorNF: String(valorSugerido || "")}));
      return next;
    });
  };

  const setValorUnit = (key, val) => {
    setSelecionados(prev => ({...prev, [key]: val}));
  };

  const setValorNFForm = (val) => {
    setForm(f => ({...f, valorNF: val}));
    // Com um único serviço selecionado, sincroniza o valor direto no selecionados
    if (selKeys.length === 1) {
      setSelecionados(prev => ({...prev, [selKeys[0]]: val}));
    }
  };

  const selKeys = Object.keys(selecionados);
  const totalNF = Object.values(selecionados).reduce((s, v) => s + parseValorBR(v), 0);
  const rodada = jogosRodada[0]?.rodada;

  // Seleção é manual: o usuário clica em cada chip do fornecedor (ou no checkbox)
  // pra adicionar serviço por serviço. Isso permite registrar 1 NF por jogo
  // quando o fornecedor manda notas separadas.
  const jogoIds = [...new Set(selKeys.map(k => parseInt(k.split("_")[0])))];
  const jogoLabel = jogoIds.map(id => { const j = jogosRodada.find(x => x.id === id); return j ? `${j.mandante} x ${j.visitante}` : ""; }).join(" + ");
  const firstJogo = jogosRodada.find(j => j.id === jogoIds[0]) || jogosRodada[0];
  const codigo = firstJogo ? gerarCodigo(rodada, firstJogo.mandante, firstJogo.visitante, totalNF, form.numeroNF) : "";

  const handleSave = async () => {
    if (!form.numeroNF && !form.fornecedor) return;
    if (selKeys.length === 0) return;
    if (arquivo && !confirmarArquivoRepetido(avisoArquivo, "registrar esta NF")) return;   // mesmo PDF já em outra nota
    setUploading(true);
    const notaId = Date.now();
    let hasFile = false, fileHash = null;
    if (arquivo) {
      try { const dataUrl = await fileToDataUrl(arquivo); fileHash = await saveNFFile(notaId, dataUrl); hasFile = true; } catch(_){}
    }
    // servicosValores agrupado por subKey (para sync realizado), mas servicosKeys com jogoId
    const servicosValores = {};
    selKeys.forEach(k => {
      const subKey = k.split("_").slice(1).join("_");
      servicosValores[subKey] = (servicosValores[subKey] || 0) + parseValorBR(selecionados[k]);
    });
    // jogoIds envolvidos — salvar array para sync multi-jogo
    const jogosEnvolvidos = [...new Set(selKeys.map(k => parseInt(k.split("_")[0])))];
    const allLabels = selKeys.map(k => {
      const subKey = k.split("_").slice(1).join("_");
      for (const jcs of jogosComServicos) { const s = jcs.servicos.find(x => x.subKey === subKey); if (s) return s.subLabel; }
      return subKey;
    });

    onSave({
      id: notaId,
      codigo,
      ...form,
      valorNF: totalNF,
      rodada,
      jogoId: jogosEnvolvidos.length === 1 ? jogosEnvolvidos[0] : jogosEnvolvidos[0],
      jogoIds: jogosEnvolvidos,
      jogoLabel,
      servicosKeys: selKeys,
      servicosLabels: [...new Set(allLabels)],
      servicosValores,
      servicosDetalhe: Object.fromEntries(selKeys.map(k => [k, parseValorBR(selecionados[k])])), // "jogoId_subKey": valor (granular)
      tipo: "prevista",
      status: "Conferida",
      hasFile,
      ...(fileHash ? { fileHash } : {}),
    });
    setUploading(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000099",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:T.card,borderRadius:16,padding:28,width:"100%",maxWidth:660,maxHeight:"90vh",overflowY:"auto"}}>
        <h3 style={{margin:"0 0 4px",fontSize:16,color:T.text}}>Registrar Nota Fiscal</h3>
        <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Rodada {rodada} · Selecione serviços de um ou mais jogos</p>

        {/* Seleção por jogo */}
        <div style={{marginBottom:16}}>
          {jogosComServicos.map(({ jogo, servicos }) => (
            <div key={jogo.id} style={{marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <Pill label={jogo.categoria} color={jogo.categoria==="B1"?"#22c55e":"#f59e0b"}/>
                <span style={{fontWeight:700,fontSize:13,color:T.text}}>{jogo.mandante} x {jogo.visitante}</span>
              </div>
              <div style={{background:T.bg,borderRadius:8,padding:8,display:"flex",flexDirection:"column",gap:2}}>
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"2px 8px",fontSize:10,color:T.textSm}}>
                  <span style={{width:20}}/><span style={{flex:1}}>Serviço</span>
                  <span style={{width:80,textAlign:"right"}}>Ref. / Rest.</span>
                  <span style={{width:100,textAlign:"right"}}>Valor NF</span>
                </div>
                {servicos.map(s => {
                  const key = `${jogo.id}_${s.subKey}`;
                  const checked = selecionados[key] !== undefined;
                  const valorSugerido = s.multi ? s.restante : s.valorRef;
                  const opersRaw = portal ? getOperacionaisPorSubKey(jogo.id, s.subKey, portal, jogo.categoria) : [];
                  // Substitui pelo apelido canônico do Hub quando há match tolerante
                  const opers = [...new Set(opersRaw.map(n => {
                    const f = findFornecedorTolerante(fornecedores, n);
                    return f ? f.apelido : n;
                  }))];
                  const matchOpFornecedor = form.fornecedor && opers.some(n => norm(n) === norm(form.fornecedor) || norm(n).includes(norm(form.fornecedor)) || norm(form.fornecedor).includes(norm(n)));
                  return (
                    <div key={key} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,
                      background:checked?s.catColor+"18":(matchOpFornecedor?"#10b98114":"transparent"),
                      border: matchOpFornecedor && !checked ? "1px dashed #10b98155" : "1px solid transparent"}}>
                      <input type="checkbox" checked={checked} onChange={() => toggleServico(jogo.id, s.subKey, valorSugerido)}/>
                      <span style={{fontSize:13,color:T.text,flex:1,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        {s.subLabel}
                        {opers.length > 0 && opers.map((nm, i) => (
                          <span key={i}
                            onClick={() => { set("fornecedor", nm); if (!checked) toggleServico(jogo.id, s.subKey, valorSugerido); }}
                            title="Nome operacional do Portal — clique para usar como fornecedor"
                            style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:"#10b98122",color:"#10b981",fontWeight:600,letterSpacing:0.3,cursor:"pointer",border:"1px solid #10b98144"}}>
                            → {nm}
                          </span>
                        ))}
                        {s.multi && s.lancado > 0 && (
                          <span style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:"#f59e0b22",color:"#f59e0b",fontWeight:600,letterSpacing:0.3}}>
                            {fmt(s.lancado)} / {fmt(s.valorRef)}
                          </span>
                        )}
                        {s.multi && s.lancado === 0 && (
                          <span style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:"#3b82f622",color:"#3b82f6",fontWeight:600,letterSpacing:0.3}}>
                            multi-NF
                          </span>
                        )}
                      </span>
                      <span style={{fontSize:11,color:T.textSm,width:80,textAlign:"right"}}>
                        {s.multi ? <>Rest. <b style={{color:T.textMd}}>{fmt(s.restante)}</b></> : fmt(s.valorRef)}
                      </span>
                      {checked
                        ? <input type="text" inputMode="decimal" placeholder="0,00" value={selecionados[key]} onChange={e => setValorUnit(key, e.target.value)}
                            style={{...IS,width:100,textAlign:"right",padding:"3px 6px",fontSize:12,color:"#8b5cf6",fontWeight:600}}/>
                        : <span style={{width:100}}/>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {jogosComServicos.length === 0 && <p style={{color:T.textSm,fontSize:12}}>Todos os serviços já possuem NF</p>}
          {selKeys.length > 0 && (
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,padding:"0 8px"}}>
              <span style={{color:T.textMd,fontSize:11}}>{selKeys.length} serviço{selKeys.length>1?"s":""}{jogoIds.length>1?` em ${jogoIds.length} jogos`:""}</span>
              <span style={{fontSize:14,fontWeight:700,color:"#8b5cf6"}}>Total NF: {fmt(totalNF)}</span>
            </div>
          )}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Fornecedor</label>
            <FornecedorInput value={form.fornecedor} onChange={v => set("fornecedor", v)} fornecedores={fornecedores} T={T}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Nº da Nota</label>
            <input value={form.numeroNF} onChange={e => { const p = patchNumeroNF(e.target.value); set("numeroNF", p.numeroNF); set("chaveAcesso", p.chaveAcesso); }} style={IS} title="Pode colar a chave de acesso da NFS-e: o número é extraído automaticamente"/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>
              Valor NF (R$){selKeys.length > 1 && <span style={{color:T.textSm,fontSize:10,marginLeft:6}}>— edite por serviço acima</span>}
            </label>
            {selKeys.length <= 1
              ? <input type="text" inputMode="decimal" placeholder="0,00" value={form.valorNF} onChange={e => setValorNFForm(e.target.value)} style={IS}/>
              : <input readOnly value={fmt(totalNF)} style={{...IS, opacity:0.55, cursor:"not-allowed"}}/>}
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Data Emissão</label>
            <DateInput value={form.dataEmissao} onChange={v => set("dataEmissao", v)} style={IS}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Data Envio</label>
            <DateInput value={form.dataEnvio} onChange={v => set("dataEnvio", v)} style={IS}/>
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Observações</label>
          <input value={form.obs} onChange={e => set("obs", e.target.value)} style={IS}/>
        </div>

        {/* Upload de arquivo */}
        <AnexoNF arquivo={arquivo} setArquivo={setArquivo} T={T} onVerificacao={setAvisoArquivo}/>

        {/* Código gerado */}
        {(form.numeroNF || totalNF > 0) && (
          <div style={{background:T.bg,borderRadius:8,padding:"12px 16px",marginBottom:16}}>
            <p style={{color:T.textSm,fontSize:11,margin:"0 0 4px"}}>Código do arquivo:</p>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <code style={{fontSize:15,fontWeight:700,color:"#22c55e",letterSpacing:0.5,flex:1}}>{codigo}</code>
              <button onClick={() => {navigator.clipboard.writeText(codigo);}} style={{...btnStyle,background:T.border,padding:"4px 10px",fontSize:10,color:T.text}}>Copiar</button>
            </div>
          </div>
        )}

        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{...btnStyle,background:"#475569"}}>Cancelar</button>
          <button onClick={handleSave} disabled={selecionados.length===0||uploading} style={{...btnStyle,background:selecionados.length>0?"#22c55e":"#475569",opacity:selecionados.length>0&&!uploading?1:0.5}}>
            {uploading ? "Enviando..." : "Salvar NF"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal para NF avulsa (não prevista) ─────────────────────────────────────
function NFAvulsaModal({ jogos, fornecedores, onSave, onClose, T }) {
  const IS = iSty(T);
  const divulgados = jogos.filter(j => j.mandante !== "A definir");
  const [jogoId, setJogoId] = useState(divulgados[0]?.id || null);
  const jogo = divulgados.find(j => j.id === parseInt(jogoId)) || divulgados[0];
  const [form, setForm] = useState({
    numeroNF: "", fornecedor: "", valorNF: 0, dataEmissao: "", dataEnvio: "", obs: "", descricao: "",
  });
  const [arquivo, setArquivo] = useState(null);
  const [avisoArquivo, setAvisoArquivo] = useState(null);   // { hash, matches } do AnexoNF — arquivo já em outra nota?
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const set = (k, v) => setForm(f => ({...f, [k]: v}));

  const codigo = jogo ? gerarCodigo(jogo.rodada, jogo.mandante, jogo.visitante, form.valorNF, form.numeroNF) : "";

  const handleSave = async () => {
    if (!jogo || (!form.numeroNF && !form.fornecedor)) return;
    if (arquivo && !confirmarArquivoRepetido(avisoArquivo, "registrar esta NF")) return;   // mesmo PDF já em outra nota
    setUploading(true);
    const notaId = Date.now();
    let hasFile = false, fileHash = null;
    if (arquivo) {
      try {
        const dataUrl = await fileToDataUrl(arquivo);
        fileHash = await saveNFFile(notaId, dataUrl);
        hasFile = true;
      } catch(_){}
    }
    const valorNF = parseValorBR(form.valorNF);
    onSave({
      id: notaId,
      codigo,
      ...form,
      valorNF,
      rodada: jogo.rodada,
      jogoId: jogo.id,
      jogoLabel: `${jogo.mandante} x ${jogo.visitante}`,
      mandante: jogo.mandante,
      visitante: jogo.visitante,
      servicosKeys: [`${jogo.id}_extra`],
      servicosLabels: [form.descricao || "Avulsa"],
      servicosValores: { extra: valorNF },
      tipo: "avulsa",
      status: "Conferida",
      hasFile,
      ...(fileHash ? { fileHash } : {}),
    });
    setUploading(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000099",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:T.card,borderRadius:16,padding:28,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}}>
        <h3 style={{margin:"0 0 4px",fontSize:16,color:T.text}}>NF Avulsa / Não Prevista</h3>
        <p style={{color:T.textSm,fontSize:12,margin:"0 0 16px"}}>Para notas que não estavam previstas ou com valores diferentes</p>

        <div style={{marginBottom:12}}>
          <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Jogo</label>
          <select value={jogoId} onChange={e => setJogoId(e.target.value)} style={IS}>
            {divulgados.map(j => <option key={j.id} value={j.id}>Rd {j.rodada} · {j.mandante} x {j.visitante}</option>)}
          </select>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Fornecedor</label>
            <FornecedorInput value={form.fornecedor} onChange={v => set("fornecedor", v)} fornecedores={fornecedores} T={T}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Nº da Nota</label>
            <input value={form.numeroNF} onChange={e => { const p = patchNumeroNF(e.target.value); set("numeroNF", p.numeroNF); set("chaveAcesso", p.chaveAcesso); }} style={IS} title="Pode colar a chave de acesso da NFS-e: o número é extraído automaticamente"/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Valor NF (R$)</label>
            <input type="text" inputMode="decimal" placeholder="0,00" value={form.valorNF} onChange={e => set("valorNF", e.target.value)} style={IS}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Data Emissão</label>
            <DateInput value={form.dataEmissao} onChange={v => set("dataEmissao", v)} style={IS}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Data Envio</label>
            <DateInput value={form.dataEnvio} onChange={v => set("dataEnvio", v)} style={IS}/>
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Descrição do serviço</label>
          <input value={form.descricao} onChange={e => set("descricao", e.target.value)} placeholder="Ex: Frete extra, serviço adicional..." style={IS}/>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{color:T.textMd,fontSize:12,display:"block",marginBottom:4}}>Observações</label>
          <input value={form.obs} onChange={e => set("obs", e.target.value)} style={IS}/>
        </div>

        {/* Upload */}
        <AnexoNF arquivo={arquivo} setArquivo={setArquivo} T={T} onVerificacao={setAvisoArquivo}/>

        {(form.numeroNF || parseValorBR(form.valorNF) > 0) && (
          <div style={{background:T.bg,borderRadius:8,padding:"12px 16px",marginBottom:16}}>
            <p style={{color:T.textSm,fontSize:11,margin:"0 0 4px"}}>Código do arquivo:</p>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <code style={{fontSize:15,fontWeight:700,color:"#22c55e",letterSpacing:0.5,flex:1}}>{codigo}</code>
              <button onClick={() => {navigator.clipboard.writeText(codigo);}} style={{...btnStyle,background:T.border,padding:"4px 10px",fontSize:10,color:T.text}}>Copiar</button>
            </div>
          </div>
        )}

        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{...btnStyle,background:"#475569"}}>Cancelar</button>
          <button onClick={handleSave} disabled={uploading} style={{...btnStyle,background:"#f59e0b",color:"#000",opacity:uploading?0.5:1}}>
            {uploading ? "Enviando..." : "Salvar NF Avulsa"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── RECEBIDAS (submissões do formulário externo) ────────────────────────────
function RecebidasTab({ notas, notasMensais = [], addNota, addNotaMensal, jogos, fornecedores = [], T, submissionsKey = 'nf_submissions', historicoKey = 'nf_historico', formHash = '#formulario' }) {
  const [submissions, setSubmissions] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editServicos, setEditServicos] = useState({});
  const [viewTab, setViewTab] = useState("pendentes"); // "pendentes" | "historico"
  const [previewSub, setPreviewSub] = useState(null);
  const [previewSrc, setPreviewSrc] = useState(null);
  const [previewLoadingNF, setPreviewLoadingNF] = useState(false);
  const [processing, setProcessing] = useState({}); // sub.id -> true enquanto aprova/rejeita
  const opQueue = useRef(Promise.resolve());

  const openPreviewSub = async (sub) => {
    setPreviewSub(sub);
    setPreviewSrc(null);
    setPreviewLoadingNF(true);
    const data = await getNFFile(sub.id);
    setPreviewSrc(data || null);
    setPreviewLoadingNF(false);
  };

  const divulgados = jogos.filter(j => j.mandante !== "A definir");

  const loadAll = () => {
    setLoading(true);
    Promise.all([getState(submissionsKey), getState(historicoKey)]).then(([s, h]) => {
      setSubmissions(s || []);
      setHistorico(h || []);
      setLoading(false);
    });
  };

  useEffect(() => { loadAll(); }, []);

  // Recebidas não tem realtime (só carrega ao montar + botão "Atualizar"), e a
  // fila é compartilhada entre abas/pessoas. As mudanças usam as operações
  // ATÔMICAS do servidor (appendState/removeFromStateList em lib/supabase.js),
  // que serializam escritas concorrentes no Postgres — ninguém sobrescreve
  // ninguém. A opQueue ainda serializa as ações DESTE client, pra duas decisões
  // rápidas não intercalarem seus passos (remover → nota → histórico).
  const enqueue = (fn) => {
    const run = opQueue.current.then(fn, fn);
    opQueue.current = run.catch(() => {});
    return run;
  };

  // Duplicatas de uma submissão: outras pendentes da fila + notas já aprovadas
  // (de jogo E mensais — a NF 16 duplicada era mensal e a checagem antiga não
  // olhava lá). Irmãs da mesma submissão multi-jogo (mesmo clientRef) são
  // legítimas — a mesma NF cobre 2 jogos — e ficam de fora.
  const dupsDaSubmissao = (sub) => acharDuplicatasNF(
    { fornecedor: sub.fornecedor, numeroNF: sub.numeroNF, fileHash: sub.fileHash },
    [
      { origem: "pendente na fila", notas: submissions.filter(s => s.id !== sub.id && (!sub.clientRef || s.clientRef !== sub.clientRef)) },
      { origem: "nota de jogo aprovada", notas: notas.filter(n => !sub.clientRef || n.clientRef !== sub.clientRef) },
      { origem: "nota mensal aprovada", notas: notasMensais },
    ]
  );

  const startEdit = (sub) => {
    setEditingId(sub.id);
    if (sub.tipo === "mensal") {
      setEditServicos({ _mensal: sub.valorNF || 0 });
    } else if (sub.servicosDetalhe) {
      // Submissão com detalhe granular ("jogoId_subKey"): edita o próprio
      // detalhe — editar só o agregado por subKey perderia a quebra por jogo.
      setEditServicos({...sub.servicosDetalhe});
    } else {
      setEditServicos({...(sub.servicosValores || {})});
    }
  };

  const toggleEditServico = (sub, subKey) => {
    setEditServicos(prev => {
      const next = {...prev};
      if (next[subKey] !== undefined) { delete next[subKey]; }
      else { next[subKey] = 0; }
      return next;
    });
  };

  const setEditValor = (subKey, val) => {
    setEditServicos(prev => ({...prev, [subKey]: val}));
  };

  // Monta a nota final a partir da submissão (com os valores editados, se houver).
  // A nota sai com decisao:"aprovada" — o addNota do TabNotas usa isso pra NÃO
  // gravar a entrada "registrada" no histórico (o aprovar já grava a "aprovada";
  // antes entravam as duas, com o mesmo id, e o histórico ficava duplicado).
  const montarNotaAprovada = (subOriginal, editValsCrus) => {
    // O estado de edição guarda o texto digitado (pra aceitar "4.999,12");
    // aqui vira número de vez.
    const editVals = editValsCrus
      ? Object.fromEntries(Object.entries(editValsCrus).map(([k, v]) => [k, parseValorBR(v)]))
      : null;
    // Grafia do fornecedor vira a canônica do cadastro na aprovação — o
    // formulário público aceita texto livre, e grafias divergentes fragmentam
    // os agrupamentos por fornecedor (Rastreabilidade) além de dificultarem
    // ver duplicata a olho nu (caso da NF 16 paga em dobro, 08/2026).
    const sub = { ...subOriginal, fornecedor: grafiaCanonica(subOriginal.fornecedor, fornecedores) };
    const decididas = { decisao: "aprovada", decidoEm: new Date().toISOString() };
    if (sub.tipo === "mensal") {
      const valorNF = editVals ? (editVals._mensal || 0) : (sub.valorNF || 0);
      const nfNum = (sub.numeroNF || "SN").replace(/\s/g, "");
      return {
        ...sub,
        ...decididas,
        valorNF,
        valor: valorNF,
        categoria: sub.servicoNome || sub.servicosLabels?.[0] || "",
        status: "Conferida",
        codigo: `MENSAL_${(sub.mesLabel||"").replace(/\s/g,"")}_${Math.round(valorNF)}_NF${nfNum}`,
      };
    }
    {
      const sv = editVals || (sub.servicosValores || {});
      const isMultiJogo = Array.isArray(sub.jogoIds) && sub.jogoIds.length > 1;
      // A edição do operador tem precedência sobre o detalhe do formulário:
      // quando a submissão tem servicosDetalhe, o editVals já vem por
      // "jogoId_subKey" (ver startEdit) — antes o detalhe ORIGINAL vencia aqui
      // e a nota aprovada voltava com os valores errados de antes da correção.
      const servicosDetalhe = (editVals && sub.servicosDetalhe)
        ? {...editVals}
        : sub.servicosDetalhe || (isMultiJogo
          ? Object.fromEntries(Object.entries(sv).map(([k, v]) => [k.includes("_") ? k : `${sub.jogoId}_${k}`, v]))
          : null);
      const valorNF = servicosDetalhe
        ? Object.values(servicosDetalhe).reduce((s, v) => s + (v || 0), 0)
        : Object.values(sv).reduce((s, v) => s + (v || 0), 0);
      const jogo = divulgados.find(j => j.id === sub.jogoId) || divulgados.find(j => (sub.jogoIds || []).includes(j.id));
      const allServicos = jogo ? extrairServicos(jogo) : [];
      const servicosKeys = servicosDetalhe ? Object.keys(servicosDetalhe) : Object.keys(sv).map(sk => `${sub.jogoId}_${sk}`);
      const servicosValores = servicosDetalhe
        ? Object.entries(servicosDetalhe).reduce((acc, [k, v]) => {
            const subKey = k.split("_").slice(1).join("_");
            acc[subKey] = (acc[subKey] || 0) + (v || 0);
            return acc;
          }, {})
        : sv;
      // Com edição, os labels são recalculados — os do formulário podem não
      // refletir serviços adicionados/removidos pelo operador.
      const servicosLabels = (!editVals && sub.servicosLabels) || Object.keys(servicosValores).map(sk => {
        const s = allServicos.find(x => x.subKey === sk);
        return s ? s.subLabel : labelServico(sk);
      });
      const mandante = jogo?.mandante || sub.jogoLabel?.split(/\s*x\s*/)[0] || "";
      const visitante = jogo?.visitante || sub.jogoLabel?.split(/\s*x\s*/)[1] || "";
      return {
        ...sub,
        ...decididas,
        servicosValores,
        ...(servicosDetalhe ? { servicosDetalhe } : {}),
        servicosKeys,
        servicosLabels,
        valorNF,
        valorFiscalTotal: valorNF,
        tipo: "prevista",
        status: "Conferida",
        codigo: gerarCodigo(sub.rodada, mandante, visitante, valorNF, sub.numeroNF),
      };
    }
  };

  const aprovar = async (sub) => {
    if (processing[sub.id]) return;
    // Trava de duplicata ANTES de tirar a submissão da fila: aprovar uma NF que
    // já existe (mesmo nº/arquivo) exige confirmação explícita do operador.
    if (!confirmarDuplicatas(dupsDaSubmissao(sub), "aprovar esta NF")) return;
    const editVals = editingId === sub.id ? { ...editServicos } : null;
    setProcessing(p => ({ ...p, [sub.id]: true }));
    setEditingId(null);
    setSubmissions(subs => subs.filter(s => s.id !== sub.id)); // some da lista já no clique
    try {
      await enqueue(async () => {
        // Remoção ATÔMICA no servidor: se retornar false, a submissão já tinha
        // saído da fila (duplo clique, outra aba, outra pessoa) e NÃO aprovamos
        // de novo — era isso que gravava duas notas iguais. Duas pessoas
        // aprovando itens diferentes ao mesmo tempo também não se sobrescrevem.
        const removed = await removeFromStateList(submissionsKey, sub.id);
        if (!removed) return;
        const nota = montarNotaAprovada(sub, editVals);
        if (sub.tipo === "mensal" && addNotaMensal) addNotaMensal(nota);
        else addNota(nota);
        // Histórico por último, best-effort: a aprovação em si já está de pé.
        // clientRef sai da entrada — ele é chave de dedupe dos ENVIOS do
        // formulário; deixá-lo aqui faria o irmão multi-jogo ser engolido.
        try {
          const { clientRef: _cr, ...subLimpo } = sub;
          const entry = { ...subLimpo, decisao: "aprovada", decidoEm: new Date().toISOString() };
          await appendState(historicoKey, entry);
          setHistorico(h => [...h, entry]);
        } catch (err) {
          console.error("Aprovada, mas falhou ao registrar no histórico:", err);
        }
      });
    } catch (err) {
      console.error("Falha ao aprovar submissão:", err);
      alert("Falha ao aprovar a NF — nada foi gravado. Tente de novo.\n\n" + (err?.message || err));
      loadAll(); // volta pro estado real do servidor (o item reaparece)
    } finally {
      setProcessing(p => { const n = { ...p }; delete n[sub.id]; return n; });
    }
  };

  const rejeitar = async (sub) => {
    if (processing[sub.id]) return;
    if (!window.confirm("Rejeitar esta submissão?")) return;
    setProcessing(p => ({ ...p, [sub.id]: true }));
    setSubmissions(subs => subs.filter(s => s.id !== sub.id));
    try {
      await enqueue(async () => {
        const removed = await removeFromStateList(submissionsKey, sub.id);
        if (!removed) return; // já decidida em outro lugar
        const { clientRef: _cr, ...subLimpo } = sub;
        const entry = { ...subLimpo, decisao: "rejeitada", decidoEm: new Date().toISOString() };
        try {
          await appendState(historicoKey, entry);
          setHistorico(h => [...h, entry]);
        } catch (err) {
          // Sem registro no histórico a NF sumiria sem rastro — devolve pra fila.
          await appendState(submissionsKey, sub).catch(() => {});
          throw err;
        }
      });
    } catch (err) {
      console.error("Falha ao rejeitar submissão:", err);
      alert("Falha ao rejeitar — a NF continua na fila. Tente de novo.\n\n" + (err?.message || err));
      loadAll();
    } finally {
      setProcessing(p => { const n = { ...p }; delete n[sub.id]; return n; });
    }
  };

  const recuperar = async (item) => {
    if (processing[item.id]) return;
    setProcessing(p => ({ ...p, [item.id]: true }));
    setHistorico(h => h.filter(x => x.id !== item.id)); // otimista
    try {
      await enqueue(async () => {
        // Volta pra fila sem clientRef (senão o dedupe de reenvio do formulário
        // engoliria a recuperação) e sem os campos de decisão.
        const { clientRef: _cr, ...limpo } = item;
        // Rejeitar preserva o arquivo, então recuperar traz o PDF de volta
        // normalmente. Já excluir a NOTA apaga o PDF (deleteNota) e manda a nota
        // pro histórico — recuperar essa não ressuscita arquivo nenhum. Por isso
        // conferimos: só rebaixa hasFile quando dá pra afirmar que sumiu (null =
        // consulta falhou, mantém como estava pra não esconder arquivo bom).
        const existe = item.hasFile ? await nfFileExiste(item.id) : false;
        const devolvida = {
          ...limpo,
          hasFile: existe === null ? item.hasFile : existe,
          decisao: undefined, decidoEm: undefined,
        };
        const naFila = (await getState(submissionsKey)) || [];
        if (!naFila.some(s => s.id === item.id)) {
          await appendState(submissionsKey, devolvida);
        }
        await removeFromStateList(historicoKey, item.id);
        setHistorico(h => h.filter(x => x.id !== item.id));
        setSubmissions(prev => prev.some(s => s.id === item.id) ? prev : [...prev, devolvida]);
      });
    } catch (err) {
      console.error("Falha ao recuperar submissão:", err);
      alert("Falha ao recuperar — tente de novo.\n\n" + (err?.message || err));
      loadAll();
    } finally {
      setProcessing(p => { const n = { ...p }; delete n[item.id]; return n; });
    }
  };

  const excluirDefinitivo = async (id) => {
    if (!window.confirm("Excluir definitivamente do histórico?")) return;
    // A entrada do histórico compartilha o id com a nota que a originou. Se essa
    // nota está viva (foi recuperada e reaprovada), apagar o arquivo aqui tiraria
    // o PDF de uma NF em uso — só apaga quando ninguém mais aponta pra ele.
    const emUso = (notas || []).some(n => n.id === id);
    if (!emUso) deleteNFFile(id);
    setHistorico(h => h.filter(x => x.id !== id)); // otimista
    try {
      await enqueue(() => removeFromStateList(historicoKey, id));
    } catch (err) {
      console.error("Falha ao excluir do histórico:", err);
      loadAll();
    }
  };

  if (loading) return <p style={{color:T.textSm,padding:20}}>Carregando submissões...</p>;

  // O nf_historico é trilha de auditoria de TODAS as notas (registrada, avulsa,
  // excluída...). Aqui só interessam as decisões da fila do formulário — sem esse
  // filtro, cada NF registrada manualmente aparecia aqui rotulada de "Rejeitada".
  const historicoForm = historico.filter(x => x.decisao === "aprovada" || x.decisao === "rejeitada");

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{display:"flex",gap:4}}>
          {[{k:"pendentes",l:`Pendentes (${submissions.length})`},{k:"historico",l:`Histórico (${historicoForm.length})`}].map(t => (
            <button key={t.k} onClick={() => setViewTab(t.k)} style={{padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
              background:viewTab===t.k?"#8b5cf6":"transparent",color:viewTab===t.k?"#fff":T.textMd}}>
              {t.l}
            </button>
          ))}
        </div>
        <button onClick={loadAll} style={{...btnStyle,background:T.border,padding:"5px 14px",fontSize:11,color:T.text}}>Atualizar</button>
      </div>
      {viewTab === "pendentes" && submissions.length === 0 && (
        <div style={{background:T.card,borderRadius:12,padding:40,textAlign:"center"}}>
          <p style={{color:T.textSm,fontSize:13,margin:0}}>Nenhuma NF recebida pelo formulário externo</p>
          <p style={{color:T.textSm,fontSize:11,margin:"8px 0 0"}}>Link do formulário: <code style={{color:"#22c55e"}}>{window.location.origin}/{formHash}</code></p>
        </div>
      )}
      {viewTab === "pendentes" && submissions.map(sub => {
        const isEditing = editingId === sub.id;
        const busy = !!processing[sub.id];
        const jogo = divulgados.find(j => j.id === sub.jogoId);
        const allServicos = jogo ? extrairServicos(jogo) : [];
        const svAtual = isEditing ? editServicos : (sub.servicosValores || {});
        const valorAtual = sub.tipo === "mensal"
          ? (isEditing ? parseValorBR(editServicos._mensal) : (sub.valorNF || 0))
          : Object.values(svAtual).reduce((s, v) => s + parseValorBR(v), 0);
        // Mesmo fornecedor + nº de NF (grafia normalizada) ou mesmo arquivo em
        // outra pendente ou nota já aprovada (jogo OU mensal) = provável reenvio.
        // A versão antiga só olhava `notas` e exigia grafia idêntica — foi assim
        // que a NF 16 do João Marcos (mensal, "joão marcos" × "João Marcos")
        // passou e acabou paga em dobro (08/2026).
        const possivelDuplicata = dupsDaSubmissao(sub).length > 0;

        return (
          <div key={sub.id} style={{background:T.card,borderRadius:12,padding:"16px 20px",marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:12}}>
              <div>
                <span style={{fontWeight:700,fontSize:14,color:T.text}}>{sub.fornecedor}</span>
                {sub.tipo === "mensal"
                  ? <span style={{color:T.textSm,fontSize:12,marginLeft:12}}>{sub.mesLabel} · {sub.servicoNome}</span>
                  : <span style={{color:T.textSm,fontSize:12,marginLeft:12}}>{sub.jogoLabel} · Rd {sub.rodada}</span>}
                {sub.numeroNF && <span style={{color:T.textSm,fontSize:11,marginLeft:8}}>NF {sub.numeroNF}</span>}
                {possivelDuplicata && <span style={{marginLeft:8}}><Pill label="Possível duplicata" color="#f59e0b"/></span>}
              </div>
              <span style={{color:"#8b5cf6",fontWeight:700,fontSize:16}}>{fmt(valorAtual)}</span>
            </div>

            {/* Serviços — modo visualização ou edição */}
            {!isEditing ? (
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                {sub.tipo === "mensal"
                  ? <Pill label={`${sub.servicoNome}: ${fmt(sub.valorNF || 0)}`} color="#06b6d4"/>
                  : Object.entries(svAtual).map(([sk, val]) => {
                      const label = allServicos.find(x => x.subKey === sk)?.subLabel || sk;
                      return <Pill key={sk} label={`${label}: ${fmt(val)}`} color="#06b6d4"/>;
                    })}
              </div>
            ) : (
              <div style={{background:T.bg,borderRadius:8,padding:10,marginBottom:12}}>
                {sub.tipo === "mensal" ? (<>
                  <p style={{color:T.textMd,fontSize:11,fontWeight:600,margin:"0 0 8px"}}>Editar valor:</p>
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0"}}>
                    <span style={{flex:1,fontSize:12,color:T.text,fontWeight:600}}>{sub.servicoNome}</span>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={editServicos._mensal ?? ""} onChange={e => setEditValor("_mensal", e.target.value)}
                      style={{background:T.card,border:`1px solid ${T.muted}`,borderRadius:6,color:"#8b5cf6",padding:"4px 8px",width:110,textAlign:"right",fontSize:13,fontWeight:700}} autoFocus/>
                  </div>
                </>) : sub.servicosDetalhe ? (<>
                  <p style={{color:T.textMd,fontSize:11,fontWeight:600,margin:"0 0 8px"}}>Editar serviços e valores:</p>
                  {(sub.jogoIds?.length ? sub.jogoIds : [sub.jogoId]).map(jid => {
                    const j = divulgados.find(x => x.id === jid);
                    const servicosJogo = j ? extrairServicos(j) : [];
                    // Lista os serviços do jogo + os que vieram no envio (mesmo fora da lista)
                    const keys = new Set(servicosJogo.map(s => s.subKey));
                    Object.keys(sub.servicosDetalhe).forEach(k => {
                      if (String(k).startsWith(`${jid}_`)) keys.add(String(k).slice(String(jid).length + 1));
                    });
                    const multi = (sub.jogoIds || []).length > 1;
                    return (
                      <div key={jid} style={{marginBottom:multi?8:0}}>
                        {multi && <p style={{color:T.textSm,fontSize:11,fontWeight:700,margin:"4px 0"}}>{j ? `${j.mandante} x ${j.visitante}` : `Jogo ${jid}`}</p>}
                        {[...keys].map(sk => {
                          const key = `${jid}_${sk}`;
                          const ativo = editServicos[key] !== undefined;
                          const label = servicosJogo.find(x => x.subKey === sk)?.subLabel || labelServico(sk);
                          return (
                            <div key={key} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,padding:"4px 0"}}>
                              <input type="checkbox" checked={ativo} onChange={() => toggleEditServico(sub, key)}/>
                              <span style={{flex:1,fontSize:12,color:ativo?T.text:T.textSm}}>{label}</span>
                              {ativo && (
                                <input type="text" inputMode="decimal" placeholder="0,00" value={editServicos[key]} onChange={e => setEditValor(key, e.target.value)}
                                  style={{background:T.card,border:`1px solid ${T.muted}`,borderRadius:6,color:"#8b5cf6",padding:"4px 8px",width:90,textAlign:"right",fontSize:12,fontWeight:600}}/>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </>) : (<>
                  <p style={{color:T.textMd,fontSize:11,fontWeight:600,margin:"0 0 8px"}}>Editar serviços e valores:</p>
                  {allServicos.map(s => {
                    const ativo = editServicos[s.subKey] !== undefined;
                    return (
                      <div key={s.subKey} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,padding:"4px 0"}}>
                        <input type="checkbox" checked={ativo} onChange={() => toggleEditServico(sub, s.subKey)}/>
                        <span style={{flex:1,fontSize:12,color:ativo?T.text:T.textSm}}>{s.subLabel}</span>
                        {ativo && (
                          <input type="text" inputMode="decimal" placeholder="0,00" value={editServicos[s.subKey]} onChange={e => setEditValor(s.subKey, e.target.value)}
                            style={{background:T.card,border:`1px solid ${T.muted}`,borderRadius:6,color:"#8b5cf6",padding:"4px 8px",width:90,textAlign:"right",fontSize:12,fontWeight:600}}/>
                        )}
                      </div>
                    );
                  })}
                </>)}
                <div style={{borderTop:`1px solid ${T.border}`,marginTop:6,paddingTop:6,textAlign:"right"}}>
                  <span style={{fontSize:13,fontWeight:700,color:"#8b5cf6"}}>Total: {fmt(valorAtual)}</span>
                </div>
              </div>
            )}

            {/* Leitura automática do PDF anexado × dados digitados (só leitura) */}
            {sub.hasFile && <LeituraNF id={sub.id} carregar={() => getNFFile(sub.id)} nota={{...sub, valorNF: valorAtual}} fornecedores={fornecedores} T={T}/>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:12,color:T.textSm,marginBottom:12}}>
              {sub.dataEmissao && <span>Emissão: {sub.dataEmissao}</span>}
              {sub.dataEnvio && <span>Envio: {sub.dataEnvio}</span>}
              {sub.obs && <span>Obs: {sub.obs}</span>}
              {sub.hasFile && <Pill label="Arquivo anexo" color="#22c55e"/>}
              {/* Fornecedor anexou (há assinatura do arquivo) mas o PDF não foi gravado — caso de 09-10/09/2026 (RLS recusou o upsert em silêncio). */}
              {!sub.hasFile && sub.fileHash && <Pill label="PDF não foi gravado — falha do sistema (09–10/09)" color="#dc2626"/>}
              <span style={{color:T.textSm}}>Enviado: {new Date(sub.enviadoEm).toLocaleDateString("pt-BR")}</span>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {sub.hasFile && <button onClick={() => openPreviewSub(sub)} style={{...btnStyle,background:"#0ea5e9",padding:"6px 20px",fontSize:12}}>Ver NF</button>}
              {!isEditing && <button disabled={busy} onClick={() => startEdit(sub)} style={{...btnStyle,background:"#3b82f6",padding:"6px 20px",fontSize:12,opacity:busy?0.5:1}}>Editar</button>}
              {isEditing && <button disabled={busy} onClick={() => setEditingId(null)} style={{...btnStyle,background:"#475569",padding:"6px 20px",fontSize:12,opacity:busy?0.5:1}}>Cancelar</button>}
              <button disabled={busy} onClick={() => aprovar(sub)} style={{...btnStyle,background:"#22c55e",padding:"6px 20px",fontSize:12,opacity:busy?0.6:1,cursor:busy?"wait":"pointer"}}>{busy ? "Aprovando..." : "Aprovar"}</button>
              <button disabled={busy} onClick={() => rejeitar(sub)} style={{...btnStyle,background:"#7f1d1d",padding:"6px 20px",fontSize:12,opacity:busy?0.6:1,cursor:busy?"wait":"pointer"}}>Rejeitar</button>
            </div>
          </div>
        );
      })}

      {/* Histórico */}
      {viewTab === "historico" && (
        <>
          {historicoForm.length === 0 && (
            <div style={{background:T.card,borderRadius:12,padding:40,textAlign:"center"}}>
              <p style={{color:T.textSm,fontSize:13,margin:0}}>Nenhum registro no histórico</p>
            </div>
          )}
          {[...historicoForm].reverse().map((item, i) => (
            <div key={`${item.id}_${item.decisao}_${item.decidoEm || i}`} style={{background:T.card,borderRadius:12,padding:"14px 20px",marginBottom:10,opacity:item.decisao==="rejeitada"?0.7:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <Pill label={item.decisao==="aprovada"?"Aprovada":"Rejeitada"} color={item.decisao==="aprovada"?"#22c55e":"#ef4444"}/>
                  <span style={{fontWeight:700,fontSize:13,color:T.text}}>{item.fornecedor}</span>
                  <span style={{color:T.textSm,fontSize:11}}>{item.tipo === "mensal" ? `${item.mesLabel || ""}${item.servicoNome ? ` · ${item.servicoNome}` : ""}` : `${item.jogoLabel || ""}${item.rodada ? ` · Rd ${item.rodada}` : ""}`}</span>
                </div>
                <span style={{color:"#8b5cf6",fontWeight:700,fontSize:14}}>{fmt(item.valorNF)}</span>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                {(item.servicosLabels||[]).map(s => <Pill key={s} label={s} color="#06b6d4"/>)}
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:11,color:T.textSm,marginBottom:10}}>
                {item.numeroNF && <span>NF {item.numeroNF}</span>}
                {item.decidoEm && <span>{item.decisao==="aprovada"?"Aprovada":"Rejeitada"} em {new Date(item.decidoEm).toLocaleDateString("pt-BR")}</span>}
                {item.enviadoEm && <span>Enviada em {new Date(item.enviadoEm).toLocaleDateString("pt-BR")}</span>}
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {item.hasFile && <button onClick={() => openPreviewSub(item)} style={{...btnStyle,background:"#0ea5e9",padding:"5px 16px",fontSize:11}}>Ver NF</button>}
                <button onClick={() => recuperar(item)} style={{...btnStyle,background:"#3b82f6",padding:"5px 16px",fontSize:11}}>Recuperar</button>
                <button onClick={() => excluirDefinitivo(item.id)} style={{...btnStyle,background:"#7f1d1d",padding:"5px 16px",fontSize:11}}>Excluir</button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── MODAL PREVIEW NF RECEBIDA ── */}
      {previewSub && (
        <div style={{position:"fixed",inset:0,background:"#000000dd",zIndex:200,display:"flex",flexDirection:"column"}}
          onClick={() => { setPreviewSub(null); setPreviewSrc(null); }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",flexShrink:0}}
            onClick={e => e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <span style={{color:"#fff",fontWeight:700,fontSize:14}}>{previewSub.fornecedor}</span>
              <span style={{color:"#8b5cf6",fontWeight:600,fontSize:13}}>{fmt(previewSub.valorNF || Object.values(previewSub.servicosValores||{}).reduce((s,v)=>s+(v||0),0))}</span>
              {previewSub.jogoLabel && <span style={{color:"#94a3b8",fontSize:12}}>{previewSub.jogoLabel}{previewSub.rodada ? ` · Rd ${previewSub.rodada}` : ""}</span>}
              {previewSub.mesLabel && <span style={{color:"#94a3b8",fontSize:12}}>{previewSub.mesLabel}{previewSub.servicoNome ? ` · ${previewSub.servicoNome}` : ""}</span>}
              {previewSub.numeroNF && <span style={{color:"#94a3b8",fontSize:12}}>NF {previewSub.numeroNF}</span>}
            </div>
            <div style={{display:"flex",gap:8}}>
              {previewSrc && <a href={previewSrc} download={`NF_${previewSub.fornecedor}`} style={{...btnStyle,background:"#3b82f6",padding:"6px 14px",fontSize:12,textDecoration:"none"}}>Download</a>}
              <button onClick={() => { setPreviewSub(null); setPreviewSrc(null); }} style={{...btnStyle,background:"#475569",padding:"6px 14px",fontSize:12}}>Fechar</button>
            </div>
          </div>
          <div style={{padding:"0 20px",flexShrink:0}} onClick={e => e.stopPropagation()}>
            <LeituraNF id={previewSub.id} carregar={() => getNFFile(previewSub.id)} nota={previewSub} fornecedores={fornecedores} T={{...T, textSm:"#94a3b8"}} compacto/>
          </div>
          <div style={{flex:1,padding:"0 20px 20px",minHeight:0}} onClick={e => e.stopPropagation()}>
            {previewLoadingNF ? (
              <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <p style={{color:"#94a3b8",fontSize:16}}>Carregando...</p>
              </div>
            ) : !previewSrc ? (
              <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <p style={{color:"#94a3b8",fontSize:16}}>Arquivo não encontrado</p>
              </div>
            ) : previewSrc.startsWith("data:application/pdf") ? (
              <iframe src={previewSrc} style={{width:"100%",height:"100%",border:"none",borderRadius:12,background:"#fff"}}/>
            ) : (
              <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",overflow:"auto"}}>
                <img src={previewSrc} alt="NF" style={{maxWidth:"100%",maxHeight:"100%",borderRadius:12,objectFit:"contain"}}/>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ────────────────────────────────────────────────────
function InlineFornecedor({ value, onChange, fornecedores, T }) {
  const IS = iSty(T);
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(value || "");
  const [focused, setFocused] = useState(false);

  // Sincroniza com o parent somente quando NÃO está focado (evita rollback do realtime)
  useEffect(() => { if (!focused) setLocal(value || ""); }, [value, focused]);

  const v = local;
  const filtered = v.length > 0
    ? fornecedores.filter(f => f.apelido.toLowerCase().includes(v.toLowerCase()) || f.funcao.toLowerCase().includes(v.toLowerCase())).slice(0, 6)
    : [];

  const commit = (val) => { setLocal(val); onChange(val); };

  return (
    <div style={{position:"relative",minWidth:120}}>
      <input value={v}
        onChange={e => { setLocal(e.target.value); setOpen(true); }}
        onFocus={() => { setFocused(true); setOpen(true); }}
        onBlur={() => setTimeout(() => {
          setOpen(false);
          setFocused(false);
          if (local !== (value || "")) onChange(local); // persiste ao sair
        }, 200)}
        placeholder="—"
        style={{...IS, padding:"3px 6px", fontSize:11, width:"100%", background:"transparent", border:`1px solid transparent`, borderRadius:4}}
        onMouseEnter={e => e.currentTarget.style.borderColor = T.muted}
        onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = "transparent"; }}
      />
      {open && filtered.length > 0 && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:T.card,border:`1px solid ${T.border}`,borderRadius:6,marginTop:2,maxHeight:160,overflowY:"auto",boxShadow:"0 6px 20px rgba(0,0,0,0.3)"}}>
          {filtered.map(f => (
            <div key={f.id} onMouseDown={() => { commit(f.apelido); setOpen(false); }}
              style={{padding:"5px 8px",cursor:"pointer",borderBottom:`1px solid ${T.border}`}}
              onMouseEnter={e => e.currentTarget.style.background = T.bg}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{fontSize:12,fontWeight:600,color:T.text}}>{f.apelido}</span>
              <span style={{fontSize:10,color:T.textSm,marginLeft:6}}>{f.funcao}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TabNotas({ notas, setNotas, jogos, setJogos, fornecedores = [], envios = [], setEnvios, fornecedoresJogo = {}, setFornecedoresJogo, notasMensais = [], setNotasMensais, T, submissionsKey = 'nf_submissions', historicoKey = 'nf_historico', formHash = '#formulario', usarPortal = true, subsExcluirExtra = [], dedupeNotasPorNF = false, role = 'admin', onReembolsoCriado }) {
  const canEdit = role === 'admin';
  const subsExcluir = subsExcluirExtra.length ? new Set([...SUBS_EXCLUIR, ...subsExcluirExtra]) : SUBS_EXCLUIR;
  const { portal: _portalRaw } = usePortalLink('brasileirao', { enabled: usarPortal });
  const portal = usarPortal ? _portalRaw : null;

  // Fornecedores editados à mão na planilha: o mapa __manual (guardado dentro do
  // próprio fornecedoresJogo, então persiste e sincroniza junto) diz quais chaves
  // o sync com o Portal deve RESPEITAR. Sem isso, toda correção manual era
  // sobrescrita pelo valor do Portal no próximo carregamento da aba.
  const manualMap = fornecedoresJogo.__manual; // pode ser undefined; não criar {} novo aqui (identidade entra nos deps do sync)

  // Sincroniza fornecedoresJogo com o Portal (matriz). Converte o nome operacional do Portal
  // no apelido canônico cadastrado no Hub (quando bate por match tolerante).
  // Chaves marcadas em __manual ficam de fora — edição manual tem a palavra final.
  useEffect(() => {
    if (!portal || !setFornecedoresJogo) return;
    const updates = {};
    let changed = false;

    function aplicarSubKey(jogo, subKey) {
      const key = `${jogo.id}_${subKey}`;
      if (manualMap?.[key]) return; // edição manual vence o Portal
      const opers = getOperacionaisPorSubKey(jogo.id, subKey, portal, jogo.categoria);
      if (opers.length === 0) return;
      const canonicos = opers.map(n => {
        const f = findFornecedorTolerante(fornecedores, n);
        return f ? f.apelido : n;
      });
      const portalValor = [...new Set(canonicos)].join(' / ');
      if (fornecedoresJogo[key] !== portalValor) {
        updates[key] = portalValor;
        changed = true;
      }
    }

    jogos.filter(j => j.mandante && j.mandante !== 'A definir').forEach(jogo => {
      CATS.forEach(cat => {
        cat.subs.forEach(sub => {
          if (sub.key === 'sng') return; // tratado como 2 virtuais abaixo
          aplicarSubKey(jogo, sub.key);
        });
      });
      // SNG Host = SNG (mesma linha); Premiere é separada
      aplicarSubKey(jogo, 'sng');
      aplicarSubKey(jogo, 'sng_premiere');
    });
    if (changed) {
      setFornecedoresJogo(prev => ({ ...prev, ...updates }));
    }
    // manualMap nos deps: desmarcar uma chave (voltar ao automático) reaplica o
    // valor do Portal na hora, sem precisar recarregar a página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal, jogos, fornecedores, manualMap]);

  // Edição manual: grava o valor e marca a chave como manual (valor vazio
  // desmarca — o campo volta a seguir o Portal automaticamente).
  const editarFornecedorJogo = (key, v) => {
    setFornecedoresJogo(prev => {
      const manual = { ...(prev.__manual || {}) };
      if (v && v.trim()) manual[key] = true;
      else delete manual[key];
      return { ...prev, [key]: v, __manual: manual };
    });
  };
  const voltarFornecedorAuto = (key) => {
    setFornecedoresJogo(prev => {
      const manual = { ...(prev.__manual || {}) };
      delete manual[key];
      return { ...prev, [key]: "", __manual: manual }; // sync reaplica o Portal em seguida
    });
  };

  const [tab, setTab] = useState("rodada");
  const [rodadaSel, setRodadaSel] = useState(null);
  const [showRegistrar, setShowRegistrar] = useState(null);
  const [showAvulsa, setShowAvulsa] = useState(false);
  const [showLivemode, setShowLivemode] = useState(false);
  const [filtroPlanilha, setFiltroPlanilha] = useState("Todas");
  const [filtroFornecedor, setFiltroFornecedor] = useState("Todos");
  const [preview, setPreview] = useState(null);
  const uploadRef = useRef(null);
  const [uploadTarget, setUploadTarget] = useState(null);

  const handleUploadLater = async (file, nota) => {
    if (!file || !nota) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      const fileHash = await saveNFFile(nota.id, dataUrl);
      // Confirma que o arquivo está mesmo no banco antes de marcar a nota como
      // anexada — sem isso uma gravação que falhou em silêncio deixa a nota
      // prometendo um arquivo inexistente (caso das NFs perdidas em 07-08/2026).
      const gravado = await getNFFile(nota.id);
      if (!gravado) throw new Error("arquivo não persistiu no banco");
      setNotas(ns => ns.map(n => n.id === nota.id ? {...n, hasFile: true, ...(fileHash ? { fileHash } : {})} : n));
    } catch (e) {
      console.error("Upload falhou:", e);
      alert("Não foi possível anexar o arquivo. Tente de novo — a nota segue marcada como sem arquivo.");
    }
    setUploadTarget(null);
  };

  // Corrige a marcação quando o arquivo prometido não existe mais no banco.
  const marcarSemArquivo = (nota) =>
    setNotas(ns => ns.map(n => n.id === nota.id ? {...n, hasFile: false} : n));

  const divulgados = jogos.filter(j => j.mandante !== "A definir");
  const rodadas = Array.from(new Set(divulgados.map(j => j.rodada))).sort((a, b) => a - b);
  const rodadaEfetiva = rodadaSel ?? (rodadas.length ? rodadas[rodadas.length - 1] : 1);
  const jogosRodada = divulgados.filter(j => j.rodada === rodadaEfetiva);

  // Mapa de notaId → número do envio
  const envioMap = useMemo(() => {
    const map = {};
    (envios || []).forEach(e => {
      const info = { numero: e.numero, nome: e.nome, dataPagamento: e.dataPagamento };
      (e.notasIds || []).forEach(id => { map[id] = info; });
    });
    return map;
  }, [envios]);
  const envioLabel = info => info.nome || `Envio ${info.numero}`;

  // Stats
  const allServicos = useMemo(() => {
    return divulgados.flatMap(jogo => {
      const servicos = extrairServicos(jogo, subsExcluir);
      return servicos
        .filter(s => {
          if (!usarPortal) return true; // Paulistão F: exibe todos os serviços provisionados
          const key = `${jogo.id}_${s.subKey}`;
          const hasNF = notas.some(n => n.servicosKeys?.includes(key));
          if (hasNF) return true;
          const forn = fornecedoresJogo[key] || "";
          return !forn || emiteNF(forn);
        })
        .map(s => {
          const key = `${jogo.id}_${s.subKey}`;
          const nota = notas.find(n => n.servicosKeys?.includes(key));
          return { key, rodada: jogo.rodada, status: nota ? "Conferida" : "Pendente" };
        });
    });
  }, [divulgados, notas, fornecedoresJogo]);

  const totalPendente  = allServicos.filter(i => i.status === "Pendente").length;
  const totalConferida = allServicos.filter(i => i.status === "Conferida").length;
  const totalNotas     = countNotasFiscais(notas, { dedupe: dedupeNotasPorNF });
  const totalValor     = sumNotasFiscais(notas, "valorNF", { dedupe: dedupeNotasPorNF });
  const notasAvulsas   = notas.filter(n => n.tipo === "avulsa").length;

  // O realizado por jogo agora é calculado ao vivo no jogosCalc de cada campeonato
  // (buildRealizadoPorJogo, em lib/notasFiscais.js) — sempre em dia, em qualquer aba,
  // em vez de só quando esta aba estava montada e persistia o valor via setJogos.

  const addNota = notaOriginal => {
    // Grafia do fornecedor entra sempre como a canônica do cadastro (não
    // fragmenta agrupamentos por fornecedor; ver dedupeNF.js).
    const nota = { ...notaOriginal, fornecedor: grafiaCanonica(notaOriginal.fornecedor, fornecedores) };
    // Trava de duplicata nos fluxos manuais (Registrar NF, NF Avulsa,
    // Reembolso): mesmo nº/fornecedor (qualquer grafia) ou mesmo arquivo já
    // registrado exige confirmação. Notas vindas de aprovação (decisao
    // "aprovada") já passaram pela trava lá no RecebidasTab — não repetir.
    const jaTemDecisao = nota.decisao === "aprovada" || nota.decisao === "rejeitada";
    if (!jaTemDecisao) {
      const dups = acharDuplicatasNF(
        { fornecedor: nota.fornecedor, numeroNF: nota.numeroNF, fileHash: nota.fileHash, ignorarIds: [nota.id] },
        [
          { origem: "nota de jogo", notas },
          { origem: "nota mensal", notas: notasMensais },
        ]
      );
      if (!confirmarDuplicatas(dups, "registrar esta NF")) {
        // O modal já subiu o arquivo antes de chamar onSave — sem a nota, o
        // arquivo ficaria órfão no banco.
        if (nota.hasFile) deleteNFFile(nota.id).catch(() => {});
        setShowRegistrar(null);
        setShowAvulsa(false);
        setShowLivemode(false);
        return;
      }
    }
    setNotas(ns => [...ns, nota]);
    // Histórico append-only: registra a criação. RecebidasTab já grava
    // "aprovada" para NFs vindas do formulário; aqui usamos "registrada"
    // para diferenciar criações via "Registrar NF" e "NF Avulsa".
    if (!jaTemDecisao) {
      pushHistorico({
        ...nota,
        decisao: nota.tipo === "avulsa" ? "avulsa" : "registrada",
        decidoEm: new Date().toISOString(),
      }, historicoKey);
    }
    // NF de reembolso: fecha a ponta com a aba Logística (marca os lançamentos
    // dos jogos cobertos como reembolsados, com referência a esta NF).
    if (nota.tipo === "reembolso_livemode") onReembolsoCriado?.(nota);
    setShowRegistrar(null);
    setShowAvulsa(false);
    setShowLivemode(false);
  };

  const deleteNota = id => {
    const nota = notas.find(n => n.id === id);

    // Quando dedupeNotasPorNF ativo, apaga todas as cópias com mesma chave
    // (evita o problema de "apagar e ela continuar" por causa de duplicatas)
    const idsParaApagar = dedupeNotasPorNF && nota
      ? notas.filter(n => notaFiscalKey(n) === notaFiscalKey(nota)).map(n => n.id)
      : [id];
    const idsSet = new Set(idsParaApagar);

    const enviosAfetados = envios.filter(e => (e.notasIds || []).some(nid => idsSet.has(nid)));
    const temEnvio = enviosAfetados.length > 0;
    const qtd = idsParaApagar.length;
    const sufixo = qtd > 1 ? ` (${qtd} cópias duplicadas)` : "";
    const msg = temEnvio
      ? `Excluir esta NF${sufixo}? Ela está no ${enviosAfetados[0].nome || `Envio ${enviosAfetados[0].numero}`} e também será removida de lá.`
      : `Excluir esta NF${sufixo}?`;

    if (window.confirm(msg)) {
      idsParaApagar.forEach(nid => deleteNFFile(nid));
      setNotas(ns => ns.filter(n => !idsSet.has(n.id)));
      if (setEnvios && temEnvio) {
        setEnvios(evs => evs.map(e => {
          if (!(e.notasIds || []).some(nid => idsSet.has(nid))) return e;
          const notasIds = (e.notasIds || []).filter(nid => !idsSet.has(nid));
          const notasResumo = (e.notasResumo || []).filter(n => !idsSet.has(n.id));
          return normalizeEnvioMetricas({ ...e, notasIds, notasResumo }, { dedupeNotasPorNF });
        }));
      }
      const agora = new Date().toISOString();
      notas.filter(n => idsSet.has(n.id)).forEach(n => pushHistorico({ ...n, decisao: "excluida", excluidoEm: agora }, historicoKey));
    }
  };

  const limparRodada = (rodada) => {
    const nfsRodada = notas.filter(n => n.rodada === rodada);
    if (nfsRodada.length === 0) return;
    if (!window.confirm(`Apagar todas as ${nfsRodada.length} NFs da rodada ${rodada}? Os arquivos também serão removidos.`)) return;
    const agora = new Date().toISOString();
    const idsRodada = new Set(nfsRodada.map(n => n.id));
    nfsRodada.forEach(n => {
      deleteNFFile(n.id);
      pushHistorico({ ...n, decisao: "excluida", excluidoEm: agora, motivo: `limpar_rodada_${rodada}` }, historicoKey);
    });
    setNotas(ns => ns.filter(n => n.rodada !== rodada));
    if (setEnvios) {
      setEnvios(evs => evs.map(e => {
        const afetadas = (e.notasIds || []).filter(id => idsRodada.has(id));
        if (afetadas.length === 0) return e;
        const notasIds = (e.notasIds || []).filter(id => !idsRodada.has(id));
        const notasResumo = (e.notasResumo || []).filter(n => !idsRodada.has(n.id));
        return normalizeEnvioMetricas({
          ...e,
          notasIds,
          notasResumo,
        }, { dedupeNotasPorNF });
      }));
    }
  };

  // Planilha
  const planilhaRodadas = ["Todas", ...Array.from(new Set(notas.map(n => String(n.rodada)).filter(Boolean))).sort((a, b) => a - b)];
  const planilhaFornecedores = ["Todos", ...Array.from(new Set(notas.map(n => n.fornecedor).filter(Boolean))).sort()];
  const planilhaItens = notas
    .filter(n => filtroPlanilha === "Todas" || String(n.rodada) === filtroPlanilha)
    .filter(n => filtroFornecedor === "Todos" || n.fornecedor === filtroFornecedor)
    .sort((a, b) => (a.rodada || 0) - (b.rodada || 0));

  // Resumo por fornecedor (para painel na planilha)
  const resumoFornecedor = useMemo(() => {
    if (filtroFornecedor === "Todos") return null;
    const nfsForn = notas.filter(n => n.fornecedor === filtroFornecedor);
    const totalGasto = sumNotasFiscais(nfsForn, "valorNF", { dedupe: dedupeNotasPorNF });
    const jogosSet = new Set(nfsForn.flatMap(n => n.jogoIds || (n.jogoId ? [n.jogoId] : [])));
    const jogosComNF = jogos.filter(j => jogosSet.has(j.id) && j.mandante !== "A definir");
    const statusMap = {};
    groupNotasFiscais(nfsForn, { dedupe: dedupeNotasPorNF }).forEach(([, group]) => {
      const env = group.some(n => envioMap[n.id]);
      const st = env ? "Enviada" : "Pendente";
      statusMap[st] = (statusMap[st] || 0) + 1;
    });
    return { total: countNotasFiscais(nfsForn, { dedupe: dedupeNotasPorNF }), totalGasto, jogos: jogosComNF, status: statusMap };
  }, [filtroFornecedor, notas, jogos, envioMap, dedupeNotasPorNF]);

  const copyPlanilha = () => {
    const header = "Código\tNº NF\tFornecedor\tValor\tEmissão\tEnvio\tPagamento\tJogo\tRodada\tServiços\tTipo\tObs";
    const rows = planilhaItens.map(n =>
      `${n.codigo}\t${n.numeroNF}\t${n.fornecedor}\t${n.valorNF || 0}\t${n.dataEmissao}\t${n.dataEnvio}\t${envioMap[n.id]?.dataPagamento || ""}\t${n.jogoLabel}\t${n.rodada || ""}\t${(n.servicosLabels||[]).join(", ")}\t${n.tipo||"prevista"}\t${n.obs || ""}`
    );
    navigator.clipboard.writeText([header, ...rows].join("\n"));
    alert("Planilha copiada!");
  };

  const TABS_NF = [
    {value:"rodada", label:"Por Rodada"},
    {value:"planilha", label:"Planilha"},
    {value:"resumo", label:"Resumo"},
    ...(canEdit ? [{value:"recebidas", label:"Recebidas"}] : []),
  ];
  const TS = tableStyles(T);
  const purple = "#a855f7";
  const cyan = "#06b6d4";

  return (
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <Segmented T={T} value={tab} onChange={setTab} options={TABS_NF}/>
        <div style={{display:"flex",gap:8}}>
          {canEdit && <Button T={T} variant="secondary" size="md" icon={FileText} onClick={()=>setShowLivemode(true)}>NF Livemode</Button>}
          {canEdit && <Button T={T} variant="primary" size="md" icon={Plus} onClick={()=>setShowAvulsa(true)}>NF Avulsa</Button>}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16,marginBottom:24}}>
        <KPI label="Serviços Pendentes" value={String(totalPendente)} sub="Sem NF" color={T.warning} T={T}/>
        <KPI label="Serviços Conferidos" value={String(totalConferida)} sub="Com NF" color={T.brand} T={T}/>
        <KPI label="Notas Registradas" value={`${totalNotas}`} sub={`${notasAvulsas} avulsa${notasAvulsas!==1?"s":""}`} color={purple} T={T}/>
        <KPI label="Valor Total NFs" value={fmt(totalValor)} sub={`${totalNotas} notas`} color={cyan} T={T}/>
      </div>

      {/* ── POR RODADA ── */}
      {tab === "rodada" && (<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{color:T.textSm,fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Rodada</span>
            {rodadas.map(r => (
              <Chip key={r} active={rodadaEfetiva===r} onClick={()=>setRodadaSel(r)} T={T} color={purple}>{r}</Chip>
            ))}
          </div>
          {canEdit && <Button T={T} variant="primary" size="md" icon={Plus} onClick={()=>setShowRegistrar(true)}>Registrar NF (Rd {rodadaEfetiva})</Button>}
        </div>

        {jogosRodada.map(jogo => {
          // Regra (2026-08-05): linha SÓ com valor provisionado > 0. O Portal
          // continua preenchendo o FORNECEDOR dessas linhas (sync do
          // fornecedoresJogo), mas serviço escalado sem provisionado não gera
          // linha aqui — exceto se já existir NF registrada (fromNF abaixo,
          // garantia de que nenhuma nota some da tela).
          const baseServicos = extrairServicos(jogo, subsExcluir);
          const servicosRaw = [...baseServicos];
          const _jid = jogo.id;
          const nfsDoJogo = notas.filter(n =>
            n.servicosKeys?.some(k => k.startsWith(`${_jid}_`))
            || (n.tipo === "avulsa" && (n.jogoId === _jid || String(n.jogoId) === String(_jid)))
            || (n.tipo === "reembolso_livemode" && (n.jogoIds || []).map(Number).includes(_jid))
            // fallback: prevista sem servicosKeys mas com jogoId correto
            || (n.tipo === "prevista" && (n.jogoId === _jid || String(n.jogoId) === String(_jid)) && (!n.servicosKeys || n.servicosKeys.length === 0))
          );
          const servicosComNF = new Set(nfsDoJogo.flatMap(n => n.servicosKeys || []));
          // Aliases: sng_host → sng e sng_premiere → sng_extra (mesmo bucket
          // financeiro; NFs registradas na era dos extras do Portal usam esses nomes)
          servicosComNF.forEach(k => {
            if (k.endsWith('_sng_host')) servicosComNF.add(k.replace('_sng_host', '_sng'));
            if (k.endsWith('_sng_premiere')) servicosComNF.add(k.replace('_sng_premiere', '_sng_extra'));
          });

          // Garante linha para qualquer servicoKey de NF existente que não esteja em servicosRaw
          // (ex: sng_host registrado quando Portal estava ativo, mas agora Portal não carregou)
          const rawKeys = new Set(servicosRaw.map(s => `${jogo.id}_${s.subKey}`));
          nfsDoJogo.forEach(n => {
            // Rota 1: servicosKeys com prefixo jogoId
            (n.servicosKeys || []).forEach(k => {
              if (!k.startsWith(`${jogo.id}_`) || rawKeys.has(k)) return;
              const subKey = k.slice(String(jogo.id).length + 1);
              if (subKey === 'sng_host' && rawKeys.has(`${jogo.id}_sng`)) return;
              if (subKey === 'sng_premiere' && rawKeys.has(`${jogo.id}_sng_extra`)) return;
              let subLabel = subKey, catLabel = '', catColor = '';
              CATS.forEach(cat => cat.subs.forEach(sub => {
                if (sub.key === subKey) { subLabel = sub.label; catLabel = cat.label; catColor = cat.color; }
              }));
              // Chaves que não existem em CATS (vinham dos extras do Portal)
              if (subLabel === subKey) {
                const opCat = CATS.find(c => c.key === 'operacoes');
                if (subKey === 'sng_premiere') { subLabel = 'SNG Premiere'; catLabel = opCat?.label || ''; catColor = opCat?.color || ''; }
                if (subKey === 'sng_host')     { subLabel = 'SNG Host';     catLabel = opCat?.label || ''; catColor = opCat?.color || ''; }
              }
              servicosRaw.push({ subKey, subLabel, catLabel, catColor, valorRef: 0, fromNF: true });
              rawKeys.add(k);
            });
            // Rota 2: NF prevista sem servicosKeys — cria linha via servicosValores
            if ((!n.servicosKeys || n.servicosKeys.length === 0) && n.servicosValores) {
              Object.keys(n.servicosValores).forEach(subKey => {
                const k = `${jogo.id}_${subKey}`;
                if (rawKeys.has(k)) return;
                let subLabel = subKey, catLabel = '', catColor = '';
                CATS.forEach(cat => cat.subs.forEach(sub => {
                  if (sub.key === subKey) { subLabel = sub.label; catLabel = cat.label; catColor = cat.color; }
                }));
                servicosRaw.push({ subKey, subLabel, catLabel, catColor, valorRef: 0, fromNF: true });
                rawKeys.add(k);
                servicosComNF.add(k);
              });
            }
          });

          // Oculta serviços de prestadores internos SÓ SE não houver NF cadastrada para a linha
          // Paulistão F (usarPortal=false): exibe todos os serviços provisionados sem filtro
          const servicos = servicosRaw.filter(s => {
            if (!usarPortal) return true;
            const key = `${jogo.id}_${s.subKey}`;
            if (servicosComNF.has(key)) return true;
            const forn = fornecedoresJogo[key] || "";
            return !forn || emiteNF(forn);
          });
          const pendentes = servicos.filter(s => !servicosComNF.has(`${jogo.id}_${s.subKey}`)).length;
          const conferidas = servicos.filter(s => servicosComNF.has(`${jogo.id}_${s.subKey}`)).length;
          const accentJogo = jogo.categoria==="B1"?T.brand:T.warning;

          return (
            <Card key={jogo.id} T={T} style={{marginBottom:16}} accent={accentJogo}>
              <div style={{padding:"14px 20px",background:T.surfaceAlt||T.bg,borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
                <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <Pill label={jogo.categoria} color={accentJogo}/>
                  <span style={{fontWeight:700,fontSize:14,color:T.text,letterSpacing:"-0.005em"}}>{jogo.mandante} × {jogo.visitante}</span>
                  <span style={{color:T.textSm,fontSize:11}}>
                    <span className="num">{jogo.data}</span>
                    <span style={{margin:"0 6px",color:T.border}}>·</span>
                    {jogo.cidade}
                  </span>
                </div>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  {/* Libera o jogo no formulário público — sem isso o fornecedor não
                      vê o jogo lá, evitando envio antes do provisionado ser acertado. */}
                  {canEdit && setJogos && (
                    <button
                      onClick={() => setJogos(js => js.map(j => j.id === jogo.id ? {...j, formLiberado: !j.formLiberado} : j))}
                      title={jogo.formLiberado ? "Jogo visível no formulário público — clique para ocultar" : "Jogo oculto no formulário público — clique para liberar"}
                      style={{cursor:"pointer",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:RADIUS.pill,
                        color: jogo.formLiberado ? T.brand : T.textSm,
                        background: jogo.formLiberado ? T.brand+"1f" : "transparent",
                        border: `1px solid ${jogo.formLiberado ? T.brand+"55" : T.border}`}}>
                      {jogo.formLiberado ? "✓ No formulário" : "Liberar p/ formulário"}
                    </button>
                  )}
                  <span style={{color:T.warning,fontSize:11,fontWeight:700,background:T.warning+"1f",padding:"3px 10px",borderRadius:RADIUS.pill,border:`1px solid ${T.warning}33`}}>{pendentes} pendente{pendentes!==1?"s":""}</span>
                  <span className="num" style={{color:T.brand,fontSize:11,fontWeight:700,background:T.brand+"1f",padding:"3px 10px",borderRadius:RADIUS.pill,border:`1px solid ${T.brand}33`}}>{conferidas}/{servicos.length}</span>
                </div>
              </div>

              <div style={TS.wrap}>
                <table style={{...TS.table, minWidth:600}}>
                  <thead><tr style={TS.thead}>
                    {["Serviço","Categoria","Fornecedor Resp.","Valor Ref.","Valor NF","Status","NF Vinculada"].map(h =>
                      <th key={h} style={{...TS.th, ...TS.thLeft}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {servicos.map(s => {
                      const key = `${jogo.id}_${s.subKey}`;
                      const isMulti = SUBS_MULTI_NF.has(s.subKey);
                      const aliasSub = s.subKey === 'sng' ? 'sng_host' : s.subKey === 'sng_extra' ? 'sng_premiere' : null;
                      const aliasKey = aliasSub ? `${jogo.id}_${aliasSub}` : null;
                      const notasDestaLinha = nfsDoJogo.filter(n =>
                        n.servicosKeys?.includes(key) ||
                        (aliasKey && n.servicosKeys?.includes(aliasKey)) ||
                        // fallback: NF prevista sem servicosKeys, mesma pelo jogoId + valor do serviço
                        ((!n.servicosKeys || n.servicosKeys.length === 0) && (n.servicosValores?.[s.subKey] != null || n.servicosDetalhe?.[key] != null))
                      );
                      const valorUnit = notasDestaLinha.reduce((sum, n) => {
                        const detKey = (n.servicosDetalhe && n.servicosDetalhe[key] != null) ? key : (aliasKey && n.servicosDetalhe?.[aliasKey] != null ? aliasKey : null);
                        if (detKey) return sum + n.servicosDetalhe[detKey];
                        const svKey = n.servicosValores?.[s.subKey] != null ? s.subKey : (aliasSub && n.servicosValores?.[aliasSub] != null ? aliasSub : null);
                        if (svKey && n.servicosValores?.[svKey] != null) return sum + n.servicosValores[svKey];
                        return sum;
                      }, 0);
                      const hasNotas = notasDestaLinha.length > 0;
                      const diff = hasNotas ? valorUnit - s.valorRef : null;
                      const restante = s.valorRef - valorUnit;
                      const statusLabel = !hasNotas ? "Pendente" : (isMulti && restante > 0.01 ? "Parcial" : "Conferida");
                      const statusColor = !hasNotas ? T.warning : (statusLabel === "Parcial" ? T.info : T.brand);
                      const nota = notasDestaLinha[0];
                      return (
                        <tr key={s.subKey} style={TS.tr}>
                          <td style={{...TS.td, fontWeight:600}}>{s.subLabel}</td>
                          <td style={TS.td}><Pill label={s.catLabel} color={s.catColor}/></td>
                          <td style={TS.td}>
                            {canEdit ? (
                              <div style={{display:"flex",alignItems:"center",gap:4}}>
                                <InlineFornecedor
                                  value={fornecedoresJogo[`${jogo.id}_${s.subKey}`] || ""}
                                  onChange={v => editarFornecedorJogo(`${jogo.id}_${s.subKey}`, v)}
                                  fornecedores={fornecedores}
                                  T={T}
                                />
                                {manualMap?.[`${jogo.id}_${s.subKey}`] && (
                                  <span
                                    title="Definido manualmente — não segue o Portal. Clique para voltar ao automático."
                                    onClick={() => voltarFornecedorAuto(`${jogo.id}_${s.subKey}`)}
                                    style={{cursor:"pointer",color:"#f59e0b",fontSize:9,lineHeight:1,flexShrink:0}}>✎</span>
                                )}
                              </div>
                            ) : (
                              <span style={{fontSize:11, color:T.textMd}}>{fornecedoresJogo[`${jogo.id}_${s.subKey}`] || "—"}</span>
                            )}
                          </td>
                          <td className="num" style={{...TS.td, color:T.textSm, fontSize:12}}>{fmt(s.valorRef)}</td>
                          <td style={{...TS.td, fontSize:12}}>
                            {hasNotas ? (
                              <span style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                                <span className="num" style={{color:purple,fontWeight:700}}>{fmt(valorUnit)}</span>
                                {diff !== 0 && <span className="num" style={{fontSize:10,color:diff>0?T.danger:(isMulti?T.info:T.brand),fontWeight:600}}>{diff>0?"+":""}{fmt(diff)}</span>}
                                {isMulti && notasDestaLinha.length > 1 && <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:T.info+"22",color:T.info,fontWeight:700}}>{notasDestaLinha.length} NFs</span>}
                              </span>
                            ) : <span style={{color:T.textSm}}>—</span>}
                          </td>
                          <td style={TS.td}>
                            <Pill label={statusLabel} color={statusColor}/>
                          </td>
                          <td style={{...TS.td, fontSize:11}}>
                            {!hasNotas ? <span style={{color:T.textSm}}>—</span>
                              : notasDestaLinha.length > 1 ? (
                                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                                  {notasDestaLinha.map(n => (
                                    <span key={n.id} style={{color:T.text,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                                      <code className="num" style={{color:T.brand,fontSize:11,background:T.brand+"15",padding:"2px 6px",borderRadius:4}}>{n.codigo}</code>
                                      <span style={{color:T.textMd}}>{n.fornecedor}</span>
                                      {envioMap[n.id] && <Pill label={envioLabel(envioMap[n.id])} color={purple}/>}
                                      <AcoesArquivo nota={n} canEdit={canEdit} T={T} onVer={setPreview} onEnviar={x => {setUploadTarget(x); uploadRef.current?.click();}}/>
                                      {canEdit && <Button T={T} variant="danger" size="sm" icon={Trash2} onClick={()=>deleteNota(n.id)}/>}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span style={{color:T.text,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                                  <code className="num" style={{color:T.brand,fontSize:11,background:T.brand+"15",padding:"2px 6px",borderRadius:4}}>{nota.codigo}</code>
                                  <span style={{color:T.textMd}}>{nota.fornecedor}</span>
                                  {envioMap[nota.id] && <Pill label={envioLabel(envioMap[nota.id])} color={purple}/>}
                                  <AcoesArquivo nota={nota} canEdit={canEdit} T={T} onVer={setPreview} onEnviar={x => {setUploadTarget(x); uploadRef.current?.click();}}/>
                                  {canEdit && <Button T={T} variant="danger" size="sm" icon={Trash2} onClick={()=>deleteNota(nota.id)}/>}
                                </span>
                              )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {nfsDoJogo.filter(n => n.tipo === "avulsa").length > 0 && (
                <div style={{padding:"10px 16px",borderTop:`1px solid ${T.border}`,background:T.surfaceAlt||T.bg}}>
                  <p style={{color:T.warning,fontSize:10,fontWeight:700,margin:"0 0 6px",letterSpacing:"0.06em",textTransform:"uppercase"}}>NFs Avulsas neste jogo</p>
                  {nfsDoJogo.filter(n => n.tipo === "avulsa").map(n => {
                    const descricao = n.descricao || (n.servicosLabels || [])[0] || "Avulsa";
                    return (
                      <div key={n.id} style={{display:"flex",gap:12,alignItems:"center",fontSize:12,padding:"4px 0",flexWrap:"wrap"}}>
                        <code className="num" style={{color:T.brand,fontSize:11,background:T.brand+"15",padding:"2px 6px",borderRadius:4}}>{n.codigo}</code>
                        <span style={{color:T.text,fontWeight:600}}>{n.fornecedor}</span>
                        <Pill label={descricao} color={T.warning}/>
                        <span className="num" style={{color:purple,fontWeight:700}}>{fmt(n.valorNF)}</span>
                        {n.numeroNF && <span style={{color:T.textSm,fontSize:11}}>NF {n.numeroNF}</span>}
                        {n.dataEmissao && <span style={{color:T.textSm,fontSize:11}}>Emissão {n.dataEmissao}</span>}
                        <span style={{marginLeft:"auto",display:"flex",gap:4}}>
                          <AcoesArquivo nota={n} canEdit={canEdit} T={T} onVer={setPreview} onEnviar={x => {setUploadTarget(x); uploadRef.current?.click();}}/>
                          {canEdit && <Button T={T} variant="danger" size="sm" icon={Trash2} onClick={()=>deleteNota(n.id)}/>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </>)}

      {/* ── PLANILHA ── */}
      {tab === "planilha" && (<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:12}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{color:T.textSm,fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Rodada</span>
            {planilhaRodadas.map(r => (
              <Chip key={r} active={filtroPlanilha===r} onClick={()=>setFiltroPlanilha(r)} T={T} color={purple}>
                {r === "Todas" ? "Todas" : `Rd ${r}`}
              </Chip>
            ))}
          </div>
          <Button T={T} variant="primary" size="md" icon={CopyIcon} onClick={copyPlanilha}>Copiar Planilha</Button>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:18}}>
          <span style={{color:T.textSm,fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Fornecedor</span>
          <select value={filtroFornecedor} onChange={e => setFiltroFornecedor(e.target.value)}
            style={{background:T.card,border:`1px solid ${T.muted}`,borderRadius:6,color:T.text,padding:"5px 10px",fontSize:12,cursor:"pointer",maxWidth:220}}>
            {planilhaFornecedores.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          {filtroFornecedor !== "Todos" && (
            <Chip active={false} onClick={()=>setFiltroFornecedor("Todos")} T={T} color={T.danger}>✕ Limpar</Chip>
          )}
        </div>

        {resumoFornecedor && (
          <Card T={T} style={{marginBottom:16}} accent={purple}>
            <div style={{padding:"16px 22px"}}>
              <p style={{color:T.textSm,fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",margin:"0 0 10px"}}>Resumo — {filtroFornecedor}</p>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:14,marginBottom:12}}>
                <div>
                  <p style={{color:T.textSm,fontSize:10,margin:"0 0 2px",textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>Total gasto</p>
                  <p className="num" style={{color:purple,fontSize:18,fontWeight:800,margin:0}}>{fmt(resumoFornecedor.totalGasto)}</p>
                </div>
                <div>
                  <p style={{color:T.textSm,fontSize:10,margin:"0 0 2px",textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>Notas</p>
                  <p className="num" style={{color:T.text,fontSize:18,fontWeight:800,margin:0}}>{resumoFornecedor.total}</p>
                </div>
                <div>
                  <p style={{color:T.textSm,fontSize:10,margin:"0 0 2px",textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>Status</p>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:2}}>
                    {Object.entries(resumoFornecedor.status).map(([st, qt]) => (
                      <Pill key={st} label={`${st}: ${qt}`} color={st==="Enviada"?T.brand:T.warning}/>
                    ))}
                  </div>
                </div>
              </div>
              {resumoFornecedor.jogos.length > 0 && (
                <div>
                  <p style={{color:T.textSm,fontSize:10,margin:"0 0 6px",textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>Jogos com notas deste fornecedor</p>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {resumoFornecedor.jogos.map(j => (
                      <Pill key={j.id} label={`Rd${j.rodada} ${abreviar(j.mandante)}x${abreviar(j.visitante)}`} color={T.info}/>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        <Card T={T}>
          <PanelTitle T={T} title="Planilha de Notas" subtitle={`${countNotasFiscais(planilhaItens, { dedupe: dedupeNotasPorNF })} notas`}
            right={<span style={{fontSize:12,color:T.textMd}}>Total: <b className="num" style={{color:purple}}>{fmt(sumNotasFiscais(planilhaItens, "valorNF", { dedupe: dedupeNotasPorNF }))}</b></span>}
          />
          <div style={TS.wrap}>
            <table style={{...TS.table, minWidth:1050}}>
              <thead>
                <tr style={TS.thead}>
                  {["Código","Nº NF","Fornecedor","Valor","Emissão","Envio","Pagamento","Jogo","Rd","Serviços","Tipo",""].map(h =>
                    <th key={h} style={{...TS.th, ...(h==="Valor"?TS.thRight:TS.thLeft)}}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {planilhaItens.map(n => (
                  <tr key={n.id} style={TS.tr}>
                    <td style={TS.td}><code className="num" style={{color:T.brand,fontSize:11,background:T.brand+"15",padding:"3px 7px",borderRadius:4,fontWeight:600}}>{n.codigo}</code></td>
                    <td className="num" style={{...TS.td, fontWeight:600}}>{n.numeroNF}</td>
                    <td style={TS.td}>{n.fornecedor}</td>
                    <td className="num" style={{...TS.tdNum, color:purple, fontWeight:700}}>{fmt(n.valorNF || 0)}</td>
                    <td className="num" style={{...TS.td, color:T.textMd, fontSize:12}}>{n.dataEmissao}</td>
                    <td className="num" style={{...TS.td, color:T.textMd, fontSize:12}}>{n.dataEnvio}</td>
                    <td className="num" style={{...TS.td, color:T.textMd, fontSize:12}}>{envioMap[n.id]?.dataPagamento || "—"}</td>
                    <td style={{...TS.td, fontSize:12, whiteSpace:"nowrap"}}>{n.jogoLabel}</td>
                    <td className="num" style={{...TS.td, color:T.textMd, fontSize:12}}>{n.rodada}</td>
                    <td style={{...TS.td, color:T.textSm, fontSize:11, maxWidth:200}}>{(n.servicosLabels||[]).join(", ")}</td>
                    <td style={TS.td}>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        <Pill label={n.tipo==="avulsa"?"Avulsa":"Prevista"} color={n.tipo==="avulsa"?T.warning:T.brand}/>
                        {envioMap[n.id] && <Pill label={envioLabel(envioMap[n.id])} color={purple}/>}
                      </div>
                    </td>
                    <td style={TS.td}>
                      <div style={{display:"flex",gap:4}}>
                        <AcoesArquivo nota={n} canEdit={canEdit} T={T} onVer={setPreview} onEnviar={x => {setUploadTarget(x); uploadRef.current?.click();}}/>
                        {canEdit && <Button T={T} variant="danger" size="sm" icon={Trash2} onClick={()=>deleteNota(n.id)}/>}
                      </div>
                    </td>
                  </tr>
                ))}
                {planilhaItens.length === 0 && (
                  <tr><td colSpan={12} style={{padding:40,textAlign:"center",color:T.textSm}}>Nenhuma nota registrada</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </>)}

      {/* ── RESUMO ── */}
      {tab === "resumo" && (
        <Card T={T}>
          <PanelTitle T={T} title="Status por Rodada" subtitle="Progresso de notas conferidas vs pendentes"/>
          <div style={TS.wrap}>
            <table style={{...TS.table, minWidth:680}}>
              <thead>
                <tr style={TS.thead}>
                  {["Rodada","Serviços","Pendente","Conferida","NFs","Valor NFs","% Concluído"].map(h =>
                    <th key={h} style={{...TS.th, ...(h==="Rodada"?TS.thLeft:TS.thRight)}}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rodadas.map(rod => {
                  const rodServicos = allServicos.filter(i => i.rodada === rod);
                  const tot = rodServicos.length;
                  const pend = rodServicos.filter(i => i.status === "Pendente").length;
                  const conf = rodServicos.filter(i => i.status === "Conferida").length;
                  const rodNotas = notas.filter(n => n.rodada === rod);
                  const rodValor = sumNotasFiscais(rodNotas, "valorNF", { dedupe: dedupeNotasPorNF });
                  const pct = tot ? (conf / tot * 100) : 0;
                  return (
                    <tr key={rod} style={TS.tr}>
                      <td style={{...TS.td, fontWeight:600}}>Rodada {rod}</td>
                      <td className="num" style={TS.tdNum}>{tot}</td>
                      <td className="num" style={{...TS.tdNum, color:pend>0?T.warning:T.textSm}}>{pend}</td>
                      <td className="num" style={{...TS.tdNum, color:conf>0?T.brand:T.textSm}}>{conf}</td>
                      <td className="num" style={TS.tdNum}>{countNotasFiscais(rodNotas, { dedupe: dedupeNotasPorNF })}</td>
                      <td className="num" style={{...TS.tdNum, color:purple, fontWeight:700}}>{fmt(rodValor)}</td>
                      <td style={{padding:"13px 16px", textAlign:"right"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,justifyContent:"flex-end"}}>
                          <span className="num" style={{color:T.textMd,fontSize:12,minWidth:32}}>{pct.toFixed(0)}%</span>
                          <div style={{width:80}}><Progress value={pct} T={T}/></div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── RECEBIDAS (do formulário externo) ── */}
      {tab === "recebidas" && (
        <RecebidasTab notas={notas} notasMensais={notasMensais} addNota={addNota} addNotaMensal={setNotasMensais ? (nota => setNotasMensais(ms => [...ms, nota])) : null} jogos={jogos} fornecedores={fornecedores} T={T} submissionsKey={submissionsKey} historicoKey={historicoKey} formHash={formHash}/>
      )}

      {showRegistrar && <RegistrarNFModal jogosRodada={jogosRodada} notasExistentes={notas} fornecedores={fornecedores} onSave={addNota} onClose={() => setShowRegistrar(null)} T={T} portal={portal} subsExcluir={subsExcluir}/>}
      {showAvulsa && <NFAvulsaModal jogos={jogos} fornecedores={fornecedores} onSave={addNota} onClose={() => setShowAvulsa(false)} T={T}/>}
      {showLivemode && <ReembolsoLogisticaModal jogos={jogos} fornecedores={fornecedores} onSave={addNota} onClose={() => setShowLivemode(false)} T={T}/>}
      {preview && <PreviewModal nota={preview} onClose={() => setPreview(null)} onArquivoAusente={marcarSemArquivo} onSubstituir={canEdit ? (n => {setUploadTarget(n); uploadRef.current?.click();}) : null} T={T}/>}
      <input ref={uploadRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style={{display:"none"}}
        onChange={e => {if (e.target.files[0] && uploadTarget) handleUploadLater(e.target.files[0], uploadTarget); e.target.value="";}}/>
    </>
  );
}
