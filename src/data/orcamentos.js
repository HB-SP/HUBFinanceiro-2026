// ─── MÓDULO ORÇAMENTOS — MOTOR DE DADOS ───────────────────────────────────────
// Budget builder pré-campeonato: um orçamento é um documento vivo (rascunho →
// em revisão → aprovado) onde o orçado de cada jogo é DERIVADO ao vivo de:
//   premissa(padrão do jogo)  ⊕  logística(faixa de distância da praça)  ⊕  overrides da linha
// Só na aprovação o valor é achatado ("carimbado") em jogo.orcado e o
// campeonato custom é criado pelo fluxo existente (criarCampeonato do App).
//
// Chaves no app_state:
//   orc_registry          → lista leve p/ a tela de listagem (espelha campeonatos_custom)
//   orc_${id}             → documento completo do orçamento
//   orc_${id}_eventos     → log append-only (appendState, com clientRef)

import { CATS } from "../constants";
import { allSubKeysPaulistao, PAULISTAO_SERVICOS_INIT } from "./paulistao";
import { SERVICOS_INIT } from "../data";
import { slugify } from "./customCampeonato";
import { podeVerCampeonato } from "../config/entities";

// Visibilidade do orçamento para o visualizador: mesma regra dos campeonatos
// custom — dono = meta.organizador (FFU/FPF); sem organizador ou "outro" só
// aparece para admin e para visualizador "outro"/sem entidade.
export const podeVerOrcamento = (role, entidadeStr, organizador) =>
  podeVerCampeonato(role, entidadeStr, "orcamento", organizador || null);

export const ORC_REGISTRY_KEY = "orc_registry";
export const orcKey        = (id) => `orc_${id}`;
export const orcEventosKey = (id) => `orc_${id}_eventos`;

export const ORC_STATUS = {
  rascunho:   { label: "Rascunho",   color: "#f59e0b" },
  em_revisao: { label: "Em revisão", color: "#3b82f6" },
  aprovado:   { label: "Aprovado",   color: "#22c55e" },
};

// Eixos de subKeys: logística vem da faixa da praça; o resto vem da premissa do padrão.
export const SUBS_LOGISTICA = CATS[0].subs;                        // outros_log, transporte, uber, hospedagem, diaria
export const SUBS_PREMISSA  = [...CATS[1].subs, ...CATS[2].subs];  // pessoal + operações (inclui Livemode)

// NF Livemode: linha dentro do jogo nos outros campeonatos (TabLivemode) —
// no construtor vira um grupo próprio de premissa, separado de Operações.
export const SUBS_LIVEMODE_KEYS = ["maquinas", "starlink", "downlink", "distribuicao", "liveu"];

// Serviços de operação cotados por PADRÃO × FAIXA (mesma lógica da cotação
// enviada às produtoras: padrões + praças/distâncias → preço por combinação).
// Na UI as células ficam como sub-linhas por faixa DENTRO da própria linha do
// serviço na tabela de Operações. Persistência:
//   orc.premissasFaixa[padrao][faixaKey][subKey] = valor absoluto
// Célula vazia herda o valor base da premissa do padrão para aquele subKey.
// Além de UM/Geradores/SNG, a matriz aceita logística (ex.: hospedagem só no
// B2 em SP200) — assim a aba Premissas explica 100% dos jogos sem override.
// Célula de logística na matriz vence a faixa E a logística própria da praça.
// PESSOAL fica fora: prestador tem cachê fixo, não varia por distância (só
// muda se fizer mais de uma diária — e isso é ajuste no jogo, não premissa).
export const SUBS_PADRAO_FAIXA_KEYS = ["um_b1", "um_b2", "um_b3", "geradores", "sng", ...SUBS_LOGISTICA.map(s => s.key)];
// Pseudo-chave da matriz: quantidade de DSLRs por padrão × faixa (ex.: B3 só
// leva DSLR em SP). Vazio herda orc.dslrQtd[padrao]; o jogo ainda pode sobrepor.
export const MATRIZ_DSLR_QTD_KEY = "dslrQtd";
export const dslrQtdEfetiva = (orc, padrao, faixaKey, qtdJogo) => {
  if (qtdJogo != null && qtdJogo !== "") return Number(qtdJogo) || 0;
  const fx = orc?.premissasFaixa?.[padrao]?.[faixaKey]?.[MATRIZ_DSLR_QTD_KEY];
  if (fx != null && fx !== "") return Number(fx) || 0;
  return orc?.dslrQtd?.[padrao] ?? 0;
};
// Grupo extra da aba Premissas: logística ajustada por padrão × faixa (só a
// matriz é editável — a base vem da faixa/praça na aba Praças & Logística).
export const GRUPO_LOGISTICA_PADRAO = { key:"logistica_padrao", label:"Logística · ajuste por padrão", color:CATS[0].color, subs:CATS[0].subs };

