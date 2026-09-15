import { useState } from "react";
import { iSty, FONT, SECAO_COLORS } from "../../constants";
import { Card, SectionHeader, Button, tableStyles } from "../ui";
import { CATALOGO_SERVICOS_FIXOS, totalFixos } from "../../data/orcamentos";
import { fmtOrc as fmt } from "../../data/orcamentos";
import { Briefcase, Plus, Trash2 } from "lucide-react";

// Seções padrão dos outros campeonatos + as que já existirem no orçamento.
const SECOES_BASE = ["Pessoal", "Transmissão", "Serviços Complementares"];

// Serviços fixos do orçamento, no mesmo formato dos outros campeonatos
// (seções Pessoal / Transmissão / Serviços Complementares). O catálogo-base
// traz os nomes já usados no Brasileirão e no Paulistão F — clicar adiciona o
// serviço com orçado zerado para preencher.
export default function SubServicos({ orc, setOrc, readOnly, T }) {
  const IS = iSty(T);
  const ts = tableStyles(T);
  const [novoNome, setNovoNome] = useState({});

  const servicos = orc.servicosFixos || [];
  const secoes = [...new Set([...SECOES_BASE, ...servicos.map(s => s.secao)])];

  const addItem = (secao, nome) => {
    const nomeFinal = String(nome || "").trim();
    if (!nomeFinal) return;
    const sec = servicos.find(s => s.secao === secao);
    if ((sec?.itens || []).some(it => it.nome.toLowerCase() === nomeFinal.toLowerCase())) {
      window.alert(`"${nomeFinal}" já está na seção ${secao}.`);
      return;
    }
    setOrc(prev => {
      const atuais = prev.servicosFixos || [];
      const id = atuais.flatMap(s => s.itens || []).reduce((m, it) => Math.max(m, Number(it.id) || 0), 0) + 1;
      const item = { id, nome: nomeFinal, orcado: 0, obs: "" };
      const novas = atuais.some(s => s.secao === secao)
        ? atuais.map(s => s.secao === secao ? { ...s, itens: [...s.itens, item] } : s)
        : [...atuais, { secao, itens: [item] }];
      return { ...prev, servicosFixos: novas };
    });
    setNovoNome(prev => ({ ...prev, [secao]: "" }));
  };

  const patchItem = (secao, id, patch) => {
    setOrc(prev => ({
      ...prev,
      servicosFixos: (prev.servicosFixos || []).map(s => s.secao !== secao ? s : {
        ...s, itens: s.itens.map(it => it.id === id ? { ...it, ...patch } : it),
      }),
    }));
  };

  const removeItem = (secao, id) => {
    setOrc(prev => ({
      ...prev,
      servicosFixos: (prev.servicosFixos || [])
        .map(s => s.secao !== secao ? s : { ...s, itens: s.itens.filter(it => it.id !== id) })
        .filter(s => s.itens.length > 0),
    }));
  };

  const total = totalFixos(orc);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      {secoes.map(secao => {
        const cor = SECAO_COLORS[secao] || T.brand || "#65B32E";
        const sec = servicos.find(s => s.secao === secao);
        const itens = sec?.itens || [];
        const totalSecao = itens.reduce((s, it) => s + (Number(it.orcado) || 0), 0);
        const nomesUsados = new Set(itens.map(it => it.nome.toLowerCase()));
        const sugestoes = (CATALOGO_SERVICOS_FIXOS.find(c => c.secao === secao)?.nomes || [])
          .filter(n => !nomesUsados.has(n.toLowerCase()));

        return (
          <Card T={T} key={secao} accent={cor}>
            <SectionHeader T={T} icon={Briefcase} title={secao}
              subtitle={`${itens.length} serviço(s) estimado(s)`}
              right={<span className="num" style={{fontSize:14,fontWeight:700,color:cor,fontFamily:FONT.num}}>{fmt(totalSecao)}</span>}/>

            {itens.length > 0 && (
              <div style={ts.wrap}>
                <table style={{...ts.table, minWidth:560}}>
                  <thead style={ts.thead}>
                    <tr>
                      <th style={{...ts.th, ...ts.thLeft}}>Serviço</th>
                      <th style={{...ts.th, ...ts.thRight}}>Orçado</th>
                      <th style={{...ts.th, ...ts.thLeft}}>Obs</th>
                      {!readOnly && <th style={ts.th}/>}
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map(it => (
                      <tr key={it.id} style={ts.tr}>
                        <td style={{...ts.td, padding:"6px 10px"}}>
                          <input value={it.nome} disabled={readOnly} placeholder="Nome do serviço"
                            onChange={e=>patchItem(secao, it.id, {nome:e.target.value})}
                            style={{...IS, fontSize:12, padding:"5px 8px", minWidth:220, opacity:readOnly?0.7:1}}/>
                        </td>
                        <td style={{...ts.tdNum, padding:"6px 10px"}}>
                          <input value={it.orcado ?? ""} disabled={readOnly} inputMode="decimal" placeholder="0"
                            onChange={e=>{
                              const v = String(e.target.value).replace(/[^0-9.,\-]/g, "").replace(",", ".");
                              patchItem(secao, it.id, {orcado: v === "" ? 0 : (parseFloat(v) || 0)});
                            }}
                            style={{...IS, maxWidth:130, textAlign:"right", fontFamily:FONT.num, fontSize:12, padding:"5px 8px",
                                    background: Number(it.orcado) ? cor+"0d" : (T.surface||T.bg), opacity:readOnly?0.7:1}}/>
                        </td>
                        <td style={{...ts.td, padding:"6px 10px"}}>
                          <input value={it.obs || ""} disabled={readOnly} placeholder="—"
                            onChange={e=>patchItem(secao, it.id, {obs:e.target.value})}
                            style={{...IS, fontSize:12, padding:"5px 8px", opacity:readOnly?0.7:1}}/>
                        </td>
                        {!readOnly && (
                          <td style={{...ts.td, padding:"6px 10px"}}>
                            <button title="Remover serviço" onClick={()=>removeItem(secao, it.id)}
                              style={{border:"none",background:"transparent",cursor:"pointer",color:T.danger||"#DC2626",padding:4,display:"flex"}}>
                              <Trash2 size={14}/>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!readOnly && (
              <div style={{padding:"14px 20px 18px",borderTop:itens.length>0?`1px solid ${T.border}`:"none",display:"flex",flexDirection:"column",gap:10}}>
                {sugestoes.length > 0 && (
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                    <span style={{fontSize:11,color:T.textSm,fontWeight:600}}>Base dos outros campeonatos:</span>
                    {sugestoes.map(nome => (
                      <button key={nome} onClick={()=>addItem(secao, nome)}
                        title={`Adicionar "${nome}" com orçado zerado`}
                        style={{
                          border:`1px dashed ${cor}66`,
                          background:cor+"0d",
                          borderRadius:6,
                          padding:"3px 10px",
                          fontSize:11,
                          color:cor,
                          cursor:"pointer",
                          fontFamily:FONT.ui,
                          display:"inline-flex",
                          alignItems:"center",
                          gap:5,
                        }}>
                        <Plus size={11}/>{nome}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input value={novoNome[secao] || ""} onChange={e=>setNovoNome(prev => ({ ...prev, [secao]: e.target.value }))}
                    onKeyDown={e=>{ if (e.key === "Enter") addItem(secao, novoNome[secao]); }}
                    style={{...IS, maxWidth:280}} placeholder="Outro serviço (nome livre)..."/>
                  <Button T={T} variant="secondary" size="sm" icon={Plus}
                    onClick={()=>addItem(secao, novoNome[secao])} disabled={!(novoNome[secao] || "").trim()}>
                    Adicionar
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}

      {/* ── Total geral ── */}
      <Card T={T}>
        <div style={{padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
          <p style={{margin:0,fontSize:12,color:T.textMd}}>
            Na aprovação, estes serviços vão para a aba <b>Serviços</b> do campeonato (provisionado e realizado nascem zerados).
          </p>
          <div style={{textAlign:"right"}}>
            <p style={{margin:0,fontSize:10,color:T.textSm,letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:600}}>Total serviços fixos</p>
            <p className="num" style={{margin:"2px 0 0",fontSize:20,fontWeight:700,color:T.text,fontFamily:FONT.num}}>{fmt(total)}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
