import { useEffect, useMemo, useRef, useState } from "react";
import { publicoOrcamento } from "../../lib/supabase";
import { ORC_STATUS, calcTotais } from "../../data/orcamentos";
import { fmt } from "../../utils";
import { SUBTABS, SUBTABS_VIEWER, SubTabNav } from "./OrcamentoEditor";
import SubResumo from "./SubResumo";
import SubJogos from "./SubJogos";
import SubServicos from "./SubServicos";
import SubComparativo from "./SubComparativo";
import { Radio, Lock } from "lucide-react";

// ─── ORÇAMENTO PÚBLICO (#orcamento/<token>) ──────────────────────────────────
// Apresentação só-leitura para quem não tem acesso ao Hub (entidades). Mesmas
// quatro abas do visualizador interno. O documento é relido a cada POLL_MS e ao
// voltar o foco para a aba: o que for editado no Hub aparece aqui em segundos.
// Nada aqui grava: setOrc é um no-op e readOnly=true em todos os subcomponentes.
const POLL_MS = 4000;

const TEMA = (cor) => ({
  bg:"#eef0f4", card:"#ffffff", surface:"#ffffff", surfaceAlt:"#f1f5f9",
  border:"#e2e8f0", muted:"#cbd5e1",
  text:"#0b1220", textMd:"#475569", textSm:"#64748b",
  brand: cor || "#059669", brandSoft:"rgba(5,150,105,0.10)", brandBorder:"rgba(5,150,105,0.32)",
  info:"#2563eb", warning:"#d97706", danger:"#dc2626", success:"#16a34a",
});

const hora = (iso) => { try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return ""; } };

export default function OrcamentoPublico({ token }) {
  const [orc, setOrc] = useState(null);
  const [estado, setEstado] = useState("carregando"); // carregando | ok | invalido | offline
  const [sub, setSub] = useState("resumo");
  const [ultimaLeitura, setUltimaLeitura] = useState(null);
  const [piscou, setPiscou] = useState(false);
  const versao = useRef(null);

  useEffect(() => {
    let vivo = true, timer = null;
    const ler = async () => {
      try {
        const doc = await publicoOrcamento(token);
        if (!vivo) return;
        if (!doc) { setEstado("invalido"); return; }
        const v = doc?.meta?.updatedAt || JSON.stringify(doc).length;
        if (v !== versao.current) {
          versao.current = v;
          setOrc(doc);
          if (estado === "ok") { setPiscou(true); setTimeout(() => vivo && setPiscou(false), 1500); }
        }
        setUltimaLeitura(new Date());
        setEstado("ok");
      } catch {
        if (vivo) setEstado(prev => prev === "ok" ? "offline" : prev === "carregando" ? "invalido" : prev);
      } finally {
        if (vivo) timer = setTimeout(ler, POLL_MS);
      }
    };
    ler();
    const onFocus = () => { if (document.visibilityState === "visible") { clearTimeout(timer); ler(); } };
    document.addEventListener("visibilitychange", onFocus);
    return () => { vivo = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onFocus); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const T = useMemo(() => TEMA(orc?.meta?.cor), [orc?.meta?.cor]);
  const tabs = useMemo(() => SUBTABS.filter(t => SUBTABS_VIEWER.includes(t.key)), []);
  const totais = useMemo(() => (orc ? calcTotais(orc) : null), [orc]);
  const noop = () => {};

  const shell = (children) => (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 20px 60px" }}>{children}</div>
    </div>
  );

  if (estado === "carregando") return shell(<p style={{ color: T.textMd, fontSize: 14 }}>Carregando orçamento…</p>);
  if (estado === "invalido" || !orc) return shell(
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 28, maxWidth: 520, margin: "60px auto", textAlign: "center" }}>
      <Lock size={28} color={T.textSm}/>
      <h2 style={{ margin: "12px 0 6px", fontSize: 18 }}>Link inválido ou revogado</h2>
      <p style={{ margin: 0, color: T.textMd, fontSize: 13 }}>Peça um novo link a quem compartilhou este orçamento.</p>
    </div>
  );

  const m = orc.meta || {};
  const st = ORC_STATUS[m.status] || ORC_STATUS.rascunho;
  const commonProps = { orc, setOrc: noop, readOnly: true, T };

  return shell(
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: `${T.brand}22`, display: "grid", placeItems: "center", fontSize: 22 }}>{m.icon || "🏆"}</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.01em" }}>{m.nome} <span style={{ color: T.textMd, fontWeight: 500 }}>{m.edicao}</span></h1>
            <p style={{ margin: "2px 0 0", color: T.textSm, fontSize: 12 }}>
              {m.descricao || "Orçamento"} · <span style={{ color: st.color, fontWeight: 700 }}>{st.label}</span>
              {totais && <> · Total <b style={{ color: T.text }}>{fmt(totais.totalGeral || 0)}</b></>}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: T.textSm, background: T.card, border: `1px solid ${piscou ? T.brand : T.border}`, borderRadius: 999, padding: "6px 12px", transition: "border-color .3s" }}>
          <Radio size={13} color={estado === "offline" ? T.warning : T.brand}/>
          {estado === "offline" ? "Sem conexão — tentando de novo" : `Ao vivo · atualizado ${ultimaLeitura ? hora(ultimaLeitura) : ""}`}
          <span style={{ color: T.muted }}>·</span>
          <Lock size={12}/> somente leitura
        </div>
      </div>

      <SubTabNav active={sub} onChange={setSub} T={T} tabs={tabs}/>

      {sub === "resumo"      && <SubResumo {...commonProps} canAprovar={false}/>}
      {sub === "jogos"       && <SubJogos {...commonProps}/>}
      {sub === "servicos"    && <SubServicos {...commonProps}/>}
      {sub === "comparativo" && <SubComparativo {...commonProps}/>}

      <p style={{ marginTop: 32, color: T.textSm, fontSize: 11, textAlign: "center" }}>
        Visualização externa gerada pelo HUB Financeiro · valores em reais · última edição no Hub {m.updatedAt ? new Date(m.updatedAt).toLocaleString("pt-BR") : "—"}
      </p>
    </>
  );
}
