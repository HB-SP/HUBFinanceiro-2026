// ─── LEITOR DE NF (PDF) ───────────────────────────────────────────────────────
// Lê a camada de texto do PDF anexado e extrai número, chave de acesso, CNPJs,
// data de emissão e valor, para cruzar com o que o fornecedor digitou. Nasceu da
// varredura de 09/09/2026 (anexos trocados e nº com a chave colada). É SÓ
// LEITURA: nada aqui grava — quem decide continua sendo o operador na
// conferência. PDF escaneado (sem texto) devolve layout "sem texto".
//
// As regras de rótulo foram aprendidas em 10/09/2026 no acervo real (1.163 PDFs
// com texto): NFS-e padrão nacional, Prefeitura de São Paulo, São Caetano,
// Ribeirão Preto, DANFE/CT-e, faturas de locação (RM Digital, Loc-Line, De
// Nadai, CTA), recibos (Conecta, LineUP) e invoice (Intelsat). Cada regra exige
// um rótulo explícito antes do dado — nunca "o primeiro número que aparecer".
//
// O pdf.js é carregado sob demanda (import dinâmico) para não pesar o bundle
// de quem nunca abre a aba Recebidas.

import { analisarNumeroNF } from "./nfNumero";

const dig = s => String(s || "").replace(/\D/g, "");
const parseBR = s => {
  if (s == null) return null;
  const t = String(s).replace(/[R$\s]/g, "");
  if (!t) return null;
  if (/,\d{2}$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  const n = Number(t.replace(/,/g, ""));
  return isNaN(n) ? null : n;
};
const numeroDeChave = k => { const d = dig(k); return d.length >= 44 ? String(parseInt(d.slice(23, 36), 10)) : null; };
const limpaNum = s => { const d = dig(s); return d ? String(parseInt(d, 10)) : null; };

let pdfjsPromise = null;
async function carregarPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import("pdfjs-dist");
      const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      lib.GlobalWorkerOptions.workerSrc = worker;
      return lib;
    })().catch(e => { pdfjsPromise = null; throw e; });
  }
  return pdfjsPromise;
}

// dataUrl (data:application/pdf;base64,...) → texto das primeiras páginas.
export async function extrairTextoPDF(dataUrl, maxPaginas = 2) {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.*)$/s);
  if (!m) throw new Error("arquivo inválido");
  if (m[1] !== "application/pdf") return { texto: "", mime: m[1], paginas: 0 };
  const lib = await carregarPdfjs();
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const doc = await lib.getDocument({ data: bytes, disableFontFace: true, isEvalSupported: false }).promise;
  let texto = "";
  const n = Math.min(doc.numPages, maxPaginas);
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    texto += tc.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("") + "\n";
  }
  try { doc.destroy(); } catch { /* ignore */ }
  return { texto, mime: m[1], paginas: doc.numPages };
}

