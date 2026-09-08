import { useState, useEffect, useMemo, useRef } from "react";
import { RADIUS, FONT, CAMPEONATOS } from "../constants";
import { getState, setState as setSupabaseState, supabase, createPersistedSetter, isPersistPending, appendState } from "../lib/supabase";
import { ORC_REGISTRY_KEY, orcKey, orcEventosKey, ORC_STATUS, podeVerOrcamento } from "../data/orcamentos";
import { fmt, fmtK } from "../utils";
import { Stat, Badge, Button, IconButton } from "./ui";
import LivemodeLogo from "./LivemodeLogo";
import {
  Calculator, Globe2, Sun, Moon, Eye, EyeOff,
  Plus, Trash2, FileEdit, CheckCircle2, Wallet, ArrowRight, Trophy,
} from "lucide-react";
import { NovoOrcamentoModal } from "./modals/NovoOrcamentoModal";
import OrcamentoEditor from "./orcamentos/OrcamentoEditor";

// ─── HUB DE ORÇAMENTOS ────────────────────────────────────────────────────────
// Módulo transversal (acesso só pela Home): budget builder pré-campeonato.
// Lista os orçamentos (orc_registry) e abre o editor de um orçamento; ao
// aprovar, o campeonato custom é criado pelo criarCampeonato do App.
export default function HubOrcamentos({
  onBack, onEnter, T, darkMode, setDarkMode,
  role, entidade = null, initialId = null, user, onCriarCampeonato, customCampeonatos = [],
}) {
  const [registry,  setRegistryRaw] = useState([]);
  const [loading,   setLoading]     = useState(true);
  const [loadError, setLoadError]   = useState(null);
  const [ocultar,   setOcultar]     = useState(false);
  const [selId,     setSelId]       = useState(initialId);   // aberto direto de um card da Home
  const [showNovo,  setShowNovo]    = useState(false);
  const persistRefs = useRef({}).current;

  const canEdit = role === "admin";

  useEffect(() => {
    async function load() {
      try {
        const reg = await getState(ORC_REGISTRY_KEY);
        if (reg) setRegistryRaw(reg);
        else if (role === "admin") await setSupabaseState(ORC_REGISTRY_KEY, []);
        setLoading(false);
        setLoadError(null);
      } catch (err) {
        console.error("Falha ao carregar o Hub de Orçamentos — nada foi sobrescrito:", err);
        setLoadError(err);
      }
    }
    load();

    const channel = supabase
      .channel("hub_orcamentos_registry")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_state" }, payload => {
        const key = payload.new.key;
        if (isPersistPending(persistRefs, key)) return;
        if (key === ORC_REGISTRY_KEY) setRegistryRaw(payload.new.value || []);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const setRegistry = createPersistedSetter(ORC_REGISTRY_KEY, setRegistryRaw, persistRefs);

  // Ids já usados por campeonatos (fixos + customs) e por orçamentos existentes
  const idsExistentesCamp = useMemo(
    () => [...CAMPEONATOS.map(c => c.id), ...customCampeonatos.map(c => c.id)],
    [customCampeonatos]
  );
  const idsExistentesNovo = useMemo(
    () => [...idsExistentesCamp, ...registry.map(r => r.id)],
    [idsExistentesCamp, registry]
  );

  // Visualizador só vê os orçamentos da sua entidade (organizador do orçamento)
  const registryVisivel = useMemo(
    () => registry.filter(r => podeVerOrcamento(role, entidade, r.organizador)),
    [registry, role, entidade]
  );

  const kpis = useMemo(() => ({
    total: registryVisivel.length,
    rascunhos: registryVisivel.filter(r => r.status === "rascunho").length,
    emRevisao: registryVisivel.filter(r => r.status === "em_revisao").length,
    aprovados: registryVisivel.filter(r => r.status === "aprovado").length,
    somaEstimada: registryVisivel.reduce((s, r) => s + (Number(r.totalEstimado) || 0), 0),
  }), [registryVisivel]);

  const criarOrcamento = async (doc) => {
    await setSupabaseState(orcKey(doc.id), doc);
    setRegistry(prev => [...(prev || []).filter(r => r.id !== doc.id), {
      id: doc.id, nome: doc.meta.nome, edicao: doc.meta.edicao,
      icon: doc.meta.icon, cor: doc.meta.cor, status: doc.meta.status,
      totalEstimado: 0, numJogos: 0, campeonatoCriadoId: null,
      createdAt: doc.meta.createdAt, updatedAt: doc.meta.updatedAt,
    }]);
    await appendState(orcEventosKey(doc.id), {
      id: `ev-${Date.now()}`, clientRef: `criado-${doc.id}`,
      at: new Date().toISOString(), user: user?.email || "",
      tipo: "criado", detalhe: `Orçamento ${doc.meta.nome} ${doc.meta.edicao} criado`,
    });
    setShowNovo(false);
    setSelId(doc.id);
  };

  // Remove só do registry — o documento orc_${id} fica no banco para auditoria
  // (mesmo padrão do excluirCampeonato do App).
  const excluirOrcamento = (id) => {
    setRegistry(prev => (prev || []).filter(r => r.id !== id));
  };

  if (loadError) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,padding:24,textAlign:"center"}}>
      <p style={{color:T.textMd,fontSize:16}}>Falha ao carregar os dados. Nada foi alterado — clique para tentar de novo.</p>
      <button onClick={() => window.location.reload()} style={{color:"#fff",border:"none",borderRadius:7,padding:"8px 14px",cursor:"pointer",fontWeight:500,fontSize:12,background:"#65B32E"}}>Tentar novamente</button>
    </div>
  );
  if (loading) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <p style={{color:T.textMd,fontSize:16}}>Carregando Hub de Orçamentos...</p>
    </div>
  );

  const regSel = selId ? registryVisivel.find(r => r.id === selId) : null;

  return (
    <div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:"'Poppins',sans-serif",display:"flex"}}>

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

        <IconButton icon={Calculator} title="Orçamentos" active={true} onClick={()=>setSelId(null)} size={44} T={T}/>

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
        {/* Header */}
        <div style={{
          background: T.surface || T.card,
          borderBottom: `1px solid ${T.border}`,
          padding: "20px 32px 20px",
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16}}>
            <div style={{ minWidth:0, display:"flex", alignItems:"center", gap:14 }}>
              <div style={{
                width:42, height:42, borderRadius:RADIUS.md,
                background: T.brandSoft || "rgba(101,179,46,0.10)",
                color: T.brand || "#65B32E",
                display:"flex", alignItems:"center", justifyContent:"center",
                flexShrink:0,
              }}>
                <Calculator size={22} strokeWidth={2.25}/>
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
                }}>Orçamentos</h1>
                <p style={{ color:T.textMd, fontSize:12, margin:"4px 0 0" }}>
                  {regSel ? (
                    <>Editando <span style={{color:regSel.cor||T.brand,fontWeight:700}}>{regSel.nome} {regSel.edicao}</span></>
                  ) : (
                    canEdit
                      ? <>Construção de orçamentos pré-campeonato — padrões, premissas, praças e logística por faixa</>
                      : <>Orçamentos propostos para a sua entidade — valores por jogo, serviços fixos e comparativo com a edição anterior</>
                  )}
                </p>
              </div>
            </div>

            {regSel && (
              <Button T={T} variant="secondary" size="md" onClick={()=>setSelId(null)}>
                ← Todos os orçamentos
              </Button>
            )}
          </div>

          {/* KPIs globais (só na listagem) */}
          {!regSel && (
            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",
              gap:12,
              marginTop:20,
              filter:ocultar?"blur(8px)":"none",
              transition:"filter 0.2s",
            }}>
              <Stat T={T} label="Orçamentos" value={String(kpis.total)} sub={`${kpis.rascunhos} em rascunho`} color={T.info||"#3b82f6"} icon={FileEdit}/>
              <Stat T={T} label="Em Revisão" value={String(kpis.emRevisao)} sub="Aguardando aprovação" color={T.warning||"#f59e0b"} icon={Calculator}/>
              <Stat T={T} label="Aprovados" value={String(kpis.aprovados)} sub="Campeonatos criados" color={T.success||"#22c55e"} icon={CheckCircle2}/>
              <Stat T={T} label="Total Estimado" value={fmtK(kpis.somaEstimada)} sub="Soma de todos os orçamentos" color="#a855f7" icon={Wallet}/>
            </div>
          )}
        </div>

        <div style={{padding:"28px 32px",filter:ocultar?"blur(10px)":"none",transition:"filter 0.3s",userSelect:ocultar?"none":"auto"}}>
          {regSel ? (
            <OrcamentoEditor
              key={regSel.id}
              id={regSel.id}
              T={T}
              role={role}
              user={user}
              canEdit={canEdit}
              idsExistentesCamp={idsExistentesCamp}
              onCriarCampeonato={onCriarCampeonato}
              setRegistry={setRegistry}
              onAbrirCampeonato={(campId) => onEnter && onEnter(`custom:${campId}`)}
            />
          ) : (
            <ListaOrcamentos
              registry={registryVisivel}
              T={T}
              canEdit={canEdit}
              onSelecionar={setSelId}
              onExcluir={excluirOrcamento}
              onNovo={()=>setShowNovo(true)}
              onAbrirCampeonato={(campId) => onEnter && onEnter(`custom:${campId}`)}
            />
          )}
        </div>
      </div>

      {showNovo && canEdit && (
        <NovoOrcamentoModal
          T={T}
          idsExistentes={idsExistentesNovo}
          onClose={()=>setShowNovo(false)}
          onSave={criarOrcamento}
        />
      )}
    </div>
  );
}

