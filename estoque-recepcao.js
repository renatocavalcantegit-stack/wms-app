// WMS Beach Bike — coletor do Estoquista, menu RECEPÇÃO: conferência, armazenamento e consulta de recebimentos.
// As regras ficam em compartilhado/regras/recebimento.js e os dados passam por js/dados/recebimento.js.
import { $, $$, esc } from "./js/util.js";
import { closeSheets, toast } from "./js/ui-coletor.js";
import { num, tipoTag, diaCurto, msg, confirmar, cartaoProduto } from "./js/ui-estoque.js";
import { etiquetaVolumeHtml } from "./js/etiqueta-recebimento.js";
import { lerEstoque, enderecoPorId, produtoPorCodigo, saldoNoEndereco, enderecosPadraoDoProduto } from "./js/dados/estoque.js";
import { notaPorId, notaPorNumero, conferir, finalizarNota, armazenar } from "./js/dados/recebimento.js";
import { acharEndereco, compararEnderecos } from "./compartilhado/regras/enderecos.js";
import { acharPorCodigoLido } from "./compartilhado/regras/embalagens.js";
import {
  statusDaNota, resumoDaNota, validarDoca, quantidadeEmUnidades, pendenteDeConferir, pendentesPorData, pendenteNaDoca,
  STATUS_CONFERENCIA, STATUS_DIVERGENCIA, STATUS_ARMAZENAMENTO, MSG_NOTA_FINALIZADA, MSG_PRODUTO_FORA_DA_NOTA,
} from "./compartilhado/regras/recebimento.js";

let db = lerEstoque();
const hoje = () => new Date().toLocaleDateString("sv");

// ---------- pílulas de status (mesmas cores do documento) ----------
const COR = { aguardando: "g", aberta: "y", conferida: "v", sem: "v", com: "y", pendente: "g", parcial: "y", armazenado: "b" };
const pilula = (chave, texto) => `<span class="rc-st ${COR[chave]}">${texto}</span>`;
function pilulasDaNota(nota) {
  const s = statusDaNota(nota, db.conferencias);
  return pilula(s.conferencia, STATUS_CONFERENCIA[s.conferencia])
    + (s.divergencia ? pilula(s.divergencia, STATUS_DIVERGENCIA[s.divergencia]) : "")
    + pilula(s.armazenamento, STATUS_ARMAZENAMENTO[s.armazenamento]);
}
const cartaoNota = (nota, extra = "") => `<div class="rc-nota">
  <div><b>NF ${esc(nota.numero)}</b><span>${esc(nota.fornecedor.nome)}</span><small>${diaCurto(nota.data)} · ${esc(nota.tipo)}</small></div>${extra}</div>`;
const linhaDoca = (doca) => `<div class="rc-doca">${tipoTag("doca")}<span class="line-addr">${doca.codigo}</span></div>`;

// números do menu (aguardando, em aberto, produtos na doca)
export function resumoDoMenu() {
  db = lerEstoque();
  const st = db.notas.map((n) => statusDaNota(n, db.conferencias).conferencia);
  $("#mnConf").textContent = `${st.filter((s) => s === "aguardando").length} aguardando · ${st.filter((s) => s === "aberta").length} em aberto`;
  const naDoca = new Set(pendentesPorData(db.conferencias).flatMap((d) => d.produtos.map((p) => p.produto))).size;
  $("#mnArm").textContent = naDoca ? `${naDoca} produto(s) na doca para armazenar` : "Nada pendente na doca";
}

export function abrirRecepcao(tela) {
  db = lerEstoque();
  if (tela === "viewRecConf") iniciarConferencia();
  if (tela === "viewRecArm") iniciarArmazenamento();
  if (tela === "viewRecCons") iniciarConsulta();
}

// outro coletor (ou o WEB) mudou algo: a tela aberta se redesenha com o dado novo
export function atualizarRecepcao() {
  db = lerEstoque();
  if (!$("#viewRecConf").hidden) desenharConferencia();
  if (!$("#viewRecArm").hidden) desenharArmazenamento();
  if (!$("#viewRecCons").hidden) desenharConsulta();
}