// Regras especiais do construtor (não editáveis linha a linha):
//   • dslr + dslrs_transmissor são o MESMO serviço — unificados na linha `dslr`,
//     com preço por quantidade contratada (1, 2 ou 3 DSLRs): orc.dslrTabela.
//     A quantidade vem do padrão (orc.dslrQtd[padrao]) e o jogo pode sobrepor.
//   • infra ("Infra + Distr.") é a SOMA das linhas Livemode — derivada, nunca
//     digitada, para não duplicar o valor no orçamento.
export const SUBS_NAO_EDITAVEIS = ["dslr", "dslrs_transmissor", "infra"];
export const DSLR_QTDS = [1, 2, 3];

export const valorDSLR = (orc, padrao, qtdOverride) => {
  const qtd = qtdOverride ?? orc?.dslrQtd?.[padrao] ?? 0;
  if (!qtd) return 0;
  return Number(orc?.dslrTabela?.[qtd]) || 0;
};

// Linha de UM de cada padrão: o NOME do padrão manda (B1→um_b1, B2→um_b2,
// B3/B3+→um_b3) — as outras linhas de UM ficam travadas para esse padrão.
// Nome sem B1/B2/B3: usa a premissa preenchida como pista; senão um_b3.
export const umKeyDoPadrao = (orc, padrao) => {
  const s = String(padrao || "").toLowerCase();
  if (s.includes("b1")) return "um_b1";
  if (s.includes("b2")) return "um_b2";
  if (s.includes("b3")) return "um_b3";
  const prem = orc?.premissas?.[padrao] || {};
  const comValor = ["um_b1", "um_b2", "um_b3"].filter(k => Number(prem[k]) > 0);
  if (comValor.length === 1) return comValor[0];
  return "um_b3";
};

// Montagem de véspera: jogo que começa antes das 13h monta no dia anterior.
// O custo extra (50% do gerador + 30% da UM, já com ajustes de faixa) vai
// para a linha própria montagem_vespera — UM/Gerador ficam intactos.
export const MONTAGEM_PCT_GERADOR = 0.5;
export const MONTAGEM_PCT_UM      = 0.3;

// Grupos usados nas telas de premissa/override e no resumo por categoria.
export const GRUPOS_PREMISSA = [
  { key:"pessoal",   label:"Pessoal",   color:CATS[1].color, subs:CATS[1].subs },
  { key:"operacoes", label:"Operações", color:CATS[2].color, subs:CATS[2].subs.filter(s => !SUBS_LIVEMODE_KEYS.includes(s.key)) },
  { key:"livemode",  label:"Livemode (NF por jogo)", color:"#7C3AED", subs:CATS[2].subs.filter(s => SUBS_LIVEMODE_KEYS.includes(s.key)) },
];

export const PADROES_SUGERIDOS = ["B1", "B2", "B3", "B3+"];

