import { normalizeEnvioMetricas } from "./notasFiscais";

// ─── ESPELHO NOTA → RESUMO DO ENVIO ──────────────────────────────────────────
// O envio guarda uma CÓPIA resumida de cada nota (notasResumo/mensaisResumo/
// livemodeResumo), tirada no momento em que a nota entra no envio. Até 11/09/2026
// nada atualizava essa cópia: nota editada depois (nº corrigido, data, anexo
// incluído, valor) ficava divergente do que o envio mostrava — no Hub e na página
// pública (#envio/<token>), que só oferece download se o RESUMO diz hasFile=true.
// Casos reais: Pedro Henrique (envio 19, nº de outra nota), Multvídeo/Ewerton
// (ano corrigido só na nota), 6 PDFs reanexados sem aparecer no Portal.
//
// Esta função devolve os envios com os resumos alinhados às notas vivas. Só cria
// objetos novos onde algo mudou (referência igual = nada a gravar).

// Só os campos que precisam estar CERTOS no envio e no Portal: identificação da
// nota (nº, código, fornecedor), valor, data de emissão e existência do anexo.
// Campos descritivos (categoria, mesLabel, rótulos de serviço, jogo/rodada) ficam
// como estavam quando a nota entrou no envio — o envio é registro do que foi
// enviado à entidade, e recategorizações posteriores não devem reescrevê-lo.
// fileHash também fica de fora: resumos antigos nunca tiveram o campo e incluí-lo
// reescreveria todos os envios sem ganho.
const CAMPOS = {
  nota:      ["codigo", "fornecedor", "valorNF", "numeroNF", "dataEmissao", "hasFile"],
  mensal:    ["fornecedor", "valor", "numeroNF", "dataEmissao", "hasFile"],
  livemode:  ["fornecedor", "valor", "numeroNF", "dataEmissao", "hasFile"],
  // reembolso Livemode mora em `notas` (tipo reembolso_livemode) mas entra no livemodeResumo com valor = valorNF
  reembolso: ["codigo", "fornecedor", "numeroNF", "dataEmissao", "hasFile"],
};

const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function alinhar(resumo, nota, campos, extra) {
  let novo = null;
  for (const k of campos) {
    if (!(k in nota) && !(k in resumo)) continue;
    const v = nota[k];
    if (v === undefined) continue;                 // nota não tem o campo: não apaga o do resumo
    if (!igual(resumo[k], v)) { novo = novo || { ...resumo }; novo[k] = v; }
  }
  for (const [k, v] of Object.entries(extra || {})) if (!igual(resumo[k], v)) { novo = novo || { ...resumo }; novo[k] = v; }
  return novo;
}

export function sincronizarResumosEnvios(envios, { notas = [], notasMensais = [], notasLivemode = [] } = {}, { dedupeNotasPorNF = false } = {}) {
  const porId = (arr) => { const m = new Map(); for (const n of arr || []) if (n && n.id != null) m.set(String(n.id), n); return m; };
  const mNotas = porId(notas), mMensais = porId(notasMensais), mLive = porId(notasLivemode);
  let mudancas = 0;
  const saida = (envios || []).map(e => {
    let mudouEnvio = false;
    const mapa = (lista, tipo) => (lista || []).map(r => {
      let nota, campos, extra;
      if (tipo === "nota") { nota = mNotas.get(String(r.id)); campos = CAMPOS.nota; }
      else if (tipo === "mensal") { nota = mMensais.get(String(r.id)); campos = CAMPOS.mensal; }
      else {
        nota = mLive.get(String(r.id));
        if (nota) campos = CAMPOS.livemode;
        else { nota = mNotas.get(String(r.id)); if (nota && nota.tipo === "reembolso_livemode") { campos = CAMPOS.reembolso; extra = { valor: nota.valorNF }; } else nota = null; }
      }
      if (!nota) return r;                          // nota excluída/desconhecida: mantém a cópia (o envio é o registro histórico)
      const novo = alinhar(r, nota, campos, extra);
      if (novo) { mudouEnvio = true; mudancas++; novo.sincronizadoComNotaEm = new Date().toISOString(); }
      return novo || r;
    });
    const notasResumo = mapa(e.notasResumo, "nota");
    const mensaisResumo = mapa(e.mensaisResumo, "mensal");
    const livemodeResumo = mapa(e.livemodeResumo, "livemode");
    if (!mudouEnvio) return e;
    return normalizeEnvioMetricas({ ...e, notasResumo, mensaisResumo, livemodeResumo }, { dedupeNotasPorNF });
  });
  return { envios: mudancas ? saida : envios, mudancas };
}
