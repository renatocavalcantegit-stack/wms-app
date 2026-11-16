// WMS Beach Bike — app do coletor do Estoquista: Cadastro (consulta de produto, embalagem e endereçar produto).
// Recepção, Movimentação e Auditoria entram nas próximas etapas.
// As regras ficam em compartilhado/regras/ e os dados passam por js/dados/estoque.js.
import { session, logout, PERFIS } from "./js/sessao.js";
import { $, $$, esc } from "./js/util.js";
import { show, openSheet, closeSheets, toast, beep, vibrate, openCam } from "./js/ui-coletor.js";
import { etiquetaHtml } from "./js/etiqueta-produto.js";
import {
  lerEstoque, aoMudarEstoque, reiniciarDemonstracao, saldosDoProduto, embalagensDoProduto, produtosDoEndereco,
  salvarEmbalagem, excluirEmbalagem, associarProduto, removerAssociacao,
} from "./js/dados/estoque.js";
import { acharPorCodigoLido, buscarProdutos, validarEmbalagem, MSG_EXCLUIR_EMBALAGEM } from "./compartilhado/regras/embalagens.js";
import {
  acharEndereco, compararEnderecos, podeAssociar, TIPOS_ENDERECO,
  MSG_REMOVER_ASSOCIACAO, MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO,
} from "./compartilhado/regras/enderecos.js";

const sess = session();
let db = lerEstoque();
const num = (n) => Number(n).toLocaleString("pt-BR");
const tipoTag = (t) => `<span class="es-tipo ${t}">${TIPOS_ENDERECO[t]}</span>`;

// mensagem embaixo do campo de leitura (verde = deu certo, vermelho = bloqueado)
function msg(el, texto, tipo = "") {
  el.textContent = texto; el.className = "scan-msg " + tipo;
  if (tipo === "err") { beep(false); vibrate([80, 50, 80]); el.previousElementSibling?.classList.add("err"); setTimeout(() => el.previousElementSibling?.classList.remove("err"), 400); }
  if (tipo === "ok") beep(true);
}

// confirmação com a mensagem do documento ("DESEJA REALMENTE…?")
let aoConfirmar = null;
function confirmar(titulo, mensagem, sub, fn) {
  $("#scfTitulo").textContent = titulo; $("#scfMsg").textContent = mensagem; $("#scfSub").innerHTML = sub;
  aoConfirmar = fn; openSheet("sheetConfirma");
}
$("#scfSim").addEventListener("click", () => { closeSheets(); aoConfirmar?.(); });
document.addEventListener("click", (e) => { if (e.target.closest("[data-fecharsheet]")) closeSheets(); });

// cartão do produto (usado nas três telas)
const cartaoProduto = (p, extra = "") => `<div class="product es-prod">
  <div class="product-info"><p class="product-desc">${esc(p.descricao)}</p><p class="product-meta">${esc(p.codigo)} · ${esc(p.un)}</p>${extra}</div></div>`;

// lista para escolher quando a descrição digitada casa com vários produtos
const escolherProduto = (lista, attr) => `<p class="es-h">${lista.length} produtos encontrados</p><div class="es-lista">${lista.slice(0, 30).map((p) =>
  `<button class="line" ${attr}="${esc(p.codigo)}"><span class="line-desc">${esc(p.descricao)}<small>${esc(p.codigo)}</small></span></button>`).join("")}</div>`;

// =====================================================================
// MENU
// =====================================================================
function home() {
  $("#helloName").textContent = sess.nome;
  const dt = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  $("#helloDate").textContent = dt.charAt(0).toUpperCase() + dt.slice(1);
  show("viewEstHome");
}
$$(".es-op").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.soon) return toast(`Em breve: ${b.dataset.soon}`);
  abrir(b.dataset.ir);
}));
$$("[data-voltar]").forEach((b) => b.addEventListener("click", () => { closeSheets(); home(); }));

function abrir(tela) {
  db = lerEstoque();
  if (tela === "viewConsulta") { $("#cInput").value = ""; $("#cRes").innerHTML = ""; msg($("#cMsg"), ""); }
  if (tela === "viewEmbalagem") { produtoEmb = null; $("#eInput").value = ""; $("#eRes").innerHTML = ""; msg($("#eMsg"), ""); }
  if (tela === "viewEnderecar") iniciarEnderecar();
  show(tela);
  setTimeout(() => $(`#${tela} input`)?.focus(), 50);
}

