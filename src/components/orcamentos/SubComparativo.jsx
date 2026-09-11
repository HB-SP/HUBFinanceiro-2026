import { useMemo, useState } from "react";
import { FONT, iSty } from "../../constants";
import { Card, SectionHeader, Stat, Button } from "../ui";
import {
  diffBaseline, novaBaseline, GRUPOS_COMPARATIVO,
} from "../../data/orcamentos";
import { fmt, fmtK } from "../../utils";
import {
  GitCompareArrows, Wallet, TrendingUp, TrendingDown, Sparkles, Receipt,
  Pencil, Check, Plus, X, Briefcase, Layers, GripVertical, ArrowDownWideNarrow,
  ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown,
} from "lucide-react";

// Selos do comparativo. Aumento/redução já estão no sinal e na cor do delta —
// o selo só aparece para o que o número sozinho não conta.
const SELOS = {
  addon:         { label: "ADD-ON",        color: "#8b5cf6" },
  removido:      { label: "removido",      color: "#6b7280" },
  nao_realizado: { label: "não realizado", color: "#D97706" },   // orçado na base, gasto zero
  aumento:       { label: "↑ aumento",     color: "#DC2626" },
  reducao:       { label: "↓ redução",     color: "#16A34A" },
  igual:         { label: "=",             color: null },
};
const SELO_VISIVEL = new Set(["addon", "removido", "nao_realizado"]);

const Selo = ({ status, T, sempre }) => {
  const s = SELOS[status];
  if (!s || !s.color || (!sempre && !SELO_VISIVEL.has(status))) return null;
  return (
    <span style={{
      fontSize:9.5, fontWeight:700, letterSpacing:"0.06em", whiteSpace:"nowrap",
      padding:"2px 8px", borderRadius:999,
      background:`${s.color}1c`, color:s.color, border:`1px solid ${s.color}44`,
    }}>{s.label}</span>
  );
};

const COR_MAIS  = "#DC2626";
const COR_MENOS = "#16A34A";
const deltaCor = (delta, T) => delta > 0 ? COR_MAIS : delta < 0 ? COR_MENOS : T.textSm;
const fmtDelta = (delta) => Math.round(delta) === 0 ? "—" : `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))}`;
const fmtReal = (real) => real == null ? "—" : fmt(real);
const pctDelta = (delta, refTotal) => refTotal ? `${delta >= 0 ? "+" : ""}${((delta / refTotal) * 100).toFixed(1)}%` : null;

// Barra de magnitude do delta: cresce do centro, para a direita = custo a
// mais, para a esquerda = custo a menos. Escala pelo maior |Δ| do bloco.
const BarraDelta = ({ delta, maxAbs, T }) => {
  const pct = maxAbs > 0 ? Math.min(100, (Math.abs(delta) / maxAbs) * 100) : 0;
  const pos = delta > 0;
  return (
    <div style={{position:"relative",height:10,width:"100%",minWidth:120}}>
      <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:T.borderStrong||T.border}}/>
      {Math.round(delta) !== 0 && (
        <div style={{
          position:"absolute", top:1, bottom:1,
          left: pos ? "50%" : `${50 - pct / 2}%`,
          width: `${pct / 2}%`,
          background: pos ? COR_MAIS : COR_MENOS, opacity:0.75,
          borderRadius: pos ? "0 3px 3px 0" : "3px 0 0 3px",
        }}/>
      )}
    </div>
  );
};

// Resumo compacto exibido no cabeçalho quando a categoria está recolhida.
const ChipsResumo = ({ rows, T }) => {
  const contagem = { addon: 0, nao_realizado: 0, removido: 0, aumento: 0, reducao: 0 };
  rows.forEach(r => { if (contagem[r.status] !== undefined) contagem[r.status]++; });
  const chips = Object.entries(contagem).filter(([, n]) => n > 0);
  return (
    <span style={{display:"inline-flex",gap:6,marginLeft:10,alignItems:"center",flexWrap:"wrap"}}>
      <span style={{fontSize:10,fontWeight:500,color:T.textSm}}>
        {rows.length} {rows.length === 1 ? "linha" : "linhas"}
      </span>
      {chips.map(([status, n]) => {
        const s = SELOS[status];
        return (
          <span key={status} style={{
            fontSize:9.5, fontWeight:700, whiteSpace:"nowrap",
            padding:"1px 7px", borderRadius:999,
            background:`${s.color}1c`, color:s.color, border:`1px solid ${s.color}44`,
          }}>{n} {s.label}</span>
        );
      })}
    </span>
  );
};

const lsKeyRecolhidos = (orcId) => `hub_comparativo_recolhidos_${orcId}`;
const lsKeyRef = (orcId) => `hub_comparativo_ref_${orcId}`;
const SEM_ORDEM = {};   // referência estável: sem ordem manual salva

