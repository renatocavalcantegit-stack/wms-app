// WMS Beach Bike — FILA DE ENVIO do coletor (Fase 1b).
// Cada ação do separador (iniciar, item, falta, doca...) entra aqui na hora, mesmo sem rede.
// O js/sincronizacao.js manda a fila para o servidor a cada poucos segundos e só tira daqui
// o que o servidor confirmou que recebeu. Assim, nada se perde se o Wi-Fi cair no meio do caminho.
//
// Por que no localStorage e não no IndexedDB? Todo o app já guarda os dados no localStorage, a fila é pequena
// (algumas centenas de ações no pior caso) e o localStorage grava na hora, sem código assíncrono.
// Se a fila crescer muito um dia, só este arquivo muda.

const CHAVE_FILA = "wms-bb-fila-v1";
const CHAVE_ESTADO = "wms-bb-sinc-v1";

const ler = (chave, padrao) => {
  try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; }
};
const lerFila = () => { const f = ler(CHAVE_FILA, []); return Array.isArray(f) ? f : []; };
const gravarFila = (fila) => localStorage.setItem(CHAVE_FILA, JSON.stringify(fila));

// ID único de cada ação (UUID versão 4), criado no aparelho. O servidor usa para não aplicar a mesma ação duas vezes.
// crypto.randomUUID() só existe em https; crypto.getRandomValues() existe também em http (rede interna).
export function novoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // versão 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// guarda a ação no fim da fila e devolve a ação guardada
export function enfileirar(login, tipo, dados, quando = new Date()) {
  const acao = { id: novoId(), login, tipo, dados, feitaEm: quando.toISOString() };
  gravarFila([...lerFila(), acao]);
  return acao;
}

// o que ainda não foi enviado, na ordem em que foi feito. Só as ações deste login:
// se outra pessoa entrar no mesmo aparelho, as ações da primeira esperam ela voltar.
export const acoesPendentes = (login) => lerFila().filter((a) => a.login === login);
export const totalPendente = (login) => acoesPendentes(login).length;

// tira da fila as ações que o servidor confirmou (novas + repetidas)
export function tirarDaFila(ids) {
  const confirmadas = new Set(ids);
  gravarFila(lerFila().filter((a) => !confirmadas.has(a.id)));
}

// ---------- estado da sincronização (o que a tela mostra) ----------
//   ultimaSincronizacao  quando o servidor confirmou o último envio
//   semRedeDesde         desde quando o envio falha por falta de rede (null = com rede)
//   sessaoVencida        o servidor recusou o token: é preciso entrar de novo para enviar
//   recusadas            ações que o servidor recebeu mas NÃO aplicou (conflito...), para o separador ver
const ESTADO_INICIAL = { ultimaSincronizacao: null, semRedeDesde: null, sessaoVencida: false, recusadas: [] };
export const lerEstadoDaSincronizacao = () => ({ ...ESTADO_INICIAL, ...ler(CHAVE_ESTADO, {}) });
export const gravarEstadoDaSincronizacao = (estado) => localStorage.setItem(CHAVE_ESTADO, JSON.stringify(estado));

// avisa a tela quando outra aba mudou a fila ou o estado
export function aoMudarFila(fn) {
  window.addEventListener("storage", (e) => { if (e.key === CHAVE_FILA || e.key === CHAVE_ESTADO) fn(); });
}
