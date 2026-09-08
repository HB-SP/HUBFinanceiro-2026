import { useState, useEffect, useMemo, useRef } from "react";
import { RADIUS } from "../../constants";
import {
  getState, setState as setSupabaseState, supabase,
  createPersistedSetter, isPersistPending, appendState,
} from "../../lib/supabase";
import {
  orcKey, orcEventosKey, ORC_REGISTRY_KEY, ORC_STATUS,
  resumoRegistry, validarAprovacao, orcamentoParaCampeonato,
} from "../../data/orcamentos";
import { Settings, Layers, MapPin, CalendarDays, Briefcase, LineChart, GitCompareArrows } from "lucide-react";
import { AprovarOrcamentoModal } from "../modals/AprovarOrcamentoModal";
import SubConfiguracao from "./SubConfiguracao";
import SubPremissas from "./SubPremissas";
import SubPracas from "./SubPracas";
import SubJogos from "./SubJogos";
import SubServicos from "./SubServicos";
import SubResumo from "./SubResumo";
import SubComparativo from "./SubComparativo";

const SUBTABS = [
  { key:"config",      label:"Configuração",        icon:Settings },
  { key:"premissas",   label:"Padrões & Premissas", icon:Layers },
  { key:"pracas",      label:"Praças & Logística",  icon:MapPin },
  { key:"jogos",       label:"Jogos",               icon:CalendarDays },
  { key:"servicos",    label:"Serviços Fixos",      icon:Briefcase },
  { key:"comparativo", label:"Comparativo",         icon:GitCompareArrows },
  { key:"resumo",      label:"Resumo",              icon:LineChart },
];

// Visualizador (entidade) vê TODAS as abas, só não edita: o orçamento passa
// por aprovações e mudanças e a construção fica transparente para quem paga.

