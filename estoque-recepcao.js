// WMS Beach Bike — coletor do Estoquista, menu RECEPÇÃO: conferência, armazenamento e consulta de recebimentos.
// As regras ficam em compartilhado/regras/recebimento.js e os dados passam por js/dados/recebimento.js.
// Com servidor (v78), a Conferência usa a cópia das notas em aberto (js/dados/recepcao.js) e a fila de envio:
// (v79: confere vários produtos e endereça na doca quando quiser, pela lista js/dados/recepcao-lista.js)
// (v80: conferência por volume, palete ou caixa: js/dados/recepcao-volumes.js)
// confere sem rede e nunca lê o Estoque inteiro. Armazenamento e Consulta ainda não estão no servidor (entrega C).
import { $, $$, esc } from "./js/util.js";
import { closeSheets, toast } from "./js/ui-coletor.js";
import { num, tipoTag, diaCurto, msg, confirmar, cartaoProduto } from "./js/ui-estoque.js";
import { lerEstoque, enderecoPorId, produtoPorCodigo, saldoNoEndereco, enderecosPadraoDoProduto } from "./js/dados/estoque.js";
import { notaPorId, notaPorNumero, conferir, finalizarNota, armazenar, enderecarVolume } from "./js/dados/recebimento.js";
import { lerRecepcao, conferirNaFila, finalizarNaFila, enderecarVolumeNaFila } from "./js/dados/recepcao.js";
import { lerListaDaDoca, porNaLista, tirarDaLista, esvaziarLista, listaComoConferencias } from "./js/dados/recepcao-lista.js";
import {
  volumesMontando, volumeMontando, criarVolumes, vincular, tirarDoVolume, tirarVolumes, descartarVolumesDaNota, volumesComoConferencias,
} from "./js/dados/recepcao-volumes.js";
import { etiquetaVolumeDaNotaHtml } from "./js/etiqueta-recebimento.js";
import { acharEndereco, compararEnderecos } from "./compartilhado/regras/enderecos.js";
import { MSG_FORA_DO_SERVIDOR } from "./js/ui-estoque.js";
import { acharPorCodigoLido } from "./compartilhado/regras/embalagens.js";
import {
  statusDaNota, resumoDaNota, validarDoca, validarDocaDeArmazenamento, validarConferencia, quantidadeEmUnidades, pendenteDeConferir, pendentesPorData, pendenteNaDoca, pendenteDaConferencia,
  STATUS_CONFERENCIA, STATUS_DIVERGENCIA, STATUS_ARMAZENAMENTO, MSG_NOTA_FINALIZADA, MSG_PRODUTO_FORA_DA_NOTA, rotuloDaNota,
  TIPOS_DE_VOLUME, MAXIMO_VOLUMES_DE_UMA_VEZ, MSG_VOLUME_VAZIO, MSG_VOLUME_NAO_ENCONTRADO, MSG_VOLUME_FECHADO, validarCriacaoDeVolumes,
} from "./compartilhado/regras/recebimento.js";

// com servidor: { sess, pedirEnvio } (ligarRecepcaoNoServidor). Sem servidor: a demonstração, no aparelho.
let servidor = null;
const lerDados = () => (servidor ? lerRecepcao() : lerEstoque());
let db = null; // lido ao abrir (com servidor, o Estoque da demonstração nem é lido)
const hoje = () => new Date().toLocaleDateString("sv");

