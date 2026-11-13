// Catálogo: busca de produto pelo código lido e ordem de separação pelo endereço.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WMS } from "./codigo-atual.js";

const { find, routeSort } = WMS;

test("find: acha o produto pelo EAN ou pelo SKU, ignorando espaços e maiúsculas/minúsculas", () => {
  assert.equal(find("7891000100011").sku, "BK-29-ALU-18");
  assert.equal(find(" bk-29-alu-18 ").ean, "7891000100011");
  assert.equal(find("QD-29-ALU-M").desc, "Quadro Aro 29 Alumínio Tam. 17"); // componente de montagem
});

test("find: código desconhecido devolve null", () => {
  assert.equal(find("999"), null);
});

test("routeSort: ordena os itens pelo endereço (rua > prédio > nível > posição), comparando números", () => {
  const pedido = { itens: [{ end: "B-01-1-01" }, { end: "A-10-1-01" }, { end: "A-9-1-01" }, { end: "A-01-1-05" }, { end: "A-01-1-02" }] };
  const ordenado = routeSort(pedido);
  assert.equal(ordenado, pedido); // ordena o próprio pedido
  assert.deepEqual(pedido.itens.map((i) => i.end), ["A-01-1-02", "A-01-1-05", "A-9-1-01", "A-10-1-01", "B-01-1-01"]);
});
