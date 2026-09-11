import { useState, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { CATS, TIPO_COLOR, RADIUS, FASES_PAULISTAO, FONT, VAR_CAT_TO_CATKEY } from "../constants";
import { fmt, subTotal, catTotal } from "../utils";
import { Pill } from "./shared";
import { Card, SectionHeader, Stat, Badge, Progress, IconButton } from "./ui";
import {
  LayoutDashboard, FileText, ClipboardList,
  ArrowLeft, Eye, EyeOff, Sun, Moon, LogOut,
  Wallet, TrendingUp, Activity, PiggyBank, Truck, Target,
} from "lucide-react";
const TabJogosPaulistao  = lazy(() => import("./tabs/TabJogosPaulistao"));
const TabSavings         = lazy(() => import("./tabs/TabSavings"));
const TabGraficos        = lazy(() => import("./tabs/TabGraficos"));
const TabServicos        = lazy(() => import("./tabs/TabServicos"));
const VisaoMicro         = lazy(() => import("./tabs/VisaoMicro"));
const TabApresentacoes   = lazy(() => import("./tabs/TabApresentacoes"));
const TabNotas           = lazy(() => import("./tabs/TabNotas"));
const TabNotasMensal     = lazy(() => import("./tabs/TabNotasMensal"));
const TabEnvio           = lazy(() => import("./tabs/TabEnvio"));
const TabLivemode        = lazy(() => import("./tabs/TabLivemode"));
const TabLogistica       = lazy(() => import("./tabs/TabLogistica"));
const TabRastreabilidade = lazy(() => import("./tabs/TabRastreabilidade"));
import { NovoJogoPaulistaoModal } from "./modals/NovoJogoPaulistaoModal";
import LivemodeLogo from "./LivemodeLogo";
import { getState, setState as setSupabaseState, supabase, createPersistedSetter, isPersistPending } from "../lib/supabase";
import { lerApresentacoesDoLocalStorage } from "../lib/apresentacoesCalc";
import { buildRealizadoPorJogo, buildInfraRealizadoPorJogo, marcarLogisticaReembolsada } from "../lib/notasFiscais";
import { FORNECEDORES_INIT } from "../data/fornecedores";
import { COTACAO_INIT } from "../data/negociacoes";
import { PAULISTAO_JOGOS_INIT, PAULISTAO_SERVICOS_INIT, getFase, ordemFase } from "../data/paulistao";
import { useAgendaPortal } from "../hooks/useAgendaPortal";
import { useSincronizarEnvios } from "../hooks/useSincronizarEnvios";

// Agrupador da Rastreabilidade "Por Rodada": fase + rodada, senão a "Rodada 1"
// da fase de grupos colidiria com a "Rodada 1" do mata-mata.
const grupoDoJogoPaulistao = j => ({
  key: `f${ordemFase(j.fase)}_r${j.rodada || 0}`,
  label: `${getFase(j.fase)?.label || j.fase || "Fase"}${j.rodada ? ` — Rodada ${j.rodada}` : ""}`,
  ordem: ordemFase(j.fase) * 100 + (j.rodada || 0),
});

// Serviços Livemode — valores exclusivos do Paulistão F (sem Starlink, valores próprios
// de Máquinas de Grafismo/Downlink/Distribuição). Não afeta Brasileirão nem outros
// campeonatos, que continuam usando os valores padrão de TabLivemode.jsx.
const SERVICOS_LM_PAULISTAO = [
  { key:"grafismo",     orcadoKey:"maquinas",     label:"Máquinas de Grafismo", valorPadrao:958  },
  { key:"downlink",     orcadoKey:"downlink",     label:"Downlink",             valorPadrao:1000 },
  { key:"distribuicao", orcadoKey:"distribuicao", label:"Distribuição",         valorPadrao:1000 },
];

// ── Religação de notas mensais órfãs ─────────────────────────────────────────
// O formulário público envia servicoId de uma lista espelhada; quando um item
// do orçamento é excluído e recriado, o id muda e a NF fica órfã (some do
// serviço no dashboard e cai em "Outros Mensais"). Recupera pelo nome: match
// exato normalizado ou, se único candidato, por contenção (ex: "Suporte
// Operacional Vmix" ⊂ "Desenvolvimento/Suporte operacional VMIX"). Nome
// ambíguo permanece órfão — melhor "Outros Mensais" que creditar item errado.
const normNomeServico = s => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();

export function religarMensaisOrfas(notasMensais, servicos) {
  const itens = (servicos || []).flatMap(sec => sec.itens || []);
  const idsValidos = new Set(itens.map(i => i.id));
  let mudou = false;
  const lista = (notasMensais || []).map(n => {
    if (!n.servicoId || idsValidos.has(n.servicoId)) return n;
    const alvo = normNomeServico(n.servicoNome || n.categoria);
    if (!alvo) return n;
    let item = itens.find(i => normNomeServico(i.nome) === alvo);
    if (!item) {
      const candidatos = itens.filter(i => {
        const nome = normNomeServico(i.nome);
        return nome.includes(alvo) || alvo.includes(nome);
      });
      if (candidatos.length === 1) item = candidatos[0];
    }
    if (!item) return n;
    mudou = true;
    return { ...n, servicoId: item.id, servicoNome: (item.nome || "").trim() };
  });
  return { lista, mudou };
}

// Chaves de persistência namespaced no Supabase (mesma tabela app_state)
const K = {
  jogos:            "paulistao_jogos",
  servicos:         "paulistao_servicos",
  notas:            "paulistao_notas",
  // Base ÚNICA de fornecedores (2026-08-10): a chave global 'fornecedores' é
  // compartilhada por todos os campeonatos e com o Portal de Controle. A cópia
  // congelada 'paulistao_fornecedores' ficou órfã no banco (nunca era escrita).
  fornecedores:     "fornecedores",
  notas_mensais:    "paulistao_notas_mensais",
  envios:           "paulistao_envios",
  livemode:         "paulistao_livemode",
  notas_livemode:   "paulistao_notas_livemode",
  cotacoes:         "paulistao_cotacoes",
  fornecedores_jogo:"paulistao_fornecedores_jogo",
  logistica:        "paulistao_logistica",
  eventos_log:      "paulistao_eventos_log",
  apresentacoes:    "paulistao_apresentacoes",
  fixos_contratos:  "paulistao_fixos_contratos",
};

export default function Paulistao({ onBack, onOpenHub, T, darkMode, setDarkMode, role = 'admin', escopo = 'notas', onSignOut }) {
  // Visualizador com escopo 'completo' (time Livemode): vê todas as abas em modo leitura
  const hubCompleto = role === 'admin' || escopo === 'completo';
  const modoLeitura = role === 'visualizador' && escopo === 'completo';
  const [jogos, setJogosRaw]                       = useState(PAULISTAO_JOGOS_INIT);
  const [servicos, setServicosRaw]                 = useState(PAULISTAO_SERVICOS_INIT);
  const [notas, setNotasRaw]                       = useState([]);
  const [notasMensais, setNotasMensaisRaw]         = useState([]);
  const [envios, setEnviosRaw]                     = useState([]);
  const [fornecedores, setFornecedoresRaw]         = useState(FORNECEDORES_INIT);
  const [cotacoes, setCotacoesRaw]                 = useState(COTACAO_INIT);
  const [livemode, setLivemodeRaw]                 = useState([]);
  const [notasLivemode, setNotasLivemodeRaw]       = useState([]);
  const [logistica, setLogisticaRaw]               = useState([]);
  const [eventosLog, setEventosLogRaw]             = useState([]);
  const [fornecedoresJogo, setFornecedoresJogoRaw] = useState({});
  const [apres, setApresRaw]                       = useState({});
  const [fixos, setFixosRaw]                       = useState(null);
  const [loading, setLoading]                      = useState(true);
  const [loadError, setLoadError]                  = useState(null);
  // Cada setter relê o valor atual do Supabase antes de gravar de volta (ver
  // createPersistedSetter em lib/supabase.js) — uma aba parada ou o realtime
  // caído não fazem mais uma edição sobrescrever o que outra pessoa salvou.
  // Também usado pelo handler de realtime abaixo pra não sobrescrever uma
  // edição local em andamento com um eco desatualizado (isPersistPending).
  const persistRefs = useRef({}).current;

  useEffect(() => {
    async function load() {
      try {
      const [j, s, n, f, nm, ev, lm, nlm, co, fj, lg, elg, ap, fx] = await Promise.all([
        getState(K.jogos), getState(K.servicos), getState(K.notas), getState(K.fornecedores),
        getState(K.notas_mensais), getState(K.envios), getState(K.livemode), getState(K.notas_livemode),
        getState(K.cotacoes), getState(K.fornecedores_jogo), getState(K.logistica), getState(K.eventos_log),
        getState(K.apresentacoes), getState(K.fixos_contratos),
      ]);
      // Seed APENAS quando o valor é null/undefined (linha não existe no banco).
      // Nunca sobrescreve dados — getState com falha transitória não pode zerar
      // notas/fornecedores etc. (incidente 2026-05-01). Se getState falhar de
      // verdade, ele lança e cai no catch abaixo — nada é seedado por cima.
      const seedIfMissing = (val, key, init, setRaw) => {
        if (val != null) { setRaw(val); return; }
        setRaw(init);
        setSupabaseState(key, init);
      };
      if (j != null) {
        // Migrações idempotentes do seed:
        //   v1: todos placeholders ("A definir") → carrega tabela oficial.
        //   v2: jogos sem codigo_orcamento → substitui pelo seed com orçado por bloco.
        //   v3: jogos sem seed_version === 3 → substitui pelo seed granular (subkeys
        //       um_b3/downlink/distribuicao/liveu/maquinas/etc) conforme planilha.
        const todosPlaceholder = Array.isArray(j) && j.length > 0 && j.every(x => x && x.mandante === "A definir");
        const semCodigoOrc     = Array.isArray(j) && j.length > 0 && !j.some(x => x && x.codigo_orcamento);
        const seedDesatualizado= Array.isArray(j) && j.length > 0 && !j.every(x => x && x.seed_version === 3);
        // Trava de segurança: se QUALQUER jogo tem provisionado/realizado
        // preenchido ou está fechado, há trabalho do operador — resetar pro
        // seed apagaria tudo (aconteceu em 11/08 e 13/08: um jogo editado pelo
        // modal perdia o seed_version e o load zerava o campeonato inteiro).
        // Nesse caso só re-carimba o seed_version nos jogos em que ele falta.
        const temDadosOperador = Array.isArray(j) && j.some(x => x && (
          x.fechado ||
          Object.values(x.provisionado || {}).some(v => v > 0) ||
          Object.values(x.realizado    || {}).some(v => v > 0)
        ));
        if ((todosPlaceholder || semCodigoOrc || seedDesatualizado) && !temDadosOperador) {
          setJogosRaw(PAULISTAO_JOGOS_INIT);
          setSupabaseState(K.jogos, PAULISTAO_JOGOS_INIT);
        } else if (seedDesatualizado) {
          const carimbado = j.map(x => x && x.seed_version !== 3 ? { ...x, seed_version: 3 } : x);
          setJogosRaw(carimbado);
          setSupabaseState(K.jogos, carimbado);
        } else {
          setJogosRaw(j);
        }
      } else { setJogosRaw(PAULISTAO_JOGOS_INIT); setSupabaseState(K.jogos, PAULISTAO_JOGOS_INIT); }
      // Serviços fixos: migra seed antigo (sem "Festa de Encerramento" e sem orçado)
      // para o orçamento aprovado v4 (R$ 238k). Não mexe se o operador já customizou.
      let servicosEfetivos;
      if (s != null) {
        const temFesta  = Array.isArray(s) && s.some(sec => Array.isArray(sec.itens) && sec.itens.some(i => /festa de encerramento/i.test(i.nome||"")));
        const totalOrc  = Array.isArray(s) ? s.reduce((t,sec)=>t+(sec.itens||[]).reduce((u,i)=>u+(i.orcado||0),0),0) : 0;
        if (!temFesta && totalOrc === 0) {
          servicosEfetivos = PAULISTAO_SERVICOS_INIT;
          setServicosRaw(PAULISTAO_SERVICOS_INIT);
          setSupabaseState(K.servicos, PAULISTAO_SERVICOS_INIT);
        } else {
          // v2: itens 1,2,3 passam a tipo por_rodada com rodadasTotal
          const TIPO_MAP = { 1:{tipo:"por_rodada",rodadasTotal:13}, 2:{tipo:"por_rodada",rodadasTotal:13}, 3:{tipo:"por_rodada",rodadasTotal:13} };
          const pessoal = Array.isArray(s) ? (s.find(sec=>sec.secao==="Pessoal")?.itens||[]) : [];
          const precisaMigrar = pessoal.some(it => TIPO_MAP[it.id] && it.tipo !== "por_rodada");
          if (precisaMigrar) {
            const migrado = s.map(sec => sec.secao !== "Pessoal" ? sec : {
              ...sec, itens: sec.itens.map(it => {
                if (!TIPO_MAP[it.id]) return it;
                const {mesesAlocacao: _, ...rest} = it;
                return {...rest, ...TIPO_MAP[it.id]};
              })
            });
            servicosEfetivos = migrado;
            setServicosRaw(migrado);
            setSupabaseState(K.servicos, migrado);
          } else {
            servicosEfetivos = s;
            setServicosRaw(s);
          }
        }
      } else { servicosEfetivos = PAULISTAO_SERVICOS_INIT; setServicosRaw(PAULISTAO_SERVICOS_INIT); setSupabaseState(K.servicos, PAULISTAO_SERVICOS_INIT); }
      seedIfMissing(n,   K.notas,             [],                  setNotasRaw);
      seedIfMissing(f,   K.fornecedores,      FORNECEDORES_INIT,   setFornecedoresRaw);
      // Notas mensais: religa órfãs pelo nome antes de expor (migração idempotente —
      // depois da primeira gravação os ids ficam válidos e nada mais é escrito).
      if (nm != null) {
        const { lista: nmFinal, mudou } = religarMensaisOrfas(nm, servicosEfetivos);
        setNotasMensaisRaw(nmFinal);
        if (mudou) setSupabaseState(K.notas_mensais, nmFinal);
      } else { setNotasMensaisRaw([]); setSupabaseState(K.notas_mensais, []); }
      seedIfMissing(ev,  K.envios,            [],                  setEnviosRaw);
      seedIfMissing(lm,  K.livemode,          [],                  setLivemodeRaw);
      seedIfMissing(nlm, K.notas_livemode,    [],                  setNotasLivemodeRaw);
      seedIfMissing(co,  K.cotacoes,          COTACAO_INIT,        setCotacoesRaw);
      seedIfMissing(fj,  K.fornecedores_jogo, {},                  setFornecedoresJogoRaw);
      seedIfMissing(lg,  K.logistica,         [],                  setLogisticaRaw);
      seedIfMissing(elg, K.eventos_log,       [],                  setEventosLogRaw);
      // Migração one-time da aba Apresentações: importa overrides do localStorage
      // (prefixo "pau") quando a linha ainda não existe no banco.
      seedIfMissing(ap,  K.apresentacoes,     lerApresentacoesDoLocalStorage('pau'), setApresRaw);
      seedIfMissing(fx,  K.fixos_contratos,   { mesesSemServico: [], contratos: [] }, setFixosRaw);
      setLoading(false);
      setLoadError(null);
      } catch (err) {
        console.error('Falha ao carregar dados do Supabase (Paulistão) — nada foi sobrescrito:', err);
        setLoadError(err);
      }
    }
    load();

    const channel = supabase
      .channel("paulistao_state_changes")
      .on("postgres_changes", { event:"UPDATE", schema:"public", table:"app_state" }, payload => {
        const m = {
          [K.jogos]: setJogosRaw, [K.servicos]: setServicosRaw, [K.notas]: setNotasRaw,
          [K.fornecedores]: setFornecedoresRaw, [K.notas_mensais]: setNotasMensaisRaw,
          [K.envios]: setEnviosRaw, [K.livemode]: setLivemodeRaw, [K.notas_livemode]: setNotasLivemodeRaw,
          [K.cotacoes]: setCotacoesRaw, [K.fornecedores_jogo]: setFornecedoresJogoRaw,
          [K.logistica]: setLogisticaRaw, [K.eventos_log]: setEventosLogRaw,
          [K.apresentacoes]: setApresRaw, [K.fixos_contratos]: setFixosRaw,
        };
        const fn = m[payload.new.key];
        if (fn && !isPersistPending(persistRefs, payload.new.key)) fn(payload.new.value);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const setJogos          = createPersistedSetter(K.jogos,           setJogosRaw,          persistRefs);
  const setServicos       = createPersistedSetter(K.servicos,        setServicosRaw,       persistRefs);
  const setNotas          = createPersistedSetter(K.notas,           setNotasRaw,          persistRefs);
  const setEnvios         = createPersistedSetter(K.envios,          setEnviosRaw,         persistRefs);
  const setNotasMensais   = createPersistedSetter(K.notas_mensais,   setNotasMensaisRaw,   persistRefs);
  const setFornecedores   = createPersistedSetter(K.fornecedores,    setFornecedoresRaw,   persistRefs);
  const setLivemode       = createPersistedSetter(K.livemode,        setLivemodeRaw,       persistRefs);
  const setNotasLivemode  = createPersistedSetter(K.notas_livemode,  setNotasLivemodeRaw,  persistRefs);
  const setCotacoes       = createPersistedSetter(K.cotacoes,        setCotacoesRaw,       persistRefs);
  const setEventosLog     = createPersistedSetter(K.eventos_log,     setEventosLogRaw,     persistRefs);
  const setLogistica        = createPersistedSetter(K.logistica,         setLogisticaRaw,        persistRefs, { debounceMs: 500 });
  const setFornecedoresJogo = createPersistedSetter(K.fornecedores_jogo, setFornecedoresJogoRaw, persistRefs, { empty: {}, debounceMs: 500 });
  const setApres            = createPersistedSetter(K.apresentacoes,     setApresRaw,            persistRefs, { empty: {}, debounceMs: 600 });
  const setFixos            = createPersistedSetter(K.fixos_contratos,   setFixosRaw,            persistRefs, { empty: { mesesSemServico: [], contratos: [] } });

  // Agenda herdada do Portal de Controle (a matriz desde 2026-08): descritivo
  // dos jogos vem de lá; orçamento/realizado continuam 100% do Hub.
  // Só admin roda o sync/adoção (ver comentário no App.jsx — RLS do Portal)
  useAgendaPortal({ tabela: 'paulistao_feminino_jogos', tabelaPeriferico: 'perifericos_paulistao', rodadaCol: 'rod', extras: [['dia', 'dia'], ['estadio', 'estadio']], jogos, setJogos, pronto: !loading, enabled: role === 'admin' });
  useSincronizarEnvios({ envios, setEnvios, notas, notasMensais, notasLivemode, pronto: !loading, enabled: role === 'admin', dedupeNotasPorNF: true });

  // Rateia Seg. Espacial entre os jogos do mês. Quando o mês não tem nenhum jogo,
  // não tem jogo pra receber o rateio -- o valor ia sendo descartado do realizado
  // (a NF existe, mas cai em nenhum lugar). Agora fica em `orfao`, somado direto
  // na categoria Operações em vez de sumir.
  const { map: rateioSegEspacialPorJogo, orfao: segEspacialOrfao } = useMemo(() => {
    const parseMes = (dataStr) => {
      if (!dataStr || /^[aà] definir$/i.test(dataStr.trim())) return null;
      let m = dataStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return parseInt(m[2]) - 1;
      m = dataStr.match(/^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/);
      if (m) return parseInt(m[2]) - 1;
      return null;
    };
    const jogosPorMes = {};
    jogos.filter(j => j.mandante !== "A definir").forEach(j => {
      const mes = parseMes(j.data);
      if (mes == null) return;
      (jogosPorMes[mes] = jogosPorMes[mes] || []).push(j.id);
    });
    const map = {};
    let orfao = 0;
    (notasMensais||[]).filter(n => n.categoria === "Seg. Espacial").forEach(n => {
      const ids = jogosPorMes[n.mes] || [];
      if (ids.length === 0) { orfao += (n.valor || 0); return; }
      const share = (n.valor || 0) / ids.length;
      ids.forEach(id => { map[id] = (map[id] || 0) + share; });
    });
    return { map, orfao };
  }, [notasMensais, jogos]);

  // Realizado das Notas Fiscais, calculado ao vivo (não depende de a aba Notas Fiscais
  // já ter sido aberta nesta sessão para o dashboard estar em dia).
  const realizadoNotasPorJogo = useMemo(
    () => buildRealizadoPorJogo(jogos, notas, { dedupeNotasPorNF: true }),
    [jogos, notas]
  );

  // Realizado de "Infra + Distr." por jogo, calculado ao vivo a partir das NFs
  // Livemode (antes só era atualizado ao clicar em "Sincronizar Jogos").
  const infraRealizadoPorJogo = useMemo(
    () => buildInfraRealizadoPorJogo(notasLivemode),
    [notasLivemode]
  );

  // Logística (transporte/uber/hospedagem/outros_log) vem só da NF de reembolso que a
  // Livemode emite (via buildRealizadoPorJogo) -- os lançamentos da aba Logística são só
  // um rascunho interno pra consolidar e pedir esse reembolso, não contam como realizado.
  const jogosCalc = useMemo(() => jogos.map(j => {
    const base = realizadoNotasPorJogo[j.id] || {};
    const se = rateioSegEspacialPorJogo[j.id];
    return {
      ...j,
      realizado: {
        ...base,
        ...(se ? { seg_espacial: se } : {}),
        infra: infraRealizadoPorJogo[j.id] || 0,
      },
    };
  }), [jogos, realizadoNotasPorJogo, rateioSegEspacialPorJogo, infraRealizadoPorJogo]);

  const servicosCalc = useMemo(() => servicos.map(sec => ({
    ...sec,
    itens: sec.itens.map(it => ({
      ...it,
      realizado: notasMensais.filter(n => n.servicoId === it.id).reduce((s, n) => s + (n.valor || 0), 0),
    })),
  })), [servicos, notasMensais]);

  const varCalc = useMemo(() => {
    const allJ = jogosCalc.filter(j => j.mandante !== "A definir");
    const result = CATS.map(cat => {
      const realizadoMensal = notasMensais
        .filter(n => !n.servicoId && VAR_CAT_TO_CATKEY[n.categoria] === cat.key && n.categoria !== "Seg. Espacial")
        .reduce((s, n) => s + (n.valor || 0), 0);
      // Seg. Espacial órfã (mês sem jogo) pertence à Operações, junto com o resto do rateio.
      const orfaoDessaCategoria = cat.key === "operacoes" ? segEspacialOrfao : 0;
      return {
        nome: cat.label,
        orcado:       allJ.reduce((s,j) => s+catTotal(j.orcado, cat), 0),
        provisionado: allJ.reduce((s,j) => s+catTotal(j.provisionado, cat), 0),
        realizado:    allJ.reduce((s,j) => s+catTotal(j.realizado, cat), 0) + realizadoMensal + orfaoDessaCategoria,
        tipo: "variavel",
        subKeys: cat.subs.map(sub => sub.key),
        catKey: cat.key,
      };
    });
    // "Extra" já está incluso dentro de Operações (é um dos subs de CATS "operacoes") --
    // uma linha própria aqui somaria o mesmo valor duas vezes no total do dashboard.
    return result;
  }, [jogosCalc, notasMensais, segEspacialOrfao]);

  const fixosCalc = useMemo(() => servicosCalc.map(s => ({
    nome: s.secao,
    orcado:       s.itens.reduce((t,i) => t+i.orcado, 0),
    provisionado: s.itens.reduce((t,i) => t+i.provisionado, 0),
    realizado:    s.itens.reduce((t,i) => t+i.realizado, 0),
    tipo: "fixo",
    servicoIds: s.itens.map(i => i.id),
  })), [servicosCalc]);

  // Inclui também NFs cujo servicoId aponta pra um item de serviço fixo já excluído
  // (órfãs) -- sem isso, o valor delas some do dashboard mas continua na aba Mensal.
  const outrosMensaisCalc = useMemo(() => {
    const servicoIdsValidos = new Set(servicosCalc.flatMap(sec => sec.itens.map(i => i.id)));
    const total = notasMensais
      .filter(n => (!n.servicoId || !servicoIdsValidos.has(n.servicoId)) && !VAR_CAT_TO_CATKEY[n.categoria])
      .reduce((s, n) => s + (n.valor || 0), 0);
    return total > 0
      ? [{ nome:"Outros Mensais", orcado:0, provisionado:0, realizado: total, tipo:"fixo", outrosMensais:true }]
      : [];
  }, [notasMensais, servicosCalc]);

  const RESUMO_CATS = [...varCalc, ...fixosCalc, ...outrosMensaisCalc];

  const [setor, setSetor]               = useState(() => !hubCompleto ? "notas" : "orcamento");
  const [tab, setTab]                   = useState(() => !hubCompleto ? "notas fiscais" : "dashboard");
  const [showNovo, setNovo]             = useState(false);
  const [jogoEdit, setJogoEdit]         = useState(null);
  const [filtroFase, setFiltroFase]     = useState("Todas");
  const [filtroGrupo, setFiltroGrupo]   = useState("Todos");
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [microJogoId, setMicroJogoId]   = useState(jogos.find(j=>j.mandante!=="A definir")?.id);
  const [ocultar, setOcultar]           = useState(false);
  const [filtroRastreabilidade, setFiltroRastreabilidade] = useState(null);

  const abrirRastreabilidade = (cat) => {
    setFiltroRastreabilidade({
      nome: cat.nome,
      subKeys: cat.subKeys || null,
      catKey: cat.catKey || null,
      servicoIds: cat.servicoIds || null,
      outrosMensais: !!cat.outrosMensais,
    });
    setSetor("notas");
    setTab("rastreabilidade");
  };

  const saveJogo       = j => setJogos(js => js.map(x => x.id===j.id ? j : x));
  const addJogo        = j => {
    setJogos(js => {
      // Tenta substituir um placeholder na mesma fase/grupo/rodada; senão, qualquer placeholder; senão, anexa.
      let replaced = false;
      let next = js.map(x => {
        if (!replaced && x.mandante==="A definir" && x.fase===j.fase && x.grupo===j.grupo && x.rodada===j.rodada) {
          replaced = true;
          return { ...j, id: x.id };
        }
        return x;
      });
      if (!replaced) {
        next = js.map(x => {
          if (!replaced && x.mandante==="A definir" && x.fase===j.fase) {
            replaced = true;
            return { ...j, id: x.id };
          }
          return x;
        });
      }
      if (!replaced) next = [...js, j];
      return next;
    });
    setNovo(false); setJogoEdit(null);
  };
  const deleteJogo     = id => { if(window.confirm("Excluir este jogo?")) setJogos(js => js.filter(j => j.id !== id)); };
  const editJogo       = j => setJogoEdit(j);
  const handleEditSave = j => { saveJogo(j); setJogoEdit(null); };

  const totalOrc  = RESUMO_CATS.reduce((s,c) => s+c.orcado, 0);
  const totalProv = RESUMO_CATS.reduce((s,c) => s+c.provisionado, 0);
  const totalReal = RESUMO_CATS.reduce((s,c) => s+c.realizado, 0);
  const pctGasto  = totalOrc ? ((totalReal/totalOrc)*100).toFixed(1) : 0;

  const divulgados = jogosCalc.filter(j => j.mandante !== "A definir")
    .sort((a,b) => ordemFase(a.fase) - ordemFase(b.fase) || a.rodada - b.rodada || a.id - b.id);
  const aDivulgar  = jogos.filter(j => j.mandante === "A definir");

  // Projetado: por jogo, usa provisionado quando > 0; senão usa o orçado.
  // O mesmo vale para cada item de serviço fixo. É a melhor estimativa de
  // gasto total ao longo do campeonato — vai migrando de orçado para
  // provisionado conforme o operador trava cada item.
  const projetadoJogos = jogosCalc.reduce((s, j) => {
    const prov = subTotal(j.provisionado);
    return s + (prov > 0 ? prov : subTotal(j.orcado));
  }, 0);
  const projetadoServicos = servicosCalc.reduce((s, sec) =>
    s + sec.itens.reduce((u, i) => u + ((i.provisionado || 0) > 0 ? i.provisionado : (i.orcado || 0)), 0), 0);
  const totalProjetado = projetadoJogos + projetadoServicos;

  // Para reaproveitar TabSavings (que opera por rodada numérica), mapeamos fase→rodada compósita: ordem*100 + rodada
  const jogosParaSavings = useMemo(() => divulgados.map(j => ({
    ...j,
    rodada: ordemFase(j.fase) * 100 + (j.rodada || 0),
  })), [divulgados]);
  const rodadasListSavings = useMemo(() => {
    const set = new Set(jogosParaSavings.map(j => j.rodada));
    return ["Todas", ...Array.from(set).sort((a,b)=>a-b).map(String)];
  }, [jogosParaSavings]);
  const [filtroRodSav, setFiltroRodSav] = useState("Todas");
  const [filtroCatSav, setFiltroCatSav] = useState("Todas");
  const jogosFilteredSav = jogosParaSavings.filter(j =>
    (filtroRodSav==="Todas" || j.rodada===parseInt(filtroRodSav))
  );
  const totOrcSav  = jogosFilteredSav.reduce((s,j) => s+subTotal(j.orcado), 0);
  const totProvSav = jogosFilteredSav.reduce((s,j) => s+subTotal(j.provisionado), 0);

  const savingPorFase = useMemo(() => {
    const map = {};
    divulgados.forEach(j => {
      const fase = getFase(j.fase);
      const k = fase.short;
      if (!map[k]) map[k] = { name:k, Saving:0, ordem:fase.ordem };
      map[k].Saving += subTotal(j.orcado) - subTotal(j.provisionado);
    });
    return Object.values(map).sort((a,b)=>a.ordem-b.ordem);
  }, [divulgados]);

  const TABS_ORC  = ["dashboard","serviços","jogos","micro","savings","gráficos"];
  const TABS_NF   = ["notas fiscais","mensal","serviços livemode","rastreabilidade"];
  const TABS_REL  = !hubCompleto ? ["envio"] : ["apresentações","envio"];
  const TABS_LOG  = ["logística"];
  const TABS = setor==="orcamento" ? TABS_ORC : setor==="notas" ? TABS_NF : setor==="logistica" ? TABS_LOG : TABS_REL;

  const handleSetorChange = s => {
    setSetor(s);
    if (s === "orcamento") setTab("dashboard");
    else if (s === "notas") setTab("notas fiscais");
    else if (s === "logistica") setTab("logística");
    else if (s === "relatorio") setTab(!hubCompleto ? "envio" : "apresentações");
  };

  if (loadError) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,padding:24,textAlign:"center"}}>
      <p style={{color:T.textMd,fontSize:16}}>Falha ao carregar os dados. Nada foi alterado — clique para tentar de novo.</p>
      <button onClick={() => window.location.reload()} style={{color:"#fff",border:"none",borderRadius:7,padding:"8px 14px",cursor:"pointer",fontWeight:500,fontSize:12,background:"#65B32E"}}>Tentar novamente</button>
    </div>
  );
  if (loading) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <p style={{color:T.textMd,fontSize:16}}>Carregando...</p>
    </div>
  );

  const SETORES_ALL = [
    { k:"orcamento",    l:"Orçamento",            icon:LayoutDashboard },
    { k:"notas",        l:"Notas Fiscais",        icon:FileText },
    { k:"logistica",    l:"Logística",            icon:Truck },
    // Hub de Fornecedores saiu daqui (13/08/2026): módulo transversal, vive só na Home.
    { k:"relatorio",    l:"Relatório",            icon:ClipboardList },
  ];
  const SETORES = hubCompleto ? SETORES_ALL : [
    { k:"notas",     l:"Notas Fiscais", icon:FileText },
    { k:"relatorio", l:"Relatório",     icon:ClipboardList },
  ];
  const setorAtual = SETORES.find(s => s.k === setor);

  const orcadoTotalCampeonato = jogos.reduce((s,j)=>s+subTotal(j.orcado),0)
                              + servicos.reduce((t,sec)=>t+sec.itens.reduce((u,i)=>u+(i.orcado||0),0),0);
  const orcGlobalVariaveis = jogos.reduce((s,j) => s+subTotal(j.orcado||{}), 0);

  return (
    <div className={`page-enter${modoLeitura ? " hub-leitura" : ""}`} style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:"'Poppins',sans-serif",display:"flex"}}>
      {/* Sidebar */}
      <aside style={{
        width:72, minHeight:"100vh",
        background: T.gradSidebar || "linear-gradient(180deg,#0a0f1a,#0f172a)",
        borderRight:"1px solid rgba(255,255,255,0.06)",
        display:"flex", flexDirection:"column", alignItems:"center",
        paddingTop:16, paddingBottom:16, gap:6, flexShrink:0,
        position:"sticky", top:0, height:"100vh",
      }}>
        <div style={{ marginBottom: 12 }}>
          <LivemodeLogo size={40} onClick={onBack} title="Voltar ao portal"/>
        </div>
        <div style={{ width:32, height:1, background:"rgba(255,255,255,0.06)", marginBottom:8 }}/>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {SETORES.map(s => (
            <IconButton key={s.k} icon={s.icon} title={s.l}
              active={setor===s.k} onClick={()=>handleSetorChange(s.k)} size={44} T={T}/>
          ))}
        </div>
        <div style={{ flex:1 }}/>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {role !== 'visualizador' && <IconButton icon={ocultar ? EyeOff : Eye} title={ocultar?"Mostrar valores":"Ocultar valores"}
            onClick={()=>setOcultar(o=>!o)} active={ocultar} size={40} T={T}/>}
          <IconButton icon={darkMode ? Sun : Moon} title={darkMode?"Modo claro":"Modo escuro"}
            onClick={()=>setDarkMode(d=>!d)} size={40} T={T}/>
          <IconButton icon={LogOut} title="Sair" onClick={onSignOut} size={40} T={T}/>
        </div>
      </aside>

      {/* Main */}
      <div style={{flex:1,minWidth:0,paddingBottom:40,background:T.bg}}>
        <div style={{
          background: T.surface || T.card,
          borderBottom: `1px solid ${T.border}`,
          padding: "20px 32px 0",
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16,paddingBottom:18}}>
            <div style={{ minWidth:0, display:"flex", alignItems:"center", gap:14 }}>
              {setorAtual?.icon && (
                <div style={{
                  width:42, height:42, borderRadius:RADIUS.md,
                  background: T.brandSoft || "rgba(101,179,46,0.10)",
                  color: T.brand || "#65B32E",
                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
                }}>
                  <setorAtual.icon size={20} strokeWidth={2.25}/>
                </div>
              )}
              <div style={{ minWidth:0 }}>
                <p style={{
                  color: T.brand || "#65B32E",
                  fontSize:10, letterSpacing:"0.16em", textTransform:"uppercase",
                  margin:"0 0 3px", fontWeight:600, fontFamily: FONT.ui,
                }}>Livemode · Transmissões · {setorAtual?.l}</p>
                <h1 style={{ fontFamily: FONT.display, fontSize:22, fontWeight:700, margin:0, color:T.text, letterSpacing:"-0.005em", lineHeight:1.1 }}>Paulistão F 2026</h1>
                <p style={{ color:T.textMd, fontSize:12, margin:"4px 0 0" }}>
                  <span className="num" style={{ color:T.text, fontWeight:600 }}>{divulgados.length}</span> divulgados
                  <span style={{ color:T.border, margin:"0 8px" }}>·</span>
                  <span className="num" style={{ color:T.text, fontWeight:600 }}>{aDivulgar.length}</span> a divulgar
                  <span style={{ color:T.border, margin:"0 8px" }}>·</span>
                  <span className="num" style={{ color:T.text, fontWeight:600 }}>{FASES_PAULISTAO.length}</span> fases
                </p>
              </div>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{
                display:"flex", alignItems:"center", gap:12, padding:"10px 18px",
                background: T.surfaceAlt || T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg,
              }}>
                <Wallet size={16} color={T.projetado || "#7C3AED"} strokeWidth={2.25}/>
                <div style={{ textAlign:"right" }}>
                  <p style={{ color:T.textSm, fontSize:10, margin:"0 0 2px", letterSpacing:"0.08em", textTransform:"uppercase", fontWeight:600 }}>Orçado total campeonato</p>
                  <p className="num" style={{
                    fontFamily: FONT.display, fontSize:22, fontWeight:700, color: T.projetado || "#7C3AED", margin:0,
                    filter:ocultar?"blur(8px)":"none", transition:"filter 0.2s",
                    letterSpacing:"-0.005em", lineHeight:1,
                  }}>{fmt(orcadoTotalCampeonato)}</p>
                </div>
              </div>

              <div style={{
                display:"flex", alignItems:"center", gap:12, padding:"10px 18px",
                background: T.surfaceAlt || T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg,
              }}>
                <Activity size={16} color={T.brand || "#65B32E"} strokeWidth={2.25}/>
                <div style={{ textAlign:"right" }}>
                  <p style={{ color:T.textSm, fontSize:10, margin:"0 0 2px", letterSpacing:"0.08em", textTransform:"uppercase", fontWeight:600 }}>Execução geral</p>
                  <p className="num" style={{
                    fontFamily: FONT.display, fontSize:22, fontWeight:700,
                    color: pctGasto>80 ? (T.danger||"#DC2626") : (T.brand||"#65B32E"),
                    margin:0, filter:ocultar?"blur(8px)":"none", transition:"filter 0.2s",
                    letterSpacing:"-0.005em", lineHeight:1,
                  }}>{pctGasto}%</p>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display:"flex", gap:4, overflowX:"auto", WebkitOverflowScrolling:"touch", marginBottom:-1 }}>
            {TABS.map(t => {
              const isActive = tab===t;
              return (
                <button key={t} onClick={()=>setTab(t)} style={{
                  padding:"12px 16px", border:"none",
                  borderBottom: `2px solid ${isActive ? (T.brand||"#65B32E") : "transparent"}`,
                  background:"transparent",
                  color: isActive ? T.text : T.textMd,
                  fontFamily: FONT.ui,
                  fontWeight: isActive ? 500 : 400,
                  fontSize:13, cursor:"pointer", whiteSpace:"nowrap",
                  textTransform:"capitalize", flexShrink:0,
                  letterSpacing:"0",
                }}>{t}</button>
              );
            })}
          </div>
        </div>

        <div key={tab} className="tab-content" style={{padding:"28px 32px",filter:ocultar?"blur(10px)":"none",transition:"filter 0.3s",userSelect:ocultar?"none":"auto"}}>

        {tab==="dashboard" && (<>
          <div className="stagger" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14,marginBottom:24}}>
            <Stat T={T} label="Total Orçado"       value={fmt(totalOrc)}       sub="Jogos + serviços fixos" color={T.info} icon={Wallet}/>
            <Stat T={T} label="Total Provisionado" value={fmt(totalProv)}      sub={`${totalOrc?((totalProv/totalOrc)*100).toFixed(1):0}% do orçado`} color={T.warning} icon={PiggyBank}/>
            <Stat T={T} label="Total Realizado"    value={fmt(totalReal)}      sub={`${pctGasto}% executado`} color={T.success} icon={TrendingUp}/>
            <Stat T={T} label="Projetado"          value={fmt(totalProjetado)} sub="Provisionado quando há, senão orçado" color={T.projetado || "#7C3AED"} icon={Target}/>
          </div>
          <Card T={T}>
            <SectionHeader
              T={T}
              title="Resumo por Categoria"
              subtitle="Visão consolidada por natureza de despesa"
              icon={LayoutDashboard}
              right={<div style={{display:"flex",gap:10,fontSize:11,color:T.textMd}}>
                <Badge color="#6366f1" T={T}>Fixo</Badge>
                <Badge color="#f43f5e" T={T}>Variável</Badge>
              </div>}
            />
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:680}}>
                <thead>
                  <tr style={{background:T.surfaceAlt||T.bg}}>
                    {["Categoria","Tipo","Orçado","Provisionado","Realizado","% Exec.","Progresso"].map(h => (
                      <th key={h} style={{
                        padding:"11px 16px",
                        textAlign:h==="Categoria"||h==="Tipo"?"left":"right",
                        color:T.textSm, fontSize:10, fontWeight:700, letterSpacing:"0.06em",
                        textTransform:"uppercase", whiteSpace:"nowrap",
                        borderBottom:`1px solid ${T.border}`,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RESUMO_CATS.map(c => {
                    const pct = c.orcado ? Math.min(100,(c.realizado/c.orcado)*100) : 0;
                    return (
                      <tr key={`${c.nome}_${c.tipo}`} onClick={() => abrirRastreabilidade(c)} title="Ver NFs que compõem este valor"
                        style={{borderTop:`1px solid ${T.border}`,cursor:"pointer"}}
                        onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt||T.bg}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={{padding:"13px 16px",fontWeight:600,whiteSpace:"nowrap",color:T.text,fontSize:13}}>{c.nome}</td>
                        <td style={{padding:"13px 16px"}}><Pill label={c.tipo} color={TIPO_COLOR[c.tipo]}/></td>
                        <td className="num" style={{padding:"13px 16px",textAlign:"right",whiteSpace:"nowrap",color:T.text,fontSize:13}}>{fmt(c.orcado)}</td>
                        <td className="num" style={{padding:"13px 16px",textAlign:"right",color:T.warning||"#D97706",whiteSpace:"nowrap",fontSize:13}}>{fmt(c.provisionado||0)}</td>
                        <td className="num" style={{padding:"13px 16px",textAlign:"right",color:T.success||"#16A34A",whiteSpace:"nowrap",fontSize:13}}>{fmt(c.realizado)}</td>
                        <td className="num" style={{padding:"13px 16px",textAlign:"right",color:T.text,fontSize:13}}>{pct.toFixed(1)}%</td>
                        <td style={{padding:"13px 20px",minWidth:120}}><Progress value={pct} T={T}/></td>
                      </tr>
                    );
                  })}
                  <tr style={{borderTop:`2px solid ${T.borderStrong||T.border}`,background:T.surfaceAlt||T.bg,fontWeight:700}}>
                    <td colSpan={2} style={{padding:"14px 16px",color:T.text,fontSize:12,letterSpacing:"0.04em",textTransform:"uppercase"}}>Total Geral</td>
                    <td className="num" style={{padding:"14px 16px",textAlign:"right",color:T.info||"#2563EB",whiteSpace:"nowrap",fontSize:14,fontWeight:600}}>{fmt(totalOrc)}</td>
                    <td className="num" style={{padding:"14px 16px",textAlign:"right",color:T.warning||"#D97706",whiteSpace:"nowrap",fontSize:14,fontWeight:600}}>{fmt(totalProv)}</td>
                    <td className="num" style={{padding:"14px 16px",textAlign:"right",color:T.success||"#16A34A",whiteSpace:"nowrap",fontSize:14,fontWeight:600}}>{fmt(totalReal)}</td>
                    <td className="num" style={{padding:"14px 16px",textAlign:"right",color:T.text,fontSize:14,fontWeight:700}}>{pctGasto}%</td>
                    <td/>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>)}

        <Suspense fallback={<div style={{padding:'2rem',textAlign:'center',opacity:.5}}>Carregando…</div>}>
        {tab==="jogos"         && <TabJogosPaulistao jogos={jogosCalc} filtroFase={filtroFase} setFiltroFase={setFiltroFase} filtroGrupo={filtroGrupo} setFiltroGrupo={setFiltroGrupo} showPlaceholder={showPlaceholder} setShowPlaceholder={setShowPlaceholder} setMicroJogoId={setMicroJogoId} setTab={setTab} setNovo={setNovo} onDelete={deleteJogo} onEdit={editJogo} T={T}/>}
        {tab==="savings"       && <TabSavings jogosFiltered={jogosFilteredSav} divulgados={jogosParaSavings} totOrcJogos={totOrcSav} totProvJogos={totProvSav} filtroRod={filtroRodSav} setFiltroRod={setFiltroRodSav} filtroCat={filtroCatSav} setFiltroCat={setFiltroCatSav} rodadasList={rodadasListSavings} T={T}/>}
        {tab==="gráficos"      && <TabGraficos divulgados={divulgados} notas={notas} dedupeNotasPorNF savingRodada={savingPorFase} RESUMO_CATS={RESUMO_CATS} T={T}/>}
        {tab==="micro"         && <VisaoMicro jogos={jogosCalc} jogoId={microJogoId} onChangeJogo={setMicroJogoId} onSave={saveJogo} T={T}/>}
        {tab==="serviços"      && <TabServicos servicos={servicosCalc} setServicos={setServicos} T={T}/>}
        {tab==="notas fiscais" && <TabNotas notas={notas} setNotas={setNotas} jogos={jogos} setJogos={setJogos} fornecedores={fornecedores} envios={envios} setEnvios={setEnvios} fornecedoresJogo={fornecedoresJogo} setFornecedoresJogo={setFornecedoresJogo} notasMensais={notasMensais} setNotasMensais={setNotasMensais} onReembolsoCriado={nota => setLogistica(ls => marcarLogisticaReembolsada(ls, nota))} T={T} submissionsKey="paulistao_nf_submissions" historicoKey="paulistao_nf_historico" formHash="#formulario-paulistao" usarPortal={false} subsExcluirExtra={["downlink","distribuicao","maquinas"]} dedupeNotasPorNF={true} role={role}/>}
        {tab==="mensal"        && <TabNotasMensal notas={notasMensais} setNotas={setNotasMensais} fornecedores={fornecedores} servicos={servicosCalc} envios={envios} setEnvios={setEnvios} T={T} role={role} fixos={fixos} setFixos={setFixos} mesInicioCamp={4} mesFimCamp={11} nomeCampeonato="Paulistão Feminino 2026" linkFormulario={`${window.location.origin}${window.location.pathname}#formulario-paulistao`}/>}
        {tab==="serviços livemode" && <TabLivemode livemode={livemode} setLivemode={setLivemode} notasLivemode={notasLivemode} setNotasLivemode={setNotasLivemode} jogos={jogos} fornecedores={fornecedores} T={T} useOrcadoLivemode={true} servicosLm={SERVICOS_LM_PAULISTAO} role={role}/>}
        {tab==="logística"     && <TabLogistica logistica={logistica} setLogistica={setLogistica} jogos={jogos} fornecedores={fornecedores} eventosLog={eventosLog} setEventosLog={setEventosLog} notas={notas} setNotas={setNotas} historicoKey="paulistao_nf_historico" T={T}/>}
        {tab==="apresentações" && <TabApresentacoes jogos={divulgados} servicos={servicosCalc} notasMensais={notasMensais} notas={notas} notasLivemode={notasLivemode} dedupeNotasPorNF={true} grupoDoJogo={grupoDoJogoPaulistao} T={T} apres={apres} setApres={setApres} orcGlobal={orcGlobalVariaveis} mesInicio={4} nomeCampeonato="Paulistão Feminino 2026"/>}
        {tab==="envio"         && <TabEnvio jogos={jogosCalc} notas={notas} notasMensais={notasMensais} notasLivemode={notasLivemode} servicos={servicosCalc} envios={envios} setEnvios={setEnvios} T={T} enviosKey={K.envios} dedupeNotasPorNF={true} role={role} agruparReembolsoComLivemode/>}
        {tab==="rastreabilidade" && <TabRastreabilidade notas={notas} notasMensais={notasMensais} servicos={servicosCalc} jogos={jogosCalc} logistica={logistica} notasLivemode={notasLivemode} T={T} filtroInicial={filtroRastreabilidade} onClearFiltroInicial={() => setFiltroRastreabilidade(null)} dedupeNotasPorNF={true} grupoDoJogo={grupoDoJogoPaulistao}/>}
        </Suspense>

        </div>

        {role === 'admin' && showNovo && <NovoJogoPaulistaoModal onSave={addJogo} onClose={()=>setNovo(false)} T={T}/>}
        {jogoEdit && <NovoJogoPaulistaoModal jogo={jogoEdit} onSave={handleEditSave} onClose={()=>setJogoEdit(null)} T={T}/>}
      </div>
    </div>
  );
}
