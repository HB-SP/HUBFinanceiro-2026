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
// mesSel === null → mês corrente; rodadaSel === null → última rodada divulgada.
// overrides: { [secao]: {prov?, gasto?} } (strings). provTotOvr/gastoTotOvr:
// "" = automático.
// ORÇADO tem fonte única: o campo `orcado` dos itens da aba Serviços (mesma
// base do dashboard), rateado até o mês/rodada de referência conforme o "tipo"
// do item. Não aceita override manual — se o número está errado, corrige-se
// na aba Serviços, e dashboard e apresentação mudam juntos.
export function calcFixos({
  servicos = [], notasMensais = [], jogos = [],
  mesSel = null, rodadaSel = null, mesInicio = 0, mesFim = 11,
  overrides = {}, provTotOvr = "", gastoTotOvr = "",
  saldoUsaGasto = false,
}) {
  const mesAtual = mesSel != null ? mesSel : new Date().getMonth();
  const rodadasDisp = Array.from(new Set(jogos.map(j => j.rodada))).sort((a, b) => a - b);
  const rodadaAtual = rodadaSel != null && rodadasDisp.includes(rodadaSel) ? rodadaSel : (rodadasDisp[rodadasDisp.length - 1] || 1);
  // Rateio linear pela DURAÇÃO do campeonato, não pelo ano: Paulistão F vai de
  // maio a dezembro (8 meses), então cada mês libera 1/8 do total — ÷12 só vale
  // para campeonato de ano cheio (Brasileirão). Meses decorridos param no fim.
  const mesesCampeonato = Math.max(1, mesFim - mesInicio + 1);
  const mesesDecorridos = Math.max(0, Math.min(mesAtual, mesFim) - mesInicio + 1);

  // Orçado e provisionado acumulados por-item conforme flag "tipo":
  //   linear  → total / mesesCampeonato * mesesDecorridos
  //   pontual → total integral a partir do mês alocado
  //   misto   → parte linear /mesesCampeonato + parte pontual a partir do mês alocado
  // Encerrados: provisionado congela em realAoEncerrar (independente do tipo)
  // Rateio pontual: fração = (meses alocados decorridos) / (total de meses alocados)
  const pontualRatio = it => {
    const list = Array.isArray(it.mesesAlocacao) ? it.mesesAlocacao
      : (it.mesAlocacao != null ? [it.mesAlocacao] : []);
    if (!list.length) return mesAtual >= 0 ? 1 : 0; // sem config: aparece integral
    return list.filter(m => m <= mesAtual).length / list.length;
  };

  const sections = servicos.map(sec => {
    const itens = sec.itens || [];
    const idsItens = itens.map(it => it.id);
    const orcAnual = itens.reduce((s, it) => s + (it.orcado || 0), 0);
    const provAnual = itens.reduce((s, it) => s + (it.provisionado || 0), 0);
    const orcAuto = itens.reduce((s, it) => {
      const orc = it.orcado || 0;
      const tipo = it.tipo || "linear";
      if (tipo === "por_rodada") { const tot = it.rodadasTotal || 1; return s + orc * Math.min(rodadaAtual, tot) / tot; }
      if (tipo === "pontual") return s + orc * pontualRatio(it);
      if (tipo === "misto") {
        const pl = it.parcelaLinear || 0;
        const pp = it.parcelaPontual || 0;
        const tot = pl + pp;
        if (tot > 0) {
          const rL = pl / tot;
          return s + (orc * rL / mesesCampeonato) * mesesDecorridos + orc * (1 - rL) * pontualRatio(it);
        }
        return s + (orc / mesesCampeonato) * mesesDecorridos;
      }
      return s + (orc / mesesCampeonato) * mesesDecorridos;
    }, 0);
    const itensDebug = itens.map(it => {
      if (it.status === "encerrado") return { nome: it.nome, tipo: "encerrado", prov: it.realAoEncerrar || 0, ratio: null, contribui: it.realAoEncerrar || 0, mesesAlocacao: [] };
      const prov = it.provisionado || 0;
      const tipo = it.tipo || "linear";
      if (tipo === "por_rodada") {
        const tot = it.rodadasTotal || 1;
        const ratio = Math.min(rodadaAtual, tot) / tot;
        return { nome: it.nome, tipo, prov, ratio, contribui: prov * ratio, rodadasTotal: tot };
      }
      if (tipo === "pontual") {
        const ratio = pontualRatio(it);
        return { nome: it.nome, tipo, prov, ratio, contribui: prov * ratio, mesesAlocacao: it.mesesAlocacao || [] };
      }
      if (tipo === "misto") {
        const pl = it.parcelaLinear || 0; const pp = it.parcelaPontual || 0;
        return { nome: it.nome, tipo, prov, ratio: null, contribui: (pl / mesesCampeonato) * mesesDecorridos + pp * pontualRatio(it), mesesAlocacao: it.mesesAlocacao || [] };
      }
      return { nome: it.nome, tipo: "linear", prov, ratio: null, contribui: (prov / mesesCampeonato) * mesesDecorridos, mesesAlocacao: [] };
    });
    const provAuto = itensDebug.reduce((s, it) => s + it.contribui, 0);
    const provTotalAnual = provAnual;
    // prov anual apenas de itens ativos (encerrados saem da expectativa de NFs)
    const provAnualAtivos = itens
      .filter(it => it.status !== "encerrado")
      .reduce((s, it) => s + (it.provisionado || 0), 0);
    const idsEncerrados = itens.filter(it => it.status === "encerrado").map(it => it.id);
    const gastoAuto = notasMensais
      .filter(n => n.servicoId && idsItens.includes(n.servicoId) && n.mes <= mesAtual)
      .reduce((s, n) => s + (n.valor || 0), 0);
    const gastoEncerrados = notasMensais
      .filter(n => n.servicoId && idsEncerrados.includes(n.servicoId) && n.mes <= mesAtual)
      .reduce((s, n) => s + (n.valor || 0), 0);
    return { secao: sec.secao, orcAnual, orcAuto, provAuto, provTotalAnual, provAnualAtivos, gastoAuto, gastoEncerrados, itensDebug };
  });

  // "Outros Mensais": NFs sem servicoId e sem categoria variável mapeada
  const outrosGasto = notasMensais
    .filter(n => !n.servicoId && !VAR_CATS_FIX.has(n.categoria) && n.mes <= mesAtual)
    .reduce((s, n) => s + (n.valor || 0), 0);
  if (outrosGasto > 0) {
    sections.push({ secao: "Outros Mensais", orcAnual: 0, orcAuto: 0, provAuto: 0, provTotalAnual: 0, provAnualAtivos: 0, gastoAuto: outrosGasto, gastoEncerrados: 0, itensDebug: [] });
  }

  const orcAnualTotal        = sections.reduce((s, x) => s + x.orcAnual, 0);
  const provTotalAnualAll    = sections.reduce((s, x) => s + x.provTotalAnual, 0);
  const provTotalAnualAtivos = sections.reduce((s, x) => s + (x.provAnualAtivos ?? x.provTotalAnual), 0);
  const gastoEncerradosTotal = sections.reduce((s, x) => s + (x.gastoEncerrados || 0), 0);

  // View aplicando overrides (strings prontas para inputs)
  const sectionsView = sections.map(s => ({
    ...s,
    orc:   fmtNum(s.orcAuto), // sem override: fonte única é a aba Serviços
    prov:  overrides[s.secao]?.prov  ?? fmtNum(s.provAuto),
    gasto: overrides[s.secao]?.gasto ?? fmtNum(s.gastoAuto),
  }));

  const rows = sectionsView.map(s => {
    const orc = parseBR(s.orc);
    const prov = parseBR(s.prov);
    const gasto = parseBR(s.gasto);
    const saldo = (saldoUsaGasto || s.secao === "Outros Mensais") ? orc - gasto : orc - prov;
    return { secao: s.secao, orc, prov, gasto, saldo };
  });
  const orcTotal = rows.reduce((s, r) => s + r.orc, 0);
  const provTotal = rows.reduce((s, r) => s + r.prov, 0);
  const gastoTotal = rows.reduce((s, r) => s + r.gasto, 0);
  // Total = soma das linhas — "Outros Mensais" entra pelo gasto (não tem provisão),
  // senão a linha Total diverge da soma da coluna Saldo e do resumo da Visão Geral.
  const saldoTotal = rows.reduce((s, r) => s + r.saldo, 0);

  // Pendente de NF ignora serviços encerrados: exclui do prov anual e desconta seu gasto.
  const gastoAtivo = Math.max(0, gastoTotal - gastoEncerradosTotal);
  const orcTotEff   = orcTotal; // orçado não aceita override
  const provTotEff  = provTotOvr  !== "" ? parseBR(provTotOvr)  : provTotal;
  const gastoTotEff = gastoTotOvr !== "" ? parseBR(gastoTotOvr) : gastoTotal;

  // Realizado efetivo — base ÚNICA dos KPIs, da tabela e da Visão Geral:
  // Paulistão F usa gasto (saldoUsaGasto); demais usam prov, com "Outros Mensais"
  // entrando pelo gasto (NFs sem serviço não têm provisão). O override manual de
  // total realizado (provTotOvr) vale pras duas telas.
  const realizadoEff = saldoUsaGasto
    ? gastoTotEff
    : (provTotOvr !== "" ? parseBR(provTotOvr)
        : rows.reduce((s, r) => s + (r.secao === "Outros Mensais" ? r.gasto : r.prov), 0));
  const saldoTotEff = orcTotEff - realizadoEff;
  const nfRecV = saldoUsaGasto ? provTotEff : gastoAtivo;
  const nfPend = saldoUsaGasto
    ? Math.max(0, gastoTotEff - provTotEff)
    : Math.max(0, provTotalAnualAtivos - gastoAtivo);
  const nfBase = saldoUsaGasto ? gastoTotEff : provTotalAnualAtivos;
  const pctRec = nfBase > 0 ? nfRecV / nfBase * 100 : 0;

  return {
    mesAtual, mesLabel: MESES_FIX[mesAtual], rodadaAtual, rodadasDisp, mesesDecorridos, mesesCampeonato,
    sections, sectionsView, rows,
    orcAnualTotal, provTotalAnualAll,
    orcTotal, provTotal, gastoTotal, saldoTotal,
    orcTotEff, provTotEff, gastoTotEff, realizadoEff, saldoTotEff,
    nfRecV, nfPend, pctRec,
  };
}

