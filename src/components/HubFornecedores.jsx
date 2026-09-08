import { useState, useEffect, useMemo, useRef } from "react";
import { RADIUS, FONT, CAMPEONATOS } from "../constants";
import { REGISTRY_KEY } from "../data/customCampeonato";
import { getState, setState as setSupabaseState, supabase, createPersistedSetter, isPersistPending } from "../lib/supabase";
import { FORNECEDORES_INIT } from "../data/fornecedores";
import { COTACAO_INIT } from "../data/negociacoes";
import { contarCelulasPreenchidas } from "../data/catalogos";
import { CIDADES_INIT, CAMPEONATOS_FORN_INIT, ITENS_MASTER_INIT } from "../data/catalogos";
import { JOGOS_FORN_INIT } from "../data/jogosFornecedores";
import { ALL_JOGOS } from "../data";
import { fmt, fmtK } from "../utils";
import { Stat, Badge, IconButton } from "./ui";
import LivemodeLogo from "./LivemodeLogo";
import {
  ArrowLeft, Eye, EyeOff, Sun, Moon, Users,
  Handshake, Wallet, Building2, Trophy, Globe2,
} from "lucide-react";
import TabFornecedores from "./tabs/TabFornecedores";

// Filtro global: "todos" ou id de um campeonato
const FILTRO_TODOS = "todos";

