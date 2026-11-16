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
  statusDaNota, resumoDaNota, validarDoca, validarConferencia, quantidadeEmUnidades, pendenteDeConferir, pendentesPorData, pendenteNaDoca, pendenteDaConferencia,
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
  if (tela === "viewRecConf" && conf.notaId) return voltarConferencia();
  if (tela === "viewRecArm" && arm.docaId) return iniciarArmazenamento();
  if (tela === "viewRecCons" && consulta.notaId) { consulta.notaId = null; return desenharConsulta(); }
  document.dispatchEvent(new Event("voltar-menu"));
}));

// impressão das etiquetas dos volumes (80 × 60 mm, uma por página)
function imprimirVolumes(volumes, nota, produto) {
  $("#printArea").innerHTML = volumes.map((v) => etiquetaVolumeHtml(v, nota, produto)).join("");
  window.print();
}

// =====================================================================
// CONFERÊNCIA: 1) nota  2) bipa o produto  3) quantidade e volumes  4) QR da doca (confirma na hora)
// Primeiro se confere o produto; depois ele é associado à doca onde foi descarregado.
// Produto e doca entram só por leitura (bipe ou digitação), nunca tocando na lista.
// =====================================================================
const conf = { notaId: null, produto: null, embalagem: null, qtd: null, volumes: null };
const limparProduto = () => Object.assign(conf, { produto: null, embalagem: null, qtd: null, volumes: null });

function iniciarConferencia() {
  conf.notaId = null; limparProduto();
  msg($("#rcMsg"), ""); $("#rcInput").value = "";
  desenharConferencia();
}

// voltar um passo: doca → quantidade → produto → lista de notas
function voltarConferencia() {
  msg($("#rcMsg"), "");
  if (conf.qtd) { conf.qtd = null; conf.volumes = null; return desenharConferencia(); }
  if (conf.produto) { limparProduto(); return desenharConferencia(); }
  iniciarConferencia();
}

