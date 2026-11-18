// Etiqueta de volume 80x60 mm com QR (layout inspirado em etiquetas de marketplace)
// v51: o endereço de entrega ganhou destaque (cidade · UF, bairro, rua + número) e a faixa de baixo mostra o nome da rota.
import { ascii, qrText, enderecoDaEtiqueta } from "./compartilhado/regras/etiqueta-volume.js";
import { cadastroDoCliente, nomeDaRota } from "./js/dados/clientes.js";

export const Etiqueta = (() => {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // QR como SVG (vetorial: nítido em qualquer impressora térmica)
  function qrSvg(text) {
    const qr = window.qrcode(0, "M");
    qr.addData(ascii(text));
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg class="lb-qr" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;
  }

  // conteúdo do QR (qrText): vem de compartilhado/regras/etiqueta-volume.js, lido pela própria Conferência

  function label(o, v, n) {
    const e = enderecoDaEtiqueta(o, cadastroDoCliente(o), nomeDaRota);
    const c = o.conf || {};
    const dt = new Date(c.fim || Date.now());
    const data = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `<div class="label">
      <div class="lb-top">
        <img src="assets/logo.png" alt="" class="lb-logo">
        <div class="lb-vol"><span>VOLUME</span><b>${v}<small>/${n}</small></b></div>
      </div>
      <div class="lb-mid">
        ${qrSvg(qrText(o, v, n))}
        <div class="lb-info">
          <span class="lb-k">PEDIDO</span>
          <b class="lb-id">${o.id}</b>
          <span class="lb-k">DESTINATÁRIO</span>
          <b class="lb-cli">${esc(o.cliente)}</b>
          <div class="lb-end">
            <b class="lb-end-cid">${esc(e.cidade)}</b>
            ${e.bairro ? `<span class="lb-end-bai">${esc(e.bairro)}</span>` : ""}
            ${e.rua ? `<span class="lb-end-rua"><span>${esc(e.rua)},</span><b>${esc(e.numero)}</b></span>` : ""}
          </div>
        </div>
      </div>
      <div class="lb-bot">
        <div class="lb-route${e.rota.length > 10 ? " lb-route-longa" : ""}"><small>ROTA</small><b>${esc(e.rota)}</b></div>
        <div class="lb-foot">
          <span>${data} ${hora}</span>
          <span>Conf.: ${esc(c.conferente || "—")} · Posto ${esc(c.posto || "01")}</span>
        </div>
      </div>
    </div>`;
  }

  function render(o) {
    const n = Math.max(1, (o.conf && o.conf.volumes) || 1);
    return Array.from({ length: n }, (_, k) => label(o, k + 1, n)).join("");
  }

  // imprime usando a área #printArea (CSS @page 80x60mm)
  function print(o, after) {
    const area = document.getElementById("printArea");
    area.innerHTML = render(o);
    const done = () => { window.removeEventListener("afterprint", done); area.innerHTML = ""; after && after(); };
    window.addEventListener("afterprint", done);
    // aguarda o logo carregar antes de abrir o diálogo
    const imgs = [...area.querySelectorAll("img")].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r))));
    Promise.all(imgs).then(() => setTimeout(() => window.print(), 50));
  }

  return { render, print, qrText };
})();
