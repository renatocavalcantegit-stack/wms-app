// Etiqueta de produto: QR Code no rolo de 90 × 20 mm com 3 etiquetas por linha.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conteudoDoQr, linhasDoRolo, etiquetasPorLinha, ETIQUETAS_POR_LINHA } from "../compartilhado/regras/etiqueta-produto.js";

const produto = { codigo: "BK-29-ALU-18", descricao: "Bicicleta Aro 29 Alumínio 21v Preta" };

test("QR: leva o código de barras da embalagem; sem ele, o código interno", () => {
  assert.equal(conteudoDoQr(produto, { descricao: "Unidade", codigo: "7891000100011" }), "7891000100011");
  assert.equal(conteudoDoQr(produto, { descricao: "Caixa com 12", codigo: "" }), "BK-29-ALU-18");
  assert.equal(conteudoDoQr(produto, null), "BK-29-ALU-18");
});

test("rolo: 3 etiquetas por linha; a última linha pode sair incompleta", () => {
  assert.equal(ETIQUETAS_POR_LINHA, 3);
  assert.equal(linhasDoRolo(1), 1);
  assert.equal(linhasDoRolo(3), 1);
  assert.equal(linhasDoRolo(7), 3);
  assert.deepEqual(etiquetasPorLinha(7), [3, 3, 1]);
  assert.deepEqual(etiquetasPorLinha(6), [3, 3]);
  assert.deepEqual(etiquetasPorLinha(0), []);
});
