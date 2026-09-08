import { CAMPEONATOS, RADIUS, FONT } from "../constants";
import { getChampionshipConfig } from "../config/championships";
import { CAMPEONATO_ENTITIES, ENTIDADES_VISUALIZADOR, getEntity, podeVerCampeonato } from "../config/entities";
import { ORC_STATUS, podeVerOrcamento } from "../data/orcamentos";
import { fmt } from "../utils";
import ChampionshipLogo from "./ChampionshipLogo";
import EntityLogo, { EntityLogoStack } from "./EntityLogo";
import LivemodeLogo from "./LivemodeLogo";
import { Card, Stat, Button, Badge } from "./ui";
import {
  Trophy, Calendar, Building2, Sun, Moon,
  ArrowRight, Lock, Activity, Handshake, Globe2,
  Plus, Trash2, LogOut, Users, Calculator,
} from "lucide-react";


// Stats por campeonato — extraído pra ler de qualquer estrutura sem alterar dados.
function CampStats({ camp, T }) {
  const ents = CAMPEONATO_ENTITIES[camp.id];
  if (camp.id === "brasileirao-2026") {
    return (
      <>
        <StatBlock label="Rodadas" value={camp.rodadas} T={T}/>
        <div>
          <p style={{ color: T.textSm, fontSize: 10, margin: "0 0 6px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, fontFamily: FONT.ui }}>Detentores</p>
          {ents?.detentores?.length ? (
            <EntityLogoStack entityIds={ents.detentores} size={28} overlap={10} T={T}/>
          ) : (
            <p style={{ color: T.text, fontSize: 12, margin: 0, fontFamily: FONT.ui }}>—</p>
          )}
        </div>
      </>
    );
  }
  if (camp.id === "paulistao-feminino-2026") {
    return (
      <>
        <StatBlock label="Fases" value={camp.fases} T={T}/>
        <StatBlock label="Formato" value="Mata-mata" T={T} hint="Grupos + Mata-mata"/>
      </>
    );
  }
  return (
    <>
      <StatBlock label="Fases" value={camp.fases?.length || 0} T={T}/>
      <StatBlock label="Tipo" value="Custom" T={T} hint="HUB Custom"/>
    </>
  );
}

// ── Card de campeonato — surface do tema (branco em light, dark em dark) ───────

function StatBlock({ label, value, hint, T }) {
  return (
    <div>
      <p style={{
        color: T.textSm,
        fontSize: 10,
        margin: "0 0 4px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 600,
        fontFamily: FONT.ui,
      }}>{label}</p>
      <p className="num" style={{
        color: T.text,
        fontFamily: FONT.display,
        fontSize: 20,
        fontWeight: 700,
        margin: 0,
        letterSpacing: "-0.005em",
        lineHeight: 1.2,
      }}>{value}</p>
      {hint && <p style={{
        color: T.textSm,
        fontSize: 10,
        margin: "2px 0 0",
        fontFamily: FONT.ui,
      }}>{hint}</p>}
    </div>
  );
}

function ChampCard({ camp, onEnter, onDelete, T }) {
  const cfg = getChampionshipConfig(camp.id, camp);
  const ents = CAMPEONATO_ENTITIES[camp.id];
  return (
    <div className="lm-card-hover" style={{
      background: T.surface || T.card,
      borderRadius: RADIUS.lg,
      border: `1px solid ${T.border}`,
      borderTop: `3px solid ${cfg.accentColor}`,
      padding: 22,
      cursor: "pointer",
      position: "relative",
      overflow: "hidden",
      minHeight: 240,
      display: "flex",
      flexDirection: "column",
      gap: 18,
      boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)",
    }} onClick={() => onEnter(camp.id.startsWith("custom-") ? `custom:${camp.id}` : camp.id)}>
      {/* Cabeçalho: logo + nome (linha cheia) */}
      <div style={{ display:"flex", alignItems:"center", gap: 14, minWidth: 0 }}>
        {ents?.organizador
          ? <EntityLogo entityId={ents.organizador} size={48} T={T}/>
          : <ChampionshipLogo championshipId={camp.id} size={48} config={camp}/>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h4 style={{
            margin: "0 0 2px",
            fontFamily: FONT.display,
            fontSize: 22,
            fontWeight: 700,
            color: T.text,
            letterSpacing: "-0.005em",
            lineHeight: 1.1,
          }}>{camp.nome}</h4>
          <p style={{
            margin: 0,
            fontSize: 11,
            color: T.textSm,
            fontFamily: FONT.ui,
          }}>
            {ents?.organizador && <>{getEntity(ents.organizador).name} · </>}
            {camp.edicao} · Temporada
          </p>
        </div>
      </div>

      {/* Badge "Em andamento" — linha própria, abaixo do nome */}
      <span style={{
        background: "rgba(101,179,46,0.10)",
        border: "1px solid rgba(101,179,46,0.30)",
        color: T.brand || "#65B32E",
        borderRadius: RADIUS.pill,
        padding: "0 10px",
        height: 22,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignSelf: "flex-start",
        alignItems: "center",
        gap: 6,
        marginTop: -8,
        fontFamily: FONT.ui,
      }}>
        <span className="live-dot" style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: "#65B32E",
          display: "inline-block",
        }}/>
        {camp.status}
      </span>

      {/* Stats grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        paddingBottom: 16,
        borderBottom: `1px solid ${T.border}`,
      }}>
        <CampStats camp={camp} T={T}/>
      </div>

      <div style={{ flex: 1 }}/>

      {/* CTA + (opcional) excluir */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={e => { e.stopPropagation(); onEnter(camp.id.startsWith("custom-") ? `custom:${camp.id}` : camp.id); }}
          style={{
            flex: 1,
            background: T.brand || "#65B32E",
            border: "1px solid transparent",
            color: "#fff",
            borderRadius: 7,
            height: 36,
            cursor: "pointer",
            fontFamily: FONT.ui,
            fontWeight: 500,
            fontSize: 12,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            letterSpacing: "0",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = T.brandStrong || "#5aa327"; }}
          onMouseLeave={e => { e.currentTarget.style.background = T.brand || "#65B32E"; }}
        >
          Abrir campeonato <ArrowRight size={14} strokeWidth={2.25}/>
        </button>
        {onDelete && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(camp); }}
            title="Excluir"
            style={{
              width: 36,
              height: 36,
              background: "rgba(220,38,38,0.08)",
              border: "1px solid rgba(220,38,38,0.2)",
              color: T.danger || "#DC2626",
              borderRadius: 7,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Trash2 size={14} strokeWidth={2.25}/>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Card de orçamento (proposta pré-campeonato) — mesmo desenho do ChampCard ──
function OrcCard({ reg, onEnter, readOnly, T }) {
  const st = ORC_STATUS[reg.status] || ORC_STATUS.rascunho;
  const orgLabel = ENTIDADES_VISUALIZADOR.find(e => e.id === reg.organizador)?.label?.split(" - ")[0] || null;
  const cor = reg.cor || T.brand || "#65B32E";
  return (
    <div className="lm-card-hover" style={{
      background: T.surface || T.card,
      borderRadius: RADIUS.lg,
      border: `1px solid ${T.border}`,
      borderTop: `3px solid ${cor}`,
      padding: 22,
      cursor: "pointer",
      position: "relative",
      overflow: "hidden",
      minHeight: 240,
      display: "flex",
      flexDirection: "column",
      gap: 18,
      boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)",
    }} onClick={onEnter}>
      <div style={{ display:"flex", alignItems:"center", gap: 14, minWidth: 0 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, flexShrink: 0,
          background: `${cor}18`, border: `1px solid ${cor}44`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
        }}>{reg.icon || "🏆"}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h4 style={{
            margin: "0 0 2px",
            fontFamily: FONT.display,
            fontSize: 22,
            fontWeight: 700,
            color: T.text,
            letterSpacing: "-0.005em",
            lineHeight: 1.1,
          }}>{reg.nome}</h4>
          <p style={{ margin: 0, fontSize: 11, color: T.textSm, fontFamily: FONT.ui }}>
            {orgLabel && <>{orgLabel} · </>}
            {reg.edicao} · Orçamento
          </p>
        </div>
      </div>

      <span style={{
        background: `${st.color}18`,
        border: `1px solid ${st.color}55`,
        color: st.color,
        borderRadius: RADIUS.pill,
        padding: "0 10px",
        height: 22,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignSelf: "flex-start",
        alignItems: "center",
        gap: 6,
        marginTop: -8,
        fontFamily: FONT.ui,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: st.color, display: "inline-block" }}/>
        {st.label}
      </span>

      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        paddingBottom: 16,
        borderBottom: `1px solid ${T.border}`,
      }}>
        <StatBlock label="Total estimado" value={fmt(reg.totalEstimado || 0)} T={T}/>
        <StatBlock label="Jogos" value={reg.numJogos || 0} T={T} hint="estimados"/>
      </div>

      <div style={{ flex: 1 }}/>

      <button
        onClick={e => { e.stopPropagation(); onEnter(); }}
        style={{
          background: T.brand || "#65B32E",
          border: "1px solid transparent",
          color: "#fff",
          borderRadius: 7,
          height: 36,
          cursor: "pointer",
          fontFamily: FONT.ui,
          fontWeight: 500,
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = T.brandStrong || "#5aa327"; }}
        onMouseLeave={e => { e.currentTarget.style.background = T.brand || "#65B32E"; }}
      >
        {readOnly ? "Ver orçamento" : "Abrir orçamento"} <ArrowRight size={14} strokeWidth={2.25}/>
      </button>
    </div>
  );
}

export default function Home({ onEnter, onOpenHub, T, darkMode, setDarkMode, customCampeonatos = [], orcamentos = [], onCriarCampeonato, onExcluirCampeonato, role = 'admin', entidade = null, onSignOut }) {
  // entidade pode ter múltiplos valores separados por vírgula (definidos pelo admin)
  const campVisiveis = CAMPEONATOS.filter(c => podeVerCampeonato(role, entidade, c.id));
  const customVisiveis = customCampeonatos.filter(c => podeVerCampeonato(role, entidade, c.id, c.organizador));
  // Orçamentos (propostas pré-campeonato) visíveis para esta entidade — mesma
  // regra dos campeonatos custom, pelo organizador do orçamento.
  const orcVisiveis = orcamentos
    .filter(r => podeVerOrcamento(role, entidade, r.organizador))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  const totalAtivos = campVisiveis.filter(c => !c.emBreve).length + customVisiveis.filter(c => c.status === "Em andamento").length;

  return (
    <div className="page-enter" style={{ minHeight: "100vh", background: T.bg, color: T.text }}>
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <header style={{
        background: T.surface || T.card,
        borderBottom: `1px solid ${T.border}`,
        height: 52,
        padding: "0 28px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LivemodeLogo size={32}/>
          <span style={{
            fontFamily: FONT.display,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: T.textMd,
          }}>HUB FINANCEIRO</span>
          <span style={{ width: 1, height: 18, background: T.border, margin: "0 4px" }}/>
          <span style={{
            fontFamily: FONT.ui,
            fontSize: 12,
            color: T.textMd,
          }}>Livemode · Transmissões</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Badge color={T.brand} T={T}>
            <Activity size={11} strokeWidth={2.5} />
            Temporada 2026
          </Badge>
          {role === 'admin' && (
            <Button T={T} variant="secondary" size="sm" icon={Users} onClick={() => onEnter('admin-usuarios')}>
              Usuários
            </Button>
          )}
          <Button
            T={T}
            variant="secondary"
            size="sm"
            icon={darkMode ? Sun : Moon}
            onClick={() => setDarkMode(d => !d)}
          >
            {darkMode ? "Claro" : "Escuro"}
          </Button>
          <Button
            T={T}
            variant="secondary"
            size="sm"
            icon={LogOut}
            onClick={onSignOut}
          >
            Sair
          </Button>
        </div>
      </header>

      {/* ── Conteúdo ──────────────────────────────────────────────────────── */}
      <main style={{ padding: "32px 28px 64px", maxWidth: 1240, margin: "0 auto" }}>
        {/* Hero */}
        <div style={{ marginBottom: 28 }}>
          <p style={{
            color: T.brand || "#65B32E",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            margin: "0 0 8px",
            fontFamily: FONT.ui,
          }}>Visão Geral</p>
          <h2 style={{
            fontFamily: FONT.display,
            fontSize: 32,
            fontWeight: 700,
            color: T.text,
            margin: "0 0 6px",
            letterSpacing: "-0.01em",
            lineHeight: 1.05,
          }}>Painel de campeonatos</h2>
          <p style={{ color: T.textMd, fontSize: 13, margin: 0, maxWidth: 640, fontFamily: FONT.ui }}>
            Acompanhe orçamento, execução e operação financeira de cada campeonato em um único lugar.
          </p>
        </div>

        {/* KPIs */}
        <div className="stagger" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
          marginBottom: 36,
        }}>
          <Stat T={T} label="Campeonatos Ativos" value={String(totalAtivos)} sub={`${CAMPEONATOS.length + customCampeonatos.length} cadastrados`} color={T.brand} icon={Trophy} />
          <Stat T={T} label="Temporada"          value="2026" sub="Janeiro – Dezembro" color={T.info} icon={Calendar} />
          <Stat T={T} label="Detentores"         value="3" sub="CazeTV · Record · Amazon" color={T.projetado || "#7C3AED"} icon={Building2} />
        </div>

        {/* Section header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}>
          <div>
            <h3 style={{
              margin: 0,
              fontFamily: FONT.display,
              fontSize: 20,
              color: T.text,
              fontWeight: 700,
              letterSpacing: "-0.005em",
            }}>Campeonatos</h3>
            <p style={{ color: T.textSm, fontSize: 11, margin: "2px 0 0", fontFamily: FONT.ui }}>
              {CAMPEONATOS.length + customCampeonatos.length} projetos cadastrados
            </p>
          </div>
          {role === 'admin' && (
            <Button T={T} variant="primary" size="md" icon={Plus} onClick={onCriarCampeonato}>
              Novo campeonato
            </Button>
          )}
        </div>

        {/* Cards de campeonatos */}
        <div className="stagger" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 18,
        }}>
          {campVisiveis.map(camp => (
            <ChampCard
              key={camp.id}
              camp={camp}
              onEnter={onEnter}
              T={T}
            />
          ))}

          {customVisiveis.map(camp => (
            <ChampCard
              key={camp.id}
              camp={camp}
              T={T}
              onEnter={(id) => onEnter(`custom:${camp.id}`)}
              onDelete={onExcluirCampeonato ? (c) => {
                if (window.confirm(`Excluir o campeonato "${c.nome}"? Os dados (jogos, notas, logística) ficam no Supabase mas o campeonato some do portal.`)) {
                  onExcluirCampeonato(c.id);
                }
              } : undefined}
            />
          ))}

          {/* Card "+ Criar novo" — borda dashed transparente (admin only) */}
          {role === 'admin' && <button onClick={onCriarCampeonato} className="lm-card-hover" style={{
            cursor: "pointer",
            border: `1.5px dashed ${T.borderStrong || T.border}`,
            background: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 240,
            borderRadius: RADIUS.lg,
            padding: 22,
            color: T.textMd,
            fontFamily: FONT.ui,
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                border: `1.5px dashed ${T.brand || "#65B32E"}`,
                color: T.brand || "#65B32E",
                background: "rgba(101,179,46,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
              }}>
                <Plus size={22} strokeWidth={2.25}/>
              </div>
              <p style={{margin: "0 0 4px", fontSize: 13, fontWeight: 500, color: T.text}}>Criar novo campeonato</p>
              <p style={{margin: 0, fontSize: 11, color: T.textSm, maxWidth: 240}}>Cole um JSON no formato padrão e o campeonato é criado com todas as funcionalidades do HUB.</p>
            </div>
          </button>}
        </div>

        {/* ── Orçamentos (propostas pré-campeonato) ───────────────── */}
        {orcVisiveis.length > 0 && (
          <>
            <div style={{ marginTop: 44, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{
                  margin: 0,
                  fontFamily: FONT.display,
                  fontSize: 20,
                  color: T.text,
                  fontWeight: 700,
                  letterSpacing: "-0.005em",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}>
                  <Calculator size={18} color={T.brand || "#65B32E"} strokeWidth={2.25}/>
                  Orçamentos
                </h3>
                <p style={{ color: T.textSm, fontSize: 11, margin: "2px 0 0", fontFamily: FONT.ui }}>
                  {orcVisiveis.length} {orcVisiveis.length === 1 ? "orçamento proposto" : "orçamentos propostos"} para a próxima edição
                </p>
              </div>
              {role === 'admin' && (
                <Button T={T} variant="secondary" size="sm" icon={ArrowRight} onClick={() => onEnter("hub-orcamentos")}>
                  Hub de Orçamentos
                </Button>
              )}
            </div>
            <div className="stagger" style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              gap: 18,
            }}>
              {orcVisiveis.map(r => <OrcCard key={r.id} reg={r} T={T} onEnter={() => onEnter(`orc:${r.id}`)} readOnly={role !== 'admin'}/>)}
            </div>
          </>
        )}

        {/* ── Módulos Transversais ────────────────────────────────── */}
        {role !== 'visualizador' && <div style={{ marginTop: 44, marginBottom: 14 }}>
          <h3 style={{
            margin: 0,
            fontFamily: FONT.display,
            fontSize: 20,
            color: T.text,
            fontWeight: 700,
            letterSpacing: "-0.005em",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}>
            <Globe2 size={18} color={T.brand || "#65B32E"} strokeWidth={2.25}/>
            Módulos
          </h3>
          <p style={{ color: T.textSm, fontSize: 11, margin: "2px 0 0", fontFamily: FONT.ui }}>
            Ferramentas financeiras transversais a todos os campeonatos
          </p>
        </div>}

        {role !== 'visualizador' && <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 18,
        }}>
          {/* Módulo Hub de Fornecedores — card claro com ícone verde */}
          <button
            onClick={() => onOpenHub && onOpenHub("todos")}
            className="lm-card-hover"
            style={{
              background: T.surface || T.card,
              border: `1px solid ${T.border}`,
              borderRadius: RADIUS.lg,
              padding: 20,
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)",
              fontFamily: FONT.ui,
              color: T.text,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 9,
                  background: "rgba(101,179,46,0.10)",
                  color: T.brand || "#65B32E",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <Handshake size={20} strokeWidth={2.25}/>
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: T.text }}>Hub de Fornecedores</h4>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: T.textSm }}>Cadastro, cotações, chat com IA e análise preditiva</p>
                </div>
              </div>
              <span style={{
                background: "rgba(101,179,46,0.12)",
                border: "1px solid rgba(101,179,46,0.35)",
                color: T.brand || "#65B32E",
                borderRadius: RADIUS.pill,
                padding: "0 10px",
                height: 22,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
              }}>Ativo</span>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
              paddingTop: 16,
              borderTop: `1px solid ${T.border}`,
            }}>
              <div>
                <p style={{ color: T.textSm, fontSize: 10, margin: "0 0 4px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Escopo</p>
                <p style={{ color: T.text, fontSize: 12, fontWeight: 500, margin: 0 }}>Cross-camp.</p>
              </div>
              <div>
                <p style={{ color: T.textSm, fontSize: 10, margin: "0 0 4px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Sub-abas</p>
                <p className="num" style={{ color: T.text, fontSize: 12, fontWeight: 500, margin: 0, fontFamily: FONT.num }}>6 módulos</p>
              </div>
              <div>
                <p style={{ color: T.textSm, fontSize: 10, margin: "0 0 4px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>IA</p>
                <p style={{ color: T.brand, fontSize: 12, fontWeight: 500, margin: 0 }}>Claude</p>
              </div>
            </div>

            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.brand, fontSize: 12, fontWeight: 500 }}>
              Abrir Hub <ArrowRight size={14} strokeWidth={2.25}/>
            </div>
          </button>

          {/* Módulo Orçamentos — budget builder pré-campeonato */}
          <button
            onClick={() => onEnter("hub-orcamentos")}
            className="lm-card-hover"
            style={{
              background: T.surface || T.card,
              border: `1px solid ${T.border}`,
              borderRadius: RADIUS.lg,
              padding: 20,
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: T.shadow || "0 1px 3px rgba(0,0,0,0.06)",
              fontFamily: FONT.ui,
              color: T.text,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 9,
                  background: "rgba(101,179,46,0.10)",
                  color: T.brand || "#65B32E",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <Calculator size={20} strokeWidth={2.25}/>
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: T.text }}>Orçamentos</h4>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: T.textSm }}>Construção de orçamentos pré-campeonato até a aprovação</p>
                </div>
              </div>
              <span style={{
                background: "rgba(101,179,46,0.12)",
                border: "1px solid rgba(101,179,46,0.35)",
                color: T.brand || "#65B32E",
                borderRadius: RADIUS.pill,
                padding: "0 10px",
                height: 22,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
              }}>Novo</span>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
              paddingTop: 16,
              borderTop: `1px solid ${T.border}`,
            }}>
              <div>
                <p style={{ color: T.textSm, fontSize: 10, margin: "0 0 4px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Escopo</p>
                <p style={{ color: T.text, fontSize: 12, fontWeight: 500, margin: 0 }}>Pré-campeonato</p>
              </div>
              <div>
                <p style={{ color: T.textSm, fontSize: 10, margin: "0 0 4px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Sub-abas</p>
                <p className="num" style={{ color: T.text, fontSize: 12, fontWeight: 500, margin: 0, fontFamily: FONT.num }}>5 módulos</p>
              </div>
              <div>
                <p style={{ color: T.textSm, fontSize: 10, margin: "0 0 4px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Fluxo</p>
                <p style={{ color: T.brand, fontSize: 12, fontWeight: 500, margin: 0 }}>Rascunho → Aprovado</p>
              </div>
            </div>

            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.brand, fontSize: 12, fontWeight: 500 }}>
              Abrir Orçamentos <ArrowRight size={14} strokeWidth={2.25}/>
            </div>
          </button>
        </div>}

        <div style={{
          marginTop: 56,
          paddingTop: 24,
          borderTop: `1px solid ${T.border}`,
          textAlign: "center",
          color: T.textSm,
          fontSize: 11,
          letterSpacing: "0.04em",
          fontFamily: FONT.ui,
        }}>
          HUB Financeiro · Livemode Sports · Temporada 2026
        </div>
      </main>
    </div>
  );
}
