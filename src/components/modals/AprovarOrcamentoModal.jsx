import { useState } from "react";
import { RADIUS, FONT } from "../../constants";
import { Button } from "../ui";
import { fmtOrc as fmt } from "../../data/orcamentos";
import { slugify } from "../../data/customCampeonato";
import { calcTotais } from "../../data/orcamentos";
import { Trophy, AlertCircle, Lock } from "lucide-react";

const overlayStyle = {
  position:"fixed", inset:0,
  background:"rgba(0,0,0,0.65)",
  backdropFilter:"blur(4px)",
  zIndex:100,
  display:"flex", alignItems:"center", justifyContent:"center",
  padding:16,
};

// Confirmação de aprovação: mostra o resumo, os erros de validação (se houver)
// e exige checkbox — aprovar congela o orçamento e cria o campeonato.
export function AprovarOrcamentoModal({ orc, erros = [], onConfirm, onClose, T }) {
  const [ciente, setCiente]         = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [erroSubmit, setErroSubmit] = useState("");

  const totais = calcTotais(orc);
  const campId = slugify(`${orc.meta.nome}-${orc.meta.edicao}`);
  const temErros = erros.length > 0;

  const confirmar = async () => {
    setErroSubmit("");
    setSubmitting(true);
    try { await onConfirm(); }
    catch (e) { setErroSubmit("Falha ao aprovar: " + (e?.message || e)); setSubmitting(false); }
  };

  const Linha = ({ label, valor, num }) => (
    <div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"8px 0",borderBottom:`1px solid ${T.border}`}}>
      <span style={{fontSize:12,color:T.textMd}}>{label}</span>
      <span className={num?"num":undefined} style={{fontSize:12,color:T.text,fontWeight:600,fontFamily:num?FONT.num:FONT.ui}}>{valor}</span>
    </div>
  );

  return (
    <div style={overlayStyle}>
      <div style={{
        background:T.surface||T.card,
        borderRadius:RADIUS.xl,
        padding:28,
        width:"100%",
        maxWidth:560,
        maxHeight:"92vh",
        overflowY:"auto",
        border:`1px solid ${T.border}`,
        boxShadow:T.shadow||"0 20px 40px rgba(0,0,0,0.4)",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:18}}>
          <div style={{
            width:42, height:42, borderRadius:12,
            background:"rgba(34,197,94,0.12)", border:"1px solid rgba(34,197,94,0.4)", color:"#22c55e",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}><Trophy size={20}/></div>
          <div style={{flex:1, minWidth:0}}>
            <h3 style={{margin:0,fontSize:18,color:T.text,fontWeight:800,letterSpacing:"-0.02em"}}>Aprovar Orçamento</h3>
            <p style={{margin:"4px 0 0",fontSize:12,color:T.textSm}}>{orc.meta.nome} · {orc.meta.edicao}</p>
          </div>
        </div>

        {temErros ? (
          <div style={{
            padding:"12px 14px",
            background:(T.danger||"#ef4444")+"12",
            border:`1px solid ${(T.danger||"#ef4444")}44`,
            borderRadius:10,
            marginBottom:16,
          }}>
            <p style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:T.danger||"#ef4444",display:"flex",alignItems:"center",gap:6}}>
              <AlertCircle size={14}/> Pendências impedem a aprovação:
            </p>
            <ul style={{margin:0,paddingLeft:18}}>
              {erros.map((e,i) => <li key={i} style={{fontSize:12,color:T.danger||"#ef4444",marginBottom:4}}>{e}</li>)}
            </ul>
          </div>
        ) : (
          <>
            <div style={{marginBottom:16}}>
              <Linha label="Campeonato que será criado" valor={campId}/>
              <Linha label="Jogos no orçamento" valor={String(totais ? (orc.jogos||[]).length : 0)} num/>
              <Linha label="Total estimado (jogos)" valor={fmt(totais.totalJogos)} num/>
              <Linha label="Total serviços fixos" valor={fmt(totais.totalFixos)} num/>
              <Linha label="Total geral do orçamento" valor={fmt(totais.totalGeral)} num/>
            </div>

            <div style={{
              display:"flex", alignItems:"flex-start", gap:10,
              padding:"12px 14px",
              background:(T.warning||"#f59e0b")+"12",
              border:`1px solid ${(T.warning||"#f59e0b")}44`,
              borderRadius:10,
              marginBottom:16,
            }}>
              <Lock size={15} color={T.warning||"#f59e0b"} style={{flexShrink:0,marginTop:1}}/>
              <p style={{margin:0,fontSize:12,color:T.text,lineHeight:1.5}}>
                Aprovar <b>congela o orçamento</b> (não pode mais ser editado nem desaprovado) e
                <b> cria o campeonato</b> "{orc.meta.nome} {orc.meta.edicao}" com o orçado carimbado em cada jogo.
              </p>
            </div>

            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:16}}>
              <input type="checkbox" checked={ciente} onChange={e=>setCiente(e.target.checked)}/>
              <span style={{fontSize:12,color:T.text}}>Estou ciente e quero aprovar este orçamento.</span>
            </label>
          </>
        )}

        {erroSubmit && (
          <p style={{margin:"0 0 12px",fontSize:12,color:T.danger||"#ef4444",fontWeight:600}}>{erroSubmit}</p>
        )}

        <div style={{display:"flex",gap:8,justifyContent:"space-between",alignItems:"center"}}>
          <Button T={T} variant="secondary" size="md" onClick={onClose} disabled={submitting}>
            {temErros ? "Voltar e corrigir" : "Cancelar"}
          </Button>
          {!temErros && (
            <Button T={T} variant="primary" size="md" icon={Trophy} onClick={confirmar} disabled={submitting || !ciente}>
              {submitting ? "Aprovando..." : "Aprovar e criar campeonato"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
