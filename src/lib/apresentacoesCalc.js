// Cálculos da aba Apresentações — funções puras compartilhadas pelas três
// views (Variáveis, Fixos, Visão Geral). Antes viviam em triplicata dentro de
// TabApresentacoes.jsx (FormVariaveis/FormFixos vs defaultDados*) e divergiam;
// aqui a Visão Geral consome exatamente o mesmo resultado das outras views.
import { parseBR, fmtNum, subTotal } from "../utils";

export const fmtBRL = v => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const MESES_FIX = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
export const MESES_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

// Categorias variáveis (excluídas dos "Outros Mensais" fixos)
export const VAR_CATS_FIX = new Set(["Transporte","Uber","Hospedagem","Seg. Espacial"]);

// ─── CUSTOS VARIÁVEIS ────────────────────────────────────────────────────────
// rodadaSel === null → seguir a última rodada com jogos divulgados.
// overrides: { [rodada]: {orcado?, realizado?} } com valores string ("" nunca
// acontece por rodada — a presença da chave já é o override).
export function calcVariaveis({ jogos = [], rodadaSel = null, overrides = {}, nfEspOvr = "", nfRecOvr = "", orcGlobal = 0 }) {
  const rodadasDisp = Array.from(new Set(jogos.map(j => j.rodada))).sort((a, b) => a - b);
  const ultima = rodadasDisp[rodadasDisp.length - 1] || 1;
  const rodadaAtual = rodadaSel != null && rodadasDisp.includes(rodadaSel) ? rodadaSel : ultima;

  const jogosAteRod = jogos.filter(j => j.rodada <= rodadaAtual);
  const realAteRod = jogosAteRod.reduce((s, j) => s + subTotal(j.realizado || {}), 0);
  const rodadasAuto = rodadasDisp.filter(r => r <= rodadaAtual).map(r => {
    const jr = jogos.filter(j => j.rodada === r);
    return {
      rodada: r,
      label: `R${r}`,
      orcadoAuto: jr.reduce((s, j) => s + subTotal(j.orcado || {}), 0),
      // Na tabela "Realizado" = provisionado (mesma fonte da aba Savings)
      realizadoAuto: jr.reduce((s, j) => s + subTotal(j.provisionado || {}), 0),
    };
  });

  const rodadasView = rodadasAuto.map(r => ({
    ...r,
    orcado: overrides[r.rodada]?.orcado ?? fmtNum(r.orcadoAuto),
    realizado: overrides[r.rodada]?.realizado ?? fmtNum(r.realizadoAuto),
  }));

  const rows = rodadasView.map(r => ({ rodada: r.rodada, label: r.label, orcado: parseBR(r.orcado), realizado: parseBR(r.realizado) }));
  const totOrc = rows.reduce((s, r) => s + r.orcado, 0);
  const totReal = rows.reduce((s, r) => s + r.realizado, 0);
  const saving = totOrc - totReal;
  const savPct = totOrc > 0 ? saving / totOrc * 100 : 0;

  // Auto: nfEsp segue o total da coluna "Realizado" da tabela; nfRec segue o realizado real das NFs
  const autoNfEspV = totReal;
  const autoNfRecV = realAteRod;
  const nfEspV = nfEspOvr !== "" ? parseBR(nfEspOvr) : autoNfEspV;
  const nfRecV = nfRecOvr !== "" ? parseBR(nfRecOvr) : autoNfRecV;
  const nfPend = Math.max(0, nfEspV - nfRecV);
  const pctRec = nfEspV > 0 ? nfRecV / nfEspV * 100 : 0;

  return { rodadasDisp, rodadaAtual, rodadasView, rows, totOrc, totReal, saving, savPct, autoNfEspV, autoNfRecV, nfEspV, nfRecV, nfPend, pctRec, orcGlobal };
}