// voltar: passo anterior; no primeiro passo, volta ao menu
$$("[data-rcvoltar]").forEach((b) => b.addEventListener("click", () => {
  closeSheets();
  const tela = b.closest(".view").id;
  if (tela === "viewRecConf" && conf.notaId) return iniciarConferencia();
  if (tela === "viewRecArm" && arm.produto) return iniciarArmazenamento();
  if (tela === "viewRecCons" && consulta.notaId) { consulta.notaId = null; return desenharConsulta(); }
  document.dispatchEvent(new Event("voltar-menu"));
}));

// impressão das etiquetas dos volumes (80 × 60 mm, uma por página)
function imprimirVolumes(volumes, nota, produto) {
  $("#printArea").innerHTML = volumes.map((v) => etiquetaVolumeHtml(v, nota, produto)).join("");
  window.print();
}

// =====================================================================
// CONFERÊNCIA: 1) nota  2) QR da doca  3) bipa o produto, informa a quantidade e os volumes
// =====================================================================
const conf = { notaId: null, docaId: null, produto: null, embalagem: null };

function iniciarConferencia() {
  Object.assign(conf, { notaId: null, docaId: null, produto: null, embalagem: null });
  msg($("#rcMsg"), ""); $("#rcInput").value = "";
  desenharConferencia();
}

function desenharConferencia() {
  const nota = conf.notaId ? notaPorId(db, conf.notaId) : null;
  // a nota foi finalizada em outro coletor enquanto esta tela estava aberta
  if (nota && nota.finalizada) { iniciarConferencia(); return msg($("#rcMsg"), MSG_NOTA_FINALIZADA, "err"); }
  $("#rcFoot").hidden = !(nota && conf.docaId);
  $("#rcForm").hidden = !!conf.produto;
  if (!nota) return desenharNotas();
  const doca = conf.docaId ? enderecoPorId(db, conf.docaId) : null;
  $("#rcTopo").innerHTML = cartaoNota(nota, doca ? linhaDoca(doca) : "");
  if (!doca) return desenharEscolhaDaDoca();
  if (conf.produto) return desenharQuantidade(nota);
  desenharItens(nota);
}

// passo 1: notas que ainda podem ser conferidas (em aberto primeiro)
function desenharNotas() {
  $("#rcPasso").textContent = "1 · Escolha a nota";
  $("#rcInput").placeholder = "Número da nota";
  $("#rcTopo").innerHTML = "";
  const ordem = { aberta: 0, aguardando: 1 };
  const notas = db.notas.filter((n) => !n.finalizada)
    .map((n) => ({ n, st: statusDaNota(n, db.conferencias).conferencia }))
    .sort((a, b) => ordem[a.st] - ordem[b.st] || b.n.data.localeCompare(a.n.data));
  $("#rcRes").innerHTML = `<p class="es-h">Notas para conferir</p><div class="es-lista">${notas.map(({ n, st }) => {
    const r = resumoDaNota(n, db.conferencias);
    const feito = r.reduce((t, i) => t + i.conferido, 0), total = r.reduce((t, i) => t + i.qtdNota, 0);
    return `<button class="line" data-nota="${n.id}"><span class="line-desc"><b>NF ${esc(n.numero)}</b> · ${esc(n.fornecedor.nome)}
      <small>${diaCurto(n.data)} · ${n.itens.length} produtos · ${num(feito)}/${num(total)} conferidos</small></span>${pilula(st, STATUS_CONFERENCIA[st])}</button>`;
  }).join("") || `<p class="empty">Nenhuma nota para conferir.</p>`}</div>`;
}

// passo 2: a doca onde a mercadoria está (o saldo conferido entra nela)
function desenharEscolhaDaDoca() {
  $("#rcPasso").textContent = "2 · Leia o QR da doca";
  $("#rcInput").placeholder = "QR da doca (ou o código R9001-…)";
  const docas = db.enderecos.filter((e) => e.tipo === "doca" && e.ativo).sort((a, b) => compararEnderecos(a.codigo, b.codigo));
  $("#rcRes").innerHTML = `<p class="es-h">Docas ativas · toque para usar (demonstração)</p><div class="es-lista">${docas.map((d) =>
    `<button class="line" data-doca="${d.id}">${tipoTag("doca")}<span class="line-addr">${d.codigo}</span><span class="line-desc"></span><span class="line-q">ID ${d.id}</span></button>`).join("")}</div>`;
}

