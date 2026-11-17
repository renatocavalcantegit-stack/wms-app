// WMS Beach Bike — Gestão de Expedição (WEB), aba OCORRÊNCIAS: corte de item e cancelamento do pedido.
// O Sankhya não reenvia o pedido alterado: o gestor recebe o aviso e registra aqui, com o motivo e a referência.
// Diferente dos quadros ao lado (que ainda são simulação), esta aba trabalha com os pedidos de verdade da
// Separação, da Conferência e do Embarque deste aparelho.
// O que acontece com a mercadoria fica nas regras (compartilhado/regras/ocorrencias.js) e nos dados (js/dados/ocorrencias.js).
import { esc } from "./js/util.js";
import { abrirPedido, registrarOcorrencia, lerOcorrencias } from "./js/dados/ocorrencias.js";
import { ETAPAS_PEDIDO, MOTIVOS_OCORRENCIA } from "./compartilhado/regras/ocorrencias.js";

// estado da aba: pedido aberto, mensagem e se o gestor está confirmando um cancelamento
const estado = { pedido: null, msg: "", erro: false, confirmarCancelamento: false };
let ctx = null; // { setor, usuario, toast, container }

const hora = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// o que vai acontecer com a mercadoria, conforme a etapa (o gestor lê antes de confirmar)
const EFEITO = {
  "aguardando-separacao": "Ninguém separou ainda: a quantidade só diminui. Cancelado, o pedido sai da lista do separador.",
  separacao: "O que ainda não foi separado só diminui (o separador pula). O que já está na caixa e sobrou volta ao estoque pela conferência.",
  "aguardando-conferencia": "O que sobrou na caixa o conferente tira (bipando) e leva para a doca de devolução.",
  conferencia: "O conferente vê o aviso na hora: tira o que sobrou da caixa (bipando) e leva para a doca de devolução.",
  conferido: "O pedido volta para a fila da conferência: o conferente tira o que sobrou, refaz os volumes e reimprime as etiquetas.",
};

export function telaOcorrencias(setor, { usuario, toast }) {
  ctx = { setor, usuario, toast };
  return `<div class="oc-wrap">${conteudo()}</div>`;
}

function conteudo() {
  const p = estado.pedido;
  return `
  <div class="oc-head">
    <div><h1>Ocorrências do pedido</h1>
      <p>Cliente desistiu de um item ou do pedido? Registre aqui com a referência do Sankhya. O WMS avisa o separador e o conferente, e a mercadoria que sobrou volta ao estoque pela doca de devolução.</p></div>
  </div>
  <form class="oc-busca" data-oc-busca>
    <input name="pedido" value="${esc(p ? p.id : "")}" placeholder="Número do pedido (ex.: PV-10421)" autocomplete="off">
    <button class="btn primary">Abrir pedido</button>
  </form>
  ${estado.msg ? `<p class="oc-msg ${estado.erro ? "err" : "ok"}">${esc(estado.msg)}</p>` : ""}
  ${p ? cartaoDoPedido(p) : ""}
  ${historico()}`;
}

