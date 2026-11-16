// WMS Beach Bike — desenho do QR Code em SVG (vetorial: nítido em qualquer impressora).
// Usa a biblioteca vendor/qrcode.js, que a página carrega antes (window.qrcode).
import { ascii } from "../compartilhado/regras/etiqueta-volume.js";

export function qrSvg(texto, classe = "") {
  const qr = window.qrcode(0, "M");
  qr.addData(ascii(texto));
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg class="${classe}" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;
}