// ─── CUSTOS FIXOS ────────────────────────────────────────────────────────────
// Regra única (15/09/2026), só para a aba Apresentações. Fonte é a aba Serviços
// (mesma do dashboard); nada de override manual aqui.
//   Orçado       = orcado do item × fator liberado até a referência
//   Provisionado = provisionado do item × o MESMO fator
//   Realizado    = NFs mensais já recebidas do serviço (mes ≤ referência)
//   Saldo        = Orçado − Provisionado (NF que não chegou não é saving)
// Fator por tipo do item:
//   linear     → meses decorridos ÷ meses do campeonato
//   pontual    → 100% quando o mês alocado passou (fração se houver vários)
//   por_rodada → rodada de referência ÷ rodadas totais
//   misto      → parcela linear e parcela pontual, cada uma com sua regra
// Item encerrado: provisionado congela no realAoEncerrar.
export function calcFixos({ servicos = [], notasMensais = [], jogos = [], mesSel = null, rodadaSel = null, mesInicio = 0, mesFim = 11 }) {
  const mesAtual = mesSel != null ? mesSel : new Date().getMonth();
  const rodadasDisp = Array.from(new Set(jogos.map(j => j.rodada))).sort((a, b) => a - b);
  const rodadaAtual = rodadaSel != null && rodadasDisp.includes(rodadaSel) ? rodadaSel : (rodadasDisp[rodadasDisp.length - 1] || 1);
  const mesesCampeonato = Math.max(1, mesFim - mesInicio + 1);
  const mesesDecorridos = Math.max(0, Math.min(mesAtual, mesFim) - mesInicio + 1);
  const fatorLinear = mesesDecorridos / mesesCampeonato;

  const mesesAloc = it => Array.isArray(it.mesesAlocacao) ? it.mesesAlocacao : (it.mesAlocacao != null ? [it.mesAlocacao] : []);
  const fatorPontual = it => {
    const list = mesesAloc(it);
    if (!list.length) return 1; // sem mês configurado: conta integral
    return list.filter(m => m <= mesAtual).length / list.length;
  };
  const fator = it => {
    const tipo = it.tipo || "linear";
    if (tipo === "por_rodada") { const tot = it.rodadasTotal || 1; return Math.min(rodadaAtual, tot) / tot; }
    if (tipo === "pontual") return fatorPontual(it);
    if (tipo === "misto") {
      const pl = it.parcelaLinear || 0, pp = it.parcelaPontual || 0, tot = pl + pp;
      if (tot > 0) return (pl / tot) * fatorLinear + (pp / tot) * fatorPontual(it);
    }
    return fatorLinear;
  };

  const idsValidos = new Set(servicos.flatMap(sec => (sec.itens || []).map(it => it.id)));
  const nfDoItem = id => notasMensais.filter(n => n.servicoId === id && n.mes <= mesAtual).reduce((s, n) => s + (n.valor || 0), 0);

  const sections = servicos.map(sec => {
    const itens = (sec.itens || []).map(it => {
      const encerrado = it.status === "encerrado";
      const f = fator(it);
      return {
        id: it.id, nome: it.nome, tipo: encerrado ? "encerrado" : (it.tipo || "linear"), fator: f,
        mesesAlocacao: mesesAloc(it), rodadasTotal: it.rodadasTotal || null,
        orcAnual: it.orcado || 0, provAnual: it.provisionado || 0,
        orc: (it.orcado || 0) * f,
        prov: encerrado ? (it.realAoEncerrar || 0) : (it.provisionado || 0) * f,
        nf: nfDoItem(it.id),
      };
    });
    const sum = k => itens.reduce((s, it) => s + it[k], 0);
    const orc = sum("orc"), prov = sum("prov");
    return { secao: sec.secao, outros: false, orcAnual: sum("orcAnual"), provAnual: sum("provAnual"), orc, prov, gasto: sum("nf"), saldo: orc - prov, itens };
  });

  // NFs sem serviço (ou de serviço já excluído) e sem categoria variável: mesma
  // regra do "Outros Mensais" do dashboard. Só realizado; sem orçado/provisionado.
  const outrosGasto = notasMensais
    .filter(n => (!n.servicoId || !idsValidos.has(n.servicoId)) && !VAR_CATS_FIX.has(n.categoria) && n.mes <= mesAtual)
    .reduce((s, n) => s + (n.valor || 0), 0);
  if (outrosGasto > 0) sections.push({ secao: "Outros Mensais", outros: true, orcAnual: 0, provAnual: 0, orc: 0, prov: 0, gasto: outrosGasto, saldo: 0, itens: [] });

  const tot = k => sections.reduce((s, x) => s + x[k], 0);
  const orcAnualTotal = tot("orcAnual"), provAnualTotal = tot("provAnual");
  const orcTotal = tot("orc"), provTotal = tot("prov"), gastoTotal = tot("gasto");
  const saldoTotal = orcTotal - provTotal;

  return {
    mesAtual, mesLabel: MESES_FIX[mesAtual], rodadaAtual, rodadasDisp, mesesDecorridos, mesesCampeonato,
    sections, rows: sections,
    orcAnualTotal, provAnualTotal, orcTotal, provTotal, gastoTotal, saldoTotal,
  };
}

