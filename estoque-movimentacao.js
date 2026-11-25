// WMS Beach Bike — coletor do Estoquista, menu MOVIMENTAÇÃO: abastecimento (aéreo → picking) e transferência.
// Endereços e produto entram só por leitura (bipar o QR/embalagem ou digitar ID/código), nunca tocando numa lista.
// As regras ficam em compartilhado/regras/movimentacao.js e os dados passam por js/dados/movimentacao.js.
import { $, $$, esc } from "./js/util.js";
import { session } from "./js/sessao.js";
import { closeSheets, toast } from "./js/ui-coletor.js";
import { num, tipoTag, msg, confirmar, cartaoProduto } from "./js/ui-estoque.js";
import { lerEstoque, enderecoPorId, produtoPorCodigo, saldoNoEndereco, enderecosPadraoDoProduto } from "./js/dados/estoque.js";
import { tarefaPorId, tarefasPendentes, criarTarefa, abastecer, finalizarParcial, cancelarTarefa, transferir, saldoTransferivel } from "./js/dados/movimentacao.js";
import { acharEndereco, compararEnderecos } from "./compartilhado/regras/enderecos.js";
import { acharPorCodigoLido } from "./compartilhado/regras/embalagens.js";
import {
  PRIORIDADES, STATUS_TAREFA, tarefaPendente, planejadoDaTarefa, abastecidoDaTarefa, quantidadePermitida, validarTransferencia,
  MSG_ORIGEM_FORA_DA_TAREFA, MSG_PRODUTO_DA_TAREFA, MSG_DESTINO_DA_TAREFA, MSG_ACIMA_DO_PLANEJADO, MSG_SALDO_ORIGEM, MSG_SEM_SALDO_NA_ORIGEM,
} from "./compartilhado/regras/movimentacao.js";
import { MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO } from "./compartilhado/regras/enderecos.js";

let db = null; // lido ao abrir (com servidor, o Estoque da demonstração nem é lido)
const usuario = () => session()?.login || "";
const linhaEndereco = (e, extra = "") => `<div class="rc-doca">${tipoTag(e.tipo)}<span class="line-addr">${e.codigo}</span>${extra}</div>`;
const pilulaPrioridade = (t) => `<span class="rc-st ${t.prioridade === "urgente" ? "r" : "g"}">${PRIORIDADES[t.prioridade]}</span>`;
const pilulaStatus = (t) => `<span class="rc-st ${t.status === "andamento" ? "y" : "g"}">${STATUS_TAREFA[t.status]}</span>`;
// endereço lido: precisa existir e estar ativo (QR de endereço inativo fica bloqueado no coletor)
function enderecoLido(lido) {
  const e = acharEndereco(db.enderecos, lido);
  if (!e) return { msg: MSG_ENDERECO_NAO_ENCONTRADO };
  if (!e.ativo) return { msg: MSG_ENDERECO_INATIVO };
  return { e };
}

// número do menu: tarefas pendentes e urgentes
export function resumoMovimentacao() {
  db = lerEstoque();
  const ts = tarefasPendentes(db);
  const urg = ts.filter((t) => t.prioridade === "urgente").length;
  $("#mnAbast").textContent = ts.length ? `${ts.length} tarefa(s)${urg ? ` · ${urg} urgente(s)` : ""}` : "Nenhuma tarefa pendente";
}

export function abrirMovimentacao(tela) {
  db = lerEstoque();
  if (tela === "viewAbast") iniciarAbastecimento();
  if (tela === "viewTransf") iniciarTransferencia();
}

// outro aparelho (ou o WEB) mudou algo: a tela aberta se redesenha
export function atualizarMovimentacao() {
  db = lerEstoque();
  if (!$("#viewAbast").hidden) desenharAbastecimento();
  if (!$("#viewTransf").hidden) desenharTransferencia();
}

$$("[data-mvvoltar]").forEach((b) => b.addEventListener("click", () => {
  closeSheets();
  const tela = b.closest(".view").id;
  if (tela === "viewAbast" && (ab.tarefaId || ab.solicitar)) return voltarAbastecimento();
  if (tela === "viewTransf" && tr.origemId) return voltarTransferencia();
  document.dispatchEvent(new Event("voltar-menu"));
}));

