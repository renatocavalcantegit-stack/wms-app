// WMS Beach Bike — código da etiqueta de volume.
// A Conferência imprime o QR (qrText) e o Embarque lê o QR ou o código digitado (parseVolume).

// texto só com caracteres ASCII imprimíveis (o QR e a impressora térmica não lidam bem com acentos)
export const ascii = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "");

// conteúdo do QR: pedido | volume/total | cliente | cidade-UF (ex.: "PV-10404|1/3|TRILHA LIVRE BIKE SHOP|PETROLINA-PE")
export const qrText = (o, v, n) => `${o.id}|${v}/${n}|${ascii(o.cliente).toUpperCase()}|${ascii(String(o.cidade).replace(/\s*·\s*/, "-")).toUpperCase()}`;

// lê o código de uma etiqueta de volume: QR "PV-10404|1/3|..." ou digitado "10404 1", "PV-10404/1"
export const parseVolume = (raw) => {
  const s = String(raw).trim().toUpperCase();
  const m = s.match(/^(?:PV-?)?(\d{3,})\s*[|/\-\s.]\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/);
  return m ? { id: "PV-" + m[1], vol: +m[2], total: m[3] ? +m[3] : null } : null;
};