export function ligarRecepcaoNoServidor(sess, pedirEnvio) {
  servidor = { sess, pedirEnvio };
}
// a cópia das notas foi baixada de novo: redesenha SÓ a lista de notas e a de produtos
// (nunca o passo da quantidade ou da doca, para não apagar o que o estoquista está digitando)
export function aoBaixarNotas() {
  db = lerDados();
  if (!$("#viewRecConf").hidden && !conf.produto && !conf.criando) desenharConferencia();
  if (!$("#viewEstHome").hidden) resumoDoMenu();
}

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
  <div><b>${esc(rotuloDaNota(nota))}</b><span>${esc(nota.fornecedor.nome)}</span><small>${diaCurto(nota.data)} · ${esc(nota.tipo)}</small></div>${extra}</div>`;
const linhaDoca = (doca) => `<div class="rc-doca">${tipoTag("doca")}<span class="line-addr">${doca.codigo}</span></div>`;

// números do menu (aguardando, em aberto, produtos na doca)
export function resumoDoMenu() {
  db = lerDados();
  const st = db.notas.map((n) => statusDaNota(n, db.conferencias).conferencia);
  $("#mnConf").textContent = `${st.filter((s) => s === "aguardando").length} aguardando · ${st.filter((s) => s === "aberta").length} em aberto`;
  if (servidor) { $("#mnArm").textContent = MSG_FORA_DO_SERVIDOR; return; }
  const naDoca = new Set(pendentesPorData(db.conferencias).flatMap((d) => d.produtos.map((p) => p.produto))).size;
  $("#mnArm").textContent = naDoca ? `${naDoca} produto(s) na doca para armazenar` : "Nada pendente na doca";
}

export function abrirRecepcao(tela) {
  db = lerDados();
  if (tela === "viewRecConf") iniciarConferencia();
  if (tela === "viewRecArm") iniciarArmazenamento();
  if (tela === "viewRecCons") iniciarConsulta();
}

// outro coletor (ou o WEB) mudou algo: a tela aberta se redesenha com o dado novo
export function atualizarRecepcao() {
  db = lerDados();
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

// =====================================================================
// CONFERÊNCIA
//  Por produto (v79): 1) nota  2) bipa o produto  3) quantidade → lista "aguardando doca" → volta ao 2.
//    A qualquer momento, "Endereçar" pede o QR da doca: tudo o que está na lista entra nela de uma vez.
//  Por volume (v80): cria os volumes (palete ou caixa) e imprime as etiquetas; abre um volume (bipando a etiqueta
//    ou tocando na lista), vincula os produtos e "Endereçar volume" leva o volume inteiro para a doca.
//    Até ser endereçado o volume existe só neste aparelho (js/dados/recepcao-volumes.js).
// Produto e doca entram só por leitura (bipe ou digitação), nunca tocando na lista.
// =====================================================================
const conf = { notaId: null, produto: null, embalagem: null, enderecando: false, modo: "produto", volume: null, criando: false };
const limparProduto = () => Object.assign(conf, { produto: null, embalagem: null });
const MSG_LISTA_PENDENTE = "HÁ PRODUTOS CONFERIDOS AGUARDANDO A DOCA. ENDEREÇE OU TIRE DA LISTA ANTES.";
const MSG_VOLUMES_MONTANDO = "HÁ VOLUMES COM PRODUTOS SEM DOCA. ENDEREÇE OU TIRE OS PRODUTOS DELES ANTES.";
const porVolume = () => conf.modo === "volume";

// a lista "aguardando doca" desta nota, e as conferências da tela somadas a ela e aos volumes montando
// (para o conferido e o pendente)
const listaDaNota = () => { const d = lerListaDaDoca(); return d.notaId === conf.notaId ? d : { notaId: conf.notaId, itens: [] }; };
const conferenciasComTudo = () => [...db.conferencias, ...listaComoConferencias(listaDaNota()), ...volumesComoConferencias(conf.notaId)];
// os volumes já endereçados da nota (com servidor: os do servidor e os a caminho)
const volumesEnderecados = () => (db.volumesEntrada || []).filter((v) => v.notaId === conf.notaId);
const tipoDoVolume = (tipo) => TIPOS_DE_VOLUME[tipo] || tipo;

function iniciarConferencia() {
  Object.assign(conf, { notaId: null, enderecando: false, volume: null, criando: false }); limparProduto();
  msg($("#rcMsg"), ""); $("#rcInput").value = "";
  // ficou lista de antes (o app fechou no meio): reabre a nota dela
  const guardada = lerListaDaDoca();
  if (guardada.itens.length) {
    const nota = notaPorId(db, guardada.notaId);
    if (nota && !nota.finalizada) { conf.notaId = nota.id; conf.modo = "produto"; msg($("#rcMsg"), `${guardada.itens.length} produto(s) aguardando a doca`, "ok"); }
    else { esvaziarLista(); msg($("#rcMsg"), "A nota da lista foi finalizada: os produtos aguardando a doca foram descartados.", "err"); }
  }
  desenharConferencia();
}

// voltar um passo: criar volumes / doca / quantidade → o passo de antes · volume aberto → lista de volumes ·
// produtos ou volumes → lista de notas (se não houver produto aguardando a doca)
function voltarConferencia() {
  msg($("#rcMsg"), "");
  if (conf.criando) { conf.criando = false; return desenharConferencia(); }
  if (conf.enderecando) { conf.enderecando = false; return desenharConferencia(); }
  if (conf.produto) { limparProduto(); return desenharConferencia(); }
  if (conf.volume) { conf.volume = null; return desenharConferencia(); }
  if (listaDaNota().itens.length) return msg($("#rcMsg"), MSG_LISTA_PENDENTE, "err");
  iniciarConferencia();
}

// os botões de baixo mudam com o passo
function desenharRodape(nota) {
  const montando = conf.volume ? volumeMontando(conf.volume) : null;
  $("#rcFoot").hidden = !nota || conf.criando || (porVolume() && (conf.enderecando || !!conf.produto));
  $("#rcTrocar").hidden = !!conf.volume;
  $("#rcFinalizar").hidden = !!conf.volume;
  $("#rcEnderecar").hidden = porVolume();
  $("#rcImprimir").hidden = !conf.volume;
  $("#rcEnderecarVol").hidden = !montando;
  $("#rcEnderecarVol").disabled = !montando?.itens.length;
  const n = listaDaNota().itens.length;
  $("#rcEnderecar").disabled = !n || conf.enderecando || !!conf.produto;
  $("#rcEnderecar").textContent = n ? `Endereçar (${n})` : "Endereçar";
}

function desenharConferencia() {
  const nota = conf.notaId ? notaPorId(db, conf.notaId) : null;
  // a nota foi finalizada em outro coletor enquanto esta tela estava aberta (com servidor, ela some da cópia)
  if (conf.notaId && (!nota || nota.finalizada)) {
    if (lerListaDaDoca().notaId === conf.notaId) esvaziarLista();
    descartarVolumesDaNota(conf.notaId);
    conf.notaId = null; iniciarConferencia(); return msg($("#rcMsg"), MSG_NOTA_FINALIZADA, "err");
  }
  const enderecado = conf.volume && !volumeMontando(conf.volume);
  if (conf.volume && !volumeMontando(conf.volume) && !volumesEnderecados().some((v) => v.codigo === conf.volume)) conf.volume = null; // sumiu
  desenharRodape(nota);
  // no passo da quantidade (e no de criar volumes) o campo de leitura some: o leitor não pode digitar dentro deles
  $("#rcForm").hidden = !!conf.produto || conf.criando || !!(conf.volume && enderecado && !conf.enderecando);
  if (!nota) return desenharNotas();
  $("#rcTopo").innerHTML = cartaoNota(nota);
  if (conf.produto) return desenharQuantidade(nota);
  if (conf.criando) return desenharCriarVolumes();
  if (porVolume()) {
    if (!conf.volume) return desenharVolumes(nota);
    return conf.enderecando ? desenharEnderecarVolume() : desenharVolume();
  }
  if (conf.enderecando) return desenharEnderecar();
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
    return `<button class="line" data-nota="${n.id}"><span class="line-desc"><b>${esc(rotuloDaNota(n))}</b> · ${esc(n.fornecedor.nome)}
      <small>${diaCurto(n.data)} · ${n.itens.length} produto${n.itens.length === 1 ? "" : "s"} · ${num(feito)}/${num(total)} conferidos</small></span>${pilula(st, STATUS_CONFERENCIA[st])}</button>`;
  }).join("") || `<p class="empty">${servidor && !db.baixadoEm ? "As notas ainda não foram baixadas do servidor. Conecte ao Wi-Fi." : "Nenhuma nota para conferir."}</p>`}</div>`;
}

