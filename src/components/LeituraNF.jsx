import { useEffect, useState } from "react";
import { lerNF, compararLeitura, resumoLeitura } from "../lib/leitorNF";

// ─── LEITURA AUTOMÁTICA DO PDF NA CONFERÊNCIA ────────────────────────────────
// Mostra, embaixo da submissão recebida, o que o PDF anexado diz (nº, chave,
// emissão, valor, emissor) e se bate com o que o fornecedor digitou. Só leitura:
// nada é alterado — a decisão continua sendo do operador ao Aprovar/Rejeitar.
const COR = { verde: "#22c55e", vermelho: "#dc2626", cinza: "#94a3b8" };

export default function LeituraNF({ id, carregar, nota, fornecedores = [], T, compacto = false }) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    let vivo = true;
    setRes(null);
    if (!id) return;
    lerNF(id, carregar).then(r => { if (vivo) setRes(r); });
    return () => { vivo = false; };
  }, [id]);

  const fornecedorCad = fornecedores.find(f => String(f?.apelido || "").trim().toLowerCase() === String(nota?.fornecedor || "").trim().toLowerCase())
    || fornecedores.find(f => f?.razaoSocial && String(nota?.fornecedor || "").toLowerCase().includes(String(f.razaoSocial).toLowerCase()));

  if (!res) return <p style={{ margin: "0 0 10px", fontSize: 11, color: T.textSm }}>Lendo o PDF…</p>;
  if (res.erro) return <p style={{ margin: "0 0 10px", fontSize: 11, color: T.textSm }}>Leitura do PDF indisponível ({res.erro}).</p>;

  const checks = res.imagem ? [] : compararLeitura(res.dados, nota, fornecedorCad);
  const resumo = res.imagem ? { tom: "cinza", texto: "Anexo é imagem — sem leitura automática, confira visualmente" } : resumoLeitura(res.dados, checks);
  const cor = COR[resumo.tom];

  return (
    <div style={{ margin: "0 0 12px", padding: compacto ? "6px 10px" : "8px 12px", borderRadius: 8, background: cor + "12", border: `1px solid ${cor}55` }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: cor }}>
        {resumo.tom === "verde" ? "✓ " : resumo.tom === "vermelho" ? "⚠️ " : "ⓘ "}{resumo.texto}
        {res.dados?.layout && res.dados.layout !== "sem texto" && <span style={{ fontWeight: 400, color: T.textSm, marginLeft: 8 }}>{res.dados.layout}</span>}
      </p>
      {checks.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {checks.map(c => {
            const cc = c.ok === true ? COR.verde : c.ok === false ? COR.vermelho : COR.cinza;
            const texto = c.ok === false
              ? `${c.campo}: PDF ${c.pdf} ≠ digitado ${c.hub}`
              : c.ok === true
                ? `${c.campo}: ${c.pdf}`
                : `${c.campo}: ${c.pdf ? `PDF ${c.pdf}` : "não lido no PDF"}${c.hub ? "" : " · sem valor digitado"}`;
            return (
              <span key={c.campo} title={c.fraco ? "Leitura por aproximação (sem rótulo explícito no PDF)" : undefined}
                style={{ background: cc + "1a", color: cc, border: `1px solid ${cc}40`, borderRadius: 999, padding: "1px 9px", fontSize: 11, fontWeight: 600 }}>
                {texto}{c.fraco ? " ?" : ""}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
