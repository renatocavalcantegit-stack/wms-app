// Quantidade quebrada: ler o que foi digitado, validar, somar sem erro de vírgula e mostrar em pt-BR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arredondarQtd, somarQtd, lerQuantidade, quantidadeValida, formatarQtd } from "../compartilhado/regras/quantidade.js";

test("lê com vírgula ou ponto; número passa direto", () => {
  assert.equal(lerQuantidade("101,5"), 101.5);
  assert.equal(lerQuantidade("101.5"), 101.5);
  assert.equal(lerQuantidade(" 12 "), 12);
  assert.equal(lerQuantidade(",5"), 0.5);
  assert.equal(lerQuantidade(20.935), 20.935);
});

test("vazio, texto e dois separadores viram NaN", () => {
  for (const v of ["", "  ", null, undefined, "abc", "1.234,5", "1,2,3", "12a"]) assert.ok(Number.isNaN(lerQuantidade(v)), String(v));
});

test("válida: número, no mínimo pedido e até 3 casas", () => {
  assert.equal(quantidadeValida(0), true);
  assert.equal(quantidadeValida(101.5), true);
  assert.equal(quantidadeValida(20.935), true);
  assert.equal(quantidadeValida(1.2345), false);
  assert.equal(quantidadeValida(-0.5), false);
  assert.equal(quantidadeValida(0, 0.001), false);
  assert.equal(quantidadeValida(NaN), false);
});

test("soma sem o erro do 0,1 + 0,2", () => {
  assert.equal(0.1 + 0.2 === 0.3, false); // o problema
  assert.equal(somarQtd([0.1, 0.2]), 0.3);
  assert.equal(somarQtd([{ q: 101.5 }, { q: 0.25 }], (x) => x.q), 101.75);
  assert.equal(arredondarQtd(10 - 9.9), 0.1);
});

test("mostra no formato brasileiro, sem ponto de milhar", () => {
  assert.equal(formatarQtd(101.5), "101,5");
  assert.equal(formatarQtd(12), "12");
  assert.equal(formatarQtd(20.935), "20,935");
  assert.equal(formatarQtd(1500), "1500");
});