// ── Rótulos de NÚMERO, do mais específico ao mais genérico ─────────────────
// `data`: índice do grupo que traz a data de emissão junto (layouts em que o
// cabeçalho vem antes e os valores depois, na mesma ordem).
const D = "(\\d{2}[\\/.-]\\d{2}[\\/.-]\\d{4})";
const REGRAS_NUMERO = [
  // Prefeitura de São Paulo: "Número da Nota Data e Hora de Emissão Código de Verificação <token> 00000058 02/02/2026 12:23:05"
  { re: new RegExp("N[úu]mero da Nota\\s+Data e Hora de Emiss[ãa]o[\\s\\S]{0,140}?\\b(\\d{6,10})\\s+" + D, "i"), data: 2, fonte: "SP" },
  // Padrão nacional (DANFSe): "Número da NFS-e 20" (texto às vezes sem espaços)
  { re: /N[úu]mero\s*(?:da\s*)?NFS-?e\s*[:#nº°]?\s*(\d{1,12})\b/i, fonte: "NFS-e" },
  { re: /NFS-?e\s*(?:n[ºo°.]|N[úu]mero)\s*:?\s*(\d{1,12})\b/i, fonte: "NFS-e" },
  // São Caetano do Sul e afins: cabeçalho "Número da NFS-e ..." e os valores depois "216 18/02/2026"
  { re: new RegExp("N[úu]mero da NFS-?e[\\s\\S]{0,200}?\\b(\\d{1,10})\\s+" + D, "i"), data: 2, fonte: "NFS-e cabeçalho" },
  // São Caetano (2º modelo): "Série RPS RPS NFS-e Substituída 258 NFS-e Código de Verificação"
  { re: /NFS-?e\s+Substitu[íi]da\s+(\d{1,10})\s+NFS-?e\s+C[óo]digo/i, fonte: "NFS-e São Caetano" },
  // "NOTA FISCAL Nº 96", "Nota Fiscal Eletrônica de Serviços Nº: 12"
  { re: /Nota\s*Fiscal(?:\s*Eletr[ôo]nica)?(?:\s*de\s*Servi[çc]os?)?\s*(?:-\s*)?N[º°o.]+\s*:?\s*(\d{1,10})\b/i, fonte: "Nota Fiscal Nº" },
  { re: /N[úu]mero\s*(?:da\s*)?Nota(?:\s*Fiscal)?(?:\s*de\s*Servi[çc]os?)?\s*:?\s*(\d{1,12})\b/i, fonte: "Número da Nota" },
  // DANFE: "NF-e Nº. 000.000.650"
  { re: /NF-?e\s*N[º°o.]+\s*:?\s*((?:\d{1,3}\.){0,3}\d{1,3})(?![\d])/i, fonte: "NF-e Nº" },
  // Ribeirão Preto ("Número 65 Data de emissão"), CT-e ("SÉRIE 1 NÚMERO 2081").
  // Exige dígitos logo depois — "Número de Inscrição"/"Número do RPS" não entram.
  { re: /\bN[úu]mero\s*:?\s+(\d{1,10})(?![\d.\/-])/i, fonte: "Número" },
  // Faturas: "FATURA Nº 4804", "FATURA DE LOCAÇÃO Nº FAT-011841", "FATURA DE LOCAÇÃO - N° 109/2026", "Fatura: 205"
  { re: /Fatura(?:\s+de\s+Loca[çc][ãa]o)?\s*(?:-\s*)?(?:N[º°o.]+\s*:?|:)\s*(?:[A-Z]{2,5}-)?(\d{1,10})(?:\/\d{2,4})?(?![\d])/i, fonte: "Fatura Nº" },
  // CTA Transmissões: cabeçalho "Fatura Nº Fatura Valor R$ Data da emissão" e depois "2026098 R$ 5.600,00 08/09/2026"
  { re: new RegExp("Fatura\\s*N[º°o.]*\\s+Fatura\\s+Valor[^\\d]{0,40}(\\d{4,10})\\s+R\\$\\s*[\\d.,]+\\s+" + D, "i"), data: 2, fonte: "Fatura CTA" },
  { re: /Fatura\s*N[º°o.]*\s+Fatura\s+Valor[^\d]{0,40}(\d{4,10})\b/i, fonte: "Fatura CTA" },
  // De Nadai: "De locação constantes da Fatura de Prestação de Serviços. 4779"
  { re: /Fatura de Presta[çc][ãa]o de Servi[çc]os\.?\s+(\d{2,8})\b/i, fonte: "Fatura De Nadai" },
  // Recibos: "RECIBO N.º: 26024", "Recibo nº : 17", "Recibo 12"
  { re: /Recibo\s*(?:N[º°.o]*\s*)?:?\s*(\d{1,8})\b/i, fonte: "Recibo" },
  // Invoice (Intelsat/SES): "Invoice No. Customer No. Page 2670007477"
  { re: /Invoice\s*(?:No\.?|Number|#|ID)?\s*(?:Customer\s*No\.?\s*Page\s*)?:?\s*(\d{4,12})\b/i, fonte: "Invoice" },
  // Sistema próprio (Contra Ataque): "Venda 202577 19/02/2026"
  { re: new RegExp("\\bVenda\\s+(\\d{3,10})\\s+" + D, "i"), data: 2, fonte: "Venda" },
];

// ── Rótulos de DATA DE EMISSÃO ──────────────────────────────────────────────
const REGRAS_DATA = [
  // Padrão nacional: "Data e Hora da emissão da NFS-e 23/02/2026" (Competência vem antes e NÃO é a emissão)
  new RegExp("Data\\s*e\\s*Hora\\s*d[ae]\\s*Emiss[ãa]o(?:\\s*da\\s*NFS-?e)?\\s*:?\\s*" + D, "i"),
  new RegExp("Data\\s*d[ae]\\s*Emiss[ãa]o(?:\\s*da\\s*NFS-?e)?\\s*:?\\s*" + D, "i"),
  new RegExp("\\bEmiss[ãa]o(?:\\s*da\\s*NFS-?e)?\\s*:?\\s*" + D, "i"),
  // Loc-Line: cabeçalho "PERÍODO DE REFERÊNCIA DATA DE EMISSÃO" e valores "EVENTO : 14/03/2026 11:11 - 14/03/2026 11:11 16/03/2026"
  { re: new RegExp("EVENTO\\s*:\\s*" + D + "[\\s\\d:]*-\\s*" + D + "[\\s\\d:]*\\s" + D, "i"), grupo: 3 },
  new RegExp("Emitid[ao]\\s*em\\s*:?\\s*" + D, "i"),
  new RegExp("Document\\s*date\\s*:?\\s*" + D, "i"),
  new RegExp("Compet[êe]ncia(?:\\s*da\\s*NFS-?e)?\\s*:?\\s*" + D, "i"),
  // "São Paulo, 22 de Abril de 2026." (faturas de locação) → dd/mm/aaaa
  { re: /,?\s*(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/i, extenso: true },
];
const MESES = { janeiro: "01", fevereiro: "02", marco: "03", março: "03", abril: "04", maio: "05", junho: "06", julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12" };
const dataBR = s => { const m = String(s || "").match(/(\d{2})[\/.-](\d{2})[\/.-](\d{4})/); return m ? `${m[1]}/${m[2]}/${m[3]}` : null; };

// ── extração ────────────────────────────────────────────────────────────────
export function extrairDadosNF(txt) {
  // Todo espaço em branco (inclusive quebra de linha) vira um espaço: rótulos
  // como "Número da\nNFS-e" precisam casar com as regras escritas em uma linha.
  const T = String(txt || "").replace(/\s+/g, " ");
  const r = { layout: "desconhecido", numero: null, chave: null, cnpjs: [], emissao: null, valor: null, textoLen: T.length };
  if (T.length < 40) { r.layout = "sem texto"; return r; }

  // 1) Chave de acesso (fonte mais confiável do número)
  const chave50 = (T.match(/\b(\d{50})\b/) || T.match(/Chave de Acesso[^0-9]{0,40}((?:\d[\s.]?){50})/i) || [])[1];
  if (chave50) { r.chave = dig(chave50); r.numero = numeroDeChave(r.chave); r.numeroFonte = "chave NFS-e"; r.layout = "NFS-e padrão nacional"; }
  if (/NFS-?e/i.test(T) && !r.layout.startsWith("NFS")) r.layout = "NFS-e municipal";
  if (/recibo/i.test(T) && !/NFS-?e|nota fiscal/i.test(T)) r.layout = "recibo";
  if (/DANFE|NF-e|DACTE|CT-e/i.test(T) && !/NFS/i.test(T)) r.layout = "NF-e (DANFE)";
  if (/\bInvoice\b/i.test(T) && r.layout === "desconhecido") r.layout = "invoice";
  if (/\bFatura\b/i.test(T) && r.layout === "desconhecido") r.layout = "fatura";
  if (/Prefeitura do Munic[íi]pio de S[ãa]o Paulo/i.test(T)) r.layout = "NFS-e São Paulo";
  // NF-e/CT-e de mercadoria: chave de 44 dígitos, número nas posições 25–33.
  if (!r.chave) {
    const k44 = (T.match(/\b(\d{44})\b/) || T.match(/Chave de Acesso[^0-9]{0,40}((?:\d[\s.]?){44})/i) || [])[1];
    if (k44) { r.chave = dig(k44); r.numero = String(parseInt(r.chave.slice(25, 34), 10) || "") || null; r.numeroFonte = "chave NF-e"; if (r.layout === "desconhecido") r.layout = "NF-e (DANFE)"; }
  }

  // 2) Rótulo impresso — vira o número quando não há chave; com chave, é a
  //    segunda confirmação (numeroImpresso).
  for (const regra of REGRAS_NUMERO) {
    const m = T.match(regra.re);
    if (!m) continue;
    const n = limpaNum(m[1]);
    if (!n) continue;
    r.numeroImpresso = n; r.numeroImpressoFonte = regra.fonte;
    if (regra.data && m[regra.data]) r.emissaoRotulo = dataBR(m[regra.data]);
    break;
  }
  if (!r.numero && r.numeroImpresso) { r.numero = r.numeroImpresso; r.numeroFonte = r.numeroImpressoFonte; }

  // 3) CNPJs / CPF
  r.cnpjs = [...new Set((T.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) || []).map(dig).filter(d => d.length === 14))];
  r.temCPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(T);

  // 4) Emissão: rótulo explícito → data que veio junto do número → primeira data do texto
  for (const regra of REGRAS_DATA) {
    if (regra.extenso) {
      const m = T.match(regra.re);
      if (m) { r.emissao = `${m[1].padStart(2, "0")}/${MESES[m[2].toLowerCase()] || "??"}/${m[3]}`; r.emissaoFonte = "rótulo"; break; }
      continue;
    }
    const m = T.match(regra.re || regra);
    if (m) { r.emissao = dataBR(m[regra.grupo || 1]); r.emissaoFonte = "rótulo"; break; }
  }
  if (!r.emissao && r.emissaoRotulo) { r.emissao = r.emissaoRotulo; r.emissaoFonte = "rótulo"; }
  if (!r.emissao) {
    // Primeira data do texto que NÃO seja vencimento/validade/período (De Nadai
    // traz "VENCIMENTO 07/04/2026" antes da emissão).
    for (const m of T.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)) {
      const antes = T.slice(Math.max(0, m.index - 40), m.index);
      if (/venc|validade|per[íi]odo|prazo|pagamento/i.test(antes)) continue;
      r.emissao = m[1]; r.emissaoFonte = "primeira data"; break;
    }
  }

  // 5) Valor. Texto do DANFSe costuma vir SEM espaços ("ValordoServiço R$1.200,00").
  //    Ordem: líquido → total → valor do serviço → total genérico → maior "R$".
  const V = "\\s*[^\\d]{0,30}?([\\d.]+,\\d{2})";
  const vm = T.match(new RegExp("Valor\\s*L[íi]quido(?:\\s*da\\s*NFS-?e)?" + V, "i"))
    || T.match(new RegExp("Valor\\s*Total\\s*d[ao]\\s*(?:Nota|NFS-?e|Servi[çc]os?|Fatura|Recibo)" + V, "i"))
    || T.match(new RegExp("Valor\\s*d[oa]s?\\s*Servi[çc]os?" + V, "i"))
    || T.match(new RegExp("Valor\\s*(?:Total|Bruto|da\\s*Fatura|do\\s*Recibo)" + V, "i"))
    || T.match(new RegExp("Total\\s*(?:Geral|a\\s*Pagar|da\\s*Nota|da\\s*Fatura|Amount)?" + V, "i"));
  if (vm) { r.valor = parseBR(vm[1]); r.valorFonte = /Total|L[íi]quido/i.test(vm[0]) ? "total" : "item"; }
  else {
    const todos = [...T.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map(x => parseBR(x[1])).filter(x => x > 0);
    if (todos.length) { r.valor = Math.max(...todos); r.valorFonte = "maior R$"; }
  }
  return r;
}

// dd/mm/aaaa completo, ou dd/mm quando o Hub gravou sem ano (notas antigas).
const normData = s => {
  const t = String(s || "");
  let m = t.match(/(\d{2})[\/.-](\d{2})[\/.-](\d{4})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = t.match(/^\s*(\d{2})\/(\d{2})\s*$/);
  return m ? `${m[1]}/${m[2]}` : null;
};
const mesmaData = (a, b) => a && b && (a.length === b.length ? a === b : a.slice(0, 5) === b.slice(0, 5));
const fmtBR = v => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Cruza o que o PDF diz com a nota/submissão. Devolve checagens
// { campo, pdf, hub, ok } com ok = true (bate), false (diverge) ou null (não
// deu pra comparar: PDF sem o dado ou nota sem o dado).
export function compararLeitura(dados, nota, fornecedorCadastro) {
  const checks = [];
  // Número: o nº do Hub pode ser a chave colada — aí vale o nº embutido nela.
  const hubNumInfo = analisarNumeroNF(nota?.numeroNF);
  const hubNum = limpaNum(hubNumInfo?.numero);
  const pdfNum = limpaNum(dados.numero);
  checks.push({ campo: "Nº", pdf: pdfNum, hub: hubNum, ok: pdfNum && hubNum ? pdfNum === hubNum : null, fonte: dados.numeroFonte });
  // Chave: se as duas existem, têm de ser idênticas.
  const hubChave = hubNumInfo?.chaveAcesso || (nota?.chaveAcesso ? dig(nota.chaveAcesso) : null);
  if (dados.chave && hubChave) checks.push({ campo: "Chave", pdf: "…" + dados.chave.slice(-8), hub: "…" + hubChave.slice(-8), ok: dados.chave === hubChave });
  // Emissão
  const hubData = normData(nota?.dataEmissao);
  const pdfData = normData(dados.emissao);
  checks.push({ campo: "Emissão", pdf: pdfData, hub: hubData, ok: pdfData && hubData ? mesmaData(pdfData, hubData) : null, fraco: dados.emissaoFonte === "primeira data" });
  // Valor
  const hubBruto = nota?.valorNF ?? nota?.valor ?? (nota?.servicosValores ? Object.values(nota.servicosValores).reduce((s, v) => s + (Number(v) || 0), 0) : null);
  const hubValor = typeof hubBruto === "string" ? parseBR(hubBruto) : (hubBruto == null || isNaN(Number(hubBruto)) ? null : Number(hubBruto));
  const pdfValor = dados.valor;
  checks.push({
    campo: "Valor",
    pdf: pdfValor != null ? fmtBR(pdfValor) : null,
    hub: hubValor != null ? fmtBR(hubValor) : null,
    ok: pdfValor != null && hubValor != null ? Math.abs(Number(pdfValor) - Number(hubValor)) < 0.01 : null,
    fraco: dados.valorFonte === "maior R$",
  });
  // Emissor: CNPJ do cadastro ou o CNPJ/raiz que vem no próprio nome digitado
  // ("64.892.047 CAROLINA..."). Tomador (Livemode) também aparece no PDF, por
  // isso a checagem é "algum CNPJ do PDF é o do fornecedor".
  const cnpjCad = dig(fornecedorCadastro?.cnpj);
  const raizNome = (dig((String(nota?.fornecedor || "").match(/^[\d.\/-]{8,}/) || [])[0]) || "").slice(0, 8);
  if (dados.cnpjs.length && (cnpjCad.length === 14 || raizNome.length === 8)) {
    const ok = cnpjCad.length === 14 ? dados.cnpjs.includes(cnpjCad) : dados.cnpjs.some(c => c.startsWith(raizNome));
    checks.push({ campo: "Emissor", pdf: ok ? "CNPJ no PDF" : "CNPJ não consta", hub: cnpjCad || raizNome, ok });
  }
  return checks;
}

export function resumoLeitura(dados, checks) {
  if (!dados) return { tom: "cinza", texto: "PDF não lido" };
  if (dados.layout === "sem texto") return { tom: "cinza", texto: "PDF sem texto legível (escaneado?) — confira visualmente" };
  const ruins = checks.filter(c => c.ok === false);
  const bons = checks.filter(c => c.ok === true);
  if (ruins.length) return { tom: "vermelho", texto: `PDF diverge: ${ruins.map(c => c.campo).join(", ")}` };
  if (!bons.length) return { tom: "cinza", texto: `PDF lido (${dados.layout}), sem dado comparável` };
  return { tom: "verde", texto: `PDF confere (${bons.map(c => c.campo).join(", ")})` };
}

// Cache por id + fila com 2 leituras simultâneas: a aba Recebidas dispara uma
// leitura por cartão ao montar, e sem isso 20 PDFs desceriam de uma vez.
const cache = new Map();
let ativos = 0; const fila = [];
const proximo = () => { if (ativos >= 2 || !fila.length) return; ativos++; const fn = fila.shift(); fn().finally(() => { ativos--; proximo(); }); };
export function lerNF(id, carregar) {
  if (cache.has(id)) return cache.get(id);
  const p = new Promise((resolve) => {
    fila.push(async () => {
      try {
        const dataUrl = await carregar();
        if (!dataUrl) return resolve({ erro: "arquivo não encontrado" });
        const { texto, mime } = await extrairTextoPDF(dataUrl);
        if (mime !== "application/pdf") return resolve({ dados: { layout: "sem texto", cnpjs: [] }, imagem: true });
        resolve({ dados: extrairDadosNF(texto) });
      } catch (e) { resolve({ erro: e?.message || String(e) }); }
    });
    proximo();
  });
  cache.set(id, p);
  p.then(r => { if (r?.erro) cache.delete(id); }); // erro de rede não fica preso no cache
  return p;
}
export const esquecerLeitura = id => cache.delete(id);