// câmera do celular (quando o aparelho tem): o código lido entra no campo e é enviado
$$("[data-cam]").forEach((b) => b.addEventListener("click", () => openCam((codigo) => {
  const inp = $("#" + b.dataset.cam); inp.value = codigo; inp.form.requestSubmit();
})));

// =====================================================================
// CONSULTA DE PRODUTO (só visualização; não altera nada)
// =====================================================================
let produtoConsulta = null;
$("#cForm").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const lido = $("#cInput").value.trim(); if (!lido) return;
  const achado = acharPorCodigoLido(db.produtos, db.embalagens, lido);
  if (achado) return mostrarConsulta(achado.produto.codigo);
  const lista = buscarProdutos(db.produtos, lido);
  if (lista.length === 1) return mostrarConsulta(lista[0].codigo);
  if (!lista.length) { $("#cRes").innerHTML = ""; return msg($("#cMsg"), "Produto não encontrado.", "err"); }
  msg($("#cMsg"), ""); $("#cRes").innerHTML = escolherProduto(lista, "data-consulta");
});
$("#cRes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-consulta]"); if (b) return mostrarConsulta(b.dataset.consulta);
  if (e.target.closest("#cEtiqueta")) abrirEtiqueta();
});

function mostrarConsulta(codigo) {
  db = lerEstoque();
  produtoConsulta = db.produtos.find((p) => p.codigo === codigo);
  // só endereços com saldo maior que zero, com o tipo (Picking/Aéreo) e o saldo de cada um
  const saldos = saldosDoProduto(db, codigo).filter((s) => s.endereco).sort((a, b) => compararEnderecos(a.endereco.codigo, b.endereco.codigo));
  const total = saldos.reduce((t, s) => t + s.qtd, 0);
  msg($("#cMsg"), "Produto encontrado", "ok");
  $("#cInput").value = ""; $("#cInput").focus();
  $("#cRes").innerHTML = `
    ${cartaoProduto(produtoConsulta)}
    <p class="es-h">Endereços com saldo</p>
    <div class="es-lista">${saldos.map((s) => `<div class="line">${tipoTag(s.endereco.tipo)}<span class="line-addr">${s.endereco.codigo}</span><span class="line-desc"></span><span class="line-q">${num(s.qtd)}</span></div>`).join("")
      || `<p class="empty">Sem saldo em nenhum endereço.</p>`}</div>
    <div class="es-total"><span>Saldo total</span><b>${num(total)}</b></div>
    <button id="cEtiqueta" class="btn ghost block">Gerar etiqueta</button>`;
}

// ---------- etiqueta 90 × 20 ----------
let codigoEtiqueta = null;
function abrirEtiqueta() {
  const embs = embalagensDoProduto(db, produtoConsulta.codigo);
  // cada embalagem vira uma opção; sem código de barras (ou sem embalagem), a etiqueta usa o código interno
  const opcoes = embs.length ? embs.map((e) => ({ rotulo: `${e.descricao} · ${num(e.qtd)}`, codigo: e.codigo || null }))
    : [{ rotulo: "Código interno", codigo: null }];
  codigoEtiqueta = opcoes[0].codigo;
  $("#etEmbs").innerHTML = opcoes.length > 1 ? opcoes.map((o, i) =>
    `<button class="chip ${i ? "" : "active"}" data-cod="${esc(o.codigo || "")}">${esc(o.rotulo)}</button>`).join("") : "";
  $("#etQtd").value = 1;
  previaEtiqueta(); openSheet("sheetEtiqueta");
}
const previaEtiqueta = () => ($("#etPrevia").innerHTML = etiquetaHtml(produtoConsulta, codigoEtiqueta));
$("#etEmbs").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  $$("#etEmbs .chip").forEach((c) => c.classList.toggle("active", c === b));
  codigoEtiqueta = b.dataset.cod || null; previaEtiqueta();
});
$("#etGo").addEventListener("click", () => {
  const n = Math.max(1, Math.min(500, Math.floor(+$("#etQtd").value || 1)));
  $("#printArea").innerHTML = etiquetaHtml(produtoConsulta, codigoEtiqueta).repeat(n);
  closeSheets(); window.print();
});

