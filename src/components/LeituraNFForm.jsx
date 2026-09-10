import { useEffect, useState } from "react";
import { lerArquivoNF, resumoLeituraCurto, divergenciasEnvio } from "../lib/leitorNF";
import { patchNumeroNF } from "../lib/nfNumero";

// ─── LEITURA DO PDF NO FORMULÁRIO PÚBLICO ────────────────────────────────────
// Quando o fornecedor anexa a nota, lê o PDF no próprio navegador dele e:
//   • preenche nº da NF e data de emissão SE ainda estiverem vazios (nunca
//     sobrescreve o que ele digitou);
//   • mostra em verde o que foi lido, para ele conferir;
//   • entrega os dados lidos ao formulário (onLeitura) — na hora de enviar, o
//     formulário compara com o digitado e só AVISA se divergir.
// PDF escaneado/imagem: aviso cinza, tudo segue manual. Nada é bloqueado.
export default function LeituraNFForm({ arquivo, nfData, setNfData, onLeitura, total, cnpj, T }) {
  const [estado, setEstado] = useState(null); // null | {lendo} | {dados, preencheu:[]} | {erro}

  useEffect(() => {
    let vivo = true;
    onLeitura?.(null);
    if (!arquivo) { setEstado(null); return; }
    setEstado({ lendo: true });
    lerArquivoNF(arquivo).then(({ dados }) => {
      if (!vivo) return;
      onLeitura?.(dados);
      const preencheu = [];
      setNfData(d => {
        const n = { ...d };
        if (!String(d.numeroNF || "").trim() && dados.numero) {
          Object.assign(n, patchNumeroNF(dados.chave && dados.chave.length === 50 ? dados.chave : String(dados.numero)));
          preencheu.push("número");
        }
        if (!d.dataEmissao && dados.emissao && dados.emissaoFonte === "rótulo") { n.dataEmissao = dados.emissao; preencheu.push("data de emissão"); }
        return n;
      });
      setEstado({ dados, preencheu });
    }).catch(e => { if (vivo) { setEstado({ erro: e?.message || String(e) }); onLeitura?.(null); } });
    return () => { vivo = false; };
  }, [arquivo]);

  if (!estado) return null;
  if (estado.lendo) return <p style={{ margin: "6px 0 0", color: T.textSm, fontSize: 12 }}>Lendo o PDF…</p>;
  if (estado.erro) return null; // leitura é conveniência; sem ela o fluxo segue igual
  const resumo = resumoLeituraCurto(estado.dados);
  // Divergências AO VIVO: o valor é digitado numa etapa anterior, então o aviso
  // tem de aparecer aqui, assim que o PDF é lido — não só no Enviar.
  const divs = nfData ? divergenciasEnvio(estado.dados, { ...nfData, total, cnpj }) : [];
  if (!resumo) {
    return <p style={{ margin: "6px 0 0", color: T.textSm, fontSize: 12 }}>Não conseguimos ler o texto deste PDF (pode ser escaneado). Confira os dados manualmente.</p>;
  }
  return (
    <div style={{ margin: "6px 0 0", padding: "8px 10px", borderRadius: 8, background: "#22c55e12", border: "1px solid #22c55e55" }}>
      <p style={{ margin: 0, color: "#059669", fontSize: 12, fontWeight: 700 }}>✓ Lido do PDF: {resumo}</p>
      <p style={{ margin: "3px 0 0", color: T.textSm, fontSize: 11 }}>
        {estado.preencheu.length ? `Preenchemos ${estado.preencheu.join(" e ")} para você. ` : ""}Confira se bate com a nota antes de enviar.
      </p>
      {divs.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "#f59e0b18", border: "1px solid #f59e0b66" }}>
          <p style={{ margin: 0, color: "#b45309", fontSize: 12, fontWeight: 700 }}>⚠️ Atenção: o PDF não bate com o que foi informado</p>
          {divs.map(d => <p key={d.campo} style={{ margin: "3px 0 0", color: "#b45309", fontSize: 12 }}>• {d.texto}</p>)}
          <p style={{ margin: "4px 0 0", color: T.textSm, fontSize: 11 }}>Volte e corrija, ou siga se tiver certeza — vamos perguntar de novo ao enviar.</p>
        </div>
      )}
    </div>
  );
}