// o seletor "Produto | Volume" (e, no modo volume, o botão de criar volumes)
const seletorDeModo = () => `<div class="rc-modo"><div class="rc-seg" role="group" aria-label="Conferir por">
    <button type="button" data-rcmodo="produto" class="${porVolume() ? "" : "on"}">Produto</button>
    <button type="button" data-rcmodo="volume" class="${porVolume() ? "on" : ""}">Volume</button></div>
  ${porVolume() ? `<button type="button" class="btn ghost rc-criar" data-rccriar>+ Volume</button>` : ""}</div>`;

// os produtos da nota com o que já foi conferido (não é cega: mostra a quantidade da nota). Só para acompanhar.
function htmlDosProdutosDaNota(nota) {
  return `<p class="es-h">Produtos da nota · conferido / nota</p><div class="es-lista">${resumoDaNota(nota, conferenciasComTudo()).map((i) => {
    const p = produtoPorCodigo(db, i.produto);
    const completo = i.conferido >= i.qtdNota;
    return `<div class="line rc-item ${completo ? "ok" : ""}"><span class="line-desc">${esc(p.descricao)}<small>${esc(p.codigo)}</small></span>
      <span class="line-q">${num(i.conferido)}<small>/${num(i.qtdNota)}</small></span></div>`;
  }).join("")}</div>`;
}