// Catálogo-base de serviços fixos: união dos nomes já usados nos orçamentos do
// Brasileirão e do Paulistão F, agrupados por seção. Só os NOMES servem de
// base — os valores são sempre deste orçamento (nunca dos outros campeonatos).
export const CATALOGO_SERVICOS_FIXOS = (() => {
  const porSecao = new Map();
  [...SERVICOS_INIT, ...PAULISTAO_SERVICOS_INIT].forEach(sec => {
    if (!porSecao.has(sec.secao)) porSecao.set(sec.secao, new Set());
    (sec.itens || []).forEach(it => porSecao.get(sec.secao).add(it.nome));
  });
  return Array.from(porSecao, ([secao, nomes]) => ({ secao, nomes: [...nomes] }));
})();

// Faixas de distância padrão — valores iniciais zerados exceto Uber (piso comum);
// o operador ajusta na aba Praças & Logística.
export const FAIXAS_PRESET = [
  { key:"sp",    label:"SP / Grande SP", logistica:{ transporte:0, uber:250, hospedagem:0, diaria:0, outros_log:0 } },
  { key:"sp200", label:"SP200",          logistica:{ transporte:0, uber:250, hospedagem:0, diaria:0, outros_log:0 } },
  { key:"sp400", label:"SP400",          logistica:{ transporte:0, uber:250, hospedagem:0, diaria:0, outros_log:0 } },
];

export const novoOrcamento = ({ nome, edicao, formato, numRodadas, fases, cor, icon, descricao }) => {
  const now = new Date().toISOString();
  return {
    id: slugify(`${nome}-${edicao}`),
    schemaVersion: 1,
    meta: {
      nome: String(nome || "").trim(),
      edicao: String(edicao || "").trim(),
      icon: icon || "🏆",
      cor: cor || "#ec4899",
      descricao: String(descricao || "").trim(),
      formato: formato || "mata_mata",
      numRodadas: formato === "pontos_corridos" ? (parseInt(numRodadas) || 0) : null,
      fases: fases || [],
      jogosPrevistos: {},     // { [faseKey]: número de jogos previstos } — meta do plano

      status: "rascunho",
      aprovadoEm: null,
      aprovadoPor: null,
      campeonatoCriadoId: null,
      createdAt: now,
      updatedAt: now,
    },
    times: [],              // times participantes da edição (alimenta os selects de Jogos)
    padroes: [],
    premissas: {},          // { [padrao]: { [subKey]: number } }
    premissasFaixa: {},     // { [padrao]: { [faixaKey]: { [subKey]: valor } } } — célula vazia herda a premissa
    dslrTabela: { 1: 0, 2: 0, 3: 0 },  // preço por quantidade de DSLRs contratadas
    dslrQtd: {},            // { [padrao]: 0|1|2|3 } — quantidade padrão de DSLRs
    faixas: FAIXAS_PRESET.map(f => ({ ...f, logistica: { ...f.logistica } })),
    pracas: [],             // [{ id, cidade, faixaKey, logistica?:{5 subs} — própria vence a faixa }]
    jogos: [],              // [{ id, fase, rodada, mandante, visitante, pracaId, padrao, data, obs, overrides:{} }]
    servicosFixos: [],      // [{ secao, itens:[{ id, nome, orcado, obs }] }]
  };
};

// ─── DERIVAÇÃO DO ORÇADO ──────────────────────────────────────────────────────

// Logística efetiva de uma praça: modo "própria" (praca.logistica preenchida,
// mesmos 5 subKeys) vence o modo "por faixa" (herda de faixas[faixaKey]).
export const logisticaDaPraca = (orc, praca) => {
  if (!praca) return { logistica: null, origem: null };
  if (praca.logistica) return { logistica: praca.logistica, origem: "propria" };
  const faixa = (orc?.faixas || []).find(f => f.key === praca.faixaKey);
  return { logistica: faixa?.logistica || null, origem: faixa ? "faixa" : null };
};

