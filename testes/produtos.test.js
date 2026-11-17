// Catálogo: busca de produto pelo código lido e ordem de separação pelo endereço.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeSort, exigeCheckout, validarQuantidadeLida, MSG_CHECKOUT, ehCodigoDoProduto } from "../compartilhado/regras/produtos.js";
import { find } from "../js/demo-dados.js";

test("find: acha o produto pelo EAN ou pelo código interno, ignorando espaços", () => {
  assert.equal(find("7908005911280").sku, "122");
  assert.equal(find(" 122 ").ean, "7908005911280");
  assert.equal(find("8745").desc, "CAMARA MOTO 18 90/90-18 TITAN /FAN /YBR BMK BLUE"); // segmento Moto
});

test("find: produto com dois códigos de barras é achado pelos dois; vale para todo o estoque real", () => {
  assert.equal(find("0789600800202").sku, "20");
  assert.equal(find("789600800202").sku, "20");       // o mesmo código sem o zero (UPC de 12 dígitos)
  assert.equal(find("7908106000081").sku, "74");      // segundo código de outro produto
  assert.equal(find("7896482603593").sku, "9");       // fora dos mais vendidos, mas está no estoque
  assert.equal(find("227").ean, "");                  // sem código de barras: só pelo código interno
});

test("ehCodigoDoProduto: EAN principal, os outros códigos ou o código interno", () => {
  const p = { sku: "20", ean: "0789600800202", eans: ["0789600800202", "789600800202"] };
  assert.equal(ehCodigoDoProduto(p, "789600800202"), true);
  assert.equal(ehCodigoDoProduto(p, "20"), true);
  assert.equal(ehCodigoDoProduto(p, "21"), false);
  assert.equal(ehCodigoDoProduto({ sku: "227", ean: "" }, ""), false); // leitura vazia nunca confere
});

test("find: código desconhecido devolve null", () => {
  assert.equal(find("999"), null);
});

test("routeSort: ordena os itens pelo endereço (rua > prédio > andar > apartamento), comparando números", () => {
  const pedido = { itens: [{ end: "R3002-P1-A100-AP101" }, { end: "R3001-P10-A100-AP101" }, { end: "R3001-P9-A100-AP101" }, { end: "R3001-P1-A100-AP105" }, { end: "R3001-P1-A100-AP102" }] };
  const ordenado = routeSort(pedido);
  assert.equal(ordenado, pedido); // ordena o próprio pedido
  assert.deepEqual(pedido.itens.map((i) => i.end), ["R3001-P1-A100-AP102", "R3001-P1-A100-AP105", "R3001-P9-A100-AP101", "R3001-P10-A100-AP101", "R3002-P1-A100-AP101"]);
});

test("checkout: é o padrão; só o produto marcado como granel aceita quantidade", () => {
  assert.equal(exigeCheckout({ codigo: "122" }), true);          // produto novo, sem o campo: checkout
  assert.equal(exigeCheckout(null), true);                       // não cadastrado no estoque: lado seguro
  assert.equal(exigeCheckout({ checkout: false }), false);
  assert.equal(validarQuantidadeLida(true, 1), null);
  assert.equal(validarQuantidadeLida(true, 5), MSG_CHECKOUT);    // F4 / 5*código recusados
  assert.equal(validarQuantidadeLida(false, 40), null);
});
