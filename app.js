// WMS Beach Bike — MVP de Separação (dados locais de demonstração)
// Três jeitos de separar:
//   · um pedido (ou uma PARTE de um pedido grande que o coordenador dividiu entre separadores);
//   · um LOTE: vários pedidos numa viagem só, com uma caixa por pedido no carrinho (A, B, C…);
//   · e, no fim de qualquer um deles, o separador lê o QR da DOCA DE EXPEDIÇÃO onde deixou a mercadoria.
// Em cada item (ou parada do lote): CONFIRMA O ENDEREÇO (QR ou ID digitado), BIPA O PRODUTO uma vez e DIGITA A QUANTIDADE.
// Assim o sistema sabe que ele está na prateleira certa com o produto certo, e a falta "endereço vazio" é confiável.
// As regras ficam em compartilhado/regras/separacao.js.
import { USERS, PERFIS, SETORES, session, login, logout, setSetor, homeUrl, temServidor, loginNoServidor } from "./js/sessao.js";
import { enfileirar, acoesPendentes, totalPendente, lerEstadoDaSincronizacao, gravarEstadoDaSincronizacao, aoMudarFila } from "./js/dados/fila.js";
import { iniciarSincronizacao } from "./js/sincronizacao.js";
import { sairDoAparelho } from "./js/sair.js";
import { MOTIVOS_DE_FIM } from "./compartilhado/regras/login-unico.js";
import { carregarPedidos, salvarPedidos, pedidosDeDemonstracao, carregarLotes, salvarLotes, lotesDeDemonstracao, aoMudarPedidos, baixarDoServidor } from "./js/dados/separacao.js";
import { juntarComServidor, comOutroSeparador, pedidosNovosNaFila } from "./compartilhado/regras/juntar-pedidos.js";
import { ehAguardando, ehPrioridade } from "./compartilhado/regras/aguardando.js";
import { rota as rotaPeloId } from "./compartilhado/regras/rotas.js";
import { cadastroDoCliente } from "./js/dados/clientes.js";
import { lerPedidosDaConferencia, statusNaConferencia, retirarDaConferencia } from "./js/dados/conferencia.js";
import { baixarPorSeparacao, estornarSeparacao } from "./js/dados/movimentacao.js";
import { lerEstoque } from "./js/dados/estoque.js";
import { ehCodigoDoProduto } from "./compartilhado/regras/produtos.js";
import { $, $$, esc } from "./js/util.js";
import { show, openSheet, closeSheets, toast, beep, vibrate, openCam, CHECK, focarLeitura, somDePedidoNovo } from "./js/ui-coletor.js";
import { Embarque } from "./embarque.js";
import { lerCodigoDoEndereco, acharEndereco, compararEnderecos } from "./compartilhado/regras/enderecos.js";
import {
  validarDocaExpedicao, validarLote, posicoesDoLote, montarParadas, paradaConcluida, caixaDaVez, outrasCaixasPendentes, MAX_PEDIDOS_LOTE,
  podeSepararNovamente,
} from "./compartilhado/regras/separacao.js";
import { lerQuantidade, quantidadeValida, arredondarQtd, formatarQtd as fq } from "./compartilhado/regras/quantidade.js";

