import { useEffect, useRef, useState } from "react";
import { fileToDataUrl, hashDataUrl } from "../lib/supabase";
import { nfArquivoJaAnexado } from "../lib/dedupeNF";

// ─── ANEXO DA NF (zona de arrastar/clicar) ────────────────────────────────────
// Usado em todos os cadastros internos de nota (por jogo, avulsa, mensal,
// Livemode). Duas travas contra anexo trocado (casos de 09/09/2026: o mesmo PDF
// da nota anterior foi anexado na seguinte):
//   1. aceita UM arquivo por vez — arrastar vários é recusado com aviso;
//   2. ao anexar, calcula a assinatura do arquivo e pergunta ao servidor se ele
//      já está em outra nota; se estiver, mostra em vermelho qual, e o
//      formulário pede confirmação antes de salvar (onVerificacao).
export default function AnexoNF({ arquivo, setArquivo, T, cor = "#22c55e", ignorarIds = [], onVerificacao, label = "Arquivo da NF (PDF/imagem)", accept = ".pdf,.png,.jpg,.jpeg,.webp" }) {
  const fileRef = useRef(null);
  const [aviso, setAviso] = useState(null);       // { matches: [...] } | { erro } | null
  const [checando, setChecando] = useState(false);

  const escolher = (files) => {
    const lista = Array.from(files || []);
    if (lista.length > 1) { window.alert(`Você soltou ${lista.length} arquivos. Anexe UM arquivo por nota — arraste só o PDF desta NF.`); return; }
    setArquivo(lista[0] || null);
  };

  useEffect(() => {
    let vivo = true;
    setAviso(null); onVerificacao?.(null);
    if (!arquivo) return;
    setChecando(true);
    (async () => {
      try {
        const dataUrl = await fileToDataUrl(arquivo);
        const hash = await hashDataUrl(dataUrl);
        const matches = hash ? (await nfArquivoJaAnexado(hash)).filter(m => !ignorarIds.map(String).includes(String(m.id))) : [];
        if (!vivo) return;
        const r = { hash, matches };
        setAviso(matches.length ? r : null); onVerificacao?.(r);
      } catch (e) { if (vivo) { setAviso({ erro: e.message }); onVerificacao?.({ hash: null, matches: [] }); } }
      finally { if (vivo) setChecando(false); }
    })();
    return () => { vivo = false; };
  }, [arquivo]);

  const descreve = (m) => `NF ${m.numeroNF || "s/nº"} · ${m.fornecedor || "?"}${m.jogoLabel ? ` · ${m.jogoLabel}` : m.mesLabel ? ` · ${m.mesLabel}` : ""}${m.valor ? ` · R$ ${Number(m.valor).toLocaleString("pt-BR")}` : ""}`;
  const repetido = !!aviso?.matches?.length;
  const borda = repetido ? "#dc2626" : arquivo ? cor : T.muted;

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ color: T.textMd, fontSize: 12, display: "block", marginBottom: 4 }}>{label}</label>
      <input ref={fileRef} type="file" accept={accept} onChange={e => { escolher(e.target.files); e.target.value = ""; }} style={{ display: "none" }}/>
      <div onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); escolher(e.dataTransfer.files); }}
        style={{ border: `2px dashed ${borda}`, borderRadius: 8, padding: "14px 16px", cursor: "pointer", textAlign: "center",
                 background: repetido ? "#dc262611" : arquivo ? `${cor}11` : T.bg, transition: "all 0.2s" }}>
        {arquivo
          ? <p style={{ margin: 0, color: repetido ? "#dc2626" : cor, fontSize: 13, fontWeight: 600 }}>{arquivo.name} ({(arquivo.size / 1024).toFixed(0)} KB){checando ? " · verificando…" : ""}</p>
          : <p style={{ margin: 0, color: T.textSm, fontSize: 12 }}>Clique ou arraste o arquivo aqui (um por nota)</p>}
      </div>
      {repetido && (
        <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 6, background: "#dc262612", border: "1px solid #dc262655" }}>
          <p style={{ margin: 0, color: "#dc2626", fontSize: 12, fontWeight: 700 }}>⚠️ Este arquivo já está anexado em outra nota:</p>
          {aviso.matches.slice(0, 4).map((m, i) => <p key={i} style={{ margin: "3px 0 0", color: "#b91c1c", fontSize: 12 }}>• {descreve(m)}</p>)}
          <p style={{ margin: "4px 0 0", color: T.textSm, fontSize: 11 }}>Confira se este é o PDF desta NF. Se for a mesma nota cobrindo vários jogos, pode seguir.</p>
        </div>
      )}
      {aviso?.erro && <p style={{ margin: "4px 0 0", color: T.textSm, fontSize: 11 }}>Não foi possível checar duplicidade do arquivo ({aviso.erro}).</p>}
    </div>
  );
}