function cartaoDoPedido(p) {
  const pode = !p.bloqueio;
  return `<form class="oc-card" data-oc-form>
    <div class="oc-card-top">
      <div><b class="oc-id">${esc(p.id)}</b> <span class="oc-cli">${esc(p.cliente || "")}</span></div>
      <span class="oc-etapa ${p.etapa}">${ETAPAS_PEDIDO[p.etapa]}${p.reaberto && p.etapa === "aguardando-conferencia" ? " · reaberto" : ""}</span>
    </div>
    ${p.bloqueio ? `<p class="oc-msg err">${esc(p.bloqueio)}</p>` : `<p class="oc-efeito">${EFEITO[p.etapa] || ""}</p>`}
    <table class="oc-tab">
      <thead><tr><th>Código</th><th>Descrição</th><th class="r">Cliente quer</th><th class="r">Na caixa</th><th class="r">A devolver</th><th class="r">Nova quantidade</th></tr></thead>
      <tbody>${p.itens.map((i) => `<tr>
        <td class="mono">${esc(i.sku)}</td><td>${esc(i.desc)}</td><td class="r">${i.qtd}</td><td class="r">${i.mantido}</td>
        <td class="r ${i.devolver ? "oc-dev" : ""}">${i.devolver || "—"}</td>
        <td class="r">${pode && i.qtd > 0 ? `<input class="oc-qtd" name="q-${esc(i.sku)}" type="number" min="0" max="${i.qtd - 1}" step="1" inputmode="numeric" placeholder="${i.qtd}">` : ""}</td>
      </tr>`).join("")}</tbody>
    </table>
    ${pode ? `<div class="oc-campos">
      <label>Motivo<select name="motivo"><option value="">Escolha…</option>${Object.entries(MOTIVOS_OCORRENCIA).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
      <label>Referência no Sankhya<input name="referencia" placeholder="Nº da alteração ou do cancelamento" autocomplete="off"></label>
    </div>
    <div class="oc-acoes">
      ${estado.confirmarCancelamento
        ? `<span class="oc-pergunta">Cancelar o pedido ${esc(p.id)} inteiro?</span>
           <button type="button" class="btn ghost" data-oc-voltar>Voltar</button>
           <button type="button" class="btn danger" data-oc-cancelar-sim>Sim, cancelar o pedido</button>`
        : `<button type="button" class="btn ghost oc-perigo" data-oc-cancelar>Cancelar pedido inteiro</button>
           <button class="btn primary">Aplicar corte</button>`}
    </div>` : ""}
  </form>`;
}

function historico() {
  const lista = lerOcorrencias(ctx.setor);
  return `<h2 class="oc-h2">Ocorrências registradas</h2>
  <table class="oc-tab oc-hist">
    <thead><tr><th>Quando</th><th>Pedido</th><th>Tipo</th><th>Etapa</th><th>Itens</th><th>Motivo</th><th>Sankhya</th><th>Quem</th></tr></thead>
    <tbody>${lista.map((o) => `<tr>
      <td>${hora(o.quando)}</td><td class="mono">${esc(o.pedido)}</td><td>${o.tipo === "cancelamento" ? "Cancelamento" : "Corte"}</td>
      <td>${ETAPAS_PEDIDO[o.etapa] || ""}</td>
      <td>${o.itens.map((i) => `${esc(i.sku)}: ${i.de}→${i.para}${i.devolver ? ` (devolver ${i.devolver})` : ""}`).join("<br>")}</td>
      <td>${MOTIVOS_OCORRENCIA[o.motivo] || ""}</td><td>${esc(o.referencia)}</td><td>${esc(o.usuario || "")}</td></tr>`).join("")
      || `<tr><td colspan="8" class="oc-vazio">Nenhuma ocorrência registrada.</td></tr>`}</tbody>
  </table>`;
}

function redesenhar() {
  const w = document.querySelector(".oc-wrap");
  if (w) w.innerHTML = conteudo();
}
const avisar = (msg, erro = false) => { estado.msg = msg; estado.erro = erro; };

function abrir(id) {
  estado.confirmarCancelamento = false;
  id = String(id || "").trim();
  if (!id) { estado.pedido = null; avisar("Digite o número do pedido.", true); redesenhar(); return; }
  const p = abrirPedido(ctx.setor, id);
  if (!p) { estado.pedido = null; avisar(`Pedido ${id} não encontrado neste setor.`, true); }
  else { estado.pedido = p; avisar(""); }
  redesenhar();
}

function registrar(form, tipo) {
  const cortes = {};
  form.querySelectorAll(".oc-qtd").forEach((inp) => { if (inp.value !== "") cortes[inp.name.slice(2)] = inp.value; });
  const r = registrarOcorrencia(ctx.setor, estado.pedido.id, {
    tipo, cortes, motivo: form.motivo.value, referencia: form.referencia.value, usuario: ctx.usuario,
  });
  estado.confirmarCancelamento = false;
  if (!r.ok) { avisar(r.msg, true); redesenhar(); return; }
  estado.pedido = r.pedido;
  const devolver = r.ocorrencia.itens.reduce((t, i) => t + (i.devolver || 0), 0);
  avisar(`${tipo === "cancelamento" ? "Pedido cancelado" : "Corte registrado"}${devolver ? ` · ${devolver} un. voltam ao estoque pela conferência` : ""}.`);
  ctx.toast(tipo === "cancelamento" ? `${r.ocorrencia.pedido} cancelado` : `Corte registrado em ${r.ocorrencia.pedido}`);
  redesenhar();
}

// eventos: ligados uma vez no quadro (#board); só tratam o que está dentro da aba
export function ligarOcorrencias(board) {
  board.addEventListener("submit", (e) => {
    if (!e.target.closest(".oc-wrap")) return;
    e.preventDefault();
    if (e.target.matches("[data-oc-busca]")) return abrir(e.target.pedido.value);
    if (e.target.matches("[data-oc-form]")) return registrar(e.target, "corte");
  });
  board.addEventListener("click", (e) => {
    if (!e.target.closest(".oc-wrap")) return;
    const form = e.target.closest("[data-oc-form]");
    if (e.target.closest("[data-oc-cancelar]")) { estado.confirmarCancelamento = true; guardarCampos(form); return; }
    if (e.target.closest("[data-oc-voltar]")) { estado.confirmarCancelamento = false; guardarCampos(form); return; }
    if (e.target.closest("[data-oc-cancelar-sim]")) return registrar(form, "cancelamento");
  });
}
// ao trocar os botões de confirmação, o que já foi digitado (quantidades, motivo, referência) continua no formulário
function guardarCampos(form) {
  const valores = [...form.elements].filter((x) => x.name).map((x) => [x.name, x.value]);
  redesenhar();
  const f = document.querySelector("[data-oc-form]");
  valores.forEach(([nome, valor]) => { if (f.elements[nome]) f.elements[nome].value = valor; });
}
