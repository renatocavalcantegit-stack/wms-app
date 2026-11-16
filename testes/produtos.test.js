// Catálogo: busca de produto pelo código lido e ordem de separação pelo endereço.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeSort } from "../compartilhado/regras/produtos.js";
import { find } from "../js/demo-dados.js";

test("find: acha o produto pelo EAN ou pelo SKU, ignorando espaços e maiúsculas/minúsculas", () => {
  assert.equal(find("7891000100011").sku, "BK-29-ALU-18");
  assert.equal(find(" bk-29-alu-18 ").ean, "7891000100011");
  assert.equal(find("QD-29-ALU-M").desc, "Quadro Aro 29 Alumínio Tam. 17"); // componente de montagem
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