// Alternador da referência do delta/selo: orçado da base × realizado da base.
const RefToggle = ({ valor: refAtual, onChange, blLabel, T }) => {
  const opts = [{ k:"real", label:`vs realizado ${blLabel}` }, { k:"orc", label:`vs orçado ${blLabel}` }];
  return (
    <span style={{display:"inline-flex",border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
      {opts.map(o => {
        const on = o.k === refAtual;
        return (
          <button key={o.k} onClick={() => onChange(o.k)}
            style={{
              border:"none", cursor:"pointer", fontSize:11, fontWeight:on ? 700 : 500, padding:"5px 10px",
              background: on ? (T.info || "#2563EB") : "transparent", color: on ? "#fff" : T.textMd,
            }}>{o.label}</button>
        );
      })}
    </span>
  );
};

// ─── COMPARATIVO EDIÇÃO × EDIÇÃO ─────────────────────────────────────────────
// Base congelada (orçado aprovado + realizado da edição anterior) × orçamento
// atual, linha a linha. Quando a base tem realizado, o delta toma o REALIZADO
// como referência por padrão — é o argumento junto à entidade ("gastamos X,
// pedimos Y"). Leitura: a coluna de referência é a destacada; o delta traz o
// valor, o % e uma barra de magnitude; o selo só marca o que o número não diz.
export default function SubComparativo({ orc, setOrc, readOnly, T }) {
  const [editando, setEditando] = useState(false);
  // Explicações para a entidade: aparecem no link externo (#orcamento/<token>),
  // ao lado dos números de cada grupo. Guardadas em orc.explicacoes[chave]
  // (chave = grupo variável | "sec:<seção>" | "geral"). Só o admin escreve.
  const explicacoes = orc.explicacoes || {};
  const setExplicacao = (chave, texto) => setOrc(prev => {
    const ex = { ...(prev.explicacoes || {}) };
    if (String(texto || "").trim()) ex[chave] = texto; else delete ex[chave];
    return { ...prev, explicacoes: ex };
  });
  const [novaLinha, setNovaLinha] = useState(null); // { grupo|secao, label, valor, realizado, subKey }
  const [recolhidos, setRecolhidos] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(lsKeyRecolhidos(orc.id)) || "[]")); }
    catch { return new Set(); }
  });
  const [ref, setRef] = useState(() => {
    try { return localStorage.getItem(lsKeyRef(orc.id)) || "real"; } catch { return "real"; }
  });
  // Arrastar linhas: ordem manual por categoria, salva no próprio orçamento
  // (orc.comparativo.ordem[categoria] = [rowKey…]) — vale para todos que abrem.
  // Categoria sem ordem manual segue a automática (maior |Δ| primeiro).
  const [drag, setDrag] = useState(null);       // { g, key } linha sendo arrastada
  const [overKey, setOverKey] = useState(null); // linha sob o cursor (alvo)
  const ordemManual = orc.comparativo?.ordem || SEM_ORDEM;
  const temOrdemManual = Object.keys(ordemManual).length > 0;
  const IS = iSty(T);
  const bl = orc.baseline || null;
  const diff = useMemo(() => diffBaseline(orc), [orc]);
  const temReal = diff.temRealizado;
  const refReal = temReal && ref === "real";
  const mostraReal = temReal || editando;   // editando sem dado: coluna aparece pra preencher
  const nCols = mostraReal ? 7 : 6;
  const refLabel = refReal ? `realizado ${bl?.label || ""}` : `orçado ${bl?.label || ""}`;
  const corRef = refReal ? (T.warning || "#D97706") : (T.textMd || "#6b7280");
  const corAtual = T.info || "#2563EB";

  // Visão da tabela conforme a referência: unifica delta/status e ordena as
  // linhas pelo tamanho da diferença (o que mais pesa na conversa vem primeiro).
  const V = useMemo(() => {
    const mapRow = r => refReal ? { ...r, delta: r.deltaReal, status: r.statusReal } : r;
    const mapTot = t => refReal ? { ...t, delta: t.deltaReal } : t;
    const porDelta = rows => [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    // Com ordem manual: segue a lista salva; linha nova (fora da lista) entra no fim, por |Δ|.
    const ordena = (rows, gKey) => {
      const base = porDelta(rows);
      const lista = ordemManual[gKey];
      if (!lista) return base;
      const pos = new Map(lista.map((k, i) => [k, i]));
      return base.sort((a, b) => (pos.has(a.key) ? pos.get(a.key) : 1e9) - (pos.has(b.key) ? pos.get(b.key) : 1e9));
    };
    return {
      grupos: diff.grupos.map(g => ({ ...mapTot(g), gKey: g.key, rows: ordena(g.rows.map(mapRow), g.key) })),
      fixos:  diff.fixos.map(s => ({ ...mapTot(s), gKey: `sec:${s.secao}`, rows: ordena(s.rows.map(mapRow), `sec:${s.secao}`) })),
      totalBase: diff.totalBase, totalReal: diff.totalReal, totalAtual: diff.totalAtual,
      totalRef: refReal ? diff.totalReal : diff.totalBase,
      delta: refReal ? diff.deltaReal : diff.delta,
      numAddons: refReal ? diff.numAddonsReal : diff.numAddons,
    };
  }, [diff, refReal, ordemManual]);

  // ── Drag & drop (dentro da mesma categoria) ──
  const podeArrastar = !readOnly;
  const salvaOrdem = (gKey, lista) => setOrc(prev => ({
    ...prev,
    comparativo: { ...(prev.comparativo || {}), ordem: { ...((prev.comparativo || {}).ordem || {}), [gKey]: lista } },
  }));
  const limpaOrdem = () => setOrc(prev => ({ ...prev, comparativo: { ...(prev.comparativo || {}), ordem: {} } }));
  const onDragStartRow = (g, key) => (e) => {
    setDrag({ g: g.gKey, key });
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", key); } catch {}
  };
  const onDragOverRow = (g, key) => (e) => {
    if (!drag || drag.g !== g.gKey) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overKey !== key) setOverKey(key);
  };
  const onDropRow = (g, key) => (e) => {
    if (!drag || drag.g !== g.gKey) return;
    e.preventDefault();
    const atual = g.rows.map(r => r.key);
    if (drag.key !== key) {
      const semDrag = atual.filter(k => k !== drag.key);
      const idx = semDrag.indexOf(key);
      semDrag.splice(idx < 0 ? semDrag.length : idx, 0, drag.key);  // solta ANTES da linha alvo
      salvaOrdem(g.gKey, semDrag);
    }
    setDrag(null); setOverKey(null);
  };
  const onDragEndRow = () => { setDrag(null); setOverKey(null); };

  const salvaRecolhidos = (next) => {
    try { localStorage.setItem(lsKeyRecolhidos(orc.id), JSON.stringify([...next])); } catch {}
    return next;
  };
  const trocaRef = (k) => { setRef(k); try { localStorage.setItem(lsKeyRef(orc.id), k); } catch {} };
  const estaAberto = (chave) => editando || !recolhidos.has(chave);
  const toggleRecolhido = (chave) => {
    if (editando) return;
    setRecolhidos(prev => {
      const next = new Set(prev);
      next.has(chave) ? next.delete(chave) : next.add(chave);
      return salvaRecolhidos(next);
    });
  };

  const patchBaseline = (fn) => setOrc(prev => prev.baseline ? ({ ...prev, baseline: fn(prev.baseline) }) : prev);
  const setValorBase = (baseItemId, campo, valor) => patchBaseline(b => ({
    ...b,
    [campo]: b[campo].map(i => i.id === baseItemId ? { ...i, valor: valor === "" ? 0 : (Number(valor) || 0) } : i),
  }));
  // Realizado vazio = "sem dado" (null), diferente de zero (= orçado e não gasto).
  const setRealBase = (baseItemId, campo, valor) => patchBaseline(b => ({
    ...b,
    [campo]: b[campo].map(i => i.id === baseItemId ? { ...i, realizado: String(valor).trim() === "" ? null : (Number(valor) || 0) } : i),
  }));
  const removeBase = (baseItemId, campo) => patchBaseline(b => ({
    ...b, [campo]: b[campo].filter(i => i.id !== baseItemId),
  }));
  const addLinha = () => {
    if (!novaLinha || !String(novaLinha.label || "").trim()) return;
    const id = `bl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const realizado = String(novaLinha.realizado ?? "").trim() === "" ? null : (Number(novaLinha.realizado) || 0);
    if (novaLinha.tipo === "fixo") {
      patchBaseline(b => ({ ...b, fixos: [...b.fixos, { id, secao: novaLinha.secao, nome: novaLinha.label.trim(), valor: Number(novaLinha.valor) || 0, realizado }] }));
    } else {
      patchBaseline(b => ({ ...b, itens: [...b.itens, {
        id, grupo: novaLinha.grupo, label: novaLinha.label.trim(),
        subKey: novaLinha.subKey || null, valor: Number(novaLinha.valor) || 0, realizado,
      }] }));
    }
    setNovaLinha(null);
  };

  // ── Sem base ainda: estado vazio ──
  if (!bl) {
    const edicaoAnterior = String((parseInt(orc.meta.edicao) || 0) - 1 || "anterior");
    return (
      <Card T={T}>
        <div style={{padding:"48px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:12,textAlign:"center"}}>
          <GitCompareArrows size={36} color={T.textSm}/>
          <p style={{margin:0,fontSize:15,fontWeight:700,color:T.text}}>Nenhuma base de comparação ainda</p>
          <p style={{margin:0,fontSize:12.5,color:T.textMd,maxWidth:480,lineHeight:1.6}}>
            A base é o orçamento de referência da edição anterior (ex: {orc.meta.nome} {edicaoAnterior}) —
            o orçado aprovado e, quando houver, o realizado. Com ela, este comparativo mostra linha a linha
            o que mudou e marca automaticamente os <b>add-ons</b>, aumentos, reduções e remoções da edição atual.
          </p>
          {!readOnly && (
            <Button T={T} variant="primary" size="md" icon={Plus}
              onClick={() => setOrc(prev => ({ ...prev, baseline: novaBaseline(`${prev.meta.nome} ${edicaoAnterior}`) }))}>
              Criar base {orc.meta.nome} {edicaoAnterior}
            </Button>
          )}
        </div>
      </Card>
    );
  }

  // ── Estilos de célula ──────────────────────────────────────────────────────
  // Três colunas de valor com pesos distintos: a REFERÊNCIA é a mais forte
  // (fundo tingido), a atual é azul (orçado), a outra coluna da base é apagada.
  const PADX = 12;
  const tintRef = refReal ? "rgba(217,119,6,0.07)" : "rgba(107,114,128,0.08)";
  const numBase = (kind, { peso = "row" } = {}) => {
    const isRef = kind === (refReal ? "real" : "base");
    const forte = peso !== "row";
    const st = { padding:`${peso === "row" ? 7 : 10}px ${PADX}px`, textAlign:"right", whiteSpace:"nowrap", fontFamily:FONT.num, fontSize: forte ? 12.5 : 12 };
    if (kind === "atual") return { ...st, color:corAtual, fontWeight:700 };
    if (isRef) return { ...st, color:T.text, fontWeight: forte ? 700 : 600, background:tintRef };
    return { ...st, color:T.textSm, fontWeight:400, fontSize: forte ? 11.5 : 11 };
  };
  const thBase = (kind, left) => {
    const isRef = kind && kind === (refReal ? "real" : "base");
    return {
      padding:`11px ${PADX}px`, textAlign:left ? "left" : "right", whiteSpace:"nowrap",
      fontSize:10, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase",
      color: kind === "atual" ? corAtual : isRef ? T.text : T.textSm,
      background: isRef ? tintRef : undefined,
      borderBottom:`1px solid ${T.border}`,
    };
  };
  const DeltaCell = ({ delta, refValor, peso = "row" }) => {
    const p = pctDelta(delta, refValor);
    return (
      <td className="num" style={{padding:`${peso === "row" ? 5 : 8}px ${PADX}px`,textAlign:"right",whiteSpace:"nowrap",fontFamily:FONT.num,lineHeight:1.15}}>
        <div style={{fontSize: peso === "row" ? 12 : 13, fontWeight: peso === "row" ? 600 : 700, color:deltaCor(delta, T)}}>{fmtDelta(delta)}</div>
        {p && Math.round(delta) !== 0 && <div style={{fontSize:9.5,color:T.textSm,marginTop:1}}>{p}</div>}
      </td>
    );
  };
  const tdBarra = { padding:`7px ${PADX}px`, minWidth:160 };

  // Linha de serviço (fixo pareado por baseSubKey edita a base em `itens`).
  const renderRow = (row, g, campoBaseGrupo, maxAbs, idx) => {
    const campoBase = row.campoBase || campoBaseGrupo;
    const editavel = editando && row.baseItemId;
    const removidoOuSemAtual = row.status === "removido";
    const arrastando = drag?.key === row.key;
    const alvo = overKey === row.key && drag && drag.key !== row.key;
    const btnRemover = editavel ? (
      <button title="Remover linha da base" onClick={() => removeBase(row.baseItemId, campoBase)}
        style={{border:"none",background:"none",cursor:"pointer",color:T.danger||"#DC2626",padding:2,display:"flex"}}>
        <X size={13}/>
      </button>
    ) : null;
    const inputBase = (valor, onBlur, placeholder) => (
      <input defaultValue={valor} placeholder={placeholder} onBlur={onBlur} inputMode="numeric"
        style={{...IS, width:104, textAlign:"right", padding:"3px 6px", fontSize:11.5}}/>
    );
    return (
    <tr key={row.key}
      onDragOver={podeArrastar ? onDragOverRow(g, row.key) : undefined}
      onDrop={podeArrastar ? onDropRow(g, row.key) : undefined}
      style={{
        borderTop: alvo ? `2px solid ${corAtual}` : `1px solid ${T.border}`,
        background: arrastando ? `${corAtual}14` : idx % 2 ? (T.surfaceAlt ? `${T.surfaceAlt}66` : "transparent") : "transparent",
        opacity: arrastando ? 0.45 : removidoOuSemAtual ? 0.6 : 1,
      }}>
      <td style={{padding:`7px ${PADX}px 7px 14px`,color:T.text,fontSize:12,fontWeight:500,lineHeight:1.25}}>
        <span style={{display:"inline-flex",alignItems:"flex-start",gap:6}}>
          {podeArrastar ? (
            <span draggable onDragStart={onDragStartRow(g, row.key)} onDragEnd={onDragEndRow}
              title="Arrastar para reordenar dentro da categoria"
              style={{cursor:"grab",color:T.textSm,opacity:0.55,display:"inline-flex",marginTop:1,flexShrink:0}}>
              <GripVertical size={13}/>
            </span>
          ) : <span style={{width:13,flexShrink:0}}/>}
          <span>
        {row.label}
        {row.labelBase && row.labelBase.trim().toLowerCase() !== String(row.label).trim().toLowerCase() && (
          <div style={{fontSize:9.5,color:T.textSm,marginTop:1}}
            title={row.baseItens?.length > 1 ? row.baseItens.map(i => `${i.label}: ${fmt(i.valor)}${i.realizado != null ? ` · realizado ${fmt(i.realizado)}` : ""}`).join("\n") : undefined}>
            na base: {row.labelBase}{row.baseItens?.length > 1 ? ` (${row.baseItens.length} linhas)` : ""}
          </div>
        )}
          </span>
        </span>
      </td>
      <td className="num" style={numBase("base")}>
        {editavel ? (
          <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
            {inputBase(row.base || "", e => setValorBase(row.baseItemId, campoBase, e.target.value))}
            {!mostraReal && btnRemover}
          </span>
        ) : (row.base ? fmt(row.base) : "—")}
      </td>
      {mostraReal && (
        <td className="num" style={numBase("real")}>
          {editavel ? (
            <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
              {inputBase(row.real ?? "", e => setRealBase(row.baseItemId, campoBase, e.target.value), "sem dado")}
              {btnRemover}
            </span>
          ) : fmtReal(row.real)}
        </td>
      )}
      <td className="num" style={numBase("atual")}>{row.atual ? fmt(row.atual) : "—"}</td>
      <DeltaCell delta={row.delta} refValor={refReal ? row.real : row.base}/>
      <td style={tdBarra}><BarraDelta delta={row.delta} maxAbs={maxAbs} T={T}/></td>
      <td style={{padding:`7px ${PADX}px`,textAlign:"left",whiteSpace:"nowrap"}}><Selo status={row.status} T={T}/></td>
    </tr>
  ); };

  // Cabeçalho de categoria (grupo variável) — clicável para recolher.
  const renderExplicacao = (chave, color) => {
    const texto = explicacoes[chave] || "";
    if (readOnly && !texto) return null;
    return (
      <tr key={`ex_${chave}`} style={{ background: T.card }}>
        <td colSpan={99} style={{ padding: `6px ${PADX}px 12px ${PADX + 18}px`, borderLeft: `3px solid ${color}55` }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: T.textSm, marginBottom: 4 }}>
            Explicação para a entidade <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· aparece no link externo</span>
          </div>
          {readOnly
            ? <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: T.text, whiteSpace: "pre-wrap" }}>{texto}</p>
            : <textarea value={texto} onChange={e => setExplicacao(chave, e.target.value)} rows={texto.split("\n").length + 1}
                placeholder="Por que este grupo muda em relação à edição anterior? (texto livre — fica visível para quem abrir o link externo)"
                style={{ ...iSty(T), width: "100%", minHeight: 56, resize: "vertical", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit" }}/>}
        </td>
      </tr>
    );
  };

  const renderHeaderGrupo = (titulo, color, tot, { chave, rows } = {}) => {
    const aberto = !chave || estaAberto(chave);
    const clicavel = !!chave && !editando;
    const Chevron = aberto ? ChevronDown : ChevronRight;
    return (
      <tr key={`hd_${titulo}`}
        onClick={clicavel ? () => toggleRecolhido(chave) : undefined}
        title={clicavel ? (aberto ? "Recolher categoria" : "Expandir categoria") : undefined}
        style={{
          borderTop:`2px solid ${T.borderStrong||T.border}`, background:T.surfaceAlt||T.bg,
          cursor: clicavel ? "pointer" : "default", userSelect:"none",
        }}>
        <td style={{padding:`9px ${PADX}px`,fontWeight:700,whiteSpace:"nowrap",color:T.text,fontSize:12}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
            {chave && <Chevron size={14} color={T.textSm} style={{flexShrink:0,opacity:editando ? 0.35 : 1}}/>}
            <span style={{width:8,height:8,borderRadius:2,background:color,flexShrink:0}}/>
            {titulo}
            {!aberto && rows && rows.length > 0 && <ChipsResumo rows={rows} T={T}/>}
          </span>
        </td>
        <td className="num" style={numBase("base", { peso:"grupo" })}>{fmt(tot.totalBase)}</td>
        {mostraReal && <td className="num" style={numBase("real", { peso:"grupo" })}>{fmt(tot.totalReal)}</td>}
        <td className="num" style={numBase("atual", { peso:"grupo" })}>{fmt(tot.totalAtual)}</td>
        <DeltaCell delta={tot.delta} refValor={refReal ? tot.totalReal : tot.totalBase} peso="grupo"/>
        <td colSpan={2}/>
      </tr>
    );
  };

  const renderAddLinha = (tipo, grupoKey, secao) => {
    const aberta = novaLinha && ((tipo === "fixo" && novaLinha.secao === secao && novaLinha.tipo === "fixo")
      || (tipo !== "fixo" && novaLinha.grupo === grupoKey && novaLinha.tipo !== "fixo"));
    if (!editando) return null;
    if (!aberta) return (
      <tr key={`add_${tipo}_${grupoKey || secao}`}>
        <td colSpan={nCols} style={{padding:`4px ${PADX}px 8px 36px`}}>
          <button
            onClick={() => setNovaLinha(tipo === "fixo" ? { tipo:"fixo", secao, label:"", valor:"", realizado:"" } : { grupo:grupoKey, label:"", valor:"", realizado:"", subKey:"" })}
            style={{border:`1px dashed ${T.border}`,background:"none",cursor:"pointer",color:T.textMd,fontSize:11,padding:"4px 10px",borderRadius:6,display:"inline-flex",alignItems:"center",gap:6}}>
            <Plus size={12}/> linha da base
          </button>
        </td>
      </tr>
    );
    const grupo = GRUPOS_COMPARATIVO.find(g => g.key === grupoKey);
    const soNum = v => v.replace(/[^0-9.,]/g, "");
    return (
      <tr key={`add_${tipo}_${grupoKey || secao}`} style={{background:T.surfaceAlt||T.bg}}>
        <td colSpan={nCols} style={{padding:`8px ${PADX}px 12px 36px`}}>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <input autoFocus placeholder="Nome do serviço na base" value={novaLinha.label}
              onChange={e => setNovaLinha(n => ({ ...n, label: e.target.value }))}
              style={{...IS, width:240, padding:"5px 10px", fontSize:12}}/>
            <input placeholder={`Orçado ${bl.label}`} value={novaLinha.valor} inputMode="numeric"
              onChange={e => setNovaLinha(n => ({ ...n, valor: soNum(e.target.value) }))}
              style={{...IS, width:130, padding:"5px 10px", fontSize:12, textAlign:"right"}}/>
            <input placeholder={`Realizado ${bl.label}`} value={novaLinha.realizado} inputMode="numeric"
              onChange={e => setNovaLinha(n => ({ ...n, realizado: soNum(e.target.value) }))}
              style={{...IS, width:130, padding:"5px 10px", fontSize:12, textAlign:"right"}}/>
            {tipo !== "fixo" && (
              <select value={novaLinha.subKey} onChange={e => setNovaLinha(n => ({ ...n, subKey: e.target.value }))}
                style={{...IS, width:190, padding:"5px 10px", fontSize:12}}>
                <option value="">— sem serviço equivalente —</option>
                {(grupo?.subs || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            )}
            <Button T={T} variant="primary" size="sm" icon={Check} onClick={addLinha}>Adicionar</Button>
            <Button T={T} variant="secondary" size="sm" onClick={() => setNovaLinha(null)}>Cancelar</Button>
          </div>
        </td>
      </tr>
    );
  };

  const chavesTopo = [
    ...V.grupos.filter(g => g.rows.length > 0).map(g => g.key),
    ...(V.fixos.length > 0 ? ["fixos"] : []),
  ];
  const tudoRecolhido = chavesTopo.length > 0 && chavesTopo.every(k => recolhidos.has(k));

  // ── Blocos: custos VARIÁVEIS (por jogo) × custos FIXOS (por edição) ──
  const soma = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const mkBloco = (key, label, sub, color, secs) => {
    const rows = secs.flatMap(g => g.rows);
    const b = {
      key, label, sub, color, rows,
      totalBase: soma(secs, "totalBase"), totalReal: soma(secs, "totalReal"), totalAtual: soma(secs, "totalAtual"),
      maxAbs: Math.max(1, ...rows.map(r => Math.abs(r.delta))),   // escala da barra dentro do bloco
    };
    b.totalRef = refReal ? b.totalReal : b.totalBase;
    b.delta = b.totalAtual - b.totalRef;
    return b;
  };
  const blocos = {
    variaveis: mkBloco("variaveis", "Custos Variáveis", `por jogo · ${(orc.jogos || []).length} jogos na edição atual`, corAtual, V.grupos),
    fixos:     mkBloco("fixos", "Custos Fixos", "por edição · pessoal fixo, serviços e reembolsos", "#a855f7", V.fixos),
  };
  const pct = (parte, total) => total > 0 ? `${Math.round((parte / total) * 100)}%` : "—";

  // Faixa divisória de bloco: título, totais e (opcional) recolher o bloco inteiro.
  const renderBloco = (b, { chave, icon: Icon } = {}) => {
    const aberto = !chave || estaAberto(chave);
    const clicavel = !!chave && !editando;
    const Chevron = aberto ? ChevronDown : ChevronRight;
    const cel = (kind, valor, total) => (
      <td className="num" style={{...numBase(kind, { peso:"bloco" }), background:undefined, lineHeight:1.15}}>
        {fmt(valor)}<div style={{fontSize:9.5,fontWeight:500,color:T.textSm}}>{pct(valor, total)} do total</div>
      </td>
    );
    return (
      <tr key={`bloco_${b.key}`}
        onClick={clicavel ? () => toggleRecolhido(chave) : undefined}
        title={clicavel ? (aberto ? "Recolher bloco" : "Expandir bloco") : undefined}
        style={{
          borderTop:`3px solid ${b.color}`, background:`${b.color}12`,
          cursor: clicavel ? "pointer" : "default", userSelect:"none",
        }}>
        <td style={{padding:`11px ${PADX}px`,whiteSpace:"nowrap"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:10}}>
            {chave && <Chevron size={15} color={b.color} style={{flexShrink:0,opacity:editando ? 0.35 : 1}}/>}
            {Icon && <Icon size={15} color={b.color} style={{flexShrink:0}}/>}
            <span style={{display:"flex",flexDirection:"column",gap:1}}>
              <span style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:b.color}}>{b.label}</span>
              <span style={{fontSize:10,color:T.textSm}}>{b.sub}</span>
            </span>
            {!aberto && b.rows.length > 0 && <ChipsResumo rows={b.rows} T={T}/>}
          </span>
        </td>
        {cel("base", b.totalBase, V.totalBase)}
        {mostraReal && cel("real", b.totalReal, V.totalReal)}
        {cel("atual", b.totalAtual, V.totalAtual)}
        <DeltaCell delta={b.delta} refValor={b.totalRef} peso="bloco"/>
        <td colSpan={2}/>
      </tr>
    );
  };

  // Linha de fechamento do bloco (subtotal).
  const renderSubtotal = (b) => (
    <tr key={`sub_${b.key}`} style={{background:`${b.color}0c`,borderTop:`1px solid ${b.color}55`}}>
      <td style={{padding:`8px ${PADX}px`,fontSize:10.5,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:b.color,whiteSpace:"nowrap"}}>
        Subtotal {b.label.replace("Custos ", "")}
      </td>
      <td className="num" style={{...numBase("base", { peso:"grupo" }), background:undefined}}>{fmt(b.totalBase)}</td>
      {mostraReal && <td className="num" style={{...numBase("real", { peso:"grupo" }), background:undefined}}>{fmt(b.totalReal)}</td>}
      <td className="num" style={numBase("atual", { peso:"grupo" })}>{fmt(b.totalAtual)}</td>
      <DeltaCell delta={b.delta} refValor={b.totalRef} peso="grupo"/>
      <td colSpan={2}/>
    </tr>
  );

  const atualLabel = `${orc.meta.nome} ${orc.meta.edicao}`;
  const TagRef = () => (
    <span style={{marginLeft:6,fontSize:8.5,fontWeight:800,letterSpacing:"0.08em",padding:"1px 5px",borderRadius:4,background:corRef,color:"#fff",verticalAlign:"middle"}}>REF</span>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      {/* ── KPIs ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
        <Stat T={T} label={`Orçado · ${bl.label}`} value={fmtK(V.totalBase)} sub={fmt(V.totalBase)} color={T.textMd||"#6b7280"} icon={Wallet}/>
        {temReal && (
          <Stat T={T} label={`Realizado · ${bl.label}`} value={fmtK(V.totalReal)}
            sub={`${fmt(V.totalReal)} · ${pctDelta(V.totalReal - V.totalBase, V.totalBase)} vs orçado`}
            color={T.warning || "#D97706"} icon={Receipt}/>
        )}
        <Stat T={T} label={`Orçado · ${atualLabel}`} value={fmtK(V.totalAtual)} sub={fmt(V.totalAtual)} color={corAtual} icon={Wallet}/>
        <Stat T={T} label={`Variação vs ${refLabel}`} value={fmtDelta(V.delta)}
          sub={V.totalRef ? `${pctDelta(V.delta, V.totalRef)} sobre ${fmtK(V.totalRef)}` : "—"}
          color={deltaCor(V.delta, T)} icon={V.delta >= 0 ? TrendingUp : TrendingDown}/>
        <Stat T={T} label="Add-ons" value={String(V.numAddons)} sub={refReal ? "Sem gasto nem orçado na base" : "Serviços novos nesta edição"} color="#8b5cf6" icon={Sparkles}/>
      </div>

      {/* ── Texto de abertura para a entidade (link externo) ── */}
      {(!readOnly || explicacoes.geral) && (
        <Card T={T}>
          <div style={{ padding: "14px 20px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: T.textSm, marginBottom: 6 }}>
              Texto de abertura para a entidade <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· aparece no topo do link externo, antes do comparativo</span>
            </div>
            {readOnly
              ? <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: T.text, whiteSpace: "pre-wrap" }}>{explicacoes.geral}</p>
              : <textarea value={explicacoes.geral || ""} onChange={e => setExplicacao("geral", e.target.value)} rows={3}
                  placeholder="Contexto geral da proposta: o que muda nesta edição e por quê."
                  style={{ ...iSty(T), width: "100%", minHeight: 64, resize: "vertical", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit" }}/>}
          </div>
        </Card>
      )}

      {/* ── Tabela comparativa ── */}
      <Card T={T}>
        <SectionHeader
          T={T}
          title={`Comparativo · ${bl.label} × ${atualLabel}`}
          subtitle={temReal
            ? `Δ = orçado ${orc.meta.edicao} − ${refLabel} · ${temOrdemManual ? "ordem manual (arraste pela alça)" : "linhas pela maior diferença; arraste pela alça para reordenar"} · barra = magnitude dentro do bloco`
            : "Linha a linha por serviço — selo automático: add-on, aumento, redução ou removido"}
          icon={GitCompareArrows}
          right={
            <span style={{display:"inline-flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
              {temReal && <RefToggle valor={ref} onChange={trocaRef} blLabel={bl.label} T={T}/>}
              {!readOnly && temOrdemManual && (
                <Button T={T} variant="secondary" size="sm" icon={ArrowDownWideNarrow}
                  title="Desfaz a ordem manual de todas as categorias e volta a ordenar pela maior diferença"
                  onClick={limpaOrdem}>
                  Ordem automática
                </Button>
              )}
              {!editando && (
                <Button T={T} variant="secondary" size="sm" icon={tudoRecolhido ? ChevronsUpDown : ChevronsDownUp}
                  onClick={() => setRecolhidos(() => salvaRecolhidos(tudoRecolhido ? new Set() : new Set(chavesTopo)))}>
                  {tudoRecolhido ? "Expandir tudo" : "Recolher tudo"}
                </Button>
              )}
              {!readOnly && (
                <Button T={T} variant={editando ? "primary" : "secondary"} size="sm" icon={editando ? Check : Pencil}
                  onClick={() => { setEditando(v => !v); setNovaLinha(null); }}>
                  {editando ? "Concluir edição" : "Editar base"}
                </Button>
              )}
            </span>
          }
        />
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:mostraReal ? 900 : 760}}>
            <thead>
              <tr style={{background:T.surfaceAlt||T.bg}}>
                <th style={{...thBase(null, true), width:"26%"}}>Serviço</th>
                <th style={thBase("base")}>Orçado {bl.label}{!refReal && <TagRef/>}</th>
                {mostraReal && <th style={thBase("real")}>Realizado {bl.label}{refReal && <TagRef/>}</th>}
                <th style={thBase("atual")}>Orçado {atualLabel}</th>
                <th style={thBase(null)}>Δ vs {refReal ? "realizado" : "orçado"}</th>
                <th style={{...thBase(null), textAlign:"center"}}>menos ← · → mais</th>
                <th style={{...thBase(null, true)}}>Selo</th>
              </tr>
            </thead>
            <tbody>
              {/* ══ BLOCO 1 · CUSTOS VARIÁVEIS (por jogo) ══ */}
              {renderBloco(blocos.variaveis, { chave:"variaveis", icon:Layers })}
              {estaAberto("variaveis") && V.grupos.map(g => (g.rows.length > 0 || editando) ? [
                renderHeaderGrupo(g.label, g.color, g, { chave:g.key, rows:g.rows }),
                ...(estaAberto(g.key) ? [
                  renderExplicacao(g.key, g.color),
                  ...g.rows.map((row, i) => renderRow(row, g, "itens", blocos.variaveis.maxAbs, i)),
                  renderAddLinha("var", g.key),
                ] : []),
              ] : null)}
              {renderSubtotal(blocos.variaveis)}

              {/* ══ BLOCO 2 · CUSTOS FIXOS (por edição) ══ */}
              {(V.fixos.length > 0 || editando) && renderBloco(blocos.fixos, { chave:"fixos", icon:Briefcase })}
              {estaAberto("fixos") && V.fixos.map(sec => {
                const chaveSec = `sec:${sec.secao}`;
                const secAberta = estaAberto(chaveSec);
                return [
                  renderHeaderGrupo(sec.secao, "#a855f7", sec, { chave:chaveSec, rows:sec.rows }),
                  ...(secAberta ? [
                    renderExplicacao(chaveSec, "#a855f7"),
                    ...sec.rows.map((row, i) => renderRow(row, sec, "fixos", blocos.fixos.maxAbs, i)),
                    renderAddLinha("fixo", null, sec.secao),
                  ] : []),
                ];
              })}
              {editando && V.fixos.length === 0 && renderAddLinha("fixo", null, "Serviços")}
              {(V.fixos.length > 0 || editando) && renderSubtotal(blocos.fixos)}

              <tr style={{borderTop:`3px solid ${T.borderStrong||T.border}`,background:T.surfaceAlt||T.bg,fontWeight:700}}>
                <td style={{padding:`13px ${PADX}px`,color:T.text,fontSize:12,letterSpacing:"0.04em",textTransform:"uppercase"}}>Total Geral</td>
                <td className="num" style={{...numBase("base", { peso:"bloco" }), fontSize:14}}>{fmt(V.totalBase)}</td>
                {mostraReal && <td className="num" style={{...numBase("real", { peso:"bloco" }), fontSize:14}}>{fmt(V.totalReal)}</td>}
                <td className="num" style={{...numBase("atual", { peso:"bloco" }), fontSize:14}}>{fmt(V.totalAtual)}</td>
                <DeltaCell delta={V.delta} refValor={V.totalRef} peso="bloco"/>
                <td colSpan={2}/>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{margin:0,padding:"10px 16px 14px",fontSize:11,color:T.textSm,lineHeight:1.5}}>
          Base importada em {new Date(bl.importadoEm).toLocaleDateString("pt-BR")} — orçado e realizado da base são
          congelados e editáveis aqui (realizado em branco = sem dado); o lado atual é sempre o orçamento vivo
          (jogos × premissas + serviços fixos). Selo só para o que o número não conta: add-on, removido, não realizado.
        </p>
      </Card>
    </div>
  );
}