// uma lista de produtos com quantidade (a "aguardando doca" ou a de dentro do volume); tirar = o atributo do ✕
function htmlDosItens(titulo, itens, tirar) {
  return `<div class="rc-lista"><p class="rc-lista-h">${titulo} (${itens.length})</p>${itens.map((i) => {
    const p = produtoPorCodigo(db, i.produto);
    return `<div class="line rc-lista-item"><span class="line-desc">${esc(p?.descricao || i.produto)}<small>${esc(i.produto)}</small></span>
      <span class="line-q">${num(i.qtd)}<small> un</small></span>${tirar && i.id ? `<button type="button" class="rc-tirar" ${tirar}="${esc(i.id)}" aria-label="Tirar">✕</button>` : ""}</div>`;
  }).join("")}</div>`;
}

// passo 2 (por produto): a lista aguardando doca e os produtos da nota
function desenharItens(nota) {
  $("#rcPasso").textContent = "2 · Bipe o produto";
  $("#rcInput").placeholder = "Bipe o produto ou digite o código";
  const lista = listaDaNota();
  $("#rcRes").innerHTML = `${seletorDeModo()}
    ${lista.itens.length ? htmlDosItens("Conferidos · aguardando doca", lista.itens, "data-rctirar") : ""}
    ${htmlDosProdutosDaNota(nota)}`;
}

const caixaBipada = () => (conf.embalagem && conf.embalagem.qtd > 1 ? conf.embalagem : null);
const numerosDoItem = (nota) => {
  const item = nota.itens.find((i) => i.produto === conf.produto);
  const pendente = pendenteDeConferir(nota, conf.produto, conferenciasComTudo());
  return `<div class="rc-nums"><div><small>Na nota</small><b>${num(item.qtd)}</b></div><div><small>Conferido</small><b>${num(item.qtd - pendente)}</b></div><div><small>Pendente</small><b>${num(pendente)}</b></div></div>`;
};

