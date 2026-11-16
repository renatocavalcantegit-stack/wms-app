// WMS Beach Bike — regras de produto e de separação.
import { compararEnderecos } from "./enderecos.js";

// acha o produto pelo código lido (EAN ou SKU), ignorando espaços e maiúsculas/minúsculas
export const acharProduto = (catalogo, codigo) => {
  const c = String(codigo).trim().toUpperCase();
  return catalogo.find((p) => p.ean === c || p.sku.toUpperCase() === c) || null;
};

// rota de separação: ordena os itens do pedido pelo endereço (rua > prédio > andar > apartamento)
// compara os números como números ("P9" vem antes de "P10")
export const routeSort = (o) => {
  o.itens.sort((a, b) => compararEnderecos(a.end, b.end));
  return o;
};
