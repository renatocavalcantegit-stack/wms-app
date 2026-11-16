// Camada de dados do Estoque: o que as telas de cadastro gravam e leem.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import {
  lerEstoque, criarEndereco, criarEnderecos, desativarEndereco, reativarEndereco, importarProdutosDoErp,
  salvarEmbalagem, excluirEmbalagem, associarProduto, removerAssociacao, saldosDoProduto, saldoDoEndereco,
} from "../js/dados/estoque.js";
import { gerarLote, MSG_ENDERECO_COM_ESTOQUE, MSG_ENDERECO_EM_USO, MSG_JA_ASSOCIADO } from "../compartilhado/regras/enderecos.js";
import { MSG_CODIGO_DUPLICADO, MSG_PRODUTO_JA_IMPORTADO } from "../compartilhado/regras/embalagens.js";

beforeEach(limparArmazenamento);

const porCodigo = (codigo) => lerEstoque().enderecos.find((e) => e.codigo === codigo && e.ativo);

test("demonstração: endereços no formato numérico, docas, inativos e saldo de cada produto", () => {
  const db = lerEstoque();
  assert.ok(db.enderecos.every((e) => /^R\d+-P\d+-A\d+-AP\d+$/.test(e.codigo)));
  assert.equal(db.enderecos.filter((e) => e.tipo === "doca").length, 4);
  assert.equal(db.enderecos.filter((e) => !e.ativo).length, 2);
  assert.equal(new Set(db.enderecos.map((e) => e.id)).size, db.enderecos.length); // IDs únicos
  assert.ok(db.produtos.every((p) => saldosDoProduto(db, p.codigo).length > 0));
});

test("novo endereço: os números da prateleira viram o código, com ID novo; repetido é bloqueado", () => {
  const r = criarEndereco({ rua: 3001, predio: 1, andar: 100, apto: 110, tipo: "picking", deposito: " " });
  assert.equal(r.ok, true);
  assert.equal(r.endereco.codigo, "R3001-P1-A100-AP110");
  assert.equal(r.endereco.deposito, "Principal");
  assert.ok(porCodigo("R3001-P1-A100-AP110"));
  assert.deepEqual(criarEndereco({ rua: 3001, predio: 1, andar: 100, apto: 110, tipo: "picking" }), { ok: false, msg: MSG_ENDERECO_EM_USO });
  assert.match(criarEndereco({ rua: 3001, predio: 1, andar: 100, apto: "", tipo: "picking" }).msg, /^Apartamento/);
  assert.match(criarEndereco({ rua: 3001, predio: 1, andar: 100, apto: 111, tipo: "" }).msg, /tipo/);
});

test("lote: grava com IDs novos e pula o que já existe ativo", () => {
  const { enderecos } = gerarLote({ ruaIni: 3001, ruaFim: 3001, predioIni: 1, predioFim: 1, andarIni: 100, andarFim: 300,
    andarPasso: 100, aptoIni: 101, aptoFim: 110, tipo: "picking" });
  const r = criarEnderecos(enderecos, " ");
  assert.deepEqual(r, { criados: 12, ignorados: 18 }); // x01 a x06 dos 3 andares já existiam
  assert.equal(porCodigo("R3001-P1-A300-AP310").deposito, "Principal");
  const ids = lerEstoque().enderecos.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length); // nenhum ID repetido
});

test("desativar: endereço com estoque é bloqueado; vazio desativa", () => {
  const cheio = porCodigo("R3001-P1-A100-AP102"); // picking da bicicleta aro 29
  assert.deepEqual(desativarEndereco(cheio.id), { ok: false, msg: MSG_ENDERECO_COM_ESTOQUE });
  const vazio = porCodigo("R3001-P6-A100-AP106");
  assert.equal(saldoDoEndereco(lerEstoque(), vazio.id), 0);
  assert.deepEqual(desativarEndereco(vazio.id), { ok: true });
  assert.equal(porCodigo("R3001-P6-A100-AP106"), undefined);
});

test("reativar: nasce endereço com ID novo; o antigo fica inativo e aponta para o novo", () => {
  const inativo = lerEstoque().enderecos.find((e) => e.codigo === "R3004-P6-A500-AP503");
  assert.deepEqual(reativarEndereco(inativo.id, { rua: 3001, predio: 1, andar: 100, apto: 102, tipo: "picking", deposito: "Principal" }),
    { ok: false, msg: MSG_ENDERECO_EM_USO });
  const r = reativarEndereco(inativo.id, { rua: 3004, predio: 6, andar: 500, apto: 503, tipo: "aereo", deposito: "Principal" });
  assert.equal(r.ok, true);
  assert.equal(r.endereco.codigo, "R3004-P6-A500-AP503"); // digitado andar 5, apto 3
  assert.notEqual(r.endereco.id, inativo.id);
  const antigo = lerEstoque().enderecos.find((e) => e.id === inativo.id);
  assert.equal(antigo.ativo, false);
  assert.equal(antigo.substituidoPor, r.endereco.id);
});

test("importação do ERP: novos entram; repetido é bloqueado", () => {
  const r = importarProdutosDoErp();
  assert.equal(r.importados.length, 2);
  assert.equal(r.bloqueados[0].msg, MSG_PRODUTO_JA_IMPORTADO);
  assert.equal(importarProdutosDoErp().importados.length, 0); // segunda vez, todos já existem
});

test("embalagens: cria, bloqueia código repetido, edita e exclui", () => {
  assert.deepEqual(salvarEmbalagem("PN-29-225", { codigo: "7891000100011", descricao: "Caixa", qtd: 2 }), { ok: false, msg: MSG_CODIGO_DUPLICADO });
  assert.deepEqual(salvarEmbalagem("PN-29-225", { codigo: "555", descricao: "Caixa com 4", qtd: "4" }), { ok: true });
  const nova = lerEstoque().embalagens.find((e) => e.codigo === "555");
  assert.equal(salvarEmbalagem("PN-29-225", { codigo: "556", descricao: "Caixa com 4", qtd: 4 }, nova.id).ok, true);
  assert.equal(lerEstoque().embalagens.find((e) => e.id === nova.id).codigo, "556");
  excluirEmbalagem(nova.id);
  assert.equal(lerEstoque().embalagens.some((e) => e.id === nova.id), false);
});

test("endereço padrão: associa, bloqueia repetido e remove", () => {
  const end = porCodigo("R3002-P1-A100-AP101");
  assert.deepEqual(associarProduto("PN-29-225", end.id), { ok: true });
  assert.deepEqual(associarProduto("PN-29-225", end.id), { ok: false, msg: MSG_JA_ASSOCIADO });
  removerAssociacao("PN-29-225", end.id);
  assert.deepEqual(associarProduto("PN-29-225", end.id), { ok: true });
});