function SubTabNav({ active, onChange, T, tabs = SUBTABS }) {
  return (
    <div style={{
      display:"flex",
      gap:4,
      marginBottom:20,
      padding:4,
      background:T.surfaceAlt||T.bg,
      border:`1px solid ${T.border}`,
      borderRadius:RADIUS.md,
      flexWrap:"wrap",
    }}>
      {tabs.map(({key, label, icon:Icon}) => {
        const on = active === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              display:"inline-flex",
              alignItems:"center",
              gap:8,
              padding:"9px 16px",
              borderRadius:RADIUS.sm,
              border:"none",
              cursor:"pointer",
              fontSize:12,
              fontWeight:600,
              letterSpacing:"-0.005em",
              background: on ? (T.brand||"#10b981") : "transparent",
              color: on ? "#fff" : T.textMd,
              boxShadow: on ? `0 2px 8px ${(T.brand||"#10b981")}55` : "none",
              transition:"all .15s",
              whiteSpace:"nowrap",
            }}>
            <Icon size={14} strokeWidth={2.25}/>
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── EDITOR DE UM ORÇAMENTO ───────────────────────────────────────────────────
// Carrega orc_${id} + eventos, edita via persisted setter com debounce (as
// tabelas de premissas/faixas são digitação intensa) e espelha status/totais
// no orc_registry. Aprovado ⇒ tudo readOnly.
export default function OrcamentoEditor({
  id, T, role, user, canEdit,
  idsExistentesCamp, onCriarCampeonato, setRegistry, onAbrirCampeonato,
}) {
  const [orc, setOrcRaw]         = useState(null);
  const [eventos, setEventosRaw] = useState([]);
  const [loading, setLoading]    = useState(true);
  const [sub, setSub]            = useState(canEdit ? "config" : "resumo");   // visualizador aterrissa no Resumo
  const tabs = SUBTABS;
  const [showAprovar, setShowAprovar] = useState(false);
  const persistRefs = useRef({}).current;
  const mirrorRef   = useRef(null);

  const KEY = orcKey(id);
  const EVKEY = orcEventosKey(id);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [doc, evs] = await Promise.all([getState(KEY), getState(EVKEY)]);
      if (!mounted) return;
      if (doc) {
        setOrcRaw(doc);
        mirrorRef.current = JSON.stringify(resumoRegistry(doc));
      }
      if (evs) setEventosRaw(evs);
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel(`orc_editor_${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_state" }, payload => {
        const key = payload.new.key;
        if (isPersistPending(persistRefs, key)) return;
        if (key === KEY)   setOrcRaw(payload.new.value);
        if (key === EVKEY) setEventosRaw(payload.new.value || []);
      })
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [id]);

  // Setter padrão (debounced) + variante imediata para status/aprovação —
  // ambas compartilham a mesma fila em persistRefs, então a ordem é garantida.
  const setOrcDeb = createPersistedSetter(KEY, setOrcRaw, persistRefs, { empty: null, debounceMs: 600 });
  const setOrcNow = createPersistedSetter(KEY, setOrcRaw, persistRefs, { empty: null });

  const stamp = (fn) => (prev) => {
    if (!prev) return prev;
    const next = typeof fn === "function" ? fn(prev) : fn;
    return { ...next, meta: { ...next.meta, updatedAt: new Date().toISOString() } };
  };
  const setOrc = (fn) => setOrcDeb(stamp(fn));

  // Espelha totais/status no registry (debounce próprio; só quando mudou)
  useEffect(() => {
    if (!orc || loading || !canEdit) return;   // visualizador é só-leitura (RLS negaria a escrita)
    const t = setTimeout(() => {
      const resumo = resumoRegistry(orc);
      const j = JSON.stringify(resumo);
      if (j === mirrorRef.current) return;
      mirrorRef.current = j;
      setRegistry(prev => (prev || []).map(r => r.id === orc.id ? { ...r, ...resumo } : r));
    }, 1200);
    return () => clearTimeout(t);
  }, [orc, loading]);

  const readOnly = !orc || orc.meta.status === "aprovado" || !canEdit;

  const registrarEvento = (ev) => appendState(EVKEY, {
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    user: user?.email || "",
    ...ev,
  }).then(async () => {
    const evs = await getState(EVKEY);
    if (evs) setEventosRaw(evs);
  }).catch(err => console.error("Falha ao registrar evento do orçamento:", err));

  const mudarStatus = (para) => {
    if (readOnly || !orc) return;
    const de = orc.meta.status;
    if (de === para) return;
    setOrcNow(stamp(prev => ({ ...prev, meta: { ...prev.meta, status: para } })));
    registrarEvento({ clientRef: `status-${id}-${Date.now()}`, tipo: "status", de, para, detalhe: `${ORC_STATUS[de]?.label} → ${ORC_STATUS[para]?.label}` });
  };

  const errosAprovacao = useMemo(
    () => orc ? validarAprovacao(orc, idsExistentesCamp) : [],
    [orc, idsExistentesCamp]
  );

  // Aprovação: cria o campeonato ANTES de congelar (falhou ⇒ continua editável).
  // As escritas seguem rodando mesmo se o criarCampeonato navegar para fora.
  const aprovar = async () => {
    if (!orc) return;
    const payload = orcamentoParaCampeonato(orc);
    await onCriarCampeonato(payload);
    const now = new Date().toISOString();
    setOrcNow(prev => prev ? ({
      ...prev,
      meta: {
        ...prev.meta,
        status: "aprovado",
        aprovadoEm: now,
        aprovadoPor: user?.email || "",
        campeonatoCriadoId: payload.config.id,
        updatedAt: now,
      },
    }) : prev);
    setRegistry(prev => (prev || []).map(r => r.id === orc.id
      ? { ...r, status: "aprovado", campeonatoCriadoId: payload.config.id, updatedAt: now }
      : r));
    await appendState(EVKEY, {
      id: `ev-${Date.now()}`,
      clientRef: `aprov-${orc.id}`,
      at: now,
      user: user?.email || "",
      tipo: "aprovado",
      detalhe: `Campeonato ${payload.config.id} criado a partir deste orçamento`,
    });
  };

  if (loading) return <p style={{color:T.textMd,fontSize:14}}>Carregando orçamento...</p>;
  if (!orc) return (
    <p style={{color:T.textMd,fontSize:14}}>
      Orçamento não encontrado no banco (pode ter sido criado em outra sessão e ainda não sincronizou).
    </p>
  );

  const commonProps = { orc, setOrc, readOnly, T };

  return (
    <>
      <SubTabNav active={sub} onChange={setSub} T={T} tabs={tabs}/>

      {sub === "config"    && <SubConfiguracao {...commonProps} eventos={eventos} onMudarStatus={mudarStatus} onAbrirCampeonato={onAbrirCampeonato}/>}
      {sub === "premissas" && <SubPremissas {...commonProps}/>}
      {sub === "pracas"    && <SubPracas {...commonProps}/>}
      {sub === "jogos"     && <SubJogos {...commonProps}/>}
      {sub === "servicos"  && <SubServicos {...commonProps}/>}
      {sub === "comparativo" && <SubComparativo {...commonProps}/>}
      {sub === "resumo"    && (
        <SubResumo
          {...commonProps}
          canAprovar={canEdit && orc.meta.status === "em_revisao"}
          errosAprovacao={errosAprovacao}
          onAprovar={()=>setShowAprovar(true)}
        />
      )}

      {showAprovar && (
        <AprovarOrcamentoModal
          orc={orc}
          erros={errosAprovacao}
          T={T}
          onClose={()=>setShowAprovar(false)}
          onConfirm={aprovar}
        />
      )}
    </>
  );
}
