// WMS Beach Bike — pedaços de tela usados pelas telas do coletor do Estoquista (Cadastro e Recepção).
import { $, esc } from "./util.js";
import { openSheet, closeSheets, beep, vibrate } from "./ui-coletor.js";
import { TIPOS_ENDERECO } from "../compartilhado/regras/enderecos.js";

export const num = (n) => Number(n).toLocaleString("pt-BR");
// com servidor (v78), só a Conferência da Recepção já está no servidor; o resto vem nas próximas entregas
export const MSG_FORA_DO_SERVIDOR = "Ainda não está no servidor";
export const tipoTag = (t) => `<span class="es-tipo ${t}">${TIPOS_ENDERECO[t]}</span>`;
// 2026-11-16 → 16/11
export const diaCurto = (iso) => iso.split("-").reverse().slice(0, 2).join("/");

// mensagem embaixo do campo de leitura (verde = deu certo, vermelho = bloqueado)
export function msg(el, texto, tipo = "") {
  el.textContent = texto; el.className = "scan-msg " + tipo;
  if (tipo === "err") { beep(false); vibrate([80, 50, 80]); el.previousElementSibling?.classList.add("err"); setTimeout(() => el.previousElementSibling?.classList.remove("err"), 400); }
  if (tipo === "ok") beep(true);
}

// confirmação com a mensagem do documento ("DESEJA REALMENTE…?")
let aoConfirmar = null;
export function confirmar(titulo, mensagem, sub, fn) {
  $("#scfTitulo").textContent = titulo; $("#scfMsg").textContent = mensagem; $("#scfSub").innerHTML = sub;
  aoConfirmar = fn; openSheet("sheetConfirma");
}
$("#scfSim").addEventListener("click", () => { closeSheets(); aoConfirmar?.(); });
document.addEventListener("click", (e) => { if (e.target.closest("[data-fecharsheet]")) closeSheets(); });

// cartão do produto
export const cartaoProduto = (p, extra = "") => `<div class="product es-prod">
  <div class="product-info"><p class="product-desc">${esc(p.descricao)}</p><p class="product-meta">${esc(p.codigo)} · ${esc(p.un)}</p>${extra}</div></div>`;

// lista para escolher quando a descrição digitada casa com vários produtos
export const escolherProduto = (lista, attr) => `<p class="es-h">${lista.length} produtos encontrados</p><div class="es-lista">${lista.slice(0, 30).map((p) =>
  `<button class="line" ${attr}="${esc(p.codigo)}"><span class="line-desc">${esc(p.descricao)}<small>${esc(p.codigo)}</small></span></button>`).join("")}</div>`;