// passo 3: quantidade (em caixas, se bipou uma caixa). Confirmar põe na lista (ou no volume aberto) e volta a bipar.
function desenharQuantidade(nota) {
  const p = produtoPorCodigo(db, conf.produto);
  const caixa = caixaBipada();
  $("#rcPasso").textContent = conf.volume ? `${conf.volume} · quantidade` : "3 · Quantidade";
  $("#rcRes").innerHTML = `${cartaoProduto(p, conf.embalagem ? `<p class="es-pronto">Bipou: ${esc(conf.embalagem.descricao)}</p>` : "")}
    ${numerosDoItem(nota)}
    <form id="rcQtdForm" class="es-form">
      <label class="field"><span>${caixa ? `${esc(caixa.descricao)} · quantas?` : "Quantidade conferida (un)"}</span>
        <input name="qtd" type="number" inputmode="decimal" min="0" step="any" value="${caixa ? 1 : ""}" required></label>
      <p class="rc-total" id="rcTotal"></p>
      <div class="es-duo"><button type="button" class="btn ghost" data-rccancelar>Cancelar</button><button class="btn primary" id="rcConfirmar">Confirmar</button></div>
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
  $("#rcConfirmar").textContent = total > 0 ? `Confirmar · ${num(total)} un` : "Confirmar";
}

// Endereçar (por produto): lê o QR da doca; tudo o que está na lista entra nela
function desenharEnderecar() {
  $("#rcPasso").textContent = "Endereçar · leia o QR da doca";
  $("#rcInput").placeholder = "Bipe o QR da doca ou digite o ID";
  $("#rcRes").innerHTML = `${htmlDosItens("Vai para a doca", listaDaNota().itens, null)}
    <p class="muted rc-dica">Bipe o QR da doca onde a mercadoria foi descarregada, ou digite o ID impresso na etiqueta. Os produtos da lista entram nela.</p>
    <button type="button" class="btn ghost" data-rcvoltarconf>Voltar a conferir</button>`;
  setTimeout(() => $("#rcInput").focus(), 50);
}

// ---------- por volume (v80) ----------
// os volumes da nota: os montando neste aparelho (Gerado / Montando) e os já endereçados
function desenharVolumes(nota) {
  $("#rcPasso").textContent = "2 · Bipe ou toque no volume";
  $("#rcInput").placeholder = "Bipe a etiqueta do volume";
  const montando = volumesMontando(nota.id), enderecados = volumesEnderecados();
  const linha = (v, estado, cor, detalhe) => `<button class="line" data-rcvol="${esc(v.codigo)}"><span class="line-desc"><b>${esc(v.codigo)}</b> · ${esc(tipoDoVolume(v.tipo))}
    <small>${detalhe}</small></span>${pilula(cor, estado)}</button>`;
  const somaDe = (v) => `${v.itens.length} produto(s) · ${num(v.itens.reduce((t, i) => t + i.qtd, 0))} un`;
  const linhas = [
    ...montando.map((v) => (v.itens.length ? linha(v, "Montando", "aberta", somaDe(v)) : linha(v, "Gerado", "aguardando", "vazio"))),
    ...enderecados.map((v) => linha(v, v.aCaminho ? "Enviando" : "Endereçado", "conferida", `${somaDe(v)} · ${esc(enderecoPorId(db, v.docaId)?.codigo || "doca")}`)),
  ];
  $("#rcRes").innerHTML = `${seletorDeModo()}
    <p class="es-h">Volumes da nota</p><div class="es-lista">${linhas.join("") || `<p class="empty">Nenhum volume. Toque em "+ Volume" para criar e imprimir as etiquetas.</p>`}</div>
    ${htmlDosProdutosDaNota(nota)}`;
}

// criar volumes: o tipo e quantos (as etiquetas saem na hora)
function desenharCriarVolumes() {
  $("#rcPasso").textContent = "Criar volumes";
  $("#rcRes").innerHTML = `<form id="rcVolForm" class="es-form">
      <div class="field"><span>Tipo</span><div class="rc-seg">${Object.entries(TIPOS_DE_VOLUME).map(([v, t], i) =>
        `<label class="${i ? "" : "on"}"><input type="radio" name="tipo" value="${v}" ${i ? "" : "checked"}>${t}</label>`).join("")}</div></div>
      <label class="field"><span>Quantos volumes?</span><input name="quantos" type="number" inputmode="numeric" min="1" max="${MAXIMO_VOLUMES_DE_UMA_VEZ}" value="1" required></label>
      <div class="es-duo"><button type="button" class="btn ghost" data-rcfecharcriar>Cancelar</button><button class="btn primary">Criar e imprimir</button></div>
    </form>`;
  setTimeout(() => $("#rcVolForm")?.quantos.select(), 50);
}

// o volume aberto: montando (bipa os produtos) ou já endereçado (só consulta e reimpressão)
function desenharVolume() {
  const montando = volumeMontando(conf.volume);
  if (montando) {
    $("#rcPasso").textContent = `${conf.volume} · bipe o produto`;
    $("#rcInput").placeholder = "Bipe o produto ou digite o código";
    $("#rcRes").innerHTML = `<div class="rc-nota rc-conferindo"><span>${esc(tipoDoVolume(montando.tipo))}</span><b>${esc(montando.codigo)}</b></div>
      ${montando.itens.length ? htmlDosItens("Produtos no volume", montando.itens, "data-rctirarvol") : `<p class="empty">Bipe os produtos que estão neste volume.</p>`}`;
    return;
  }
  const v = volumesEnderecados().find((x) => x.codigo === conf.volume);
  $("#rcPasso").textContent = `${conf.volume} · endereçado`;
  $("#rcRes").innerHTML = `<div class="rc-nota rc-conferindo"><span>${esc(tipoDoVolume(v.tipo))} · ${v.aCaminho ? "enviando" : "endereçado"}</span><b>${esc(v.codigo)}</b>
      <small>${esc(enderecoPorId(db, v.docaId)?.codigo || "")}</small></div>
    ${htmlDosItens("Produtos no volume", v.itens, null)}
    <p class="muted rc-dica">${MSG_VOLUME_FECHADO}</p>`;
}

// Endereçar volume: lê o QR da doca; o volume inteiro entra nela
function desenharEnderecarVolume() {
  const v = volumeMontando(conf.volume);
  $("#rcPasso").textContent = `${conf.volume} · leia o QR da doca`;
  $("#rcInput").placeholder = "Bipe o QR da doca ou digite o ID";
  $("#rcRes").innerHTML = `${htmlDosItens(`Vai para a doca · ${esc(tipoDoVolume(v.tipo))} inteiro`, v.itens, null)}
    <p class="muted rc-dica">Bipe o QR da doca onde o volume foi descarregado. Depois de endereçado, o volume fecha: não recebe mais produtos.</p>
    <button type="button" class="btn ghost" data-rcvoltarconf>Voltar ao volume</button>`;
  setTimeout(() => $("#rcInput").focus(), 50);
}

// abre o volume bipado ou tocado (montando neste aparelho ou já endereçado)
function abrirVolume(lido) {
  const codigo = String(lido).trim().toUpperCase();
  const montando = volumeMontando(codigo);
  if (montando && montando.notaId !== conf.notaId) return msg($("#rcMsg"), "ESTE VOLUME É DE OUTRA NOTA.", "err");
  if (!montando && !volumesEnderecados().some((v) => v.codigo === codigo)) return msg($("#rcMsg"), MSG_VOLUME_NAO_ENCONTRADO, "err");
  conf.volume = codigo;
  msg($("#rcMsg"), "");
  desenharConferencia();
}

// imprime as etiquetas dos volumes (80 × 60 mm, uma por página)
function imprimirVolumes(volumes) {
  const nota = notaPorId(db, conf.notaId);
  $("#printArea").innerHTML = volumes.map((v) => etiquetaVolumeDaNotaHtml(v, nota, tipoDoVolume(v.tipo))).join("");
  window.print();
}

// lê a doca e endereça o volume inteiro. Com servidor entra na fila (vai quando houver rede); recusado, ele
// volta a "montando" neste aparelho (js/dados/recepcao.js).
function lerDocaDoVolume(endereco) {
  const v = volumeMontando(conf.volume);
  if (!v) return;
  const dados = { notaId: conf.notaId, codigo: v.codigo, tipo: v.tipo, docaId: endereco?.id, itens: v.itens };
  const erro = validarDoca(endereco, notaPorId(db, conf.notaId));
  if (erro) return msg($("#rcMsg"), erro, "err");
  const r = servidor ? enderecarVolumeNaFila(servidor.sess, dados) : enderecarVolume(dados);
  if (!r.ok) return msg($("#rcMsg"), r.msg, "err");
  tirarVolumes(v.codigo);
  servidor?.pedirEnvio();
  db = lerDados();
  Object.assign(conf, { enderecando: false, volume: null });
  desenharConferencia();
  msg($("#rcMsg"), `${v.codigo} (${tipoDoVolume(v.tipo).toLowerCase()}) na ${endereco.codigo}`, "ok");
  $("#rcInput").focus();
}

// ---------- leitura ----------
$("#rcForm").addEventListener("submit", (e) => {
  e.preventDefault();
  db = lerDados();
  const lido = $("#rcInput").value.trim(); if (!lido) return;
  $("#rcInput").value = "";
  if (!conf.notaId) return escolherNota(notaPorNumero(db, lido));
  if (porVolume()) {
    if (!conf.volume) return abrirVolume(lido);
    if (conf.enderecando) return lerDocaDoVolume(acharEndereco(db.enderecos, lido));
    if (!volumeMontando(conf.volume)) return msg($("#rcMsg"), MSG_VOLUME_FECHADO, "err");
  } else if (conf.enderecando) return lerDoca(acharEndereco(db.enderecos, lido));
  const achado = acharPorCodigoLido(db.produtos, db.embalagens, lido);
  if (!achado) return msg($("#rcMsg"), "Produto não encontrado.", "err");
  escolherProduto(achado.produto.codigo, achado.embalagem);
});

function escolherNota(nota) {
  if (!nota) return msg($("#rcMsg"), "Nota não encontrada.", "err");
  if (nota.finalizada) return msg($("#rcMsg"), MSG_NOTA_FINALIZADA, "err");
  conf.notaId = nota.id;
  msg($("#rcMsg"), `${rotuloDaNota(nota)} aberta`, "ok");
  desenharConferencia();
}

function escolherProduto(codigo, embalagem) {
  const nota = notaPorId(db, conf.notaId);
  if (!nota.itens.some((i) => i.produto === codigo)) return msg($("#rcMsg"), MSG_PRODUTO_FORA_DA_NOTA, "err");
  if (pendenteDeConferir(nota, codigo, conferenciasComTudo()) <= 0) return msg($("#rcMsg"), "PRODUTO JÁ CONFERIDO POR COMPLETO NESTA NOTA.", "err");
  conf.produto = codigo; conf.embalagem = embalagem;
  msg($("#rcMsg"), "Produto identificado", "ok");
  desenharConferencia();
}

// lê a doca (por produto): cada produto da lista vira uma confirmação (o saldo entra na doca). Com servidor, cada uma
// entra na fila e vai quando houver rede. Um produto que não passa (ex.: outro coletor conferiu antes) fica na lista.
function lerDoca(endereco) {
  const erro = validarDoca(endereco, notaPorId(db, conf.notaId));
  if (erro) return msg($("#rcMsg"), erro, "err");
  const lista = listaDaNota();
  const entraram = [], recusas = [];
  for (const item of lista.itens) {
    const dados = { notaId: conf.notaId, produto: item.produto, qtd: item.qtd, volumes: 0, docaId: endereco.id };
    const r = servidor ? conferirNaFila(servidor.sess, dados) : conferir(dados);
    if (r.ok) entraram.push(item.id); else recusas.push(`${item.produto}: ${r.msg}`);
  }
  tirarDaLista(entraram);
  if (entraram.length) servidor?.pedirEnvio();
  db = lerDados();
  conf.enderecando = false;
  desenharConferencia();
  if (recusas.length) return msg($("#rcMsg"), `${entraram.length} produto(s) na ${endereco.codigo}. FICARAM NA LISTA: ${recusas.join(" · ")}`, "err");
  msg($("#rcMsg"), `${entraram.length} produto(s) na ${endereco.codigo}`, "ok");
  $("#rcInput").focus();
}

// ---------- toques na área da conferência ----------
$("#rcRes").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  db = lerDados();
  if (b.dataset.nota) return escolherNota(notaPorId(db, +b.dataset.nota));
  if (b.dataset.rcmodo) { Object.assign(conf, { modo: b.dataset.rcmodo, volume: null, enderecando: false }); msg($("#rcMsg"), ""); desenharConferencia(); return $("#rcInput").focus(); }
  if (b.dataset.rccriar !== undefined) { conf.criando = true; msg($("#rcMsg"), ""); return desenharConferencia(); }
  if (b.dataset.rcfecharcriar !== undefined) { conf.criando = false; desenharConferencia(); return $("#rcInput").focus(); }
  if (b.dataset.rcvol) return abrirVolume(b.dataset.rcvol);
  if (b.dataset.rctirar) { tirarDaLista(b.dataset.rctirar); msg($("#rcMsg"), "Tirado da lista"); desenharConferencia(); return $("#rcInput").focus(); }
  if (b.dataset.rctirarvol) { tirarDoVolume(conf.volume, b.dataset.rctirarvol); msg($("#rcMsg"), "Tirado do volume"); desenharConferencia(); return $("#rcInput").focus(); }
  if (b.dataset.rcvoltarconf !== undefined) { conf.enderecando = false; msg($("#rcMsg"), ""); desenharConferencia(); return $("#rcInput").focus(); }
  if (b.dataset.rccancelar !== undefined) { limparProduto(); msg($("#rcMsg"), ""); desenharConferencia(); $("#rcInput").focus(); }
});
$("#rcRes").addEventListener("input", (e) => { if (e.target.form?.id === "rcQtdForm") atualizarTotal(); });
// o tipo do volume: marca a opção escolhida
$("#rcRes").addEventListener("change", (e) => {
  if (e.target.name !== "tipo") return;
  $$("#rcVolForm .rc-seg label").forEach((l) => l.classList.toggle("on", l.contains(e.target)));
});
$("#rcRes").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  db = lerDados();
  // criar volumes: grava neste aparelho e imprime as etiquetas
  if (f.id === "rcVolForm") {
    const tipo = f.tipo.value, quantos = Number(f.quantos.value);
    const erro = validarCriacaoDeVolumes(tipo, quantos);
    if (erro) return msg($("#rcMsg"), erro, "err");
    const novos = criarVolumes(conf.notaId, tipo, quantos);
    if (!novos) return msg($("#rcMsg"), "MEMÓRIA DO APARELHO CHEIA: OS VOLUMES NÃO FORAM CRIADOS.", "err");
    conf.criando = false;
    desenharConferencia();
    msg($("#rcMsg"), `${novos.length} volume(s): ${novos.map((v) => v.codigo).join(", ")}`, "ok");
    imprimirVolumes(novos);
    return $("#rcInput").focus();
  }
  // "Confirmar" a quantidade: valida (sem passar do pendente da nota, contando a lista e os volumes) e põe na
  // lista (por produto) ou no volume aberto (por volume)
  const qtd = quantidadeEmUnidades(caixaBipada(), f.qtd.value || 0);
  const erro = validarConferencia(notaPorId(db, conf.notaId), { produto: conf.produto, qtd, volumes: 0 }, conferenciasComTudo());
  if (erro) return msg($("#rcMsg"), erro, "err");
  const noVolume = porVolume() && conf.volume;
  const gravou = noVolume ? vincular(conf.volume, conf.produto, qtd) : porNaLista(conf.notaId, conf.produto, qtd);
  if (!gravou) return msg($("#rcMsg"), "MEMÓRIA DO APARELHO CHEIA: O PRODUTO NÃO ENTROU.", "err");
  msg($("#rcMsg"), `+${num(qtd)} ${conf.produto} ${noVolume ? "no volume" : "na lista"}`, "ok");
  limparProduto();
  desenharConferencia();
  $("#rcInput").focus();
});

// ---------- botões de baixo ----------
$("#rcEnderecar").addEventListener("click", () => {
  db = lerDados();
  if (!listaDaNota().itens.length) return;
  conf.enderecando = true; msg($("#rcMsg"), "");
  desenharConferencia();
});
$("#rcEnderecarVol").addEventListener("click", () => {
  if (!volumeMontando(conf.volume)?.itens.length) return msg($("#rcMsg"), MSG_VOLUME_VAZIO, "err");
  conf.enderecando = true; msg($("#rcMsg"), "");
  desenharConferencia();
});
$("#rcImprimir").addEventListener("click", () => {
  db = lerDados();
  const v = volumeMontando(conf.volume) || volumesEnderecados().find((x) => x.codigo === conf.volume);
  if (v) imprimirVolumes([v]);
});
$("#rcTrocar").addEventListener("click", () => {
  if (listaDaNota().itens.length) return msg($("#rcMsg"), MSG_LISTA_PENDENTE, "err");
  iniciarConferencia(); $("#rcInput").focus();
});
$("#rcFinalizar").addEventListener("click", () => {
  db = lerDados();
  if (listaDaNota().itens.length) return msg($("#rcMsg"), MSG_LISTA_PENDENTE, "err");
  const nota = notaPorId(db, conf.notaId);
  const montando = volumesMontando(nota.id);
  if (montando.some((v) => v.itens.length)) return msg($("#rcMsg"), MSG_VOLUMES_MONTANDO, "err");
  const faltas = resumoDaNota(nota, db.conferencias).filter((i) => i.conferido < i.qtdNota);
  const aviso = faltas.length ? "A NOTA SERÁ FINALIZADA COM DIVERGÊNCIA E NÃO PODERÁ SER REABERTA." : "DESEJA FINALIZAR A NOTA? ELA NÃO PODERÁ SER REABERTA.";
  const vazios = montando.length ? `<br>${montando.length} volume(s) vazio(s) será(ão) descartado(s): ${montando.map((v) => esc(v.codigo)).join(", ")}` : "";
  const sub = (faltas.map((i) => `${esc(i.produto)}: faltam ${num(-i.divergencia)}`).join("<br>") || `${esc(rotuloDaNota(nota))} · tudo conferido`) + vazios;
  confirmar("Finalizar nota", aviso, sub, () => {
    if (servidor) { finalizarNaFila(servidor.sess, nota.id); servidor.pedirEnvio(); } else finalizarNota(nota.id);
    descartarVolumesDaNota(nota.id);
    toast(`${rotuloDaNota(nota)} finalizada` + (faltas.length ? " com divergência" : ""));
    db = lerDados(); iniciarConferencia();
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
  const erro = validarDocaDeArmazenamento(endereco);
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
  db = lerDados();
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
  db = lerDados();
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
    <span class="line-desc"><b>${esc(rotuloDaNota(n))}</b> · ${esc(n.fornecedor.nome)}<small>${diaCurto(n.data)} · ${esc(n.tipo)}</small><span class="rc-pills">${pilulasDaNota(n)}</span></span>
  </button>`).join("") || `<p class="empty">Nenhuma nota encontrada.</p>`}</div>`;
}

function desenharDetalheDaNota(nota) {
  $("#rqPasso").textContent = rotuloDaNota(nota);
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
  db = lerDados(); consulta.notaId = +b.dataset.rqnota; desenharConsulta();
});