// Orçado derivado de um jogo: base zerada → premissa do padrão → logística da
// praça (própria ou herdada da faixa) → matriz padrão × faixa (UM/Ger/SNG) →
// montagem de véspera (jogo antes das 13h) → overrides da linha (vencem tudo).
export const calcOrcadoJogo = (orc, jogo) => {
  const out = { ...allSubKeysPaulistao() };
  const prem = orc?.premissas?.[jogo?.padrao] || {};
  for (const [k, v] of Object.entries(prem)) if (k in out) out[k] = Number(v) || 0;
  const praca = (orc?.pracas || []).find(p => p.id === jogo?.pracaId);
  const faixa = (orc?.faixas || []).find(f => f.key === praca?.faixaKey);
  const logistica = praca?.logistica || faixa?.logistica;
  if (logistica) for (const [k, v] of Object.entries(logistica)) if (k in out) out[k] = Number(v) || 0;
  // Matriz padrão × faixa (UM/Geradores/SNG): célula preenchida SUBSTITUI a
  // premissa base do padrão para a faixa da praça do jogo (vale mesmo com
  // logística própria — a faixa continua classificando a distância)
  const pf = orc?.premissasFaixa?.[jogo?.padrao]?.[praca?.faixaKey] || {};
  for (const k of SUBS_PADRAO_FAIXA_KEYS) {
    if (pf[k] != null && pf[k] !== "") out[k] = Number(pf[k]) || 0;
  }
  if (pf.um != null && pf.um !== "") out[umKeyDoPadrao(orc, jogo?.padrao)] = Number(pf.um) || 0; // legado
  // Trava de categoria: só a linha de UM do padrão conta — valores digitados
  // por engano nas outras linhas de UM nunca entram no jogo
  const umKey = umKeyDoPadrao(orc, jogo?.padrao);
  ["um_b1", "um_b2", "um_b3"].forEach(k => { if (k !== umKey) out[k] = 0; });
  // DSLR unificado (Microlink/Transmissor): preço pela quantidade contratada —
  // a do padrão, ou a sobreposta no jogo
  out.dslr = valorDSLR(orc, jogo?.padrao, dslrQtdEfetiva(orc, jogo?.padrao, praca?.faixaKey, jogo?.dslrQtd));
  out.dslrs_transmissor = 0;
  // Infra + Distr. é derivada: a soma já está nas linhas Livemode — zera para não duplicar
  out.infra = 0;
  // Montagem de véspera: 50% do gerador + 30% da UM (já ajustados) na linha própria
  if (jogo?.antes13h) {
    const um = (out.um_b1 || 0) + (out.um_b2 || 0) + (out.um_b3 || 0);
    out.montagem_vespera += Math.round(MONTAGEM_PCT_GERADOR * (out.geradores || 0) + MONTAGEM_PCT_UM * um);
  }
  for (const [k, v] of Object.entries(jogo?.overrides || {})) {
    if (v === null || v === undefined || v === "") continue;
    if (k in out) out[k] = Number(v) || 0;
  }
  return out;
};

export const totalJogo = (orc, jogo) =>
  Object.values(calcOrcadoJogo(orc, jogo)).reduce((s, v) => s + v, 0);

// Quebra do orçado derivado de um jogo (p/ colunas da tabela): logística,
// pessoal, operações (sem Livemode) e Livemode separado — como nos outros
// campeonatos, onde a NF Livemode é uma linha própria dentro do jogo.
export const blocosJogo = (orc, jogo) => {
  const orcado = calcOrcadoJogo(orc, jogo);
  const soma = subs => subs.reduce((s, sub) => s + (orcado[sub.key] || 0), 0);
  const logistica = soma(CATS[0].subs);
  const pessoal   = soma(GRUPOS_PREMISSA[0].subs);
  const operacoes = soma(GRUPOS_PREMISSA[1].subs);
  const livemode  = soma(GRUPOS_PREMISSA[2].subs);
  return { logistica, pessoal, operacoes, livemode, total: logistica + pessoal + operacoes + livemode };
};

