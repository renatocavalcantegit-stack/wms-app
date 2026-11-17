// WMS Beach Bike — coletor do Estoquista, menu AUDITORIA: inventário físico.
// Fluxo: inventário → (completo: rua) → QR do endereço → bipa o produto → quantidade → INCLUIR … → FINALIZAR CONTAGEM.
// A contagem é cega: o operador não vê o saldo do sistema nem as contagens anteriores.
// Endereço e produto entram só por leitura (bipar ou digitar), nunca tocando numa lista.
// As regras ficam em compartilhado/regras/inventario.js e os dados passam por js/dados/inventario.js.
import { $, $$, esc } from "./js/util.js";
import { session } from "./js/sessao.js";
import { closeSheets, toast } from "./js/ui-coletor.js";
import { num, tipoTag, msg, confirmar, cartaoProduto } from "./js/ui-estoque.js";
import { lerEstoque, enderecoPorId, produtoPorCodigo } from "./js/dados/estoque.js";
import {
  inventarioPorId, inventariosAbertos, itensDoEndereco, incluidosNoEndereco, situacaoDoEndereco, validarEnderecoDaContagem,
  incluir, removerIncluido, finalizarContagem,
} from "./js/dados/inventario.js";
import { acharEndereco, MSG_ENDERECO_NAO_ENCONTRADO } from "./compartilhado/regras/enderecos.js";
import { acharPorCodigoLido } from "./compartilhado/regras/embalagens.js";
import {
  TIPOS_INVENTARIO, contagemDoEndereco, itemEncerrado, validarProdutoNaContagem, validarQuantidadeContada, MSG_ENDERECO_FORA_DA_RUA,
} from "./compartilhado/regras/inventario.js";

let db = lerEstoque();
const usuario = () => session()?.login || "";
// estado da tela: inventário escolhido, rua (completo), endereço lido e produto bipado esperando a quantidade
const iv = { invId: null, rua: null, enderecoId: null, produto: null };
const inv = () => (iv.invId ? inventarioPorId(db, iv.invId) : null);
const SIT = { pendente: ["Pendente", "g"], recontagem: ["Recontagem", "y"], concluido: ["Concluído", "v"] };
const pilulaSit = (s) => `<span class="rc-st ${SIT[s][1]}">${SIT[s][0]}</span>`;
// endereços do inventário que ainda pedem contagem (na rua escolhida, no completo)
const aContar = (i) => i.enderecos.map((id) => enderecoPorId(db, id))
  .filter((e) => (i.tipo === "rotativo" || e.rua === iv.rua) && situacaoDoEndereco(i, e.id) !== "concluido")
  .sort((a, b) => a.codigo.localeCompare(b.codigo));

// número no menu: inventários em aberto
export function resumoInventario() {
  db = lerEstoque();
  const n = inventariosAbertos(db).length;
  $("#mnInv").textContent = n ? `${n} inventário(s) em aberto` : "Nenhum inventário em aberto";
}

export function abrirInventario() {
  db = lerEstoque();
  Object.assign(iv, { invId: null, rua: null, enderecoId: null, produto: null });
  msg($("#ivMsg"), ""); $("#ivInput").value = "";
  desenhar();
}

// o gestor finalizou no WEB (ou outro coletor contou): a tela se redesenha
export function atualizarInventario() {
  db = lerEstoque();
  if (!$("#viewInv").hidden) desenhar();
}

// voltar um passo: produto → endereço → rua → lista de inventários → menu
$$("[data-ivvoltar]").forEach((b) => b.addEventListener("click", () => {
  closeSheets(); msg($("#ivMsg"), "");
  if (iv.produto) iv.produto = null;
  else if (iv.enderecoId) iv.enderecoId = null; // as quantidades incluídas ficam salvas
  else if (iv.rua) iv.rua = null;
  else if (iv.invId) iv.invId = null;
  else return document.dispatchEvent(new Event("voltar-menu"));
  desenhar();
}));