function desenharConferencia() {
  const nota = conf.notaId ? notaPorId(db, conf.notaId) : null;
  // a nota foi finalizada em outro coletor enquanto esta tela estava aberta
  if (nota && nota.finalizada) { iniciarConferencia(); return msg($("#rcMsg"), MSG_NOTA_FINALIZADA, "err"); }
  $("#rcFoot").hidden = !nota;
  // no passo da quantidade o campo de leitura some (o leitor não pode digitar dentro da quantidade)
  $("#rcForm").hidden = !!(conf.produto && !conf.qtd);
  if (!nota) return desenharNotas();
  $("#rcTopo").innerHTML = cartaoNota(nota);
  if (!conf.produto) return desenharItens(nota);
  if (!conf.qtd) return desenharQuantidade(nota);
  desenharEscolhaDaDoca(nota);
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

// passo 2: os produtos da nota com o que já foi conferido (não é cega: mostra a quantidade da nota).
// A lista é só para acompanhar: o produto entra bipando a embalagem ou digitando o código.
function desenharItens(nota) {
  $("#rcPasso").textContent = "2 · Bipe o produto";
  $("#rcInput").placeholder = "Bipe o produto ou digite o código";
  $("#rcRes").innerHTML = `<p class="es-h">Produtos da nota · conferido / nota</p><div class="es-lista">${resumoDaNota(nota, db.conferencias).map((i) => {
    const p = produtoPorCodigo(db, i.produto);
    const completo = i.conferido >= i.qtdNota;
    return `<div class="line rc-item ${completo ? "ok" : ""}"><span class="line-desc">${esc(p.descricao)}<small>${esc(p.codigo)}</small></span>
      <span class="line-q">${num(i.conferido)}<small>/${num(i.qtdNota)}</small></span></div>`;
  }).join("")}</div>`;
}

const caixaBipada = () => (conf.embalagem && conf.embalagem.qtd > 1 ? conf.embalagem : null);
const numerosDoItem = (nota) => {
  const item = nota.itens.find((i) => i.produto === conf.produto);
  const pendente = pendenteDeConferir(nota, conf.produto, db.conferencias);
  return `<div class="rc-nums"><div><small>Na nota</small><b>${num(item.qtd)}</b></div><div><small>Conferido</small><b>${num(item.qtd - pendente)}</b></div><div><small>Pendente</small><b>${num(pendente)}</b></div></div>`;
};

// passo 3: quantidade (em caixas, se bipou uma caixa) e em quantos volumes está
function desenharQuantidade(nota) {
  const p = produtoPorCodigo(db, conf.produto);
  const caixa = caixaBipada();
  $("#rcPasso").textContent = "3 · Quantidade e volumes";
  $("#rcRes").innerHTML = `${cartaoProduto(p, conf.embalagem ? `<p class="es-pronto">Bipou: ${esc(conf.embalagem.descricao)}</p>` : "")}
    ${numerosDoItem(nota)}
    <form id="rcQtdForm" class="es-form">
      <label class="field"><span>${caixa ? `${esc(caixa.descricao)} · quantas?` : "Quantidade conferida (un)"}</span>
        <input name="qtd" type="number" inputmode="decimal" min="0" step="any" value="${caixa ? 1 : ""}" required></label>
      <p class="rc-total" id="rcTotal"></p>
      <label class="field"><span>Em quantos volumes?</span><input name="volumes" type="number" inputmode="numeric" min="1" value="1" required></label>
      <div class="es-duo"><button type="button" class="btn ghost" data-rccancelar>Cancelar</button><button class="btn primary" id="rcConfirmar">Continuar</button></div>
    </form>`;
  atualizarTotal();
  setTimeout(() => $("#rcQtdForm")?.qtd.select(), 50);
}

// "2 caixas × 12 = 24 un": mostra o total em unidades enquanto digita
function atualizarTotal() {
  const f = $("#rcQtdForm"); if (!f) return;
  const caixa = caixaBipada();
  const total = quantidadeEmUnidades(caixa, f.qtd.value || 0);
  $("#rcTotal").textContent = caixa ? `${num(f.qtd.value || 0)} × ${num(caixa.qtd)} = ${num(total)} un` : "";
  $("#rcConfirmar").textContent = total > 0 ? `Continuar · ${num(total)} un` : "Continuar";
}

// passo 4: a doca onde a mercadoria foi descarregada. Ao ler a doca, a conferência é confirmada na hora
// (o saldo entra nela e as etiquetas dos volumes saem).
function desenharEscolhaDaDoca(nota) {
  const p = produtoPorCodigo(db, conf.produto);
  $("#rcPasso").textContent = "4 · Leia o QR da doca";
  $("#rcInput").placeholder = "Bipe o QR da doca ou digite o ID";
  $("#rcRes").innerHTML = `${cartaoProduto(p)}
    <div class="rc-nota rc-conferindo"><span>Conferindo</span><b>+${num(conf.qtd)} un</b><small>${num(conf.volumes)} volume(s) · etiquetas saem ao ler a doca</small></div>
    <div class="es-duo"><button type="button" class="btn ghost" data-rcalterar>Alterar quantidade</button><button type="button" class="btn ghost" data-rccancelar>Cancelar</button></div>
    <p class="muted rc-dica">Bipe o QR da doca onde a mercadoria foi descarregada, ou digite o ID impresso na etiqueta.</p>`;
  setTimeout(() => $("#rcInput").focus(), 50);
}

$("#rcForm").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const lido = $("#rcInput").value.trim(); if (!lido) return;
  $("#rcInput").value = "";
  if (!conf.notaId) return escolherNota(notaPorNumero(db, lido));
  if (conf.qtd) return lerDoca(acharEndereco(db.enderecos, lido));
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

function escolherProduto(codigo, embalagem) {
  const nota = notaPorId(db, conf.notaId);
  if (!nota.itens.some((i) => i.produto === codigo)) return msg($("#rcMsg"), MSG_PRODUTO_FORA_DA_NOTA, "err");
  if (pendenteDeConferir(nota, codigo, db.conferencias) <= 0) return msg($("#rcMsg"), "PRODUTO JÁ CONFERIDO POR COMPLETO NESTA NOTA.", "err");
  conf.produto = codigo; conf.embalagem = embalagem;
  msg($("#rcMsg"), "Produto identificado", "ok");
  desenharConferencia();
}

// lê a doca e confirma a conferência (o saldo entra na doca e os volumes são impressos)
function lerDoca(endereco) {
  const erro = validarDoca(endereco);
  if (erro) return msg($("#rcMsg"), erro, "err");
  const r = conferir({ notaId: conf.notaId, produto: conf.produto, qtd: conf.qtd, volumes: conf.volumes, docaId: endereco.id });
  if (!r.ok) return msg($("#rcMsg"), r.msg, "err");
  db = lerEstoque();
  const nota = notaPorId(db, conf.notaId), produto = produtoPorCodigo(db, conf.produto);
  msg($("#rcMsg"), `+${num(conf.qtd)} ${produto.codigo} na ${endereco.codigo} · ${r.volumes.length} etiqueta(s)`, "ok");
  limparProduto();
  desenharConferencia();
  imprimirVolumes(r.volumes, nota, produto);
  $("#rcInput").focus();
}

$("#rcRes").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  db = lerEstoque();
  if (b.dataset.nota) return escolherNota(notaPorId(db, +b.dataset.nota));
  if (b.dataset.rcalterar !== undefined) { conf.qtd = null; conf.volumes = null; msg($("#rcMsg"), ""); return desenharConferencia(); }
  if (b.dataset.rccancelar !== undefined) { limparProduto(); msg($("#rcMsg"), ""); desenharConferencia(); $("#rcInput").focus(); }
});
$("#rcRes").addEventListener("input", (e) => { if (e.target.form?.id === "rcQtdForm") atualizarTotal(); });
// "Continuar": valida a quantidade (sem passar do pendente da nota) e vai para a leitura da doca
$("#rcRes").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  db = lerEstoque();
  const qtd = quantidadeEmUnidades(caixaBipada(), f.qtd.value || 0);
  const erro = validarConferencia(notaPorId(db, conf.notaId), { produto: conf.produto, qtd, volumes: f.volumes.value }, db.conferencias);
  if (erro) return msg($("#rcMsg"), erro, "err");
  conf.qtd = qtd; conf.volumes = Number(f.volumes.value);
  msg($("#rcMsg"), "");
  desenharConferencia();
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
// ARMAZENAMENTO: QR da doca → bipa o produto → quantidade → QR do destino (efetiva na hora)
// Doca, produto e destino entram só por leitura (bipe ou digitação), nunca tocando na lista:
// assim o sistema confirma que o estoquista está com o produto certo, no lugar certo.
// =====================================================================
const arm = { docaId: null, produto: null };

