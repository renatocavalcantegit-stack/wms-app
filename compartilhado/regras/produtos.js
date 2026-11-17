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

// CONFERÊNCIA POR CHECKOUT: o padrão de todo produto. Cada bipe conta 1 unidade e não se informa quantidade,
// para garantir que cada peça passou pela mão do conferente. O gestor de estoque desliga só em produtos
// sem código de barras (granel, ex.: parafuso): aí o conferente lê o código e digita a quantidade.
export const MSG_CHECKOUT = "PRODUTO COM CHECKOUT: BIPE CADA UNIDADE.";
// produto sem a informação (ou não cadastrado no estoque) é tratado como checkout: o lado seguro
export const exigeCheckout = (produto) => !produto || produto.checkout !== false;
// a quantidade de uma leitura é aceita? (null = sim; texto = motivo da recusa)
export const validarQuantidadeLida = (checkout, qtd) => (checkout && qtd !== 1 ? MSG_CHECKOUT : null);