// ─── VISÃO GERAL ─────────────────────────────────────────────────────────────
// Consolida os resultados de calcVariaveis + calcFixos. orcGlobalVar é o orçado
// total de variáveis do campeonato (vem de prop — nada de valor fixo aqui).
export function calcVisaoGeral({ dadosVar, dadosFix, orcGlobalVar = 0 }) {
  const varOrc = dadosVar?.totOrc ?? 0;
  const varReal = dadosVar?.totReal ?? 0;
  const varSaving = dadosVar?.saving ?? 0;
  const rodadaAtual = dadosVar?.rodadaAtual ?? "—";
  const fixOrcAcum = dadosFix?.orcTotEff ?? 0;
  const fixReal = dadosFix?.realizadoEff ?? 0; // "Realizado" na VG = mesma base dos Custos Fixos
  const fixSaldo = dadosFix?.saldoTotEff ?? 0;
  const fixOrcAnual = dadosFix?.orcAnualTotal ?? 0;
  const mesLabel = dadosFix?.mesLabel ?? "—";

  const orcTotalCampeonato = orcGlobalVar + fixOrcAnual;
  const realTotalGlobal = varReal + fixReal;
  const orcTotalPeriodo = varOrc + fixOrcAcum;
  const savingGlobal = orcTotalPeriodo - realTotalGlobal;
  const savingGlobalPct = orcTotalPeriodo > 0 ? savingGlobal / orcTotalPeriodo * 100 : 0;
  const savVarPct = varOrc > 0 ? varSaving / varOrc * 100 : 0;
  const savFixPct = fixOrcAcum > 0 ? fixSaldo / fixOrcAcum * 100 : 0;

  return {
    varOrc, varReal, varSaving, rodadaAtual,
    fixOrcAcum, fixReal, fixSaldo, mesLabel,
    orcTotalCampeonato, realTotalGlobal, orcTotalPeriodo,
    savingGlobal, savingGlobalPct, savVarPct, savFixPct,
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
    fixOverrides: read("_apres_fix_overrides", {}) || {},
    provTot:      read("_apres_fix_provTot", ""),
    gastoTot:     read("_apres_fix_gastoTot", ""),
  };
}