export const totalFixos = (orc) =>
  (orc?.servicosFixos || []).reduce((s, sec) =>
    s + (sec.itens || []).reduce((si, it) => si + (Number(it.orcado) || 0), 0), 0);

// Totais consolidados para o Resumo e para o espelho do registry.
export const calcTotais = (orc) => {
  const jogos = orc?.jogos || [];
  const grupos = [
    { key:"logistica", label:CATS[0].label, color:CATS[0].color, subs:CATS[0].subs },
    ...GRUPOS_PREMISSA,
  ];
  const porCategoria = grupos.map(g => ({ key: g.key, label: g.label, color: g.color, total: 0 }));
  const porFase = {}, porPadrao = {}, porFaixa = {};
  let totalJogos = 0;
  jogos.forEach(j => {
    const orcado = calcOrcadoJogo(orc, j);
    let tj = 0;
    grupos.forEach((g, i) => {
      const t = g.subs.reduce((s, sub) => s + (orcado[sub.key] || 0), 0);
      porCategoria[i].total += t;
      tj += t;
    });
    totalJogos += tj;
    porFase[j.fase || "—"] = (porFase[j.fase || "—"] || 0) + tj;
    porPadrao[j.padrao || "—"] = (porPadrao[j.padrao || "—"] || 0) + tj;
    const praca = (orc.pracas || []).find(p => p.id === j.pracaId);
    const faixaLabel = praca?.logistica
      ? `${praca.cidade} (própria)`
      : ((orc.faixas || []).find(f => f.key === praca?.faixaKey)?.label || "—");
    porFaixa[faixaLabel] = (porFaixa[faixaLabel] || 0) + tj;
  });
  const fixos = totalFixos(orc);
  return { porCategoria, porFase, porPadrao, porFaixa, totalJogos, totalFixos: fixos, totalGeral: totalJogos + fixos };
};

// ─── BASELINE (ORÇAMENTO DE REFERÊNCIA) ──────────────────────────────────────
// Comparativo edição × edição: o orçamento guarda uma base congelada (ex: o
// aprovado de 2026) e o Comparativo mostra o delta linha a linha, com selo
// automático — add-on (não existia na base), aumento, redução ou removido.
//   orc.baseline = { label, importadoEm, itens:[{id, grupo, label, subKey|null, valor}],
//                    fixos:[{id, secao, nome, valor}] }
// Item com subKey casa com a linha do serviço; sem subKey é linha só-da-base
// (aparece como "removido" enquanto a edição atual não tiver o equivalente).

export const GRUPOS_COMPARATIVO = [
  { key:"logistica", label:CATS[0].label, color:CATS[0].color, subs:CATS[0].subs },
  ...GRUPOS_PREMISSA,
];

export const novaBaseline = (label) => ({
  label: String(label || "").trim() || "Edição anterior",
  importadoEm: new Date().toISOString(),
  itens: [],
  fixos: [],
});

// Total orçado por subKey somando todos os jogos (mesmo motor da aprovação).
export const calcPorSubKey = (orc) => {
  const porSub = {};
  (orc?.jogos || []).forEach(j => {
    const orcado = calcOrcadoJogo(orc, j);
    for (const [k, v] of Object.entries(orcado)) porSub[k] = (porSub[k] || 0) + (v || 0);
  });
  return porSub;
};

export const statusComparativo = (base, atual) =>
  atual > 0 && base === 0 ? "addon"
  : base > 0 && atual === 0 ? "removido"
  : atual > base ? "aumento"
  : atual < base ? "reducao"
  : "igual";

