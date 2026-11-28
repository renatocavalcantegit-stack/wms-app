// WMS Beach Bike — etiqueta do volume do recebimento: 80 × 60 mm, uma por página.
// O QR leva o código do volume (único). v80: a conferência por produto não gera etiqueta; a do volume (palete ou
// caixa) sai no coletor ao criar o volume e pode ser reimpressa lá a qualquer momento.
// A da conferência por produto (v78) é reimpressa só pelo WEB (detalhe da nota › Volumes).
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

// v80: etiqueta do VOLUME da conferência por volume (palete ou caixa), impressa ao criar o volume (antes de os
// produtos entrarem). Mesmo tamanho e mesmo desenho; no lugar do produto vão o tipo e o dia.
export function etiquetaVolumeDaNotaHtml(volume, nota, tipoTexto) {
  const dia = new Date(volume.criadoEm || Date.now()).toLocaleDateString("pt-BR");
  return `<div class="vr">
    <div class="vr-topo"><b class="vr-cod">${esc(volume.codigo)}</b><span class="vr-seq">${esc(tipoTexto)}</span></div>
    <div class="vr-meio">${qrSvg(volume.codigo, "vr-qr")}
      <div class="vr-txt">
        <small>NF</small><b class="vr-nf">${esc(nota.numero)}</b>
        <small>Fornecedor</small><span>${esc(nota.fornecedor.nome)}</span>
      </div>
    </div>
    <div class="vr-prod"><b>${esc(tipoTexto.toUpperCase())}</b> · criado em ${dia}</div>
  </div>`;
}