// =====================================================================
// CADASTRO DE EMBALAGEM
// =====================================================================
let produtoEmb = null, embEditando = null;
$("#eForm").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const lido = $("#eInput").value.trim(); if (!lido) return;
  const achado = acharPorCodigoLido(db.produtos, db.embalagens, lido);
  const lista = achado ? [achado.produto] : buscarProdutos(db.produtos, lido);
  if (lista.length === 1) return mostrarEmbalagens(lista[0].codigo);
  if (!lista.length) { $("#eRes").innerHTML = ""; return msg($("#eMsg"), "Produto não encontrado.", "err"); }
  msg($("#eMsg"), ""); $("#eRes").innerHTML = escolherProduto(lista, "data-embprod");
});

function mostrarEmbalagens(codigo) {
  db = lerEstoque();
  produtoEmb = codigo;
  const p = db.produtos.find((x) => x.codigo === codigo);
  const embs = embalagensDoProduto(db, codigo);
  msg($("#eMsg"), ""); $("#eInput").value = "";
  $("#eRes").innerHTML = `
    ${cartaoProduto(p)}
    <p class="es-h">Embalagens</p>
    <div class="es-lista">${embs.map((e) => `<div class="line">
      <span class="line-desc">${esc(e.descricao)} <b class="es-qtd">× ${num(e.qtd)}</b><small>${e.codigo ? esc(e.codigo) : "sem código de barras"}</small></span>
      <button class="es-mini" data-editemb="${e.id}">Editar</button><button class="es-mini red" data-delemb="${e.id}">Excluir</button>
    </div>`).join("") || `<p class="empty">Nenhuma embalagem cadastrada.</p>`}</div>
    <button class="btn primary block" data-novaemb>Adicionar embalagem</button>`;
}

$("#eRes").addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.embprod) return mostrarEmbalagens(t.dataset.embprod);
  if (t.dataset.novaemb !== undefined) return abrirFormEmb(null);
  if (t.dataset.editemb) return abrirFormEmb(+t.dataset.editemb);
  if (t.dataset.delemb) {
    const emb = db.embalagens.find((x) => x.id === +t.dataset.delemb);
    return confirmar("Excluir embalagem", MSG_EXCLUIR_EMBALAGEM, `${esc(emb.descricao)} · ${emb.codigo ? esc(emb.codigo) : "sem código"}`, () => {
      excluirEmbalagem(emb.id); toast("Embalagem excluída"); mostrarEmbalagens(produtoEmb);
    });
  }
});

function abrirFormEmb(id) {
  embEditando = id;
  const e = id ? db.embalagens.find((x) => x.id === id) : { codigo: "", descricao: "", qtd: "" };
  const f = $("#sbForm");
  $("#sbTitulo").textContent = id ? "Editar embalagem" : "Adicionar embalagem";
  f.codigo.value = e.codigo; f.descricao.value = e.descricao; f.qtd.value = e.qtd === "" ? "" : String(e.qtd).replace(".", ",");
  $("#sbErr").textContent = "";
  openSheet("sheetEmb"); setTimeout(() => f.codigo.focus(), 50);
}
// o leitor "digita" o código e manda Enter: no campo de código, o Enter só pula para a descrição
$("#sbForm").codigo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#sbForm").descricao.focus(); } });
// código repetido é avisado na hora (validação em tempo real) e de novo ao salvar
$("#sbForm").addEventListener("input", () => {
  const f = $("#sbForm");
  const r = validarEmbalagem({ codigo: f.codigo.value, descricao: "x", qtd: 1 }, lerEstoque().embalagens, embEditando);
  $("#sbErr").textContent = r.ok ? "" : r.msg;
});
$("#sbForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const r = salvarEmbalagem(produtoEmb, Object.fromEntries(new FormData(e.target)), embEditando);
  if (!r.ok) { $("#sbErr").textContent = r.msg; beep(false); return; }
  beep(true); closeSheets(); toast("Embalagem salva"); mostrarEmbalagens(produtoEmb);
});

// =====================================================================
// ENDEREÇAR PRODUTO: 1) lê o endereço  2) lê o produto  3) CONFIRMAR
// =====================================================================
let endSel = null, prodSel = null;
function iniciarEnderecar() {
  endSel = null; prodSel = null;
  $("#aPasso").textContent = "1 · Leia o QR do endereço";
  $("#aInput").placeholder = "QR do endereço ou código (R3001-P1-A100-AP101)";
  $("#aInput").value = ""; $("#aEnd").innerHTML = ""; $("#aRes").innerHTML = ""; msg($("#aMsg"), "");
  $("#aFoot").hidden = true;
}

