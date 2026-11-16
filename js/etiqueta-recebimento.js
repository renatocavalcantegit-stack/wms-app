// WMS Beach Bike — etiqueta do volume do recebimento: 80 × 60 mm, uma por página.
// O QR leva o código do volume (único). Impressa no coletor ao confirmar a conferência;
// a reimpressão é só pelo WEB (detalhe da nota › Volumes).
import { esc } from "./util.js";
import { qrSvg } from "./qr.js";

export function etiquetaVolumeHtml(volume, nota, produto) {
  return `<div class="vr">
    <div class="vr-topo"><b class="vr-cod">${volume.codigo}</b><span class="vr-seq">${volume.seq}/${volume.total}</span></div>
    <div class="vr-meio">${qrSvg(volume.codigo, "vr-qr")}
      <div class="vr-txt">
        <small>NF</small><b class="vr-nf">${esc(nota.numero)}</b>
        <small>Fornecedor</small><span>${esc(nota.fornecedor.nome)}</span>
      </div>
    </div>
    <div class="vr-prod"><b>${esc(produto.codigo)}</b> ${esc(produto.descricao)}</div>
  </div>`;
}