// =====================================================================
// ABASTECIMENTO: tarefa → QR da origem (aéreo) → produto → quantidade → QR do picking → CONFIRMAR ABASTECIMENTO
// =====================================================================
const ab = { tarefaId: null, origemId: null, produtoOk: false, qtd: null, destinoOk: false, solicitar: false, solProduto: null };
const limparPasso = () => Object.assign(ab, { origemId: null, produtoOk: false, qtd: null, destinoOk: false });

function iniciarAbastecimento() {
  Object.assign(ab, { tarefaId: null, solicitar: false, solProduto: null }); limparPasso();
  msg($("#abMsg"), ""); $("#abInput").value = "";
  desenharAbastecimento();
}

// voltar um passo: destino → quantidade → produto → origem → lista
function voltarAbastecimento() {
  msg($("#abMsg"), "");
  if (ab.solicitar) { if (ab.solProduto) ab.solProduto = null; else ab.solicitar = false; return desenharAbastecimento(); }
  if (ab.destinoOk) ab.destinoOk = false;
  else if (ab.qtd) ab.qtd = null;
  else if (ab.produtoOk) ab.produtoOk = false;
  else if (ab.origemId) ab.origemId = null;
  else ab.tarefaId = null;
  desenharAbastecimento();
}

function desenharAbastecimento() {
  const t = ab.tarefaId ? tarefaPorId(db, ab.tarefaId) : null;
  // a tarefa foi encerrada em outro aparelho (ou cancelada no WEB) enquanto esta tela estava aberta
  if (ab.tarefaId && (!t || !tarefaPendente(t))) { iniciarAbastecimento(); return msg($("#abMsg"), "TAREFA ENCERRADA EM OUTRO APARELHO.", "err"); }
  $("#abFoot").hidden = !t;
  $("#abForm").hidden = !(ab.solicitar || (t && !(ab.produtoOk && !ab.qtd) && !ab.destinoOk));
  if (ab.solicitar) return desenharSolicitar();
  if (!t) return desenharTarefas();
  desenharTarefa(t);
}

// lista de tarefas (urgentes primeiro). Escolher a tarefa é tocando; o resto do fluxo é por leitura.
function desenharTarefas() {
  $("#abPasso").textContent = "Tarefas";
  $("#abTopo").innerHTML = "";
  const ts = tarefasPendentes(db);
  $("#abRes").innerHTML = `<div class="es-lista">${ts.map((t) => {
    const p = produtoPorCodigo(db, t.produto), pk = enderecoPorId(db, t.pickingId);
    return `<button class="line mv-tarefa" data-tarefa="${t.id}"><span class="line-desc">${esc(p.descricao)}
      <small>${esc(p.codigo)} · ${pk.codigo}</small><small>${num(abastecidoDaTarefa(t))} de ${num(planejadoDaTarefa(t))} · ${t.origens.length} origem(ns)</small></span>
      <span class="mv-pills">${pilulaPrioridade(t)}${t.status === "andamento" ? pilulaStatus(t) : ""}</span></button>`;
  }).join("") || `<p class="empty">Nenhuma tarefa de abastecimento pendente.</p>`}</div>
  <button class="btn ghost block" data-solicitar>Solicitar abastecimento</button>`;
}

// solicitação manual: bipa o produto; com mais de um picking padrão, lê o QR do picking
function desenharSolicitar() {
  $("#abTopo").innerHTML = "";
  if (!ab.solProduto) {
    $("#abPasso").textContent = "Solicitar · bipe o produto";
    $("#abInput").placeholder = "Bipe o produto ou digite o código";
    $("#abRes").innerHTML = `<p class="muted rc-dica">A tarefa nasce como NORMAL, mesmo com o picking acima do mínimo. O gestor pode elevar para URGENTE.</p>`;
    return;
  }
  $("#abPasso").textContent = "Solicitar · bipe o picking";
  $("#abInput").placeholder = "Bipe o QR do picking ou digite o ID";
  $("#abRes").innerHTML = cartaoProduto(produtoPorCodigo(db, ab.solProduto)) + `<p class="es-h">Pickings deste produto</p>
    <div class="es-lista">${pickingsDoProduto(ab.solProduto).map((e) => `<div class="line">${tipoTag("picking")}<span class="line-addr">${e.codigo}</span><span class="line-desc"></span><span class="line-q">${num(saldoNoEndereco(db, e.id, ab.solProduto))}</span></div>`).join("")}</div>`;
}
const pickingsDoProduto = (codigo) => enderecosPadraoDoProduto(db, codigo).filter((e) => e && e.ativo && e.tipo === "picking")
  .sort((a, b) => compararEnderecos(a.codigo, b.codigo));

