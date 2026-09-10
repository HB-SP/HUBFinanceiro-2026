import { useMemo, useState } from "react";
import { FONT, iSty } from "../../constants";
import { Card, SectionHeader, Stat, Button } from "../ui";
import {
  diffBaseline, novaBaseline, baselineTemRealizado, GRUPOS_COMPARATIVO,
} from "../../data/orcamentos";
import { fmt, fmtK } from "../../utils";
import {
  GitCompareArrows, Wallet, TrendingUp, TrendingDown, Sparkles, Receipt,
  Pencil, Check, Plus, X, Briefcase, Layers,
  ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown,
} from "lucide-react";

// Selos automáticos do comparativo — a cor fala de CUSTO (aumento = vermelho).
const SELOS = {
  addon:         { label: "ADD-ON",        color: "#8b5cf6" },
  aumento:       { label: "↑ aumento",     color: "#DC2626" },
  reducao:       { label: "↓ redução",     color: "#16A34A" },
  removido:      { label: "removido",      color: "#6b7280" },
  nao_realizado: { label: "não realizado", color: "#D97706" },   // orçado na base, gasto zero
  igual:         { label: "=",             color: null },
};

const Selo = ({ status, T }) => {
  const s = SELOS[status];
  if (!s || !s.color) return <span style={{fontSize:11,color:T.textSm}}>=</span>;
  return (
    <span style={{
      fontSize:9.5, fontWeight:700, letterSpacing:"0.06em", whiteSpace:"nowrap",
      padding:"2px 8px", borderRadius:999,
      background:`${s.color}1c`, color:s.color, border:`1px solid ${s.color}44`,
    }}>{s.label}</span>
  );
};

const deltaCor = (delta, T) => delta > 0 ? "#DC2626" : delta < 0 ? "#16A34A" : T.textSm;
// Selo do bloco inteiro (variáveis/fixos): só sinal do total, sem "add-on".
const statusBloco = (b) => b.delta > 0 ? "aumento" : b.delta < 0 ? "reducao" : "igual";
const fmtDelta = (delta) => delta === 0 ? "—" : `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))}`;
const fmtReal = (real) => real == null ? "—" : fmt(real);