// passo 3: os produtos da nota com o que já foi conferido (não é cega: mostra a quantidade da nota)
function desenharItens(nota) {
  $("#rcPasso").textContent = "3 · Bipe o produto";
  $("#rcInput").placeholder = "Bipe o produto (ou digite o código interno)";
  $("#rcRes").innerHTML = `<p class="es-h">Produtos da nota · toque para conferir sem bipar</p><div class="es-lista">${resumoDaNota(nota, db.conferencias).map((i) => {
    const p = produtoPorCodigo(db, i.produto);
    const completo = i.conferido >= i.qtdNota;
    return `<button class="line rc-item ${completo ? "ok" : ""}" data-produto="${esc(i.produto)}"><span class="line-desc">${esc(p.descricao)}<small>${esc(p.codigo)}</small></span>
      <span class="line-q">${num(i.conferido)}<small>/${num(i.qtdNota)}</small></span></button>`;
  }).join("")}</div>`;
}

// produto escolhido: quantidade (em caixas, se bipou uma caixa) e em quantos volumes está
function desenharQuantidade(nota) {
  const p = produtoPorCodigo(db, conf.produto);
  const item = nota.itens.find((i) => i.produto === conf.produto);
  const pendente = pendenteDeConferir(nota, conf.produto, db.conferencias);
  const caixa = conf.embalagem && conf.embalagem.qtd > 1 ? conf.embalagem : null;
  $("#rcPasso").textContent = "3 · Quantidade e volumes";
  $("#rcRes").innerHTML = `${cartaoProduto(p, conf.embalagem ? `<p class="es-pronto">Bipou: ${esc(conf.embalagem.descricao)}</p>` : "")}
    <div class="rc-nums"><div><small>Na nota</small><b>${num(item.qtd)}</b></div><div><small>Conferido</small><b>${num(item.qtd - pendente)}</b></div><div><small>Pendente</small><b>${num(pendente)}</b></div></div>
    <form id="rcQtdForm" class="es-form">
      <label class="field"><span>${caixa ? `${esc(caixa.descricao)} · quantas?` : "Quantidade conferida (un)"}</span>
        <input name="qtd" type="number" inputmode="decimal" min="0" step="any" value="${caixa ? 1 : ""}" required></label>
      <p class="rc-total" id="rcTotal"></p>
      <label class="field"><span>Em quantos volumes?</span><input name="volumes" type="number" inputmode="numeric" min="1" value="1" required></label>
      <div class="es-duo"><button type="button" class="btn ghost" data-rccancelar>Cancelar</button><button class="btn primary" id="rcConfirmar">Confirmar</button></div>
    </form>`;
  atualizarTotal();
  setTimeout(() => $("#rcQtdForm").qtd.select(), 50);
}

// "2 caixas × 12 = 24 un": mostra o total em unidades enquanto digita
function atualizarTotal() {
  const f = $("#rcQtdForm"); if (!f) return;
  const caixa = conf.embalagem && conf.embalagem.qtd > 1 ? conf.embalagem : null;
  const total = quantidadeEmUnidades(caixa, f.qtd.value || 0);
  $("#rcTotal").textContent = caixa ? `${num(f.qtd.value || 0)} × ${num(caixa.qtd)} = ${num(total)} un` : "";
  $("#rcConfirmar").textContent = total > 0 ? `Confirmar +${num(total)}` : "Confirmar";
}

$("#rcForm").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const lido = $("#rcInput").value.trim(); if (!lido) return;
  $("#rcInput").value = "";
  if (!conf.notaId) return escolherNota(notaPorNumero(db, lido));
  if (!conf.docaId) return escolherDoca(acharEndereco(db.enderecos, lido));
  const achado = acharPorCodigoLido(db.produtos, db.embalagens, lido);
  if (!achado) return msg($("#rcMsg"), "Produto não encontrado.", "err");
  escolherProduto(achado.produto.codigo, achado.embalagem);
});

function escolherNota(nota) {
  if (!nota) return msg($("#rcMsg"), "Nota não encontrada.", "err");
  if (nota.finalizada) return msg($("#rcMsg"), MSG_NOTA_FINALIZADA, "err");
  conf.notaId = nota.id;
  msg($("#rcMsg"), `NF ${nota.numero} aberta`, "ok");
  desenharConferencia();
}

function escolherDoca(endereco) {
  const erro = validarDoca(endereco);
  if (erro) return msg($("#rcMsg"), erro, "err");
  conf.docaId = endereco.id;
  msg($("#rcMsg"), "Doca validada", "ok");
  desenharConferencia();
}