export default function HubFornecedores({ onBack, T, darkMode, setDarkMode, filtroInicial, role = 'admin' }) {
  const modoLeitura = role === 'visualizador';   // time com módulo liberado: vê tudo, não edita
  const [fornecedores, setFornecedoresRaw] = useState(FORNECEDORES_INIT);
  const [cotacoes,     setCotacoesRaw]     = useState(COTACAO_INIT);
  const [jogos,        setJogosRaw]        = useState(ALL_JOGOS);
  const [jogosForn,    setJogosFornRaw]    = useState(JOGOS_FORN_INIT);
  const [cidades,      setCidadesRaw]      = useState(CIDADES_INIT);
  const [campeonatos,  setCampeonatosRaw]  = useState(CAMPEONATOS_FORN_INIT);
  const [itensMaster,  setItensMasterRaw]  = useState(ITENS_MASTER_INIT);
  const [tabelas,      setTabelasRaw]      = useState([]);
  const [loading,      setLoading]         = useState(true);
  const [loadError,    setLoadError]       = useState(null);
  const [ocultar,      setOcultar]         = useState(false);
  const [filtroCamp,   setFiltroCamp]      = useState(filtroInicial || FILTRO_TODOS);
  // Cada setter relê o valor atual do Supabase antes de gravar de volta (ver
  // createPersistedSetter em lib/supabase.js) — 'fornecedores'/'cotacoes' são
  // compartilhados com Brasileirão/Paulistão, então uma edição feita aqui não
  // pode se basear num `prev` local desatualizado em relação à outra aba.
  // Também usado pelo handler de realtime abaixo pra não sobrescrever uma
  // edição local em andamento com um eco desatualizado (isPersistPending).
  const persistRefs = useRef({}).current;

  // Carga inicial + realtime
  useEffect(() => {
    async function load() {
      try {
        const [f, c, j, ci, ca, im, tb, jf, reg] = await Promise.all([
          getState('fornecedores'),
          getState('cotacoes'),
          getState('jogos'),
          getState('forn_cidades'),
          getState('forn_campeonatos'),
          getState('forn_itens_master'),
          getState('forn_tabelas_preco'),
          getState('forn_jogos'),
          getState(REGISTRY_KEY),
        ]);
        if (f)  setFornecedoresRaw(f);
        if (c)  setCotacoesRaw(c);
        if (j)  setJogosRaw(j);
        if (ci) setCidadesRaw(ci);     else setSupabaseState('forn_cidades', CIDADES_INIT);

        // Catálogos de campeonato são puxados dos campeonatos do HUB (fixos +
        // customizados): garante uma entrada por campeonato e mantém o nome em
        // sincronia. Cidades/categorias/itens continuam configurados aqui.
        let camps = ca || CAMPEONATOS_FORN_INIT;
        let campsMudou = !ca;
        // migração: id legado do Paulistão F criado manualmente antes do sync
        if (camps.some(x => x.id === 'paulistao-f-2026') && !camps.some(x => x.id === 'paulistao-feminino-2026')) {
          camps = camps.map(x => x.id === 'paulistao-f-2026' ? { ...x, id: 'paulistao-feminino-2026' } : x);
          campsMudou = true;
        }
        const hubCamps = [
          ...CAMPEONATOS.map(x => ({ id: x.id, nome: x.edicao ? `${x.nome} ${x.edicao}` : x.nome, ano: parseInt(x.edicao, 10) || new Date().getFullYear() })),
          ...(reg || []).map(x => ({ id: x.id, nome: x.nome, ano: x.ano || new Date().getFullYear() })),
        ];
        hubCamps.forEach(hc => {
          const ex = camps.find(x => x.id === hc.id);
          if (!ex) {
            camps = [...camps, { id: hc.id, nome: hc.nome, ano: hc.ano, ativo: true, origemHub: true, cidadeIds: [], categorias: [{codigo:"B1",nome:"B1"},{codigo:"B2",nome:"B2"}], itens: [] }];
            campsMudou = true;
          } else if (ex.nome !== hc.nome || !ex.origemHub) {
            camps = camps.map(x => x.id === hc.id ? { ...x, nome: hc.nome, origemHub: true } : x);
            campsMudou = true;
          }
        });
        setCampeonatosRaw(camps);
        if (campsMudou) setSupabaseState('forn_campeonatos', camps);
        const OLD_IDS = new Set(["eq-b1","eq-b2","eq-b3","coord-prod","dir-tv"]);
        const REQUIRED_IDS = ["supervisor2"];
        const needsMigration = !im || im.some(x => OLD_IDS.has(x.id)) || REQUIRED_IDS.some(id => !im.find(x => x.id === id));
        const imFinal = needsMigration ? ITENS_MASTER_INIT : im;
        if (needsMigration) setSupabaseState('forn_itens_master', ITENS_MASTER_INIT);
        setItensMasterRaw(imFinal);
        if (tb) setTabelasRaw(tb);     else setSupabaseState('forn_tabelas_preco', []);
        if (jf) setJogosFornRaw(jf);   else setSupabaseState('forn_jogos', JOGOS_FORN_INIT);
        setLoading(false);
        setLoadError(null);
      } catch (err) {
        console.error('Falha ao carregar dados do Hub de Fornecedores — nada foi sobrescrito:', err);
        setLoadError(err);
      }
    }
    load();

    const channel = supabase
      .channel('hub_fornecedores_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_state' }, payload => {
        const key = payload.new.key;
        if (isPersistPending(persistRefs, key)) return; // edição local em andamento vence o eco
        if (key === 'fornecedores')       setFornecedoresRaw(payload.new.value);
        if (key === 'cotacoes')           setCotacoesRaw(payload.new.value);
        if (key === 'jogos')              setJogosRaw(payload.new.value);
        if (key === 'forn_cidades')       setCidadesRaw(payload.new.value);
        if (key === 'forn_campeonatos')   setCampeonatosRaw(payload.new.value);
        if (key === 'forn_itens_master')  setItensMasterRaw(payload.new.value);
        if (key === 'forn_tabelas_preco') setTabelasRaw(payload.new.value);
        if (key === 'forn_jogos')         setJogosFornRaw(payload.new.value);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const setFornecedores = createPersistedSetter('fornecedores',      setFornecedoresRaw, persistRefs);
  const setCotacoes     = createPersistedSetter('cotacoes',          setCotacoesRaw,     persistRefs);
  const setCidades      = createPersistedSetter('forn_cidades',      setCidadesRaw,      persistRefs);
  const setCampeonatos  = createPersistedSetter('forn_campeonatos',  setCampeonatosRaw,  persistRefs);
  const setItensMaster  = createPersistedSetter('forn_itens_master', setItensMasterRaw,  persistRefs);
  const setTabelas      = createPersistedSetter('forn_tabelas_preco',setTabelasRaw,      persistRefs);
  const setJogosForn    = createPersistedSetter('forn_jogos',        setJogosFornRaw,    persistRefs);

  // Métricas consolidadas (todas as tabelas/cotações, independente do filtro)
  const metricasGlobais = useMemo(() => {
    const preenchidas = (tabelas || []).filter(t => contarCelulasPreenchidas(t) > 0);
    const aprovadas = (cotacoes || []).filter(c => c.status === "aprovada");
    const totalAprovado = aprovadas.reduce((s, c) => s + Number(c.valorTotal || 0), 0);
    return {
      tabelasPreenchidas: preenchidas.length,
      totalAprovado,
      fornecedoresComTabela: new Set(preenchidas.map(t => String(t.fornecedorId))).size,
      campeonatosCobertos: new Set(preenchidas.map(t => t.campeonatoId)).size,
    };
  }, [tabelas, cotacoes]);

  // Campeonato selecionado (para header e filtro)
  const campInfo = filtroCamp === FILTRO_TODOS
    ? null
    : campeonatos.find(c => c.id === filtroCamp);

  if (loadError) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,padding:24,textAlign:"center"}}>
      <p style={{color:T.textMd,fontSize:16}}>Falha ao carregar os dados. Nada foi alterado — clique para tentar de novo.</p>
      <button onClick={() => window.location.reload()} style={{color:"#fff",border:"none",borderRadius:7,padding:"8px 14px",cursor:"pointer",fontWeight:500,fontSize:12,background:"#65B32E"}}>Tentar novamente</button>
    </div>
  );
  if (loading) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <p style={{color:T.textMd,fontSize:16}}>Carregando Hub de Fornecedores...</p>
    </div>
  );

  return (
    <div className={modoLeitura ? "hub-leitura" : undefined} style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:"'Poppins',sans-serif",display:"flex"}}>

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
        <div style={{ marginBottom: 12 }}>
          <LivemodeLogo size={40} onClick={onBack} title="Voltar ao portal"/>
        </div>

        <div style={{ width:32, height:1, background:"rgba(255,255,255,0.06)", marginBottom:8 }}/>

        <IconButton icon={Users} title="Fornecedores" active={true} onClick={()=>{}} size={44} T={T}/>

        <div style={{ flex:1 }}/>

        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <IconButton
            icon={ocultar ? EyeOff : Eye}
            title={ocultar?"Mostrar valores":"Ocultar valores"}
            onClick={()=>setOcultar(o=>!o)}
            active={ocultar}
            size={40} T={T}
          />
          <IconButton
            icon={darkMode ? Sun : Moon}
            title={darkMode?"Modo claro":"Modo escuro"}
            onClick={()=>setDarkMode(d=>!d)}
            size={40} T={T}
          />
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────── */}
      <div style={{flex:1,minWidth:0,paddingBottom:40,background:T.bg}}>
        {/* Header corporativo */}
        <div style={{
          background: T.surface || T.card,
          borderBottom: `1px solid ${T.border}`,
          padding: "20px 32px 20px",
        }}>
          <div style={{
            display:"flex",
            justifyContent:"space-between",
            alignItems:"flex-start",
            flexWrap:"wrap",
            gap:16,
          }}>
            <div style={{ minWidth:0, display:"flex", alignItems:"center", gap:14 }}>
              <div style={{
                width:42, height:42, borderRadius:RADIUS.md,
                background: T.brandSoft || "rgba(101,179,46,0.10)",
                color: T.brand || "#65B32E",
                display:"flex", alignItems:"center", justifyContent:"center",
                flexShrink:0,
              }}>
                <Handshake size={22} strokeWidth={2.25}/>
              </div>
              <div style={{ minWidth:0 }}>
                <p style={{
                  color: T.brand || "#65B32E",
                  fontSize: 10,
                  letterSpacing:"0.16em",
                  textTransform:"uppercase",
                  margin:"0 0 3px",
                  fontWeight:600,
                  fontFamily: FONT.ui,
                  display:"inline-flex",
                  alignItems:"center",
                  gap:6,
                }}>
                  <Globe2 size={11}/>
                  Hub Global · Módulo Financeiro
                </p>
                <h1 style={{
                  fontFamily: FONT.display,
                  fontSize:22,
                  fontWeight:700,
                  margin:0,
                  color:T.text,
                  letterSpacing:"-0.005em",
                  lineHeight:1.1,
                }}>Fornecedores & Negociações</h1>
                <p style={{ color:T.textMd, fontSize:12, margin:"4px 0 0" }}>
                  Cadastro, catálogos, tabelas de preço e cotações —
                  {campInfo ? (
                    <> filtrado em <span style={{color:T.brand||"#10b981",fontWeight:700}}>{campInfo.nome}</span></>
                  ) : (
                    <> visão consolidada de <span style={{color:T.text,fontWeight:700}}>todos os campeonatos</span></>
                  )}
                </p>
              </div>
            </div>

            {/* Seletor global de campeonato */}
            <div style={{
              display:"flex", alignItems:"center", gap:8,
              padding:"8px 14px",
              background: T.surfaceAlt || T.bg,
              border: `1px solid ${T.border}`,
              borderRadius: RADIUS.lg,
            }}>
              <Trophy size={14} color={T.brand || "#10b981"} strokeWidth={2.25}/>
              <span style={{fontSize:10,color:T.textSm,letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:700}}>Filtro</span>
              <select
                value={filtroCamp}
                onChange={e => setFiltroCamp(e.target.value)}
                style={{
                  background:"transparent",
                  border:"none",
                  color:T.text,
                  fontSize:13,
                  fontWeight:600,
                  cursor:"pointer",
                  outline:"none",
                  paddingRight:8,
                  fontFamily:"inherit",
                }}
              >
                <option value={FILTRO_TODOS}>Todos os campeonatos</option>
                {campeonatos.filter(c => c.ativo !== false).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>

          {/* KPI header global */}
          <div style={{
            display:"grid",
            gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",
            gap:12,
            marginTop:20,
            filter:ocultar?"blur(8px)":"none",
            transition:"filter 0.2s",
          }}>
            <Stat T={T} label="Tabelas Preenchidas" value={String(metricasGlobais.tabelasPreenchidas)} sub="Fornecedor × campeonato" color={T.info||"#3b82f6"}    icon={Handshake}/>
            <Stat T={T} label="Aprovado em Cotações" value={fmtK(metricasGlobais.totalAprovado)}       sub="Todas as cotações aprovadas" color={T.brand||"#10b981"}   icon={Wallet}/>
            <Stat T={T} label="Fornecedores com Tabela" value={String(metricasGlobais.fornecedoresComTabela)} sub={`de ${fornecedores.length} cadastrados`} color={T.warning||"#f59e0b"} icon={Building2}/>
            <Stat T={T} label="Campeonatos Cobertos" value={String(metricasGlobais.campeonatosCobertos)} sub={`de ${campeonatos.length} no catálogo`}  color="#a855f7" icon={Trophy}/>
          </div>
        </div>

        <div style={{padding:"28px 32px",filter:ocultar?"blur(10px)":"none",transition:"filter 0.3s",userSelect:ocultar?"none":"auto"}}>
          <TabFornecedores
            fornecedores={fornecedores}
            setFornecedores={setFornecedores}
            cotacoes={cotacoes}
            setCotacoes={setCotacoes}
            jogos={jogos}
            jogosForn={jogosForn}
            setJogosForn={setJogosForn}
            cidades={cidades}
            setCidades={setCidades}
            campeonatos={campeonatos}
            setCampeonatos={setCampeonatos}
            itensMaster={itensMaster}
            setItensMaster={setItensMaster}
            tabelas={tabelas}
            setTabelas={setTabelas}
            filtroCampeonato={filtroCamp}
            T={T}
          />
        </div>
      </div>
    </div>
  );
}
