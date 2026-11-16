// WMS Beach Bike — desenho da etiqueta de produto (~29 × 20 mm), 3 por linha no rolo de 90 × 20 mm.
// Contém: código interno, QR Code, descrição e embalagem. As regras ficam em compartilhado/regras/etiqueta-produto.js.
import { esc } from "./util.js";
import { qrSvg } from "./qr.js";
import { conteudoDoQr, etiquetasPorLinha } from "../compartilhado/regras/etiqueta-produto.js";

// uma etiqueta; a embalagem escolhida decide o que vai no QR (e aparece embaixo da descrição)
export function etiquetaHtml(produto, embalagem) {
  return `<div class="et">
    <b class="et-cod">${esc(produto.codigo)}</b>
    <div class="et-meio">${qrSvg(conteudoDoQr(produto, embalagem), "et-qr")}
      <div class="et-txt"><span class="et-desc">${esc(produto.descricao)}</span>${embalagem ? `<b class="et-emb">${esc(embalagem.descricao)}</b>` : ""}</div>
    </div>
  </div>`;
}

// N etiquetas montadas em linhas de 3 (cada linha é uma "página" de 90 × 20 mm na impressora)
export function rolosHtml(produto, embalagem, quantidade) {
  const uma = etiquetaHtml(produto, embalagem);
  return etiquetasPorLinha(quantidade).map((n) => `<div class="et-linha">${uma.repeat(n)}</div>`).join("");
}
