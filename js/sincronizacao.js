// WMS Beach Bike — ENVIO DA FILA ao servidor (Fase 1b).
// A tela nunca espera a rede: ela grava na fila (js/dados/fila.js) e segue.
// Este arquivo tenta mandar a fila a cada poucos segundos, quando a rede volta
// e logo depois de cada ação nova. O que o servidor confirmou sai da fila.
import {
  acoesPendentes, tirarDaFila, lerEstadoDaSincronizacao, gravarEstadoDaSincronizacao,
} from "./dados/fila.js";

export const INTERVALO_MS = 5000;   // de quanto em quanto tempo tenta enviar
export const TAMANHO_DO_LOTE = 500; // o servidor aceita até 500 ações por envio
export const BATIMENTO_MS = 30_000; // com a fila vazia, dá sinal de vida ao servidor a cada 30 s (Fase 1c)

// Uma tentativa de envio. Devolve { situacao, enviadas, recusadas }:
//   sem-servidor    sessão de demonstração (sem token): não há para onde enviar
//   vazia           nada na fila (e não era hora do batimento)
//   contato         fila vazia, mas mandou o batimento: o servidor sabe que o aparelho está com rede
//   ok              tudo enviado
//   sem-rede        a rede falhou: a fila fica como está e tenta de novo depois
//   sessao-vencida  o servidor não aceitou o token (401): é preciso entrar de novo (motivo "coordenador":
//                   o coordenador desconectou este aparelho pela tela de Dispositivos)
//   erro            o servidor respondeu com erro: a fila fica como está
// buscar = fetch (nos testes, um de mentira) · agora = relógio (nos testes, fixo)
// batimento = true: mesmo com a fila vazia, chama o servidor com a lista vazia (é assim que a Gestão
// sabe a hora do último contato do separador e mostra "sem contato há X min" quando a rede cai)
// passo (v63) = { passo, itens } do item da vez: vai só no primeiro envio desta tentativa (ver iniciarSincronizacao)
export async function sincronizarAgora({ sessao, buscar = fetch, agora = () => new Date(), batimento = false, passo = null }) {
  if (!sessao?.token) return { situacao: "sem-servidor", enviadas: 0, recusadas: [] };
  let enviadas = 0, falou = false;
  const recusadasAgora = [];

  for (;;) {
    const lote = acoesPendentes(sessao.login).slice(0, TAMANHO_DO_LOTE);
    if (!lote.length && (falou || !(batimento || passo))) break;
    const comPasso = !falou && passo;
    falou = true;
    const estado = lerEstadoDaSincronizacao();

    let resposta;
    try {
      resposta = await buscar("api/sincronizar", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessao.token}` },
        // o login não vai junto: o servidor sabe quem é pelo token.
        // pendentes: quanto há na fila agora (a tela de Dispositivos da Gestão mostra "N ações não enviadas")
        body: JSON.stringify({
          acoes: lote.map(({ login, ...acao }) => acao), pendentes: acoesPendentes(sessao.login).length,
          ...(comPasso ? { passo } : {}),
        }),
      });
    } catch {
      gravarEstadoDaSincronizacao({ ...estado, semRedeDesde: estado.semRedeDesde ?? agora().toISOString() });
      return { situacao: "sem-rede", enviadas, recusadas: recusadasAgora };
    }
    if (resposta.status === 401) {
      // motivo (Fase 1e): "coordenador" = o coordenador desconectou este aparelho; sem motivo = a sessão venceu
      const motivo = (await resposta.json().catch(() => ({}))).motivo || null;
      gravarEstadoDaSincronizacao({ ...estado, semRedeDesde: null, sessaoVencida: true, motivoDoFim: motivo });
      return { situacao: "sessao-vencida", motivo, enviadas, recusadas: recusadasAgora };
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
  return { situacao: enviadas ? "ok" : falou ? "contato" : "vazia", enviadas, recusadas: recusadasAgora };
}

// v71: cada envio tem prazo. Com o Wi-Fi desligado, o aparelho pode deixar o pedido parado até a rede voltar:
// sem prazo, a linha "Sem rede há X min" não aparecia e nenhum outro envio saía enquanto isso.
export const PRAZO_DO_ENVIO = 15000; // ms

// Liga o envio automático. sessao() devolve a sessão atual; aoMudar(resultado) é chamado depois de cada tentativa.
// passo() (v63) devolve o passo do item da vez ({ passo, itens }) ou null: só vai quando muda (uma vez cada).
// Devolve pedirEnvio(): a tela chama logo depois de gravar uma ação, para não esperar os 5 segundos.
export function iniciarSincronizacao({ sessao, aoMudar = () => {}, passo = () => null }) {
  let enviando = false, deNovo = false, ultimoContato = 0, passoEnviado = "";
  async function tentar() {
    if (enviando) { deNovo = true; return; } // um envio de cada vez; o pedido que chegou no meio roda em seguida
    enviando = true;
    try {
      const batimento = Date.now() - ultimoContato >= BATIMENTO_MS;
      let p = null;
      try { p = passo(); } catch { p = null; }
      const chave = p ? JSON.stringify(p) : "", novo = !!p && chave !== passoEnviado;
      const r = await sincronizarAgora({ sessao: sessao(), batimento, passo: novo ? p : null, buscar: comPrazo(fetch, PRAZO_DO_ENVIO) });
      if (r.situacao === "ok" || r.situacao === "contato") { ultimoContato = Date.now(); if (novo) passoEnviado = chave; }
      aoMudar(r);
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

// o mesmo fetch, mas desiste depois de "prazo" ms (o erro conta como sem rede)
export function comPrazo(buscar, prazo) {
  return (url, opcoes = {}) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), prazo);
    const pedido = buscar(url, { ...opcoes, signal: ctl.signal });
    // o fetch de mentira dos testes não ouve o signal: o prazo também vale para ele
    const desiste = new Promise((_, recusa) => ctl.signal.addEventListener("abort", () => recusa(new TypeError("prazo esgotado"))));
    return Promise.race([pedido, desiste]).finally(() => clearTimeout(t));
  };
}
