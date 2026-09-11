import { useEffect, useRef } from "react";
import { sincronizarResumosEnvios } from "../lib/sincronizarEnvios";

// Mantém os resumos dos envios iguais às notas vivas (ver lib/sincronizarEnvios).
// Roda quando notas ou envios mudam; grava só se algum resumo estiver defasado.
// `enabled`: só o admin grava (mesmo padrão do useAgendaPortal) — evita vários
// navegadores escrevendo a mesma correção ao mesmo tempo; visualizador nunca grava.
export function useSincronizarEnvios({ envios, setEnvios, notas, notasMensais, notasLivemode, pronto, enabled = true, dedupeNotasPorNF = false }) {
  const ultimo = useRef(null);
  useEffect(() => {
    if (!pronto || !enabled || !setEnvios || !Array.isArray(envios) || envios.length === 0) return;
    const { envios: novos, mudancas } = sincronizarResumosEnvios(envios, { notas, notasMensais, notasLivemode }, { dedupeNotasPorNF });
    if (!mudancas) return;
    const assinatura = JSON.stringify(novos.map(e => [e.id, e.notasResumo, e.mensaisResumo, e.livemodeResumo]));
    if (ultimo.current === assinatura) return;      // já gravamos exatamente isto neste ciclo
    ultimo.current = assinatura;
    console.info(`[envios] ${mudancas} resumo(s) alinhado(s) às notas`);
    setEnvios(novos);
  }, [envios, notas, notasMensais, notasLivemode, pronto, enabled]);
}
