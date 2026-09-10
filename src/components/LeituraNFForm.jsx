import { useEffect, useState } from "react";
import { lerArquivoNF, compararLeitura, divergenciasEnvio } from "../lib/leitorNF";
import { patchNumeroNF } from "../lib/nfNumero";

// ─── LEITURA DO PDF NO FORMULÁRIO PÚBLICO ────────────────────────────────────
// O anexo é o PRIMEIRO campo da etapa: o fornecedor solta a nota, o PDF é lido
// no próprio navegador dele e:
//   • nº da NF e data de emissão são preenchidos se estiverem vazios (nunca
//     sobrescreve o que ele digitou);
//   • um quadro mostra, lado a lado, o que está no PDF e o que foi informado,
//     campo a campo — verde bate, laranja diverge;
//   • se o VALOR diverge, um botão leva de volta à etapa de valores (o valor é
//     digitado antes desta etapa); nº e data se corrigem logo abaixo.
// Nada é bloqueado: ao Enviar, o formulário só pede confirmação (decisão do
// financeiro, 10/09/2026). PDF escaneado/imagem: aviso cinza, tudo manual.
const fmt = v => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LeituraNFForm({ arquivo, nfData, setNfData, onLeitura, total, cnpj, onVoltarValores, T }) {
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
          preencheu.push("o número");
        }
        if (!d.dataEmissao && dados.emissao && dados.emissaoFonte === "rótulo") { n.dataEmissao = dados.emissao; preencheu.push("a data de emissão"); }
        return n;
      });
      setEstado({ dados, preencheu });
    }).catch(e => { if (vivo) { setEstado({ erro: e?.message || String(e) }); onLeitura?.(null); } });
    return () => { vivo = false; };
  }, [arquivo]);

  if (!estado) return null;
  const caixa = { margin: "8px 0 0", padding: "10px 12px", borderRadius: 10, fontSize: 12 };
  if (estado.lendo) return <div style={{ ...caixa, background: T.bg, color: T.textSm }}>Lendo a nota…</div>;
  if (estado.erro) return null; // leitura é conveniência; sem ela o fluxo segue igual
  const d = estado.dados;
  if (d.layout === "sem texto") {
    return <div style={{ ...caixa, background: T.bg, color: T.textSm }}>Não conseguimos ler o texto deste PDF (pode ser uma imagem escaneada). Preencha os dados abaixo conferindo na nota.</div>;
  }

  // Quadro campo a campo. "informado" = o que está no formulário agora.
  const checks = compararLeitura(d, { ...nfData, valorNF: total }, cnpj ? { cnpj } : null)
    .filter(c => c.campo !== "Chave" || c.ok === false);
  const divs = nfData ? divergenciasEnvio(d, { ...nfData, total, cnpj }) : [];
  const temDiv = divs.length > 0;
  const valorDiverge = divs.some(x => x.campo === "Valor");
  const cor = temDiv ? "#b45309" : "#059669";
  const fundo = temDiv ? "#f59e0b14" : "#22c55e12";
  const borda = temDiv ? "#f59e0b66" : "#22c55e55";

  const linha = (c) => {
    const fraco = c.fraco && c.ok !== true;
    const ok = c.ok === true, ruim = c.ok === false && !c.fraco;
    const icone = ok ? "✓" : ruim ? "✗" : "·";
    const corLinha = ok ? "#059669" : ruim ? "#b45309" : T.textSm;
    const pdf = c.campo === "Emissor" ? (c.ok ? "consta" : c.ok === false ? "não consta" : "—") : (c.pdf ?? "—");
    const inf = c.campo === "Emissor" ? (nfData?.fornecedor || "—") : (c.hub ?? "—");
    return (
      <tr key={c.campo} style={{ color: corLinha }}>
        <td style={{ padding: "3px 6px 3px 0", fontWeight: 600, whiteSpace: "nowrap" }}>{icone} {c.campo === "Emissor" ? "CNPJ" : c.campo}</td>
        <td style={{ padding: "3px 8px", fontVariantNumeric: "tabular-nums" }}>{pdf}{fraco ? " ?" : ""}</td>
        <td style={{ padding: "3px 8px", fontVariantNumeric: "tabular-nums" }}>{inf}</td>
      </tr>
    );
  };

  return (
    <div style={{ ...caixa, background: fundo, border: `1px solid ${borda}` }}>
      <p style={{ margin: 0, color: cor, fontWeight: 700, fontSize: 13 }}>
        {temDiv ? "⚠️ A nota não bate com o que foi informado" : "✓ Nota lida e conferida"}
      </p>
      <table style={{ borderCollapse: "collapse", marginTop: 6, width: "100%", maxWidth: 420 }}>
        <thead>
          <tr style={{ color: T.textSm, fontSize: 11 }}>
            <th style={{ textAlign: "left", padding: "0 6px 2px 0", fontWeight: 600 }}></th>
            <th style={{ textAlign: "left", padding: "0 8px 2px", fontWeight: 600 }}>na nota (PDF)</th>
            <th style={{ textAlign: "left", padding: "0 8px 2px", fontWeight: 600 }}>informado</th>
          </tr>
        </thead>
        <tbody>{checks.map(linha)}</tbody>
      </table>
      {estado.preencheu.length > 0 && !temDiv && (
        <p style={{ margin: "6px 0 0", color: T.textSm, fontSize: 11 }}>Preenchemos {estado.preencheu.join(" e ")} a partir da nota. Confira os campos abaixo.</p>
      )}
      {temDiv && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {valorDiverge && onVoltarValores && (
            <button type="button" onClick={onVoltarValores}
              style={{ background: "#b45309", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              ← Corrigir os valores
            </button>
          )}
          <span style={{ color: T.textSm, fontSize: 11 }}>
            {valorDiverge ? "Os valores foram informados na etapa anterior. " : ""}
            {divs.some(x => x.campo !== "Valor") ? "Número, data e fornecedor se corrigem nos campos abaixo. " : ""}
            Se a nota estiver certa assim, pode seguir: vamos só confirmar ao enviar.
          </span>
        </div>
      )}
    </div>
  );
}