(() => {
  "use strict";

  // ---------- estado ----------
  let sess = session();
  let user = sess ? sess.nome : "";
  let filter = "abertos";
  let current = null; // pedido (ou parte) em separação
  let lote = null;    // lote em separação (vários pedidos)
  let docaAlvo = null; // o que está esperando a leitura da doca: { pedidos: [ids], lote: id|null }
  let selecionando = false; const selecionados = new Set(); // "Separar vários"

  // cada setor tem a sua fila: Expedição (pedidos de venda) ou Montagem (pedidos OP)
  const setor = () => (sess && sess.setor) || "exp";
  // onde os pedidos ficam guardados é assunto da camada de dados (js/dados/separacao.js)
  let orders = [], lotes = [];
  const load = () => { orders = carregarPedidos(setor()); lotes = carregarLotes(setor()); };
  const save = () => { salvarPedidos(setor(), orders); salvarLotes(setor(), lotes); };
  const pedido = (id) => orders.find((x) => x.id === id);
  const pedidosDoLote = (l) => l.pedidos.map(pedido).filter(Boolean);
  const loteAtivo = (l) => l.status !== "concluido";

  // ---------- utils ----------
  // atalhos de tela, aviso, bipe, sheets e câmera vêm de js/util.js e js/ui-coletor.js
  const units = (o) => o.itens.reduce((t, i) => t + i.qtd, 0);
  const doneCount = (o) => o.itens.filter((i) => i.status !== "pendente").length;
  // nome do pedido na tela: parte de pedido dividido aparece como "PV-10426 · parte 1/2"
  const nomeDo = (o) => (o.parte ? `${o.parte.pai} · parte ${o.parte.n}/${o.parte.de}` : o.id);
  const ICONS = {
    bike: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16l4-8h6l3 8M9.5 8L12 16h-2M14 5h3"/></svg>',
    peca: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
    acess: '<svg viewBox="0 0 24 24"><path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/></svg>',
  };
  const fmtMin = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; };

  // ---------- envio ao servidor (Fase 1b) ----------
  // Com servidor, cada ação da separação entra na FILA do aparelho (js/dados/fila.js) e a tela segue
  // sem esperar a rede. O js/sincronizacao.js manda a fila a cada 5 s e quando a rede volta.
  // Na demonstração (sessão sem token), nada é enfileirado.
  const pedirEnvio = iniciarSincronizacao({ sessao: () => session(), aoMudar: aposEnvio, passo: passoDaVez });
  // o passo do item da vez, para a Gestão encher a bolinha do item (v63): 1 = endereço lido, 2 = produto bipado.
  // No lote, vale para cada caixa da parada que ainda não foi confirmada.
  function passoDaVez() {
    if (!(current || lote) || $("#viewPick").hidden) return null;
    const e = etapa(), passo = e === "produto" ? 1 : e === "quantidade" ? 2 : 0;
    if (!passo) return null;
    const itens = lote
      ? parada().linhas.filter((l) => l.status === "pendente").map((l) => ({ pedido: l.pedido, sequencia: l.idx + 1 }))
      : [{ pedido: current.id, sequencia: current.atual + 1 }];
    return itens.length ? { passo, itens } : null;
  }
  function registrar(tipo, dados) {
    if (!sess?.token) return;
    enfileirar(sess.login, tipo, dados);
    renderSinc(); pedirEnvio();
  }
  // o servidor recebeu mas não aplicou (ex.: o pedido já estava com outro separador): avisa na hora
  function aposEnvio(r) {
    r.recusadas.forEach((x) => { toast(`${x.pedido || "Ação"}: ${x.motivo}`); beep(false); vibrate([80, 50, 80]); });
    // o coordenador passou o pedido aberto na tela para outra pessoa (ou devolveu para a caixa): volta para a lista
    const tirados = new Set(r.recusadas.filter((x) => /^O COORDENADOR/.test(x.motivo || "")).map((x) => x.pedido));
    if (tirados.size && (tirados.has(current?.id) || (lote && lote.pedidos.some((id) => tirados.has(id))))) {
      current = null; lote = null; closeSheets(); goHome();
    }
    // o coordenador desconectou este aparelho (Dispositivos, na Gestão): volta para o login.
    // A fila fica guardada e vai quando alguém entrar de novo neste aparelho.
    if (r.situacao === "sessao-vencida" && r.motivo === "coordenador" && sess) {
      logout(); sess = null; user = ""; current = null; lote = null; closeSheets(); document.body.classList.remove("setor-mont");
      $("#loginErr").textContent = `${MOTIVOS_DE_FIM.coordenador} O que não foi enviado continua guardado e vai quando você entrar de novo.`;
      $("#loginErr").hidden = false;
      show("viewLogin");
    }
    renderSinc();
    if (r.enviadas) atualizarDoServidor();
  }
  // a linha de estado no início e na separação: tudo enviado, enviando, sem rede há X min, sessão vencida
  function renderSinc() {
    const comServidor = !!sess?.token;
    const n = comServidor ? totalPendente(sess.login) : 0, est = lerEstadoDaSincronizacao();
    let texto, tipo = "ok";
    if (est.sessaoVencida && est.motivoDoFim === "coordenador") { texto = `O coordenador desconectou este aparelho · entre de novo para enviar ${n} ação(ões)`; tipo = "err"; }
    else if (est.sessaoVencida) { texto = `Sessão vencida · entre de novo para enviar ${n} ação(ões)`; tipo = "err"; }
    else if (n && est.semRedeDesde) { texto = `Sem rede há ${fmtMin(Date.now() - Date.parse(est.semRedeDesde))} · ${n} a enviar`; tipo = "warn"; }
    else if (n) { texto = `Enviando ${n} ação(ões)…`; tipo = "warn"; }
    else texto = est.ultimaSincronizacao
      ? `Tudo enviado · ${new Date(est.ultimaSincronizacao).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
      : "Conectado ao servidor";
    $$(".sinc-estado").forEach((el) => { el.hidden = !comServidor; el.dataset.tipo = tipo; el.textContent = texto; });
    const rec = est.recusadas;
    $("#sincRecusas").hidden = !comServidor || !rec.length;
    if (rec.length) $("#sincRecusasT").textContent = `${rec.length} ação(ões) não aplicada(s) no servidor. Última: ${rec.at(-1).pedido || ""} · ${rec.at(-1).motivo}`;
  }
  $("#sincRecusasOk").addEventListener("click", () => {
    gravarEstadoDaSincronizacao({ ...lerEstadoDaSincronizacao(), recusadas: [] });
    renderSinc();
  });
  aoMudarFila(renderSinc);

  // ---------- login ----------
  // Com servidor, o PIN é conferido lá e a sessão ganha o token (o primeiro login do turno precisa de rede).
  // Sem servidor (demonstração no GitHub Pages), confere na lista de demonstração, no próprio aparelho.
  const ERROS_DE_LOGIN = {
    pin: "Usuário ou PIN inválido",
    "sem-rede": "Sem rede. O primeiro login do turno precisa de rede: vá para um ponto com Wi-Fi.",
    servidor: "O servidor não respondeu. Tente de novo em instantes.",
    // login único (Fase 1e): a mensagem do servidor diz desde quando a pessoa está no outro aparelho
    "outro-aparelho": "Você já está conectado em outro aparelho. Saia por lá ou peça ao coordenador para desconectar.",
  };
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = $("#loginName").value, pin = $("#loginPin").value;
    let s = null, erro = "pin";
    if (await temServidor()) {
      const r = await loginNoServidor(nome, pin);
      if (r.ok) s = r.sessao; else { erro = r.erro; if (r.mensagem) ERROS_DE_LOGIN["outro-aparelho"] = r.mensagem; }
    } else s = login(nome, pin);
    if (!s) {
      $("#loginErr").textContent = ERROS_DE_LOGIN[erro];
      $("#loginErr").hidden = false; vibrate([80, 50, 80]);
      $("#loginPin").value = ""; $("#loginPin").focus();
      return;
    }
    $("#loginErr").hidden = true;
    // entrou de novo depois de a sessão vencer: a fila volta a ser enviada
    gravarEstadoDaSincronizacao({ ...lerEstadoDaSincronizacao(), sessaoVencida: false, motivoDoFim: null });
    sess = s; user = s.nome;
    renderSinc(); pedirEnvio();
    goHome();
  });
  $("#loginQuick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-login]"); if (!b) return;
    const u = USERS.find((x) => x.login === b.dataset.login);
    $("#loginName").value = u.login; $("#loginPin").value = u.pin;
    $("#loginErr").hidden = true;
  });

  // cada perfil vai direto para a sua tela
  function goHome() {
    if (!sess) return show("viewLogin");
    if (sess.perfil !== "sep" && sess.perfil !== "emb") return location.replace(homeUrl(sess.perfil));
    if (sess.perfil === "emb") return Embarque.home();
    if (!sess.setor) return openSetor(false);
    load();
    renderHome(); show("viewHome");
    atualizarDoServidor();
  }

  // ---------- o gestor mudou o pedido em outra tela (corte de item ou cancelamento) ----------
  // Recarrega os pedidos e redesenha o que está aberto. O item cortado é pulado; pedido cancelado
  // sem nada separado some; com algo separado, o separador termina e leva para a doca (a conferência devolve).
  const visivel = (v) => !$("#" + v).hidden;
  function recarregarPorOutraTela() {
    if (!sess || sess.perfil !== "sep" || !sess.setor) return;
    const id = current?.id, loteId = lote?.id;
    load();
    if (id) {
      current = pedido(id);
      if (!current || current.status === "cancelado") {
        current = null; renderHome(); show("viewHome"); toast("PEDIDO CANCELADO PELO GESTOR"); beep(false); return;
      }
      if (!visivel("viewPick")) return;
      if (current.cancelado) toast("PEDIDO CANCELADO PELO GESTOR · leve o que já separou para a doca");
      return item().status === "pendente" ? renderPick() : next();
    }
    if (loteId) {
      lote = lotes.find((l) => l.id === loteId) || null;
      if (!lote) { renderHome(); show("viewHome"); return; }
      if (!visivel("viewPick")) return;
      const p = paradas()[lote.atual];
      return p && !paradaConcluida(p) ? renderPick() : proximaParada(true);
    }
    if (visivel("viewHome")) renderHome();
  }
  ["exp", "mont"].forEach((s) => aoMudarPedidos(s, () => s === setor() && recarregarPorOutraTela()));

  // ---------- lista do servidor (Fase 1d) ----------
  // Com servidor, a lista vem do servidor (todos os aparelhos veem o mesmo) e o aparelho guarda uma cópia:
  // sem rede, segue com ela. Quem decide o que vale (aparelho ou servidor) é compartilhado/regras/juntar-pedidos.js:
  // o que ainda está na fila de envio nunca é apagado.
  // Só atualiza com a lista na tela e nenhuma janela aberta: nunca mexe no pedido que o separador está separando.
  const ATUALIZAR_LISTA_MS = 30_000;
  const podeAtualizarLista = () => visivel("viewHome") && $("#scrim").hidden;
  let baixando = false, baixouNesteLogin = null; // a primeira lista depois do login não toca o som
  async function atualizarDoServidor() {
    if (!sess?.token || sess.perfil !== "sep" || !sess.setor || baixando || !podeAtualizarLista()) return;
    baixando = true;
    try {
      const s = setor(), r = await baixarDoServidor(sess, s);
      if (!r.ok || s !== setor() || !podeAtualizarLista()) return;
      const comFila = new Set(acoesPendentes(sess.login).map((a) => a.dados.pedido));
      const antes = orders.map((o) => o.id);
      ({ pedidos: orders, lotes } = juntarComServidor({ locais: orders, lotesLocais: lotes, doServidor: r.pedidos, comFila }));
      save();
      // o coordenador mandou pedido novo para a fila: toque e aviso (só som e vibração, sem notificação)
      const novos = pedidosNovosNaFila(antes, orders);
      const chave = `${sess.token}|${s}`;
      if (novos.length && baixouNesteLogin === chave) {
        somDePedidoNovo();
        toast(novos.length === 1 ? `Pedido novo na sua fila: ${novos[0]}` : `${novos.length} pedidos novos na sua fila`);
      }
      baixouNesteLogin = chave;
      // na seleção de "Separar vários", tira o pedido que outro separador pegou nesse meio-tempo
      [...selecionados].forEach((id) => { const o = pedido(id); if (!o || !podeSelecionar(o)) selecionados.delete(id); });
      renderHome();
    } finally { baixando = false; }
  }
  setInterval(atualizarDoServidor, ATUALIZAR_LISTA_MS);
  window.addEventListener("online", atualizarDoServidor);
  // o pedido está com outro separador (a lista veio do servidor): não abre
  const comOutro = (o) => comOutroSeparador(o, sess?.login);
  function avisarComOutro(o) { toast(`${nomeDo(o)} está com ${o.operador}.`); beep(false); vibrate([80, 50, 80]); }

  // ---------- setor (Expedição / Montagem) ----------
  function openSetor(canBack) {
    $("#sxHello").textContent = `Olá, ${user}`;
    $$(".sx-opt").forEach((b) => b.classList.toggle("cur", !!sess.setor && b.dataset.setor === sess.setor));
    $("#sxBack").hidden = !canBack;
    closeSheets(); show("viewSetor");
  }
  $(".sx-opts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-setor]"); if (!b) return;
    const mudou = sess.setor !== b.dataset.setor;
    sess = setSetor(b.dataset.setor);
    vibrate(30); goHome();
    if (mudou) toast(`Você está atuando na ${SETORES[sess.setor]}`);
  });
  $("#sxBack").addEventListener("click", goHome);
  $("#sxOut").addEventListener("click", () => $("#menuLogout").click());
  $("#setorChip").addEventListener("click", () => openSetor(true));

  // ---------- home ----------
  function renderHome() {
    const mont = setor() === "mont";
    document.body.classList.toggle("setor-mont", mont);
    $("#setorChipT").textContent = SETORES[setor()];
    $("#setorChip").classList.toggle("mont", mont);
    $("#helloName").textContent = user;
    const dt = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    $("#helloDate").textContent = dt.charAt(0).toUpperCase() + dt.slice(1);
    $("#kpiPend").textContent = orders.filter((o) => o.status === "pendente").length;
    $("#kpiAnd").textContent = orders.filter((o) => o.status === "andamento").length;
    $("#kpiDone").textContent = orders.filter((o) => o.status === "concluido").length;

    // pedido de um lote em aberto aparece dentro do cartão do lote (não sozinho)
    const noLoteAtivo = new Set(lotes.filter(loteAtivo).flatMap((l) => l.pedidos));
    const avulsos = orders.filter((o) => !noLoteAtivo.has(o.id) && o.status !== "cancelado") // cancelado pelo gestor sai da lista
      .filter((o) => filter === "todos" || (filter === "concluido" ? o.status === "concluido" : o.status !== "concluido"))
      .map((o) => ({ r: rank(o), html: orderCard(o) }));
    const deLote = selecionando || filter === "concluido" ? [] : lotes.filter(loteAtivo).map((l) => ({ r: rankLote(l), html: loteCard(l) }));
    const list = [...deLote, ...avulsos].sort((a, b) => a.r - b.r);

    $("#loteBar").hidden = filter === "concluido" || mont && !orders.some(podeSelecionar);
    $("#btnVarios").textContent = selecionando ? "Cancelar seleção" : "Separar vários";
    $("#btnVarios").classList.toggle("on", selecionando);
    $("#loteDica").hidden = !selecionando;
    $("#selBar").hidden = !selecionando;
    $("#selBarN").textContent = selecionados.size;
    $("#selGo").disabled = selecionados.size < 2;

    $("#orderList").innerHTML = list.length ? list.map((x) => x.html).join("") :
      `<p class="empty">${filter === "concluido" ? "Nenhum pedido concluído ainda." : "Tudo separado por aqui. 🎉"}</p>`;
  }
  // prioridade: na expedição só o aguardando; na Montagem, a do Sankhya (compartilhado/regras/aguardando.js)
  const prioridade = (o) => ehPrioridade(o, setor());
  // Com servidor (Fase 1e), a ordem é a da fila que o coordenador montou no quadro da Gestão.
  // Na demonstração, a prioridade vem primeiro.
  const naFila = (o) => (o.ordem ?? 999);
  const peso = (o) => (sess?.token ? naFila(o) : prioridade(o) ? 0 : 1);
  const rank = (o) => ({ andamento: 0, pendente: 1, concluido: 2 }[o.status] * 1000 + peso(o));
  const rankLote = (l) => (l.status === "andamento" ? 0 : 1000) + Math.min(...pedidosDoLote(l).map(peso));
  // pode entrar num lote: pedido que ainda não começou, fora de lote e que não é parte de pedido dividido
  const podeSelecionar = (o) => o.status === "pendente" && !o.lote && !o.parte;

  // etiqueta da rota no card (a mesma da Gestão: bolinha com a cor da rota e o nome).
  // Fica no lugar da cidade. Com servidor, a rota vem no pedido; na demonstração, do cadastro do cliente.
  // Aguardando não tem rota (continua a cidade).
  const rotaDoPedido = (o) => (ehAguardando(o) || setor() === "mont" ? null : rotaPeloId(o.rota || cadastroDoCliente(o)?.rota));
  const etiquetaDaRota = (r) => (r ? `<span class="order-rota" style="--rc:${r.cor}"><i></i>${esc(r.nome)}</span>` : "");

  function orderCard(o) {
    const pct = Math.round((doneCount(o) / o.itens.length) * 100);
    const sel = selecionando && podeSelecionar(o), marcado = selecionados.has(o.id);
    const outro = comOutro(o);
    const tag = o.cancelado ? `<span class="tag alta">Cancelado</span>`
      : outro ? `<span class="tag andamento">Com ${esc(String(o.operador).split(" ")[0])}</span>`
      : o.status === "concluido" ? `<span class="tag concluido">Concluído</span>`
      : o.status === "andamento" ? `<span class="tag andamento">Em separação</span>`
      : ehAguardando(o) ? `<span class="tag alta">Aguardando</span>`
      : prioridade(o) ? `<span class="tag alta">Prioridade</span>` : `<span class="tag">Pendente</span>`;
    const extra = o.parte ? `<p class="order-note">Pedido dividido pelo coordenador · ${esc(o.parte.ruas || "")}</p>` : "";
    const doca = o.doca ? `<p class="order-note ok">Deixado na doca ${o.doca.codigo}</p>` : "";
    return `<button class="order ${o.status === "concluido" ? "is-done" : ""} ${(selecionando && !sel) || outro ? "is-off" : ""} ${marcado ? "is-sel" : ""}" data-id="${esc(o.id)}">
      <div class="order-top">
        ${sel ? `<span class="order-cb">${marcado ? CHECK : ""}</span>` : ""}
        <div class="grow"><p class="order-id">${esc(nomeDo(o))}</p><p class="order-client">${esc(o.cliente)}</p></div>${tag}
      </div>
      ${extra}
      <div class="order-meta"><span><b>${o.itens.length}</b> itens</span><span><b>${units(o)}</b> un.</span>${rotaDoPedido(o) ? etiquetaDaRota(rotaDoPedido(o)) : `<span>${o.cidade}</span>`}<span>${o.hora}</span></div>
      ${o.status !== "pendente" ? `<div class="order-bar"><i style="width:${pct}%"></i></div>` : ""}
      ${doca}
    </button>`;
  }

  function loteCard(l) {
    const ps = pedidosDoLote(l);
    const itens = ps.reduce((t, o) => t + o.itens.length, 0), un = ps.reduce((t, o) => t + units(o), 0);
    const feitos = ps.reduce((t, o) => t + doneCount(o), 0);
    const outro = ps.find(comOutro);
    const tag = outro ? `<span class="tag andamento">Com ${esc(String(outro.operador).split(" ")[0])}</span>`
      : l.status === "andamento" ? `<span class="tag andamento">Em separação</span>` : `<span class="tag lote">Lote</span>`;
    return `<button class="order lote ${outro ? "is-off" : ""}" data-lote="${l.id}">
      <div class="order-top">
        <div class="grow"><p class="order-id">${l.id} · ${ps.length} pedidos</p>
        <p class="order-client">${l.criadoPor.tipo === "coordenador" ? "Montado pelo coordenador" : "Montado por você"} · uma viagem só</p></div>${tag}
      </div>
      <div class="lote-peds">${ps.map((o) => `<span><b class="cx-pos">${l.posicoes[o.id]}</b>${esc(o.id)}</span>`).join("")}</div>
      <div class="order-meta"><span><b>${itens}</b> itens</span><span><b>${un}</b> un.</span>${[...new Map(ps.map(rotaDoPedido).filter(Boolean).map((r) => [r.id, r])).values()].map(etiquetaDaRota).join("")}</div>
      ${l.status === "andamento" ? `<div class="order-bar"><i style="width:${Math.round((feitos / itens) * 100)}%"></i></div>` : ""}
    </button>`;
  }

  $("#homeTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    filter = b.dataset.filter;
    if (filter === "concluido") { selecionando = false; selecionados.clear(); }
    $$("#homeTabs .tab").forEach((t) => t.classList.toggle("active", t === b));
    renderHome();
  });

  // "Separar vários": o separador marca os pedidos dele e monta um lote
  $("#btnVarios").addEventListener("click", () => {
    selecionando = !selecionando; selecionados.clear();
    if (selecionando && filter !== "abertos") { filter = "abertos"; $$("#homeTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.filter === "abertos")); }
    renderHome();
  });
  $("#selCancel").addEventListener("click", () => { selecionando = false; selecionados.clear(); renderHome(); });
  // monte o carrinho: mostra a posição de cada pedido antes de começar
  $("#selGo").addEventListener("click", () => {
    const ps = [...selecionados].map(pedido);
    const erro = validarLote(ps);
    if (erro) { toast(erro); vibrate([80, 50, 80]); return; }
    const pos = posicoesDoLote(ps);
    $("#startOrder").textContent = "Monte o carrinho";
    $("#startClient").textContent = "Uma caixa por pedido. A letra é a posição da caixa no carrinho.";
    const pr = $("#startPrio"); pr.className = "tag lote"; pr.textContent = `${ps.length} pedidos`;
    $("#startItems").innerHTML = [...ps].sort((a, b) => pos[a.id].localeCompare(pos[b.id])).map((o) => posLine(pos[o.id], o)).join("");
    $("#startUndo").hidden = true;
    const go = $("#startGo"); go.textContent = "Criar lote e iniciar"; go.dataset.id = ""; go.dataset.lote = ""; go.dataset.novo = "1";
    openSheet("sheetStart");
  });
  const posLine = (pos, o) => `<div class="line"><b class="cx-pos big">${pos}</b><span class="line-desc">${esc(o.id)} · ${esc(o.cliente)}<small>${o.itens.length} itens · ${units(o)} un.${prioridade(o) && !ehAguardando(o) ? " · prioridade" : ehAguardando(o) ? " · aguardando" : ""}</small></span></div>`;

  $("#orderList").addEventListener("click", (e) => {
    const lc = e.target.closest("[data-lote]");
    if (lc) {
      const l = lotes.find((x) => x.id === lc.dataset.lote), outro = pedidosDoLote(l).find(comOutro);
      return outro ? avisarComOutro(outro) : abrirLote(l);
    }
    const card = e.target.closest(".order"); if (!card) return;
    const o = pedido(card.dataset.id);
    if (comOutro(o)) return avisarComOutro(o);
    if (selecionando) {
      if (!podeSelecionar(o)) return toast(o.parte ? "Parte de pedido dividido não entra em lote." : "Só pedidos pendentes entram no lote.");
      if (!selecionados.has(o.id) && selecionados.size >= MAX_PEDIDOS_LOTE) return toast(`O lote aceita no máximo ${MAX_PEDIDOS_LOTE} pedidos.`);
      selecionados.has(o.id) ? selecionados.delete(o.id) : selecionados.add(o.id);
      vibrate(20); return renderHome();
    }
    $("#startOrder").textContent = nomeDo(o);
    $("#startClient").textContent = `${o.cliente} · ${o.itens.length} itens · ${units(o)} un.${o.parte ? ` · ${o.parte.ruas}` : ""}`;
    const pr = $("#startPrio");
    pr.className = "tag " + (o.status === "concluido" ? "concluido" : o.status === "andamento" ? "andamento" : prioridade(o) ? "alta" : "");
    pr.textContent = o.status === "concluido" ? "Concluído" : o.status === "andamento" ? "Em separação" : ehAguardando(o) ? "Aguardando · cliente retira" : prioridade(o) ? "Prioridade" : "Normal";
    $("#startItems").innerHTML = o.itens.map((i) => lineHtml(i)).join("");
    $("#startUndo").hidden = true;
    const go = $("#startGo");
    go.textContent = o.status === "andamento" ? "Continuar separação" : o.status === "concluido" ? "Separar novamente" : "Iniciar separação";
    go.dataset.id = o.id; go.dataset.lote = ""; go.dataset.novo = "";
    openSheet("sheetStart");
  });

  function abrirLote(l) {
    const ps = pedidosDoLote(l);
    $("#startOrder").textContent = `${l.id} · ${ps.length} pedidos`;
    $("#startClient").textContent = `${l.criadoPor.tipo === "coordenador" ? "Montado pelo coordenador" : "Montado por você"} · uma caixa por pedido no carrinho`;
    const pr = $("#startPrio"); pr.className = "tag " + (l.status === "andamento" ? "andamento" : "lote"); pr.textContent = l.status === "andamento" ? "Em separação" : "Lote";
    $("#startItems").innerHTML = ps.map((o) => posLine(l.posicoes[o.id], o)).join("");
    // o separador só desfaz o lote que ele mesmo montou, e antes de começar
    $("#startUndo").hidden = !(l.status === "pendente" && l.criadoPor.tipo === "separador");
    $("#startUndo").dataset.lote = l.id;
    const go = $("#startGo"); go.textContent = l.status === "andamento" ? "Continuar lote" : "Iniciar lote";
    go.dataset.id = ""; go.dataset.lote = l.id; go.dataset.novo = "";
    openSheet("sheetStart");
  }

  function lineHtml(i, idx, cur) {
    // item zerado pelo gestor antes de separar: aparece riscado e não pode ser escolhido
    if (i.status === "cortado") return `<div class="line sp-cortado"><span class="dot"></span><span class="line-addr">${i.end}</span>
      <span class="line-desc">${esc(i.desc)}<small>${i.sku} · cortado pelo gestor</small></span><span class="line-q">0</span></div>`;
    const dot = i.status === "ok" ? `<span class="dot ok">${CHECK}</span>`
      : i.status === "falta" ? `<span class="dot falta">!</span>` : `<span class="dot"></span>`;
    return `<button class="line ${cur ? "current" : ""}" ${idx != null ? `data-idx="${idx}"` : ""}>
      ${dot}<span class="line-addr">${i.end}</span>
      <span class="line-desc">${esc(i.desc)}<small>${i.sku}${i.status === "falta" ? " · " + esc(i.motivo) : ""}</small></span>
      <span class="line-q">${i.status === "pendente" ? fq(i.qtd) : fq(i.sep) + "/" + fq(i.qtd)}</span>
    </button>`;
  }

  $("#startUndo").addEventListener("click", () => {
    const l = lotes.find((x) => x.id === $("#startUndo").dataset.lote);
    pedidosDoLote(l).forEach((o) => Object.assign(o, { lote: null, pos: null }));
    lotes = lotes.filter((x) => x !== l);
    save(); closeSheets(); renderHome(); toast(`${l.id} desfeito · os pedidos voltaram para a lista`);
  });

  $("#startGo").addEventListener("click", () => {
    const go = $("#startGo");
    if (go.dataset.novo) return criarLoteEIniciar();
    if (go.dataset.lote) return iniciarLote(lotes.find((l) => l.id === go.dataset.lote));
    const o = pedido(go.dataset.id);
    if (o.status === "concluido") {
      // separar novamente: só se ninguém começou a conferir; o que foi baixado volta para o endereço
      // e o pedido sai da fila da conferência até terminar de novo
      const idNaConferencia = o.parte ? o.parte.pai : o.id;
      const erro = podeSepararNovamente(statusNaConferencia(setor(), idNaConferencia));
      if (erro) { closeSheets(); toast(erro); beep(false); return; }
      estornarSeparacao({ pedido: o.id, usuario: sess?.login });
      registrar("separacao.reabrir", { pedido: o.id });
      retirarDaConferencia(setor(), idNaConferencia);
      o.itens.forEach((i) => Object.assign(i, { sep: 0, status: i.qtd === 0 ? "cortado" : "pendente", motivo: "", devolver: 0 }));
      Object.assign(o, { status: "pendente", atual: 0, doca: null, lote: null, pos: null, endOk: null, prodOk: null });
    }
    if (o.status === "pendente") {
      o.status = "andamento"; o.inicio = Date.now(); o.operador = user;
      registrar("separacao.iniciar", { pedido: o.id });
    }
    // começa no primeiro item ainda a separar (pula o que o gestor cortou)
    if (o.itens[o.atual || 0]?.status !== "pendente") o.atual = Math.max(0, o.itens.findIndex((i) => i.status === "pendente"));
    current = o; lote = null; save(); closeSheets();
    // todos os itens já resolvidos (saiu do app na hora de ler a doca): vai direto para a doca
    if (!o.itens.some((i) => i.status === "pendente")) return abrirDoca({ pedidos: [o.id], lote: null });
    show("viewPick"); renderPick(true);
  });

  function criarLoteEIniciar() {
    const ps = [...selecionados].map(pedido);
    const erro = validarLote(ps); if (erro) return toast(erro);
    const posicoes = posicoesDoLote(ps);
    // código único entre aparelhos: dois coletores montando lote ao mesmo tempo não podem gerar o mesmo "L-2"
    // (o servidor junta os pedidos pelo código do lote). Os últimos 4 caracteres da hora, em base 36.
    let id;
    do id = `L-${Date.now().toString(36).slice(-4).toUpperCase()}`; while (lotes.some((x) => x.id === id));
    const l = { id, pedidos: ps.map((o) => o.id).sort((a, b) => posicoes[a].localeCompare(posicoes[b])), posicoes, status: "pendente",
      criadoPor: { tipo: "separador", login: sess.login, nome: user }, criado: Date.now(), inicio: null, fim: null, operador: null, atual: 0 };
    ps.forEach((o) => Object.assign(o, { lote: l.id, pos: posicoes[o.id] }));
    lotes.push(l);
    selecionando = false; selecionados.clear();
    iniciarLote(l);
  }

  function iniciarLote(l) {
    if (l.status === "pendente") {
      Object.assign(l, { status: "andamento", inicio: Date.now(), operador: user });
      pedidosDoLote(l).forEach((o) => {
        Object.assign(o, { status: "andamento", inicio: l.inicio, operador: user });
        registrar("separacao.iniciar", { pedido: o.id, lote: l.id, posicao: l.posicoes[o.id] });
      });
    }
    lote = l; current = null; save(); closeSheets();
    if (paradas().every(paradaConcluida)) return abrirDoca({ pedidos: [...l.pedidos], lote: l.id });
    if (paradaConcluida(paradas()[l.atual] || { linhas: [] })) proximaParada();
    show("viewPick"); renderPick(true);
  }

  // ---------- separação ----------
  // pedido: um item de cada vez. Lote: uma PARADA de cada vez (mesmo produto no mesmo endereço para todos os pedidos).
  function item() { return current.itens[current.atual]; }
  // endereço confirmado fica guardado no pedido/lote: voltar e continuar depois não pede de novo,
  // e o próximo item no MESMO endereço já vem liberado
  const alvo = () => (lote ? parada().end : item().end);
  const dono = () => lote || current;
  const enderecoOk = () => dono().endOk === alvo();
  const paradas = () => montarParadas(pedidosDoLote(lote), lote.posicoes);
  const parada = () => paradas()[lote.atual];
  const itemDaLinha = (l) => pedido(l.pedido).itens[l.idx];
  // lote: a caixa (pedido) cuja quantidade o separador digita agora. Uma por vez: A, depois B… (v50)
  const vez = () => caixaDaVez(parada());
  const mesmaCaixa = (a, b) => !!a && !!b && a.pedido === b.pedido && a.idx === b.idx;

  function renderPick(anim) {
    if (lote) return renderParada(anim);
    const o = current, i = item();
    $("#pickOrder").textContent = nomeDo(o);
    $("#pickClient").textContent = o.cliente;
    $("#pickProgress").style.width = (doneCount(o) / o.itens.length) * 100 + "%";
    $("#pickStep").textContent = `Item ${o.atual + 1} de ${o.itens.length}` + (i.status === "ok" ? " · confirmado" : i.status === "falta" ? " · falta registrada" : "");
    desenharEndereco(i.end);
    $("#prodThumb").innerHTML = ICONS[i.tipo] || ICONS.peca;
    $("#prodDesc").textContent = i.desc;
    $("#prodSku").textContent = i.sku;
    $("#prodEan").textContent = i.ean ? "EAN " + i.ean : "Sem código de barras · digite o código";
    $("#loteBox").hidden = true;
    $("#qtyInput").value = "";
    renderEndereco();
    renderQty();
    setMsg("");
    $("#scanInput").value = "";
    if (anim) { const c = $("#pickCard"); c.classList.remove("enter"); void c.offsetWidth; c.classList.add("enter"); }
  }

  // endereço da prateleira (R3001-P7-A100-AP101) em 4 blocos grandes; números longos ganham letra menor
  function desenharEndereco(end) {
    const e = lerCodigoDoEndereco(end) || {};
    $("#addrParts").innerHTML = [["Rua", e.rua], ["Prédio", e.predio], ["Andar", e.andar], ["Apto", e.apto]]
      .map(([l, v]) => `<div class="addr-part${String(v).length > 3 ? " long" : ""}"><b>${v ?? "–"}</b><small>${l}</small></div>`).join("");
  }

  function renderParada(anim) {
    const ps = paradas(), p = ps[lote.atual];
    const feitas = ps.filter(paradaConcluida).length;
    $("#pickOrder").textContent = `${lote.id} · ${lote.pedidos.length} pedidos`;
    $("#pickClient").textContent = lote.pedidos.map((id) => `${lote.posicoes[id]} ${id}`).join(" · ");
    $("#pickProgress").style.width = (feitas / ps.length) * 100 + "%";
    $("#pickStep").textContent = `Parada ${lote.atual + 1} de ${ps.length}` + (paradaConcluida(p) ? " · confirmada" : "");
    desenharEndereco(p.end);
    $("#prodThumb").innerHTML = ICONS[p.tipo] || ICONS.peca;
    $("#prodDesc").textContent = p.desc;
    $("#prodSku").textContent = p.sku;
    $("#prodEan").textContent = p.ean ? "EAN " + p.ean : "Sem código de barras · digite o código";
    desenharCaixas(p);
    $("#qtyInput").value = "";
    renderEndereco();
    renderQty();
    setMsg("");
    $("#scanInput").value = "";
    if (anim) { const c = $("#pickCard"); c.classList.remove("enter"); void c.offsetWidth; c.classList.add("enter"); }
  }
  // três passos em cada item (ou parada do lote):
  //   1. ENDEREÇO: lê o QR do endereço (ou digita o ID);
  //   2. PRODUTO: bipa o produto uma vez (confirma que pegou o produto certo);
  //   3. QUANTIDADE: digita quanto pegou e tecla Enter. Menos que o pedido abre a falta.
  // O que já foi confirmado fica guardado no pedido/lote: pausar e voltar não pede de novo.
  const chaveProduto = () => (lote ? `${parada().end}|${parada().sku}` : `${item().end}|${item().sku}`);
  const produtoOk = () => enderecoOk() && dono().prodOk === chaveProduto();
  const etapa = () => (!enderecoOk() ? "endereco" : !produtoOk() ? "produto" : "quantidade");
  const solicitado = () => (lote ? vez()?.qtd ?? 0 : item().qtd);
  const ehDaVez = (code) => ehCodigoDoProduto(lote ? parada() : item(), code);
  // quantidade digitada: null = ainda vazio · NaN = inválida · pode ser quebrada ("101,5" → 101.5, até 3 casas)
  const digitado = () => {
    const v = $("#qtyInput").value.trim();
    if (v === "") return null;
    const n = lerQuantidade(v);
    return quantidadeValida(n) ? n : NaN;
  };

  // as caixas do carrinho nesta parada. A caixa da vez fica destacada (é dela a quantidade digitada);
  // as que já foram confirmadas ficam verdes (ou com falta) e as próximas ficam apagadas
  function desenharCaixas(p) {
    const cx = caixaDaVez(p), v = digitado(), n = p.linhas.length;
    $("#loteBox").hidden = false;
    const titulo = !cx ? "Parada confirmada"
      : n > 1 ? `Caixa <b>${cx.pos}</b> da vez · ${n} caixas nesta parada, uma de cada vez` : `Caixa <b>${cx.pos}</b>`;
    $("#loteBox").innerHTML = `<p class="lote-h">${titulo}</p>` + p.linhas.map((l) => {
      const o = pedido(l.pedido), daVez = mesmaCaixa(l, cx), falta = l.status === "falta";
      const q = daVez ? (v != null && !Number.isNaN(v) ? fq(v) : "–") : l.status === "pendente" ? "–" : fq(l.sep);
      const cls = daVez ? "atual" : l.status === "ok" ? "cheia" : falta ? "falta" : "espera";
      return `<div class="caixa ${cls}">
        <b class="cx-pos big">${l.pos}</b><span class="caixa-ped">${esc(l.pedido)}<small>${esc(o.cliente)}${falta ? ` · falta ${fq(arredondarQtd(l.qtd - l.sep))}` : ""}</small></span>
        <span class="caixa-q">${q}<small>/${fq(l.qtd)}</small></span></div>`;
    }).join("");
  }

  // cartão do endereço, produto e quantidade conforme o passo da vez
  function renderEndereco() {
    const e = etapa(), endOk = e !== "endereco";
    $("#addrCard").classList.toggle("ok", endOk);
    $("#addrCard").classList.toggle("wait", !endOk);
    $("#addrStatus").textContent = endOk ? "Endereço confirmado ✓" : "Leia o QR do endereço";
    $("#pickCard .product").classList.toggle("ok", e === "quantidade");
    $("#pickCard .product").classList.toggle("wait", e === "produto");
    $("#scanForm").hidden = e === "quantidade";
    $("#scanInput").placeholder = e === "endereco" ? "Bipe o QR ou digite o ID" : "Bipe ou digite EAN / SKU";
    $("#scanInput").dataset.teclado = "text"; // tipo de teclado quando a pessoa toca no campo (o foco automático não abre teclado)
    $(".qty").classList.toggle("locked", e !== "quantidade");
    $("#qtyInput").disabled = e !== "quantidade";
    $("#btnShort").disabled = !endOk; // falta (ex.: endereço vazio) só depois de confirmar o endereço
    if (e !== "quantidade") setTimeout(focarLeitura, 30); // pronto para o próximo bipe (endereço ou produto)
  }

  function renderQty() {
    const total = solicitado(), v = digitado();
    $("#qtyReq").textContent = fq(total);
    $(".qty-l").textContent = lote && vez() ? `Caixa ${vez().pos} · quantidade` : "Quantidade separada";

    const q = $(".qty");
    q.classList.toggle("full", v === total);
    q.classList.toggle("over", v != null && v > total);
    const pronto = etapa() === "quantidade" && v != null && v <= total;
    $("#btnConfirm").disabled = !pronto;
    $("#btnConfirm").textContent = pronto && v < total ? `Confirmar ${fq(v)} de ${fq(total)} · falta` : lote ? `Confirmar caixa ${vez()?.pos ?? ""}` : "Confirmar item";
    if (v != null && v > total) setMsg(`Acima do solicitado (${fq(total)}). Confira a quantidade.`, "err");
    if (Number.isNaN(v)) setMsg("Quantidade inválida. Use até 3 casas depois da vírgula (ex.: 101,5).", "err");
    if (lote) desenharCaixas(parada());
  }

  function setMsg(txt, kind = "") {
    if (kind !== "err") esconderAlerta(); // leitura certa (ou item novo) apaga o alerta de erro
    const m = $("#scanMsg"); m.textContent = txt; m.className = "scan-msg " + kind;
  }

  // erro de leitura: além da mensagem embaixo, uma faixa vermelha no topo por alguns segundos
  // (só aparece no modo compacto, nas telas pequenas dos coletores)
  let alertaTimer = null;
  function mostrarAlerta(txt) {
    const a = $("#pickAlerta"); a.textContent = txt; a.hidden = false;
    clearTimeout(alertaTimer); alertaTimer = setTimeout(() => (a.hidden = true), 3500);
  }
  function esconderAlerta() { clearTimeout(alertaTimer); $("#pickAlerta").hidden = true; }
  function erroLeitura(txt) {
    mostrarAlerta(txt);
    setMsg(txt, "err"); beep(false); vibrate([80, 50, 80]);
    const f = $("#scanForm"); f.classList.remove("err"); void f.offsetWidth; f.classList.add("err");
  }

  function handleCode(raw) {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    $("#scanInput").value = "";
    if (etapa() === "endereco") return lerEndereco(code);
    if (etapa() === "produto") return lerProduto(code);
    setMsg("Produto já confirmado · digite a quantidade"); focarQuantidade();
  }
  // confirmação do endereço: QR (código R3001-P7-A100-AP101) ou ID digitado do cadastro de endereços
  function lerEndereco(code) {
    const esperado = alvo();
    const achado = acharEndereco(lerEstoque().enderecos, code);
    const lidoCodigo = achado ? achado.codigo : code;
    if (lidoCodigo !== esperado) {
      // bipou o produto antes do endereço: explica o passo que falta
      return erroLeitura(ehDaVez(code) ? "PRIMEIRO LEIA O QR DO ENDEREÇO." : `ENDEREÇO ERRADO. VÁ PARA ${esperado}.`);
    }
    if (achado && !achado.ativo) return erroLeitura("ENDEREÇO INATIVO. AVISE O GESTOR DE ESTOQUE.");
    dono().endOk = esperado; save(); pedirEnvio();
    beep(true); vibrate(30);
    renderEndereco(); renderQty();
    setMsg("Endereço confirmado · agora bipe o produto", "ok");
  }
  // o produto é bipado UMA vez; depois o separador digita a quantidade
  function lerProduto(code) {
    if (!ehDaVez(code)) {
      const outro = (lote ? paradas() : current.itens).find((x) => ehCodigoDoProduto(x, code));
      return erroLeitura(outro ? `Produto de outro endereço (${outro.end}).` : "PRODUTO ERRADO. NÃO PERTENCE A ESTE ENDEREÇO.");
    }
    dono().prodOk = chaveProduto(); save(); pedirEnvio();
    beep(true); vibrate(30);
    renderEndereco(); renderQty();
    setMsg(lote ? `Produto confirmado · caixa ${vez().pos}: digite a quantidade (${fq(solicitado())})`
      : `Produto confirmado · digite a quantidade (solicitado ${fq(solicitado())})`, "ok");
    focarQuantidade();
  }
  function focarQuantidade() { const i = $("#qtyInput"); i.value = ""; renderQty(); setTimeout(() => i.focus(), 30); }
  $("#scanForm").addEventListener("submit", (e) => { e.preventDefault(); handleCode($("#scanInput").value); });

  // quantidade: Enter confirma. Se o leitor "digitar" um código aqui (bipou o produto de novo), não vira quantidade.
  // Código de barras = 5 ou mais dígitos sem vírgula. "101,5" tem vírgula, então é quantidade.
  $("#qtyInput").addEventListener("input", () => renderQty());
  $("#qtyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#qtyInput").value.trim().toUpperCase();
    if (/^\d{5,}$/.test(v) || ehDaVez(v)) { $("#qtyInput").value = ""; renderQty(); setMsg("Produto já confirmado · digite a quantidade", "err"); beep(false); return; }
    confirmItem();
  });

  function confirmItem() {
    if (etapa() !== "quantidade") return;
    const v = digitado(), total = solicitado();
    if (v == null || Number.isNaN(v) || v > total) return;
    if (v < total) { openShort(v); return; }
    if (lote) {
      // só a caixa da vez: a parada termina quando todas as caixas foram confirmadas
      const l = vez(), i = itemDaLinha(l);
      Object.assign(i, { sep: i.qtd, status: "ok", motivo: "" }); baixar(l.pedido, i);
      registrar("separacao.item", { pedido: l.pedido, sequencia: l.idx + 1, qtdSeparada: i.qtd, status: "ok" });
      save(); vibrate(30);
      return depoisDaCaixa(`Caixa ${l.pos} confirmada`);
    }
    const i = item();
    Object.assign(i, { sep: v, status: "ok", motivo: "" }); save();
    registrar("separacao.item", { pedido: current.id, sequencia: current.itens.indexOf(i) + 1, qtdSeparada: v, status: "ok" });
    baixar(current.id, i);
    next();
  }

  // o que foi separado sai do saldo do picking no Estoque (e, se ficar no mínimo, nasce a tarefa de abastecimento)
  function baixar(pedidoId, i) {
    if (i.sep > 0) baixarPorSeparacao({ endereco: i.end, produto: i.sku, qtd: i.sep, usuario: sess?.login, pedido: pedidoId });
  }
  $("#btnConfirm").addEventListener("click", confirmItem);

  // lote: terminou a caixa da vez. Ainda tem caixa nesta parada? Pede a próxima, sem bipar o endereço e o
  // produto de novo. Senão, vai para a próxima parada.
  function depoisDaCaixa(msg) {
    if (paradaConcluida(parada())) return next();
    renderParada(false);
    setMsg(`${msg} · agora a caixa ${vez().pos}`, "ok");
    focarQuantidade();
  }

  function next() {
    if (lote) return proximaParada(true);
    const o = current;
    const pend = o.itens.findIndex((x, k) => k > o.atual && x.status === "pendente");
    const any = pend >= 0 ? pend : o.itens.findIndex((x) => x.status === "pendente");
    if (any < 0) return abrirDoca({ pedidos: [o.id], lote: null });
    o.atual = any; save(); renderPick(true);
  }
  function proximaParada(desenhar = false) {
    const ps = paradas();
    const pend = ps.findIndex((x, k) => k > lote.atual && !paradaConcluida(x));
    const any = pend >= 0 ? pend : ps.findIndex((x) => !paradaConcluida(x));
    if (any < 0) return abrirDoca({ pedidos: [...lote.pedidos], lote: lote.id });
    lote.atual = any; save();
    if (desenhar) renderPick(true);
  }

  // falta
  let reason = "Endereço vazio";
  function openShort(qtd) {
    const total = solicitado();
    $("#shortDesc").textContent = lote
      ? `${parada().desc} · caixa ${vez().pos} (${vez().pedido}) · solicitado ${fq(total)} un.`
      : `${item().desc} · solicitado ${fq(total)} un.`;
    $("#shortCampos").hidden = false; $("#shortTodas").hidden = true;
    $("#shortQty").value = fq(qtd ?? (Number.isNaN(digitado()) ? 0 : digitado() ?? 0));
    openSheet("sheetShort");
  }
  $("#btnShort").addEventListener("click", () => enderecoOk() && openShort());
  $("#shortReasons").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    reason = c.dataset.r;
    $$("#shortReasons .chip").forEach((x) => x.classList.toggle("active", x === c));
  });
  // quanto achou na falta: de zero até menos que o solicitado (pode ser quebrado). null = inválido, avisa e não fecha.
  function quantidadeDaFalta(total) {
    const q = lerQuantidade($("#shortQty").value.trim() || "0");
    if (quantidadeValida(q) && q < total) return q;
    toast(`Informe de 0 até menos que ${fq(total)} (até 3 casas depois da vírgula).`);
    return null;
  }
  // lote: a falta é da caixa da vez (o que o separador colocou nela)
  function lancarFalta(l, q, motivo) {
    const i = itemDaLinha(l);
    Object.assign(i, { sep: q, status: "falta", motivo });
    registrar("separacao.item", { pedido: l.pedido, sequencia: l.idx + 1, qtdSeparada: q, status: "falta", motivo });
    baixar(l.pedido, i);
  }
  function fecharFaltaDoLote(l, q) {
    save(); closeSheets(); vibrate(40);
    toast(`Falta registrada · caixa ${l.pos} ${fq(q)}/${fq(l.qtd)}`);
    depoisDaCaixa(`Falta na caixa ${l.pos}`);
  }
  // endereço vazio (falta com 0): pergunta se as outras caixas desta parada também ficam com falta
  let faltaPendente = null; // { caixa, outras, motivo }
  $("#shortGo").addEventListener("click", () => {
    if (lote) {
      const l = vez();
      const q = quantidadeDaFalta(l.qtd); if (q == null) return;
      lancarFalta(l, q, reason);
      const outras = q === 0 ? outrasCaixasPendentes(parada(), l) : [];
      if (!outras.length) return fecharFaltaDoLote(l, q);
      save();
      faltaPendente = { caixa: l, outras, motivo: reason };
      const nomes = outras.map((x) => x.pos).join(", ");
      $("#shortTodasT").textContent = `Nada no endereço para a caixa ${l.pos}. As caixas ${nomes} desta parada também vão ficar sem este produto?`;
      $("#shortTodasSim").textContent = `Sim, falta também na${outras.length > 1 ? "s caixas" : " caixa"} ${nomes}`;
      $("#shortTodasNao").textContent = `Não, só a caixa ${l.pos}`;
      $("#shortCampos").hidden = true; $("#shortTodas").hidden = false;
      return;
    }
    const i = item();
    const q = quantidadeDaFalta(i.qtd); if (q == null) return;
    Object.assign(i, { sep: q, status: "falta", motivo: reason });
    registrar("separacao.item", { pedido: current.id, sequencia: current.itens.indexOf(i) + 1, qtdSeparada: q, status: "falta", motivo: reason });
    save(); closeSheets(); vibrate(40);
    baixar(current.id, i);
    toast(`Falta registrada · ${fq(q)}/${fq(i.qtd)}`);
    next();
  });

  $("#shortTodasSim").addEventListener("click", () => {
    const f = faltaPendente; if (!f) return;
    f.outras.forEach((x) => lancarFalta(x, 0, f.motivo));
    faltaPendente = null;
    save(); closeSheets(); vibrate(40);
    toast(`Falta registrada · caixas ${[f.caixa, ...f.outras].map((x) => x.pos).join(", ")}`);
    depoisDaCaixa("Falta registrada");
  });
  $("#shortTodasNao").addEventListener("click", () => {
    const f = faltaPendente; if (!f) return;
    faltaPendente = null;
    fecharFaltaDoLote(f.caixa, 0);
  });

  // lista de itens (pedido) ou de paradas (lote)
  $("#pickListBtn").addEventListener("click", () => {
    if (lote) {
      $("#listTitle").textContent = "Paradas do lote";
      $("#pickItems").innerHTML = paradas().map((p, k) => {
        const st = paradaConcluida(p) ? (p.linhas.some((l) => l.status === "falta") ? "falta" : "ok") : "pendente";
        const dot = st === "ok" ? `<span class="dot ok">${CHECK}</span>` : st === "falta" ? `<span class="dot falta">!</span>` : `<span class="dot"></span>`;
        return `<button class="line ${k === lote.atual ? "current" : ""}" data-idx="${k}">${dot}<span class="line-addr">${p.end}</span>
          <span class="line-desc">${esc(p.desc)}<small>${p.linhas.map((l) => `${l.pos} ${fq(l.qtd)}`).join(" · ")}</small></span><span class="line-q">${st === "pendente" ? fq(p.total) : fq(p.lido) + "/" + fq(p.total)}</span></button>`;
      }).join("");
    } else {
      $("#listTitle").textContent = "Itens do pedido";
      $("#pickItems").innerHTML = current.itens.map((i, k) => lineHtml(i, k, k === current.atual)).join("");
    }
    openSheet("sheetList");
  });
  $("#pickItems").addEventListener("click", (e) => {
    const l = e.target.closest(".line[data-idx]"); if (!l) return;
    if (lote) lote.atual = +l.dataset.idx; else current.atual = +l.dataset.idx;
    save(); closeSheets(); renderPick(true);
  });

  $("#pickBack").addEventListener("click", () => {
    current = null; lote = null; renderHome(); show("viewHome");
    toast("Separação pausada · continue quando quiser");
  });

  // ---------- doca de expedição: onde o separador deixou a mercadoria ----------
  // Leitura só por QR ou ID digitado (não se escolhe na lista). A lista mostra quantos pedidos esperam em cada doca.
  function abrirDoca(alvo) {
    docaAlvo = alvo;
    const ps = alvo.pedidos.map(pedido);
    $("#docaTitulo").textContent = alvo.lote ? `${alvo.lote} · ${ps.length} pedidos` : nomeDo(ps[0]);
    $("#docaSub").textContent = alvo.lote ? "Todas as caixas do carrinho vão para a mesma doca." : ps[0].cliente;
    $("#docaInput").value = ""; setDocaMsg("");
    desenharDocas();
    show("viewDoca");
    setTimeout(() => $("#docaInput").focus(), 60);
  }
  function setDocaMsg(t, k = "") { const m = $("#docaMsg"); m.textContent = t; m.className = "scan-msg " + k; }
  function desenharDocas() {
    const docas = lerEstoque().enderecos.filter((e) => e.tipo === "expedicao" && e.ativo).sort((a, b) => compararEnderecos(a.codigo, b.codigo));
    const ocup = ocupacaoDasDocas();
    $("#docaList").innerHTML = docas.map((d) => {
      const n = ocup[d.id] || 0;
      return `<div class="line"><span class="line-addr">${d.codigo}</span><span class="line-desc">ID ${d.id}</span>
        <span class="tag ${n ? "andamento" : "concluido"}">${n ? `${n} pedido${n > 1 ? "s" : ""}` : "Livre"}</span></div>`;
    }).join("") || `<p class="empty">Nenhuma doca de expedição cadastrada. Peça ao gestor de estoque para cadastrar.</p>`;
  }
  // pedidos que estão esperando o conferente em cada doca (separados e ainda não conferidos)
  function ocupacaoDasDocas() {
    const conf = lerPedidosDaConferencia(setor());
    const conferidos = new Set(conf.filter((o) => ["conferido", "divergente"].includes(o.conf?.status)).map((o) => o.id));
    const onde = new Map();
    conf.filter((o) => o.doca && !conferidos.has(o.id)).forEach((o) => onde.set(o.id, o.doca.id));
    orders.filter((o) => o.status === "concluido" && o.doca && !conferidos.has(o.parte ? o.parte.pai : o.id)).forEach((o) => onde.set(o.id, o.doca.id));
    const n = {};
    onde.forEach((id) => (n[id] = (n[id] || 0) + 1));
    return n;
  }
  $("#docaForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const lido = $("#docaInput").value.trim(); if (!lido) return;
    $("#docaInput").value = "";
    const end = acharEndereco(lerEstoque().enderecos, lido);
    const erro = validarDocaExpedicao(end);
    if (erro) {
      setDocaMsg(erro, "err"); beep(false); vibrate([80, 50, 80]);
      const f = $("#docaForm"); f.classList.remove("err"); void f.offsetWidth; f.classList.add("err");
      return;
    }
    beep(true);
    concluir({ id: end.id, codigo: end.codigo });
  });
  $("#docaBack").addEventListener("click", () => {
    // ainda falta a doca: o pedido continua "em separação" e volta para a lista
    current = null; lote = null; docaAlvo = null; renderHome(); show("viewHome");
    toast("Falta informar a doca · continue quando quiser");
  });

  function concluir(doca) {
    // pedido de lote cancelado pelo gestor sem nada separado não vai para a doca
    const fim = Date.now(), ps = docaAlvo.pedidos.map(pedido).filter((o) => o.status !== "cancelado");
    ps.forEach((o) => {
      Object.assign(o, { status: "concluido", fim, doca: { ...doca, quando: fim, por: user } });
      registrar("separacao.concluir", { pedido: o.id, doca: doca.codigo });
    });
    const l = docaAlvo.lote ? lotes.find((x) => x.id === docaAlvo.lote) : null;
    if (l) Object.assign(l, { status: "concluido", fim, doca });
    save();
    const inicio = l ? l.inicio : ps[0].inicio;
    const itens = ps.flatMap((o) => o.itens), faltas = itens.filter((i) => i.status === "falta");
    $("#doneOrder").textContent = l ? `${l.id} · ${ps.map((o) => `${l.posicoes[o.id]} ${o.id}`).join(" · ")}` : `${nomeDo(ps[0])} · ${ps[0].cliente}`;
    $("#doneDoca").innerHTML = `Mercadoria na doca <b>${doca.codigo}</b>${l ? ` · ${ps.length} pedidos` : ""}`;
    $("#doneTime").textContent = fmtMin(fim - inicio);
    $("#doneOk").textContent = itens.length - faltas.length;
    $("#doneShort").textContent = faltas.length;
    $("#doneShortList").innerHTML = faltas.map((i) => lineHtml(i)).join("");
    vibrate([40, 60, 120]);
    current = null; lote = null; docaAlvo = null;
    show("viewDone");
  }
  $("#doneBack").addEventListener("click", () => { renderHome(); show("viewHome"); });

  // ---------- câmera (abre pelo botão; o leitor fica em js/ui-coletor.js) ----------
  $("#camBtn").addEventListener("click", () => openCam(handleCode));
  $("#docaCam").addEventListener("click", () => openCam((c) => { $("#docaInput").value = c; $("#docaForm").requestSubmit(); }));

  // ---------- menu ----------
  $$(".menu-btn").forEach((b) => b.addEventListener("click", () => {
    $("#menuName").textContent = user;
    $("#menuPerfil").textContent = PERFIS[sess.perfil];
    const ts = sess.perfil === "sep" && !!sess.setor;
    $("#menuSetorL").hidden = $("#menuSetorBtn").hidden = !ts;
    if (ts) $("#menuSetor").textContent = SETORES[sess.setor];
    $("#menuReset").textContent = sess.token ? "Atualizar a lista do servidor" : "Reiniciar dados de demonstração";
    openSheet("sheetMenu");
  }));
  $("#menuSetorBtn").addEventListener("click", () => openSetor(true));
  $("#menuReset").addEventListener("click", () => {
    // com servidor, a lista é a do servidor: baixa de novo (o que está na fila de envio continua guardado)
    if (sess?.token) {
      closeSheets(); selecionando = false; selecionados.clear();
      goHome(); toast("Atualizando a lista do servidor…");
      return;
    }
    orders = pedidosDeDemonstracao(setor()); lotes = lotesDeDemonstracao(setor()); save(); closeSheets();
    selecionando = false; selecionados.clear();
    document.dispatchEvent(new Event("wms:reset"));
    goHome(); toast("Dados de demonstração reiniciados");
  });
  // Sair: com servidor, avisa o servidor (login único) e manda o que estiver na fila antes (js/sair.js)
  $("#menuLogout").addEventListener("click", async () => {
    const r = await sairDoAparelho({ sessao: sess });
    if (!r.ok) { if (r.mensagem) { toast(r.mensagem); beep(false); vibrate([80, 50, 80]); } return; }
    sess = null; user = ""; closeSheets(); document.body.classList.remove("setor-mont");
    $("#loginName").value = ""; $("#loginPin").value = ""; $("#loginErr").hidden = true; show("viewLogin");
  });

  // ---------- início ----------
  // inicia depois que todos os scripts carregarem
  document.addEventListener("DOMContentLoaded", goHome);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