function desenharEndereco() {
  db = lerEstoque();
  const e = endSel;
  const produtos = produtosDoEndereco(db, e.id).filter(Boolean);
  $("#aEnd").innerHTML = `<div class="addr es-addr">
    <span class="addr-label">${TIPOS_ENDERECO[e.tipo]} · ID ${e.id}</span>
    <div class="addr-parts">${[["Rua", e.rua], ["Prédio", e.predio], ["Andar", e.andar], ["Apto", e.apto]]
      .map(([l, v]) => `<div class="addr-part${String(v).length > 3 ? " long" : ""}"><b>${v}</b><small>${l}</small></div>`).join("")}</div>
  </div>`;
  $("#aRes").innerHTML = (prodSel ? cartaoProduto(prodSel, `<p class="es-pronto">Pronto para associar · toque em CONFIRMAR</p>`) : "")
    + `<p class="es-h">Produtos já associados a este endereço</p>
    <div class="es-lista">${produtos.map((p) => `<div class="line"><span class="line-desc">${esc(p.descricao)}<small>${esc(p.codigo)}</small></span>
      <button class="es-mini red" data-remover="${esc(p.codigo)}">Remover</button></div>`).join("") || `<p class="empty">Nenhum ainda.</p>`}</div>`;
  $("#aConfirmar").disabled = !prodSel;
}

$("#aForm").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const lido = $("#aInput").value.trim(); if (!lido) return;
  $("#aInput").value = "";
  if (!endSel) {
    // passo 1: endereço — tem que existir e estar ativo (QR de endereço desativado fica bloqueado)
    const end = acharEndereco(db.enderecos, lido);
    if (!end) return msg($("#aMsg"), MSG_ENDERECO_NAO_ENCONTRADO, "err");
    if (!end.ativo) return msg($("#aMsg"), MSG_ENDERECO_INATIVO, "err");
    endSel = end;
    msg($("#aMsg"), "Endereço validado", "ok");
    $("#aPasso").textContent = "2 · Leia o código de barras do produto";
    $("#aInput").placeholder = "Bipe o produto (ou digite o código interno)";
    $("#aFoot").hidden = false;
    return desenharEndereco();
  }
  // passo 2: produto (sem quantidade: só diz que ele mora neste endereço)
  const achado = acharPorCodigoLido(db.produtos, db.embalagens, lido);
  if (!achado) return msg($("#aMsg"), "Produto não encontrado.", "err");
  const r = podeAssociar(db.associacoes, achado.produto.codigo, endSel);
  if (!r.ok) { prodSel = null; desenharEndereco(); return msg($("#aMsg"), r.msg, "err"); }
  prodSel = achado.produto;
  msg($("#aMsg"), "Produto identificado", "ok");
  desenharEndereco();
});

$("#aConfirmar").addEventListener("click", () => {
  const r = associarProduto(prodSel.codigo, endSel.id);
  if (!r.ok) return msg($("#aMsg"), r.msg, "err");
  msg($("#aMsg"), `${prodSel.codigo} associado a ${endSel.codigo}`, "ok");
  prodSel = null; desenharEndereco();
  $("#aInput").focus();
});
$("#aTrocar").addEventListener("click", () => { iniciarEnderecar(); $("#aInput").focus(); });
$("#aRes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remover]"); if (!b) return;
  confirmar("Remover associação", MSG_REMOVER_ASSOCIACAO, `${esc(b.dataset.remover)} · ${endSel.codigo}`, () => {
    removerAssociacao(b.dataset.remover, endSel.id); toast("Associação removida"); desenharEndereco();
  });
});

// =====================================================================
// perfil e tempo real
// =====================================================================
$("#btnMenu").addEventListener("click", () => {
  $("#menuName").textContent = sess.nome; $("#menuPerfil").textContent = PERFIS[sess.perfil];
  openSheet("sheetMenu");
});
$("#menuLogout").addEventListener("click", () => { logout(); location.replace("./"); });
$("#menuReset").addEventListener("click", () => { reiniciarDemonstracao(); closeSheets(); toast("Demonstração reiniciada"); home(); });

// se o gestor mudar algo no WEB (ex.: excluir embalagem), a tela aberta se atualiza
aoMudarEstoque(() => {
  db = lerEstoque();
  if (!$("#viewEmbalagem").hidden && produtoEmb) mostrarEmbalagens(produtoEmb);
  if (!$("#viewEnderecar").hidden && endSel) desenharEndereco();
});

home();