const normNome = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// Junta base × orçamento atual: grupos variáveis por subKey (linha da base sem
// subKey entra como só-da-base) e fixos por seção + nome normalizado.
// Vínculo explícito (a base NUNCA é renomeada para casar):
//   • item fixo com `baseNome`   → casa com a linha da base de mesma seção com
//     esse nome (ex: "Produtor externa 1" ↔ "Produtor Campo/Detentores");
//   • item fixo com `baseSubKey` → casa com a linha de JOGO da base com esse
//     subKey (serviço que era por jogo e virou fixo, ex: Downlink → downlink).
//     A linha sai do grupo variável e aparece pareada em fixos.
export const diffBaseline = (orc) => {
  const bl = orc?.baseline || null;
  const porSub = calcPorSubKey(orc);
  const fixosAtuais = (orc?.servicosFixos || []).flatMap(s => s.itens || []);
  const itensBasePuxados = new Map(); // fixoItemId → item da base (bl.itens) reivindicado
  {
    const tomados = new Set();
    fixosAtuais.forEach(it => {
      if (!it.baseSubKey) return;
      const bi = (bl?.itens || []).find(i => i.subKey === it.baseSubKey && !tomados.has(i.id));
      if (bi) { tomados.add(bi.id); itensBasePuxados.set(it.id, bi); }
    });
  }
  const puxadosIds = new Set([...itensBasePuxados.values()].map(i => i.id));

  const grupos = GRUPOS_COMPARATIVO.map(g => {
    const blItens = (bl?.itens || []).filter(i => i.grupo === g.key && !puxadosIds.has(i.id));
    const usados = new Set();
    const rows = [];
    g.subs.forEach(sub => {
      const atual = porSub[sub.key] || 0;
      // Várias linhas da base podem apontar para a MESMA linha de 2027 (ex.:
      // Feed B = UM Feed B + SNG Feed B + Seg. Feed B): somam numa linha só.
      const bis = blItens.filter(i => i.subKey === sub.key && !usados.has(i.id));
      bis.forEach(i => usados.add(i.id));
      const bi = bis[0] || null;
      const base = bis.reduce((s, i) => s + (Number(i.valor) || 0), 0);
      if (atual === 0 && base === 0 && !bi) return;
      rows.push({
        key: sub.key, label: sub.label, base, atual,
        labelBase: bis.length ? bis.map(i => i.label).join(" + ") : null,
        baseItemId: bis.length === 1 ? bi.id : null,   // com soma, a base não edita inline
        baseItens: bis.map(i => ({ id: i.id, label: i.label, valor: Number(i.valor) || 0 })),
      });
    });
    blItens.filter(i => !usados.has(i.id)).forEach(i => {
      rows.push({ key: `bl_${i.id}`, label: i.label, labelBase: i.label, base: Number(i.valor) || 0, atual: 0, baseItemId: i.id, soBase: true });
    });
    rows.forEach(r => { r.status = statusComparativo(r.base, r.atual); r.delta = r.atual - r.base; });
    rows.sort((a, b) => Math.max(b.base, b.atual) - Math.max(a.base, a.atual));
    const totalBase  = rows.reduce((s, r) => s + r.base, 0);
    const totalAtual = rows.reduce((s, r) => s + r.atual, 0);
    return { ...g, rows, totalBase, totalAtual, delta: totalAtual - totalBase };
  });

  // Fixos: seções = união (base ∪ atual); linhas casam por nome normalizado.
  const secoesAtual = orc?.servicosFixos || [];
  const secoesBase  = bl?.fixos || [];
  const nomesSecoes = [...new Set([...secoesAtual.map(s => s.secao), ...secoesBase.map(f => f.secao)])];
  const fixos = nomesSecoes.map(secao => {
    const itensAtual = (secoesAtual.find(s => s.secao === secao)?.itens || []);
    const itensBase  = secoesBase.filter(f => f.secao === secao);
    const usados = new Set();
    const rows = [];
    itensAtual.forEach(it => {
      const atual = Number(it.orcado) || 0;
      const puxado = itensBasePuxados.get(it.id) || null;
      const alvo = normNome(it.baseNome || it.nome);
      const bi = puxado ? null : itensBase.find(f => normNome(f.nome) === alvo && !usados.has(f.id));
      if (bi) usados.add(bi.id);
      const refBase = puxado || bi;
      const base = refBase ? (Number(refBase.valor) || 0) : 0;
      if (atual === 0 && !refBase) return;
      rows.push({
        key: `fx_${it.id}`, label: it.nome, base, atual,
        labelBase: refBase ? (puxado ? puxado.label : refBase.nome) : null,
        baseItemId: refBase?.id || null,
        campoBase: puxado ? "itens" : "fixos",
      });
    });
    itensBase.filter(f => !usados.has(f.id)).forEach(f => {
      rows.push({ key: `blfx_${f.id}`, label: f.nome, base: Number(f.valor) || 0, atual: 0, baseItemId: f.id, soBase: true });
    });
    rows.forEach(r => { r.status = statusComparativo(r.base, r.atual); r.delta = r.atual - r.base; });
    const totalBase  = rows.reduce((s, r) => s + r.base, 0);
    const totalAtual = rows.reduce((s, r) => s + r.atual, 0);
    return { secao, rows, totalBase, totalAtual, delta: totalAtual - totalBase };
  }).filter(sec => sec.rows.length > 0);

  const totalBase  = grupos.reduce((s, g) => s + g.totalBase, 0)  + fixos.reduce((s, f) => s + f.totalBase, 0);
  const totalAtual = grupos.reduce((s, g) => s + g.totalAtual, 0) + fixos.reduce((s, f) => s + f.totalAtual, 0);
  const todasRows = [...grupos.flatMap(g => g.rows), ...fixos.flatMap(f => f.rows)];
  const numAddons = todasRows.filter(r => r.status === "addon").length;
  return { grupos, fixos, totalBase, totalAtual, delta: totalAtual - totalBase, numAddons };
};

