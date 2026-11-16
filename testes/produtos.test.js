// Catálogo: busca de produto pelo código lido e ordem de separação pelo endereço.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeSort } from "../compartilhado/regras/produtos.js";
import { find } from "../js/demo-dados.js";

test("find: acha o produto pelo EAN ou pelo código interno, ignorando espaços", () => {
  assert.equal(find("7908005911280").sku, "122");
  assert.equal(find(" 122 ").ean, "7908005911280");
  assert.equal(find("8745").desc, "CAMARA MOTO 18 90/90-18 TITAN /FAN /YBR BMK BLUE"); // segmento Moto
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
