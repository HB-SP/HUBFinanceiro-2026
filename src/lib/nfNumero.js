// ─── NÚMERO DA NF × CHAVE DE ACESSO DA NFS-e ─────────────────────────────────
// Fornecedores às vezes colam a CHAVE DE ACESSO da NFS-e (padrão nacional, 50
// dígitos) no campo "número da NF". Layout da chave:
//   7  código IBGE do município
//   1  ambiente (1 produção / 2 homologação)   ← na prática vem "2" nas notas reais
//   1  tipo de inscrição (1 CPF / 2 CNPJ)
//   14 inscrição federal (CNPJ/CPF com zeros à esquerda)
//   14 NÚMERO DA NFS-e com zeros à esquerda      ← posições 24–37
//   4  ano e mês da emissão (AAMM)
//   9  código verificador/local + 1 dígito
// Ex.: 3304557 2 2 02252173000122 00000000000024 2608 303834503 0  →  NF 24 (Century, ago/2026)
const POS_NUMERO = 23;   // índice 0-based do início do número
const LEN_NUMERO = 14;

const soDigitos = (s) => String(s || "").replace(/\D/g, "");

export function ehChaveAcessoNFSe(texto) {
  const d = soDigitos(texto);
  return d.length >= 44 && d.length <= 50;   // 50 é o padrão; tolera cópia sem os últimos dígitos
}

// Analisa o que foi digitado/colado no campo "número da NF".
//   { numero, chaveAcesso, detectada, cnpjEmissor, anoMes }
// Se não for chave, devolve o texto como veio (trim) e detectada = false.
export function analisarNumeroNF(texto) {
  const original = String(texto || "");
  if (!ehChaveAcessoNFSe(original)) return { numero: original.trim(), chaveAcesso: null, detectada: false };
  const d = soDigitos(original);
  const numero = String(parseInt(d.slice(POS_NUMERO, POS_NUMERO + LEN_NUMERO), 10) || "");
  const cnpjEmissor = d.slice(9, 23);
  const anoMes = d.slice(37, 41);
  if (!numero) return { numero: original.trim(), chaveAcesso: null, detectada: false };
  return { numero, chaveAcesso: d, detectada: true, cnpjEmissor, anoMes };
}

// Atalho para os formulários: devolve o patch a aplicar no estado do form.
// Mantém a chave em `chaveAcesso` para auditoria; se o usuário apagar e digitar
// um número normal, a chave é limpa.
export function patchNumeroNF(texto) {
  const a = analisarNumeroNF(texto);
  return a.detectada ? { numeroNF: a.numero, chaveAcesso: a.chaveAcesso } : { numeroNF: a.numero === String(texto || "").trim() ? String(texto || "") : a.numero, chaveAcesso: null };
}

// Texto curto para mostrar ao lado do campo quando a chave foi reconhecida.
export function avisoChaveDetectada(chaveAcesso, numero) {
  if (!chaveAcesso) return null;
  const mm = chaveAcesso.slice(39, 41), aa = chaveAcesso.slice(37, 39);
  return `Chave de acesso da NFS-e reconhecida — número da nota: ${numero}${aa && mm ? ` (emissão ${mm}/20${aa})` : ""}`;
}
