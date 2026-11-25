// v77: o produto novo nasce da nota do ERP (regra cadastrosDasNotas, compartilhado/regras/recebimento.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cadastrosDasNotas, msgProdutoSemDados, avisoCodigoRepetido, notaSemCadastro } from "../compartilhado/regras/recebimento.js";

const existentes = new Set(["536"]);
const usados = new Map([["789000", "536"]]);
const contexto = { existe: (c) => existentes.has(c), donoDoCodigo: (b) => usados.get(b) || null };
const nota = (numero, itens) => ({ numero, fornecedor: { codigo: 8558, nome: "Pedal Sul" }, itens });
const cadastro = (descricao, embalagens = []) => ({ descricao, un: "un", embalagens });

test("produto que o WMS não tem: cadastra com os dados do ERP e checkout ligado; o que existe não muda", () => {
  const [r] = cadastrosDasNotas([nota("1", [
    { produto: "536", qtd: 5, cadastro: cadastro("OUTRA DESCRIÇÃO") },
    { produto: "99001", qtd: 2, cadastro: { ...cadastro("BIKE ARO 29", [{ descricao: "Unidade", codigo: "111", qtd: 1 }, { descricao: "Caixa com 2", codigo: " 112 ", qtd: 2 }]), pesoBruto: 15.2 } },
  ])], contexto);
  assert.equal(r.bloqueio, null);
  assert.deepEqual(r.avisos, []);
  assert.equal(r.produtos.length, 1);
  const p = r.produtos[0];
  assert.deepEqual([p.codigo, p.descricao, p.un, p.checkout, p.fornecedor, p.pesoBruto], ["99001", "BIKE ARO 29", "UN", true, 8558, 15.2]);
  assert.deepEqual(p.embalagens, [{ codigo: "111", descricao: "Unidade", qtd: 1 }, { codigo: "112", descricao: "Caixa com 2", qtd: 2 }]);
});

test("código de barras de outro produto: a nota entra, o produto fica sem o código e a nota leva o aviso", () => {
  const [r] = cadastrosDasNotas([nota("1", [
    { produto: "99002", qtd: 1, cadastro: cadastro("CAMARA 29", [{ descricao: "Unidade", codigo: "789000", qtd: 1 }, { descricao: "Fardo", codigo: "790", qtd: 10 }]) },
  ])], contexto);
  assert.equal(r.bloqueio, null);
  assert.deepEqual(r.avisos, [avisoCodigoRepetido("789000", "99002", "536")]);
  assert.deepEqual(r.produtos[0].embalagens, [{ codigo: null, descricao: "Unidade", qtd: 1 }, { codigo: "790", descricao: "Fardo", qtd: 10 }]);
});

test("na mesma busca: o produto novo da primeira nota não é cadastrado de novo, e o código dele já conta", () => {
  const [a, b] = cadastrosDasNotas([
    nota("1", [{ produto: "99001", qtd: 1, cadastro: cadastro("BIKE", [{ descricao: "Unidade", codigo: "111", qtd: 1 }]) }]),
    nota("2", [
      { produto: "99001", qtd: 3, cadastro: cadastro("BIKE", [{ descricao: "Unidade", codigo: "111", qtd: 1 }]) },
      { produto: "99003", qtd: 1, cadastro: cadastro("PEDAL", [{ descricao: "Unidade", codigo: "111", qtd: 1 }]) },
    ]),
  ], contexto);
  assert.equal(a.produtos.length, 1);
  assert.deepEqual(b.produtos.map((p) => p.codigo), ["99003"]);
  assert.deepEqual(b.avisos, [avisoCodigoRepetido("111", "99003", "99001")]);
});

test("produto novo sem os dados: a nota é bloqueada e não cadastra nada; embalagem inválida fica de fora com aviso", () => {
  const [a, b] = cadastrosDasNotas([
    nota("1", [{ produto: "99004", qtd: 1, cadastro: cadastro("X", [{ descricao: "Unidade", codigo: "555", qtd: 1 }]) }, { produto: "99005", qtd: 1 }]),
    nota("2", [{ produto: "99006", qtd: 1, cadastro: cadastro("Y", [{ descricao: "Unidade", codigo: "555", qtd: 1 }, { descricao: "Meia", qtd: 0.5 }]) }]),
  ], contexto);
  assert.equal(a.bloqueio, msgProdutoSemDados("99005"));
  assert.deepEqual(a.produtos, []);
  assert.equal(b.bloqueio, null);
  assert.deepEqual(b.produtos[0].embalagens, [{ codigo: "555", descricao: "Unidade", qtd: 1 }], "o código da nota bloqueada não conta");
  assert.equal(b.avisos.length, 1);
});

test("a nota guardada fica só com produto e quantidade", () => {
  const n = notaSemCadastro(nota("1", [{ produto: "99001", qtd: 2, cadastro: cadastro("BIKE") }]));
  assert.deepEqual(n.itens, [{ produto: "99001", qtd: 2 }]);
});