function desenhar() {
  const i = inv();
  // finalizado no WEB enquanto a tela estava aberta: novas contagens bloqueadas na hora
  if (iv.invId && (!i || i.status !== "aberto")) {
    Object.assign(iv, { invId: null, rua: null, enderecoId: null, produto: null });
    msg($("#ivMsg"), "INVENTÁRIO FINALIZADO PELO GESTOR. NÃO RECEBE NOVAS CONTAGENS.", "err");
  }
  const contando = !!(iv.invId && iv.enderecoId);
  $("#ivFoot").hidden = !contando;
  $("#ivForm").hidden = !iv.invId || (!iv.rua && inv()?.tipo === "completo") || !!iv.produto;
  if (!iv.invId) return desenharLista();
  if (inv().tipo === "completo" && !iv.rua) return desenharRuas();
  if (!iv.enderecoId) return desenharLerEndereco();
  desenharContagem();
}

// 1 · inventários em aberto (escolher é tocando; daqui em diante, só leitura)
function desenharLista() {
  $("#ivPasso").textContent = "Inventários em aberto";
  $("#ivTopo").innerHTML = "";
  const lista = inventariosAbertos(db);
  $("#ivRes").innerHTML = `<div class="es-lista">${lista.map((i) => {
    const pend = i.enderecos.filter((id) => situacaoDoEndereco(i, id) !== "concluido").length;
    return `<button class="line" data-inv="${i.id}"><span class="line-desc">${esc(i.descricao)}
      <small>INV ${i.id} · ${TIPOS_INVENTARIO[i.tipo]}${i.tipo === "completo" ? ` · rua ${i.ruas.join(", ")}` : ""}</small>
      <small>${num(pend)} de ${num(i.enderecos.length)} endereço(s) a contar</small></span>
      <span class="rc-st ${i.tipo === "completo" ? "b" : "g"}">${TIPOS_INVENTARIO[i.tipo]}</span></button>`;
  }).join("") || `<p class="empty">Nenhum inventário em aberto. O gestor cria no WEB.</p>`}</div>`;
}

// 2 · completo: escolher a rua
function desenharRuas() {
  const i = inv();
  $("#ivPasso").textContent = "Escolha a rua";
  $("#ivTopo").innerHTML = cabecalho(i);
  $("#ivRes").innerHTML = `<div class="es-lista">${i.ruas.map((rua) => {
    const ends = i.enderecos.filter((id) => enderecoPorId(db, id).rua === rua);
    const pend = ends.filter((id) => situacaoDoEndereco(i, id) !== "concluido").length;
    return `<button class="line" data-rua="${rua}"><span class="line-desc">Rua ${rua}<small>${num(pend)} de ${num(ends.length)} endereço(s) a contar</small></span>
      <span class="rc-st ${pend ? "y" : "v"}">${pend ? "A contar" : "Concluída"}</span></button>`;
  }).join("")}</div>`;
}
const cabecalho = (i) => `<div class="rc-nota"><div><b>INV ${i.id} · ${TIPOS_INVENTARIO[i.tipo]}</b><span>${esc(i.descricao)}</span></div></div>`;

// 3 · ler o QR do endereço. A lista é só informativa (no rotativo mostra o produto previsto de cada um).
function desenharLerEndereco() {
  const i = inv(), lista = aContar(i);
  $("#ivPasso").textContent = "Leia o QR do endereço";
  $("#ivInput").placeholder = "Bipe o QR do endereço ou digite o ID";
  $("#ivTopo").innerHTML = cabecalho(i);
  $("#ivRes").innerHTML = `<p class="es-h">${i.tipo === "rotativo" ? "Próximos endereços" : `Rua ${iv.rua} · a contar`} (${num(lista.length)})</p>
    <div class="es-lista">${lista.slice(0, 40).map((e) => {
      const previsto = i.tipo === "rotativo" ? itensDoEndereco(i, e.id).filter((x) => !itemEncerrado(x.contagens)).map((x) => esc(produtoPorCodigo(db, x.produto).descricao)).join(", ") : "";
      const salvos = incluidosNoEndereco(i, e.id).length;
      return `<div class="line">${tipoTag(e.tipo)}<span class="line-desc"><span class="line-addr">${e.codigo}</span>${previsto ? `<small>${previsto}</small>` : ""}${salvos ? `<small>${salvos} inclusão(ões) salvas</small>` : ""}</span>${pilulaSit(situacaoDoEndereco(i, e.id))}</div>`;
    }).join("") || `<p class="empty">Todos os endereços ${i.tipo === "completo" ? "desta rua " : ""}foram contados.</p>`}</div>`;
  setTimeout(() => $("#ivInput").focus(), 50);
}

