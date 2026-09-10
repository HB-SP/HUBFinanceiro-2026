// ─── LEITOR DE NF (PDF) ───────────────────────────────────────────────────────
// Lê a camada de texto do PDF anexado e extrai número, chave de acesso, CNPJs,
// data de emissão e valor, para cruzar com o que o fornecedor digitou. Nasceu da
// varredura de 09/09/2026 (anexos trocados e nº com a chave colada). É SÓ
// LEITURA: nada aqui grava — quem decide continua sendo o operador na
// conferência. PDF escaneado (sem texto) devolve layout "sem texto".
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

// ── extração por regex (padrão nacional + prefeituras comuns + recibos) ──
// Mesmas regras do script de varredura (validado em ~1.000 PDFs reais em 09/2026).
export function extrairDadosNF(txt) {
  const T = String(txt || "").replace(/ /g, " ").replace(/[ \t]+/g, " ");
  const r = { layout: "desconhecido", numero: null, chave: null, cnpjs: [], emissao: null, valor: null, textoLen: T.length };
  if (T.length < 40) { r.layout = "sem texto"; return r; }
  const chave = (T.match(/\b(\d{50})\b/) || T.match(/Chave de Acesso[^0-9]{0,40}((?:\d[\s.]?){50})/i) || [])[1];
  if (chave) { r.chave = dig(chave); r.numero = numeroDeChave(r.chave); r.layout = "NFS-e padrão nacional"; }
  if (/NFS-?e/i.test(T) && !r.layout.startsWith("NFS")) r.layout = "NFS-e municipal";
  if (/recibo/i.test(T) && !/NFS-?e|nota fiscal/i.test(T)) r.layout = "recibo";
  if (/DANFE|NF-e/i.test(T) && !/NFS/i.test(T)) r.layout = "NF-e (DANFE)";
  // NF-e de mercadoria (DANFE): chave de 44 dígitos, número nas posições 25–33.
  if (!r.chave) { const k44 = (T.match(/\b(\d{44})\b/) || T.match(/Chave de Acesso[^0-9]{0,40}((?:\d[\s.]?){44})/i) || [])[1]; if (k44) { r.chave = dig(k44); r.numero = String(parseInt(r.chave.slice(25, 34), 10) || "") || null; if (r.layout === "desconhecido") r.layout = "NF-e (DANFE)"; } }
  // Rótulo impresso — quando há chave, serve de segunda confirmação do número.
  const rot = T.match(/N[úu]mero\s*(?:da\s*)?NFS-?e\s*[:#nº°]?\s*(\d{1,12})\b/i)
    || T.match(/NFS-?e\s*(?:n[ºo°.]|N[úu]mero)\s*:?\s*(\d{1,12})\b/i)
    || T.match(/N[úu]mero\s*(?:da\s*)?Nota(?:\s*Fiscal)?(?:\s*de\s*Servi[çc]os?)?\s*:?\s*(\d{1,12})\b/i)
    || T.match(/\bRecibo\s*(?:n[ºo°.]?\s*)?(\d{1,8})\b/i)
    || T.match(/\bFatura\s*(?:n[ºo°.]?\s*)?(\d{1,8})\b/i);
  if (rot) r.numeroImpresso = String(parseInt(dig(rot[1]), 10) || "");
  if (!r.numero && r.numeroImpresso) r.numero = r.numeroImpresso;
  r.cnpjs = [...new Set((T.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) || []).map(dig).filter(d => d.length === 14))];
  r.temCPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(T);
  const dmRot = T.match(/(?:Data\s*e\s*Hora\s*d[ae]\s*Emiss[ãa]o|Data\s*d[ae]\s*Emiss[ãa]o|Emiss[ãa]o|Emitida\s*em|Compet[êe]ncia(?:\s*da\s*NFS-?e)?)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  const dm = dmRot || T.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (dm) { r.emissao = dm[1]; r.emissaoFonte = dmRot ? "rótulo" : "primeira data"; }
  // Texto do DANFSe costuma vir SEM espaços ("ValordoServiço R$1.200,00").
  // Ordem: líquido → total → valor do serviço → total genérico → maior "R$".
  const V = "\\s*[^\\d]{0,30}?([\\d.]+,\\d{2})";
  const vm = T.match(new RegExp("Valor\\s*L[íi]quido(?:\\s*da\\s*NFS-?e)?" + V, "i"))
    || T.match(new RegExp("Valor\\s*Total\\s*d[ao]\\s*(?:Nota|NFS-?e|Servi[çc]os?)" + V, "i"))
    || T.match(new RegExp("Valor\\s*d[oa]s?\\s*Servi[çc]os?" + V, "i"))
    || T.match(new RegExp("Valor\\s*(?:Total|Bruto)" + V, "i"))
    || T.match(new RegExp("Total\\s*(?:Geral|a\\s*Pagar|da\\s*Nota)?" + V, "i"));
  if (vm) { r.valor = parseBR(vm[1]); r.valorFonte = /Total|L[íi]quido/i.test(vm[0]) ? "total" : "item"; }
  else {
    const todos = [...T.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map(x => parseBR(x[1])).filter(x => x > 0);
    if (todos.length) { r.valor = Math.max(...todos); r.valorFonte = "maior R$"; }
  }
  return r;
}

const normData = s => {
  const t = String(s || "");
  let m = t.match(/(\d{2})[\/.-](\d{2})[\/.-](\d{4})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};
const fmtBR = v => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Cruza o que o PDF diz com a nota/submissão. Devolve checagens
// { campo, pdf, hub, ok } com ok = true (bate), false (diverge) ou null (não
// deu pra comparar: PDF sem o dado ou nota sem o dado).
export function compararLeitura(dados, nota, fornecedorCadastro) {
  const checks = [];
  // Número: o nº do Hub pode ser a chave colada — aí vale o nº embutido nela.
  const hubNumInfo = analisarNumeroNF(nota?.numeroNF);
  const hubNumDig = dig(hubNumInfo?.numero);
  const hubNum = hubNumDig ? String(parseInt(hubNumDig, 10)) : null;
  const pdfNum = dados.numero ? String(parseInt(dados.numero, 10)) : null;
  checks.push({ campo: "Nº", pdf: pdfNum, hub: hubNum, ok: pdfNum && hubNum ? pdfNum === hubNum : null });
  // Chave: se as duas existem, têm de ser idênticas.
  const hubChave = hubNumInfo?.chaveAcesso || (nota?.chaveAcesso ? dig(nota.chaveAcesso) : null);
  if (dados.chave && hubChave) checks.push({ campo: "Chave", pdf: "…" + dados.chave.slice(-8), hub: "…" + hubChave.slice(-8), ok: dados.chave === hubChave });
  // Emissão
  const hubData = normData(nota?.dataEmissao);
  const pdfData = normData(dados.emissao);
  checks.push({ campo: "Emissão", pdf: pdfData, hub: hubData, ok: pdfData && hubData ? pdfData === hubData : null, fraco: dados.emissaoFonte === "primeira data" });
  // Valor
  const hubValor = nota?.valorNF ?? nota?.valor ?? (nota?.servicosValores ? Object.values(nota.servicosValores).reduce((s, v) => s + (Number(v) || 0), 0) : null);
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