// Espelho leve para o orc_registry (recalculado a cada save do documento).
export const resumoRegistry = (orc) => {
  const { totalGeral } = calcTotais(orc);
  return {
    id: orc.id,
    nome: orc.meta.nome,
    edicao: orc.meta.edicao,
    icon: orc.meta.icon,
    cor: orc.meta.cor,
    status: orc.meta.status,
    organizador: orc.meta.organizador || null,   // filtro de visibilidade por entidade (Home / Hub)
    totalEstimado: totalGeral,
    numJogos: (orc.jogos || []).length,
    campeonatoCriadoId: orc.meta.campeonatoCriadoId || null,
    createdAt: orc.meta.createdAt,
    updatedAt: orc.meta.updatedAt,
  };
};

// ─── APROVAÇÃO ────────────────────────────────────────────────────────────────

// Valida o orçamento antes de aprovar. `idsExistentes` = ids de CAMPEONATOS
// fixos + registry de customs. Retorna array de erros PT-BR (vazio = ok).
export const validarAprovacao = (orc, idsExistentes = []) => {
  const erros = [];
  if (!orc) return ["Orçamento não carregado."];
  if (orc.meta.status === "aprovado") erros.push("Este orçamento já foi aprovado.");
  const campId = slugify(`${orc.meta.nome}-${orc.meta.edicao}`);
  if (!campId) erros.push("Nome e edição não geram um ID válido de campeonato.");
  if (idsExistentes.includes(campId)) erros.push(`Já existe um campeonato com o ID "${campId}". Ajuste o nome ou a edição.`);
  if ((orc.jogos || []).length === 0) erros.push("O orçamento precisa de pelo menos 1 jogo.");
  if (orc.meta.formato === "mata_mata" && (orc.meta.fases || []).length === 0) erros.push("Defina pelo menos uma fase na Configuração.");
  (orc.jogos || []).forEach((j, i) => {
    const rot = `Jogo ${i + 1}${j.mandante ? ` (${j.mandante})` : ""}`;
    if (!j.padrao) erros.push(`${rot}: sem padrão definido.`);
    else if (!(orc.padroes || []).includes(j.padrao)) erros.push(`${rot}: padrão "${j.padrao}" não está na lista de padrões do orçamento.`);
    else if (!orc.premissas?.[j.padrao]) erros.push(`${rot}: o padrão "${j.padrao}" não tem premissas preenchidas.`);
    const praca = (orc.pracas || []).find(p => p.id === j.pracaId);
    if (!praca) erros.push(`${rot}: sem praça definida.`);
    else if (!praca.logistica && !(orc.faixas || []).some(f => f.key === praca.faixaKey))
      erros.push(`${rot}: a praça "${praca.cidade}" não tem logística própria nem faixa válida.`);
  });
  return erros;
};