// 4 · contagem do endereço: bipa o produto → quantidade → INCLUIR. Vários produtos no mesmo endereço.
function desenharContagem() {
  const i = inv(), e = enderecoPorId(db, iv.enderecoId), itens = itensDoEndereco(i, e.id);
  const n = contagemDoEndereco(itens) || 1;
  $("#ivPasso").textContent = `Contagem ${n} · ${iv.produto ? "quantidade" : "bipe o produto"}`;
  $("#ivInput").placeholder = "Bipe o produto ou digite o código";
  // rotativo: o sistema informa tipo, rua, endereço e o produto previsto
  const previstos = i.tipo === "rotativo" ? itensDoEndereco(i, e.id).filter((x) => !itemEncerrado(x.contagens)) : [];
  $("#ivTopo").innerHTML = `<div class="rc-nota"><div class="rc-doca">${tipoTag(e.tipo)}<span class="line-addr">${e.codigo}</span></div>
    <span>Rua ${e.rua} · Contagem ${n}</span>
    ${previstos.map((x) => `<small>Produto previsto: <b class="iv-prev">${esc(x.produto)}</b> ${esc(produtoPorCodigo(db, x.produto).descricao)}</small>`).join("")}</div>`;
  const incluidos = incluidosNoEndereco(i, e.id);
  const lista = `<p class="es-h">Incluídos neste endereço (${incluidos.length})</p>
    <div class="es-lista">${incluidos.map((x, k) => `<div class="line"><span class="line-desc">${esc(produtoPorCodigo(db, x.produto).descricao)}<small>${esc(x.produto)} · ${esc(x.operador)}</small></span>
      <span class="line-q">${num(x.qtd)}</span><button class="iv-tirar" data-tirar="${k}" aria-label="Remover">×</button></div>`).join("")
      || `<p class="empty">Nada incluído ainda. Produto previsto que não for bipado conta ZERO ao finalizar.</p>`}</div>`;
  if (!iv.produto) { $("#ivRes").innerHTML = lista; setTimeout(() => $("#ivInput").focus(), 50); return; }
  $("#ivRes").innerHTML = cartaoProduto(produtoPorCodigo(db, iv.produto)) + `
    <form id="ivQtdForm" class="es-form">
      <label class="field"><span>Quantidade contada</span><input name="qtd" type="number" inputmode="decimal" min="0" step="any" required></label>
      <button class="btn primary">Incluir</button>
    </form>` + lista;
  setTimeout(() => $("#ivQtdForm")?.qtd.focus(), 50);
}