function iniciarArmazenamento() {
  Object.assign(arm, { docaId: null, produto: null });
  msg($("#raMsg"), ""); $("#raInput").value = "";
  desenharArmazenamento();
}

function desenharArmazenamento() {
  const doca = arm.docaId ? enderecoPorId(db, arm.docaId) : null;
  if (!doca) return desenharPendentes();
  const naDoca = arm.produto ? pendenteNaDoca(db.conferencias, arm.produto, doca.id) : 0;
  $("#raTopo").innerHTML = `<div class="rc-nota">${linhaDoca(doca)}${arm.produto ? `<span class="rc-pend">Pendente nesta doca: <b>${num(naDoca)}</b></span>` : ""}</div>`
    + (arm.produto ? cartaoProduto(produtoPorCodigo(db, arm.produto)) : "");
  if (!arm.produto) {
    $("#raPasso").textContent = "2 · Bipe o produto";
    $("#raInput").placeholder = "Bipe o produto ou digite o código";
    // o que espera armazenamento nesta doca (só para conferir; o produto entra bipando)
    const daDoca = pendentesPorData(db.conferencias.filter((c) => c.docaId === doca.id)).flatMap((d) => d.produtos);
    const somados = [...daDoca.reduce((m, x) => m.set(x.produto, (m.get(x.produto) || 0) + x.pendente), new Map())];
    $("#raRes").innerHTML = `<p class="es-h">Pendente nesta doca</p><div class="es-lista">${somados.map(([produto, q]) => {
      const p = produtoPorCodigo(db, produto);
      return `<div class="line"><span class="line-desc">${esc(p.descricao)}<small>${esc(p.codigo)}</small></span><span class="line-q">${num(q)}</span></div>`;
    }).join("")}</div>`;
    return;
  }
  // passo 3: quantidade e destino. O sistema sugere o endereço padrão, mas qualquer endereço ativo serve.
  $("#raPasso").textContent = "3 · Quantidade e QR do destino";
  $("#raInput").placeholder = "Bipe o QR do destino ou digite o ID";
  const sugeridos = enderecosPadraoDoProduto(db, arm.produto).filter((e) => e && e.ativo).sort((a, b) => compararEnderecos(a.codigo, b.codigo));
  const padrao = Math.min(naDoca, saldoNoEndereco(db, doca.id, arm.produto));
  $("#raRes").innerHTML = `<label class="field"><span>Quantidade a armazenar</span><input id="raQtd" type="number" inputmode="decimal" min="0" step="any" value="${padrao}"></label>
    <p class="es-h">Sugerido (endereço padrão)</p>
    <div class="es-lista">${sugeridos.map((e) => `<div class="line">${tipoTag(e.tipo)}<span class="line-addr">${e.codigo}</span><span class="line-desc"></span><span class="line-q">${num(saldoNoEndereco(db, e.id, arm.produto))}</span></div>`).join("")
      || `<p class="empty">Sem endereço padrão. Leia o QR de qualquer endereço ativo.</p>`}</div>
    <p class="muted">Ao ler o destino, o armazenamento é feito na hora.</p>`;
}

