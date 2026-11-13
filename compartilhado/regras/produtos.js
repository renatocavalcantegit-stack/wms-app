// WMS Beach Bike — regras de produto e de separação.

// acha o produto pelo código lido (EAN ou SKU), ignorando espaços e maiúsculas/minúsculas
export const acharProduto = (catalogo, codigo) => {
  const c = String(codigo).trim().toUpperCase();
  return catalogo.find((p) => p.ean === c || p.sku.toUpperCase() === c) || null;
};

// rota de separação: ordena os itens do pedido pelo endereço (rua > prédio > nível > posição)
// compara os números como números ("A-9" vem antes de "A-10")
export const routeSort = (o) => {
  o.itens.sort((a, b) => a.end.localeCompare(b.end, "pt-BR", { numeric: true }));
  return o;
};
