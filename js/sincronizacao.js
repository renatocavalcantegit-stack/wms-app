// WMS Beach Bike — ENVIO DA FILA ao servidor (Fase 1b).
// A tela nunca espera a rede: ela grava na fila (js/dados/fila.js) e segue.
// Este arquivo tenta mandar a fila a cada poucos segundos, quando a rede volta
// e logo depois de cada ação nova. O que o servidor confirmou sai da fila.
import {
  acoesPendentes, tirarDaFila, lerEstadoDaSincronizacao, gravarEstadoDaSincronizacao,
} from "./dados/fila.js";

export const INTERVALO_MS = 5000;   // de quanto em quanto tempo tenta enviar
export const TAMANHO_DO_LOTE = 500; // o servidor aceita até 500 ações por envio

// Uma tentativa de envio. Devolve { situacao, enviadas, recusadas }:
//   sem-servidor    sessão de demonstração (sem token): não há para onde enviar
//   vazia           nada na fila
//   ok              tudo enviado
//   sem-rede        a rede falhou: a fila fica como está e tenta de novo depois
//   sessao-vencida  o servidor não aceitou o token (401): é preciso entrar de novo
//   erro            o servidor respondeu com erro: a fila fica como está
// buscar = fetch (nos testes, um de mentira) · agora = relógio (nos testes, fixo)
export async function sincronizarAgora({ sessao, buscar = fetch, agora = () => new Date() }) {
  if (!sessao?.token) return { situacao: "sem-servidor", enviadas: 0, recusadas: [] };
  let enviadas = 0;
  const recusadasAgora = [];

  for (;;) {
    const lote = acoesPendentes(sessao.login).slice(0, TAMANHO_DO_LOTE);
    if (!lote.length) break;
    const estado = lerEstadoDaSincronizacao();

    let resposta;
    try {
      resposta = await buscar("api/sincronizar", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessao.token}` },
        // o login não vai junto: o servidor sabe quem é pelo token
        body: JSON.stringify({ acoes: lote.map(({ login, ...acao }) => acao) }),
      });
    } catch {
      gravarEstadoDaSincronizacao({ ...estado, semRedeDesde: estado.semRedeDesde ?? agora().toISOString() });
      return { situacao: "sem-rede", enviadas, recusadas: recusadasAgora };
    }
    if (resposta.status === 401) {
      gravarEstadoDaSincronizacao({ ...estado, semRedeDesde: null, sessaoVencida: true });
      return { situacao: "sessao-vencida", enviadas, recusadas: recusadasAgora };
    }
    if (!resposta.ok) return { situacao: "erro", enviadas, recusadas: recusadasAgora };

    const { novas = [], repetidas = [], recusadas = [] } = await resposta.json();
    tirarDaFila([...novas, ...repetidas]);
    enviadas += novas.length + repetidas.length;
    // guarda as recusadas com o pedido, para o separador saber de qual pedido se trata
    const quando = agora().toISOString();
    const novasRecusas = recusadas.map((r) => {
      const acao = lote.find((a) => a.id === r.id);
      return { id: r.id, tipo: acao?.tipo, pedido: acao?.dados?.pedido, resultado: r.resultado, motivo: r.motivo, quando };
    });
    recusadasAgora.push(...novasRecusas);
    gravarEstadoDaSincronizacao({
      ...estado, ultimaSincronizacao: quando, semRedeDesde: null, sessaoVencida: false,
      recusadas: [...estado.recusadas, ...novasRecusas],
    });
    // nada confirmado neste lote (não deveria acontecer): para, senão ficaria mandando o mesmo lote sem fim
    if (!novas.length && !repetidas.length) break;
  }
  return { situacao: enviadas ? "ok" : "vazia", enviadas, recusadas: recusadasAgora };
}

// Liga o envio automático. sessao() devolve a sessão atual; aoMudar(resultado) é chamado depois de cada tentativa.
// Devolve pedirEnvio(): a tela chama logo depois de gravar uma ação, para não esperar os 5 segundos.
export function iniciarSincronizacao({ sessao, aoMudar = () => {} }) {
  let enviando = false, deNovo = false;
  async function tentar() {
    if (enviando) { deNovo = true; return; } // um envio de cada vez; o pedido que chegou no meio roda em seguida
    enviando = true;
    try {
      aoMudar(await sincronizarAgora({ sessao: sessao() }));
    } finally {
      enviando = false;
      if (deNovo) { deNovo = false; tentar(); }
    }
  }
  setInterval(tentar, INTERVALO_MS);
  window.addEventListener("online", tentar);
  tentar();
  return () => setTimeout(tentar, 0);
}