// ─── VISÃO GERAL ─────────────────────────────────────────────────────────────
// Consolida calcVariaveis + calcFixos com a mesma leitura dos fixos: saldo =
// orçado − provisionado; realizado (NFs) é informativo. Nas variáveis a coluna
// "realizado" da tabela já é o provisionado (mesma fonte da aba Savings) e
// nfRecV é o realizado das NFs — os dois pilares consolidam com o mesmo critério.
export function calcVisaoGeral({ dadosVar, dadosFix, orcGlobalVar = 0 }) {
  const varOrc = dadosVar?.totOrc ?? 0;
  const varProv = dadosVar?.totReal ?? 0;
  const varReal = dadosVar?.nfRecV ?? 0;
  const varSaldo = dadosVar?.saving ?? 0;
  const rodadaAtual = dadosVar?.rodadaAtual ?? "—";
  const fixOrcAcum = dadosFix?.orcTotal ?? 0;
  const fixProv = dadosFix?.provTotal ?? 0;
  const fixReal = dadosFix?.gastoTotal ?? 0;
  const fixSaldo = dadosFix?.saldoTotal ?? 0;
  const fixOrcAnual = dadosFix?.orcAnualTotal ?? 0;
  const mesLabel = dadosFix?.mesLabel ?? "—";

  const orcTotalCampeonato = orcGlobalVar + fixOrcAnual;
  const orcTotalPeriodo = varOrc + fixOrcAcum;
  const provTotalGlobal = varProv + fixProv;
  const realTotalGlobal = varReal + fixReal;
  const saldoGlobal = varSaldo + fixSaldo;
  const saldoGlobalPct = orcTotalPeriodo > 0 ? saldoGlobal / orcTotalPeriodo * 100 : 0;
  const savVarPct = varOrc > 0 ? varSaldo / varOrc * 100 : 0;
  const savFixPct = fixOrcAcum > 0 ? fixSaldo / fixOrcAcum * 100 : 0;

  return {
    varOrc, varProv, varReal, varSaldo, rodadaAtual,
    fixOrcAcum, fixProv, fixReal, fixSaldo, mesLabel,
    orcTotalCampeonato, orcTotalPeriodo, provTotalGlobal, realTotalGlobal,
    saldoGlobal, saldoGlobalPct, savVarPct, savFixPct,
  };
}

// ─── MIGRAÇÃO ONE-TIME DO LOCALSTORAGE ───────────────────────────────────────
// Usado como seed do seedIfMissing: só roda quando a chave ainda não existe no
// banco, importando os overrides que o operador tinha no navegador.
export function lerApresentacoesDoLocalStorage(prefix) {
  const read = (k, d) => {
    try { const raw = localStorage.getItem(prefix + k); return raw !== null ? JSON.parse(raw) : d; } catch { return d; }
  };
  return {
    varRodada:    read("_apres_var_rodada", null),
    varOverrides: read("_apres_var_overrides", {}) || {},
    nfEsp:        read("_apres_var_nfEsp", ""),
    nfRec:        read("_apres_var_nfRec", ""),
    fixMes:       read("_apres_fix_mes", null),
    fixRodada:    read("_apres_fix_rodada", null),
  };
}