// ─── LISTAGEM ─────────────────────────────────────────────────────────────────
function ListaOrcamentos({ registry, T, canEdit, onSelecionar, onExcluir, onNovo, onAbrirCampeonato }) {
  const ordenados = [...registry].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  return (
    <div style={{
      display:"grid",
      gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))",
      gap:18,
    }}>
      {ordenados.map(r => {
        const st = ORC_STATUS[r.status] || ORC_STATUS.rascunho;
        return (
          <div key={r.id} className="lm-card-hover" style={{
            background:T.surface||T.card,
            border:`1px solid ${T.border}`,
            borderRadius:RADIUS.lg,
            boxShadow:T.shadow||"0 1px 3px rgba(0,0,0,0.06)",
            padding:20,
            display:"flex",
            flexDirection:"column",
            gap:14,
            position:"relative",
            overflow:"hidden",
          }}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:r.cor||T.brand}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
              <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
                <div style={{
                  width:40, height:40, borderRadius:9,
                  background:(r.cor||"#65B32E")+"18",
                  border:`1px solid ${(r.cor||"#65B32E")}44`,
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,
                }}>{r.icon||"🏆"}</div>
                <div style={{minWidth:0}}>
                  <h4 style={{margin:0,fontSize:14,fontWeight:600,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {r.nome} {r.edicao}
                  </h4>
                  <p style={{margin:"2px 0 0",fontSize:11,color:T.textSm}}>
                    Atualizado {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString("pt-BR") : "—"}
                  </p>
                </div>
              </div>
              <Badge T={T} color={st.color}>{st.label}</Badge>
            </div>

            <div style={{
              display:"grid",
              gridTemplateColumns:"1fr 1fr",
              gap:10,
              paddingTop:12,
              borderTop:`1px solid ${T.border}`,
            }}>
              <div>
                <p style={{color:T.textSm,fontSize:10,margin:"0 0 4px",letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:600}}>Total estimado</p>
                <p className="num" style={{color:T.text,fontSize:15,fontWeight:600,margin:0,fontFamily:FONT.num}}>{fmt(r.totalEstimado||0)}</p>
              </div>
              <div>
                <p style={{color:T.textSm,fontSize:10,margin:"0 0 4px",letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:600}}>Jogos</p>
                <p className="num" style={{color:T.text,fontSize:15,fontWeight:600,margin:0,fontFamily:FONT.num}}>{r.numJogos||0}</p>
              </div>
            </div>

            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <Button T={T} variant="primary" size="sm" icon={ArrowRight} onClick={()=>onSelecionar(r.id)}>
                {r.status === "aprovado" ? "Ver orçamento" : "Editar"}
              </Button>
              {r.status === "aprovado" && r.campeonatoCriadoId && (
                <Button T={T} variant="secondary" size="sm" icon={Trophy} onClick={()=>onAbrirCampeonato(r.campeonatoCriadoId)}>
                  Abrir campeonato
                </Button>
              )}
              <div style={{flex:1}}/>
              {canEdit && r.status === "rascunho" && (
                <Button T={T} variant="danger" size="sm" icon={Trash2}
                  onClick={()=>{ if (window.confirm(`Excluir o orçamento "${r.nome} ${r.edicao}"? Os dados ficam no banco para auditoria.`)) onExcluir(r.id); }}
                  title="Excluir rascunho"/>
              )}
            </div>
          </div>
        );
      })}

      {canEdit && (
        <button onClick={onNovo} style={{
          border:`2px dashed ${T.borderStrong||T.border}`,
          borderRadius:RADIUS.lg,
          background:"transparent",
          minHeight:170,
          cursor:"pointer",
          display:"flex",
          flexDirection:"column",
          alignItems:"center",
          justifyContent:"center",
          gap:10,
          color:T.textMd,
          fontFamily:FONT.ui,
        }}>
          <div style={{
            width:40, height:40, borderRadius:"50%",
            background:T.brandSoft||"rgba(101,179,46,0.10)",
            color:T.brand||"#65B32E",
            display:"flex",alignItems:"center",justifyContent:"center",
          }}><Plus size={20}/></div>
          <span style={{fontSize:13,fontWeight:600,color:T.text}}>Novo orçamento</span>
          <span style={{fontSize:11,color:T.textSm,maxWidth:220,textAlign:"center",lineHeight:1.5}}>
            Comece um orçamento em rascunho — o campeonato só é criado na aprovação
          </span>
        </button>
      )}

      {registry.length === 0 && !canEdit && (
        <p style={{color:T.textMd,fontSize:13,gridColumn:"1 / -1"}}>Nenhum orçamento criado ainda.</p>
      )}
    </div>
  );
}