function escolherProduto(codigo, embalagem) {
  const nota = notaPorId(db, conf.notaId);
  if (!nota.itens.some((i) => i.produto === codigo)) return msg($("#rcMsg"), MSG_PRODUTO_FORA_DA_NOTA, "err");
  if (pendenteDeConferir(nota, codigo, db.conferencias) <= 0) return msg($("#rcMsg"), "PRODUTO JÁ CONFERIDO POR COMPLETO NESTA NOTA.", "err");
  conf.produto = codigo; conf.embalagem = embalagem;
  msg($("#rcMsg"), "Produto identificado", "ok");
  desenharConferencia();
}

$("#rcRes").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  db = lerEstoque();
  if (b.dataset.nota) return escolherNota(notaPorId(db, +b.dataset.nota));
  if (b.dataset.doca) return escolherDoca(enderecoPorId(db, +b.dataset.doca));
  if (b.dataset.produto) return escolherProduto(b.dataset.produto, null);
  if (b.dataset.rccancelar !== undefined) { conf.produto = null; conf.embalagem = null; msg($("#rcMsg"), ""); desenharConferencia(); $("#rcInput").focus(); }
});
$("#rcRes").addEventListener("input", (e) => { if (e.target.form?.id === "rcQtdForm") atualizarTotal(); });
$("#rcRes").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const caixa = conf.embalagem && conf.embalagem.qtd > 1 ? conf.embalagem : null;
  const qtd = quantidadeEmUnidades(caixa, f.qtd.value || 0);
  const r = conferir({ notaId: conf.notaId, produto: conf.produto, qtd, volumes: f.volumes.value, docaId: conf.docaId });
  if (!r.ok) return msg($("#rcMsg"), r.msg, "err");
  db = lerEstoque();
  const nota = notaPorId(db, conf.notaId), produto = produtoPorCodigo(db, conf.produto);
  msg($("#rcMsg"), `+${num(qtd)} ${produto.codigo} conferidos · ${r.volumes.length} etiqueta(s)`, "ok");
  conf.produto = null; conf.embalagem = null;
  desenharConferencia();
  imprimirVolumes(r.volumes, nota, produto);
  $("#rcInput").focus();
});

$("#rcTrocar").addEventListener("click", () => { iniciarConferencia(); $("#rcInput").focus(); });
$("#rcFinalizar").addEventListener("click", () => {
  db = lerEstoque();
  const nota = notaPorId(db, conf.notaId);
  const faltas = resumoDaNota(nota, db.conferencias).filter((i) => i.conferido < i.qtdNota);
  const aviso = faltas.length ? "A NOTA SERÁ FINALIZADA COM DIVERGÊNCIA E NÃO PODERÁ SER REABERTA." : "DESEJA FINALIZAR A NOTA? ELA NÃO PODERÁ SER REABERTA.";
  const sub = faltas.map((i) => `${esc(i.produto)}: faltam ${num(-i.divergencia)}`).join("<br>") || `NF ${esc(nota.numero)} · tudo conferido`;
  confirmar("Finalizar nota", aviso, sub, () => {
    finalizarNota(nota.id);
    toast(`NF ${nota.numero} finalizada` + (faltas.length ? " com divergência" : ""));
    db = lerEstoque(); iniciarConferencia();
  });
});

// =====================================================================
// ARMAZENAMENTO: produto pendente → QR da doca → bipa o produto → quantidade → QR do destino (efetiva na hora)
// =====================================================================
const arm = { produto: null, docaId: null, produtoLido: false };

function iniciarArmazenamento() {
  Object.assign(arm, { produto: null, docaId: null, produtoLido: false });
  msg($("#raMsg"), ""); $("#raInput").value = "";
  desenharArmazenamento();
}

