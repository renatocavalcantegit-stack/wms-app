// Produtos e embalagens: código de barras único, busca e importação do ERP.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarEmbalagem, lerQuantidade, acharPorCodigoLido, buscarProdutos, separarImportacao,
  MSG_CODIGO_DUPLICADO, MSG_PRODUTO_JA_IMPORTADO,
} from "../compartilhado/regras/embalagens.js";

const produtos = [
  { codigo: "CM-29-PRESTA", descricao: "Câmara de Ar Aro 29 Presta" },
  { codigo: "PN-29-225", descricao: "Pneu 29 x 2.25 Cravo" },
];
const embalagens = [
  { id: 1, produto: "CM-29-PRESTA", codigo: "7891000200018", descricao: "Unidade", qtd: 1 },
  { id: 2, produto: "CM-29-PRESTA", codigo: "17891000200015", descricao: "Caixa com 50", qtd: 50 },
  { id: 3, produto: "PN-29-225", codigo: "", descricao: "Unidade", qtd: 1 },
];

test("quantidade da embalagem aceita inteiro ou decimal, com vírgula ou ponto", () => {
  assert.equal(lerQuantidade("12"), 12);
  assert.equal(lerQuantidade("0,5"), 0.5);
  assert.equal(lerQuantidade("0"), null);
  assert.equal(lerQuantidade("abc"), null);
});

test("embalagem: código de barras opcional, mas único no WMS inteiro", () => {
  assert.equal(validarEmbalagem({ codigo: "", descricao: "Fardo", qtd: "10" }, embalagens).ok, true);
  assert.deepEqual(validarEmbalagem({ codigo: "7891000200018", descricao: "Outra", qtd: 1 }, embalagens), { ok: false, msg: MSG_CODIGO_DUPLICADO });
  // editando a própria embalagem, o código dela não conta como repetido
  assert.equal(validarEmbalagem({ codigo: "7891000200018", descricao: "Unidade", qtd: 1 }, embalagens, 1).ok, true);
});

test("embalagem: descrição e quantidade são obrigatórias", () => {
  assert.match(validarEmbalagem({ descricao: " ", qtd: 1 }, embalagens).msg, /descrição/);
  assert.match(validarEmbalagem({ descricao: "Caixa", qtd: "" }, embalagens).msg, /quantidade/);
  assert.deepEqual(validarEmbalagem({ codigo: " 123 ", descricao: " Caixa ", qtd: "6" }, []).embalagem, { codigo: "123", descricao: "Caixa", qtd: 6 });
});

test("código lido: acha pela embalagem (e sabe qual) ou pelo código interno do produto", () => {
  const caixa = acharPorCodigoLido(produtos, embalagens, "17891000200015");
  assert.equal(caixa.produto.codigo, "CM-29-PRESTA");
  assert.equal(caixa.embalagem.qtd, 50);
  const interno = acharPorCodigoLido(produtos, embalagens, " pn-29-225 ");
  assert.equal(interno.produto.codigo, "PN-29-225");
  assert.equal(interno.embalagem, null);
  assert.equal(acharPorCodigoLido(produtos, embalagens, "000"), null);
});

test("busca de produto por código ou descrição, sem ligar para acento e maiúsculas", () => {
  assert.deepEqual(buscarProdutos(produtos, "camara").map((p) => p.codigo), ["CM-29-PRESTA"]);
  assert.equal(buscarProdutos(produtos, "29").length, 2);
  assert.equal(buscarProdutos(produtos, "").length, 2);
});

test("importação do ERP: produto que já existe é bloqueado sem alterar o que está no WMS", () => {
  const r = separarImportacao(produtos, [{ codigo: "PN-29-225", descricao: "Outro nome" }, { codigo: "NOVO-1", descricao: "Novo" }]);
  assert.deepEqual(r.importados.map((p) => p.codigo), ["NOVO-1"]);
  assert.equal(r.bloqueados[0].msg, MSG_PRODUTO_JA_IMPORTADO);
});