// Achata o orçamento aprovado no payload do criarCampeonato existente
// ({ config, jogos, servicos }) — jogos no mesmo shape de jogoFromCSVRow.
export const orcamentoParaCampeonato = (orc) => {
  const m = orc.meta;
  const id = slugify(`${m.nome}-${m.edicao}`);
  const fases = m.formato === "pontos_corridos"
    ? [{ key:"rodadas", label:"Rodadas", short:"Rodadas", color:m.cor, ordem:1 }]
    : (m.fases || []).map((f, i) => ({ key:f.key, label:f.label, short:f.short || f.label, color:f.color, ordem:i + 1 }));
  const config = {
    id,
    nome: m.nome,
    edicao: m.edicao,
    status: "Em andamento",
    statusColor: "#22c55e",
    cor: m.cor,
    corGrad: `linear-gradient(135deg, ${m.cor}, ${m.cor}dd)`,
    icon: m.icon || "🏆",
    descricao: m.descricao || `${m.nome} · ${m.edicao}`,
    formato: m.formato,
    numRodadas: m.formato === "pontos_corridos" ? (m.numRodadas || 0) : null,
    fases,
    organizador: m.organizador || "outro",
    times: orc.times || [],
    createdAt: new Date().toISOString(),
    origemOrcamento: orc.id,
  };
  const jogos = (orc.jogos || []).map((j, i) => {
    const praca = (orc.pracas || []).find(p => p.id === j.pracaId);
    const faixa = (orc.faixas || []).find(f => f.key === praca?.faixaKey);
    return {
      id: 1000 + i + 1,
      codigo_orcamento: "",
      seed_version: 3,
      fase: m.formato === "pontos_corridos" ? "rodadas" : (j.fase || fases[0]?.key || "grupos"),
      grupo: "-",
      rodada: parseInt(j.rodada) || (i + 1),
      categoria: j.padrao || "",
      dist: praca?.logistica ? (faixa?.label || "Própria") : (faixa?.label || ""),
      logistica_modo: "",
      equipe: "",
      cidade: praca?.cidade || "A definir",
      estadio: "A definir",
      dia: "",
      data: j.data || "A definir",
      hora: "A definir",
      mandante: j.mandante || "A definir",
      visitante: j.visitante || "A definir",
      detentor: "A definir",
      divergencia: false,
      nota_divergencia: "",
      orcado: calcOrcadoJogo(orc, j),
      provisionado: { ...allSubKeysPaulistao() },
      realizado:    { ...allSubKeysPaulistao() },
    };
  });
  const servicos = (orc.servicosFixos || [])
    .filter(sec => (sec.itens || []).length > 0)
    .map(sec => ({
      secao: sec.secao,
      itens: sec.itens.map(it => ({
        id: it.id,
        nome: it.nome,
        orcado: Number(it.orcado) || 0,
        provisionado: 0,
        realizado: 0,
        obs: it.obs || "",
      })),
    }));
  return { config, jogos, servicos };
};
