// WMS Beach Bike — distribuição inteligente (separação e conferência). Sem tela e sem armazenamento: só a decisão.
//
// O coordenador liga e desliga (por exemplo, quando vai sair da mesa). Ligada, o que chega na caixa de entrada
// e já pode seguir sozinho vai direto para quem está atuando no setor e tem a MENOR fila. O resto fica na caixa
// para o coordenador decidir.
//   Vai sozinho:  aguardando (o cliente vem buscar) · pedido com embarque HOJE, dentro do horário
//   Fica na caixa: sem rota · fora do horário (o coordenador decide a data) · embarque em outro dia
// Ordem: aguardando primeiro; depois a rota com o corte mais cedo (a próxima a sair); depois prioridade e chegada.
//
// Na demonstração ela roda na própria tela da Gestão. No servidor (pós-MVP) ela roda no servidor,
// para funcionar mesmo com a tela do coordenador fechada.
import { rota } from "./rotas.js";
import { ehAguardando } from "./aguardando.js";

// p: { aguardando, rota, embarque, foraDoHorario, prio, chegada } · hoje: "AAAA-MM-DD"
export function vaiSozinho(p, hoje) {
  if (ehAguardando(p)) return true;
  if (!p.rota || p.foraDoHorario) return false;
  return p.embarque === hoje;
}

const corteDe = (p) => (p.rota && rota(p.rota)?.corte) || "99:99";

// ordem em que a distribuição inteligente entrega os pedidos (use em .sort)
export function ordemDaDistribuicao(a, b) {
  if (ehAguardando(a) !== ehAguardando(b)) return ehAguardando(a) ? -1 : 1;
  const ca = corteDe(a), cb = corteDe(b);
  if (ca !== cb) return ca.localeCompare(cb);
  if (a.prio !== b.prio) return a.prio === "alta" ? -1 : 1;
  return (a.chegada || 0) - (b.chegada || 0);
}

// filas: [{ id, pendente }] de quem está atuando agora (pendente = unidades que faltam na fila dele).
// Devolve o id com a menor fila (empate: o primeiro da lista) ou null se não há ninguém.
export function menorFila(filas) {
  let melhor = null;
  for (const f of filas) if (!melhor || f.pendente < melhor.pendente) melhor = f;
  return melhor ? melhor.id : null;
}