function desenharArmazenamento() {
  $("#raForm").hidden = !arm.produto;
  if (!arm.produto) return desenharPendentes();
  const p = produtoPorCodigo(db, arm.produto);
  const doca = arm.docaId ? enderecoPorId(db, arm.docaId) : null;
  const naDoca = doca ? pendenteNaDoca(db.conferencias, arm.produto, doca.id) : 0;
  $("#raTopo").innerHTML = cartaoProduto(p) + (doca ? `<div class="rc-nota">${linhaDoca(doca)}<span class="rc-pend">Pendente nesta doca: <b>${num(naDoca)}</b></span></div>` : "");
  if (!doca) {
    $("#raPasso").textContent = "1 · Leia o QR da doca de origem";
    $("#raInput").placeholder = "QR da doca de origem";
    // onde esse produto espera armazenamento (ajuda a achar a doca)
    const docas = [...new Set(db.conferencias.filter((c) => c.produto === arm.produto).map((c) => c.docaId))]
      .map((id) => ({ d: enderecoPorId(db, id), q: pendenteNaDoca(db.conferencias, arm.produto, id) })).filter((x) => x.q > 0);
    $("#raRes").innerHTML = `<p class="es-h">Está nas docas · toque para usar (demonstração)</p><div class="es-lista">${docas.map(({ d, q }) =>
      `<button class="line" data-radoca="${d.id}">${tipoTag("doca")}<span class="line-addr">${d.codigo}</span><span class="line-desc"></span><span class="line-q">${num(q)}</span></button>`).join("")}</div>`;
    return;
  }
  if (!arm.produtoLido) {
    $("#raPasso").textContent = "2 · Bipe o produto";
    $("#raInput").placeholder = "Bipe o produto (ou digite o código interno)";
    $("#raRes").innerHTML = "";
    return;
  }
  // passo 3: quantidade e destino. O sistema sugere o endereço padrão, mas qualquer endereço ativo serve.
  $("#raPasso").textContent = "3 · Quantidade e QR do destino";
  $("#raInput").placeholder = "QR do endereço de destino";
  const sugeridos = enderecosPadraoDoProduto(db, arm.produto).filter((e) => e && e.ativo).sort((a, b) => compararEnderecos(a.codigo, b.codigo));
  const padrao = Math.min(naDoca, saldoNoEndereco(db, doca.id, arm.produto));
  $("#raRes").innerHTML = `<label class="field"><span>Quantidade a armazenar</span><input id="raQtd" type="number" inputmode="decimal" min="0" step="any" value="${padrao}"></label>
    <p class="es-h">Sugerido (endereço padrão) · toque para usar (demonstração)</p>
    <div class="es-lista">${sugeridos.map((e) => `<button class="line" data-radestino="${e.id}">${tipoTag(e.tipo)}<span class="line-addr">${e.codigo}</span><span class="line-desc"></span><span class="line-q">${num(saldoNoEndereco(db, e.id, arm.produto))}</span></button>`).join("")
      || `<p class="empty">Sem endereço padrão. Leia o QR de qualquer endereço ativo.</p>`}</div>
    <p class="muted">Ao ler o destino, o armazenamento é feito na hora.</p>`;
}

// lista inicial: por data de armazenagem, produtos pendentes (somando notas diferentes)
function desenharPendentes() {
  $("#raPasso").textContent = "Escolha o produto";
  $("#raTopo").innerHTML = "";
  const datas = pendentesPorData(db.conferencias);
  $("#raRes").innerHTML = datas.map(({ dia, produtos }) => `<p class="es-h">${diaCurto(dia)}${dia === hoje() ? " · hoje" : ""}</p>
    <div class="es-lista">${produtos.map(({ produto, pendente }) => {
      const p = produtoPorCodigo(db, produto);
      return `<button class="line" data-raprod="${esc(produto)}"><span class="line-desc">${esc(p.descricao)}<small>${esc(p.codigo)}</small></span><span class="line-q">${num(pendente)}</span></button>`;
    }).join("")}</div>`).join("") || `<p class="empty">Nada pendente na doca. Tudo armazenado.</p>`;
}

function usarDoca(endereco) {
  const erro = validarDoca(endereco);
  if (erro) return msg($("#raMsg"), erro, "err");
  if (pendenteNaDoca(db.conferencias, arm.produto, endereco.id) <= 0) return msg($("#raMsg"), "ESTE PRODUTO NÃO TEM PENDÊNCIA NESTA DOCA.", "err");
  arm.docaId = endereco.id;
  msg($("#raMsg"), "Doca validada", "ok");
  desenharArmazenamento();
}

function usarDestino(destino) {
  const qtd = $("#raQtd").value;
  const r = armazenar({ produto: arm.produto, docaId: arm.docaId, qtd, destinoId: destino ? destino.id : null });
  if (!r.ok) return msg($("#raMsg"), r.msg, "err");
  db = lerEstoque();
  msg($("#raMsg"), `${num(qtd)} armazenado(s) em ${destino.codigo}`, "ok");
  // sobrou nesta doca: continua no mesmo produto; senão, volta para a lista
  if (pendenteNaDoca(db.conferencias, arm.produto, arm.docaId) > 0) return desenharArmazenamento();
  toast(`${arm.produto} armazenado`);
  Object.assign(arm, { produto: null, docaId: null, produtoLido: false });
  desenharArmazenamento();
}

