// WMS Beach Bike — MVP de Separação (dados locais de demonstração)
// Três jeitos de separar:
//   · um pedido (ou uma PARTE de um pedido grande que o coordenador dividiu entre separadores);
//   · um LOTE: vários pedidos numa viagem só, com uma caixa por pedido no carrinho (A, B, C…);
//   · e, no fim de qualquer um deles, o separador lê o QR da DOCA DE EXPEDIÇÃO onde deixou a mercadoria.
// Em cada item (ou parada do lote): CONFIRMA O ENDEREÇO (QR ou ID digitado), BIPA O PRODUTO uma vez e DIGITA A QUANTIDADE.
// Assim o sistema sabe que ele está na prateleira certa com o produto certo, e a falta "endereço vazio" é confiável.
// As regras ficam em compartilhado/regras/separacao.js.
import { USERS, PERFIS, SETORES, session, login, logout, setSetor, homeUrl } from "./js/sessao.js";
import { carregarPedidos, salvarPedidos, pedidosDeDemonstracao, carregarLotes, salvarLotes, lotesDeDemonstracao } from "./js/dados/separacao.js";
import { lerPedidosDaConferencia, statusNaConferencia, retirarDaConferencia } from "./js/dados/conferencia.js";
import { baixarPorSeparacao, estornarSeparacao } from "./js/dados/movimentacao.js";
import { lerEstoque } from "./js/dados/estoque.js";
import { ehCodigoDoProduto } from "./compartilhado/regras/produtos.js";
import { $, $$, esc } from "./js/util.js";
import { show, openSheet, closeSheets, toast, beep, vibrate, openCam, CHECK } from "./js/ui-coletor.js";
import { Embarque } from "./embarque.js";
import { lerCodigoDoEndereco, acharEndereco, compararEnderecos } from "./compartilhado/regras/enderecos.js";
import {
  validarDocaExpedicao, validarLote, posicoesDoLote, montarParadas, paradaConcluida, distribuirAchado, MAX_PEDIDOS_LOTE,
  podeSepararNovamente,
} from "./compartilhado/regras/separacao.js";

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

  // ---------- login ----------
  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const s = login($("#loginName").value, $("#loginPin").value);
    if (!s) {
      $("#loginErr").hidden = false; vibrate([80, 50, 80]);
      $("#loginPin").value = ""; $("#loginPin").focus();
      return;
    }
    $("#loginErr").hidden = true;
    sess = s; user = s.nome;
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
  }

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
    const avulsos = orders.filter((o) => !noLoteAtivo.has(o.id))
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
  const rank = (o) => ({ andamento: 0, pendente: 1, concluido: 2 }[o.status] * 10 + (o.prio === "alta" ? 0 : 1));
  const rankLote = (l) => (l.status === "andamento" ? 0 : 10) + (pedidosDoLote(l).some((o) => o.prio === "alta") ? 0 : 1);
  // pode entrar num lote: pedido que ainda não começou, fora de lote e que não é parte de pedido dividido
  const podeSelecionar = (o) => o.status === "pendente" && !o.lote && !o.parte;

  function orderCard(o) {
    const pct = Math.round((doneCount(o) / o.itens.length) * 100);
    const sel = selecionando && podeSelecionar(o), marcado = selecionados.has(o.id);
    const tag = o.status === "concluido" ? `<span class="tag concluido">Concluído</span>`
      : o.status === "andamento" ? `<span class="tag andamento">Em separação</span>`
      : o.prio === "alta" ? `<span class="tag alta">Prioridade</span>` : `<span class="tag">Pendente</span>`;
    const extra = o.parte ? `<p class="order-note">Pedido dividido pelo coordenador · ${esc(o.parte.ruas || "")}</p>` : "";
    const doca = o.doca ? `<p class="order-note ok">Deixado na doca ${o.doca.codigo}</p>` : "";
    return `<button class="order ${o.status === "concluido" ? "is-done" : ""} ${selecionando && !sel ? "is-off" : ""} ${marcado ? "is-sel" : ""}" data-id="${esc(o.id)}">
      <div class="order-top">
        ${sel ? `<span class="order-cb">${marcado ? CHECK : ""}</span>` : ""}
        <div class="grow"><p class="order-id">${esc(nomeDo(o))}</p><p class="order-client">${esc(o.cliente)}</p></div>${tag}
      </div>
      ${extra}
      <div class="order-meta"><span><b>${o.itens.length}</b> itens</span><span><b>${units(o)}</b> un.</span><span>${o.cidade}</span><span>${o.hora}</span></div>
      ${o.status !== "pendente" ? `<div class="order-bar"><i style="width:${pct}%"></i></div>` : ""}
      ${doca}
    </button>`;
  }

  function loteCard(l) {
    const ps = pedidosDoLote(l);
    const itens = ps.reduce((t, o) => t + o.itens.length, 0), un = ps.reduce((t, o) => t + units(o), 0);
    const feitos = ps.reduce((t, o) => t + doneCount(o), 0);
    const tag = l.status === "andamento" ? `<span class="tag andamento">Em separação</span>` : `<span class="tag lote">Lote</span>`;
    return `<button class="order lote" data-lote="${l.id}">
      <div class="order-top">
        <div class="grow"><p class="order-id">${l.id} · ${ps.length} pedidos</p>
        <p class="order-client">${l.criadoPor.tipo === "coordenador" ? "Montado pelo coordenador" : "Montado por você"} · uma viagem só</p></div>${tag}
      </div>
      <div class="lote-peds">${ps.map((o) => `<span><b class="cx-pos">${l.posicoes[o.id]}</b>${esc(o.id)}</span>`).join("")}</div>
      <div class="order-meta"><span><b>${itens}</b> itens</span><span><b>${un}</b> un.</span></div>
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
  const posLine = (pos, o) => `<div class="line"><b class="cx-pos big">${pos}</b><span class="line-desc">${esc(o.id)} · ${esc(o.cliente)}<small>${o.itens.length} itens · ${units(o)} un.${o.prio === "alta" ? " · prioridade" : ""}</small></span></div>`;

  $("#orderList").addEventListener("click", (e) => {
    const lc = e.target.closest("[data-lote]");
    if (lc) return abrirLote(lotes.find((l) => l.id === lc.dataset.lote));
    const card = e.target.closest(".order"); if (!card) return;
    const o = pedido(card.dataset.id);
    if (selecionando) {
      if (!podeSelecionar(o)) return toast(o.parte ? "Parte de pedido dividido não entra em lote." : "Só pedidos pendentes entram no lote.");
      if (!selecionados.has(o.id) && selecionados.size >= MAX_PEDIDOS_LOTE) return toast(`O lote aceita no máximo ${MAX_PEDIDOS_LOTE} pedidos.`);
      selecionados.has(o.id) ? selecionados.delete(o.id) : selecionados.add(o.id);
      vibrate(20); return renderHome();
    }
    $("#startOrder").textContent = nomeDo(o);
    $("#startClient").textContent = `${o.cliente} · ${o.itens.length} itens · ${units(o)} un.${o.parte ? ` · ${o.parte.ruas}` : ""}`;
    const pr = $("#startPrio");
    pr.className = "tag " + (o.status === "concluido" ? "concluido" : o.status === "andamento" ? "andamento" : o.prio === "alta" ? "alta" : "");
    pr.textContent = o.status === "concluido" ? "Concluído" : o.status === "andamento" ? "Em separação" : o.prio === "alta" ? "Prioridade" : "Normal";
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
    const dot = i.status === "ok" ? `<span class="dot ok">${CHECK}</span>`
      : i.status === "falta" ? `<span class="dot falta">!</span>` : `<span class="dot"></span>`;
    return `<button class="line ${cur ? "current" : ""}" ${idx != null ? `data-idx="${idx}"` : ""}>
      ${dot}<span class="line-addr">${i.end}</span>
      <span class="line-desc">${esc(i.desc)}<small>${i.sku}${i.status === "falta" ? " · " + esc(i.motivo) : ""}</small></span>
      <span class="line-q">${i.status === "pendente" ? i.qtd : i.sep + "/" + i.qtd}</span>
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
      retirarDaConferencia(setor(), idNaConferencia);
      o.itens.forEach((i) => Object.assign(i, { sep: 0, status: "pendente", motivo: "" }));
      Object.assign(o, { status: "pendente", atual: 0, doca: null, lote: null, pos: null, endOk: null, prodOk: null });
    }
    if (o.status === "pendente") { o.status = "andamento"; o.inicio = Date.now(); o.operador = user; }
    current = o; lote = null; save(); closeSheets();
    // todos os itens já resolvidos (saiu do app na hora de ler a doca): vai direto para a doca
    if (!o.itens.some((i) => i.status === "pendente")) return abrirDoca({ pedidos: [o.id], lote: null });
    show("viewPick"); renderPick(true);
  });

  function criarLoteEIniciar() {
    const ps = [...selecionados].map(pedido);
    const erro = validarLote(ps); if (erro) return toast(erro);
    const posicoes = posicoesDoLote(ps);
    const n = Math.max(0, ...lotes.map((l) => +l.id.slice(2) || 0)) + 1;
    const l = { id: `L-${n}`, pedidos: ps.map((o) => o.id).sort((a, b) => posicoes[a].localeCompare(posicoes[b])), posicoes, status: "pendente",
      criadoPor: { tipo: "separador", login: sess.login, nome: user }, criado: Date.now(), inicio: null, fim: null, operador: null, atual: 0 };
    ps.forEach((o) => Object.assign(o, { lote: l.id, pos: posicoes[o.id] }));
    lotes.push(l);
    selecionando = false; selecionados.clear();
    iniciarLote(l);
  }

  function iniciarLote(l) {
    if (l.status === "pendente") {
      Object.assign(l, { status: "andamento", inicio: Date.now(), operador: user });
      pedidosDoLote(l).forEach((o) => Object.assign(o, { status: "andamento", inicio: l.inicio, operador: user }));
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
  const solicitado = () => (lote ? parada().total : item().qtd);
  const ehDaVez = (code) => ehCodigoDoProduto(lote ? parada() : item(), code);
  // quantidade digitada (null = ainda vazio)
  const digitado = () => { const v = $("#qtyInput").value.trim(); return v === "" ? null : Math.max(0, parseInt(v, 10) || 0); };

  // as caixas do carrinho nesta parada: quanto vai em cada uma. Com a quantidade digitada menor que o total,
  // mostra como o achado será distribuído (a caixa A primeiro) e quem fica com falta
  function desenharCaixas(p) {
    const v = digitado(), dist = v != null && v < p.total ? distribuirAchado(p.linhas, v) : null;
    $("#loteBox").hidden = false;
    $("#loteBox").innerHTML = `<p class="lote-h">Total desta parada: <b>${p.total}</b> · coloque em cada caixa</p>` + p.linhas.map((l, k) => {
      const o = pedido(l.pedido), vai = dist ? dist[k].sep : l.qtd, falta = dist && dist[k].falta;
      return `<div class="caixa ${falta ? "falta" : ""} ${l.status === "ok" ? "cheia" : ""}">
        <b class="cx-pos big">${l.pos}</b><span class="caixa-ped">${esc(l.pedido)}<small>${esc(o.cliente)}${falta ? ` · falta ${l.qtd - vai}` : ""}</small></span>
        <span class="caixa-q">${vai}<small>/${l.qtd}</small></span></div>`;
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
    $("#scanInput").placeholder = e === "endereco" ? "Bipe o QR ou digite o ID do endereço" : "Bipe ou digite o EAN / SKU do produto";
    $("#scanInput").inputMode = "text";
    $(".qty").classList.toggle("locked", e !== "quantidade");
    $("#qtyInput").disabled = e !== "quantidade";
    $("#btnShort").disabled = !endOk; // falta (ex.: endereço vazio) só depois de confirmar o endereço
  }

  function renderQty() {
    const total = solicitado(), v = digitado();
    $("#qtyReq").textContent = total;

    const q = $(".qty");
    q.classList.toggle("full", v === total);
    q.classList.toggle("over", v != null && v > total);
    const pronto = etapa() === "quantidade" && v != null && v <= total;
    $("#btnConfirm").disabled = !pronto;
    $("#btnConfirm").textContent = pronto && v < total ? `Confirmar ${v} de ${total} · falta` : lote ? "Confirmar parada" : "Confirmar item";
    if (v != null && v > total) setMsg(`Acima do solicitado (${total}). Confira a quantidade.`, "err");
    if (lote) desenharCaixas(parada());
  }

  function setMsg(txt, kind = "") {
    const m = $("#scanMsg"); m.textContent = txt; m.className = "scan-msg " + kind;
  }

  function erroLeitura(txt) {
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
    dono().endOk = esperado; save();
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
    dono().prodOk = chaveProduto(); save();
    beep(true); vibrate(30);
    renderEndereco(); renderQty();
    setMsg(`Produto confirmado · digite a quantidade (solicitado ${solicitado()})`, "ok");
    focarQuantidade();
  }
  function focarQuantidade() { const i = $("#qtyInput"); i.value = ""; renderQty(); setTimeout(() => i.focus(), 30); }
  $("#scanForm").addEventListener("submit", (e) => { e.preventDefault(); handleCode($("#scanInput").value); });

  // quantidade: Enter confirma. Se o leitor "digitar" um código aqui (bipou o produto de novo), não vira quantidade.
  $("#qtyInput").addEventListener("input", () => renderQty());
  $("#qtyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#qtyInput").value.trim().toUpperCase();
    if (v.length > 4 || ehDaVez(v)) { $("#qtyInput").value = ""; renderQty(); setMsg("Produto já confirmado · digite a quantidade", "err"); beep(false); return; }
    confirmItem();
  });

  function confirmItem() {
    if (etapa() !== "quantidade") return;
    const v = digitado(), total = solicitado();
    if (v == null || v > total) return;
    if (v < total) { openShort(v); return; }
    if (lote) {
      parada().linhas.forEach((l) => { const i = itemDaLinha(l); Object.assign(i, { sep: i.qtd, status: "ok", motivo: "" }); baixar(l.pedido, i); });
      save(); return next();
    }
    const i = item();
    Object.assign(i, { sep: v, status: "ok", motivo: "" }); save();
    baixar(current.id, i);
    next();
  }

  // o que foi separado sai do saldo do picking no Estoque (e, se ficar no mínimo, nasce a tarefa de abastecimento)
  function baixar(pedidoId, i) {
    if (i.sep > 0) baixarPorSeparacao({ endereco: i.end, produto: i.sku, qtd: i.sep, usuario: sess?.login, pedido: pedidoId });
  }
  $("#btnConfirm").addEventListener("click", confirmItem);

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
    $("#shortDesc").textContent = `${lote ? parada().desc : item().desc} · solicitado ${total} un.${lote ? " · o que achar vai primeiro para a caixa A" : ""}`;
    $("#shortQty").value = qtd ?? digitado() ?? 0;
    $("#shortQty").max = total - 1;
    openSheet("sheetShort");
  }
  $("#btnShort").addEventListener("click", () => enderecoOk() && openShort());
  $("#shortReasons").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    reason = c.dataset.r;
    $$("#shortReasons .chip").forEach((x) => x.classList.toggle("active", x === c));
  });
  $("#shortGo").addEventListener("click", () => {
    if (lote) {
      const p = parada();
      const q = Math.max(0, Math.min(p.total - 1, parseInt($("#shortQty").value, 10) || 0));
      // o achado vai primeiro para a caixa A (prioridade), depois B… quem ficou sem completar fica com falta
      distribuirAchado(p.linhas, q).forEach((x) => {
        const i = pedido(x.pedido).itens[x.idx];
        Object.assign(i, { sep: x.sep, status: x.falta ? "falta" : "ok", motivo: x.falta ? reason : "" });
        baixar(x.pedido, i);
      });
      save(); closeSheets(); vibrate(40);
      toast(`Falta registrada · ${q}/${p.total}`);
      return next();
    }
    const i = item();
    const q = Math.max(0, Math.min(i.qtd - 1, parseInt($("#shortQty").value, 10) || 0));
    Object.assign(i, { sep: q, status: "falta", motivo: reason });
    save(); closeSheets(); vibrate(40);
    baixar(current.id, i);
    toast(`Falta registrada · ${q}/${i.qtd}`);
    next();
  });

  // lista de itens (pedido) ou de paradas (lote)
  $("#pickListBtn").addEventListener("click", () => {
    if (lote) {
      $("#listTitle").textContent = "Paradas do lote";
      $("#pickItems").innerHTML = paradas().map((p, k) => {
        const st = paradaConcluida(p) ? (p.linhas.some((l) => l.status === "falta") ? "falta" : "ok") : "pendente";
        const dot = st === "ok" ? `<span class="dot ok">${CHECK}</span>` : st === "falta" ? `<span class="dot falta">!</span>` : `<span class="dot"></span>`;
        return `<button class="line ${k === lote.atual ? "current" : ""}" data-idx="${k}">${dot}<span class="line-addr">${p.end}</span>
          <span class="line-desc">${esc(p.desc)}<small>${p.linhas.map((l) => `${l.pos} ${l.qtd}`).join(" · ")}</small></span><span class="line-q">${st === "pendente" ? p.total : p.lido + "/" + p.total}</span></button>`;
      }).join("");
    } else {
      $("#listTitle").textContent = "Itens do pedido";
      $("#pickItems").innerHTML = current.itens.map((i, k) => lineHtml(i, k, k === current.atual)).join("");
    }
    openSheet("sheetList");
  });
  $("#pickItems").addEventListener("click", (e) => {
    const l = e.target.closest(".line"); if (!l) return;
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
    const fim = Date.now(), ps = docaAlvo.pedidos.map(pedido);
    ps.forEach((o) => Object.assign(o, { status: "concluido", fim, doca: { ...doca, quando: fim, por: user } }));
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
    openSheet("sheetMenu");
  }));
  $("#menuSetorBtn").addEventListener("click", () => openSetor(true));
  $("#menuReset").addEventListener("click", () => {
    orders = pedidosDeDemonstracao(setor()); lotes = lotesDeDemonstracao(setor()); save(); closeSheets();
    selecionando = false; selecionados.clear();
    document.dispatchEvent(new Event("wms:reset"));
    goHome(); toast("Dados de demonstração reiniciados");
  });
  $("#menuLogout").addEventListener("click", () => {
    logout(); sess = null; user = ""; closeSheets(); document.body.classList.remove("setor-mont");
    $("#loginName").value = ""; $("#loginPin").value = ""; show("viewLogin");
  });

  // ---------- início ----------
  // inicia depois que todos os scripts carregarem
  document.addEventListener("DOMContentLoaded", goHome);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
