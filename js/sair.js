// WMS Beach Bike — SAIR do aparelho com o servidor (Fase 1e, login único).
// Usado pelo coletor (separação e embarque) e pela conferência.
//
// Sair avisa o servidor: a sessão termina e a pessoa pode entrar em outro aparelho.
//   1. Se há ações na fila, tenta mandar antes.
//   2. Se ainda sobrou alguma (o servidor não respondeu), pergunta: elas ficam guardadas NESTE aparelho
//      e só são enviadas quando alguém entrar de novo nele.
//   3. Sem rede, não sai: o servidor continuaria achando que a pessoa está aqui, e o login em outro aparelho
//      seria recusado. Conecte e saia de novo, ou peça ao coordenador para desconectar.
// Na demonstração (sem servidor), só apaga a sessão do aparelho, como antes.
//
// v71: a resposta "sem rede" vem NA HORA. Com o Wi-Fi desligado, o celular/coletor pode deixar o pedido ao servidor
// parado até a rede voltar (e a mensagem só aparecia depois). Agora: se o aparelho já sabe que está sem rede,
// nem tenta; e cada pedido ao servidor tem um prazo (PRAZO_DO_SAIR): passou, conta como sem rede.
import { logout, sairNoServidor } from "./sessao.js";
import { totalPendente } from "./dados/fila.js";
import { sincronizarAgora, comPrazo } from "./sincronizacao.js";

export const PRAZO_DO_SAIR = 6000; // ms
export const MSG_SAIR_SEM_REDE = "Sem rede: o servidor ainda não sabe que você saiu. Conecte e saia de novo, ou peça ao coordenador para desconectar.";
export const msgAcoesNaoEnviadas = (n) =>
  `Você tem ${n} ${n === 1 ? "ação que ainda não chegou" : "ações que ainda não chegaram"} ao servidor. `
  + "Se sair agora, elas ficam neste aparelho e só são enviadas quando você entrar de novo nele. Sair mesmo assim?";

// confirmar(mensagem) → true para sair mesmo assim. buscar = fetch (nos testes, um de mentira). Devolve { ok: true } ou { ok: false, mensagem?, cancelado? }.
export async function sairDoAparelho({ sessao, confirmar = (m) => window.confirm(m), buscar: buscarSemPrazo = fetch,
  semRede = () => typeof navigator !== "undefined" && navigator.onLine === false, prazo = PRAZO_DO_SAIR }) {
  if (!sessao?.token) { logout(); return { ok: true }; }
  if (semRede()) return { ok: false, mensagem: MSG_SAIR_SEM_REDE };
  const buscar = comPrazo(buscarSemPrazo, prazo);

  if (totalPendente(sessao.login)) {
    const r = await sincronizarAgora({ sessao, buscar });
    if (r.situacao === "sem-rede") return { ok: false, mensagem: MSG_SAIR_SEM_REDE };
    // sessão já encerrada no servidor (venceu ou o coordenador desconectou): só falta sair do aparelho
    if (r.situacao === "sessao-vencida") { logout(); return { ok: true }; }
  }
  const sobrou = totalPendente(sessao.login);
  if (sobrou && !confirmar(msgAcoesNaoEnviadas(sobrou))) return { ok: false, cancelado: true };

  const s = await sairNoServidor(sessao, buscar);
  if (s === "sem-rede") return { ok: false, mensagem: MSG_SAIR_SEM_REDE };
  if (s !== "ok") return { ok: false, mensagem: "O servidor não respondeu. Tente sair de novo em instantes." };
  logout();
  return { ok: true };
}