$("#raForm").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const lido = $("#raInput").value.trim(); if (!lido) return;
  $("#raInput").value = "";
  if (!arm.docaId) return usarDoca(acharEndereco(db.enderecos, lido));
  if (!arm.produtoLido) {
    const achado = acharPorCodigoLido(db.produtos, db.embalagens, lido);
    if (!achado) return msg($("#raMsg"), "Produto não encontrado.", "err");
    if (achado.produto.codigo !== arm.produto) return msg($("#raMsg"), "PRODUTO DIFERENTE DO SELECIONADO.", "err");
    arm.produtoLido = true;
    msg($("#raMsg"), "Produto validado", "ok");
    return desenharArmazenamento();
  }
  usarDestino(acharEndereco(db.enderecos, lido));
});

$("#raRes").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  db = lerEstoque();
  if (b.dataset.raprod) { arm.produto = b.dataset.raprod; msg($("#raMsg"), ""); desenharArmazenamento(); return $("#raInput").focus(); }
  if (b.dataset.radoca) return usarDoca(enderecoPorId(db, +b.dataset.radoca));
  if (b.dataset.radestino) return usarDestino(enderecoPorId(db, +b.dataset.radestino));
});

// =====================================================================
// CONSULTA DE RECEBIMENTOS (só leitura)
// =====================================================================
const consulta = { busca: "", notaId: null };

function iniciarConsulta() {
  consulta.busca = ""; consulta.notaId = null; $("#rqInput").value = "";
  desenharConsulta();
}

function desenharConsulta() {
  $("#rqForm").hidden = !!consulta.notaId;
  if (consulta.notaId) return desenharDetalheDaNota(notaPorId(db, consulta.notaId));
  $("#rqPasso").textContent = "Recepção";
  const t = consulta.busca.trim().toLowerCase();
  const notas = db.notas
    .filter((n) => !t || n.numero.includes(t) || n.fornecedor.nome.toLowerCase().includes(t))
    .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
  $("#rqRes").innerHTML = `<div class="es-lista">${notas.map((n) => `<button class="line rc-linha" data-rqnota="${n.id}">
    <span class="line-desc"><b>NF ${esc(n.numero)}</b> · ${esc(n.fornecedor.nome)}<small>${diaCurto(n.data)} · ${esc(n.tipo)}</small><span class="rc-pills">${pilulasDaNota(n)}</span></span>
  </button>`).join("") || `<p class="empty">Nenhuma nota encontrada.</p>`}</div>`;
}

function desenharDetalheDaNota(nota) {
  $("#rqPasso").textContent = `NF ${nota.numero}`;
  $("#rqRes").innerHTML = cartaoNota(nota, `<span class="rc-pills">${pilulasDaNota(nota)}</span>`)
    + resumoDaNota(nota, db.conferencias).map((i) => {
      const p = produtoPorCodigo(db, i.produto);
      return `<div class="rc-cons"><p class="product-desc">${esc(p.descricao)}</p><p class="product-meta">${esc(p.codigo)} · ${esc(p.un)}</p>
        <div class="rc-nums seis">
          <div><small>Nota</small><b>${num(i.qtdNota)}</b></div><div><small>Conferido</small><b>${num(i.conferido)}</b></div>
          <div><small>Diverg.</small><b class="${nota.finalizada && i.divergencia ? "neg" : ""}">${nota.finalizada ? num(i.divergencia) : "—"}</b></div>
          <div><small>Armazenado</small><b>${num(i.armazenado)}</b></div><div><small>Pendente</small><b>${num(i.pendenteArmazenar)}</b></div><div><small>Volumes</small><b>${num(i.volumes)}</b></div>
        </div></div>`;
    }).join("");
}

$("#rqInput").addEventListener("input", () => { consulta.busca = $("#rqInput").value; desenharConsulta(); });
$("#rqForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = notaPorNumero(db, $("#rqInput").value);
  if (n) { consulta.notaId = n.id; desenharConsulta(); }
});
$("#rqRes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rqnota]"); if (!b) return;
  db = lerEstoque(); consulta.notaId = +b.dataset.rqnota; desenharConsulta();
});