function solicitar(produto, pickingId) {
  const r = criarTarefa(produto, pickingId, { quem: "coletor", usuario: usuario() });
  if (!r.ok) return msg($("#abMsg"), r.msg, "err");
  db = lerEstoque();
  toast(`Tarefa criada · ${num(planejadoDaTarefa(r.tarefa))} un`);
  ab.solicitar = false; ab.solProduto = null;
  msg($("#abMsg"), "Tarefa de abastecimento criada", "ok");
  desenharAbastecimento();
}

// execução da tarefa, um passo de cada vez para a origem lida
function desenharTarefa(t) {
  const p = produtoPorCodigo(db, t.produto), pk = enderecoPorId(db, t.pickingId);
  $("#abTopo").innerHTML = `${cartaoProduto(p, `<p class="mv-pk">Destino: <b>${pk.codigo}</b> · ${num(abastecidoDaTarefa(t))} de ${num(planejadoDaTarefa(t))}</p>`)}`;
  const origens = `<p class="es-h">Origens no aéreo</p><div class="es-lista">${t.origens.map((o) => {
    const e = enderecoPorId(db, o.enderecoId), feito = o.feito >= o.qtd;
    return `<div class="line rc-item ${feito ? "ok" : ""} ${o.enderecoId === ab.origemId ? "current" : ""}">${tipoTag("aereo")}<span class="line-addr">${e.codigo}</span><span class="line-desc"></span><span class="line-q">${num(o.feito)}<small>/${num(o.qtd)}</small></span></div>`;
  }).join("")}</div>`;
  if (!ab.origemId) {
    $("#abPasso").textContent = "1 · Leia o QR da origem";
    $("#abInput").placeholder = "Bipe o QR do aéreo ou digite o ID";
    $("#abRes").innerHTML = origens;
    return;
  }
  const origem = t.origens.find((o) => o.enderecoId === ab.origemId);
  const resta = origem.qtd - origem.feito, saldo = saldoNoEndereco(db, ab.origemId, t.produto);
  const cabeca = `<div class="rc-nota">${linhaEndereco(enderecoPorId(db, ab.origemId), `<span class="rc-pend">Retirar: <b>${num(resta)}</b> · saldo ${num(saldo)}</span>`)}</div>`;
  if (!ab.produtoOk) {
    $("#abPasso").textContent = "2 · Bipe o produto";
    $("#abInput").placeholder = "Bipe o produto ou digite o código";
    $("#abRes").innerHTML = cabeca + origens;
    return;
  }
  if (!ab.qtd) {
    $("#abPasso").textContent = "3 · Quantidade retirada";
    $("#abRes").innerHTML = `${cabeca}
      <form id="abQtdForm" class="es-form">
        <label class="field"><span>Quantidade retirada (até ${num(Math.min(resta, saldo))})</span>
          <input name="qtd" type="number" inputmode="decimal" min="0" step="any" value="${Math.min(resta, saldo)}" required></label>
        <button class="btn primary">Continuar</button>
      </form>`;
    setTimeout(() => $("#abQtdForm")?.qtd.select(), 50);
    return;
  }
  if (!ab.destinoOk) {
    $("#abPasso").textContent = "4 · Leia o QR do picking";
    $("#abInput").placeholder = "Bipe o QR do picking ou digite o ID";
    $("#abRes").innerHTML = cabeca + `<div class="rc-nota rc-conferindo"><span>Levando para ${pk.codigo}</span><b>${num(ab.qtd)} un</b></div>`;
    setTimeout(() => $("#abInput").focus(), 50);
    return;
  }
  // tudo lido: resumo e o botão do documento
  $("#abPasso").textContent = "5 · Confirmar";
  $("#abRes").innerHTML = `<div class="mv-resumo">
      <div><span>Produto</span><b>${esc(p.codigo)}</b></div>
      <div><span>Origem</span><b>${enderecoPorId(db, ab.origemId).codigo}</b></div>
      <div><span>Destino</span><b>${pk.codigo}</b></div>
      <div><span>Quantidade</span><b>${num(ab.qtd)}</b></div>
    </div>
    <button class="btn primary block" data-confabast>Confirmar abastecimento</button>`;
}

