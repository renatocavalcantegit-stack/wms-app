// WMS Beach Bike — leitura das cargas do Embarque para as outras telas.
// O Embarque (embarque.js) grava as cargas; aqui as outras camadas só consultam ou fazem ajustes pontuais.
const CHAVE = "wms-bb-emb-v2";

function lerCargas() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) || []; } catch { return []; }
}

// algum volume do pedido já foi bipado no caminhão?
export const pedidoEmCarregamento = (id) =>
  lerCargas().some((c) => c.pedidos.some((p) => p.id === id && p.lidos.length > 0));

// pedido cancelado sai da carga (só enquanto nenhum volume dele foi bipado)
export function retirarDasCargas(id) {
  const cargas = lerCargas();
  let mudou = false;
  cargas.forEach((c) => {
    const antes = c.pedidos.length;
    c.pedidos = c.pedidos.filter((p) => !(p.id === id && !p.lidos.length));
    mudou ||= c.pedidos.length !== antes;
  });
  if (mudou) localStorage.setItem(CHAVE, JSON.stringify(cargas));
}
