// Observação dos volumes: informada na conferência, gravada no pedido do Sankhya e mostrada no embarque.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WMS } from "./codigo-atual.js";

const { obsTotal, obsLinhas, obsErp, obsResumo } = WMS;

test("obsTotal: soma os volumes de todos os tipos", () => {
  assert.equal(obsTotal({ tipos: { caixa: 2, pneuaro: 1 } }), 3);
  assert.equal(obsTotal({ tipos: {} }), 0);
  assert.equal(obsTotal(null), 0);
});

test("obsLinhas: segue a ordem do cadastro de tipos, não a ordem em que foram informados", () => {
  const esperado = [[2, "Caixa", "CX"], [1, "Pneu + aro", "PNEU+ARO"]];
  assert.deepEqual(obsLinhas({ tipos: { caixa: 2, pneuaro: 1 } }), esperado);
  assert.deepEqual(obsLinhas({ tipos: { pneuaro: 1, caixa: 2 } }), esperado);
});

test("obsLinhas: tipos com zero ficam de fora", () => {
  assert.deepEqual(obsLinhas({ tipos: { caixa: 0, sacola: 1 } }), [[1, "Sacola", "SAC"]]);
});

test("obsLinhas: o tipo Outro usa o nome digitado; sem nome, vira Outro / OUTRO", () => {
  assert.deepEqual(obsLinhas({ tipos: { outro: 1 }, outro: "Tubo de garfo" }), [[1, "Tubo de garfo", "TUBO DE GARFO"]]);
  assert.deepEqual(obsLinhas({ tipos: { outro: 1 }, outro: "" }), [[1, "Outro", "OUTRO"]]);
});

test("obsErp: texto [WMS] que vai para a observação do pedido no Sankhya", () => {
  assert.equal(obsErp({ tipos: { caixa: 2, pneuaro: 1 }, outro: "", atencao: "" }), "[WMS] VOLUMES: 2 CX + 1 PNEU+ARO = 3 VOL.");
  assert.equal(obsErp({ tipos: { bike: 1, caixa: 1, outro: 1 }, outro: "Tubo de garfo", atencao: "" }),
    "[WMS] VOLUMES: 1 CX + 1 BIC + 1 TUBO DE GARFO = 3 VOL.");
});

test("obsErp: a atenção vai em maiúsculas e sem acento", () => {
  assert.equal(obsErp({ tipos: { caixa: 2, pneuaro: 1 }, outro: "", atencao: "Vai ter acréscimo de 1 bicicleta" }),
    "[WMS] VOLUMES: 2 CX + 1 PNEU+ARO = 3 VOL. | ATENCAO: VAI TER ACRESCIMO DE 1 BICICLETA");
});

test("obsErp: sem observação, texto vazio", () => {
  assert.equal(obsErp(null), "");
});

test("obsResumo: texto curto mostrado nas telas", () => {
  assert.equal(obsResumo({ tipos: { bike: 1, caixa: 1, outro: 1 }, outro: "Tubo de garfo" }), "1 Caixa · 1 Bicicleta · 1 Tubo de garfo");
  assert.equal(obsResumo(null), "");
});