// Resumo compacto exibido no cabeçalho quando a categoria está recolhida:
// nº de linhas + contagem por selo, para não perder o sinal do que mudou.
const ChipsResumo = ({ rows, T }) => {
  const contagem = { addon: 0, aumento: 0, reducao: 0, removido: 0, nao_realizado: 0 };
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

const thStyle = (T, left, destaque) => ({
  padding:"11px 16px",
  textAlign:left ? "left" : "right",
  color: destaque ? T.text : T.textSm,
  fontSize:10,
  fontWeight:700,
  letterSpacing:"0.06em",
  textTransform:"uppercase",
  whiteSpace:"nowrap",
  borderBottom:`1px solid ${T.border}`,
});

// Alternador da referência do delta/selo: orçado da base × realizado da base.
const RefToggle = ({ valor: refAtual, onChange, blLabel, T }) => {
  const opts = [{ k:"real", label:`Δ vs realizado ${blLabel}` }, { k:"orc", label:`Δ vs orçado ${blLabel}` }];
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
// atual, linha a linha, com selo automático. A base é editável aqui mesmo.
// Quando a base tem realizado, o delta e o selo tomam o REALIZADO como
// referência por padrão — é o argumento junto à entidade ("gastamos X, pedimos Y").
export default function SubComparativo({ orc, setOrc, readOnly, T }) {
  const [editando, setEditando] = useState(false);
  const [novaLinha, setNovaLinha] = useState(null); // { grupo|secao, label, valor, realizado, subKey }
  // Categorias recolhidas (chaves de grupo, "fixos" e "sec:{seção}") — persiste
  // por orçamento no localStorage; no modo edição tudo fica sempre aberto.
  const [recolhidos, setRecolhidos] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(lsKeyRecolhidos(orc.id)) || "[]")); }
    catch { return new Set(); }
  });
  const [ref, setRef] = useState(() => {
    try { return localStorage.getItem(lsKeyRef(orc.id)) || "real"; } catch { return "real"; }
  });
  const IS = iSty(T);
  const bl = orc.baseline || null;
  const diff = useMemo(() => diffBaseline(orc), [orc]);
  const temReal = diff.temRealizado;
  const refReal = temReal && ref === "real";
  const mostraReal = temReal || editando;   // editando sem dado: coluna aparece pra preencher
  const nCols = mostraReal ? 6 : 5;
  const refLabel = refReal ? `realizado ${bl?.label || ""}` : `orçado ${bl?.label || ""}`;

  // Visão da tabela conforme a referência escolhida: unifica delta/status.
  const V = useMemo(() => {
    const mapRow = r => refReal ? { ...r, delta: r.deltaReal, status: r.statusReal } : r;
    const mapTot = t => refReal ? { ...t, delta: t.deltaReal } : t;
    return {
      grupos: diff.grupos.map(g => ({ ...mapTot(g), rows: g.rows.map(mapRow) })),
      fixos:  diff.fixos.map(s => ({ ...mapTot(s), rows: s.rows.map(mapRow) })),
      totalBase: diff.totalBase, totalReal: diff.totalReal, totalAtual: diff.totalAtual,
      totalRef: refReal ? diff.totalReal : diff.totalBase,
      delta: refReal ? diff.deltaReal : diff.delta,
      numAddons: refReal ? diff.numAddonsReal : diff.numAddons,
    };
  }, [diff, refReal]);

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

  const tdNum = (extra = {}) => ({ padding:"10px 16px", textAlign:"right", whiteSpace:"nowrap", fontSize:12.5, fontFamily:FONT.num, ...extra });

  // Fixo pareado com linha de JOGO da base (baseSubKey) edita a base em `itens`, não em `fixos`.
  const renderRow = (row, g, campoBaseGrupo) => {
    const campoBase = row.campoBase || campoBaseGrupo;
    const editavel = editando && row.baseItemId;
    return (
    <tr key={row.key} style={{borderTop:`1px solid ${T.border}`,opacity:row.status === "removido" ? 0.65 : 1}}>
      <td style={{padding:"10px 16px 10px 40px",whiteSpace:"nowrap",color:T.text,fontSize:12.5,fontWeight:500}}>
        {row.label}
        {row.labelBase && row.labelBase.trim().toLowerCase() !== String(row.label).trim().toLowerCase() && (
          <span style={{marginLeft:8,fontSize:10,color:T.textSm}}
            title={row.baseItens?.length > 1 ? row.baseItens.map(i => `${i.label}: ${fmt(i.valor)}${i.realizado != null ? ` · realizado ${fmt(i.realizado)}` : ""}`).join("\n") : undefined}>
            (base: {row.labelBase}{row.baseItens?.length > 1 ? ` · ${row.baseItens.length} linhas somadas` : ""})
          </span>
        )}
      </td>
      <td className="num" style={tdNum({color: refReal ? T.textSm : T.textMd})}>
        {editavel ? (
          <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
            <input
              defaultValue={row.base || ""}
              onBlur={e => setValorBase(row.baseItemId, campoBase, e.target.value)}
              style={{...IS, width:110, textAlign:"right", padding:"4px 8px", fontSize:12}}
              inputMode="numeric"
            />
            {!mostraReal && (
              <button title="Remover linha da base" onClick={() => removeBase(row.baseItemId, campoBase)}
                style={{border:"none",background:"none",cursor:"pointer",color:T.danger||"#DC2626",padding:2,display:"flex"}}>
                <X size={13}/>
              </button>
            )}
          </span>
        ) : (row.base ? fmt(row.base) : "—")}
      </td>
      {mostraReal && (
        <td className="num" style={tdNum({color: refReal ? T.textMd : T.textSm, fontWeight: refReal ? 600 : 400})}>
          {editavel ? (
            <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
              <input
                defaultValue={row.real ?? ""}
                placeholder="sem dado"
                onBlur={e => setRealBase(row.baseItemId, campoBase, e.target.value)}
                style={{...IS, width:110, textAlign:"right", padding:"4px 8px", fontSize:12}}
                inputMode="numeric"
              />
              <button title="Remover linha da base" onClick={() => removeBase(row.baseItemId, campoBase)}
                style={{border:"none",background:"none",cursor:"pointer",color:T.danger||"#DC2626",padding:2,display:"flex"}}>
                <X size={13}/>
              </button>
            </span>
          ) : fmtReal(row.real)}
        </td>
      )}
      <td className="num" style={tdNum({color:T.text, fontWeight:600})}>
        {row.atual ? fmt(row.atual) : "—"}
      </td>
      <td className="num" style={tdNum({color:deltaCor(row.delta, T)})}>
        {fmtDelta(row.delta)}
      </td>
      <td style={{padding:"10px 16px",textAlign:"right"}}><Selo status={row.status} T={T}/></td>
    </tr>
  ); };

  const renderHeaderGrupo = (titulo, color, tot, { chave, rows, extra } = {}) => {
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
        <td style={{padding:"12px 16px",fontWeight:700,whiteSpace:"nowrap",color:T.text,fontSize:12.5}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
            {chave && <Chevron size={14} color={T.textSm} style={{flexShrink:0,opacity:editando ? 0.35 : 1}}/>}
            <span style={{width:8,height:8,borderRadius:2,background:color,flexShrink:0}}/>
            {titulo}
            {!aberto && rows && rows.length > 0 && <ChipsResumo rows={rows} T={T}/>}
          </span>
        </td>
        <td className="num" style={{padding:"12px 16px",textAlign:"right",color:T.textMd,fontSize:12.5,fontWeight:600,fontFamily:FONT.num}}>{fmt(tot.totalBase)}</td>
        {mostraReal && <td className="num" style={{padding:"12px 16px",textAlign:"right",color:T.textMd,fontSize:12.5,fontWeight:600,fontFamily:FONT.num}}>{fmt(tot.totalReal)}</td>}
        <td className="num" style={{padding:"12px 16px",textAlign:"right",color:T.text,fontSize:12.5,fontWeight:700,fontFamily:FONT.num}}>{fmt(tot.totalAtual)}</td>
        <td className="num" style={{padding:"12px 16px",textAlign:"right",fontSize:12.5,fontWeight:600,color:deltaCor(tot.delta, T),fontFamily:FONT.num}}>{fmtDelta(tot.delta)}</td>
        <td style={{padding:"12px 16px",textAlign:"right"}}>{extra || null}</td>
      </tr>
    );
  };

  const renderAddLinha = (tipo, grupoKey, secao) => {
    const aberta = novaLinha && ((tipo === "fixo" && novaLinha.secao === secao && novaLinha.tipo === "fixo")
      || (tipo !== "fixo" && novaLinha.grupo === grupoKey && novaLinha.tipo !== "fixo"));
    if (!editando) return null;
    if (!aberta) return (
      <tr key={`add_${tipo}_${grupoKey || secao}`}>
        <td colSpan={nCols} style={{padding:"4px 16px 10px 40px"}}>
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
        <td colSpan={nCols} style={{padding:"8px 16px 12px 40px"}}>
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

  // Chaves de topo (grupos com linhas + bloco de fixos) — base do recolher tudo.
  const chavesTopo = [
    ...V.grupos.filter(g => g.rows.length > 0).map(g => g.key),
    ...(V.fixos.length > 0 ? ["fixos"] : []),
  ];
  const tudoRecolhido = chavesTopo.length > 0 && chavesTopo.every(k => recolhidos.has(k));

  // ── Blocos: custos VARIÁVEIS (por jogo) × custos FIXOS (por edição) ──
  const soma = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const blocos = {
    variaveis: {
      key:"variaveis", label:"Custos Variáveis", sub:`por jogo · ${(orc.jogos || []).length} jogos na edição atual`,
      color: T.info || "#2563EB",
      totalBase: soma(V.grupos, "totalBase"), totalReal: soma(V.grupos, "totalReal"), totalAtual: soma(V.grupos, "totalAtual"),
      rows: V.grupos.flatMap(g => g.rows),
    },
    fixos: {
      key:"fixos", label:"Custos Fixos", sub:"por edição · pessoal fixo, serviços e reembolsos",
      color: "#a855f7",
      totalBase: soma(V.fixos, "totalBase"), totalReal: soma(V.fixos, "totalReal"), totalAtual: soma(V.fixos, "totalAtual"),
      rows: V.fixos.flatMap(f => f.rows),
    },
  };
  Object.values(blocos).forEach(b => { b.totalRef = refReal ? b.totalReal : b.totalBase; b.delta = b.totalAtual - b.totalRef; });
  const pct = (parte, total) => total > 0 ? `${Math.round((parte / total) * 100)}%` : "—";
  const pctDelta = (delta, refTotal) => refTotal ? `${delta >= 0 ? "+" : ""}${((delta / refTotal) * 100).toFixed(1)}%` : "—";

  // Faixa divisória de bloco: título, totais e (opcional) recolher o bloco inteiro.
  const renderBloco = (b, { chave, icon: Icon } = {}) => {
    const aberto = !chave || estaAberto(chave);
    const clicavel = !!chave && !editando;
    const Chevron = aberto ? ChevronDown : ChevronRight;
    return (
      <tr key={`bloco_${b.key}`}
        onClick={clicavel ? () => toggleRecolhido(chave) : undefined}
        title={clicavel ? (aberto ? "Recolher bloco" : "Expandir bloco") : undefined}
        style={{
          borderTop:`3px solid ${b.color}`, background:`${b.color}12`,
          cursor: clicavel ? "pointer" : "default", userSelect:"none",
        }}>
        <td style={{padding:"13px 16px",whiteSpace:"nowrap"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:10}}>
            {chave && <Chevron size={15} color={b.color} style={{flexShrink:0,opacity:editando ? 0.35 : 1}}/>}
            {Icon && <Icon size={15} color={b.color} style={{flexShrink:0}}/>}
            <span style={{display:"flex",flexDirection:"column",gap:1}}>
              <span style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:b.color}}>{b.label}</span>
              <span style={{fontSize:10.5,color:T.textSm}}>{b.sub}</span>
            </span>
            {!aberto && b.rows.length > 0 && <ChipsResumo rows={b.rows} T={T}/>}
          </span>
        </td>
        <td className="num" style={{padding:"13px 16px",textAlign:"right",color:T.textMd,fontSize:13,fontWeight:600,fontFamily:FONT.num,whiteSpace:"nowrap"}}>
          {fmt(b.totalBase)}<div style={{fontSize:10,fontWeight:500,color:T.textSm}}>{pct(b.totalBase, V.totalBase)} do total</div>
        </td>
        {mostraReal && (
          <td className="num" style={{padding:"13px 16px",textAlign:"right",color:T.textMd,fontSize:13,fontWeight:600,fontFamily:FONT.num,whiteSpace:"nowrap"}}>
            {fmt(b.totalReal)}<div style={{fontSize:10,fontWeight:500,color:T.textSm}}>{pct(b.totalReal, V.totalReal)} do total</div>
          </td>
        )}
        <td className="num" style={{padding:"13px 16px",textAlign:"right",color:T.text,fontSize:13,fontWeight:700,fontFamily:FONT.num,whiteSpace:"nowrap"}}>
          {fmt(b.totalAtual)}<div style={{fontSize:10,fontWeight:500,color:T.textSm}}>{pct(b.totalAtual, V.totalAtual)} do total</div>
        </td>
        <td className="num" style={{padding:"13px 16px",textAlign:"right",fontSize:13,fontWeight:700,color:deltaCor(b.delta, T),fontFamily:FONT.num,whiteSpace:"nowrap"}}>
          {fmtDelta(b.delta)}
          <div style={{fontSize:10,fontWeight:500,color:T.textSm}}>{pctDelta(b.delta, b.totalRef)}</div>
        </td>
        <td/>
      </tr>
    );
  };

  // Linha de fechamento do bloco (subtotal) — fecha visualmente antes do próximo bloco.
  const renderSubtotal = (b) => (
    <tr key={`sub_${b.key}`} style={{background:`${b.color}0c`,borderTop:`1px solid ${b.color}55`}}>
      <td style={{padding:"10px 16px",fontSize:11,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:b.color,whiteSpace:"nowrap"}}>
        Subtotal {b.label.replace("Custos ", "")}
      </td>
      <td className="num" style={{padding:"10px 16px",textAlign:"right",color:T.textMd,fontSize:12.5,fontWeight:600,fontFamily:FONT.num,whiteSpace:"nowrap"}}>{fmt(b.totalBase)}</td>
      {mostraReal && <td className="num" style={{padding:"10px 16px",textAlign:"right",color:T.textMd,fontSize:12.5,fontWeight:600,fontFamily:FONT.num,whiteSpace:"nowrap"}}>{fmt(b.totalReal)}</td>}
      <td className="num" style={{padding:"10px 16px",textAlign:"right",color:T.text,fontSize:12.5,fontWeight:700,fontFamily:FONT.num,whiteSpace:"nowrap"}}>{fmt(b.totalAtual)}</td>
      <td className="num" style={{padding:"10px 16px",textAlign:"right",fontSize:12.5,fontWeight:700,color:deltaCor(b.delta, T),fontFamily:FONT.num,whiteSpace:"nowrap"}}>{fmtDelta(b.delta)}</td>
      <td style={{padding:"10px 16px",textAlign:"right"}}><Selo status={statusBloco(b)} T={T}/></td>
    </tr>
  );

  const atualLabel = `${orc.meta.nome} ${orc.meta.edicao}`;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      {/* ── KPIs ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
        <Stat T={T} label={`Orçado · ${bl.label}`} value={fmtK(V.totalBase)} sub={fmt(V.totalBase)} color={T.textMd||"#6b7280"} icon={Wallet}/>
        {temReal && (
          <Stat T={T} label={`Realizado · ${bl.label}`} value={fmtK(V.totalReal)}
            sub={`${fmt(V.totalReal)} · ${pctDelta(V.totalReal - V.totalBase, V.totalBase)} vs orçado`}
            color="#D97706" icon={Receipt}/>
        )}
        <Stat T={T} label={`Orçado · ${atualLabel}`} value={fmtK(V.totalAtual)} sub={fmt(V.totalAtual)} color={T.info||"#2563EB"} icon={Wallet}/>
        <Stat T={T} label={`Variação vs ${refLabel}`} value={fmtDelta(V.delta)}
          sub={V.totalRef ? `${pctDelta(V.delta, V.totalRef)} sobre ${fmtK(V.totalRef)}` : "—"}
          color={deltaCor(V.delta, T)} icon={V.delta >= 0 ? TrendingUp : TrendingDown}/>
        <Stat T={T} label="Add-ons" value={String(V.numAddons)} sub={refReal ? "Sem gasto nem orçado na base" : "Serviços novos nesta edição"} color="#8b5cf6" icon={Sparkles}/>
      </div>

      {/* ── Tabela comparativa ── */}
      <Card T={T}>
        <SectionHeader
          T={T}
          title={`Comparativo · ${bl.label} × ${atualLabel}`}
          subtitle={temReal
            ? `Linha a linha por serviço — delta e selo tomam o ${refLabel} como referência`
            : "Linha a linha por serviço — selo automático: add-on, aumento, redução ou removido"}
          icon={GitCompareArrows}
          right={
            <span style={{display:"inline-flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
              {temReal && <RefToggle valor={ref} onChange={trocaRef} blLabel={bl.label} T={T}/>}
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
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:mostraReal ? 860 : 720}}>
            <thead>
              <tr style={{background:T.surfaceAlt||T.bg}}>
                <th style={thStyle(T, true)}>Serviço</th>
                <th style={thStyle(T, false, !refReal)}>Orçado {bl.label}</th>
                {mostraReal && <th style={thStyle(T, false, refReal)}>Realizado {bl.label}</th>}
                <th style={thStyle(T, false, true)}>Orçado {atualLabel}</th>
                <th style={thStyle(T)}>Δ vs {refReal ? "realizado" : "orçado"}</th>
                <th style={thStyle(T)}>Selo</th>
              </tr>
            </thead>
            <tbody>
              {/* ══ BLOCO 1 · CUSTOS VARIÁVEIS (por jogo) ══ */}
              {renderBloco(blocos.variaveis, { chave:"variaveis", icon:Layers })}
              {estaAberto("variaveis") && V.grupos.map(g => (g.rows.length > 0 || editando) ? [
                renderHeaderGrupo(g.label, g.color, g, { chave:g.key, rows:g.rows }),
                ...(estaAberto(g.key) ? [
                  ...g.rows.map(row => renderRow(row, g, "itens")),
                  renderAddLinha("var", g.key),
                ] : []),
              ] : null)}
              {renderSubtotal(blocos.variaveis)}

              {/* ══ BLOCO 2 · CUSTOS FIXOS (por edição) ══ */}
              {(V.fixos.length > 0 || editando) && renderBloco(blocos.fixos, { chave:"fixos", icon:Briefcase })}
              {estaAberto("fixos") && V.fixos.map(sec => {
                const chaveSec = `sec:${sec.secao}`;
                const secAberta = estaAberto(chaveSec);
                const SecChevron = secAberta ? ChevronDown : ChevronRight;
                return [
                  <tr key={`sec_${sec.secao}`}
                    onClick={!editando ? () => toggleRecolhido(chaveSec) : undefined}
                    title={!editando ? (secAberta ? "Recolher seção" : "Expandir seção") : undefined}
                    style={{borderTop:`1px solid ${T.border}`,background:T.surfaceAlt||T.bg,cursor:!editando ? "pointer" : "default",userSelect:"none"}}>
                    <td style={{padding:"8px 16px 6px 24px",fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:T.textSm}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                        <SecChevron size={12} color={T.textSm} style={{flexShrink:0,opacity:editando ? 0.35 : 1}}/>
                        {sec.secao}
                        {!secAberta && sec.rows.length > 0 && <ChipsResumo rows={sec.rows} T={T}/>}
                      </span>
                    </td>
                    <td className="num" style={{padding:"8px 16px",textAlign:"right",fontSize:11,color:T.textSm,fontFamily:FONT.num}}>{fmt(sec.totalBase)}</td>
                    {mostraReal && <td className="num" style={{padding:"8px 16px",textAlign:"right",fontSize:11,color:T.textSm,fontFamily:FONT.num}}>{fmt(sec.totalReal)}</td>}
                    <td className="num" style={{padding:"8px 16px",textAlign:"right",fontSize:11,color:T.textSm,fontFamily:FONT.num,fontWeight:600}}>{fmt(sec.totalAtual)}</td>
                    <td className="num" style={{padding:"8px 16px",textAlign:"right",fontSize:11,color:deltaCor(sec.delta, T),fontFamily:FONT.num}}>{fmtDelta(sec.delta)}</td>
                    <td/>
                  </tr>,
                  ...(secAberta ? [
                    ...sec.rows.map(row => renderRow(row, sec, "fixos")),
                    renderAddLinha("fixo", null, sec.secao),
                  ] : []),
                ];
              })}
              {editando && V.fixos.length === 0 && renderAddLinha("fixo", null, "Serviços")}
              {(V.fixos.length > 0 || editando) && renderSubtotal(blocos.fixos)}

              <tr style={{borderTop:`3px solid ${T.borderStrong||T.border}`,background:T.surfaceAlt||T.bg,fontWeight:700}}>
                <td style={{padding:"14px 16px",color:T.text,fontSize:12,letterSpacing:"0.04em",textTransform:"uppercase"}}>Total Geral</td>
                <td className="num" style={{padding:"14px 16px",textAlign:"right",color:T.textMd,whiteSpace:"nowrap",fontSize:14,fontWeight:600,fontFamily:FONT.num}}>{fmt(V.totalBase)}</td>
                {mostraReal && <td className="num" style={{padding:"14px 16px",textAlign:"right",color:"#D97706",whiteSpace:"nowrap",fontSize:14,fontWeight:600,fontFamily:FONT.num}}>{fmt(V.totalReal)}</td>}
                <td className="num" style={{padding:"14px 16px",textAlign:"right",color:T.info||"#2563EB",whiteSpace:"nowrap",fontSize:14,fontWeight:700,fontFamily:FONT.num}}>{fmt(V.totalAtual)}</td>
                <td className="num" style={{padding:"14px 16px",textAlign:"right",whiteSpace:"nowrap",fontSize:14,fontWeight:700,color:deltaCor(V.delta, T),fontFamily:FONT.num}}>{fmtDelta(V.delta)}</td>
                <td/>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{margin:0,padding:"10px 16px 14px",fontSize:11,color:T.textSm,lineHeight:1.5}}>
          Base importada em {new Date(bl.importadoEm).toLocaleDateString("pt-BR")} — orçado e realizado da base são
          congelados e editáveis aqui (realizado em branco = sem dado); o lado atual é sempre o orçamento vivo
          (jogos × premissas + serviços fixos).
        </p>
      </Card>
    </div>
  );
}