$("#abForm").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const lido = $("#abInput").value.trim(); if (!lido) return;
  $("#abInput").value = "";
  if (ab.solicitar) {
    if (!ab.solProduto) {
      const achado = acharPorCodigoLido(db.produtos, db.embalagens, lido);
      if (!achado) return msg($("#abMsg"), "Produto não encontrado.", "err");
      const pks = pickingsDoProduto(achado.produto.codigo);
      if (!pks.length) return msg($("#abMsg"), "PRODUTO SEM PICKING PADRÃO. ASSOCIE EM ENDEREÇAR PRODUTO.", "err");
      if (pks.length === 1) return solicitar(achado.produto.codigo, pks[0].id);
      ab.solProduto = achado.produto.codigo; msg($("#abMsg"), "Produto identificado", "ok");
      return desenharAbastecimento();
    }
    const r = enderecoLido(lido); if (r.msg) return msg($("#abMsg"), r.msg, "err");
    if (!pickingsDoProduto(ab.solProduto).some((x) => x.id === r.e.id)) return msg($("#abMsg"), "ESTE ENDEREÇO NÃO É PICKING PADRÃO DO PRODUTO.", "err");
    return solicitar(ab.solProduto, r.e.id);
  }
  const t = tarefaPorId(db, ab.tarefaId);
  if (!ab.origemId) {
    const r = enderecoLido(lido); if (r.msg) return msg($("#abMsg"), r.msg, "err");
    const o = t.origens.find((x) => x.enderecoId === r.e.id);
    if (!o) return msg($("#abMsg"), MSG_ORIGEM_FORA_DA_TAREFA, "err");
    if (o.feito >= o.qtd) return msg($("#abMsg"), "ESTA ORIGEM JÁ FOI RETIRADA.", "err");
    ab.origemId = r.e.id; msg($("#abMsg"), "Origem validada", "ok");
    return desenharAbastecimento();
  }
  if (!ab.produtoOk) {
    const achado = acharPorCodigoLido(db.produtos, db.embalagens, lido);
    if (!achado) return msg($("#abMsg"), "Produto não encontrado.", "err");
    if (achado.produto.codigo !== t.produto) return msg($("#abMsg"), MSG_PRODUTO_DA_TAREFA, "err");
    ab.produtoOk = true; msg($("#abMsg"), "Produto validado", "ok");
    return desenharAbastecimento();
  }
  const r = enderecoLido(lido); if (r.msg) return msg($("#abMsg"), r.msg, "err");
  if (r.e.id !== t.pickingId) return msg($("#abMsg"), MSG_DESTINO_DA_TAREFA, "err");
  ab.destinoOk = true; msg($("#abMsg"), "Picking validado", "ok");
  desenharAbastecimento();
});

$("#abRes").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  db = lerEstoque();
  if (b.dataset.tarefa) { ab.tarefaId = +b.dataset.tarefa; limparPasso(); msg($("#abMsg"), ""); desenharAbastecimento(); return $("#abInput").focus(); }
  if (b.dataset.solicitar !== undefined) { ab.solicitar = true; msg($("#abMsg"), ""); desenharAbastecimento(); return $("#abInput").focus(); }
  if (b.dataset.confabast !== undefined) {
    const t = tarefaPorId(db, ab.tarefaId);
    const r = abastecer(t.id, { origemId: ab.origemId, produto: t.produto, qtd: ab.qtd, destinoId: t.pickingId, usuario: usuario() });
    if (!r.ok) return msg($("#abMsg"), r.msg, "err");
    db = lerEstoque();
    msg($("#abMsg"), `${num(ab.qtd)} abastecido(s) em ${enderecoPorId(db, t.pickingId).codigo}`, "ok");
    limparPasso();
    // todas as origens feitas: a tarefa conclui e volta para a lista; senão, segue para a próxima origem
    if (r.tarefa.status === "concluida") { toast("Abastecimento concluído"); ab.tarefaId = null; }
    desenharAbastecimento();
  }
});
$("#abRes").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const t = tarefaPorId(db, ab.tarefaId), o = t.origens.find((x) => x.enderecoId === ab.origemId);
  const qtd = Number(e.target.qtd.value);
  if (!(qtd > 0)) return msg($("#abMsg"), "Informe a quantidade (maior que zero).", "err");
  if (qtd > o.qtd - o.feito) return msg($("#abMsg"), MSG_ACIMA_DO_PLANEJADO, "err");
  if (qtd > saldoNoEndereco(db, ab.origemId, t.produto)) return msg($("#abMsg"), MSG_SALDO_ORIGEM, "err");
  ab.qtd = qtd; msg($("#abMsg"), "");
  desenharAbastecimento();
});

