// WMS Beach Bike — etiqueta de produto 90 × 20 mm (horizontal), impressa a partir da Consulta de produto.
// Contém só: código interno, descrição e código de barras (regra do documento do estoquista).
import { esc } from "./util.js";
import { barrasDoCodigo, formatoDoCodigo } from "../compartilhado/regras/codigo-barras.js";

// barras em SVG: cada "1" vira um retângulo preto; barras vizinhas são juntadas num retângulo só
export function barrasSvg(codigo) {
  const b = barrasDoCodigo(codigo);
  let d = "";
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== "1") continue;
    let w = 1;
    while (b[i + w] === "1") w++;
    d += `M${i} 0h${w}v1h-${w}z`;
    i += w - 1;
  }
  // 10 módulos de margem branca de cada lado (zona de silêncio que o leitor precisa)
  return `<svg class="et-barras" viewBox="-10 0 ${b.length + 20} 1" preserveAspectRatio="none" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;
}

// uma etiqueta: o código de barras usado é o da embalagem escolhida; sem código, vai o código interno
export function etiquetaHtml(produto, codigoBarras) {
  const codigo = codigoBarras || produto.codigo;
  return `<div class="et">
    <div class="et-top"><b>${esc(produto.codigo)}</b><span>${esc(produto.descricao)}</span></div>
    ${barrasSvg(codigo)}
    <small class="et-num">${esc(codigo)} · ${formatoDoCodigo(codigo) === "EAN13" ? "EAN-13" : "Code 128"}</small>
  </div>`;
}