// leituras (endereço ou produto)
$("#ivForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  db = lerEstoque();
  const lido = $("#ivInput").value.trim(); if (!lido) return;
  $("#ivInput").value = "";
  const i = inv();
  if (!iv.enderecoId) {
    const e = acharEndereco(db.enderecos, lido);
    if (!e) return msg($("#ivMsg"), MSG_ENDERECO_NAO_ENCONTRADO, "err");
    const erro = validarEnderecoDaContagem(i, e.id);
    if (erro) return msg($("#ivMsg"), erro, "err");
    if (i.tipo === "completo" && e.rua !== iv.rua) return msg($("#ivMsg"), MSG_ENDERECO_FORA_DA_RUA, "err");
    iv.enderecoId = e.id; msg($("#ivMsg"), "Endereço confirmado", "ok");
    return desenhar();
  }
  const achado = acharPorCodigoLido(db.produtos, db.embalagens, lido);
  if (!achado) return msg($("#ivMsg"), "Produto não encontrado.", "err");
  const erro = validarProdutoNaContagem(i, itensDoEndereco(i, iv.enderecoId), achado.produto.codigo);
  if (erro) return msg($("#ivMsg"), erro, "err");
  iv.produto = achado.produto.codigo; msg($("#ivMsg"), "Produto identificado", "ok");
  desenhar();
});

// INCLUIR a quantidade
$("#ivRes").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const qtd = ev.target.qtd.value;
  const erro = validarQuantidadeContada(qtd);
  if (erro) return msg($("#ivMsg"), erro, "err");
  const r = incluir(iv.invId, iv.enderecoId, { produto: iv.produto, qtd: Number(qtd), operador: usuario() });
  db = lerEstoque();
  if (!r.ok) return msg($("#ivMsg"), r.msg, "err");
  msg($("#ivMsg"), `${num(qtd)} incluído(s)`, "ok");
  iv.produto = null;
  desenhar();
});

$("#ivRes").addEventListener("click", (ev) => {
  const b = ev.target.closest("button"); if (!b) return;
  db = lerEstoque();
  if (b.dataset.inv) {
    iv.invId = +b.dataset.inv; msg($("#ivMsg"), "");
    const i = inv();
    if (i.tipo === "completo" && i.ruas.length === 1) iv.rua = i.ruas[0]; // uma rua só: pula a escolha
    return desenhar();
  }
  if (b.dataset.rua) { iv.rua = +b.dataset.rua; msg($("#ivMsg"), ""); return desenhar(); }
  if (b.dataset.tirar) {
    const r = removerIncluido(iv.invId, iv.enderecoId, +b.dataset.tirar);
    db = lerEstoque();
    if (!r.ok) return msg($("#ivMsg"), r.msg, "err");
    msg($("#ivMsg"), "Inclusão removida"); desenhar();
  }
});

// PRÓXIMO ENDEREÇO: não finaliza; o que foi incluído fica salvo
$("#ivProximo").addEventListener("click", () => {
  Object.assign(iv, { enderecoId: null, produto: null });
  msg($("#ivMsg"), "As quantidades incluídas ficaram salvas.");
  desenhar();
});

// FINALIZAR CONTAGEM: só aqui o endereço conta como contado
$("#ivFinalizar").addEventListener("click", () => {
  db = lerEstoque();
  const i = inv(), e = enderecoPorId(db, iv.enderecoId);
  const semBipar = itensDoEndereco(i, e.id).filter((x) => !itemEncerrado(x.contagens) && !incluidosNoEndereco(i, e.id).some((y) => y.produto === x.produto)).length;
  confirmar("Finalizar contagem", `${e.codigo}`,
    `${incluidosNoEndereco(i, e.id).length} inclusão(ões).${semBipar ? ` <b>${semBipar} produto(s) previsto(s) não bipado(s) contam ZERO.</b>` : ""}`, () => {
      const r = finalizarContagem(iv.invId, e.id, usuario());
      db = lerEstoque();
      if (!r.ok) return msg($("#ivMsg"), r.msg, "err");
      Object.assign(iv, { enderecoId: null, produto: null });
      // divergência entre as contagens: o endereço volta para nova contagem (com outro operador ou o mesmo)
      if (r.situacao === "concluido") { toast("Contagem concluída"); msg($("#ivMsg"), `${e.codigo} concluído`, "ok"); }
      else { toast("Contagem registrada"); msg($("#ivMsg"), `${e.codigo}: contagem registrada. O endereço volta para a próxima contagem.`, "ok"); }
      desenhar();
    });
});
