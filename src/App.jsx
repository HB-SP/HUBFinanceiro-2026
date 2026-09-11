import { useState, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { DARK, LIGHT, CATS, TIPO_COLOR, VAR_CAT_TO_CATKEY, LS_JOGOS, LS_SERVICOS, LS_DARK, btnStyle, RADIUS, CENARIO_INFO, FONT } from "./constants";
import { fmt, fmtK, subTotal, catTotal, lsGet, lsSet } from "./utils";
import { ALL_JOGOS, SERVICOS_INIT } from "./data";
import { KPI, Pill, CustomTooltip } from "./components/shared";
import { Card, SectionHeader, Stat, Badge, Progress, IconButton } from "./components/ui";
import {
  LayoutDashboard, FileText, ClipboardList,
  ArrowLeft, Eye, EyeOff, Sun, Moon, Lock, LogOut,
  Wallet, TrendingUp, Activity, PiggyBank, Truck, Target,
} from "lucide-react";
import Home             from "./components/Home";
import LivemodeLogo     from "./components/LivemodeLogo";
const TabJogos         = lazy(() => import("./components/tabs/TabJogos"));
const TabSavings       = lazy(() => import("./components/tabs/TabSavings"));
const TabGraficos      = lazy(() => import("./components/tabs/TabGraficos"));
const TabServicos      = lazy(() => import("./components/tabs/TabServicos"));
const VisaoMicro       = lazy(() => import("./components/tabs/VisaoMicro"));
const TabApresentacoes = lazy(() => import("./components/tabs/TabApresentacoes"));
const TabNotas         = lazy(() => import("./components/tabs/TabNotas"));
const TabNotasMensal   = lazy(() => import("./components/tabs/TabNotasMensal"));
const TabEnvio         = lazy(() => import("./components/tabs/TabEnvio"));
const TabLivemode      = lazy(() => import("./components/tabs/TabLivemode"));
const TabLogistica     = lazy(() => import("./components/tabs/TabLogistica"));
const TabRastreabilidade = lazy(() => import("./components/tabs/TabRastreabilidade"));
import { NovoJogoModal, NovoRapidoModal } from "./components/modals/NovoJogoModal";
import { getState, setState as setSupabaseState, supabase, createPersistedSetter, isPersistPending, setModoLeitura } from "./lib/supabase";
import { lerApresentacoesDoLocalStorage } from "./lib/apresentacoesCalc";
import { buildRealizadoPorJogo, buildInfraRealizadoPorJogo, marcarLogisticaReembolsada } from "./lib/notasFiscais";
import { FORNECEDORES_INIT } from "./data/fornecedores";
import { COTACAO_INIT } from "./data/negociacoes";
import { useSessionTimeout } from "./hooks/useSessionTimeout";
import { useAgendaPortal } from "./hooks/useAgendaPortal";
import { useSincronizarEnvios } from "./hooks/useSincronizarEnvios";


// ─── BRASILEIRÃO ──────────────────────────────────────────────────────────────
function Brasileirao({ onBack, onOpenHub, T, darkMode, setDarkMode, role = 'admin', escopo = 'notas', onSignOut }) {
  // Visualizador com escopo 'completo' (time Livemode): vê todas as abas em modo leitura
  const hubCompleto = role === 'admin' || escopo === 'completo';
  const modoLeitura = role === 'visualizador' && escopo === 'completo';
  const [jogos, setJogosRaw]       = useState(ALL_JOGOS);
  const [servicos, setServicosRaw] = useState(SERVICOS_INIT);
  const [notas, setNotasRaw]               = useState([]);
  const [notasMensais, setNotasMensaisRaw] = useState([]);
  const [envios, setEnviosRaw]             = useState([]);
  const [fornecedores, setFornecedoresRaw] = useState(FORNECEDORES_INIT);
  const [cotacoes, setCotacoesRaw]         = useState(COTACAO_INIT);
  const [livemode, setLivemodeRaw]       = useState([]);
  const [notasLivemode, setNotasLivemodeRaw] = useState([]);
  const [notasLiveU, setNotasLiveURaw]   = useState([]);
  const [logistica, setLogisticaRaw]     = useState([]);
  const [eventosLog, setEventosLogRaw]   = useState([]);
  const [fornecedoresJogo, setFornecedoresJogoRaw] = useState({});
  const [apres, setApresRaw]             = useState({});
  const [fixos, setFixosRaw]             = useState(null); // contratos fixos p/ cobrança de NF (lib/cobrancaFixos.js)
  const [loading, setLoading]            = useState(true);
  const [loadError, setLoadError]        = useState(null);
  // Cada setter relê o valor atual do Supabase antes de gravar de volta (ver
  // createPersistedSetter em lib/supabase.js) — uma aba parada ou o realtime
  // caído não fazem mais uma edição sobrescrever o que outra pessoa salvou.
  // Também usado pelo handler de realtime abaixo pra não sobrescrever uma
  // edição local em andamento com um eco desatualizado (isPersistPending).
  const persistRefs = useRef({}).current;

  useEffect(() => {
    async function load() {
      try {
        const [j, s, n, f, nm, ev, lm, nlm, nlu, co, fj, lg, elg, ap, fx] = await Promise.all([getState('jogos'), getState('servicos'), getState('notas'), getState('fornecedores'), getState('notas_mensais'), getState('envios'), getState('livemode'), getState('notas_livemode'), getState('notas_liveu'), getState('cotacoes'), getState('fornecedores_jogo'), getState('logistica'), getState('eventos_log'), getState('apresentacoes'), getState('fixos_contratos')]);
        // Seed APENAS quando o valor é null/undefined (linha não existe no banco).
        // Nunca sobrescreve um array vazio legítimo, e nunca escreve por cima de
        // dados existentes — assim um getState com falha transitória/null não zera
        // notas, notas_mensais, fornecedores etc. (incidente 2026-05-01). Se getState
        // falhar de verdade (erro de rede etc.) ele agora lança, cai no catch abaixo
        // e NADA aqui é seedado por cima de dados reais.
        const seedIfMissing = (val, key, init, setRaw) => {
          if (val != null) { setRaw(val); return; }
          setRaw(init);
          setSupabaseState(key, init);
        };
        seedIfMissing(j, 'jogos', ALL_JOGOS, setJogosRaw);
        if (s != null) {
          // Migração: renomear "Infraestrutura e Distribuição de Sinais" -> "Serviços Complementares"
          const OLD = "Infraestrutura e Distribuição de Sinais";
          const NEW = "Serviços Complementares";
          const precisaMigrar = Array.isArray(s) && s.some(sec => sec.secao === OLD);
          if (precisaMigrar) {
            const migrado = s.map(sec => sec.secao === OLD ? {...sec, secao: NEW} : sec);
            setServicosRaw(migrado);
            setSupabaseState('servicos', migrado);
          } else {
            setServicosRaw(s);
          }
        } else { setServicosRaw(SERVICOS_INIT); setSupabaseState('servicos', SERVICOS_INIT); }
        seedIfMissing(n,   'notas',             [],                  setNotasRaw);
        seedIfMissing(f,   'fornecedores',      FORNECEDORES_INIT,   setFornecedoresRaw);
        // Reclassificação (pedido de 07/08/2026): NFs mensais desses fornecedores
        // que entram como "Ferramenta de Clipping" (servicoId 9, mapeamento fixo
        // do formulário público) pertencem às linhas de Editor de Imagens.
        // Regra permanente e idempotente — pega também notas futuras do form.
        if (nm != null) {
          const DESTINO_CLIPPING = {
            "luan domiciano": { servicoId: 5, categoria: "Editor de Imagens 2" },
            "gabriel sayao":  { servicoId: 4, categoria: "Editor de Imagens 1" },
            "nosso nos":      { servicoId: 4, categoria: "Editor de Imagens 1" },
            "capital humano": { servicoId: 4, categoria: "Editor de Imagens 1" },
          };
          const normForn = x => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
          let reclassificou = false;
          const nmFinal = nm.map(nota => {
            const forn = normForn(nota.fornecedor);
            // Gabriel Sayão chegou a ir pro Editor 2 numa versão anterior desta
            // regra — o segundo teste desfaz isso se a gravação já tiver ocorrido.
            const aplicavel = nota.servicoId === 9 || (forn === "gabriel sayao" && nota.servicoId === 5);
            if (!aplicavel) return nota;
            const destino = DESTINO_CLIPPING[forn];
            if (!destino || destino.servicoId === nota.servicoId) return nota;
            reclassificou = true;
            return { ...nota, servicoId: destino.servicoId, categoria: destino.categoria };
          });
          setNotasMensaisRaw(nmFinal);
          if (reclassificou) setSupabaseState('notas_mensais', nmFinal);
        } else { setNotasMensaisRaw([]); setSupabaseState('notas_mensais', []); }
        seedIfMissing(ev,  'envios',            [],                  setEnviosRaw);
        seedIfMissing(lm,  'livemode',          [],                  setLivemodeRaw);
        seedIfMissing(nlm, 'notas_livemode',    [],                  setNotasLivemodeRaw);
        seedIfMissing(nlu, 'notas_liveu',       [],                  setNotasLiveURaw);
        seedIfMissing(co,  'cotacoes',          COTACAO_INIT,        setCotacoesRaw);
        seedIfMissing(fj,  'fornecedores_jogo', {},                  setFornecedoresJogoRaw);
        seedIfMissing(lg,  'logistica',         [],                  setLogisticaRaw);
        seedIfMissing(elg, 'eventos_log',       [],                  setEventosLogRaw);
        // Migração one-time da aba Apresentações: importa os overrides que
        // viviam no localStorage (prefixo "bra") quando a linha ainda não existe.
        seedIfMissing(ap,  'apresentacoes',     lerApresentacoesDoLocalStorage('bra'), setApresRaw);
        seedIfMissing(fx,  'fixos_contratos',   { mesesSemServico: [], contratos: [] }, setFixosRaw);
        setLoading(false);
        setLoadError(null);
      } catch (err) {
        console.error('Falha ao carregar dados do Supabase — nada foi sobrescrito:', err);
        setLoadError(err);
      }
    }
    load();

    const channel = supabase
      .channel('app_state_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_state' }, payload => {
        const key = payload.new.key;
        if (isPersistPending(persistRefs, key)) return; // edição local em andamento vence o eco
        if (key === 'jogos')        setJogosRaw(payload.new.value);
        if (key === 'servicos')     setServicosRaw(payload.new.value);
        if (key === 'notas')        setNotasRaw(payload.new.value);
        if (key === 'fornecedores')   setFornecedoresRaw(payload.new.value);
        if (key === 'notas_mensais') setNotasMensaisRaw(payload.new.value);
        if (key === 'envios')        setEnviosRaw(payload.new.value);
        if (key === 'livemode')      setLivemodeRaw(payload.new.value);
        if (key === 'notas_livemode') setNotasLivemodeRaw(payload.new.value);
        if (key === 'notas_liveu')   setNotasLiveURaw(payload.new.value);
        if (key === 'cotacoes')       setCotacoesRaw(payload.new.value);
        if (key === 'fornecedores_jogo') setFornecedoresJogoRaw(payload.new.value);
        if (key === 'logistica')     setLogisticaRaw(payload.new.value);
        if (key === 'eventos_log')   setEventosLogRaw(payload.new.value);
        if (key === 'apresentacoes') setApresRaw(payload.new.value);
        if (key === 'fixos_contratos') setFixosRaw(payload.new.value);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const setJogos             = createPersistedSetter('jogos',             setJogosRaw,             persistRefs);
  const setServicos          = createPersistedSetter('servicos',          setServicosRaw,          persistRefs);
  const setNotas             = createPersistedSetter('notas',             setNotasRaw,             persistRefs);
  const setEnvios            = createPersistedSetter('envios',            setEnviosRaw,            persistRefs);
  const setNotasMensais      = createPersistedSetter('notas_mensais',     setNotasMensaisRaw,      persistRefs);
  const setFornecedores      = createPersistedSetter('fornecedores',      setFornecedoresRaw,      persistRefs);
  const setLivemode          = createPersistedSetter('livemode',          setLivemodeRaw,          persistRefs);
  const setNotasLivemode     = createPersistedSetter('notas_livemode',    setNotasLivemodeRaw,     persistRefs);
  const setNotasLiveU        = createPersistedSetter('notas_liveu',       setNotasLiveURaw,        persistRefs);
  const setCotacoes          = createPersistedSetter('cotacoes',          setCotacoesRaw,          persistRefs);
  const setEventosLog        = createPersistedSetter('eventos_log',       setEventosLogRaw,        persistRefs);
  const setLogistica         = createPersistedSetter('logistica',         setLogisticaRaw,         persistRefs, { debounceMs: 500 });
  const setFornecedoresJogo  = createPersistedSetter('fornecedores_jogo', setFornecedoresJogoRaw,  persistRefs, { empty: {}, debounceMs: 500 });
  const setApres             = createPersistedSetter('apresentacoes',     setApresRaw,             persistRefs, { empty: {}, debounceMs: 600 });
  const setFixos             = createPersistedSetter('fixos_contratos',   setFixosRaw,             persistRefs, { empty: { mesesSemServico: [], contratos: [] } });

  // Agenda herdada do Portal de Controle (a matriz desde 2026-08): descritivo
  // dos jogos vem de lá; orçamento/realizado continuam 100% do Hub.
  // Só admin roda o sync/adoção — com o RLS do Portal (2026-08-06), a gravação
  // do hub_jogo_id na adoção exige papel de escrita; um visualizador com a tela
  // aberta gravaria pela metade e o jogo novo poderia ser adotado em dobro.
  useAgendaPortal({ tabela: 'brasileirao_jogos', tabelaPeriferico: 'perifericos_brasileirao', rodadaCol: 'eu', jogos, setJogos, pronto: !loading, enabled: role === 'admin' });
  // Resumos dos envios espelham as notas vivas (nº, data, valor, anexo) — ver lib/sincronizarEnvios.
  useSincronizarEnvios({ envios, setEnvios, notas, notasMensais, notasLivemode: [...notasLivemode, ...notasLiveU], pronto: !loading, enabled: role === 'admin', dedupeNotasPorNF: true });

  // Rateio de notas mensais "Seg. Espacial" entre jogos do mês
  // Rateia Seg. Espacial entre os jogos do mês. Quando o mês não tem nenhum jogo
  // (ex: pausa no meio da temporada), não tem jogo pra receber o rateio -- o valor
  // ia sendo descartado do realizado (a NF existe, mas cai em nenhum lugar). Agora
  // fica em `orfao`, somado direto na categoria Operações em vez de sumir.
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
  // Livemode/liveU (antes só era atualizado ao clicar em "Sincronizar Jogos").
  const infraRealizadoPorJogo = useMemo(
    () => buildInfraRealizadoPorJogo(notasLivemode, notasLiveU),
    [notasLivemode, notasLiveU]
  );

  // jogosCalc: jogos com realizado recalculado das NFs + seg. espacial derivado.
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

  // Servicos com realizado derivado das NFs mensais (fonte única da verdade: as NFs)
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

  // "Outros Mensais": NFs mensais sem servicoId e sem mapeamento variável (ex: categoria "Outro"),
  // e também NFs cujo servicoId aponta pra um item de serviço fixo já excluído (órfãs) --
  // sem isso, o valor delas some do dashboard mas continua aparecendo na aba Mensal.
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

  const [setor,           setSetor]           = useState(() => (role === 'visualizador' && escopo !== 'completo') ? "notas" : "orcamento");
  const [tab,             setTab]             = useState(() => (role === 'visualizador' && escopo !== 'completo') ? "notas fiscais" : "dashboard");
  const [showNovo,        setNovo]            = useState(false);
  const [novoRapido,      setNovoRapido]      = useState(null);
  const [jogoEdit,        setJogoEdit]        = useState(null);

  const [filtroRod,       setFiltroRod]       = useState("Todas");
  const [filtroCat,       setFiltroCat]       = useState("Todas");
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [microJogoId,     setMicroJogoId]     = useState(jogos.find(j=>j.mandante!=="A definir")?.id);
  const [ocultar,         setOcultar]         = useState(false);
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
      // 1) Tentar substituir placeholder da mesma rodada e categoria
      let replaced = false;
      let next = js.map(x => {
        if (!replaced && x.mandante === "A definir" && x.rodada === j.rodada && x.categoria === j.categoria) {
          replaced = true;
          return { ...j, id: x.id };
        }
        return x;
      });
      // 2) Se não achou match exato, substituir qualquer placeholder disponível
      if (!replaced) {
        next = js.map(x => {
          if (!replaced && x.mandante === "A definir") {
            replaced = true;
            return { ...j, id: x.id };
          }
          return x;
        });
      }
      return replaced ? next : js; // nunca ultrapassar o total de 76
    });
    setNovo(false); setNovoRapido(null);
  };
  const deleteJogo     = id => { if(window.confirm("Excluir este jogo?")) setJogos(js => js.filter(j => j.id !== id)); };
  const editJogo       = j => setJogoEdit(j);
  const handleEditSave = j => { saveJogo(j); setJogoEdit(null); };


  const totalOrc  = RESUMO_CATS.reduce((s,c) => s+c.orcado, 0);
  const totalProv = RESUMO_CATS.reduce((s,c) => s+c.provisionado, 0);
  const totalReal = RESUMO_CATS.reduce((s,c) => s+c.realizado, 0);
  const pctGasto  = totalOrc ? ((totalReal/totalOrc)*100).toFixed(1) : 0;

  const divulgados  = jogosCalc.filter(j => j.mandante !== "A definir").sort((a,b) => a.rodada - b.rodada || a.id - b.id);
  const aDivulgar   = jogos.filter(j => j.mandante === "A definir");
  const rodadasList = ["Todas", ...Array.from(new Set(divulgados.map(j=>j.rodada))).sort((a,b)=>a-b).map(String)];

  // ─── PROJETADO ATÉ FIM DO CAMPEONATO ────────────────────────────────────────
  // Plano pré-campeonato: 34 B1 sudeste + 18 B2 sudeste + 24 B2 sul = 76 jogos
  const PLANO_JOGOS = { b1:34, b2s:18, b2sul:24 };
  const CIDADES_SUL = ["Porto Alegre","Curitiba","Chapecó","Chapeco","Criciúma","Criciuma","Florianópolis","Florianopolis"];
  const cenarioDoJogo = j => {
    if (j.categoria === "B1") return "b1";
    const isSul = j.regiao ? String(j.regiao).toLowerCase()==="sul" : CIDADES_SUL.includes(j.cidade);
    return isSul ? "b2sul" : "b2s";
  };
  const divulgadosCount = { b1:0, b2s:0, b2sul:0 };
  divulgados.forEach(j => { divulgadosCount[cenarioDoJogo(j)]++; });
  const orcRestanteJogos = Object.keys(PLANO_JOGOS).reduce((s,k) => {
    const restante = Math.max(0, PLANO_JOGOS[k] - divulgadosCount[k]);
    return s + restante * CENARIO_INFO[k].total;
  }, 0);
  const totalProjetado = totalProv + orcRestanteJogos;

  const filtrados = (showPlaceholder ? jogosCalc : divulgados).filter(j =>
    (filtroRod==="Todas" || j.rodada===parseInt(filtroRod)) &&
    (filtroCat==="Todas" || j.categoria===filtroCat)
  ).sort((a,b) => a.rodada - b.rodada || a.id - b.id);

  const jogosFiltered = divulgados.filter(j =>
    (filtroRod==="Todas" || j.rodada===parseInt(filtroRod)) &&
    (filtroCat==="Todas" || j.categoria===filtroCat)
  );
  const totOrcJogos  = jogosFiltered.reduce((s,j) => s+subTotal(j.orcado), 0);
  const totProvJogos = jogosFiltered.reduce((s,j) => s+subTotal(j.provisionado), 0);

  const savingRodada = useMemo(() => {
    const map = {};
    divulgados.forEach(j => {
      const r = `R${j.rodada}`;
      if(!map[r]) map[r] = { name:r, Saving:0 };
      map[r].Saving += subTotal(j.orcado) - subTotal(j.provisionado);
    });
    return Object.values(map).sort((a,b) => parseInt(a.name.slice(1))-parseInt(b.name.slice(1)));
  }, [jogos]);

  const TABS_ORC  = ["dashboard","serviços","jogos","micro","savings","gráficos"];
  const TABS_NF   = ["notas fiscais","mensal","serviços livemode","rastreabilidade"];
  const TABS_REL  = !hubCompleto ? ["envio"] : ["apresentações","envio"];
  const TABS_LOG  = ["logística"];
  const TABS = setor === "orcamento" ? TABS_ORC : setor === "notas" ? TABS_NF : setor === "logistica" ? TABS_LOG : TABS_REL;

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
      <button onClick={() => window.location.reload()} style={{...btnStyle,background:"#65B32E"}}>Tentar novamente</button>
    </div>
  );
  if (loading) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <p style={{color:T.textMd,fontSize:16}}>Carregando...</p>
    </div>
  );

  const SETORES_ALL = [
    {k:"orcamento",    l:"Orçamento",            icon:LayoutDashboard},
    {k:"notas",        l:"Notas Fiscais",        icon:FileText},
    {k:"logistica",    l:"Logística",            icon:Truck},
    // Hub de Fornecedores saiu daqui (13/08/2026): é módulo transversal a todos
    // os campeonatos e vive só na Home.
    {k:"relatorio",    l:"Relatório",            icon:ClipboardList},
  ];
  const SETORES = hubCompleto ? SETORES_ALL : [
    {k:"notas",     l:"Notas Fiscais", icon:FileText},
    {k:"relatorio", l:"Relatório",     icon:ClipboardList},
  ];

  const setorAtual = SETORES.find(s => s.k === setor);

  return (
    <div className={`page-enter${modoLeitura ? " hub-leitura" : ""}`} style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:"'Poppins',sans-serif",display:"flex"}}>

      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <aside style={{
        width:72,
        minHeight:"100vh",
        background: T.gradSidebar || "linear-gradient(180deg,#0a0f1a,#0f172a)",
        borderRight:"1px solid rgba(255,255,255,0.06)",
        display:"flex",
        flexDirection:"column",
        alignItems:"center",
        paddingTop:16,
        paddingBottom:16,
        gap:6,
        flexShrink:0,
        position:"sticky",
        top:0,
        height:"100vh",
      }}>
        {/* Livemode mark — clica para voltar */}
        <div style={{ marginBottom: 12 }}>
          <LivemodeLogo size={40} onClick={onBack} title="Voltar ao portal"/>
        </div>

        <div style={{ width:32, height:1, background:"rgba(255,255,255,0.06)", marginBottom:8 }}/>

        {/* setores */}
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {SETORES.map(s => (
            <IconButton key={s.k} icon={s.icon} title={s.l}
              active={setor===s.k}
              onClick={()=>handleSetorChange(s.k)}
              size={44} T={T}/>
          ))}
        </div>

        <div style={{ flex:1 }}/>

        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {role !== 'visualizador' && <IconButton
            icon={ocultar ? EyeOff : Eye}
            title={ocultar?"Mostrar valores":"Ocultar valores"}
            onClick={()=>setOcultar(o=>!o)}
            active={ocultar}
            size={40} T={T}
          />}
          <IconButton
            icon={darkMode ? Sun : Moon}
            title={darkMode?"Modo claro":"Modo escuro"}
            onClick={()=>setDarkMode(d=>!d)}
            size={40} T={T}
          />
          <IconButton icon={LogOut} title="Sair" onClick={onSignOut} size={40} T={T}/>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────── */}
      <div style={{flex:1,minWidth:0,paddingBottom:40,background:T.bg}}>
        {/* Header corporativo */}
        <div style={{
          background: T.surface || T.card,
          borderBottom: `1px solid ${T.border}`,
          padding: "20px 32px 0",
        }}>
          <div style={{
            display:"flex",
            justifyContent:"space-between",
            alignItems:"flex-start",
            flexWrap:"wrap",
            gap:16,
            paddingBottom:18,
          }}>
            <div style={{ minWidth:0, display:"flex", alignItems:"center", gap:14 }}>
              {setorAtual?.icon && (
                <div style={{
                  width:42, height:42, borderRadius:12,
                  background: T.brandSoft || "rgba(16,185,129,0.12)",
                  border: `1px solid ${T.brandBorder || "rgba(16,185,129,0.28)"}`,
                  color: T.brand || "#10b981",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  flexShrink:0,
                }}>
                  <setorAtual.icon size={20} strokeWidth={2.25}/>
                </div>
              )}
              <div style={{ minWidth:0 }}>
                <p style={{
                  color: T.brand || "#65B32E",
                  fontSize: 10,
                  letterSpacing:"0.16em",
                  textTransform:"uppercase",
                  margin:"0 0 3px",
                  fontWeight:600,
                  fontFamily: FONT.ui,
                }}>Livemode · Transmissões · {setorAtual?.l}</p>
                <h1 style={{
                  fontFamily: FONT.display,
                  fontSize:22,
                  fontWeight:700,
                  margin:0,
                  color:T.text,
                  letterSpacing:"-0.005em",
                  lineHeight:1.1,
                }}>Brasileirão Série A 2026</h1>
                <p style={{ color:T.textMd, fontSize:12, margin:"4px 0 0" }}>
                  <span className="num" style={{ color:T.text, fontWeight:600 }}>{divulgados.length}</span> divulgados
                  <span style={{ color:T.border, margin:"0 8px" }}>·</span>
                  <span className="num" style={{ color:T.text, fontWeight:600 }}>{aDivulgar.length}</span> a divulgar
                  <span style={{ color:T.border, margin:"0 8px" }}>·</span>
                  <span className="num" style={{ color:T.text, fontWeight:600 }}>38</span> rodadas
                </p>
              </div>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{
                display:"flex", alignItems:"center", gap:12,
                padding:"10px 18px",
                background: T.surfaceAlt || T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: RADIUS.lg,
              }}>
                <Wallet size={16} color={T.projetado || "#7C3AED"} strokeWidth={2.25}/>
                <div style={{ textAlign:"right" }}>
                  <p style={{ color:T.textSm, fontSize:10, margin:"0 0 2px", letterSpacing:"0.08em", textTransform:"uppercase", fontWeight:600 }}>Orçado total campeonato</p>
                  <p className="num" style={{
                    fontFamily: FONT.display,
                    fontSize:22,
                    fontWeight:700,
                    color: T.projetado || "#7C3AED",
                    margin:0,
                    filter:ocultar?"blur(8px)":"none",
                    transition:"filter 0.2s",
                    letterSpacing:"-0.005em",
                    lineHeight:1,
                  }}>{fmt(11540692)}</p>
                </div>
              </div>

              <div style={{
                display:"flex", alignItems:"center", gap:12,
                padding:"10px 18px",
                background: T.surfaceAlt || T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: RADIUS.lg,
              }}>
                <Activity size={16} color={T.brand || "#65B32E"} strokeWidth={2.25}/>
                <div style={{ textAlign:"right" }}>
                  <p style={{ color:T.textSm, fontSize:10, margin:"0 0 2px", letterSpacing:"0.08em", textTransform:"uppercase", fontWeight:600 }}>Execução geral</p>
                  <p className="num" style={{
                    fontFamily: FONT.display,
                    fontSize:22,
                    fontWeight:700,
                    color: pctGasto>80 ? (T.danger||"#DC2626") : (T.brand||"#65B32E"),
                    margin:0,
                    filter:ocultar?"blur(8px)":"none",
                    transition:"filter 0.2s",
                    letterSpacing:"-0.005em",
                    lineHeight:1,
                  }}>{pctGasto}%</p>
                </div>
              </div>
            </div>
          </div>

          {/* tabs */}
          <div style={{
            display:"flex", gap:4, overflowX:"auto", WebkitOverflowScrolling:"touch",
            marginBottom:-1,
          }}>
            {TABS.map(t => {
              const isActive = tab===t;
              return (
                <button key={t} onClick={()=>setTab(t)} style={{
                  padding:"12px 16px",
                  border:"none",
                  borderBottom: `2px solid ${isActive ? (T.brand||"#65B32E") : "transparent"}`,
                  background:"transparent",
                  color: isActive ? T.text : T.textMd,
                  fontFamily: FONT.ui,
                  fontWeight: isActive ? 500 : 400,
                  fontSize:13,
                  cursor:"pointer",
                  whiteSpace:"nowrap",
                  textTransform:"capitalize",
                  flexShrink:0,
                  letterSpacing:"0",
                }}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div key={tab} className="tab-content" style={{padding:"28px 32px",filter:ocultar?"blur(10px)":"none",transition:"filter 0.3s",userSelect:ocultar?"none":"auto"}}>

        {/* ── DASHBOARD ── */}
        {tab==="dashboard" && (<>
          <div className="stagger" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14,marginBottom:24}}>
            <Stat T={T} label="Total Orçado"       value={fmt(totalOrc)}           sub="Jogos + serviços fixos"                                           color={T.info}    icon={Wallet}     />
            <Stat T={T} label="Total Provisionado" value={fmt(totalProv)}          sub={`${totalOrc?((totalProv/totalOrc)*100).toFixed(1):0}% do orçado`} color={T.warning} icon={PiggyBank}  />
            <Stat T={T} label="Total Realizado"    value={fmt(totalReal)}          sub={`${pctGasto}% executado`}                                         color={T.success} icon={TrendingUp} />
            <Stat T={T} label="Projetado"          value={fmt(totalProjetado)}     sub={`Provisionado + ${(PLANO_JOGOS.b1+PLANO_JOGOS.b2s+PLANO_JOGOS.b2sul)-divulgados.length} jogos a divulgar`} color={T.projetado || "#7C3AED"}  icon={Target} />
          </div>
          <Card T={T}>
            <SectionHeader
              T={T}
              title="Resumo por Categoria"
              subtitle="Visão consolidada por natureza de despesa"
              icon={LayoutDashboard}
              right={
                <div style={{display:"flex",gap:10,fontSize:11,color:T.textMd}}>
                  <Badge color="#6366f1" T={T}>Fixo</Badge>
                  <Badge color="#f43f5e" T={T}>Variável</Badge>
                </div>
              }
            />
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:680}}>
                <thead>
                  <tr style={{background:T.surfaceAlt||T.bg}}>
                    {["Categoria","Tipo","Orçado","Provisionado","Realizado","% Exec.","Progresso"].map(h => (
                      <th key={h} style={{
                        padding:"11px 16px",
                        textAlign:h==="Categoria"||h==="Tipo"?"left":"right",
                        color:T.textSm,
                        fontSize:10,
                        fontWeight:700,
                        letterSpacing:"0.06em",
                        textTransform:"uppercase",
                        whiteSpace:"nowrap",
                        borderBottom:`1px solid ${T.border}`,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RESUMO_CATS.map(c => {
                    const saldo = c.orcado-c.realizado;
                    const pct   = c.orcado ? Math.min(100,(c.realizado/c.orcado)*100) : 0;
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
                        <td style={{padding:"13px 20px",minWidth:120}}>
                          <Progress value={pct} T={T}/>
                        </td>
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

        {/* ── ABAS ── */}
        <Suspense fallback={<div style={{padding:'2rem',textAlign:'center',opacity:.5}}>Carregando…</div>}>
        {tab==="jogos"         && <TabJogos         jogos={jogosCalc} filtrados={filtrados} filtroRod={filtroRod} setFiltroRod={setFiltroRod} filtroCat={filtroCat} setFiltroCat={setFiltroCat} showPlaceholder={showPlaceholder} setShowPlaceholder={setShowPlaceholder} rodadasList={rodadasList} setMicroJogoId={setMicroJogoId} setTab={setTab} setNovo={setNovo} setNovoRapido={setNovoRapido} onDelete={deleteJogo} onEdit={editJogo} T={T}/>}
        {tab==="savings"       && <TabSavings       jogosFiltered={jogosFiltered} divulgados={divulgados} totOrcJogos={totOrcJogos} totProvJogos={totProvJogos} filtroRod={filtroRod} setFiltroRod={setFiltroRod} filtroCat={filtroCat} setFiltroCat={setFiltroCat} rodadasList={rodadasList} T={T}/>}
        {tab==="gráficos"      && <TabGraficos      divulgados={divulgados} notas={notas} dedupeNotasPorNF savingRodada={savingRodada} RESUMO_CATS={RESUMO_CATS} T={T}/>}
        {tab==="micro"         && <VisaoMicro       jogos={jogosCalc} jogoId={microJogoId} onChangeJogo={setMicroJogoId} onSave={saveJogo} T={T}/>}
        {tab==="serviços"      && <TabServicos      servicos={servicosCalc} setServicos={setServicos} T={T}/>}
        {tab==="notas fiscais" && <TabNotas notas={notas} setNotas={setNotas} jogos={jogos} setJogos={setJogos} fornecedores={fornecedores} envios={envios} setEnvios={setEnvios} fornecedoresJogo={fornecedoresJogo} setFornecedoresJogo={setFornecedoresJogo} notasMensais={notasMensais} setNotasMensais={setNotasMensais} onReembolsoCriado={nota => setLogistica(ls => marcarLogisticaReembolsada(ls, nota))} T={T} role={role} dedupeNotasPorNF={true}/>}
        {tab==="mensal" && <TabNotasMensal notas={notasMensais} setNotas={setNotasMensais} fornecedores={fornecedores} servicos={servicosCalc} envios={envios} setEnvios={setEnvios} T={T} role={role} fixos={fixos} setFixos={setFixos} mesInicioCamp={0} mesFimCamp={11} nomeCampeonato="Brasileirão 2026" linkFormulario={`${window.location.origin}${window.location.pathname}#formulario`}/>}
        {tab==="serviços livemode" && <TabLivemode livemode={livemode} setLivemode={setLivemode} notasLivemode={notasLivemode} setNotasLivemode={setNotasLivemode} notasLiveU={notasLiveU} setNotasLiveU={setNotasLiveU} jogos={jogos} fornecedores={fornecedores} T={T} role={role}/>}
        {tab==="logística"     && <TabLogistica logistica={logistica} setLogistica={setLogistica} jogos={jogos} fornecedores={fornecedores} eventosLog={eventosLog} setEventosLog={setEventosLog} notas={notas} setNotas={setNotas} T={T}/>}
        {tab==="apresentações" && <TabApresentacoes jogos={divulgados} servicos={servicosCalc} notasMensais={notasMensais} notas={notas} notasLivemode={notasLivemode} notasLiveU={notasLiveU} dedupeNotasPorNF={true} T={T} apres={apres} setApres={setApres} orcGlobal={10130480} mesInicio={0} nomeCampeonato="Brasileirão 2026"/>}
        {tab==="envio"         && <TabEnvio jogos={jogosCalc} notas={notas} notasMensais={notasMensais} notasLivemode={[...notasLivemode, ...notasLiveU]} servicos={servicosCalc} envios={envios} setEnvios={setEnvios} T={T} enviosKey="envios" role={role} dedupeNotasPorNF={true} agruparReembolsoComLivemode/>}
        {tab==="rastreabilidade" && <TabRastreabilidade notas={notas} notasMensais={notasMensais} servicos={servicosCalc} jogos={jogosCalc} logistica={logistica} notasLivemode={notasLivemode} notasLiveU={notasLiveU} T={T} filtroInicial={filtroRastreabilidade} onClearFiltroInicial={() => setFiltroRastreabilidade(null)} dedupeNotasPorNF={true}/>}
        </Suspense>

      </div>

      {role === 'admin' && showNovo    && <NovoJogoModal   onSave={addJogo} onClose={()=>setNovo(false)} T={T}/>}
      {role === 'admin' && novoRapido  && <NovoRapidoModal cenario={novoRapido} jogos={jogos} onSave={addJogo} onClose={()=>setNovoRapido(null)} T={T}/>}
      {jogoEdit    && <NovoJogoModal   jogo={jogoEdit} onSave={handleEditSave} onClose={()=>setJogoEdit(null)} T={T}/>}

      </div>{/* /Main */}
    </div>
  );
}

// ─── TELA DE ACESSO ──────────────────────────────────────────────────────────
function LoadingScreen({ T }) {
  return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <p style={{color:T.textMd,fontSize:14}}>Carregando...</p>
    </div>
  );
}

function FornecedorPage({ T, onSignOut }) {
  return (
    <div className="page-enter" style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Poppins',sans-serif"}}>
      <div style={{width:"100%",maxWidth:440,padding:32,textAlign:"center"}}>
        <div style={{ margin:"0 auto 24px", display:"flex", justifyContent:"center" }}>
          <LivemodeLogo size={56} radius={12}/>
        </div>
        <h1 style={{fontFamily:FONT.display,fontSize:24,fontWeight:700,color:T.text,margin:"0 0 8px",letterSpacing:"-0.005em"}}>Formulário de Fornecedor</h1>
        <p style={{color:T.textMd,fontSize:13,margin:"0 0 28px"}}>Seu acesso é ao formulário externo de cadastro.</p>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <a href="#formulario" style={{
            display:"block",background:T.brand||"#65B32E",color:"#fff",border:"none",borderRadius:7,
            padding:"10px 16px",fontSize:13,fontWeight:500,fontFamily:"'Poppins',sans-serif",textDecoration:"none",
          }}>Formulário — Brasileirão</a>
          <a href="#formulario-paulistao" style={{
            display:"block",background:T.surface||T.card,color:T.text,
            border:`1px solid ${T.border}`,borderRadius:7,
            padding:"10px 16px",fontSize:13,fontWeight:500,fontFamily:"'Poppins',sans-serif",textDecoration:"none",
          }}>Formulário — Paulistão F</a>
        </div>
        <button onClick={onSignOut} style={{
          marginTop:24,background:"transparent",border:`1px solid ${T.border}`,
          color:T.textMd,borderRadius:7,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"'Poppins',sans-serif",
        }}>Sair</button>
      </div>
    </div>
  );
}

const ENTIDADES = ENTIDADES_VISUALIZADOR;

function LoginGate({ T, authError, setAuthError }) {
  const [modo, setModo]         = useState("login"); // "login" | "cadastro"
  // Config pública (texto LGPD + entidades extras) antes do login — RLS libera só essas chaves ao anon
  const [, setCfgTick] = useState(0);
  useEffect(() => { carregarConfig().then(() => setCfgTick(t => t + 1)).catch(() => {}); }, []);
  const [nome, setNome]         = useState("");
  const [funcao, setFuncao]     = useState("");
  const [entidade, setEntidade] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [erro, setErro]         = useState("");
  const [sucesso, setSucesso]   = useState("");
  const [lgpdConsent, setLgpdConsent] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const reset = (m) => { setModo(m); setErro(""); setSucesso(""); setAuthError(""); setEmail(""); setPassword(""); setEntidade(""); setNome(""); setFuncao(""); setLgpdConsent(false); };

  const handleSubmit = async e => {
    e.preventDefault();
    setErro(""); setAuthError(""); setSucesso("");
    if (modo === "cadastro") {
      if (!entidade) { setErro("Selecione a entidade antes de continuar."); return; }
      if (password.length < 8) { setErro("Senha deve ter no mínimo 8 caracteres."); return; }
      if (!/[A-Z]/.test(password)) { setErro("Senha deve ter pelo menos 1 letra maiúscula."); return; }
      if (!/[^A-Za-z0-9]/.test(password)) { setErro("Senha deve ter pelo menos 1 caractere especial."); return; }
      if (!lgpdConsent) { setErro("Aceite a Política de Privacidade para continuar."); return; }
    }
    setLoading(true);
    if (modo === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setErro(error.message || "Credenciais inválidas"); setLoading(false); }
    } else {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { nome, funcao, entidade, lgpd_consent: true, lgpd_consent_at: new Date().toISOString() } },
      });
      if (error) { setErro(error.message || "Erro ao criar conta"); setLoading(false); }
      else { setSucesso("Cadastro enviado! Aguarde a aprovação de um administrador para acessar o hub."); setLoading(false); }
    }
  };

  const handleGoogleLogin = async () => {
    setErro(""); setAuthError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { hd: 'livemode.com' } },
    });
    if (error) setErro(error.message);
  };

  const anyError = authError || erro;
  const inputStyle = {
    width:"100%", boxSizing:"border-box", marginBottom:10,
    background:T.surface||T.card, border:`1px solid ${anyError ? (T.danger||"#DC2626") : T.borderStrong||T.muted||T.border}`,
    borderRadius:8, padding:"12px 16px", fontSize:14, color:T.text,
    fontFamily:"'Poppins',sans-serif", outline:"none",
  };

  return (
    <div className="page-enter" style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Poppins',sans-serif"}}>
      <div style={{width:"100%",maxWidth:400,padding:32}}>
        <div style={{ margin:"0 auto 24px", display:"flex", justifyContent:"center" }}>
          <LivemodeLogo size={56} radius={12}/>
        </div>
        <h1 style={{textAlign:"center",fontFamily:FONT.display,fontSize:26,fontWeight:700,color:T.text,margin:"0 0 6px",letterSpacing:"-0.005em"}}>HUB FINANCEIRO</h1>

        {/* Tabs */}
        <div style={{display:"flex",background:T.surface||T.card,border:`1px solid ${T.border}`,borderRadius:9,padding:3,margin:"16px 0 24px",gap:3}}>
          {[["login","Entrar"],["cadastro","Criar conta"]].map(([m,l]) => (
            <button key={m} onClick={() => reset(m)} style={{
              flex:1, padding:"7px", borderRadius:7, border:"none", cursor:"pointer",
              fontFamily:"'Poppins',sans-serif", fontSize:13, fontWeight:500,
              background: modo===m ? (T.brand||"#65B32E") : "transparent",
              color: modo===m ? "#fff" : T.textMd,
              transition:"all 0.15s",
            }}>{l}</button>
          ))}
        </div>

        {sucesso ? (
          <div style={{textAlign:"center",padding:"24px 0"}}>
            <p style={{color:T.brand||"#65B32E",fontSize:14,fontWeight:500,margin:"0 0 16px",lineHeight:1.6}}>{sucesso}</p>
            <button onClick={() => reset("login")} style={{
              background:"transparent",border:`1px solid ${T.border}`,color:T.textMd,
              borderRadius:7,padding:"8px 20px",fontSize:12,cursor:"pointer",fontFamily:"'Poppins',sans-serif",
            }}>Voltar ao login</button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit}>
              {modo === "cadastro" && (
                <div style={{marginBottom:10}}>
                  <p style={{fontSize:11,fontWeight:600,color:T.textMd,letterSpacing:"0.06em",textTransform:"uppercase",margin:"0 0 8px",fontFamily:"'Poppins',sans-serif"}}>Entidade</p>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {ENTIDADES.map(en => (
                      <label key={en.id} style={{
                        display:"flex", alignItems:"center", gap:10,
                        padding:"10px 14px", borderRadius:8, cursor:"pointer",
                        border:`1px solid ${entidade===en.id ? (T.brand||"#65B32E") : T.border}`,
                        background: entidade===en.id ? (T.brandSoft||"rgba(101,179,46,0.07)") : (T.surface||T.card),
                        transition:"all 0.15s",
                      }}>
                        <input type="radio" name="entidade" value={en.id} checked={entidade===en.id} onChange={() => setEntidade(en.id)} style={{accentColor:T.brand||"#65B32E"}}/>
                        <span style={{fontSize:13,color:T.text,fontFamily:"'Poppins',sans-serif",fontWeight: entidade===en.id ? 600 : 400}}>{en.label}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{height:1,background:T.border,margin:"14px 0 10px"}}/>
                </div>
              )}
              {modo === "cadastro" && <>
                <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo *" required style={inputStyle}/>
                <input type="text" value={funcao} onChange={e => setFuncao(e.target.value)} placeholder="Função (ex: Contador, Diretor Financeiro)" style={inputStyle}/>
              </>}
              <input type="email" value={email} onChange={e => { setEmail(e.target.value); setAuthError(""); }} placeholder="E-mail" autoFocus={modo==="login"} required style={inputStyle}/>
              <input type="password" value={password} onChange={e => { setPassword(e.target.value); setAuthError(""); }} placeholder={modo==="cadastro" ? "Criar senha" : "Senha"} required style={{...inputStyle, marginBottom:0}}/>
              {modo === "cadastro" && (
                <label style={{display:"flex",alignItems:"flex-start",gap:10,marginTop:12,cursor:"pointer"}}>
                  <input type="checkbox" checked={lgpdConsent} onChange={e => setLgpdConsent(e.target.checked)} style={{marginTop:2,accentColor:T.brand||"#65B32E",flexShrink:0}}/>
                  <span style={{fontSize:12,color:T.textMd,fontFamily:"'Poppins',sans-serif",lineHeight:1.5}}>
                    Li e aceito a{" "}
                    <button type="button" onClick={() => setShowPrivacy(true)} style={{background:"none",border:"none",color:T.brand||"#65B32E",cursor:"pointer",fontSize:12,padding:0,fontFamily:"'Poppins',sans-serif",fontWeight:500,textDecoration:"underline"}}>
                      Política de Privacidade
                    </button>
                    {" "}e consinto com o tratamento dos meus dados (LGPD).
                  </span>
                </label>
              )}
              {anyError && <p style={{color:T.danger||"#DC2626",fontSize:12,textAlign:"center",margin:"8px 0 0",fontWeight:500}}>{anyError}</p>}
              <button type="submit" disabled={loading} style={{
                width:"100%",marginTop:16,background:T.brand||"#65B32E",
                color:"#fff",border:"none",borderRadius:7,padding:"10px",height:38,
                cursor:loading?"not-allowed":"pointer",fontWeight:500,fontSize:13,fontFamily:"'Poppins',sans-serif",
                opacity:loading?0.7:1,
              }}>{loading ? (modo==="cadastro" ? "Criando..." : "Entrando...") : (modo==="cadastro" ? "Criar conta" : "Entrar")}</button>
            </form>

            {modo === "login" && <>
              <div style={{display:"flex",alignItems:"center",gap:10,margin:"18px 0"}}>
                <div style={{flex:1,height:1,background:T.border}}/>
                <span style={{color:T.textSm,fontSize:11,whiteSpace:"nowrap",fontFamily:"'Poppins',sans-serif"}}>ou</span>
                <div style={{flex:1,height:1,background:T.border}}/>
              </div>
              <button type="button" onClick={handleGoogleLogin} style={{
                width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:10,
                background:"#fff",color:"#3c4043",border:"1px solid #dadce0",borderRadius:7,
                padding:"9px 16px",height:38,cursor:"pointer",fontWeight:500,fontSize:13,
                fontFamily:"'Poppins',sans-serif",boxShadow:"0 1px 2px rgba(60,64,67,0.12)",transition:"box-shadow 0.15s",
              }}
                onMouseEnter={e => e.currentTarget.style.boxShadow="0 2px 6px rgba(60,64,67,0.2)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow="0 1px 2px rgba(60,64,67,0.12)"}
              >
                <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#EA4335" d="M24 9.5c3.1 0 5.9 1.1 8.1 2.9l6-6C34.5 3.1 29.5 1 24 1 14.8 1 7 6.6 3.4 14.4l7 5.4C12.2 13.6 17.6 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 2.9-2.2 5.4-4.6 7.1l7.1 5.5c4.2-3.9 6.3-9.6 6.3-16.6z"/>
                  <path fill="#FBBC05" d="M10.4 28.2A14.6 14.6 0 0 1 9.5 24c0-1.5.2-2.9.5-4.2l-7-5.4A23 23 0 0 0 1 24c0 3.7.9 7.2 2.5 10.3l6.9-6.1z"/>
                  <path fill="#34A853" d="M24 47c5.4 0 10-1.8 13.3-4.8l-7.1-5.5c-1.9 1.3-4.3 2-6.2 2-6.4 0-11.8-4.3-13.6-10.1l-6.9 6.1C7 40.5 14.8 47 24 47z"/>
                </svg>
                Entrar com Google
              </button>
            </>}
          </>
        )}

        <p style={{textAlign:"center",color:T.textSm,fontSize:10,margin:"24px 0 0",letterSpacing:"0.08em",textTransform:"uppercase"}}>
          Livemode · Transmissões · 2026
        </p>
      </div>
      {showPrivacy && (
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
          onClick={() => setShowPrivacy(false)}>
          <div style={{background:T.surface||T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:28,width:"100%",maxWidth:500,maxHeight:"80vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}
            onClick={e => e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{margin:0,fontFamily:FONT.display,fontSize:18,fontWeight:700,color:T.text}}>Política de Privacidade</h3>
              <button onClick={() => setShowPrivacy(false)} style={{background:"none",border:"none",cursor:"pointer",color:T.textMd,fontSize:20,lineHeight:1,padding:4}}>✕</button>
            </div>
            <div style={{fontSize:13,color:T.textMd,lineHeight:1.7,fontFamily:"'Poppins',sans-serif",display:"flex",flexDirection:"column",gap:10}}>
              <p style={{margin:0}}><strong style={{color:T.text}}>Controlador:</strong> Livemode Transmissões Ltda.</p>
              <p style={{margin:0}}><strong style={{color:T.text}}>Contato DPO:</strong> <a href="mailto:privacidade@livemode.com" style={{color:T.brand||"#65B32E"}}>privacidade@livemode.com</a></p>
              <p style={{margin:0}}><strong style={{color:T.text}}>Base legal:</strong> consentimento do titular (Art. 7º, I — Lei 13.709/2018 LGPD).</p>
              {/* Itens editáveis em Administração → Configurações (portal_settings.lgpd) */}
              {((getConfig('lgpd')?.itens || []).length ? getConfig('lgpd').itens : [
                { titulo: 'Dados coletados', texto: 'nome completo, e-mail, função e entidade vinculada.' },
                { titulo: 'Finalidade', texto: 'controle de acesso ao HUB Financeiro Livemode.' },
                { titulo: 'Retenção', texto: 'dados mantidos enquanto a conta estiver ativa; removidos permanentemente após exclusão.' },
                { titulo: 'Seus direitos (Art. 18 LGPD)', texto: 'acesso, correção, exclusão, portabilidade e revogação do consentimento — solicite a privacidade@livemode.com.' },
                { titulo: 'Segurança', texto: 'dados armazenados com criptografia em repouso e em trânsito (TLS 1.2+), com controle de acesso baseado em perfis.' },
              ]).map((it, i) => (
                <p key={i} style={{margin:0}}><strong style={{color:T.text}}>{it.titulo}:</strong> {it.texto}</p>
              ))}
            </div>
            <button onClick={() => setShowPrivacy(false)} style={{marginTop:20,width:"100%",background:T.brand||"#65B32E",color:"#fff",border:"none",borderRadius:8,padding:"10px",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'Poppins',sans-serif"}}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
import AdminUsuarios from "./components/AdminUsuarios";
import FormularioPublico from "./components/FormularioPublico";
import FormularioPublicoPaulistao from "./components/FormularioPublicoPaulistao";
import EnvioPublico from "./components/EnvioPublico";
import HubFornecedores from "./components/HubFornecedores";
import HubOrcamentos from "./components/HubOrcamentos";
import Paulistao from "./components/Paulistao";
import CampeonatoCustom from "./components/CampeonatoCustom";
import { NovoCampeonatoModal } from "./components/modals/NovoCampeonatoModal";
import { REGISTRY_KEY } from "./data/customCampeonato";
import { ENTIDADES_VISUALIZADOR, podeVerCampeonato } from "./config/entities";
import { ORC_REGISTRY_KEY, podeVerOrcamento } from "./data/orcamentos";
import { logAcao, descreverPagina } from "./lib/audit";
import { carregarConfig, getConfig } from "./lib/portalConfig";

// Perfil + time: a entidade individual do perfil vence; sem ela, vale a do
// time (teams.entidades). Módulos transversais liberados ao visualizador vêm
// do time (teams.modulos); sem time, só Orçamentos.
const PERFIL_SELECT = 'role, entidade, team_id, teams ( nome, entidades, modulos, escopo )';
const perfilEfetivo = (data) => {
  const team = data?.teams || null;
  const entidade = data?.entidade || (team?.entidades?.length ? team.entidades.join(',') : null);
  const modulos = team ? (team.modulos || []) : ['orcamentos'];
  // escopo do visualizador dentro dos campeonatos: 'notas' (só NF + Relatório) ou 'completo' (todo o hub em leitura)
  const escopo = team?.escopo === 'completo' ? 'completo' : 'notas';
  return { role: data?.role ?? 'visualizador', entidade, modulos, escopo, teamNome: team?.nome || null };
};
import { getState as getStateSb, setState as setStateSb } from "./lib/supabase";

function PendentePage({ T, onSignOut }) {
  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Poppins',sans-serif" }}>
      <div style={{ width:"100%", maxWidth:420, padding:32, textAlign:"center" }}>
        <div style={{ margin:"0 auto 24px", display:"flex", justifyContent:"center" }}>
          <LivemodeLogo size={56} radius={12}/>
        </div>
        <h1 style={{ fontFamily:FONT.display, fontSize:22, fontWeight:700, color:T.text, margin:"0 0 10px", letterSpacing:"-0.005em" }}>Acesso pendente</h1>
        <p style={{ color:T.textMd, fontSize:13, margin:"0 0 28px", lineHeight:1.6 }}>
          Seu cadastro foi recebido. Um administrador precisa aprovar e definir seu perfil de acesso antes de você entrar.
        </p>
        <button onClick={onSignOut} style={{
          background:"transparent", border:`1px solid ${T.border}`,
          color:T.textMd, borderRadius:7, padding:"9px 20px",
          fontSize:12, cursor:"pointer", fontFamily:"'Poppins',sans-serif",
        }}>Sair</button>
      </div>
    </div>
  );
}

function RoleTestWidget({ roleOverride, entOverride, escOverride, onOverride, T }) {
  const [open, setOpen] = useState(false);
  // Opções de teste: visualizador simula também a entidade (independe da
  // entidade do admin logado); fornecedor não tem entidade.
  const OPTIONS = [
    { role: 'visualizador', ent: 'brasileirao-2026',        label: 'Visualizador — FFU' },
    { role: 'visualizador', ent: 'paulistao-feminino-2026', label: 'Visualizador — FPF' },
    { role: 'visualizador', ent: 'outro',                   label: 'Visualizador — Outro' },
    { role: 'visualizador', ent: 'outro', esc: 'completo',  label: 'Visualizador — Livemode (hub completo)' },
    { role: 'fornecedor',   ent: null,                      label: 'Fornecedor' },
  ];
  if (roleOverride) {
    const atual = OPTIONS.find(o => o.role === roleOverride && o.ent === entOverride && (o.esc || null) === (escOverride || null));
    return (
      <div style={{ position:'fixed', bottom:16, right:16, zIndex:9999, background:'#F59E0B', color:'#000', borderRadius:8, padding:'6px 14px', fontSize:12, fontWeight:600, fontFamily:"'Poppins',sans-serif", display:'flex', alignItems:'center', gap:10, boxShadow:'0 2px 12px rgba(0,0,0,0.3)' }}>
        Testando: {atual?.label || roleOverride}
        <button onClick={() => onOverride(null, null)} style={{ background:'none', border:'none', cursor:'pointer', fontWeight:700, fontSize:16, lineHeight:1, color:'#000', padding:0 }}>×</button>
      </div>
    );
  }
  return (
    <div style={{ position:'fixed', bottom:16, right:16, zIndex:9999 }}>
      <button onClick={() => setOpen(o => !o)} style={{ background:T.surface||T.card, border:`1px solid ${T.border}`, color:T.textMd, borderRadius:8, padding:'6px 12px', fontSize:11, cursor:'pointer', fontFamily:"'Poppins',sans-serif", boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }}>
        Testar como ▾
      </button>
      {open && (
        <div style={{ position:'absolute', bottom:'calc(100% + 6px)', right:0, background:T.card||T.surface, border:`1px solid ${T.border}`, borderRadius:8, overflow:'hidden', minWidth:190, boxShadow:'0 4px 16px rgba(0,0,0,0.3)' }}>
          {OPTIONS.map(o => (
            <button key={o.label} onClick={() => { onOverride(o.role, o.ent, o.esc || null); setOpen(false); }} style={{ display:'block', width:'100%', padding:'9px 14px', background:'none', border:'none', color:T.text, fontSize:12, cursor:'pointer', textAlign:'left', fontFamily:"'Poppins',sans-serif" }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [darkMode, setDarkMode] = useState(() => lsGet(LS_DARK, true));
  const [pagina,   setPagina]   = useState("home");
  const [hubFiltro, setHubFiltro] = useState("todos"); // filtro pré-aplicado ao abrir o Hub de Fornecedores
  const [user,        setUser]        = useState(null);
  const [role,        setRole]        = useState(null);
  const [entidade,    setEntidade]    = useState(null);
  const [modulos,     setModulos]     = useState(['orcamentos']);   // módulos liberados ao visualizador (do time)
  const [escopo,      setEscopo]      = useState('notas');          // 'notas' | 'completo' (do time)
  const [authLoading, setAuthLoading] = useState(true);
  const [customCampeonatos, setCustomCampeonatos] = useState([]);
  const [orcamentos, setOrcamentos] = useState([]);   // espelho do orc_registry p/ a Home
  const [showNovoCampModal, setShowNovoCampModal] = useState(false);
  const [authError, setAuthError] = useState("");
  const [roleError, setRoleError] = useState(false);
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  const [roleOverride, setRoleOverride] = useState(null);
  const [entOverride,  setEntOverride]  = useState(null); // entidade simulada no "Testar como"
  const [escOverride,  setEscOverride]  = useState(null); // escopo simulado ('completo' = hub inteiro em leitura)
  const T = darkMode ? DARK : LIGHT;

  useEffect(() => {
    let mounted = true;

    const loadRole = (userId) => {
      // Timeout: se o backend não responder (projeto pausado/outage), mostra a
      // tela de erro com "Tentar novamente" em vez de "Carregando..." eterno.
      const query = supabase.from('profiles').select(PERFIL_SELECT).eq('id', userId).single();
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000));
      Promise.race([query, timeout])
        .then(({ data }) => {
          if (mounted) {
            const p = perfilEfetivo(data);
            setRole(p.role); setEntidade(p.entidade); setModulos(p.modulos); setEscopo(p.escopo);
          }
        })
        .catch(err => {
          if (!mounted) return;
          if (err?.message === 'timeout') { setRoleError(true); return; }
          setRole('visualizador'); setEntidade(null);
        });
    };

    // IMPORTANTE: nenhuma chamada ao client supabase (query ou signOut) pode
    // rodar DIRETO dentro deste callback. O supabase-js segura um lock interno
    // de auth enquanto o onAuthStateChange executa, e qualquer query/signOut
    // espera esse mesmo lock — deadlock: a query de profiles nunca resolve,
    // `role` fica null e o hub trava no "Carregando..." pra sempre (pior ainda,
    // o lock preso pendura TODOS os getState seguintes). O setTimeout(0) deixa
    // o callback terminar e liberar o lock antes de tocar no client.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (session?.user) {
        // Login Google só para os domínios configurados (Administração → Configurações)
        const googleDoms = (getConfig('signup')?.google_dominios || ['livemode.com']).map(d => String(d).toLowerCase());
        const domUser = String(session.user.email || '').split('@')[1]?.toLowerCase();
        if (session.user.app_metadata?.provider === 'google' && googleDoms.length > 0 && !googleDoms.includes(domUser)) {
          setTimeout(() => supabase.auth.signOut(), 0);
          setAuthError(`Acesso restrito a contas ${googleDoms.map(d => '@' + d).join(', ')}`);
          setAuthLoading(false);
          return;
        }
        setUser(session.user);
        setAuthLoading(false);
        const userId = session.user.id;
        setTimeout(() => loadRole(userId), 0);
      } else {
        setUser(null); setRole(null); setAuthLoading(false);
      }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const signOut = async () => { await logAcao('logout'); await supabase.auth.signOut(); };
  useSessionTimeout(signOut, !!user);

  // Rede de segurança: visualizador (real ou simulado no "Testar como") nunca
  // grava — setters otimistas e gravações viram no-op no client (lib/supabase).
  useEffect(() => { setModoLeitura((roleOverride ?? role) === 'visualizador'); }, [role, roleOverride]);

  // Audit log de navegação: registra a tela aberta (campeonato, orçamento,
  // módulo, admin). A mesma tela não repete em menos de 60s; a Home não conta.
  const ultimaTelaRef = useRef({ pagina: null, at: 0 });
  useEffect(() => {
    if (!user || !pagina || pagina === 'home') return;
    const agora = Date.now();
    if (ultimaTelaRef.current.pagina === pagina && agora - ultimaTelaRef.current.at < 60000) return;
    ultimaTelaRef.current = { pagina, at: agora };
    const d = descreverPagina(pagina, { customCampeonatos, orcamentos });
    logAcao('page_view', { pagina, tipo: d.tipo, id: d.id || null, label: d.label });
  }, [pagina, user?.id]);

  useEffect(() => {
    const onHash = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Deslogado automaticamente se o admin apagar o perfil; role/entidade
  // atualizam ao vivo quando alterados no painel (antes só valiam no relogin —
  // era por isso que trocar a entidade pra FPF não refletia nos cards).
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`profile-changes-${user.id}`)
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        () => supabase.auth.signOut()
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        () => {
          // Refaz a leitura com o time (o payload do realtime não traz o join)
          supabase.from('profiles').select(PERFIL_SELECT).eq('id', user.id).single()
            .then(({ data }) => { const p = perfilEfetivo(data); setRole(p.role); setEntidade(p.entidade); setModulos(p.modulos); setEscopo(p.escopo); })
            .catch(() => {});
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // Carrega o registry de campeonatos custom uma vez ao logar.
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    getStateSb(REGISTRY_KEY).then(arr => {
      if (mounted && Array.isArray(arr)) setCustomCampeonatos(arr);
    });
    return () => { mounted = false; };
  }, [user]);

  // Configurações do portal (entidades extras, cadastro, LGPD, retenção): carrega
  // ao logar e mantém realtime; entidades extras entram na lista global.
  useEffect(() => { if (user) carregarConfig().catch(() => {}); }, [user?.id]);

  // Registry de orçamentos (orc_registry): alimenta os cards de "Orçamentos"
  // na Home — leitura + realtime; a escrita fica toda no HubOrcamentos.
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    getStateSb(ORC_REGISTRY_KEY).then(arr => {
      if (mounted && Array.isArray(arr)) setOrcamentos(arr);
    }).catch(() => {});
    const channel = supabase
      .channel("home_orc_registry")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_state", filter: `key=eq.${ORC_REGISTRY_KEY}` }, payload => {
        if (mounted && Array.isArray(payload.new?.value)) setOrcamentos(payload.new.value);
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [user]);

  const criarCampeonato = async ({ config, jogos, servicos }) => {
    // 1) Persiste estado inicial dos buckets do novo campeonato
    await Promise.all([
      setStateSb(`${config.id}_jogos`, jogos),
      setStateSb(`${config.id}_servicos`, servicos || []),
      setStateSb(`${config.id}_notas`, []),
      setStateSb(`${config.id}_notas_mensais`, []),
      setStateSb(`${config.id}_envios`, []),
      setStateSb(`${config.id}_livemode`, []),
      setStateSb(`${config.id}_notas_livemode`, []),
      setStateSb(`${config.id}_logistica`, []),
      setStateSb(`${config.id}_eventos_log`, []),
      setStateSb(`${config.id}_fornecedores_jogo`, {}),
    ]);
    // 2) Atualiza o registry global
    const next = [...customCampeonatos.filter(c => c.id !== config.id), config];
    setCustomCampeonatos(next);
    await setStateSb(REGISTRY_KEY, next);
    // 3) Fecha modal e navega
    setShowNovoCampModal(false);
    setPagina(`custom:${config.id}`);
  };

  const excluirCampeonato = async (id) => {
    const next = customCampeonatos.filter(c => c.id !== id);
    setCustomCampeonatos(next);
    await setStateSb(REGISTRY_KEY, next);
    // Os dados (`${id}_*`) ficam no Supabase para auditoria; podem ser limpos pelo painel.
  };

  const toggleDark = v => {
    const next = typeof v === "function" ? v(darkMode) : v;
    setDarkMode(next); lsSet(LS_DARK, next);
  };

  // Abre o Hub com filtro pré-aplicado (usado por shortcut de dentro de um campeonato)
  const abrirHubFornecedores = (filtro = "todos") => {
    setHubFiltro(filtro);
    setPagina("hub-fornecedores");
  };

  // Rotas públicas — acessíveis sem autenticação
  if (currentHash === "#formulario") return <FormularioPublico/>;
  if (currentHash === "#formulario-paulistao") return <FormularioPublicoPaulistao/>;
  const envioMatch = currentHash.match(/^#envio\/(.+)$/);
  if (envioMatch) return <EnvioPublico envioRef={envioMatch[1]}/>;

  // Auth loading
  if (authLoading) return <LoadingScreen T={T}/>;

  // Tela de login para o HUB
  if (!user) return <LoginGate T={T} authError={authError} setAuthError={setAuthError}/>;

  // Backend não respondeu ao carregar o perfil (projeto Supabase pausado/outage)
  if (role === null && roleError) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,padding:24,textAlign:"center"}}>
      <p style={{color:T.textMd,fontSize:15,maxWidth:420,lineHeight:1.6}}>O servidor não está respondendo. Verifique o status do projeto no painel do Supabase e tente de novo.</p>
      <button onClick={() => window.location.reload()} style={{...btnStyle,background:"#65B32E"}}>Tentar novamente</button>
    </div>
  );

  // Aguarda role carregar (query de profiles é não-bloqueante)
  if (role === null) return <LoadingScreen T={T}/>;

  // Pendente — aguarda aprovação do admin
  if (role === 'pendente') return <PendentePage T={T} onSignOut={signOut}/>;

  const effectiveRole     = roleOverride ?? role;
  const effectiveEntidade = roleOverride ? (entOverride ?? entidade) : entidade;
  const effectiveEscopo   = roleOverride ? (escOverride ?? 'notas') : escopo;

  const roleWidget = role === 'admin' && (
    <RoleTestWidget roleOverride={roleOverride} entOverride={entOverride} escOverride={escOverride} onOverride={(r, ent, esc) => { setRoleOverride(r); setEntOverride(ent ?? null); setEscOverride(esc ?? null); setPagina("home"); }} T={T}/>
  );

  // Fornecedor — só acessa formulário externo
  if (effectiveRole === 'fornecedor') return <>{<FornecedorPage T={T} onSignOut={roleOverride ? () => { setRoleOverride(null); setEntOverride(null); } : signOut}/>}{roleWidget}</>;

  // Visualizador não acessa o Hub de Fornecedores; Orçamentos ele acessa
  // filtrado pela entidade (só-leitura), como nos campeonatos.
  // Módulos do time (teams.modulos) decidem o que o visualizador abre.
  const moduloLiberado = (m) => effectiveRole !== 'visualizador' || (modulos || []).includes(m);
  const paginaEfetiva =
    (pagina === 'hub-fornecedores' && !moduloLiberado('fornecedores')) ? 'home'
    : ((pagina === 'hub-orcamentos' || pagina?.startsWith('orc:')) && !moduloLiberado('orcamentos')) ? 'home'
    : pagina;

  // Bloqueio por entidade para visualizador (aceita múltiplas separadas por vírgula)
  const podeVerCamp = (campId, organizador = null) =>
    podeVerCampeonato(effectiveRole, effectiveEntidade, campId, organizador);

  if(paginaEfetiva==="brasileirao-2026") {
    if (!podeVerCamp('brasileirao-2026')) { setPagina("home"); return null; }
    return <>{<Brasileirao onBack={()=>setPagina("home")} onOpenHub={abrirHubFornecedores} T={T} darkMode={darkMode} setDarkMode={toggleDark} role={effectiveRole} escopo={effectiveEscopo} onSignOut={signOut}/>}{roleWidget}</>;
  }
  if(paginaEfetiva==="paulistao-feminino-2026") {
    if (!podeVerCamp('paulistao-feminino-2026')) { setPagina("home"); return null; }
    return <>{<Paulistao onBack={()=>setPagina("home")} onOpenHub={abrirHubFornecedores} T={T} darkMode={darkMode} setDarkMode={toggleDark} role={effectiveRole} escopo={effectiveEscopo} onSignOut={signOut}/>}{roleWidget}</>;
  }
  if(paginaEfetiva?.startsWith("custom:")) {
    const id = paginaEfetiva.slice(7);
    const config = customCampeonatos.find(c => c.id === id);
    if (config && !podeVerCamp(config.id, config.organizador)) { setPagina("home"); return null; }
    if (config) return <>{<CampeonatoCustom config={config} onBack={()=>setPagina("home")} onOpenHub={abrirHubFornecedores} T={T} darkMode={darkMode} setDarkMode={toggleDark} role={effectiveRole} escopo={effectiveEscopo}/>}{roleWidget}</>;
    setPagina("home");
    return null;
  }
  if(paginaEfetiva==="hub-fornecedores") return <>{<HubFornecedores onBack={()=>setPagina("home")} filtroInicial={hubFiltro} T={T} darkMode={darkMode} setDarkMode={toggleDark} role={effectiveRole}/>}{roleWidget}</>;
  if(paginaEfetiva==="hub-orcamentos" || paginaEfetiva?.startsWith("orc:")) {
    // "orc:<id>" = card de orçamento da Home → abre o Hub já no orçamento (com trava por entidade)
    const orcId = paginaEfetiva.startsWith("orc:") ? paginaEfetiva.slice(4) : null;
    if (orcId) {
      const reg = orcamentos.find(r => r.id === orcId);
      if (reg && !podeVerOrcamento(effectiveRole, effectiveEntidade, reg.organizador)) { setPagina("home"); return null; }
    }
    return <>{<HubOrcamentos key={orcId || "lista"} onBack={()=>setPagina("home")} onEnter={setPagina} T={T} darkMode={darkMode} setDarkMode={toggleDark} role={effectiveRole} entidade={effectiveEntidade} initialId={orcId} user={user} onCriarCampeonato={criarCampeonato} customCampeonatos={customCampeonatos}/>}{roleWidget}</>;
  }
  if(paginaEfetiva==="admin-usuarios" && role==='admin') return <AdminUsuarios onBack={()=>setPagina("home")} T={T} darkMode={darkMode} setDarkMode={toggleDark} onSignOut={signOut} currentUser={user}/>;
  return (
    <>
      <Home
        onEnter={setPagina}
        onOpenHub={abrirHubFornecedores}
        T={T} darkMode={darkMode} setDarkMode={toggleDark}
        customCampeonatos={customCampeonatos}
        orcamentos={orcamentos}
        role={effectiveRole}
        entidade={effectiveEntidade}
        onSignOut={signOut}
        onCriarCampeonato={effectiveRole === 'admin' ? ()=>setShowNovoCampModal(true) : undefined}
        onExcluirCampeonato={effectiveRole === 'admin' ? excluirCampeonato : undefined}
      />
      {role === 'admin' && showNovoCampModal && (
        <NovoCampeonatoModal
          T={T}
          onClose={()=>setShowNovoCampModal(false)}
          onSave={criarCampeonato}
        />
      )}
      {roleWidget}
    </>
  );
}