$("#abParcial").addEventListener("click", () => {
  db = lerEstoque();
  const t = tarefaPorId(db, ab.tarefaId);
  confirmar("Finalizar como parcial", "DESEJA FINALIZAR A TAREFA COMO PARCIAL?", `${num(abastecidoDaTarefa(t))} de ${num(planejadoDaTarefa(t))} abastecido(s). O restante não gera nova tarefa automática.`, () => {
    const r = finalizarParcial(t.id);
    if (!r.ok) return msg($("#abMsg"), r.msg, "err");
    toast("Tarefa finalizada como parcial"); db = lerEstoque(); iniciarAbastecimento();
  });
});
$("#abCancelar").addEventListener("click", () => {
  confirmar("Cancelar tarefa", "DESEJA REALMENTE CANCELAR ESTA TAREFA?", "O que já foi abastecido continua no picking.", () => {
    const r = cancelarTarefa(ab.tarefaId);
    if (!r.ok) return msg($("#abMsg"), r.msg, "err");
    toast("Tarefa cancelada"); db = lerEstoque(); iniciarAbastecimento();
  });
});

// =====================================================================
// TRANSFERÊNCIA: QR da origem → produto → quantidade → QR do destino → resumo → CONFIRMAR TRANSFERÊNCIA
// O destino é livre: não sugere endereço padrão.
// =====================================================================
const tr = { origemId: null, produto: null, qtd: null, destinoId: null };

function iniciarTransferencia() {
  Object.assign(tr, { origemId: null, produto: null, qtd: null, destinoId: null });
  msg($("#trMsg"), ""); $("#trInput").value = "";
  desenharTransferencia();
}
function voltarTransferencia() {
  msg($("#trMsg"), "");
  if (tr.destinoId) tr.destinoId = null;
  else if (tr.qtd) tr.qtd = null;
  else if (tr.produto) tr.produto = null;
  else tr.origemId = null;
  desenharTransferencia();
}

function desenharTransferencia() {
  $("#trForm").hidden = !!(tr.produto && !tr.qtd) || !!tr.destinoId;
  const origem = tr.origemId ? enderecoPorId(db, tr.origemId) : null;
  if (!origem) {
    $("#trPasso").textContent = "1 · Leia o QR da origem";
    $("#trInput").placeholder = "Bipe o QR do endereço ou digite o ID";
    $("#trTopo").innerHTML = "";
    $("#trRes").innerHTML = `<p class="muted rc-dica">Vale entre picking e aéreo nos dois sentidos, e também para tirar saldo da doca.</p>`;
    return;
  }
  const saldo = tr.produto ? saldoTransferivel(db, origem.id, tr.produto) : 0;
  $("#trTopo").innerHTML = `<div class="rc-nota">${linhaEndereco(origem, tr.produto ? `<span class="rc-pend">Saldo: <b>${num(saldo)}</b></span>` : "")}</div>`
    + (tr.produto ? cartaoProduto(produtoPorCodigo(db, tr.produto)) : "");
  if (!tr.produto) {
    $("#trPasso").textContent = "2 · Bipe o produto";
    $("#trInput").placeholder = "Bipe o produto ou digite o código";
    const aqui = db.saldos.filter((s) => s.enderecoId === origem.id && s.qtd > 0);
    $("#trRes").innerHTML = `<p class="es-h">Produtos neste endereço${origem.tipo === "doca" ? " · disponível para transferir" : ""}</p><div class="es-lista">${aqui.map((s) => {
      const p = produtoPorCodigo(db, s.produto);
      return `<div class="line"><span class="line-desc">${esc(p.descricao)}<small>${esc(p.codigo)}</small></span><span class="line-q">${num(saldoTransferivel(db, origem.id, s.produto))}</span></div>`;
    }).join("") || `<p class="empty">Endereço vazio.</p>`}</div>`;
    return;
  }
  if (!tr.qtd) {
    $("#trPasso").textContent = "3 · Quantidade";
    $("#trRes").innerHTML = `<form id="trQtdForm" class="es-form">
        <label class="field"><span>Quantidade a transferir (saldo ${num(saldo)})</span>
          <input name="qtd" type="number" inputmode="decimal" min="0" step="any" required></label>
        <button class="btn primary">Continuar</button>
      </form>`;
    setTimeout(() => $("#trQtdForm")?.qtd.focus(), 50);
    return;
  }
  if (!tr.destinoId) {
    $("#trPasso").textContent = "4 · Leia o QR do destino";
    $("#trInput").placeholder = "Bipe o QR do destino ou digite o ID";
    $("#trRes").innerHTML = `<div class="rc-nota rc-conferindo"><span>Transferindo</span><b>${num(tr.qtd)} un</b></div>`;
    setTimeout(() => $("#trInput").focus(), 50);
    return;
  }
  // resumo antes de efetivar (pedido do documento)
  const destino = enderecoPorId(db, tr.destinoId);
  $("#trPasso").textContent = "5 · Confirmar";
  $("#trRes").innerHTML = `<div class="mv-resumo">
      <div><span>Produto</span><b>${esc(tr.produto)}</b></div>
      <div><span>Origem</span><b>${origem.codigo}</b></div>
      <div><span>Destino</span><b>${destino.codigo}</b></div>
      <div><span>Quantidade</span><b>${num(tr.qtd)}</b></div>
      <div><span>Fica na origem</span><b>${num(saldo - tr.qtd)}</b></div>
    </div>
    <button class="btn primary block" data-conftransf>Confirmar transferência</button>`;
}