// passo 1: ler a doca. Embaixo, o que está pendente por data de armazenagem (somando notas diferentes) e em qual doca está.
function desenharPendentes() {
  $("#raPasso").textContent = "1 · Leia o QR da doca de origem";
  $("#raInput").placeholder = "Bipe o QR da doca ou digite o ID";
  $("#raTopo").innerHTML = "";
  const datas = pendentesPorData(db.conferencias);
  const docasDo = (produto) => [...new Set(db.conferencias.filter((c) => c.produto === produto && pendenteDaConferencia(c) > 0)
    .map((c) => enderecoPorId(db, c.docaId)?.codigo))].join(", ");
  $("#raRes").innerHTML = datas.map(({ dia, produtos }) => `<p class="es-h">${diaCurto(dia)}${dia === hoje() ? " · hoje" : ""}</p>
    <div class="es-lista">${produtos.map(({ produto, pendente }) => {
      const p = produtoPorCodigo(db, produto);
      return `<div class="line"><span class="line-desc">${esc(p.descricao)}<small>${esc(p.codigo)} · ${docasDo(produto)}</small></span><span class="line-q">${num(pendente)}</span></div>`;
    }).join("")}</div>`).join("") || `<p class="empty">Nada pendente na doca. Tudo armazenado.</p>`;
}

function usarDoca(endereco) {
  const erro = validarDoca(endereco);
  if (erro) return msg($("#raMsg"), erro, "err");
  if (!db.conferencias.some((c) => c.docaId === endereco.id && pendenteDaConferencia(c) > 0)) return msg($("#raMsg"), "NADA PENDENTE DE ARMAZENAR NESTA DOCA.", "err");
  arm.docaId = endereco.id;
  msg($("#raMsg"), "Doca validada", "ok");
  desenharArmazenamento();
}

function usarProduto(achado) {
  if (!achado) return msg($("#raMsg"), "Produto não encontrado.", "err");
  if (pendenteNaDoca(db.conferencias, achado.produto.codigo, arm.docaId) <= 0) return msg($("#raMsg"), "ESTE PRODUTO NÃO TEM PENDÊNCIA NESTA DOCA.", "err");
  arm.produto = achado.produto.codigo;
  msg($("#raMsg"), "Produto validado", "ok");
  desenharArmazenamento();
  setTimeout(() => $("#raQtd")?.select(), 50);
}

function usarDestino(destino) {
  const qtd = $("#raQtd").value;
  const r = armazenar({ produto: arm.produto, docaId: arm.docaId, qtd, destinoId: destino ? destino.id : null });
  if (!r.ok) return msg($("#raMsg"), r.msg, "err");
  db = lerEstoque();
  msg($("#raMsg"), `${num(qtd)} armazenado(s) em ${destino.codigo}`, "ok");
  // sobrou deste produto nesta doca: continua nele; senão, volta a pedir o próximo produto da mesma doca
  if (pendenteNaDoca(db.conferencias, arm.produto, arm.docaId) > 0) return desenharArmazenamento();
  toast(`${arm.produto} armazenado`);
  arm.produto = null;
  // doca vazia de pendências: volta ao início
  if (!db.conferencias.some((c) => c.docaId === arm.docaId && pendenteDaConferencia(c) > 0)) arm.docaId = null;
  desenharArmazenamento();
}

$("#raForm").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerEstoque();
  const lido = $("#raInput").value.trim(); if (!lido) return;
  $("#raInput").value = "";
  if (!arm.docaId) return usarDoca(acharEndereco(db.enderecos, lido));
  if (!arm.produto) return usarProduto(acharPorCodigoLido(db.produtos, db.embalagens, lido));
  usarDestino(acharEndereco(db.enderecos, lido));
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