$("#trForm").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const lido = $("#trInput").value.trim(); if (!lido) return;
  $("#trInput").value = "";
  if (!tr.origemId) {
    const r = enderecoLido(lido); if (r.msg) return msg($("#trMsg"), r.msg, "err");
    tr.origemId = r.e.id; msg($("#trMsg"), "Origem validada", "ok");
    return desenharTransferencia();
  }
  if (!tr.produto) {
    const achado = acharPorCodigoLido(db.produtos, db.embalagens, lido);
    if (!achado) return msg($("#trMsg"), "Produto não encontrado.", "err");
    if (saldoTransferivel(db, tr.origemId, achado.produto.codigo) <= 0) {
      // na doca, o saldo que espera armazenamento não sai por transferência
      const naDoca = saldoNoEndereco(db, tr.origemId, achado.produto.codigo) > 0;
      return msg($("#trMsg"), naDoca ? "ESTE SALDO DA DOCA AGUARDA ARMAZENAMENTO. USE RECEPÇÃO › ARMAZENAMENTO." : MSG_SEM_SALDO_NA_ORIGEM, "err");
    }
    tr.produto = achado.produto.codigo; msg($("#trMsg"), "Produto identificado", "ok");
    return desenharTransferencia();
  }
  const r = enderecoLido(lido); if (r.msg) return msg($("#trMsg"), r.msg, "err");
  const erro = validarTransferencia({ origem: enderecoPorId(db, tr.origemId), destino: r.e, saldoOrigem: saldoTransferivel(db, tr.origemId, tr.produto), qtd: tr.qtd });
  if (erro) return msg($("#trMsg"), erro, "err");
  tr.destinoId = r.e.id; msg($("#trMsg"), "Destino validado", "ok");
  desenharTransferencia();
});

$("#trRes").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const pedida = Number(e.target.qtd.value);
  if (!(pedida > 0)) return msg($("#trMsg"), "Informe a quantidade (maior que zero).", "err");
  const saldo = saldoTransferivel(db, tr.origemId, tr.produto);
  tr.qtd = quantidadePermitida(pedida, saldo);
  // pediu mais do que tem: transfere só o saldo disponível (avisando)
  if (tr.qtd < pedida) msg($("#trMsg"), `SÓ HÁ ${num(saldo)} NA ORIGEM. A QUANTIDADE FOI AJUSTADA PARA ${num(saldo)}.`, "warn");
  else msg($("#trMsg"), "");
  desenharTransferencia();
});
$("#trRes").addEventListener("click", (e) => {
  if (!e.target.closest("[data-conftransf]")) return;
  const r = transferir({ ...tr, usuario: usuario() });
  if (!r.ok) return msg($("#trMsg"), r.msg, "err");
  db = lerEstoque();
  toast(`${num(tr.qtd)} transferido(s) para ${enderecoPorId(db, tr.destinoId).codigo}`);
  iniciarTransferencia();
  msg($("#trMsg"), "Transferência confirmada. Leia a próxima origem.", "ok");
  $("#trInput").focus();
});
